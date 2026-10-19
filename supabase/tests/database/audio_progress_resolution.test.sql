-- pgTAP tests for migration 110 (listening-position conflict resolution, §4.5):
-- per-device revisions only compete with the same device; across devices the skew-corrected event
-- time decides; completion is never lost; the ledger still dedupes on clientEventId.
-- Run: `pnpm supabase test db` (needs the local stack), or
--      `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/database/audio_progress_resolution.test.sql`
-- (the whole file rolls back).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures and role helpers (same conventions as app_gaps.test.sql)
-- ---------------------------------------------------------------------------
create temp table fx (k text primary key, v uuid not null) on commit drop;
insert into fx values
  ('learner', gen_random_uuid()), ('collection', gen_random_uuid()), ('chapter', gen_random_uuid()), ('lesson', gen_random_uuid()),
  ('ev_a1', gen_random_uuid()), ('ev_a2', gen_random_uuid()), ('ev_a3', gen_random_uuid()), ('ev_a4', gen_random_uuid()),
  ('ev_b1', gen_random_uuid()), ('ev_b2', gen_random_uuid()), ('ev_b3', gen_random_uuid()), ('ev_c1', gen_random_uuid());
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
/** One audio_progress sync event, as the client sends it. */
create function pg_temp.ev(p_event text, p_device text, p_revision integer, p_occurred timestamptz, p_position integer, p_completed boolean default false)
returns jsonb language sql stable as $$
  select json_build_object('clientEventId', pg_temp.uid(p_event), 'enrollmentId', null, 'deviceId', p_device, 'revision', p_revision,
                           'occurredAt', p_occurred,
                           'payload', json_build_object('type', 'audio_progress', 'lessonId', pg_temp.uid('lesson'), 'positionMs', p_position,
                                                        'durationMs', 600000, 'completed', p_completed))::jsonb
$$;
create function pg_temp.apply(p_event jsonb, p_sent_at timestamptz default null) returns table (resolution text, reason text)
language sql as $$
  select r.resolution, r.reason from public.apply_sync_events(array[p_event], null, p_sent_at) r
$$;
create function pg_temp.position() returns integer language sql stable as $$
  select position_ms from public.user_audio_progress where user_id = pg_temp.uid('learner') and lesson_id = pg_temp.uid('lesson')
$$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.uid('learner'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'learner@langquest.test', '', now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.audio_course_collections (id, title_translations, state) values (pg_temp.uid('collection'), '{"en":"Resolution"}', 'published');
insert into public.audio_chapters (id, collection_id, title_translations, state) values (pg_temp.uid('chapter'), pg_temp.uid('collection'), '{"en":"Ch"}', 'published');
insert into public.audio_lessons (id, chapter_id, title_translations, state) values (pg_temp.uid('lesson'), pg_temp.uid('chapter'), '{"en":"L"}', 'published');

select has_column('public', 'user_audio_progress', 'last_device_id', 'user_audio_progress.last_device_id exists');
select has_column('public', 'user_audio_progress', 'last_occurred_at', 'user_audio_progress.last_occurred_at exists');

select pg_temp.login('learner');

-- ---------------------------------------------------------------------------
-- 1. Same device: the per-device revision decides
-- ---------------------------------------------------------------------------
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_a1', 'phone-a', 1, now() - interval '10 minutes', 1000)) $$,
  $$ values ('applied', null::text) $$, 'first write from device A is applied');
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_a2', 'phone-a', 5, now() - interval '9 minutes', 5000)) $$,
  $$ values ('applied', null::text) $$, 'device A revision 5 beats its own revision 1');
select is(pg_temp.position(), 5000, 'position moved to revision 5');
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_a3', 'phone-a', 3, now() - interval '1 minute', 3000)) $$,
  $$ values ('superseded', 'older_revision') $$, 'device A revision 3 arriving late is superseded by its own revision 5');
select is(pg_temp.position(), 5000, 'the superseded same-device write did not move the position');
select is((select last_device_id from public.user_audio_progress where lesson_id = pg_temp.uid('lesson')), 'phone-a', 'last writer is device A');

-- ---------------------------------------------------------------------------
-- 2. Different device: wall-clock decides, revisions from another counter are irrelevant
-- ---------------------------------------------------------------------------
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_b1', 'tablet-b', 1, now() - interval '2 minutes', 20000)) $$,
  $$ values ('applied', null::text) $$, 'device B revision 1 (newer in time) beats device A revision 5');
select is(pg_temp.position(), 20000, 'device B position is stored');
select is((select last_device_id from public.user_audio_progress where lesson_id = pg_temp.uid('lesson')), 'tablet-b', 'last writer is device B');
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_a4', 'phone-a', 40, now() - interval '5 minutes', 4000)) $$,
  $$ values ('superseded', 'older_event') $$, 'device A revision 40 that happened BEFORE device B''s write is superseded');
select is(pg_temp.position(), 20000, 'the older cross-device write did not move the position');

-- ---------------------------------------------------------------------------
-- 3. Clock skew: a device whose clock runs 1 h fast is corrected by the batch skew
-- ---------------------------------------------------------------------------
-- Device C reports occurredAt = now() + 59 min with clientSentAt = now() + 60 min → effective time ≈ now() - 1 min,
-- which is OLDER than device B's position (now() - 2 min)? No: -1 min is newer than -2 min → applied.
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_c1', 'watch-c', 1, now() + interval '59 minutes', 30000), now() + interval '60 minutes') $$,
  $$ values ('applied', null::text) $$, 'skew-corrected event from a fast clock lands at its real time and is applied');
select ok((select last_occurred_at <= now() from public.user_audio_progress where lesson_id = pg_temp.uid('lesson')),
  'stored last_occurred_at is never in the server future');
select ok((select last_occurred_at between now() - interval '2 minutes' and now() from public.user_audio_progress where lesson_id = pg_temp.uid('lesson')),
  'stored last_occurred_at reflects the skew-corrected time, not the raw client clock');
-- The same device B write that was newer than A but older than C is now superseded.
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_b2', 'tablet-b', 2, now() - interval '90 seconds', 21000)) $$,
  $$ values ('superseded', 'older_event') $$, 'device B revision 2 older than the skew-corrected device C write is superseded');

-- ---------------------------------------------------------------------------
-- 4. Completion is sticky even on a superseded event; the ledger dedupes replays
-- ---------------------------------------------------------------------------
select is((select completed from public.user_audio_progress where lesson_id = pg_temp.uid('lesson')), false, 'lesson not completed yet');
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_b3', 'tablet-b', 3, now() - interval '80 seconds', 600000, true)) $$,
  $$ values ('superseded', 'older_event') $$, 'an older completion event is superseded for the position');
select is((select completed from public.user_audio_progress where lesson_id = pg_temp.uid('lesson')), true, '…but the lesson is still marked completed');
select is(pg_temp.position(), 30000, 'the newer position was kept');
select results_eq($$ select * from pg_temp.apply(pg_temp.ev('ev_c1', 'watch-c', 1, now(), 99999)) $$,
  $$ values ('duplicate', null::text) $$, 'replaying an acknowledged clientEventId is a duplicate, never re-applied');
select is(pg_temp.position(), 30000, 'the duplicate did not touch the position');
select is((select play_count from public.user_audio_progress where lesson_id = pg_temp.uid('lesson')), 4, 'play_count counts only applied writes');
select is((select count(*) from public.device_sync_events where user_id = pg_temp.uid('learner')), 8::bigint, 'every distinct event is in the ledger once');

-- ---------------------------------------------------------------------------
-- 5. The resolver is internal: learners cannot call it directly
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select * from public.apply_audio_progress(%L, %L, 'x', 1, now(), null, 1, null, false, gen_random_uuid()) $$, pg_temp.uid('learner'), pg_temp.uid('lesson')),
  '42501', null, 'apply_audio_progress is not executable by authenticated');
select pg_temp.logout();

select * from finish();
rollback;
