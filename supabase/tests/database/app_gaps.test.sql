-- pgTAP tests for migration 100 (cross-package gaps, 2026-10-15):
-- account deletion / test purge, the append-only bypass, blob-vs-asset, stored manifests, AI suggestions
-- and the widened processing_job_type domain.
-- Run: `pnpm supabase test db` (needs the local stack), or
--      `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/database/app_gaps.test.sql`
-- (the whole file rolls back).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures and role helpers (same conventions as security_hardening.test.sql)
-- ---------------------------------------------------------------------------
create temp table fx (k text primary key, v uuid not null) on commit drop;
insert into fx values
  ('learner', gen_random_uuid()), ('other', gen_random_uuid()), ('editor', gen_random_uuid()), ('real', gen_random_uuid()),
  ('enrollment', gen_random_uuid()), ('character', gen_random_uuid()), ('session', gen_random_uuid()),
  ('recording', gen_random_uuid()), ('asset', gen_random_uuid()), ('twin', gen_random_uuid()), ('collection', gen_random_uuid()),
  ('suggestion', gen_random_uuid());
grant select on fx to anon, authenticated;

create function pg_temp.uid(p text) returns uuid language sql stable as $$ select v from fx where k = p $$;
create function pg_temp.login(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       case when k = 'real' then 'real-person@example.com' else k || '@langquest.test' end,
       '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from fx where k in ('learner','other','editor','real');
insert into public.user_roles (user_id, role) values (pg_temp.uid('editor'), 'content_editor');
insert into public.user_course_enrollments (id, user_id, course_track_id, source_language_code)
  values (pg_temp.uid('enrollment'), pg_temp.uid('learner'), 'french', 'en');
insert into public.characters (id, character_key, name, role, personality, home_region, target_variety_id, state)
  values (pg_temp.uid('character'), 'test.gaps.char', 'Test', 'barista', 'warm', 'Paris', 'fr', 'published');
insert into public.conversation_sessions (id, user_id, enrollment_id, character_id, target_variety_id, source_language_code)
  values (pg_temp.uid('session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('character'), 'fr', 'en');
insert into public.conversation_turns (session_id, turn_index, speaker) values (pg_temp.uid('session'), 0, 'learner');
insert into public.xp_ledger (user_id, enrollment_id, amount, reason, idempotency_key) values (pg_temp.uid('learner'), pg_temp.uid('enrollment'), 5, 'mission_completed', gen_random_uuid());
insert into public.device_sync_events (user_id, device_id, client_event_id, payload_type, client_occurred_at, resolution)
  values (pg_temp.uid('learner'), 'd', gen_random_uuid(), 'activity_minutes', now(), 'applied');
insert into public.learning_observations (user_id, enrollment_id, skill_key, observation_type, scenario_id, autonomy, outcome, scorer_kind, scorer_version)
  values (pg_temp.uid('learner'), pg_temp.uid('enrollment'), 'greet.basic', 'spoken_production', 'gaps', 'unaided', 'success', 'deterministic', '1');
insert into public.ai_requests (user_id, enrollment_id, task, provider, model, success, trace_id)
  values (pg_temp.uid('learner'), pg_temp.uid('enrollment'), 'character_dialogue', 'openrouter', 'm', true, 'gaps-trace');
insert into public.audit_logs (actor_id, action, ip_hash) values (pg_temp.uid('learner'), 'gaps.action', 'h');
insert into public.media_assets (id, storage_key, bucket, owner_id, kind, checksum_sha256, mime_type, byte_length)
  values (pg_temp.uid('recording'), 'media/' || pg_temp.uid('recording') || '/' || repeat('a', 64) || '.mp3', 'media', pg_temp.uid('learner'), 'audio', repeat('a', 64), 'audio/mpeg', 3),
         (pg_temp.uid('asset'), 'media/' || pg_temp.uid('asset') || '/' || repeat('b', 64) || '.mp3', 'media', pg_temp.uid('editor'), 'audio', repeat('b', 64), 'audio/mpeg', 10);
insert into public.audio_course_collections (id, title_translations, state) values (pg_temp.uid('collection'), '{"en":"Gaps"}', 'published');

-- ---------------------------------------------------------------------------
-- 1. processing_job_type accepts the apps/jobs handler names
-- ---------------------------------------------------------------------------
select lives_ok($$ select public.enqueue_processing_job('translate_transcript', 'gaps-tt') $$, 'translate_transcript is a job type');
select lives_ok($$ select public.enqueue_processing_job('regenerate_manifest', 'gaps-rm') $$, 'regenerate_manifest is a job type');
select lives_ok($$ select public.enqueue_processing_job('cleanup_orphan_uploads', 'gaps-co') $$, 'cleanup_orphan_uploads is a job type');
select lives_ok($$ select public.enqueue_processing_job('import_r2_prefix', 'gaps-ir') $$, 'import_r2_prefix is a job type');
select throws_ok($$ select public.enqueue_processing_job('not_a_type', 'gaps-x') $$, '23514', null, 'unknown job types are still rejected');

-- ---------------------------------------------------------------------------
-- 2. Physical blob vs logical asset: the same storage_key may back several rows
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ insert into public.media_assets (id, storage_key, bucket, kind, checksum_sha256, mime_type, byte_length) values (%L, %L, 'media', 'audio', %L, 'audio/mpeg', 10) $$,
         pg_temp.uid('twin'), 'media/' || pg_temp.uid('asset') || '/' || repeat('b', 64) || '.mp3', repeat('b', 64)),
  'a second logical asset can point at an existing blob');
select is((select count(*) from public.media_assets where storage_key = 'media/' || pg_temp.uid('asset') || '/' || repeat('b', 64) || '.mp3'), 2::bigint, 'two rows share one storage_key');
select throws_ok(
  $$ insert into public.media_assets (storage_key, bucket, kind, checksum_sha256, mime_type, byte_length) values ('imports/My Song.mp3', 'media', 'audio', repeat('c', 64), 'audio/mpeg', 1) $$,
  '23514', null, 'the key-scheme check still applies');

-- ---------------------------------------------------------------------------
-- 3. Append-only stays append-only outside the lifecycle functions (service role / postgres included)
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.xp_ledger set amount = 999 where user_id = pg_temp.uid('learner') $$, '23514', null, 'xp_ledger rejects UPDATE');
select throws_ok($$ delete from public.learning_observations where user_id = pg_temp.uid('learner') $$, '23514', null, 'learning_observations rejects DELETE');
select throws_ok($$ delete from public.device_sync_events where user_id = pg_temp.uid('learner') $$, '23514', null, 'device_sync_events rejects DELETE');
select throws_ok($$ delete from auth.users where id = pg_temp.uid('learner') $$, '23514', null, 'deleting auth.users directly is blocked by the ledgers (API must call delete_account first)');
select is(public.account_deletion_in_progress(), false, 'bypass is off outside the lifecycle functions');
-- setting the GUC as a JWT role must not open the bypass
select pg_temp.login('learner');
select lives_ok($$ select set_config('langquest.account_deletion', 'spoof', true) $$, 'JWT role can set the GUC locally…');
select is(public.account_deletion_in_progress(), false, '…but the bypass ignores it for anon/authenticated');
select pg_temp.logout();
select set_config('langquest.account_deletion', '', true);

-- ---------------------------------------------------------------------------
-- 4. delete_account: service only; JWT sessions are refused
-- ---------------------------------------------------------------------------
select pg_temp.login('learner');
select throws_ok(format($$ select public.delete_account(%L) $$, pg_temp.uid('learner')), '42501', null, 'learner cannot execute delete_account');
select throws_ok(format($$ select public.purge_test_user(%L) $$, pg_temp.uid('learner')), '42501', null, 'learner cannot execute purge_test_user');
select pg_temp.login('editor');
select throws_ok(format($$ select public.delete_account(%L) $$, pg_temp.uid('learner')), '42501', null, 'editor cannot execute delete_account');
select pg_temp.logout();

create temp table summary on commit drop as select public.delete_account(pg_temp.uid('learner'), true) as s;
select is((select (s->>'authUserDeletable')::boolean from summary), true, 'learner account is auth-deletable after delete_account');
select is((select (s->>'recordingsDeleted')::int from summary), 1, 'one recording deleted');
select ok((select s->'deletedTables' ? 'xp_ledger' from summary), 'xp_ledger listed as deleted');
select ok((select s->'anonymisedTables' ? 'ai_requests' from summary), 'ai_requests listed as anonymised');
select ok((select jsonb_array_length(s->'retainedForLegalReasons') > 0 from summary), 'retention list disclosed');
select is((select count(*) from public.xp_ledger where user_id = pg_temp.uid('learner')), 0::bigint, 'xp_ledger rows purged');
select is((select count(*) from public.learning_observations where user_id = pg_temp.uid('learner')), 0::bigint, 'learning_observations purged');
select is((select count(*) from public.device_sync_events where user_id = pg_temp.uid('learner')), 0::bigint, 'device_sync_events purged');
select is((select count(*) from public.conversation_turns where session_id = pg_temp.uid('session')), 0::bigint, 'conversation_turns purged');
select is((select count(*) from public.conversation_sessions where user_id = pg_temp.uid('learner')), 0::bigint, 'conversation_sessions purged');
select is((select count(*) from public.profiles where user_id = pg_temp.uid('learner')), 0::bigint, 'profile removed');
select is((select user_id from public.ai_requests where trace_id = 'gaps-trace'), null, 'ai_requests pseudonymised');
select is((select actor_id from public.audit_logs where action = 'gaps.action'), null, 'audit_logs actor anonymised');
select is((select ip_hash from public.audit_logs where action = 'gaps.action'), null, 'audit_logs ip hash cleared');
select is((select disposition from public.media_assets where id = pg_temp.uid('recording')), 'deleted', 'learner recording marked deleted');
select is((select owner_id from public.media_assets where id = pg_temp.uid('recording')), null, 'learner recording de-owned');
select is((select count(*) from public.asset_provenance_events where asset_id = pg_temp.uid('recording') and event_type = 'removed'), 1::bigint, 'provenance event recorded for the deleted recording');
select is((select count(*) from public.audit_logs where action = 'account.delete_account' and entity_id = pg_temp.uid('learner')::text and actor_id is null), 1::bigint, 'deletion audited without an actor');
select is(public.account_deletion_in_progress(), false, 'bypass is off again after the function returns');
select throws_ok($$ update public.ai_requests set user_id = null where trace_id = 'gaps-trace' $$, '23514', null, 'ledger is append-only again right after delete_account');
select lives_ok($$ delete from auth.users where id = pg_temp.uid('learner') $$, 'the auth.users row can now be deleted (what the API does with auth.admin.deleteUser)');

-- ---------------------------------------------------------------------------
-- 5. purge_test_user: @langquest.test only, deletes auth.users too
-- ---------------------------------------------------------------------------
select throws_ok(format($$ select public.purge_test_user(%L) $$, pg_temp.uid('real')), '42501', null, 'a real e-mail address is never purged');
select is((select count(*) from auth.users where id = pg_temp.uid('real')), 1::bigint, 'real account untouched');
select throws_ok(format($$ select public.purge_test_user(%L) $$, gen_random_uuid()), 'P0002', null, 'unknown users raise P0002');
insert into public.xp_ledger (user_id, amount, reason, idempotency_key) values (pg_temp.uid('other'), 1, 'daily_goal', gen_random_uuid());
select ok((select (public.purge_test_user(pg_temp.uid('other'))->>'authUserDeleted')::boolean), 'test account purged');
select is((select count(*) from auth.users where id = pg_temp.uid('other')), 0::bigint, 'auth.users row gone');
select is((select count(*) from public.xp_ledger where user_id = pg_temp.uid('other')), 0::bigint, 'its ledger rows gone');

-- ---------------------------------------------------------------------------
-- 6. Stored manifests: learners read published versions only; editors write
-- ---------------------------------------------------------------------------
insert into public.course_manifests (course_track_id, source_language_code, version, checksum, manifest, published_at)
  values ('french', 'en', 1, repeat('1', 64), '{"formatVersion":1}', now()),
         ('french', 'en', 2, repeat('2', 64), '{"formatVersion":1}', null);
select throws_ok($$ insert into public.course_manifests (course_track_id, source_language_code, version, checksum, manifest) values ('french', 'en', 1, repeat('3', 64), '{}') $$,
  '23505', null, '(track, source, version) is unique');
insert into public.audio_collection_manifests (collection_id, version, checksum, manifest, published_at)
  values (pg_temp.uid('collection'), 1, repeat('4', 64), '{"formatVersion":1}', now());
select is((select instruction_language_code from public.audio_collection_manifests where collection_id = pg_temp.uid('collection')), 'any', 'audio manifest defaults to instruction language any');
select pg_temp.login('real');
select is((select max(version) from public.course_manifests where course_track_id = 'french' and source_language_code = 'en'), 1, 'learner sees only the published course manifest version');
select is((select count(*) from public.audio_collection_manifests where collection_id = pg_temp.uid('collection')), 1::bigint, 'learner reads the published audio manifest');
select throws_ok($$ insert into public.course_manifests (course_track_id, source_language_code, version, checksum, manifest) values ('french', 'en', 9, repeat('9', 64), '{}') $$,
  '42501', null, 'learner cannot write manifests');
select pg_temp.login('editor');
select is((select max(version) from public.course_manifests where course_track_id = 'french' and source_language_code = 'en'), 2, 'editor sees the draft version too');
select lives_ok($$ update public.course_manifests set published_at = now() where course_track_id = 'french' and source_language_code = 'en' and version = 2 $$, 'editor publishes a version');
select pg_temp.login('real');
select is((select max(version) from public.course_manifests where course_track_id = 'french' and source_language_code = 'en'), 2, 'learner now sees version 2');
select pg_temp.logout();

-- ---------------------------------------------------------------------------
-- 7. AI suggestions: staff-only, decisions stamped by the trigger
-- ---------------------------------------------------------------------------
insert into public.asset_suggestions (id, media_asset_id, kind, suggestion, confidence, provenance)
  values (pg_temp.uid('suggestion'), pg_temp.uid('asset'), 'language', '{"likelyLanguages":[{"code":"fr","confidence":0.9}]}', 0.9, '{"task":"scene_planning","model":"m","promptVersion":"v1","traceId":"t"}');
select is((select review_status from public.asset_suggestions where id = pg_temp.uid('suggestion')), 'review_needed', 'suggestions start in review_needed');
select throws_ok(format($$ insert into public.asset_suggestions (media_asset_id, kind, suggestion) values (%L, 'bogus', '{}') $$, pg_temp.uid('asset')), '23514', null, 'kind is constrained');
select pg_temp.login('real');
select is((select count(*) from public.asset_suggestions), 0::bigint, 'learner sees no suggestions');
select throws_ok(format($$ insert into public.asset_suggestions (media_asset_id, kind, suggestion) values (%L, 'tags', '{}') $$, pg_temp.uid('asset')), '42501', null, 'learner cannot insert suggestions');
with upd as (update public.asset_suggestions set review_status = 'approved' where id = pg_temp.uid('suggestion') returning id)
select is((select count(*) from upd), 0::bigint, 'learner UPDATE affects no row');
select pg_temp.login('editor');
select is((select count(*) from public.asset_suggestions where id = pg_temp.uid('suggestion')), 1::bigint, 'editor reads suggestions');
select lives_ok(format($$ update public.asset_suggestions set review_status = 'approved', decision_note = 'ok' where id = %L $$, pg_temp.uid('suggestion')), 'editor approves');
select is((select reviewer_id from public.asset_suggestions where id = pg_temp.uid('suggestion')), pg_temp.uid('editor'), 'reviewer stamped from auth.uid()');
select isnt((select decided_at from public.asset_suggestions where id = pg_temp.uid('suggestion')), null, 'decided_at stamped');
select lives_ok(format($$ update public.asset_suggestions set review_status = 'in_review' where id = %L $$, pg_temp.uid('suggestion')), 'editor reopens');
select is((select decided_at from public.asset_suggestions where id = pg_temp.uid('suggestion')), null, 'decided_at cleared when reopened');
select pg_temp.logout();

select * from finish();
rollback;
