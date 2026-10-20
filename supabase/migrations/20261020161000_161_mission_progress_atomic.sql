-- Migration 161: mission credit and mission progress are settled by the database (round-3 leftover 8).
--
-- Until now two parts of `POST /v1/missions/:id/evaluate` were read-then-write in the API Worker:
--   1. "one graded take (or conversation session) backs one attempt, ever" was checked by scanning the other attempts'
--      stored decisions before and after writing a decision. With three requests (one attempt evaluated twice, plus
--      another attempt on the same takes) the replay could pay mission XP from a first decision that the post-write
--      check then dropped, so one take could pay two missions.
--   2. `mission_progress.completions` was read, incremented in TypeScript and upserted, so parallel credited attempts
--      of one mission lost counts.
--
-- Both are now enforced here, in one transaction per evaluation:
--   * `mission_evidence_claims`: one row per piece of server evidence a decision is credited with (a speech-route
--     grading row in `learning_observations`, or a conversation session). Its primary key is the evidence id, so a
--     grading row or a session backs at most one attempt. Service role only; learners can neither read nor write it.
--   * `complete_mission_attempt()`: under the attempt's row lock it (a) refuses a second decision for the attempt
--     (first write wins; the caller replays the stored one), (b) claims every evidence id the decision names, all or
--     nothing (an id another attempt holds comes back as `contested`, nothing is written, and the API re-decides
--     without it), (c) writes the decision, and (d) records the completion in `mission_progress` with
--     `completions = completions + 1` when the decision credits the mission. A decision is therefore final when it
--     is stored, and anything paid from it (mission XP through `award_xp`, once per attempt by
--     `xp_ledger_reference_once`) is backed by evidence no other attempt holds.
--   * `guard_mission_attempt_write()` (070, replaced): a learner can no longer change `mission_id` or `enrollment_id`
--     of a completed attempt. RLS owner_update lets learners rewrite both, and a stored decision is replayed by
--     `POST /v1/missions/:id/evaluate`; a completed attempt pointed at another mission or enrollment would otherwise
--     replay there and complete a mission (and course) the learner never played. Open attempts keep them writable, as
--     before (offline-first starts; `complete_mission_attempt` re-checks both under its row lock). The API also checks
--     the decision against the mission and enrollment it names (`decisionMadeFor`).
--   * Backfill: decisions stored before this migration get their claims (the earliest completed attempt keeps a
--     contested id).
--
-- Idempotent (create if not exists / create or replace / on conflict do nothing). RLS: enabled on the new table with
-- no learner policy; the function is security definer, refuses any caller with a JWT subject, and is executable by
-- service_role only. The guard only adds a refusal (never weakens 070).

-- ---------------------------------------------------------------------------
-- 1. Evidence claims
-- ---------------------------------------------------------------------------
create table if not exists public.mission_evidence_claims (
  /** A `learning_observations.id` (speech-route grading row) or a `conversation_sessions.id`. */
  evidence_id uuid primary key,
  evidence_kind text not null check (evidence_kind in ('grading_row', 'conversation_session')),
  attempt_id uuid not null references public.mission_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index if not exists mission_evidence_claims_attempt_idx on public.mission_evidence_claims(attempt_id);
create index if not exists mission_evidence_claims_user_idx on public.mission_evidence_claims(user_id);
comment on table public.mission_evidence_claims is
  'Server evidence (grading row or conversation session) backing a mission attempt''s credit; the primary key makes one piece of evidence back one attempt. Written only by complete_mission_attempt().';

alter table public.mission_evidence_claims enable row level security;
-- No policy for anon/authenticated: the API Worker (service role) is the only reader and writer.
revoke all on table public.mission_evidence_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.mission_evidence_claims to service_role;

-- ---------------------------------------------------------------------------
-- 2. One evaluation decision, settled atomically
-- ---------------------------------------------------------------------------
/**
 * Settle one evaluation of a mission attempt (API Worker, service role).
 *
 * `p_evaluation` is the `mission_attempts.evaluation` document; its `credit` block (`missionCredited`, `withoutHints`,
 * `steps[].evidence`, `steps[].evidenceIds`) is what this function claims and counts. `p_seen_evaluation` is the
 * evaluation the caller read (null for an attempt without a decision): the write happens only if it is still the
 * stored one.
 *
 * Returns one row:
 * - `written`: claims taken, decision stored, completion recorded (`attempt` is the updated row);
 * - `already_decided`: another evaluation stored a decision first; nothing changed (`attempt` holds that decision);
 * - `contested`: `contested_ids` are held by other attempts; nothing changed (the caller re-decides without them).
 * Raises 23503 when the attempt, enrollment, mission or an evidence row is not the user's, 22023 on a malformed
 * decision, 42501 for any caller with a JWT subject.
 */
create or replace function public.complete_mission_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_enrollment_id uuid,
  p_mission_id uuid,
  p_completed_at timestamptz,
  p_step_results jsonb,
  p_objectives_completed text[],
  p_evaluation jsonb,
  p_current_step_index integer,
  p_seen_evaluation jsonb default null
)
returns table (outcome text, contested_ids uuid[], attempt jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.mission_attempts%rowtype;
  v_grading uuid[];
  v_sessions uuid[];
  v_contested uuid[] := '{}';
  v_credited boolean;
  v_without_hints boolean;
  v_counts boolean;
  v_completed_at timestamptz;
begin
  if auth.uid() is not null then
    raise exception 'complete_mission_attempt is called by the API Worker (service role) only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_evaluation) is distinct from 'object'
     or jsonb_typeof(p_evaluation -> 'credit') is distinct from 'object'
     or jsonb_typeof(p_evaluation -> 'credit' -> 'steps') is distinct from 'array'
     or jsonb_typeof(p_evaluation -> 'credit' -> 'missionCredited') is distinct from 'boolean' then
    raise exception 'p_evaluation must carry a credit decision (credit.missionCredited, credit.steps)' using errcode = '22023';
  end if;

  -- The row lock serialises every decision about this attempt: a second evaluation waits here, then sees the first.
  select a.* into v_attempt from public.mission_attempts a where a.id = p_attempt_id and a.user_id = p_user_id for update;
  if not found then
    raise exception 'mission attempt % is not an attempt of user %', p_attempt_id, p_user_id using errcode = '23503';
  end if;
  -- mission_id and enrollment_id are learner-writable: they must still be what the API validated.
  if v_attempt.enrollment_id is distinct from p_enrollment_id or v_attempt.mission_id is distinct from p_mission_id
     or not exists (select 1 from public.user_course_enrollments e where e.id = p_enrollment_id and e.user_id = p_user_id) then
    raise exception 'mission attempt % is not an attempt of enrollment % and mission %', p_attempt_id, p_enrollment_id, p_mission_id
      using errcode = '23503';
  end if;

  -- First write wins.
  if v_attempt.evaluation is distinct from p_seen_evaluation then
    return query select 'already_decided'::text, '{}'::uuid[], to_jsonb(v_attempt);
    return;
  end if;

  -- The evidence the decision is credited with.
  select coalesce(array_agg(distinct (e.txt)::uuid), '{}') into v_grading
  from jsonb_array_elements(p_evaluation -> 'credit' -> 'steps') st
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(st -> 'evidenceIds') = 'array' then st -> 'evidenceIds' else '[]'::jsonb end) e(txt)
  where st ->> 'evidence' = 'speech_evaluation';
  select coalesce(array_agg(distinct (e.txt)::uuid), '{}') into v_sessions
  from jsonb_array_elements(p_evaluation -> 'credit' -> 'steps') st
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(st -> 'evidenceIds') = 'array' then st -> 'evidenceIds' else '[]'::jsonb end) e(txt)
  where st ->> 'evidence' = 'conversation_evaluator';
  if v_grading && v_sessions then
    raise exception 'an evidence id cannot be both a grading row and a session' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_grading) g(id) where not exists (select 1 from public.learning_observations o where o.id = g.id and o.user_id = p_user_id))
     or exists (select 1 from unnest(v_sessions) s(id) where not exists (select 1 from public.conversation_sessions c where c.id = s.id and c.user_id = p_user_id)) then
    raise exception 'the decision names evidence that is not a row of user %', p_user_id using errcode = '23503';
  end if;

  -- Claim all of it or none of it. Inserts go in id order, so two evaluations claiming overlapping sets never deadlock;
  -- a concurrent claim of the same id waits for the other transaction and then sees its row.
  begin
    insert into public.mission_evidence_claims (evidence_id, evidence_kind, attempt_id, user_id)
    select x.id, x.kind, p_attempt_id, p_user_id
    from (select g.id, 'grading_row'::text as kind from unnest(v_grading) g(id)
          union all
          select s.id, 'conversation_session'::text from unnest(v_sessions) s(id)) x
    order by x.id
    on conflict (evidence_id) do nothing;
    select coalesce(array_agg(c.evidence_id order by c.evidence_id), '{}') into v_contested
    from public.mission_evidence_claims c
    where c.evidence_id = any(v_grading || v_sessions) and c.attempt_id <> p_attempt_id;
    if cardinality(v_contested) > 0 then
      raise exception 'evidence held by another attempt' using errcode = 'LQ161';
    end if;
  exception when sqlstate 'LQ161' then
    -- The block's claims are rolled back; the attempt row lock is kept until the caller's transaction ends.
    return query select 'contested'::text, v_contested, to_jsonb(v_attempt);
    return;
  end;

  v_completed_at := coalesce(v_attempt.completed_at, p_completed_at, now());
  update public.mission_attempts a
     set completed_at = v_completed_at,
         step_results = coalesce(p_step_results, a.step_results),
         objectives_completed = coalesce(p_objectives_completed, '{}'),
         evaluation = p_evaluation,
         current_step_index = coalesce(p_current_step_index, a.current_step_index)
   where a.id = p_attempt_id
  returning a.* into v_attempt;

  -- The completion: always "completed" for navigation; counted once, here, when the decision credits the mission.
  -- Replacing an unreadable earlier decision (p_seen_evaluation not null) never counts again.
  v_credited := (p_evaluation -> 'credit' ->> 'missionCredited')::boolean;
  v_without_hints := case when jsonb_typeof(p_evaluation -> 'credit' -> 'withoutHints') = 'boolean'
                          then (p_evaluation -> 'credit' ->> 'withoutHints')::boolean else false end;
  v_counts := v_credited and p_seen_evaluation is null;
  insert into public.mission_progress as mp
    (user_id, enrollment_id, mission_id, status, best_attempt_id, completions, completed_without_hints, first_completed_at, last_completed_at)
  values
    (p_user_id, p_enrollment_id, p_mission_id, 'completed',
     case when v_credited then p_attempt_id end,
     case when v_counts then 1 else 0 end,
     v_credited and v_without_hints,
     case when v_credited then v_completed_at end,
     v_completed_at)
  on conflict (enrollment_id, mission_id) do update
     set status = 'completed',
         best_attempt_id = coalesce(excluded.best_attempt_id, mp.best_attempt_id),
         completions = mp.completions + excluded.completions,
         completed_without_hints = mp.completed_without_hints or excluded.completed_without_hints,
         first_completed_at = coalesce(mp.first_completed_at, excluded.first_completed_at),
         last_completed_at = excluded.last_completed_at;

  return query select 'written'::text, '{}'::uuid[], to_jsonb(v_attempt);
end;
$$;

revoke all on function public.complete_mission_attempt(uuid, uuid, uuid, uuid, timestamptz, jsonb, text[], jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.complete_mission_attempt(uuid, uuid, uuid, uuid, timestamptz, jsonb, text[], jsonb, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A completed attempt stays with the mission and enrollment it was completed for
-- ---------------------------------------------------------------------------
/**
 * Rejects learner writes to the server-decided outcome columns of mission_attempts (070), and, since 161, any learner
 * change of `mission_id` or `enrollment_id` once the attempt is completed. The trigger `guard_mission_attempt_write`
 * (070) already calls this function; only the body changes.
 */
create or replace function public.guard_mission_attempt_write()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then
    return new; -- service role / jobs runner
  end if;
  if tg_op = 'INSERT' then
    if new.completed_at is not null or new.evaluation is not null or new.xp_awarded <> 0
       or coalesce(array_length(new.objectives_completed, 1), 0) > 0 then
      raise exception 'completed_at, evaluation, xp_awarded and objectives_completed are decided by the server' using errcode = '42501';
    end if;
  elsif new.completed_at is distinct from old.completed_at or new.evaluation is distinct from old.evaluation
        or new.xp_awarded is distinct from old.xp_awarded or new.objectives_completed is distinct from old.objectives_completed then
    raise exception 'completed_at, evaluation, xp_awarded and objectives_completed are decided by the server' using errcode = '42501';
  elsif old.completed_at is not null
        and (new.mission_id is distinct from old.mission_id or new.enrollment_id is distinct from old.enrollment_id) then
    raise exception 'a completed attempt keeps the mission and enrollment it was completed for' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill: claims for the decisions already stored (the earliest completed attempt keeps a shared id)
-- ---------------------------------------------------------------------------
insert into public.mission_evidence_claims (evidence_id, evidence_kind, attempt_id, user_id, claimed_at)
select distinct on (ev.id) ev.id, ev.kind, ev.attempt_id, ev.user_id, ev.decided_at
from (
  select (e.txt)::uuid as id,
         case st ->> 'evidence' when 'conversation_evaluator' then 'conversation_session' else 'grading_row' end as kind,
         a.id as attempt_id, a.user_id, coalesce(a.completed_at, a.updated_at) as decided_at
  from public.mission_attempts a
  cross join lateral jsonb_array_elements(case when jsonb_typeof(a.evaluation -> 'credit' -> 'steps') = 'array' then a.evaluation -> 'credit' -> 'steps' else '[]'::jsonb end) st
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(st -> 'evidenceIds') = 'array' then st -> 'evidenceIds' else '[]'::jsonb end) e(txt)
  where a.completed_at is not null
    and st ->> 'evidence' in ('speech_evaluation', 'conversation_evaluator')
    and e.txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
) ev
order by ev.id, ev.decided_at, ev.attempt_id
on conflict (evidence_id) do nothing;

-- ---------------------------------------------------------------------------
-- Sanity (same as 070 §9): every public table has RLS enabled.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise exception 'RLS not enabled on public.%', t.relname;
  end loop;
end $$;
