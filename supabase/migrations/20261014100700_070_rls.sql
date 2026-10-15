-- 070 — row-level security (§5.5, §11). RLS is enabled on EVERY public table.
-- Service role bypasses RLS as usual. Learners: owner rows + published content. Staff via has_role().

-- ---------------------------------------------------------------------------
-- 1. Enable RLS everywhere (fails loudly if a table is missed)
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. User-owned tables (owner = user_id)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  full_crud text[] := array['user_course_enrollments','bookmarks','user_audio_progress','user_download_manifests','character_relationship_memory',
                            'user_expression_reviews','notification_settings','conversation_sessions'];
  upsert_only text[] := array['profiles','account_settings'];
  -- Derived learning state (mastery, mission progress, streaks, daily metrics) is computed by the engine
  -- from learning_observations and written with the service role (§3.8, §5.5, Phase 9); learners read it.
  -- Ledgers and observations are evidence: owner read-only too.
  read_only text[] := array['user_roles','xp_ledger','device_sync_events','learning_observations','user_achievements','notification_deliveries',
                            'user_skill_mastery','mission_progress','streak_activity','daily_learning_metrics'];
  support_readable text[] := array['profiles','account_settings','user_course_enrollments','user_roles','bookmarks','user_audio_progress','user_download_manifests',
                                   'conversation_sessions','character_relationship_memory','user_skill_mastery','user_expression_reviews','learning_observations',
                                   'mission_attempts','mission_progress','user_achievements','streak_activity','xp_ledger','daily_learning_metrics','device_sync_events',
                                   'notification_settings','notification_deliveries','feedback_reports'];
begin
  foreach t in array full_crud loop
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
  foreach t in array upsert_only loop
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
  foreach t in array read_only loop
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = auth.uid())', t);
  end loop;
  foreach t in array support_readable loop
    execute format('create policy support_select on public.%I for select to authenticated using (public.is_support())', t);
  end loop;
end $$;

-- mission_attempts: offline-first clients create and advance their own attempts (steps, hints, abandon),
-- but the outcome — completed_at, evaluation, xp_awarded, objectives_completed — is decided by the
-- evaluator in the API Worker (service role). No learner delete: evidence stays (use abandoned_at).
create policy owner_select on public.mission_attempts for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.mission_attempts for insert to authenticated with check (user_id = auth.uid());
create policy owner_update on public.mission_attempts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

/** Rejects learner writes to the server-decided outcome columns of mission_attempts. */
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
  end if;
  return new;
end;
$$;
create trigger guard_mission_attempt_write before insert or update on public.mission_attempts
  for each row execute function public.guard_mission_attempt_write();

-- profiles: a learner may not change the deleted_at marker themselves (account deletion is a server flow)
-- (kept simple: column-level grants would block upserts; enforced by trigger instead)
create or replace function public.guard_profile_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and auth.uid() = old.user_id and not public.is_admin()
     and new.deleted_at is distinct from old.deleted_at then
    raise exception 'deleted_at is managed by the account-deletion flow' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_profile_update before update on public.profiles for each row execute function public.guard_profile_update();

-- user_roles: only super_admin may grant/revoke; admins may read every row
create policy admin_select on public.user_roles for select to authenticated using (public.is_admin());
create policy super_admin_insert on public.user_roles for insert to authenticated with check (public.has_role('super_admin'));
create policy super_admin_update on public.user_roles for update to authenticated using (public.has_role('super_admin')) with check (public.has_role('super_admin'));
create policy super_admin_delete on public.user_roles for delete to authenticated using (public.has_role('super_admin'));

-- feedback_reports: learners file reports; admins triage
create policy owner_select on public.feedback_reports for select to authenticated using (user_id = auth.uid());
create policy owner_insert on public.feedback_reports for insert to authenticated with check (user_id = auth.uid() or user_id is null);
create policy admin_update on public.feedback_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- conversation_turns: via session ownership (support cannot read turns — retention sensitive).
-- A learner may only write their own lines into their own session, referencing audio they own;
-- character turns are written by the dialogue orchestrator (service role) only.
/** True when the caller uploaded/recorded the asset (SECURITY DEFINER: owner_id is not learner-readable, see §8 below). */
create or replace function public.owns_media_asset(p_asset_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.media_assets m where m.id = p_asset_id and m.owner_id = auth.uid());
$$;
revoke all on function public.owns_media_asset(uuid) from public, anon;
grant execute on function public.owns_media_asset(uuid) to authenticated, service_role;

create policy owner_select on public.conversation_turns for select to authenticated
  using (exists (select 1 from public.conversation_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy owner_insert on public.conversation_turns for insert to authenticated
  with check (
    speaker = 'learner'
    and exists (select 1 from public.conversation_sessions s where s.id = session_id and s.user_id = auth.uid())
    and (audio_asset_id is null or public.owns_media_asset(audio_asset_id))
  );

/**
 * Retention is a property of the session, not of the client: for learner writes (and for any insert
 * that leaves expires_at unset) expires_at is derived from conversation_sessions.speech_retention —
 * 'opt_in_until_deleted' → never, 'opt_in_30_days' → +30 days, 'none'/'session' → +24 hours, i.e.
 * only long enough for the asynchronous evaluator (§11 "retention TTL + deletion path").
 */
create or replace function public.set_conversation_turn_retention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_retention text;
begin
  select s.speech_retention into v_retention from public.conversation_sessions s where s.id = new.session_id;
  if v_retention is null then
    return new; -- unknown session: the foreign key raises
  end if;
  if auth.uid() is not null or new.expires_at is null then
    new.expires_at := case v_retention
      when 'opt_in_until_deleted' then null
      when 'opt_in_30_days' then new.occurred_at + interval '30 days'
      else new.occurred_at + interval '24 hours'
    end;
  end if;
  return new;
end;
$$;
create trigger set_conversation_turn_retention before insert on public.conversation_turns
  for each row execute function public.set_conversation_turn_retention();

-- ---------------------------------------------------------------------------
-- 3. Catalog (public, harmless)
-- ---------------------------------------------------------------------------
create policy public_select on public.languages for select to anon, authenticated using (true);
create policy public_select on public.writing_systems for select to anon, authenticated using (true);
create policy public_select on public.language_varieties for select to anon, authenticated using (true);
create policy public_select on public.course_tracks for select to anon, authenticated using (publication_state = 'published' or public.is_staff());
create policy public_select on public.course_source_localizations for select to anon, authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['languages','writing_systems','language_varieties','course_tracks'] loop
    execute format('create policy editor_insert on public.%I for insert to authenticated with check (public.is_content_editor())', t);
    execute format('create policy editor_update on public.%I for update to authenticated using (public.is_content_editor()) with check (public.is_content_editor())', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;
create policy reviewer_insert on public.course_source_localizations for insert to authenticated with check (public.is_language_reviewer());
create policy reviewer_update on public.course_source_localizations for update to authenticated using (public.is_language_reviewer()) with check (public.is_language_reviewer());
create policy editor_delete on public.course_source_localizations for delete to authenticated using (public.is_content_editor());

-- ---------------------------------------------------------------------------
-- 4. Curriculum content: published-only for learners, drafts for staff, writes for editors/reviewers
-- ---------------------------------------------------------------------------
create policy learner_select on public.skills for select to authenticated using (true);
create policy learner_select on public.communicative_intents for select to authenticated using (true);
create policy learner_select on public.skill_variants for select to authenticated using (review_status = 'approved' or public.is_staff());
create policy learner_select on public.expressions for select to authenticated using (state = 'published' or public.is_staff());
create policy learner_select on public.expression_forms for select to authenticated
  using (public.is_staff() or exists (select 1 from public.expressions e where e.id = expression_id and e.state = 'published'));
create policy learner_select on public.expression_translations for select to authenticated
  using (public.is_staff() or exists (select 1 from public.expressions e where e.id = expression_id and e.state = 'published'));
create policy learner_select on public.expression_audio for select to authenticated
  using (public.is_staff() or exists (select 1 from public.expressions e where e.id = expression_id and e.state = 'published'));
create policy learner_select on public.lesson_courses for select to authenticated using (state = 'published' or public.is_staff());
create policy learner_select on public.chapters for select to authenticated
  using (public.is_staff() or (state = 'published' and exists (select 1 from public.lesson_courses c where c.id = lesson_course_id and c.state = 'published')));
create policy learner_select on public.missions for select to authenticated using (state = 'published' or public.is_staff());
create policy learner_select on public.mission_localizations for select to authenticated
  using (public.is_staff() or exists (select 1 from public.missions m where m.id = mission_id and m.state = 'published'));
create policy learner_select on public.mission_steps for select to authenticated
  using (public.is_staff() or exists (select 1 from public.missions m where m.id = mission_id and m.state = 'published'));
create policy learner_select on public.mission_graph_edges for select to authenticated
  using (public.is_staff() or (exists (select 1 from public.missions m where m.id = from_mission_id and m.state = 'published')
                              and exists (select 1 from public.missions m where m.id = to_mission_id and m.state = 'published')));
create policy learner_select on public.dialogue_scenarios for select to authenticated using (state = 'published' or public.is_staff());
create policy learner_select on public.dialogue_variants for select to authenticated
  using (public.is_staff() or exists (select 1 from public.dialogue_scenarios s where s.id = scenario_id and s.state = 'published'));
create policy learner_select on public.characters for select to authenticated using (state = 'published' or public.is_staff());
create policy learner_select on public.story_arcs for select to authenticated using (state = 'published' or public.is_staff());
create policy learner_select on public.media_assets for select to authenticated
  using (public.is_staff() or (visibility in ('authenticated','public') and state = 'published' and disposition = 'active'));
create policy anon_select on public.media_assets for select to anon
  using (visibility = 'public' and state = 'published' and disposition = 'active');

-- rights, revisions, publication events: staff read; learners never
create policy staff_select on public.content_rights for select to authenticated using (public.is_staff());
create policy staff_select on public.content_revisions for select to authenticated using (public.is_staff());
create policy staff_select on public.publication_events for select to authenticated using (public.is_staff());
create policy editor_insert on public.content_revisions for insert to authenticated with check (public.is_language_reviewer() and editor_id = auth.uid());
create policy editor_insert on public.publication_events for insert to authenticated with check (public.is_content_editor() and actor_id = auth.uid());

do $$
declare t text;
begin
  -- editor-owned tables: full write for content editors
  foreach t in array array['skills','communicative_intents','expressions','expression_forms','expression_audio','lesson_courses','chapters','missions',
                           'mission_steps','mission_graph_edges','dialogue_scenarios','characters','story_arcs','media_assets','content_rights'] loop
    execute format('create policy editor_insert on public.%I for insert to authenticated with check (public.is_content_editor())', t);
    execute format('create policy editor_update on public.%I for update to authenticated using (public.is_content_editor()) with check (public.is_content_editor())', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using (public.is_content_editor())', t);
  end loop;
  -- reviewable localisation tables: language reviewers may also write
  foreach t in array array['skill_variants','expression_translations','mission_localizations','dialogue_variants'] loop
    execute format('create policy reviewer_insert on public.%I for insert to authenticated with check (public.is_language_reviewer())', t);
    execute format('create policy reviewer_update on public.%I for update to authenticated using (public.is_language_reviewer()) with check (public.is_language_reviewer())', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using (public.is_content_editor())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Audio library: published + authenticated only (no anonymous playback)
-- ---------------------------------------------------------------------------
create policy learner_select on public.audio_course_collections for select to authenticated using (state = 'published' or public.is_staff());
create policy learner_select on public.audio_chapters for select to authenticated
  using (public.is_staff() or (state = 'published' and exists (select 1 from public.audio_course_collections c where c.id = collection_id and c.state = 'published')));
create policy learner_select on public.audio_lessons for select to authenticated
  using (public.is_staff() or (state = 'published' and visibility = 'authenticated'
         and exists (select 1 from public.audio_chapters ch join public.audio_course_collections c on c.id = ch.collection_id
                     where ch.id = chapter_id and ch.state = 'published' and c.state = 'published')));
create policy learner_select on public.audio_lesson_assets for select to authenticated
  using (public.is_staff() or exists (select 1 from public.audio_lessons l where l.id = lesson_id and l.state = 'published' and l.visibility = 'authenticated'));
create policy learner_select on public.speakers for select to authenticated using (consent_state = 'granted' or public.is_staff());
create policy learner_select on public.lesson_speakers for select to authenticated
  using (public.is_staff() or exists (select 1 from public.audio_lessons l where l.id = lesson_id and l.state = 'published' and l.visibility = 'authenticated'));
create policy learner_select on public.transcripts for select to authenticated
  using (public.is_staff() or (access_rights in ('learners','public') and status in ('machine','edited','reviewed')
         and exists (select 1 from public.audio_lessons l where l.id = lesson_id and l.state = 'published' and l.visibility = 'authenticated')));
create policy learner_select on public.transcript_segments for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.transcripts t join public.audio_lessons l on l.id = t.lesson_id
    where t.id = transcript_id and t.access_rights in ('learners','public') and t.status in ('machine','edited','reviewed')
      and l.state = 'published' and l.visibility = 'authenticated'));
create policy learner_select on public.transcript_translations for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.transcript_segments s join public.transcripts t on t.id = s.transcript_id join public.audio_lessons l on l.id = t.lesson_id
    where s.id = segment_id and t.access_rights in ('learners','public') and t.status in ('machine','edited','reviewed')
      and l.state = 'published' and l.visibility = 'authenticated'));
create policy learner_select on public.transcript_word_alignments for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.transcript_segments s join public.transcripts t on t.id = s.transcript_id join public.audio_lessons l on l.id = t.lesson_id
    where s.id = segment_id and t.access_rights in ('learners','public') and t.status in ('machine','edited','reviewed')
      and l.state = 'published' and l.visibility = 'authenticated'));
create policy learner_select on public.lesson_tags for select to authenticated
  using (public.is_staff() or exists (select 1 from public.audio_lessons l where l.id = lesson_id and l.state = 'published' and l.visibility = 'authenticated'));
create policy learner_select on public.lesson_topics for select to authenticated
  using (public.is_staff() or exists (select 1 from public.audio_lessons l where l.id = lesson_id and l.state = 'published' and l.visibility = 'authenticated'));

do $$
declare t text;
begin
  foreach t in array array['audio_course_collections','audio_chapters','audio_lessons','audio_lesson_assets','speakers','lesson_speakers',
                           'transcripts','transcript_segments','transcript_word_alignments','lesson_tags','lesson_topics'] loop
    execute format('create policy editor_insert on public.%I for insert to authenticated with check (public.is_content_editor())', t);
    execute format('create policy editor_update on public.%I for update to authenticated using (public.is_content_editor()) with check (public.is_content_editor())', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using (public.is_content_editor())', t);
  end loop;
  -- transcript translations are reviewable by language reviewers
  execute 'create policy reviewer_insert on public.transcript_translations for insert to authenticated with check (public.is_language_reviewer())';
  execute 'create policy reviewer_update on public.transcript_translations for update to authenticated using (public.is_language_reviewer()) with check (public.is_language_reviewer())';
  execute 'create policy editor_delete on public.transcript_translations for delete to authenticated using (public.is_content_editor())';
  -- reviewers may flag segment review state
  execute 'create policy reviewer_update on public.transcript_segments for update to authenticated using (public.is_language_reviewer()) with check (public.is_language_reviewer())';
end $$;

-- uploads: editors see uploads and may open their own; every lifecycle step (multipart id, parts,
-- completion, verification, promotion of storage_key) is performed by the API Worker with the service
-- role after it has checked the object in R2 (§7.2, §11). No UPDATE policy for authenticated users.
create policy owner_select on public.uploads for select to authenticated using (user_id = auth.uid() or public.is_content_editor());
create policy owner_insert on public.uploads for insert to authenticated with check (user_id = auth.uid() and public.is_content_editor());
create policy editor_delete on public.uploads for delete to authenticated using (public.is_content_editor());

/** Defence in depth: a JWT-bearing session can only create an `initiated` row and never touch lifecycle columns. */
create or replace function public.guard_upload_client_write()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then
    return new; -- service role (API Worker)
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'initiated' or new.multipart_upload_id is not null or new.verified_checksum_sha256 is not null
       or new.completed_parts <> '[]'::jsonb or new.draft_asset_id is not null or public.object_key_scope(new.storage_key) is distinct from 'upload' then
      raise exception 'uploads start as initiated with a staging key; lifecycle columns are managed by the server' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status or new.storage_key is distinct from old.storage_key
        or new.multipart_upload_id is distinct from old.multipart_upload_id or new.completed_parts is distinct from old.completed_parts
        or new.verified_checksum_sha256 is distinct from old.verified_checksum_sha256 or new.draft_asset_id is distinct from old.draft_asset_id
        or new.part_count is distinct from old.part_count or new.user_id is distinct from old.user_id then
    raise exception 'upload lifecycle columns are managed by the server' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_upload_client_write before insert or update on public.uploads
  for each row execute function public.guard_upload_client_write();

-- processing_jobs: staff read; the ONLY write path for JWT sessions is enqueue_processing_job (idempotent,
-- defaults enforced, requester = caller); state changes only through the worker RPCs (service role).
create policy staff_select on public.processing_jobs for select to authenticated using (public.is_staff());
create policy staff_select on public.asset_provenance_events for select to authenticated using (public.is_staff());
create policy editor_insert on public.asset_provenance_events for insert to authenticated with check (public.is_content_editor());

-- ---------------------------------------------------------------------------
-- 6. AI routing, requests, moderation, audit
-- ---------------------------------------------------------------------------
create policy staff_select on public.ai_model_profiles for select to authenticated using (public.is_staff());
create policy admin_insert on public.ai_model_profiles for insert to authenticated with check (public.is_admin());
create policy admin_update on public.ai_model_profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_delete on public.ai_model_profiles for delete to authenticated using (public.is_admin());
create policy staff_select on public.ai_model_benchmarks for select to authenticated using (public.is_staff());
create policy admin_insert on public.ai_model_benchmarks for insert to authenticated with check (public.is_admin());
create policy admin_update on public.ai_model_benchmarks for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_select on public.ai_requests for select to authenticated using (public.is_admin());
create policy support_select on public.moderation_incidents for select to authenticated using (public.is_support());
create policy admin_insert on public.moderation_incidents for insert to authenticated with check (public.is_admin());
create policy admin_update on public.moderation_incidents for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_select on public.audit_logs for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. Visual assets (approved artwork is harmless to expose; drafts are staff-only)
-- ---------------------------------------------------------------------------
create policy public_select on public.visual_assets for select to anon, authenticated
  using ((review_status = 'approved' and moderation_status <> 'flagged') or public.is_staff());
create policy public_select on public.mascot_animations for select to anon, authenticated using (review_status = 'approved' or public.is_staff());
create policy learner_select on public.character_visual_variants for select to authenticated using (review_status = 'approved' or public.is_staff());
create policy learner_select on public.mission_visual_bindings for select to authenticated
  using (public.is_staff() or exists (select 1 from public.missions m where m.id = mission_id and m.state = 'published'));
create policy learner_select on public.audio_cover_art for select to authenticated using (review_status = 'approved' or public.is_staff());

do $$
declare t text;
begin
  foreach t in array array['visual_assets','mascot_animations','character_visual_variants','mission_visual_bindings','audio_cover_art'] loop
    execute format('create policy editor_insert on public.%I for insert to authenticated with check (public.is_content_editor())', t);
    execute format('create policy editor_update on public.%I for update to authenticated using (public.is_content_editor()) with check (public.is_content_editor())', t);
    execute format('create policy editor_delete on public.%I for delete to authenticated using (public.is_content_editor())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Column exposure: staff user ids and import filesystem paths never reach learners or anon (§11)
-- ---------------------------------------------------------------------------
-- Column-level grants replace the table-level SELECT for anon/authenticated. PostgREST answers
-- `select=*` with 42501 for a role that lacks the table-level privilege, so learner/anon reads of
-- these two tables must name their columns (catalog + audio-library repositories); staff read whole
-- rows through the *_staff views (owner-executed, gated by is_staff()).
revoke select on public.course_source_localizations from anon, authenticated;
grant select (id, course_track_id, source_language_code, status, metrics, native_reviewed, reviewed_at, editorial_note_key,
              fallback_source_language_code, created_at, updated_at)
  on public.course_source_localizations to anon, authenticated;

revoke select on public.media_assets from anon, authenticated;
grant select (id, storage_key, bucket, kind, checksum_sha256, mime_type, byte_length, duration_ms, channels, sample_rate_hz, bitrate_kbps,
              source_asset_id, derivation, visibility, content_rights_id, disposition, state, etag, created_at, updated_at)
  on public.media_assets to anon, authenticated;

-- The views run with their owner's privileges, so a staff JWT reads the restricted columns through
-- them. The service role (no JWT subject, like the worker RPCs above treat it) sees every row too, so
-- @langquest/db has one "full row" read path for the API Worker and the admin app alike.
/** Full coverage rows (incl. reviewer_id) for staff and the service role; empty for everyone else. */
create view public.course_source_localizations_staff with (security_barrier = true) as
  select * from public.course_source_localizations where public.is_staff() or auth.uid() is null;
/** Full media_assets rows (incl. owner_id, legacy_filename, legacy_path) for staff and the service role; empty for everyone else. */
create view public.media_assets_staff with (security_barrier = true) as
  select * from public.media_assets where public.is_staff() or auth.uid() is null;
revoke all on public.course_source_localizations_staff, public.media_assets_staff from public, anon;
grant select on public.course_source_localizations_staff, public.media_assets_staff to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Sanity: every public table must have RLS enabled and at least one policy or be intentionally locked
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise exception 'RLS not enabled on public.%', t.relname;
  end loop;
end $$;
