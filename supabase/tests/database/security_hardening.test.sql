-- pgTAP negative tests for the server-side invariants added by the security review
-- (run: `pnpm supabase test db` from the repo root — needs the local stack).
--
-- Roles are simulated the way PostgREST does it: `set local role authenticated|anon` plus
-- `request.jwt.claims`. With no claims and the `postgres` role we behave like the service role
-- (auth.uid() is null, RLS bypassed), which is exactly what the API Worker / jobs runner see.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures and role helpers
-- ---------------------------------------------------------------------------
create temp table fx (k text primary key, v uuid not null) on commit drop;
insert into fx values
  ('learner', gen_random_uuid()), ('other', gen_random_uuid()), ('editor', gen_random_uuid()),
  ('enrollment', gen_random_uuid()), ('mission', gen_random_uuid()), ('character', gen_random_uuid()),
  ('session', gen_random_uuid()), ('other_asset', gen_random_uuid()), ('own_asset', gen_random_uuid()),
  ('upload', gen_random_uuid());
grant select on fx to anon, authenticated;

create function pg_temp.uid(p text) returns uuid language sql stable as $$ select v from fx where k = p $$;
create function pg_temp.login(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@test.local', '', now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
from fx where k in ('learner','other','editor');
insert into public.user_roles (user_id, role) values (pg_temp.uid('editor'), 'content_editor');
insert into public.user_course_enrollments (id, user_id, course_track_id, source_language_code)
  values (pg_temp.uid('enrollment'), pg_temp.uid('learner'), 'french', 'en');
insert into public.missions (id, template_key, target_variety_id, state) values (pg_temp.uid('mission'), 'test.mission', 'fr', 'published');
insert into public.characters (id, character_key, name, role, personality, home_region, target_variety_id, state)
  values (pg_temp.uid('character'), 'test.char', 'Test', 'barista', 'warm', 'Paris', 'fr', 'published');
insert into public.conversation_sessions (id, user_id, enrollment_id, character_id, target_variety_id, source_language_code, speech_retention)
  values (pg_temp.uid('session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('character'), 'fr', 'en', 'none');
insert into public.media_assets (id, storage_key, bucket, owner_id, kind, checksum_sha256, mime_type, byte_length, visibility, state)
  values (pg_temp.uid('other_asset'), 'media/' || pg_temp.uid('other_asset') || '/' || repeat('a', 64) || '.mp3', 'media', pg_temp.uid('other'), 'audio', repeat('a', 64), 'audio/mpeg', 10, 'authenticated', 'published'),
         (pg_temp.uid('own_asset'), 'media/' || pg_temp.uid('own_asset') || '/' || repeat('b', 64) || '.mp3', 'media', pg_temp.uid('learner'), 'audio', repeat('b', 64), 'audio/mpeg', 10, 'private', 'imported_draft');

-- ---------------------------------------------------------------------------
-- 1. Object-key scheme (mirrors packages/media/src/keys.ts)
-- ---------------------------------------------------------------------------
select is(public.object_key_scope('media/' || gen_random_uuid() || '/' || repeat('0', 64) || '.mp3'), 'master', 'master key recognised');
select is(public.object_key_scope('derived/' || gen_random_uuid() || '/slow_075/' || repeat('0', 64) || '.m4a'), 'derived', 'derived key recognised');
select is(public.object_key_scope('public/image/' || gen_random_uuid() || '/' || repeat('0', 64) || '.webp'), 'public', 'public image key recognised');
select is(public.object_key_scope('public/audio/' || gen_random_uuid() || '/' || repeat('0', 64) || '.mp3'), null, 'audio is never a public key');
select is(public.object_key_scope('uploads/' || gen_random_uuid() || '/' || repeat('0', 64) || '.wav'), 'upload', 'staging key recognised');
select is(public.object_key_scope('media/../etc/passwd'), null, 'path traversal rejected');
select is(public.object_key_scope('uploads/rls/My Song.mp3'), null, 'user-shaped key rejected');
select throws_ok(
  $$ insert into public.media_assets (storage_key, bucket, kind, checksum_sha256, mime_type, byte_length) values ('imports/My Song.mp3', 'media', 'audio', repeat('c', 64), 'audio/mpeg', 1) $$,
  '23514', null, 'media_assets.storage_key must follow the key scheme');
select throws_ok(
  $$ insert into public.visual_assets (storage_key, type, style_version, content_hash, alt_text_key, dimensions, origin, mime_type, byte_length) values ('covers/cover.png', 'course_cover', 'v1', repeat('d', 64), 'alt.cover', '{"w":1,"h":1}', 'ai_generated', 'image/png', 1) $$,
  '23514', null, 'visual_assets.storage_key must follow the key scheme');

-- ---------------------------------------------------------------------------
-- 2. Uploads: editor may only open an `initiated` staging row; lifecycle is server-owned
-- ---------------------------------------------------------------------------
select pg_temp.login('editor');
select lives_ok(
  format($$ insert into public.uploads (id, user_id, storage_key, part_size_bytes, original_filename, declared_mime_type, declared_byte_length, client_checksum_sha256, idempotency_key)
            values (%L, %L, %L, 1, 'a.mp3', 'audio/mpeg', 1, %L, 'k1') $$,
         pg_temp.uid('upload'), pg_temp.uid('editor'), 'uploads/' || pg_temp.uid('upload') || '/' || repeat('e', 64) || '.mp3', repeat('e', 64)),
  'editor opens an initiated upload with a staging key bound to the row');
select throws_ok(
  format($$ insert into public.uploads (user_id, storage_key, status, verified_checksum_sha256, part_size_bytes, original_filename, declared_mime_type, declared_byte_length, client_checksum_sha256, idempotency_key)
            values (%L, %L, 'verified', %L, 1, 'a.mp3', 'audio/mpeg', 1, %L, 'k2') $$,
         pg_temp.uid('editor'), 'uploads/' || gen_random_uuid() || '/' || repeat('e', 64) || '.mp3', repeat('e', 64), repeat('e', 64)),
  '42501', null, 'editor cannot create an already-verified upload');
select throws_ok(
  format($$ insert into public.uploads (user_id, storage_key, part_size_bytes, original_filename, declared_mime_type, declared_byte_length, client_checksum_sha256, idempotency_key)
            values (%L, %L, 1, 'a.mp3', 'audio/mpeg', 1, %L, 'k3') $$,
         pg_temp.uid('editor'), 'uploads/' || gen_random_uuid() || '/' || repeat('e', 64) || '.mp3', repeat('e', 64)),
  '23514', null, 'a staging key must name its own upload row');
select is((select count(*) from public.uploads where id = pg_temp.uid('upload')), 1::bigint, 'editor can read their upload');
with upd as (update public.uploads set status = 'verified', verified_checksum_sha256 = repeat('e', 64) where id = pg_temp.uid('upload') returning id)
select is((select count(*) from upd), 0::bigint, 'editor UPDATE on uploads affects no row (no policy)');
with upd as (update public.uploads set storage_key = 'media/' || gen_random_uuid() || '/' || repeat('f', 64) || '.mp3' where id = pg_temp.uid('upload') returning id)
select is((select count(*) from upd), 0::bigint, 'editor cannot repoint storage_key');
select pg_temp.logout();
select is((select status from public.uploads where id = pg_temp.uid('upload')), 'initiated', 'upload untouched by the editor session');
-- service role: the state machine still applies
select throws_ok(format($$ update public.uploads set status = 'verified', verified_checksum_sha256 = %L where id = %L $$, repeat('e', 64), pg_temp.uid('upload')),
  '23514', null, 'initiated → verified is not a legal transition even for the service role');
select lives_ok(format($$ update public.uploads set status = 'completed' where id = %L $$, pg_temp.uid('upload')), 'initiated → completed');
select throws_ok(format($$ update public.uploads set status = 'verified' where id = %L $$, pg_temp.uid('upload')),
  '23514', null, 'verified requires the server-computed checksum');
select lives_ok(format($$ update public.uploads set status = 'verified', verified_checksum_sha256 = %L where id = %L $$, repeat('e', 64), pg_temp.uid('upload')), 'completed → verified with checksum');
select throws_ok(format($$ update public.uploads set storage_key = %L where id = %L $$, 'media/' || gen_random_uuid() || '/' || repeat('e', 64) || '.mp3', pg_temp.uid('upload')),
  '23514', null, 'a verified upload is frozen');

-- ---------------------------------------------------------------------------
-- 3. Processing jobs: no direct editor inserts, no editor claims, requester = caller, sweeper
-- ---------------------------------------------------------------------------
select pg_temp.login('editor');
select throws_ok($$ insert into public.processing_jobs (job_type, idempotency_key, state) values ('verify', 'forged', 'succeeded') $$,
  '42501', null, 'editor cannot insert processing_jobs directly');
select throws_ok($$ select * from public.claim_processing_job('editor-worker') $$, '42501', null, 'editor cannot execute claim_processing_job');
select throws_ok($$ select * from public.requeue_expired_jobs() $$, '42501', null, 'editor cannot execute requeue_expired_jobs');
select is((select requested_by from public.enqueue_processing_job('verify', 'job-attrib', p_requested_by => pg_temp.uid('other'))),
  pg_temp.uid('editor'), 'enqueue attributes the job to the caller, not to p_requested_by');
select pg_temp.logout();
select lives_ok($$ select public.enqueue_processing_job('verify', 'job-sweep', p_max_attempts => 1) $$, 'service enqueues a one-attempt job');
update public.processing_jobs set priority = 0 where idempotency_key = 'job-attrib'; -- make job-sweep the next claim
select is((select idempotency_key from public.claim_processing_job('w1', array['verify'])), 'job-sweep', 'service claims a job');
update public.processing_jobs set locked_until = now() - interval '1 second' where idempotency_key = 'job-sweep';
select is((select new_state from public.requeue_expired_jobs() where job_id = (select id from public.processing_jobs where idempotency_key = 'job-sweep')),
  'review_needed', 'an exhausted expired lease lands in review_needed, never stranded in running');
update public.processing_jobs set state = 'running', locked_until = now() - interval '1 second', attempts = 0 where idempotency_key = 'job-attrib';
select is((select new_state from public.requeue_expired_jobs() where job_id = (select id from public.processing_jobs where idempotency_key = 'job-attrib')),
  'pending', 'an expired lease with attempts left goes back to pending');

-- ---------------------------------------------------------------------------
-- 4. XP: a client claim is recorded but never paid by the DB; service awards are reference-checked
-- ---------------------------------------------------------------------------
select pg_temp.login('learner');
select results_eq(
  format($$ select resolution, reason, xp_credited, handled_in_db from public.apply_sync_events(array[%L::jsonb]) $$,
         json_build_object('clientEventId', gen_random_uuid(), 'enrollmentId', pg_temp.uid('enrollment'), 'deviceId', 'd', 'revision', 1,
                           'occurredAt', now(), 'payload', json_build_object('type', 'xp_claim', 'reason', 'mission_completed', 'referenceId', null, 'amount', 9999))::text),
  $$ values ('rejected', 'xp_claim_requires_reference', null::integer, true) $$,
  'xp_claim without a reference is rejected');
select results_eq(
  format($$ select resolution, xp_credited, handled_in_db from public.apply_sync_events(array[%L::jsonb]) $$,
         json_build_object('clientEventId', gen_random_uuid(), 'enrollmentId', pg_temp.uid('enrollment'), 'deviceId', 'd', 'revision', 2,
                           'occurredAt', now(), 'payload', json_build_object('type', 'xp_claim', 'reason', 'mission_completed', 'referenceId', pg_temp.uid('mission'), 'amount', 9999))::text),
  $$ values ('applied', null::integer, false) $$,
  'xp_claim with a reference is handed to the engine (handled_in_db = false), not paid');
select is((select count(*) from public.xp_ledger where user_id = pg_temp.uid('learner')), 0::bigint, 'no ledger row was minted by the client claim');
select is((select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 2), 1::bigint,
  'apply_sync_events holds the per-user advisory lock for the transaction');
select pg_temp.logout();
-- service-side award validation
insert into public.mission_attempts (id, user_id, enrollment_id, mission_id, client_attempt_id)
  values ('00000000-0000-0000-0000-00000000a001', pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('mission'), gen_random_uuid());
select throws_ok(
  format($$ select * from public.award_xp(gen_random_uuid(), %L, 50, 'mission_completed', %L, 'mission_attempts', '00000000-0000-0000-0000-00000000a001') $$, pg_temp.uid('learner'), pg_temp.uid('enrollment')),
  '23503', null, 'award_xp refuses a reference to an attempt that is not completed');
update public.mission_attempts set completed_at = now() where id = '00000000-0000-0000-0000-00000000a001';
select is((select applied from public.award_xp(gen_random_uuid(), pg_temp.uid('learner'), 50, 'mission_completed', pg_temp.uid('enrollment'), 'mission_attempts', '00000000-0000-0000-0000-00000000a001')),
  true, 'award_xp pays a completed, owned attempt');
select is((select applied from public.award_xp(gen_random_uuid(), pg_temp.uid('learner'), 50, 'mission_completed', pg_temp.uid('enrollment'), 'mission_attempts', '00000000-0000-0000-0000-00000000a001')),
  false, 'the same completion is never paid twice, even under a new idempotency key');
select is(public.user_total_xp(pg_temp.uid('learner')), 50::bigint, 'ledger holds exactly one payment for the attempt');
select throws_ok(
  format($$ select * from public.award_xp(gen_random_uuid(), %L, 50, 'mission_completed', null, 'mission_attempts', '00000000-0000-0000-0000-00000000a001') $$, pg_temp.uid('other')),
  '23503', 'xp reference mission_attempts.00000000-0000-0000-0000-00000000a001 is not an owned, completed row of user ' || pg_temp.uid('other'),
  'award_xp refuses a reference owned by another user');

-- ---------------------------------------------------------------------------
-- 5. Derived learning state is read-only for learners; attempt outcomes are server-decided
-- ---------------------------------------------------------------------------
select pg_temp.login('learner');
select throws_ok(format($$ insert into public.user_skill_mastery (user_id, enrollment_id, skill_key, mastery_state) values (%L, %L, 'greet', 'durable') $$, pg_temp.uid('learner'), pg_temp.uid('enrollment')),
  '42501', null, 'learner cannot forge durable mastery');
select throws_ok(format($$ insert into public.mission_progress (user_id, enrollment_id, mission_id, status, completions, completed_without_hints) values (%L, %L, %L, 'completed', 9, true) $$, pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('mission')),
  '42501', null, 'learner cannot forge mission completion');
select throws_ok(format($$ insert into public.streak_activity (user_id, activity_date, minutes_active) values (%L, current_date, 600) $$, pg_temp.uid('learner')),
  '42501', null, 'learner cannot forge streak minutes');
select throws_ok(format($$ insert into public.daily_learning_metrics (user_id, enrollment_id, metric_date, xp_earned) values (%L, %L, current_date, 9999) $$, pg_temp.uid('learner'), pg_temp.uid('enrollment')),
  '42501', null, 'learner cannot forge daily metrics');
select throws_ok(format($$ insert into public.mission_attempts (user_id, enrollment_id, mission_id, client_attempt_id, completed_at, xp_awarded) values (%L, %L, %L, gen_random_uuid(), now(), 50) $$, pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('mission')),
  '42501', null, 'learner cannot insert a completed attempt');
select lives_ok(format($$ insert into public.mission_attempts (id, user_id, enrollment_id, mission_id, client_attempt_id) values ('00000000-0000-0000-0000-00000000a002', %L, %L, %L, gen_random_uuid()) $$, pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('mission')),
  'learner starts an attempt (offline-first)');
select lives_ok($$ update public.mission_attempts set current_step_index = 3, step_results = '[{"ok":true}]' where id = '00000000-0000-0000-0000-00000000a002' $$,
  'learner advances their own attempt');
select throws_ok($$ update public.mission_attempts set completed_at = now(), evaluation = '{"score":1}', xp_awarded = 50 where id = '00000000-0000-0000-0000-00000000a002' $$,
  '42501', null, 'learner cannot complete/evaluate their own attempt');
with del as (delete from public.mission_attempts where id = '00000000-0000-0000-0000-00000000a002' returning id)
select is((select count(*) from del), 0::bigint, 'learner cannot delete attempt evidence');
select is((select count(*) from public.mission_attempts where user_id = pg_temp.uid('learner')), 2::bigint, 'learner reads their own attempts');
select pg_temp.logout();
select lives_ok($$ update public.mission_attempts set completed_at = now(), evaluation = '{"score":1}', xp_awarded = 50 where id = '00000000-0000-0000-0000-00000000a002' $$,
  'service role completes the attempt');

-- ---------------------------------------------------------------------------
-- 6. Conversation turns: learner lines only, own audio only, retention from the session
-- ---------------------------------------------------------------------------
select pg_temp.login('learner');
select throws_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text) values (%L, 0, 'character', 'forged line') $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot write character turns');
select throws_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text, audio_asset_id) values (%L, 0, 'learner', 'hi', %L) $$, pg_temp.uid('session'), pg_temp.uid('other_asset')),
  '42501', null, 'learner cannot attach somebody else''s media asset');
select lives_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text, audio_asset_id, occurred_at, expires_at) values (%L, 0, 'learner', 'hi', %L, '2026-10-14T10:00:00Z', '2099-01-01T00:00:00Z') $$, pg_temp.uid('session'), pg_temp.uid('own_asset')),
  'learner writes their own line with their own audio');
select is((select expires_at from public.conversation_turns where session_id = pg_temp.uid('session') and turn_index = 0),
  '2026-10-15T10:00:00Z'::timestamptz, 'expires_at comes from the session retention (none → 24h), not from the client');
select pg_temp.logout();
select lives_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text, expires_at) values (%L, 1, 'character', 'bonjour', '2026-10-20T00:00:00Z') $$, pg_temp.uid('session')),
  'service role writes character turns');
select is((select expires_at from public.conversation_turns where session_id = pg_temp.uid('session') and turn_index = 1),
  '2026-10-20T00:00:00Z'::timestamptz, 'service-supplied expires_at is kept');

-- ---------------------------------------------------------------------------
-- 7. Column exposure: reviewer ids and import paths are staff-only
-- ---------------------------------------------------------------------------
select pg_temp.login_anon();
select throws_ok($$ select reviewer_id from public.course_source_localizations limit 1 $$, '42501', null, 'anon cannot read reviewer_id');
select lives_ok($$ select id, course_track_id, source_language_code, status, metrics from public.course_source_localizations limit 1 $$, 'anon reads coverage columns');
select throws_ok($$ select * from public.course_source_localizations_staff limit 1 $$, '42501', null, 'anon cannot use the staff view');
select pg_temp.login('learner');
select throws_ok($$ select owner_id, legacy_path from public.media_assets limit 1 $$, '42501', null, 'learner cannot read owner_id/legacy_path');
select is((select count(*) from public.media_assets where id = pg_temp.uid('other_asset')), 1::bigint, 'learner still reads published asset rows by allowed columns');
select is((select count(*) from public.media_assets_staff), 0::bigint, 'staff view is empty for learners');
select pg_temp.login('editor');
select is((select owner_id from public.media_assets_staff where id = pg_temp.uid('other_asset')), pg_temp.uid('other'), 'editor reads owner_id through the staff view');
select ok((select count(*) from public.course_source_localizations_staff) > 0, 'editor reads coverage rows through the staff view');
select pg_temp.logout();
select is((select owner_id from public.media_assets_staff where id = pg_temp.uid('own_asset')), pg_temp.uid('learner'), 'service role reads full rows through the staff view');
select ok((select count(*) from public.course_source_localizations_staff) > 0, 'service role reads coverage rows through the staff view');

select * from finish();
rollback;
