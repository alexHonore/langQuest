-- 060 — RPC functions that enforce invariants (job claiming, XP idempotency, sync idempotency,
-- enrollment source-language change, due reviews).

-- ---------------------------------------------------------------------------
-- Processing-job queue (ADR-005): Postgres-backed, FOR UPDATE SKIP LOCKED
-- ---------------------------------------------------------------------------

/**
 * Idempotently enqueues a job. Re-enqueueing the same idempotency key returns the existing row
 * (whatever its state) so callers can safely retry.
 */
create or replace function public.enqueue_processing_job(
  p_job_type text,
  p_idempotency_key text,
  p_params jsonb default '{}'::jsonb,
  p_parent_asset_id uuid default null,
  p_parent_entity_table text default null,
  p_parent_entity_id uuid default null,
  p_priority integer default 5,
  p_requested_by uuid default null,
  p_provider text default null,
  p_max_attempts integer default 3
)
returns public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.processing_jobs;
begin
  if auth.uid() is not null and not public.is_content_editor() then
    raise exception 'insufficient_privilege: only content editors may enqueue jobs' using errcode = '42501';
  end if;
  insert into public.processing_jobs (job_type, idempotency_key, params, parent_asset_id, parent_entity_table, parent_entity_id, priority, requested_by, provider, max_attempts)
  values (p_job_type, p_idempotency_key, coalesce(p_params, '{}'::jsonb), p_parent_asset_id, p_parent_entity_table, p_parent_entity_id, coalesce(p_priority, 5),
          -- an authenticated editor is always the requester; only the service role may attribute on behalf of someone
          case when auth.uid() is not null then auth.uid() else p_requested_by end,
          p_provider, coalesce(p_max_attempts, 3))
  on conflict (idempotency_key) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.processing_jobs where idempotency_key = p_idempotency_key;
  end if;
  return v_row;
end;
$$;

/**
 * Claims at most one claimable job for `p_worker_id`, using FOR UPDATE SKIP LOCKED so concurrent
 * workers never pick the same row. Claimable = pending, or running with an expired lease (crashed
 * worker) and attempts remaining. Returns zero rows when nothing is claimable.
 * Service role (the jobs runner) only: every claim burns an attempt, so an editor token must never
 * be able to exhaust `max_attempts` and strand work in `running`.
 */
create or replace function public.claim_processing_job(
  p_worker_id text,
  p_job_types text[] default null,
  p_lease_seconds integer default 600
)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'insufficient_privilege: only the jobs runner (service role) may claim jobs' using errcode = '42501';
  end if;
  return query
  with candidate as (
    select j.id
    from public.processing_jobs j
    where (
        j.state = 'pending'
        or (j.state = 'running' and j.locked_until is not null and j.locked_until < now())
      )
      and (j.locked_until is null or j.locked_until < now())
      and j.attempts < j.max_attempts
      and (p_job_types is null or j.job_type = any(p_job_types))
    order by j.priority desc, j.created_at asc
    limit 1
    for update skip locked
  )
  update public.processing_jobs j
  set state = 'running',
      locked_by = p_worker_id,
      locked_until = now() + make_interval(secs => coalesce(p_lease_seconds, 600)),
      attempts = j.attempts + 1,
      started_at = coalesce(j.started_at, now()),
      failure_code = null,
      failure_message = null
  from candidate
  where j.id = candidate.id
  returning j.*;
end;
$$;

/** Extends the lease and records progress. Returns false when the worker no longer owns the job. */
create or replace function public.heartbeat_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_progress_pct double precision default null,
  p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.processing_jobs
  set locked_until = now() + make_interval(secs => coalesce(p_lease_seconds, 600)),
      progress_pct = coalesce(p_progress_pct, progress_pct)
  where id = p_job_id and locked_by = p_worker_id and state = 'running';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

/** Marks a running job succeeded. Raises when the job is not running under this worker. */
create or replace function public.complete_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_output jsonb default null,
  p_output_asset_ids uuid[] default '{}',
  p_cost_actual_usd numeric default null
)
returns public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.processing_jobs;
begin
  update public.processing_jobs
  set state = 'succeeded',
      output = p_output,
      output_asset_ids = coalesce(p_output_asset_ids, '{}'),
      cost_actual_usd = coalesce(p_cost_actual_usd, cost_actual_usd),
      progress_pct = 100,
      finished_at = now(),
      locked_by = null,
      locked_until = null
  where id = p_job_id and locked_by = p_worker_id and state = 'running'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'job % is not running under worker %', p_job_id, p_worker_id using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

/**
 * Records a failure. With retries left and `p_retry`, the job goes back to pending behind a backoff
 * lease; otherwise it lands in `review_needed` (never silently dropped) — or `failed` when `p_retry` is false.
 */
create or replace function public.fail_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_failure_code text,
  p_failure_message text default null,
  p_retry boolean default true,
  p_backoff_seconds integer default 60
)
returns public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.processing_jobs;
begin
  select * into v_row from public.processing_jobs where id = p_job_id and locked_by = p_worker_id and state = 'running' for update;
  if v_row.id is null then
    raise exception 'job % is not running under worker %', p_job_id, p_worker_id using errcode = 'P0002';
  end if;
  if p_retry and v_row.attempts < v_row.max_attempts then
    update public.processing_jobs
    set state = 'pending',
        failure_code = p_failure_code,
        failure_message = p_failure_message,
        locked_by = null,
        locked_until = now() + make_interval(secs => coalesce(p_backoff_seconds, 60) * power(2, greatest(v_row.attempts - 1, 0)))
    where id = p_job_id
    returning * into v_row;
  else
    update public.processing_jobs
    set state = case when p_retry then 'review_needed' else 'failed' end,
        failure_code = p_failure_code,
        failure_message = p_failure_message,
        finished_at = now(),
        locked_by = null,
        locked_until = null
    where id = p_job_id
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

/**
 * Sweeper for leases that expired without a heartbeat (crashed/killed worker). Rows with attempts
 * left go back to `pending` right away; exhausted rows land in `review_needed`, so a job can never be
 * stranded in `running` (§4.6 robustness; fail_processing_job's "never silently dropped" promise).
 * Service role only — run it from the jobs runner loop or pg_cron. Returns the rows it moved.
 */
create or replace function public.requeue_expired_jobs(p_limit integer default 500)
returns table (job_id uuid, new_state text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'insufficient_privilege: requeue_expired_jobs is service-role only' using errcode = '42501';
  end if;
  return query
  with expired as (
    select j.id, j.attempts, j.max_attempts
    from public.processing_jobs j
    where j.state = 'running' and j.locked_until is not null and j.locked_until < now()
    order by j.locked_until asc
    limit greatest(1, coalesce(p_limit, 500))
    for update skip locked
  ),
  moved as (
    update public.processing_jobs j
    set state = case when e.attempts < e.max_attempts then 'pending' else 'review_needed' end,
        locked_by = null,
        locked_until = null,
        failure_code = coalesce(j.failure_code, 'lease_expired'),
        failure_message = coalesce(j.failure_message, 'worker lease expired without heartbeat'),
        finished_at = case when e.attempts < e.max_attempts then null else now() end
    from expired e
    where j.id = e.id
    returning j.id, j.state
  )
  select moved.id, moved.state::text from moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- XP (§3.8): server-validated, idempotent, append-only
-- ---------------------------------------------------------------------------

/** Canonical server-side XP per reason. Client-supplied amounts are never trusted. */
create or replace function public.xp_amount_for_reason(p_reason text)
returns integer
language sql
immutable
as $$
  select case p_reason
    when 'mission_completed' then 50
    when 'step_completed' then 5
    when 'review_completed' then 3
    when 'conversation_turns' then 2
    when 'skill_state_advanced' then 20
    when 'audio_lesson_completed' then 15
    when 'daily_goal' then 25
    when 'achievement' then 30
    else 0
  end;
$$;

/**
 * True when (`p_reference_table`, `p_reference_id`) is a row owned by `p_user_id` that can back an XP
 * award: a completed mission attempt, a reviewed card, a recorded observation, an unlocked achievement,
 * a completed audio lesson, a conversation session, a mastery row or a streak day. Any other table is
 * rejected. Used by award_xp so a reference can never point at someone else's (or an unfinished) row.
 */
create or replace function public.xp_reference_owned(p_user_id uuid, p_reference_table text, p_reference_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_reference_table
    when 'mission_attempts' then exists (select 1 from public.mission_attempts a where a.id = p_reference_id and a.user_id = p_user_id and a.completed_at is not null)
    when 'user_expression_reviews' then exists (select 1 from public.user_expression_reviews r where r.id = p_reference_id and r.user_id = p_user_id and r.last_reviewed_at is not null)
    when 'learning_observations' then exists (select 1 from public.learning_observations o where o.id = p_reference_id and o.user_id = p_user_id)
    when 'user_achievements' then exists (select 1 from public.user_achievements u where u.id = p_reference_id and u.user_id = p_user_id)
    when 'user_audio_progress' then exists (select 1 from public.user_audio_progress p where p.id = p_reference_id and p.user_id = p_user_id and p.completed)
    when 'conversation_sessions' then exists (select 1 from public.conversation_sessions s where s.id = p_reference_id and s.user_id = p_user_id)
    when 'user_skill_mastery' then exists (select 1 from public.user_skill_mastery m where m.id = p_reference_id and m.user_id = p_user_id)
    when 'streak_activity' then exists (select 1 from public.streak_activity d where d.id = p_reference_id and d.user_id = p_user_id)
    else false
  end;
$$;

/**
 * Appends an XP ledger row once per idempotency key. Replays return `applied = false` and the
 * original row. Callable by the service role (server-validated awards) only: the API Worker
 * validates a learner's `xp_claim` sync event against the owned, completed row it references and
 * then calls this with the clientEventId as idempotency key. When a reference is given it must
 * resolve through `xp_reference_owned`, and the same reference is paid at most once per reason
 * (`xp_ledger_reference_once`): a second award for it returns `applied = false` with the row that
 * already paid it, never a second ledger row.
 */
create or replace function public.award_xp(
  p_idempotency_key uuid,
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_enrollment_id uuid default null,
  p_reference_table text default null,
  p_reference_id uuid default null,
  p_occurred_at timestamptz default now()
)
returns table (applied boolean, ledger_id uuid, amount integer, total_xp bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_amount integer;
  v_applied boolean := false;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id and not public.is_admin() then
    raise exception 'insufficient_privilege: cannot award XP to another user' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000 then
    raise exception 'invalid XP amount %', p_amount using errcode = '22023';
  end if;
  if p_enrollment_id is not null and not exists (select 1 from public.user_course_enrollments e where e.id = p_enrollment_id and e.user_id = p_user_id) then
    raise exception 'enrollment % does not belong to user %', p_enrollment_id, p_user_id using errcode = '23503';
  end if;
  if p_reference_id is not null and not public.xp_reference_owned(p_user_id, p_reference_table, p_reference_id) then
    raise exception 'xp reference %.% is not an owned, completed row of user %', coalesce(p_reference_table, '?'), p_reference_id, p_user_id using errcode = '23503';
  end if;

  begin
    insert into public.xp_ledger (user_id, enrollment_id, amount, reason, reference_table, reference_id, idempotency_key, occurred_at)
    values (p_user_id, p_enrollment_id, p_amount, p_reason, p_reference_table, p_reference_id, p_idempotency_key, coalesce(p_occurred_at, now()))
    on conflict (idempotency_key) do nothing
    returning xp_ledger.id, xp_ledger.amount into v_id, v_amount;
  exception when unique_violation then
    -- xp_ledger_reference_once: this reference was already paid under another idempotency key
    v_id := null;
  end;

  if v_id is not null then
    v_applied := true;
  else
    select l.id, l.amount into v_id, v_amount from public.xp_ledger l where l.idempotency_key = p_idempotency_key;
    if v_id is null and p_reference_id is not null then
      select l.id, l.amount into v_id, v_amount from public.xp_ledger l
      where l.user_id = p_user_id and l.reason = p_reason and l.reference_id = p_reference_id;
    end if;
  end if;

  return query
  select v_applied, v_id, v_amount, coalesce((select sum(l.amount) from public.xp_ledger l where l.user_id = p_user_id), 0)::bigint;
end;
$$;

/** Total XP for a user (ledger sum). */
create or replace function public.user_total_xp(p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(amount), 0)::bigint from public.xp_ledger where user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- Device sync (§4.5): idempotent on (user_id, client_event_id)
-- ---------------------------------------------------------------------------

/**
 * Applies a batch of `ProgressSyncEvent` objects (camelCase keys as sent by the client) idempotently.
 * Each event is recorded once in `device_sync_events`; duplicates return `duplicate` and never
 * re-apply. The whole batch runs under a per-user, transaction-scoped advisory lock, so two devices
 * replaying the same clientEventId at the same time are serialised: exactly one sees `applied`, the
 * other `duplicate`, and no side effect (play_count, streak minutes…) is applied twice (§4.5, A27).
 * DB-applied payload types: audio_progress, bookmark_created, activity_minutes, enrollment_opened.
 * Engine-handled types (review_result, step_completed, mission_abandoned, observation, xp_claim) are
 * recorded as applied with `handled_in_db = false` and `applied_at = null`; the API Worker finishes
 * them and calls `mark_sync_events_applied`. For `xp_claim` the Worker (service role) checks that the
 * claimed reference is an owned, completed row and only then calls `award_xp` with the clientEventId
 * as idempotency key — XP is never credited from a bare client claim (§3.8 "validated server-side").
 */
create or replace function public.apply_sync_events(
  p_events jsonb[],
  p_user_id uuid default null,
  p_client_sent_at timestamptz default null
)
returns table (client_event_id uuid, resolution text, reason text, xp_credited integer, handled_in_db boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid;
  v_skew integer;
  v_ev jsonb;
  v_event_id uuid;
  v_enrollment uuid;
  v_device text;
  v_revision integer;
  v_occurred timestamptz;
  v_payload jsonb;
  v_type text;
  v_res text;
  v_reason text;
  v_xp integer;
  v_db boolean;
  v_applied_at timestamptz;
  v_existing_rev integer;
begin
  v_user := coalesce(auth.uid(), p_user_id);
  if v_user is null then
    raise exception 'apply_sync_events requires an authenticated user or p_user_id' using errcode = '42501';
  end if;
  if auth.uid() is not null and p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'insufficient_privilege: cannot sync events for another user' using errcode = '42501';
  end if;
  v_skew := case when p_client_sent_at is null then null else (extract(epoch from (p_client_sent_at - now())) * 1000)::integer end;

  -- Serialise sync batches per user for the rest of this transaction (released at commit/rollback).
  perform pg_advisory_xact_lock(hashtext('apply_sync_events'), hashtext(v_user::text));

  foreach v_ev in array p_events loop
    v_res := 'applied'; v_reason := null; v_xp := null; v_db := true; v_applied_at := now();
    begin
      v_event_id := (v_ev ->> 'clientEventId')::uuid;
      v_enrollment := nullif(v_ev ->> 'enrollmentId', '')::uuid;
      v_device := coalesce(nullif(v_ev ->> 'deviceId', ''), 'unknown');
      v_revision := coalesce((v_ev ->> 'revision')::integer, 0);
      v_occurred := coalesce((v_ev ->> 'occurredAt')::timestamptz, now());
      v_payload := coalesce(v_ev -> 'payload', '{}'::jsonb);
      v_type := coalesce(v_payload ->> 'type', 'unknown');
    exception when others then
      -- Malformed envelope: nothing to key the ledger on; report and continue.
      client_event_id := null; resolution := 'rejected'; reason := 'malformed_event: ' || sqlerrm; xp_credited := null; handled_in_db := true;
      return next;
      continue;
    end;

    if exists (select 1 from public.device_sync_events d where d.user_id = v_user and d.client_event_id = v_event_id) then
      client_event_id := v_event_id; resolution := 'duplicate'; reason := null; xp_credited := case when v_type = 'xp_claim' then 0 else null end; handled_in_db := true;
      return next;
      continue;
    end if;

    begin
      if v_enrollment is not null and not exists (select 1 from public.user_course_enrollments e where e.id = v_enrollment and e.user_id = v_user) then
        raise exception 'enrollment_not_owned';
      end if;

      case v_type
        when 'audio_progress' then
          select p.revision into v_existing_rev from public.user_audio_progress p
            where p.user_id = v_user and p.lesson_id = (v_payload ->> 'lessonId')::uuid;
          if v_existing_rev is not null and v_existing_rev > v_revision then
            v_res := 'superseded'; v_reason := 'older_revision';
          else
            insert into public.user_audio_progress (user_id, lesson_id, position_ms, duration_ms, completed, completed_at, play_count, revision, last_client_event_id)
            values (v_user, (v_payload ->> 'lessonId')::uuid, (v_payload ->> 'positionMs')::integer, nullif(v_payload ->> 'durationMs', '')::integer,
                    coalesce((v_payload ->> 'completed')::boolean, false), case when coalesce((v_payload ->> 'completed')::boolean, false) then v_occurred else null end, 1, v_revision, v_event_id)
            on conflict (user_id, lesson_id) do update
              set position_ms = excluded.position_ms,
                  duration_ms = coalesce(excluded.duration_ms, public.user_audio_progress.duration_ms),
                  completed = public.user_audio_progress.completed or excluded.completed,
                  completed_at = coalesce(public.user_audio_progress.completed_at, excluded.completed_at),
                  play_count = public.user_audio_progress.play_count + 1,
                  revision = excluded.revision,
                  last_client_event_id = excluded.last_client_event_id;
          end if;
        when 'bookmark_created' then
          insert into public.bookmarks (user_id, lesson_id, position_ms, note, client_event_id)
          values (v_user, (v_payload ->> 'lessonId')::uuid, (v_payload ->> 'positionMs')::integer, nullif(v_payload ->> 'note', ''), v_event_id)
          on conflict (user_id, client_event_id) do nothing;
        when 'activity_minutes' then
          insert into public.streak_activity (user_id, activity_date, minutes_active, speaking_seconds)
          values (v_user, (v_payload ->> 'activityDate')::date, coalesce((v_payload ->> 'minutesActive')::integer, 0), coalesce((v_payload ->> 'speakingSeconds')::integer, 0))
          on conflict (user_id, activity_date) do update
            set minutes_active = greatest(public.streak_activity.minutes_active, excluded.minutes_active),
                speaking_seconds = greatest(public.streak_activity.speaking_seconds, excluded.speaking_seconds);
        when 'enrollment_opened' then
          update public.user_course_enrollments
            set last_opened_at = greatest(coalesce(last_opened_at, v_occurred), v_occurred)
            where id = (v_payload ->> 'enrollmentId')::uuid and user_id = v_user;
          if not found then raise exception 'enrollment_not_owned'; end if;
        when 'xp_claim' then
          -- Recorded, never paid here: the API Worker validates the reference and awards server-side.
          if public.xp_amount_for_reason(v_payload ->> 'reason') <= 0 then raise exception 'unknown_xp_reason'; end if;
          if nullif(v_payload ->> 'referenceId', '') is null then raise exception 'xp_claim_requires_reference'; end if;
          v_db := false; v_applied_at := null; v_xp := null;
        when 'review_result', 'step_completed', 'mission_abandoned', 'observation' then
          v_db := false; v_applied_at := null;
        else
          v_res := 'rejected'; v_reason := 'unknown_payload_type';
      end case;
    exception when others then
      v_res := 'rejected'; v_reason := sqlerrm; v_xp := null; v_db := true; v_applied_at := now();
    end;

    insert into public.device_sync_events (user_id, device_id, client_event_id, payload_type, payload, revision, client_occurred_at, clock_skew_ms, applied_at, resolution, rejection_reason)
    values (v_user, v_device, v_event_id, v_type, v_ev, v_revision, v_occurred, v_skew, case when v_res = 'applied' then v_applied_at else null end, v_res, case when v_res = 'rejected' then v_reason else null end)
    on conflict (user_id, client_event_id) do nothing;

    client_event_id := v_event_id; resolution := v_res; reason := v_reason; xp_credited := v_xp; handled_in_db := v_db;
    return next;
  end loop;
end;
$$;

/** Marks engine-handled sync events as applied (owner or service role). */
create or replace function public.mark_sync_events_applied(p_client_event_ids uuid[], p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(auth.uid(), p_user_id);
  v_count integer;
begin
  if v_user is null then
    raise exception 'mark_sync_events_applied requires an authenticated user or p_user_id' using errcode = '42501';
  end if;
  update public.device_sync_events
  set applied_at = now()
  where user_id = v_user and client_event_id = any(p_client_event_ids) and resolution = 'applied' and applied_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enrollment source language (§2.1): change ONLY the instruction language
-- ---------------------------------------------------------------------------

/**
 * Updates `source_language_code` of one enrollment and nothing else: no mastery, review, attempt,
 * XP or bookmark row is touched. Owner (or service role) only. Raises `unique_violation` when the
 * user already has an enrollment for the same track with the requested source language.
 */
create or replace function public.set_enrollment_source_language(p_enrollment_id uuid, p_source_language_code text)
returns public.user_course_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_course_enrollments;
begin
  select * into v_row from public.user_course_enrollments where id = p_enrollment_id for update;
  if v_row.id is null then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'P0002';
  end if;
  if auth.uid() is not null and v_row.user_id <> auth.uid() then
    raise exception 'insufficient_privilege: not the owner of enrollment %', p_enrollment_id using errcode = '42501';
  end if;
  if not exists (select 1 from public.languages where code = p_source_language_code) then
    raise exception 'unknown source language %', p_source_language_code using errcode = '22023';
  end if;
  if v_row.source_language_code = p_source_language_code then
    return v_row;
  end if;
  if exists (
    select 1 from public.user_course_enrollments e
    where e.user_id = v_row.user_id and e.course_track_id = v_row.course_track_id
      and e.source_language_code = p_source_language_code and e.id <> v_row.id
  ) then
    raise exception 'an enrollment for % from % already exists', v_row.course_track_id, p_source_language_code using errcode = '23505';
  end if;
  update public.user_course_enrollments
  set source_language_code = p_source_language_code
  where id = p_enrollment_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Due reviews (SECURITY INVOKER: RLS limits learners to their own enrollments)
-- ---------------------------------------------------------------------------
create or replace function public.get_due_reviews(p_enrollment_id uuid, p_limit integer default 20, p_now timestamptz default now())
returns setof public.user_expression_reviews
language sql
stable
security invoker
set search_path = public
as $$
  select r.*
  from public.user_expression_reviews r
  where r.enrollment_id = p_enrollment_id
    and r.next_due_at <= coalesce(p_now, now())
  order by r.next_due_at asc, r.retrievability asc
  limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;

-- ---------------------------------------------------------------------------
-- Grants: who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.enqueue_processing_job(text, text, jsonb, uuid, text, uuid, integer, uuid, text, integer) from public, anon;
revoke all on function public.claim_processing_job(text, text[], integer) from public, anon, authenticated;
revoke all on function public.requeue_expired_jobs(integer) from public, anon, authenticated;
revoke all on function public.xp_reference_owned(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.heartbeat_processing_job(uuid, text, double precision, integer) from public, anon, authenticated;
revoke all on function public.complete_processing_job(uuid, text, jsonb, uuid[], numeric) from public, anon, authenticated;
revoke all on function public.fail_processing_job(uuid, text, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.award_xp(uuid, uuid, integer, text, uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.xp_amount_for_reason(text) from public, anon;
revoke all on function public.user_total_xp(uuid) from public, anon;
revoke all on function public.apply_sync_events(jsonb[], uuid, timestamptz) from public, anon;
revoke all on function public.mark_sync_events_applied(uuid[], uuid) from public, anon;
revoke all on function public.set_enrollment_source_language(uuid, text) from public, anon;
revoke all on function public.get_due_reviews(uuid, integer, timestamptz) from public, anon;

grant execute on function public.enqueue_processing_job(text, text, jsonb, uuid, text, uuid, integer, uuid, text, integer) to authenticated, service_role;
grant execute on function public.claim_processing_job(text, text[], integer) to service_role;
grant execute on function public.requeue_expired_jobs(integer) to service_role;
grant execute on function public.heartbeat_processing_job(uuid, text, double precision, integer) to service_role;
grant execute on function public.complete_processing_job(uuid, text, jsonb, uuid[], numeric) to service_role;
grant execute on function public.fail_processing_job(uuid, text, text, text, boolean, integer) to service_role;
grant execute on function public.award_xp(uuid, uuid, integer, text, uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.xp_reference_owned(uuid, text, uuid) to service_role;
grant execute on function public.xp_amount_for_reason(text) to authenticated, service_role;
grant execute on function public.user_total_xp(uuid) to authenticated, service_role;
grant execute on function public.apply_sync_events(jsonb[], uuid, timestamptz) to authenticated, service_role;
grant execute on function public.mark_sync_events_applied(uuid[], uuid) to authenticated, service_role;
grant execute on function public.set_enrollment_source_language(uuid, text) to authenticated, service_role;
grant execute on function public.get_due_reviews(uuid, integer, timestamptz) to authenticated, service_role;
