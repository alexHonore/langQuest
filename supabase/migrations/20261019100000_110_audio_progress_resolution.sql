-- ---------------------------------------------------------------------------
-- 110: listening-position conflict resolution (§4.5 "monotonic/revision metadata; account for clock skew").
--
-- Before this migration `apply_sync_events` compared the incoming event's `revision` with the stored
-- `user_audio_progress.revision` regardless of WHICH device produced either number. Revisions are
-- per-device counters (and the mobile outbox even stamped its device-wide sequence on audio events),
-- so a second device's genuinely newer position lost to a first device's higher counter and was
-- reported `superseded` while the server kept the stale position.
--
-- Rule now applied by `public.apply_audio_progress` (used by BOTH the `PUT /v1/me/audio-progress/:lessonId`
-- path and the batch sync path, which share `apply_sync_events`):
--   1. no row yet                                            → applied
--   2. same client_event_id as the stored row                → duplicate (defensive; the ledger dedupes first)
--   3. same device as the last writer                        → per-device revision decides
--                                                              (stored.revision > incoming → superseded/older_revision)
--   4. different device (or unknown last writer)             → wall-clock decides, with the incoming
--                                                              `occurredAt` corrected by the batch's clock skew
--                                                              and capped at now() (stored.last_occurred_at >
--                                                              incoming effective time → superseded/older_event)
-- `completed` stays sticky: a superseded event that says the lesson was finished still marks it finished
-- (progress is never lost to replay, §4.5), only the position is kept from the newer write.
-- ---------------------------------------------------------------------------

alter table public.user_audio_progress
  add column if not exists last_device_id text null,
  add column if not exists last_occurred_at timestamptz null;
comment on column public.user_audio_progress.last_device_id is
  'Device that produced the stored position; revision comparisons only apply against the same device (migration 110).';
comment on column public.user_audio_progress.last_occurred_at is
  'Skew-corrected client time of the stored position (never after the server now()); cross-device ordering key (migration 110).';

/**
 * Applies one listening-position write and reports how it was resolved (`applied`, `superseded`, `duplicate`)
 * with a machine-readable reason. Internal: only `apply_sync_events` calls it.
 */
create or replace function public.apply_audio_progress(
  p_user_id uuid,
  p_lesson_id uuid,
  p_device_id text,
  p_revision integer,
  p_occurred_at timestamptz,
  p_clock_skew_ms integer,
  p_position_ms integer,
  p_duration_ms integer,
  p_completed boolean,
  p_client_event_id uuid
)
returns table (resolution text, reason text)
language plpgsql
set search_path = public
as $$
declare
  v_effective timestamptz;
  v_existing public.user_audio_progress%rowtype;
  v_res text := 'applied';
  v_reason text := null;
begin
  -- Server-normalised event time: undo the estimated client clock skew, never trust a future timestamp.
  v_effective := least(p_occurred_at - make_interval(secs => coalesce(p_clock_skew_ms, 0) / 1000.0), now());

  select * into v_existing from public.user_audio_progress p
    where p.user_id = p_user_id and p.lesson_id = p_lesson_id
    for update;

  if found then
    if v_existing.last_client_event_id = p_client_event_id then
      v_res := 'duplicate'; v_reason := 'same_client_event';
    elsif v_existing.last_device_id is not null and v_existing.last_device_id = p_device_id then
      if v_existing.revision > p_revision then
        v_res := 'superseded'; v_reason := 'older_revision';
      end if;
    elsif v_existing.last_occurred_at is not null and v_existing.last_occurred_at > v_effective then
      v_res := 'superseded'; v_reason := 'older_event';
    end if;
  end if;

  if v_res = 'applied' then
    insert into public.user_audio_progress
      (user_id, lesson_id, position_ms, duration_ms, completed, completed_at, play_count, revision, last_client_event_id, last_device_id, last_occurred_at)
    values
      (p_user_id, p_lesson_id, p_position_ms, p_duration_ms, p_completed, case when p_completed then v_effective else null end, 1, p_revision, p_client_event_id, p_device_id, v_effective)
    on conflict (user_id, lesson_id) do update
      set position_ms = excluded.position_ms,
          duration_ms = coalesce(excluded.duration_ms, public.user_audio_progress.duration_ms),
          completed = public.user_audio_progress.completed or excluded.completed,
          completed_at = coalesce(public.user_audio_progress.completed_at, excluded.completed_at),
          play_count = public.user_audio_progress.play_count + 1,
          revision = excluded.revision,
          last_client_event_id = excluded.last_client_event_id,
          last_device_id = excluded.last_device_id,
          last_occurred_at = excluded.last_occurred_at;
  elsif v_res = 'superseded' and p_completed and not v_existing.completed then
    -- Completion is a monotonic fact; keep the newer position but never drop a finished lesson.
    update public.user_audio_progress
      set completed = true, completed_at = coalesce(completed_at, v_effective)
      where id = v_existing.id;
  end if;

  resolution := v_res; reason := v_reason;
  return next;
end;
$$;
revoke all on function public.apply_audio_progress(uuid, uuid, text, integer, timestamptz, integer, integer, integer, boolean, uuid) from public, anon, authenticated, service_role;

/**
 * Applies a batch of `ProgressSyncEvent` objects (camelCase keys as sent by the client) idempotently.
 * Each event is recorded once in `device_sync_events`; duplicates return `duplicate` and never
 * re-apply. The whole batch runs under a per-user, transaction-scoped advisory lock, so two devices
 * replaying the same clientEventId at the same time are serialised: exactly one sees `applied`, the
 * other `duplicate`, and no side effect (play_count, streak minutes…) is applied twice (§4.5, A27).
 * DB-applied payload types: audio_progress (via `apply_audio_progress`, device-aware + clock-skew
 * corrected since migration 110), bookmark_created, activity_minutes, enrollment_opened.
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
          select r.resolution, r.reason into v_res, v_reason
            from public.apply_audio_progress(
              v_user, (v_payload ->> 'lessonId')::uuid, v_device, v_revision, v_occurred, v_skew,
              (v_payload ->> 'positionMs')::integer, nullif(v_payload ->> 'durationMs', '')::integer,
              coalesce((v_payload ->> 'completed')::boolean, false), v_event_id) r;
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
-- Grants are unchanged by CREATE OR REPLACE (authenticated + service_role, migration 060).
