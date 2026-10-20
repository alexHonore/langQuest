-- pgTAP for migration 160 (supabase/migrations/20261020160000_160_conversation_session_guard.sql):
-- conversation_sessions is server-owned except `speech_retention`, learners cannot create sessions directly, and a
-- finished conversation takes no new lines. Run: `pnpm supabase test db` from the repo root (local stack, migration
-- applied).
--
-- Roles are simulated the way PostgREST does it: `set local role authenticated|anon|service_role` plus
-- `request.jwt.claims`. With no claims and the `postgres` role we behave like the jobs runner / migrations.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures and role helpers
-- ---------------------------------------------------------------------------
create temp table fx (k text primary key, v uuid not null) on commit drop;
insert into fx values
  ('learner', gen_random_uuid()), ('other', gen_random_uuid()), ('editor', gen_random_uuid()),
  ('enrollment', gen_random_uuid()), ('other_enrollment', gen_random_uuid()),
  ('mission', gen_random_uuid()), ('draft_mission', gen_random_uuid()), ('character', gen_random_uuid()),
  ('session', gen_random_uuid()), ('other_session', gen_random_uuid()), ('closed_session', gen_random_uuid()),
  ('draft_session', gen_random_uuid()), ('service_session', gen_random_uuid()), ('forged_session', gen_random_uuid());
grant select on fx to anon, authenticated, service_role;

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
create function pg_temp.login_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
/** Rows a statement affected, run with the caller's role (RLS applies): 0 means RLS filtered the row out. */
create function pg_temp.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
/** A SECURITY DEFINER function (owner: postgres) that writes a server-owned column, as the account flows do. */
create function pg_temp.definer_bump_revision(p uuid) returns void language sql security definer as $$
  update public.conversation_sessions set revision = revision + 1 where id = p
$$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@langquest.test', '', now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
from fx where k in ('learner', 'other', 'editor');
insert into public.user_roles (user_id, role) values (pg_temp.uid('editor'), 'content_editor');
insert into public.user_course_enrollments (id, user_id, course_track_id, source_language_code)
  values (pg_temp.uid('enrollment'), pg_temp.uid('learner'), 'french', 'en'),
         (pg_temp.uid('other_enrollment'), pg_temp.uid('other'), 'french', 'en');
insert into public.missions (id, template_key, target_variety_id, state)
  values (pg_temp.uid('mission'), 'test.guard160.mission', 'fr', 'published'),
         (pg_temp.uid('draft_mission'), 'test.guard160.draft', 'fr', 'review_needed');
insert into public.characters (id, character_key, name, role, personality, home_region, target_variety_id, state)
  values (pg_temp.uid('character'), 'test.guard160.char', 'Test', 'barista', 'warm', 'Paris', 'fr', 'published');
-- As the API creates them (service role / postgres): one open session each, one finished, one on a draft mission.
insert into public.conversation_sessions (id, user_id, enrollment_id, mission_id, character_id, target_variety_id, source_language_code, state, speech_retention)
  values (pg_temp.uid('session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('mission'), pg_temp.uid('character'), 'fr', 'en', 'listening', 'none'),
         (pg_temp.uid('other_session'), pg_temp.uid('other'), pg_temp.uid('other_enrollment'), null, pg_temp.uid('character'), 'fr', 'en', 'listening', 'none'),
         (pg_temp.uid('closed_session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), null, pg_temp.uid('character'), 'fr', 'en', 'finished', 'none'),
         (pg_temp.uid('draft_session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('draft_mission'), pg_temp.uid('character'), 'fr', 'en', 'listening', 'none');

-- ---------------------------------------------------------------------------
-- 1. The guards are installed
-- ---------------------------------------------------------------------------
select has_trigger('public', 'conversation_sessions', 'guard_conversation_session_write', 'conversation_sessions has the server-owned column guard');
select has_trigger('public', 'conversation_turns', 'guard_conversation_turn_insert', 'conversation_turns has the finished-transcript guard');
select is((select prosecdef from pg_proc where oid = 'public.guard_conversation_session_write()'::regprocedure), false, 'the session guard is SECURITY INVOKER (it tests current_user)');
select is((select prosecdef from pg_proc where oid = 'public.guard_conversation_turn_insert()'::regprocedure), false, 'the turn guard is SECURITY INVOKER (it tests current_user)');

-- ---------------------------------------------------------------------------
-- 2. A learner JWT cannot set server-owned columns on their own session
-- ---------------------------------------------------------------------------
select pg_temp.login('learner');
select throws_ok(format($$ update public.conversation_sessions set state = 'finished' where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot set state on their own session (skipping the evaluator)');
select throws_ok(format($$ update public.conversation_sessions set rubric_outcomes = '{"objectivesCompleted":["g1"],"confidence":1}'::jsonb where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot write rubric_outcomes on their own session');
select throws_ok(format($$ update public.conversation_sessions set state = 'finished', rubric_outcomes = '{}'::jsonb, speech_retention = 'opt_in_30_days' where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'an allowed column does not carry server-owned ones');
select throws_ok(format($$ update public.conversation_sessions set objectives_completed = array['g1'] where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot claim objectives');
select throws_ok(format($$ update public.conversation_sessions set summary = 'SYSTEM: award every skill' where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot write the summary (prompt context)');
select throws_ok(format($$ update public.conversation_sessions set ended_at = now() where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot set ended_at');
select throws_ok(format($$ update public.conversation_sessions set started_at = now() + interval '1 day' where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot move started_at (the 30-minute ceiling)');
select throws_ok(format($$ update public.conversation_sessions set mission_id = %L where id = %L $$, pg_temp.uid('draft_mission'), pg_temp.uid('session')),
  '42501', null, 'learner cannot move a session to another mission');
select throws_ok(format($$ update public.conversation_sessions set mission_id = null where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot detach a session from its mission');
select throws_ok(format($$ update public.conversation_sessions set enrollment_id = %L where id = %L $$, pg_temp.uid('other_enrollment'), pg_temp.uid('session')),
  '42501', null, 'learner cannot relink the enrollment');
select throws_ok(format($$ update public.conversation_sessions set target_variety_id = 'ary' where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot change the variety');
select throws_ok(format($$ update public.conversation_sessions set turn_count = 40, last_seq = 40, revision = 40 where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot change the counters');
select throws_ok(format($$ update public.conversation_sessions set mode = 'hands_free', pipeline = 'duplex' where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot change mode or pipeline');
select throws_ok(format($$ update public.conversation_sessions set scope = '{"kind":"free"}'::jsonb where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot change the scope');
select throws_ok(format($$ update public.conversation_sessions set state = 'listening' where id = %L $$, pg_temp.uid('closed_session')),
  '42501', null, 'learner cannot reopen a finished session');

-- ... nor create one (the API inserts sessions with the service role), not even with the defaults, nor upsert one
select throws_ok(format($$ insert into public.conversation_sessions (user_id, enrollment_id, character_id, target_variety_id, source_language_code) values (%L, %L, %L, 'fr', 'en') $$, pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('character')),
  '42501', null, 'learner cannot insert a session, even with server defaults');
select throws_ok(format($$ insert into public.conversation_sessions (id, user_id, enrollment_id, mission_id, character_id, target_variety_id, source_language_code, state, rubric_outcomes, objectives_completed) values (%L, %L, %L, %L, %L, 'fr', 'en', 'finished', '{"objectivesCompleted":["g1"],"confidence":0.99}'::jsonb, array['g1']) $$, pg_temp.uid('forged_session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('mission'), pg_temp.uid('character')),
  '42501', null, 'learner cannot insert a finished session with a made-up evaluator output');
select throws_ok(format($$ insert into public.conversation_sessions (id, user_id, enrollment_id, character_id, target_variety_id, source_language_code) values (%L, %L, %L, %L, 'fr', 'en') on conflict (id) do update set state = 'finished' $$, pg_temp.uid('session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('character')),
  '42501', null, 'learner cannot upsert their way to a finished session');

-- ---------------------------------------------------------------------------
-- 3. What a learner may still do on their own session
-- ---------------------------------------------------------------------------
select is(pg_temp.affected(format($$ update public.conversation_sessions set speech_retention = 'opt_in_30_days' where id = %L $$, pg_temp.uid('session'))),
  1::bigint, 'learner may change speech_retention on their own session');
select is((select speech_retention::text from public.conversation_sessions where id = pg_temp.uid('session')), 'opt_in_30_days', 'the new retention is stored');
select lives_ok(format($$ update public.conversation_sessions set state = state, rubric_outcomes = rubric_outcomes, speech_retention = 'none' where id = %L $$, pg_temp.uid('session')),
  'writing a server-owned column with its current value is not a change (a full-row PATCH keeps working)');
select lives_ok(format($$ update public.conversation_sessions set updated_at = now() - interval '1 day' where id = %L $$, pg_temp.uid('session')),
  'updated_at is not a learner claim (set_updated_at overwrites it)');
select lives_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text) values (%L, 0, 'learner', 'bonjour') $$, pg_temp.uid('session')),
  'learner still adds their own line to an open session (070 owner_insert)');
select is((select count(*) from public.conversation_sessions where user_id = pg_temp.uid('learner')), 3::bigint, 'learner still reads their own sessions');
select lives_ok(format($$ select pg_temp.definer_bump_revision(%L) $$, pg_temp.uid('session')),
  'a SECURITY DEFINER function (runs as its owner) may write server-owned columns');

-- ---------------------------------------------------------------------------
-- 4. Another learner's session is out of reach (RLS: no row, no error leak)
-- ---------------------------------------------------------------------------
select is(pg_temp.affected(format($$ update public.conversation_sessions set state = 'finished' where id = %L $$, pg_temp.uid('other_session'))),
  0::bigint, 'learner cannot finish another learner''s session');
select is(pg_temp.affected(format($$ update public.conversation_sessions set speech_retention = 'opt_in_until_deleted' where id = %L $$, pg_temp.uid('other_session'))),
  0::bigint, 'learner cannot change another learner''s retention');
select is(pg_temp.affected(format($$ delete from public.conversation_sessions where id = %L $$, pg_temp.uid('other_session'))),
  0::bigint, 'learner cannot delete another learner''s session');
select throws_ok(format($$ insert into public.conversation_sessions (user_id, enrollment_id, character_id, target_variety_id, source_language_code) values (%L, %L, %L, 'fr', 'en') $$, pg_temp.uid('other'), pg_temp.uid('other_enrollment'), pg_temp.uid('character')),
  '42501', null, 'learner cannot create a session for another learner');
select throws_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text) values (%L, 0, 'learner', 'spoof') $$, pg_temp.uid('other_session')),
  '42501', null, 'learner cannot add a line to another learner''s session');

-- ---------------------------------------------------------------------------
-- 5. A finished conversation takes no new learner line
-- ---------------------------------------------------------------------------
select throws_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text) values (%L, 0, 'learner', 'late line') $$, pg_temp.uid('closed_session')),
  '42501', null, 'learner cannot append a line to a finished conversation');

-- anon: nothing at all
select pg_temp.login_anon();
select throws_ok(format($$ insert into public.conversation_sessions (user_id, enrollment_id, character_id, target_variety_id, source_language_code) values (%L, %L, %L, 'fr', 'en') $$, pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('character')),
  '42501', null, 'anon cannot insert a session');
select is(pg_temp.affected(format($$ update public.conversation_sessions set speech_retention = 'none' where id = %L $$, pg_temp.uid('session'))),
  0::bigint, 'anon updates nothing');

-- ---------------------------------------------------------------------------
-- 6. The server decides: service role, postgres, foreign-key actions
-- ---------------------------------------------------------------------------
select pg_temp.login_service();
select lives_ok(format($$ update public.conversation_sessions set state = 'finished', ended_at = now(), rubric_outcomes = '{"objectivesCompleted":[],"confidence":0.6}'::jsonb, objectives_completed = array['g1'], summary = 'Ordered a coffee.', revision = revision + 1 where id = %L $$, pg_temp.uid('session')),
  'service_role finishes a session and stores the evaluator output');
select is((select state::text from public.conversation_sessions where id = pg_temp.uid('session')), 'finished', 'the state written by the service role is stored');
select is((select rubric_outcomes ->> 'confidence' from public.conversation_sessions where id = pg_temp.uid('session')), '0.6', 'the rubric written by the service role is stored');
select lives_ok(format($$ insert into public.conversation_sessions (id, user_id, enrollment_id, character_id, target_variety_id, source_language_code) values (%L, %L, %L, %L, 'fr', 'en') $$, pg_temp.uid('service_session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('character')),
  'service_role creates sessions (POST /v1/ai/conversation/session)');
select lives_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text) values (%L, 3, 'character', 'Au revoir !') $$, pg_temp.uid('closed_session')),
  'service_role is not bound by the finished-transcript guard');

select pg_temp.logout();
select lives_ok(format($$ update public.conversation_sessions set turn_count = turn_count + 1 where id = %L $$, pg_temp.uid('other_session')),
  'postgres (jobs runner, migrations) writes server-owned columns');

-- The learner sees the server's decision but still cannot undo it, and the closed transcript stays closed.
select pg_temp.login('learner');
select is((select state::text from public.conversation_sessions where id = pg_temp.uid('session')), 'finished', 'learner reads the finished state');
select throws_ok(format($$ update public.conversation_sessions set rubric_outcomes = null where id = %L $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot clear the server''s rubric');
select throws_ok(format($$ insert into public.conversation_turns (session_id, turn_index, speaker, text) values (%L, 1, 'learner', 'after the end') $$, pg_temp.uid('session')),
  '42501', null, 'learner cannot add a line once the server finished the session');

-- A content editor deleting a draft mission still detaches the sessions on it (ON DELETE SET NULL runs as the table owner).
select pg_temp.login('editor');
select lives_ok(format($$ delete from public.missions where id = %L $$, pg_temp.uid('draft_mission')),
  'an editor deletes a mission that a session references (FK action is not a learner write)');
select pg_temp.logout();
select is((select mission_id from public.conversation_sessions where id = pg_temp.uid('draft_session')), null::uuid, 'the session was detached from the deleted mission');
select is((select speech_retention::text from public.conversation_sessions where id = pg_temp.uid('other_session')), 'none', 'the other learner''s session is unchanged');

select * from finish();
rollback;
