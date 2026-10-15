-- ---------------------------------------------------------------------------
-- 100: cross-package gaps reported by the app builders (docs/reference/cross-package-gaps.md,
-- 2026-10-15). Everything here is ADDITIVE or LOOSENING so existing app code keeps working:
--
--   1. processing_job_type gains the handler names apps/jobs runs under a carrier type today.
--   2. media_assets.storage_key is no longer UNIQUE: several logical assets may share one physical
--      blob (§7.2); a plain index keeps lookups fast. Dedupe rule documented in ADR-003.
--   3. Append-only ledgers honour a transaction-scoped bypass that ONLY SECURITY DEFINER account
--      lifecycle functions set (`langquest.account_deletion`), so delete_account / purge_test_user
--      can anonymise or purge evidence rows while every other path stays append-only.
--   4. public.delete_account(p_user_id, p_delete_opt_in_recordings) — service-role only (A28).
--   5. public.purge_test_user(p_user_id) — service-role only, @langquest.test accounts only.
--   6. Stored manifests (ADR-004): course_manifests + audio_collection_manifests.
--   7. AI metadata suggestions (§7.4): asset_suggestions with staff RLS.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. processing_job_type: dedicated values for every apps/jobs handler
--    (translate_transcript, regenerate_manifest, cleanup_orphan_uploads previously rode on `describe`
--    + params.handler; render_cover / infer_metadata / generate_content / import_r2_prefix are the
--    handler names for generate_cover / describe / content_generate / import_prefix and are accepted
--    as aliases so the runner can enqueue by handler name). Old values stay valid.
-- ---------------------------------------------------------------------------
alter domain public.processing_job_type drop constraint processing_job_type_check;
alter domain public.processing_job_type add constraint processing_job_type_check
  check (value in (
    'verify','extract_metadata','transcode','transcribe','align','detect_language','describe','segment_lessons',
    'generate_cover','import_prefix','import_manifest','content_generate','benchmark_model','image_generate',
    -- added 2026-10-15 (apps/jobs handler names)
    'translate_transcript','regenerate_manifest','cleanup_orphan_uploads','render_cover','infer_metadata',
    'generate_content','import_r2_prefix'
  ));

-- ---------------------------------------------------------------------------
-- 2. Physical blob vs logical asset (§7.2)
--    A media_assets row is a LOGICAL asset (rights, state, visibility, lesson links); the blob is
--    identified by (bucket, storage_key) and its content by checksum_sha256. Importers that meet a
--    blob they already know create a NEW row pointing at the SAME storage_key instead of relinking
--    the first row (dedupe rule in ADR-003 §7). The master-key shape check stays (it names the first
--    asset's id, which is fine: keys are opaque, never derived from the row they live on).
-- ---------------------------------------------------------------------------
alter table public.media_assets drop constraint if exists media_assets_storage_key_key;
create index if not exists media_assets_storage_key_idx on public.media_assets(storage_key);
create index if not exists media_assets_bucket_key_idx on public.media_assets(bucket, storage_key);
create index if not exists media_assets_owner_idx on public.media_assets(owner_id) where owner_id is not null;
create index if not exists media_assets_legacy_path_idx on public.media_assets(legacy_path) where legacy_path is not null;
comment on column public.media_assets.storage_key is
  'Object key of the physical blob. NOT unique since migration 100: several logical assets may point at one blob (§7.2, ADR-003 §7).';

-- ---------------------------------------------------------------------------
-- 3. Append-only bypass, honoured only inside the account lifecycle functions below.
--    The flag is a transaction-local GUC that no RPC exposes to JWT roles; the guard additionally
--    requires the current role to be the function owner (never anon/authenticated/service_role
--    hitting a table directly through PostgREST).
-- ---------------------------------------------------------------------------
/** True only while delete_account()/purge_test_user() run (transaction-local GUC set by them). */
create or replace function public.account_deletion_in_progress()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('langquest.account_deletion', true), '') <> ''
     and current_user not in ('anon', 'authenticated', 'service_role');
$$;
revoke all on function public.account_deletion_in_progress() from public;
grant execute on function public.account_deletion_in_progress() to anon, authenticated, service_role;

/** Append-only guard for ledgers: rejects UPDATE/DELETE unless the account-deletion bypass is active. */
create or replace function public.raise_append_only()
returns trigger
language plpgsql
as $$
begin
  if public.account_deletion_in_progress() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'table % is append-only', tg_table_name using errcode = 'check_violation';
end;
$$;

/** device_sync_events: only applied_at/resolution may change after insert — except under the deletion bypass. */
create or replace function public.guard_sync_event_update()
returns trigger language plpgsql as $$
begin
  if public.account_deletion_in_progress() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'device_sync_events is append-only' using errcode = 'check_violation';
  end if;
  if new.user_id <> old.user_id or new.client_event_id <> old.client_event_id or new.payload <> old.payload
     or new.payload_type <> old.payload_type or new.revision <> old.revision or new.device_id <> old.device_id then
    raise exception 'device_sync_events rows are immutable except applied_at/resolution' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. delete_account (A28) — service role only.
--    Policy (mirrors the learner-facing disclosure in apps/api `DELETE /v1/me`):
--      * deleted   : every user-owned row (profile, settings, enrollments and everything keyed by them,
--                    audio state, uploads, sessions + turns, mastery/reviews/attempts/progress,
--                    achievements, streaks, daily metrics, notification settings/deliveries, roles)
--                    and the evidence ledgers that are the learner's own data
--                    (xp_ledger, device_sync_events, learning_observations, conversation_turns);
--      * anonymised: ledgers kept for cost accounting / audit / safety with the user reference removed
--                    (ai_requests, audit_logs, asset_provenance_events, moderation_incidents,
--                    feedback_reports, processing_jobs.requested_by);
--      * recordings: media_assets owned by the learner are marked deleted (+ provenance event) when
--                    p_delete_opt_in_recordings, else just de-owned; the API removes the objects.
--      * retained  : content_revisions / publication_events authored by a STAFF account keep their
--                    NOT NULL editor attribution — the auth.users row then cannot be deleted
--                    (`authUserDeletable = false`); offboard staff by revoking roles instead.
--    The auth.users row itself is deleted afterwards by the API with `auth.admin.deleteUser`
--    (documented in ADR-003 §7); this function makes that cascade trivially succeed.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account(
  p_user_id uuid,
  p_delete_opt_in_recordings boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted text[] := '{}';
  v_anonymised text[] := '{}';
  v_retained text[] := '{}';
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_recordings integer := 0;
  v_editorial integer := 0;
  v_asset record;
  v_summary jsonb;
begin
  if auth.uid() is not null then
    raise exception 'delete_account is callable by the service role only' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  -- Transaction-local bypass for the append-only triggers (see account_deletion_in_progress()).
  perform set_config('langquest.account_deletion', p_user_id::text, true);

  -- ---- learner-owned recordings / media -------------------------------------------------------
  if p_delete_opt_in_recordings then
    for v_asset in
      select id from public.media_assets where owner_id = p_user_id and disposition <> 'deleted'
    loop
      insert into public.asset_provenance_events (asset_id, event_type, actor_id, job_id, details)
      values (v_asset.id, 'removed', null, null,
              jsonb_build_object('action', 'account_deletion', 'reason', 'learner_requested_recording_deletion'));
      v_recordings := v_recordings + 1;
    end loop;
    update public.media_assets
       set disposition = 'deleted', owner_id = null, visibility = 'private'
     where owner_id = p_user_id;
    v_deleted := array_append(v_deleted, 'media_assets (learner recordings: disposition=deleted, provenance event recorded; objects removed by the API)');
  else
    update public.media_assets set owner_id = null where owner_id = p_user_id;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_retained := array_append(v_retained, 'media_assets (learner chose to keep recordings; owner reference removed)');
    end if;
  end if;
  v_counts := v_counts || jsonb_build_object('media_assets', v_recordings);

  -- ---- evidence ledgers that are the learner's own data: deleted ------------------------------
  delete from public.conversation_turns
   where session_id in (select id from public.conversation_sessions where user_id = p_user_id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('conversation_turns', v_n);
  delete from public.learning_observations where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learning_observations', v_n);
  delete from public.xp_ledger where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('xp_ledger', v_n);
  delete from public.device_sync_events where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('device_sync_events', v_n);
  delete from public.notification_deliveries where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notification_deliveries', v_n);
  v_deleted := v_deleted || array['conversation_turns', 'learning_observations', 'xp_ledger', 'device_sync_events', 'notification_deliveries'];

  -- ---- retained ledgers: user reference removed -----------------------------------------------
  update public.ai_requests set user_id = null, enrollment_id = null where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ai_requests', v_n);
  update public.audit_logs set actor_id = null, ip_hash = null where actor_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('audit_logs', v_n);
  update public.asset_provenance_events set actor_id = null where actor_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('asset_provenance_events', v_n);
  update public.moderation_incidents set user_id = null where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('moderation_incidents', v_n);
  update public.feedback_reports set user_id = null, enrollment_id = null where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('feedback_reports', v_n);
  update public.processing_jobs set requested_by = null where requested_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('processing_jobs', v_n);
  v_anonymised := v_anonymised || array['ai_requests', 'audit_logs', 'asset_provenance_events', 'moderation_incidents', 'feedback_reports', 'processing_jobs (requested_by cleared)'];
  v_retained := v_retained || array[
    'audit_logs (actor anonymised, 5-year retention)',
    'ai_requests (pseudonymous cost ledger, user reference removed)',
    'moderation_incidents (safety record, user reference removed)'
  ];

  -- ---- user-owned rows: deleted explicitly (so the function is complete even before auth.users goes)
  delete from public.mission_attempts where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mission_attempts', v_n);
  delete from public.mission_progress where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mission_progress', v_n);
  delete from public.user_skill_mastery where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('user_skill_mastery', v_n);
  delete from public.user_expression_reviews where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('user_expression_reviews', v_n);
  delete from public.user_achievements where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('user_achievements', v_n);
  delete from public.streak_activity where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('streak_activity', v_n);
  delete from public.daily_learning_metrics where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('daily_learning_metrics', v_n);
  delete from public.character_relationship_memory where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('character_relationship_memory', v_n);
  delete from public.conversation_sessions where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('conversation_sessions', v_n);
  delete from public.bookmarks where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('bookmarks', v_n);
  delete from public.user_audio_progress where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('user_audio_progress', v_n);
  delete from public.user_download_manifests where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('user_download_manifests', v_n);
  delete from public.uploads where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('uploads', v_n);
  delete from public.notification_settings where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notification_settings', v_n);
  delete from public.user_roles where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('user_roles', v_n);
  delete from public.user_course_enrollments where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('user_course_enrollments', v_n);
  delete from public.account_settings where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('account_settings', v_n);
  delete from public.profiles where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('profiles', v_n);
  v_deleted := v_deleted || array[
    'mission_attempts', 'mission_progress', 'user_skill_mastery', 'user_expression_reviews', 'user_achievements', 'streak_activity',
    'daily_learning_metrics', 'character_relationship_memory', 'conversation_sessions', 'bookmarks', 'user_audio_progress',
    'user_download_manifests', 'uploads', 'notification_settings', 'user_roles', 'user_course_enrollments', 'account_settings', 'profiles'
  ];

  -- ---- staff editorial attribution cannot be dropped (NOT NULL, on delete restrict) -------------
  select (select count(*) from public.content_revisions where editor_id = p_user_id)
       + (select count(*) from public.publication_events where actor_id = p_user_id)
    into v_editorial;
  v_counts := v_counts || jsonb_build_object('editorial_rows', v_editorial);
  if v_editorial > 0 then
    v_retained := array_append(v_retained, 'content_revisions / publication_events (editorial attribution of a staff account; the auth.users row cannot be deleted — revoke roles to offboard)');
  end if;

  v_summary := jsonb_build_object(
    'userId', p_user_id,
    'deletedTables', to_jsonb(v_deleted),
    'anonymisedTables', to_jsonb(v_anonymised),
    'retainedForLegalReasons', to_jsonb(v_retained),
    'recordingsDeleted', v_recordings,
    'authUserDeletable', v_editorial = 0,
    'counts', v_counts,
    'deletedAt', now()
  );

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, after)
  values (null, 'service', 'account.delete_account', 'auth.users', p_user_id::text,
          (v_summary - 'counts') || jsonb_build_object('deleteOptInRecordings', p_delete_opt_in_recordings));

  -- Close the bypass before returning: the GUC is transaction-local, but a caller that batches more
  -- statements into the same transaction must find the ledgers append-only again.
  perform set_config('langquest.account_deletion', '', true);
  return v_summary;
end;
$$;
revoke all on function public.delete_account(uuid, boolean) from public, anon, authenticated;
grant execute on function public.delete_account(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. purge_test_user — service role only; refuses anything but an @langquest.test account.
--    Runs delete_account(…, true), drops the test account's editorial rows (test data only) and
--    deletes the auth.users row itself so local/CI suites can clean up learners with ledger rows.
-- ---------------------------------------------------------------------------
create or replace function public.purge_test_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_summary jsonb;
begin
  if auth.uid() is not null then
    raise exception 'purge_test_user is callable by the service role only' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'unknown user %', p_user_id using errcode = 'P0002';
  end if;
  if lower(v_email) !~ '@langquest\.test$' then
    raise exception 'purge_test_user only purges @langquest.test accounts' using errcode = '42501';
  end if;
  v_summary := public.delete_account(p_user_id, true);
  -- Test accounts may have authored editorial rows; they are test data and go with the account.
  perform set_config('langquest.account_deletion', p_user_id::text, true);
  delete from public.content_revisions where editor_id = p_user_id;
  delete from public.publication_events where actor_id = p_user_id;
  delete from auth.users where id = p_user_id;
  perform set_config('langquest.account_deletion', '', true);
  return v_summary || jsonb_build_object('authUserDeleted', true, 'authUserDeletable', true);
end;
$$;
revoke all on function public.purge_test_user(uuid) from public, anon, authenticated;
grant execute on function public.purge_test_user(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Stored manifests (ADR-004). One row per (track, source, version) / (collection, instruction
--    language, version); `manifest` is the exact JSON the API serves (CourseManifest /
--    AudioCollectionManifest from @langquest/contracts) and `checksum` its content hash.
--    Learners read published versions; editors/jobs write. The API serves the highest published
--    version (`*_manifests_latest_idx`).
-- ---------------------------------------------------------------------------
create table public.course_manifests (
  id uuid primary key default gen_random_uuid(),
  course_track_id text not null references public.course_tracks(id) on delete cascade,
  source_language_code text not null references public.languages(code) on delete restrict,
  version integer not null check (version >= 0),
  checksum public.sha256_hex not null,
  manifest jsonb not null,
  published_at timestamptz null,
  generated_by_job_id uuid null references public.processing_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_track_id, source_language_code, version)
);
create index course_manifests_latest_idx on public.course_manifests(course_track_id, source_language_code, version desc)
  where published_at is not null;
select public.attach_updated_at('public.course_manifests');

create table public.audio_collection_manifests (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.audio_course_collections(id) on delete cascade,
  /** Instruction (source) language the manifest was built for, or 'any' (collection-wide). */
  instruction_language_code text not null default 'any'
    check (instruction_language_code = 'any' or instruction_language_code ~ '^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  version integer not null check (version >= 0),
  checksum public.sha256_hex not null,
  manifest jsonb not null,
  published_at timestamptz null,
  generated_by_job_id uuid null references public.processing_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, instruction_language_code, version)
);
create index audio_collection_manifests_latest_idx on public.audio_collection_manifests(collection_id, instruction_language_code, version desc)
  where published_at is not null;
select public.attach_updated_at('public.audio_collection_manifests');

alter table public.course_manifests enable row level security;
alter table public.audio_collection_manifests enable row level security;
create policy learner_select on public.course_manifests for select to authenticated
  using (published_at is not null or public.is_staff());
create policy learner_select on public.audio_collection_manifests for select to authenticated
  using (published_at is not null or public.is_staff());
do $$
declare t text;
begin
  foreach t in array array['course_manifests','audio_collection_manifests'] loop
    execute format('create policy editor_insert on public.%I for insert to authenticated with check (public.is_content_editor())', t);
    execute format('create policy editor_update on public.%I for update to authenticated using (public.is_content_editor()) with check (public.is_content_editor())', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using (public.is_content_editor())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. AI metadata / organisation suggestions (§7.4). Never auto-applied: an editor approves or
--    rejects each suggestion; `provenance` records task, model, prompt version and trace id so the
--    decision is auditable. Learners never see this table.
-- ---------------------------------------------------------------------------
create table public.asset_suggestions (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  lesson_id uuid null references public.audio_lessons(id) on delete set null,
  job_id uuid null references public.processing_jobs(id) on delete set null,
  kind text not null check (kind in ('metadata','language','variety','lesson_structure','description','tags','topics','level','cover','transcript_quality','other')),
  suggestion jsonb not null default '{}'::jsonb,
  confidence public.unit_interval null,
  /** {task, provider, model, promptVersion, traceId, jobId, evidenceSource, generatedAt} — never prompts with learner data. */
  provenance jsonb not null default '{}'::jsonb,
  review_status public.review_status not null default 'review_needed',
  reviewer_id uuid null references auth.users(id) on delete set null,
  decided_at timestamptz null,
  decision_note text null check (decision_note is null or char_length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index asset_suggestions_asset_idx on public.asset_suggestions(media_asset_id, created_at desc);
create index asset_suggestions_pending_idx on public.asset_suggestions(review_status, created_at)
  where review_status in ('draft','review_needed','in_review');
create index asset_suggestions_job_idx on public.asset_suggestions(job_id) where job_id is not null;
create index asset_suggestions_lesson_idx on public.asset_suggestions(lesson_id) where lesson_id is not null;
select public.attach_updated_at('public.asset_suggestions');

/** Stamps reviewer_id/decided_at when a suggestion is approved or rejected (and clears them when reopened). */
create or replace function public.stamp_asset_suggestion_decision()
returns trigger language plpgsql as $$
begin
  if new.review_status in ('approved', 'rejected') then
    if tg_op = 'INSERT' or new.review_status is distinct from old.review_status then
      new.decided_at := coalesce(new.decided_at, now());
      new.reviewer_id := coalesce(new.reviewer_id, auth.uid());
    end if;
  elsif tg_op = 'UPDATE' and old.review_status in ('approved', 'rejected') then
    new.decided_at := null;
  end if;
  return new;
end;
$$;
create trigger stamp_asset_suggestion_decision before insert or update on public.asset_suggestions
  for each row execute function public.stamp_asset_suggestion_decision();

alter table public.asset_suggestions enable row level security;
create policy staff_select on public.asset_suggestions for select to authenticated using (public.is_staff());
create policy editor_insert on public.asset_suggestions for insert to authenticated with check (public.is_content_editor());
create policy reviewer_update on public.asset_suggestions for update to authenticated
  using (public.is_language_reviewer()) with check (public.is_language_reviewer());
create policy editor_delete on public.asset_suggestions for delete to authenticated using (public.is_content_editor());

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
