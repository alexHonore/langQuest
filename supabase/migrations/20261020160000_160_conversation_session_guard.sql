-- 160 — conversation session guard (round 4, leftover 3 of docs/evidence/test-run-2026-10-20.md).
--
-- `conversation_sessions` is full CRUD for its owner (070, `full_crud`), and nothing guarded its columns: through
-- PostgREST a learner could insert a session already `finished` with a made-up `rubric_outcomes`, or rewrite `state`,
-- the evaluator output, the summary (prompt context), the objectives, the mission / enrollment / character links,
-- `started_at` (the 30-minute ceiling) or the counters on their own row. The API trusted some of them at finish.
--
-- From here on the session row is server-owned at the source:
--   1. A learner (a JWT caller: `anon` / `authenticated`) cannot INSERT a session. The API creates sessions with the
--      service role after resolving everything they name under the learner's RLS (POST /v1/ai/conversation/session).
--   2. A learner may UPDATE only the learner-writable columns of their own session: `speech_retention` (their own
--      privacy choice; new turns' `expires_at` follows it, 070 `set_conversation_turn_retention`). `updated_at` is set
--      by its own trigger. Every other column — state, rubric_outcomes, summary, objectives_completed, ended_at,
--      started_at, created_at, the counters (turn_count, revision, last_seq), mode, pipeline, scope, and the user /
--      enrollment / mission / scenario / character / variety / source-language links — is decided by the server. Any
--      column added later is server-owned too (the guard compares whole rows, minus the allow-list).
--   3. A learner cannot append a line to a finished conversation (`conversation_turns`): its transcript is closed.
--
-- Server callers are untouched: the service role (API Worker, jobs runner), `postgres`, SECURITY DEFINER functions
-- (they run as their owner) and foreign-key actions (`ON DELETE SET NULL` on mission_id / scenario_id run as the
-- table owner). The test is `current_user`, so the trigger functions stay SECURITY INVOKER on purpose.
-- RLS policies and grants are unchanged (nothing is weakened); learners keep select / delete on their own sessions
-- and the insert of their own learner lines into an open session (070, packages/db rls.test.ts).
-- pgTAP: supabase/tests/database/conversation_session_guard.test.sql. Idempotent (create or replace, drop if exists).

-- ---------------------------------------------------------------------------
-- 1. conversation_sessions: server-owned columns
-- ---------------------------------------------------------------------------
/**
 * BEFORE INSERT OR UPDATE guard on conversation_sessions for JWT callers (anon / authenticated): no insert, and an
 * update may change only `speech_retention` (plus `updated_at`, which `set_updated_at` maintains). Raises 42501 naming
 * the refused columns. Everyone else (service_role, postgres, security-definer functions, FK actions) passes.
 */
create or replace function public.guard_conversation_session_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_learner_writable constant text[] := array['speech_retention', 'updated_at'];
  v_changed text[];
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- service role, postgres, security-definer functions, foreign-key actions
  end if;
  if tg_op = 'INSERT' then
    raise exception 'conversation sessions are created by the API (POST /v1/ai/conversation/session), not directly'
      using errcode = '42501';
  end if;
  select coalesce(array_agg(n.key order by n.key), '{}'::text[])
    into v_changed
    from jsonb_each(to_jsonb(new)) as n(key, value)
   where not (n.key = any (v_learner_writable))
     and n.value is distinct from (to_jsonb(old) -> n.key);
  if cardinality(v_changed) > 0 then
    raise exception 'conversation_sessions columns (%) are decided by the server', array_to_string(v_changed, ', ')
      using errcode = '42501',
            hint = 'Only speech_retention may be changed by the learner; the rest is written by the API.';
  end if;
  return new;
end;
$$;
comment on function public.guard_conversation_session_write() is
  'Migration 160: JWT callers cannot insert conversation sessions and may update only speech_retention; the server (service role, definer functions, FK actions) decides every other column.';

drop trigger if exists guard_conversation_session_write on public.conversation_sessions;
create trigger guard_conversation_session_write
  before insert or update on public.conversation_sessions
  for each row execute function public.guard_conversation_session_write();

-- ---------------------------------------------------------------------------
-- 2. conversation_turns: a finished conversation is closed
-- ---------------------------------------------------------------------------
/**
 * BEFORE INSERT guard on conversation_turns for JWT callers: no line may be appended to a session the server has
 * finished. (The 070 policy already limits learners to their own `learner` lines in their own sessions.)
 */
create or replace function public.guard_conversation_turn_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if exists (select 1 from public.conversation_sessions s where s.id = new.session_id and s.state = 'finished') then
    raise exception 'this conversation has ended; its transcript is closed' using errcode = '42501';
  end if;
  return new;
end;
$$;
comment on function public.guard_conversation_turn_insert() is
  'Migration 160: JWT callers cannot append turns to a finished conversation session.';

drop trigger if exists guard_conversation_turn_insert on public.conversation_turns;
create trigger guard_conversation_turn_insert
  before insert on public.conversation_turns
  for each row execute function public.guard_conversation_turn_insert();
