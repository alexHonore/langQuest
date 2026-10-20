-- pgTAP tests for migration 161 (mission credit settled by the database, round-3 leftover 8):
-- one piece of evidence backs one attempt (`mission_evidence_claims`), claims are all or nothing, the first decision
-- of an attempt wins, completions are counted once per credited attempt with `completions = completions + 1`,
-- learners can neither call the settlement nor read or write the claims, and a learner cannot move a completed attempt
-- to another mission or enrollment (`guard_mission_attempt_write`, replaced by 161).
-- Run: `pnpm supabase test db` (needs the local stack), or
--      `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/database/mission_progress_atomic.test.sql`
-- (the whole file rolls back). Without claims (`postgres` role, no JWT) we behave like the service role.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures and role helpers (same conventions as security_hardening.test.sql)
-- ---------------------------------------------------------------------------
create temp table fx (k text primary key, v uuid not null) on commit drop;
insert into fx values
  ('learner', gen_random_uuid()), ('other', gen_random_uuid()),
  ('enrollment', gen_random_uuid()), ('other_enrollment', gen_random_uuid()), ('enrollment2', gen_random_uuid()),
  ('mission', gen_random_uuid()), ('mission2', gen_random_uuid()), ('character', gen_random_uuid()), ('session', gen_random_uuid()),
  ('g1', gen_random_uuid()), ('g2', gen_random_uuid()), ('g3', gen_random_uuid()), ('g_other', gen_random_uuid()),
  ('a1', gen_random_uuid()), ('a2', gen_random_uuid()), ('a3', gen_random_uuid()), ('a4', gen_random_uuid()),
  ('a5', gen_random_uuid()), ('a6', gen_random_uuid()), ('a7', gen_random_uuid()), ('other_attempt', gen_random_uuid());
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
/** A stored decision as the API Worker writes it (`mission_attempts.evaluation`): one step backed by `p_ids`. */
create function pg_temp.decision(p_credited boolean, p_evidence text, p_ids uuid[], p_without_hints boolean default true)
returns jsonb language sql volatile as $$
  select jsonb_build_object(
    'rubric', jsonb_build_object('outcome', case when p_credited then 'success' else 'fail' end),
    'evaluator', jsonb_build_object('objectivesCompleted', '[]'::jsonb, 'skillsExercised', '[]'::jsonb, 'observations', '[]'::jsonb,
                                    'priorityCorrections', '[]'::jsonb, 'summary', '', 'reviewTriggers', '[]'::jsonb,
                                    'relationshipMemoryUpdate', null, 'confidence', null),
    'evaluatorRan', false,
    'credit', jsonb_build_object('version', 'mission-credit@test', 'missionCredited', p_credited, 'withoutHints', p_without_hints,
                                 'gradableSteps', 1, 'creditedSuccesses', case when p_credited then 1 else 0 end,
                                 'steps', jsonb_build_array(jsonb_build_object('stepId', gen_random_uuid(), 'claimedOutcome', 'success',
                                   'evidence', p_evidence, 'creditedOutcome', case when p_evidence = 'speech_evaluation' then 'success' end,
                                   'evidenceIds', to_jsonb(p_ids), 'utteranceConfidence', null))))
$$;
/** One settlement call for the learner's attempt `p` of `mission`. */
create function pg_temp.settle(p text, p_evaluation jsonb, p_seen jsonb default null, p_mission text default 'mission')
returns table (outcome text, contested_ids uuid[]) language sql volatile as $$
  select r.outcome, r.contested_ids
  from public.complete_mission_attempt(pg_temp.uid('learner'), pg_temp.uid(p), pg_temp.uid('enrollment'), pg_temp.uid(p_mission), now(),
                                       '[]'::jsonb, '{}'::text[], p_evaluation, 1, p_seen) r
$$;
create function pg_temp.progress() returns table (completions integer, best text, without_hints boolean, first_set boolean, status text)
language sql stable as $$
  select p.completions, (select k from fx where v = p.best_attempt_id), p.completed_without_hints, p.first_completed_at is not null, p.status
  from public.mission_progress p where p.enrollment_id = pg_temp.uid('enrollment') and p.mission_id = pg_temp.uid('mission')
$$;
create function pg_temp.holder(p text) returns text language sql stable as $$
  select (select k from fx where v = c.attempt_id) from public.mission_evidence_claims c where c.evidence_id = pg_temp.uid(p)
$$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '@mission-atomic.test', '', now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
from fx where k in ('learner', 'other');
insert into public.user_course_enrollments (id, user_id, course_track_id, source_language_code) values
  (pg_temp.uid('enrollment'), pg_temp.uid('learner'), 'french', 'en'),
  (pg_temp.uid('other_enrollment'), pg_temp.uid('other'), 'french', 'en');
-- The learner's second (paused) French course, from Spanish.
insert into public.user_course_enrollments (id, user_id, course_track_id, source_language_code, status) values
  (pg_temp.uid('enrollment2'), pg_temp.uid('learner'), 'french', 'es', 'paused');
insert into public.missions (id, template_key, target_variety_id, state) values
  (pg_temp.uid('mission'), 'test.mission_atomic', 'fr', 'published'),
  (pg_temp.uid('mission2'), 'test.mission_atomic_2', 'fr', 'published');
insert into public.characters (id, character_key, name, role, personality, home_region, target_variety_id, state)
  values (pg_temp.uid('character'), 'test.mission_atomic.char', 'Test', 'barista', 'warm', 'Paris', 'fr', 'published');
insert into public.conversation_sessions (id, user_id, enrollment_id, character_id, target_variety_id, source_language_code)
  values (pg_temp.uid('session'), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('character'), 'fr', 'en');
-- Speech-route grading rows (three of the learner's, one of the other learner's).
insert into public.learning_observations (id, user_id, enrollment_id, skill_key, observation_type, scenario_id, autonomy, outcome, scorer_kind, scorer_version)
select pg_temp.uid(k), pg_temp.uid(case when k = 'g_other' then 'other' else 'learner' end), pg_temp.uid(case when k = 'g_other' then 'other_enrollment' else 'enrollment' end),
       'speaking.intelligibility', 'semantic_success', pg_temp.uid('mission')::text, 'unaided', 'success', 'deterministic', 'speech-route@test'
from unnest(array['g1', 'g2', 'g3', 'g_other']) k;
insert into public.mission_attempts (id, user_id, enrollment_id, mission_id, client_attempt_id)
select pg_temp.uid(k), pg_temp.uid('learner'), pg_temp.uid('enrollment'), pg_temp.uid('mission'), gen_random_uuid()
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']) k;
insert into public.mission_attempts (id, user_id, enrollment_id, mission_id, client_attempt_id)
  values (pg_temp.uid('other_attempt'), pg_temp.uid('other'), pg_temp.uid('other_enrollment'), pg_temp.uid('mission'), gen_random_uuid());

-- ---------------------------------------------------------------------------
-- 1. Schema, RLS and privileges
-- ---------------------------------------------------------------------------
select has_table('public', 'mission_evidence_claims', 'mission_evidence_claims exists');
select col_is_pk('public', 'mission_evidence_claims', 'evidence_id', 'one claim per evidence id (primary key)');
select is((select relrowsecurity from pg_class where oid = 'public.mission_evidence_claims'::regclass), true, 'RLS is enabled on mission_evidence_claims');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'mission_evidence_claims'), 0, 'no learner policy on mission_evidence_claims');
select has_function('public', 'complete_mission_attempt', array['uuid', 'uuid', 'uuid', 'uuid', 'timestamp with time zone', 'jsonb', 'text[]', 'jsonb', 'integer', 'jsonb'], 'complete_mission_attempt exists');
select ok(not has_function_privilege('authenticated', 'public.complete_mission_attempt(uuid, uuid, uuid, uuid, timestamptz, jsonb, text[], jsonb, integer, jsonb)', 'execute'), 'authenticated cannot execute complete_mission_attempt');
select ok(not has_function_privilege('anon', 'public.complete_mission_attempt(uuid, uuid, uuid, uuid, timestamptz, jsonb, text[], jsonb, integer, jsonb)', 'execute'), 'anon cannot execute complete_mission_attempt');
select ok(has_function_privilege('service_role', 'public.complete_mission_attempt(uuid, uuid, uuid, uuid, timestamptz, jsonb, text[], jsonb, integer, jsonb)', 'execute'), 'service_role can execute complete_mission_attempt');

-- ---------------------------------------------------------------------------
-- 2. A credited decision: claims taken, decision stored, one completion counted
-- ---------------------------------------------------------------------------
select results_eq($$ select * from pg_temp.settle('a1', pg_temp.decision(true, 'speech_evaluation', array[pg_temp.uid('g1'), pg_temp.uid('g2')])) $$,
  $$ values ('written'::text, '{}'::uuid[]) $$, 'a credited decision is written');
select is(pg_temp.holder('g1'), 'a1', 'grading row g1 is claimed by a1');
select is(pg_temp.holder('g2'), 'a1', 'grading row g2 is claimed by a1');
select is((select evidence_kind from public.mission_evidence_claims where evidence_id = pg_temp.uid('g1')), 'grading_row', 'the claim records its kind');
select ok((select completed_at is not null and evaluation -> 'credit' ->> 'missionCredited' = 'true' and current_step_index = 1 from public.mission_attempts where id = pg_temp.uid('a1')),
  'the attempt is completed with the stored decision');
select results_eq($$ select * from pg_temp.progress() $$, $$ values (1, 'a1'::text, true, true, 'completed'::text) $$,
  'mission_progress: one completion, best attempt a1, without hints, first completion set');

-- ---------------------------------------------------------------------------
-- 3. First write wins: a second evaluation of a1 changes nothing and replays
-- ---------------------------------------------------------------------------
select results_eq($$ select * from pg_temp.settle('a1', pg_temp.decision(true, 'speech_evaluation', array[pg_temp.uid('g3')])) $$,
  $$ values ('already_decided'::text, '{}'::uuid[]) $$, 'a second decision for a1 is refused (already_decided)');
select is(pg_temp.holder('g3'), null, 'the refused decision claimed nothing');
select is((select completions from pg_temp.progress()), 1, 'the replay is not counted');

-- ---------------------------------------------------------------------------
-- 4. Claims are all or nothing: a decision naming a held row is contested and writes nothing
-- ---------------------------------------------------------------------------
select results_eq($$ select * from pg_temp.settle('a2', pg_temp.decision(true, 'speech_evaluation', array[pg_temp.uid('g2'), pg_temp.uid('g3')])) $$,
  $$ select 'contested'::text, array[pg_temp.uid('g2')] $$, 'a2 naming g2 (held by a1) is contested on g2 only');
select is(pg_temp.holder('g3'), null, 'the free row g3 was not kept by the contested call');
select ok((select completed_at is null and evaluation is null from public.mission_attempts where id = pg_temp.uid('a2')), 'a2 is still open, without a decision');
select is((select completions from pg_temp.progress()), 1, 'nothing was counted for the contested call');
-- Re-decided without the held row.
select results_eq($$ select * from pg_temp.settle('a2', pg_temp.decision(true, 'speech_evaluation', array[pg_temp.uid('g3')], false)) $$,
  $$ values ('written'::text, '{}'::uuid[]) $$, 'a2 re-decided on g3 alone is written');
select is(pg_temp.holder('g3'), 'a2', 'g3 is claimed by a2');
select results_eq($$ select * from pg_temp.progress() $$, $$ values (2, 'a2'::text, true, true, 'completed'::text) $$,
  'completions = completions + 1 (2), best attempt a2, without-hints stays true once earned');
select is((select count(*)::int from public.mission_evidence_claims where evidence_id = any(array[pg_temp.uid('g1'), pg_temp.uid('g2'), pg_temp.uid('g3')])), 3,
  'three rows, three claims: none backs two attempts');

-- ---------------------------------------------------------------------------
-- 5. An uncredited decision completes the mission for navigation but is not counted
-- ---------------------------------------------------------------------------
select results_eq($$ select * from pg_temp.settle('a3', pg_temp.decision(false, 'none', '{}'::uuid[], false)) $$,
  $$ values ('written'::text, '{}'::uuid[]) $$, 'an uncredited decision is written');
select results_eq($$ select * from pg_temp.progress() $$, $$ values (2, 'a2'::text, true, true, 'completed'::text) $$,
  'completions, best attempt, without-hints and first completion are unchanged by an uncredited attempt');
select ok((select last_completed_at = (select completed_at from public.mission_attempts where id = pg_temp.uid('a3')) from public.mission_progress
           where enrollment_id = pg_temp.uid('enrollment') and mission_id = pg_temp.uid('mission')), 'last_completed_at moves to the latest completion');

-- ---------------------------------------------------------------------------
-- 6. Conversation sessions are claimed the same way
-- ---------------------------------------------------------------------------
select results_eq($$ select * from pg_temp.settle('a4', pg_temp.decision(true, 'conversation_evaluator', array[pg_temp.uid('session')])) $$,
  $$ values ('written'::text, '{}'::uuid[]) $$, 'a decision backed by a conversation session is written');
select is((select evidence_kind from public.mission_evidence_claims where evidence_id = pg_temp.uid('session')), 'conversation_session', 'the session is claimed as a conversation_session');
select results_eq($$ select * from pg_temp.settle('a5', pg_temp.decision(true, 'conversation_evaluator', array[pg_temp.uid('session')])) $$,
  $$ select 'contested'::text, array[pg_temp.uid('session')] $$, 'the same session cannot back a second attempt');
select is((select completions from pg_temp.progress()), 3, 'the session-backed attempt was counted once (3)');

-- ---------------------------------------------------------------------------
-- 7. Refusals: evidence or attempt of another user, a moved attempt, a malformed decision
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from pg_temp.settle('a5', pg_temp.decision(true, 'speech_evaluation', array[pg_temp.uid('g_other')])) $$,
  '23503', null, 'another learner''s grading row cannot be claimed');
select is(pg_temp.holder('g_other'), null, 'and it stays unclaimed');
select throws_ok($$ select * from public.complete_mission_attempt(pg_temp.uid('learner'), pg_temp.uid('other_attempt'), pg_temp.uid('enrollment'), pg_temp.uid('mission'), now(), '[]', '{}', pg_temp.decision(false, 'none', '{}'), 1) $$,
  '23503', null, 'another learner''s attempt cannot be settled');
select throws_ok($$ select * from pg_temp.settle('a5', pg_temp.decision(false, 'none', '{}'), null, 'mission2') $$,
  '23503', null, 'an attempt of another mission (mission_id is learner-writable) is refused');
select throws_ok($$ select * from pg_temp.settle('a5', '{"rubric":{"outcome":"success"}}'::jsonb) $$,
  '22023', null, 'a decision without a credit block is refused');
select ok((select completed_at is null from public.mission_attempts where id = pg_temp.uid('a5')), 'a5 is still open after the refusals');

-- ---------------------------------------------------------------------------
-- 8. Replacing an unreadable earlier decision: only the exact document the caller read, never counted again
-- ---------------------------------------------------------------------------
update public.mission_attempts set completed_at = now(), evaluation = '{"legacy": true}' where id = pg_temp.uid('a6');
select results_eq($$ select * from pg_temp.settle('a6', pg_temp.decision(true, 'none', '{}')) $$,
  $$ values ('already_decided'::text, '{}'::uuid[]) $$, 'a caller that did not read the stored document cannot overwrite it');
select results_eq($$ select * from pg_temp.settle('a6', pg_temp.decision(true, 'none', '{}'), '{"legacy": true}'::jsonb) $$,
  $$ values ('written'::text, '{}'::uuid[]) $$, 'the unreadable document the caller read is replaced');
select is((select completions from pg_temp.progress()), 3, 'a replaced decision is not counted again');

-- ---------------------------------------------------------------------------
-- 9. Learners: no call, no read, no write; a stored decision cannot be unwound
-- ---------------------------------------------------------------------------
select pg_temp.login('learner');
select throws_ok($$ select * from pg_temp.settle('a7', pg_temp.decision(true, 'speech_evaluation', array[pg_temp.uid('g3')])) $$,
  '42501', null, 'a learner cannot call complete_mission_attempt');
select throws_ok($$ select * from public.mission_evidence_claims $$, '42501', null, 'a learner cannot read the claims');
select throws_ok(format($$ insert into public.mission_evidence_claims (evidence_id, evidence_kind, attempt_id, user_id) values (gen_random_uuid(), 'grading_row', %L, %L) $$, pg_temp.uid('a7'), pg_temp.uid('learner')),
  '42501', null, 'a learner cannot insert a claim');
select throws_ok(format($$ delete from public.mission_evidence_claims where attempt_id = %L $$, pg_temp.uid('a1')), '42501', null, 'a learner cannot delete a claim');
select throws_ok(format($$ update public.mission_attempts set evaluation = null, completed_at = null where id = %L $$, pg_temp.uid('a1')),
  '42501', null, 'a learner cannot reopen a decided attempt (guard_mission_attempt_write)');
-- A stored decision is replayed by the API: a completed attempt pointed elsewhere would complete a mission (or course)
-- the learner never played there.
select throws_ok(format($$ update public.mission_attempts set mission_id = %L where id = %L $$, pg_temp.uid('mission2'), pg_temp.uid('a1')),
  '42501', 'a completed attempt keeps the mission and enrollment it was completed for',
  'a learner cannot move a decided attempt to another mission');
select throws_ok(format($$ update public.mission_attempts set enrollment_id = %L where id = %L $$, pg_temp.uid('enrollment2'), pg_temp.uid('a1')),
  '42501', 'a completed attempt keeps the mission and enrollment it was completed for',
  'a learner cannot move a decided attempt to another of their enrollments');
select lives_ok(format($$ update public.mission_attempts set current_step_index = 4, step_results = '[{"ok":true}]' where id = %L $$, pg_temp.uid('a1')),
  'a learner still writes the progress fields of a decided attempt');
select lives_ok(format($$ update public.mission_attempts set mission_id = %L, enrollment_id = %L where id = %L $$, pg_temp.uid('mission2'), pg_temp.uid('enrollment2'), pg_temp.uid('a7')),
  'an open attempt''s mission and enrollment stay learner-writable, as before (complete_mission_attempt re-checks them)');
select lives_ok(format($$ update public.mission_attempts set mission_id = %L, enrollment_id = %L where id = %L $$, pg_temp.uid('mission'), pg_temp.uid('enrollment'), pg_temp.uid('a7')),
  'and can be moved back');
select pg_temp.logout();
select is(pg_temp.holder('g1'), 'a1', 'g1 is still claimed by a1');
select ok((select mission_id = pg_temp.uid('mission') and enrollment_id = pg_temp.uid('enrollment') and current_step_index = 4 from public.mission_attempts where id = pg_temp.uid('a1')),
  'a1 is still an attempt of its mission and enrollment');

-- ---------------------------------------------------------------------------
-- 10. Account deletion: claims go with their attempt
-- ---------------------------------------------------------------------------
delete from public.mission_attempts where id = pg_temp.uid('a4');
select is(pg_temp.holder('session'), null, 'deleting an attempt removes its claims (on delete cascade)');

-- ---------------------------------------------------------------------------
-- 11. Every evidence id of every stored decision (backfilled ones included) is claimed by exactly one attempt
-- ---------------------------------------------------------------------------
select is((
  select count(*)::int
  from public.mission_attempts a
  cross join lateral jsonb_array_elements(case when jsonb_typeof(a.evaluation -> 'credit' -> 'steps') = 'array' then a.evaluation -> 'credit' -> 'steps' else '[]'::jsonb end) st
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(st -> 'evidenceIds') = 'array' then st -> 'evidenceIds' else '[]'::jsonb end) e(txt)
  where a.completed_at is not null and st ->> 'evidence' in ('speech_evaluation', 'conversation_evaluator')
    and e.txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not exists (select 1 from public.mission_evidence_claims c where c.evidence_id = (e.txt)::uuid)
), 0, 'no stored decision names evidence without a claim');

select * from finish();
rollback;
