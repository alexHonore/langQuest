-- pgTAP: the `ai_requests` ledger contract that staff AI spend relies on (2026-10-20).
--
-- Admin prompt probes, smoke tests and model benchmarks have no learner enrollment. Their language context carries a
-- placeholder uuid (`LanguageContext.enrollmentId` is required); written to `ai_requests.enrollment_id` it fails the
-- foreign key and the cost row is lost. The fix needs no migration: `enrollment_id` is already nullable, so staff rows
-- are written with `enrollment_id = null`, attributed to the staff actor through `user_id` (an `auth.users` id) and
-- tagged with the purpose in `redacted_log`. This file locks that contract: the nullable column, the foreign key that
-- refuses placeholder ids, learner rows unchanged, RLS unchanged (learners read nothing, admins read the ledger,
-- nobody writes it through a JWT) and the append-only trigger.
-- Run: `pnpm supabase test db` (needs the local stack), or
--      `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/database/ai_requests_admin_probes.test.sql`
-- (the whole file rolls back).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ---------------------------------------------------------------------------
-- Fixtures and role helpers (same conventions as app_gaps.test.sql)
-- ---------------------------------------------------------------------------
create temp table fx (k text primary key, v uuid not null) on commit drop;
insert into fx values ('admin', gen_random_uuid()), ('learner', gen_random_uuid()), ('enrollment', gen_random_uuid());
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
select v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@langquest.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from fx where k in ('admin', 'learner');
insert into public.user_roles (user_id, role) values (pg_temp.uid('admin'), 'admin');
insert into public.user_course_enrollments (id, user_id, course_track_id, source_language_code)
  values (pg_temp.uid('enrollment'), pg_temp.uid('learner'), 'french', 'en');

-- ---------------------------------------------------------------------------
-- 1. Schema: enrollment is optional, the foreign key refuses ids that are not enrollments
-- ---------------------------------------------------------------------------
select col_is_null('public', 'ai_requests', 'enrollment_id', 'ai_requests.enrollment_id is nullable (staff and job rows have no enrollment)');
select col_is_null('public', 'ai_requests', 'user_id', 'ai_requests.user_id is nullable (pseudonymous rows stay possible)');

select lives_ok(
  format($$ insert into public.ai_requests (user_id, enrollment_id, task, provider, model, success, estimated_cost_usd, trace_id, redacted_log)
            values (%L, null, 'character_dialogue', 'openrouter', 'fake/model', true, 0.0004, 'probe-trace', '{"purpose":"admin_model_test","actor":"staff"}') $$, pg_temp.uid('admin')),
  'a staff probe row (no enrollment, admin as actor) is recorded');
select throws_ok(
  $$ insert into public.ai_requests (enrollment_id, task, provider, model, success, trace_id)
     values (gen_random_uuid(), 'character_dialogue', 'openrouter', 'fake/model', true, 'placeholder-trace') $$,
  '23503', null, 'a placeholder enrollment id (what probes used to send) fails the foreign key');
select lives_ok(
  format($$ insert into public.ai_requests (user_id, enrollment_id, task, provider, model, success, trace_id)
            values (%L, %L, 'character_dialogue', 'openrouter', 'fake/model', true, 'learner-trace') $$, pg_temp.uid('learner'), pg_temp.uid('enrollment')),
  'a learner row keeps its real enrollment');
select is((select sum(estimated_cost_usd) from public.ai_requests where redacted_log->>'actor' = 'staff' and trace_id = 'probe-trace'), 0.0004::numeric, 'staff spend is summable from the ledger');

-- ---------------------------------------------------------------------------
-- 2. RLS unchanged: learners read nothing, admins read the ledger, nobody writes it with a JWT
-- ---------------------------------------------------------------------------
select pg_temp.login('learner');
select is((select count(*) from public.ai_requests where trace_id in ('probe-trace', 'learner-trace')), 0::bigint, 'a learner reads no ai_requests rows, not even their own');
select throws_ok(
  $$ insert into public.ai_requests (task, provider, model, success, trace_id) values ('character_dialogue', 'openrouter', 'fake/model', true, 'jwt-write') $$,
  '42501', null, 'a learner cannot write the ledger');
select pg_temp.logout();

select pg_temp.login('admin');
select is((select count(*) from public.ai_requests where trace_id in ('probe-trace', 'learner-trace')), 2::bigint, 'an admin reads the staff and learner rows');
select throws_ok(
  format($$ insert into public.ai_requests (user_id, task, provider, model, success, trace_id) values (%L, 'character_dialogue', 'openrouter', 'fake/model', true, 'admin-jwt-write') $$, pg_temp.uid('admin')),
  '42501', null, 'an admin JWT cannot write the ledger either (only the service role does)');
select pg_temp.logout();

-- ---------------------------------------------------------------------------
-- 3. Append-only
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.ai_requests set success = false where trace_id = 'probe-trace' $$, '23514', null, 'ledger rows cannot be updated');
select throws_ok($$ delete from public.ai_requests where trace_id = 'probe-trace' $$, '23514', null, 'ledger rows cannot be deleted');

select * from finish();
rollback;
