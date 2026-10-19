/**
 * §5.5 / §11 "forged progress": learners can never write XP, mastery, mission outcomes, achievements or
 * observations directly — the ledgers are owner-read-only under RLS, the attempt outcome columns are guarded
 * by a trigger, `award_xp` is service-only, and sync claims are validated against owned, completed rows with
 * canonical amounts. Checked at the DB layer (as the learner's JWT) and through the API.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, syncBody, teardown, userClient, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('security.forged-progress');

describeStack('forged XP / mastery / outcome writes are refused', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let enrollmentId: string;
  let missionId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    learner = await createTestUser(h, 'forger', { defaultSourceLanguageCode: 'en' });
    enrollmentId = (await enrol(h, learner, { courseTrackId: 'german', sourceLanguageCode: 'en' })).id;
    missionId = (await seeder.mission({ varietyId: 'de' })).id;
  });

  // Users first (their owned rows and ledgers go with them), then the seeded content rows in reverse insertion order.
  afterAll(() => teardown(h, seeder));

  it('DB: direct inserts into xp_ledger, user_skill_mastery, mission_progress, user_achievements, learning_observations and device_sync_events fail', async () => {
    const db = userClient(h, learner);
    const inserts: Array<[string, PromiseLike<{ error: { message: string } | null }>]> = [
      ['xp_ledger', db.from('xp_ledger').insert({ user_id: learner.id, enrollment_id: enrollmentId, amount: 1000, reason: 'mission_completed', idempotency_key: crypto.randomUUID() })],
      ['user_skill_mastery', db.from('user_skill_mastery').insert({ user_id: learner.id, enrollment_id: enrollmentId, skill_key: 'greet.basic', mastery_state: 'durable', internal_score: 1, evidence_count: 99, uncertainty: 0 })],
      ['mission_progress', db.from('mission_progress').insert({ user_id: learner.id, enrollment_id: enrollmentId, mission_id: missionId, status: 'completed', completions: 10 })],
      ['user_achievements', db.from('user_achievements').insert({ user_id: learner.id, enrollment_id: enrollmentId, achievement_key: 'first_mission', client_event_id: crypto.randomUUID() })],
      ['learning_observations', db.from('learning_observations').insert({ user_id: learner.id, enrollment_id: enrollmentId, skill_key: 'greet.basic', observation_type: 'semantic_success', scenario_id: 'x', autonomy: 'unaided', hints_used: 0, outcome: 'success', scorer_kind: 'human', scorer_version: 'me', uncertainty: 0 } as never)],
      ['device_sync_events', db.from('device_sync_events').insert({ user_id: learner.id, device_id: 'x', client_event_id: crypto.randomUUID(), payload_type: 'xp_claim', payload: {}, revision: 1, client_occurred_at: new Date().toISOString(), resolution: 'applied' } as never)],
      ['streak_activity', db.from('streak_activity').insert({ user_id: learner.id, activity_date: '2026-10-15', minutes_active: 999 } as never)],
    ];
    for (const [table, p] of inserts) {
      const res = await p;
      expect(res.error, `${table} must not be writable by learners`).not.toBeNull();
    }
    const xp = await h.service.rpc('user_total_xp', { p_user_id: learner.id });
    expect(Number(xp.data)).toBe(0);
    const mastery = await h.service.from('user_skill_mastery').select('id').eq('enrollment_id', enrollmentId);
    expect(mastery.data).toEqual([]);
  });

  it('DB: a learner may create an attempt but not decide its outcome (completed_at / evaluation / xp_awarded / objectives)', async () => {
    const db = userClient(h, learner);
    const forgedInsert = await db.from('mission_attempts').insert({ user_id: learner.id, enrollment_id: enrollmentId, mission_id: missionId, client_attempt_id: crypto.randomUUID(), completed_at: new Date().toISOString(), xp_awarded: 500 });
    expect(forgedInsert.error).not.toBeNull();
    const honest = await db.from('mission_attempts').insert({ user_id: learner.id, enrollment_id: enrollmentId, mission_id: missionId, client_attempt_id: crypto.randomUUID() }).select('id').single();
    expect(honest.error).toBeNull();
    seeder.track('mission_attempts', honest.data!.id);
    const forgedUpdate = await db.from('mission_attempts').update({ completed_at: new Date().toISOString(), objectives_completed: ['g1'], xp_awarded: 500 }).eq('id', honest.data!.id).select('id');
    expect(forgedUpdate.error).not.toBeNull();
    const allowedUpdate = await db.from('mission_attempts').update({ current_step_index: 2, abandoned_at: new Date().toISOString() }).eq('id', honest.data!.id).select('id');
    expect(allowedUpdate.error).toBeNull();
    const row = await h.service.from('mission_attempts').select('completed_at, xp_awarded, objectives_completed, current_step_index').eq('id', honest.data!.id).single();
    expect(row.data).toMatchObject({ completed_at: null, xp_awarded: 0, objectives_completed: [], current_step_index: 2 });
  });

  it('DB: award_xp and set_enrollment_source_language cannot be abused from a learner session', async () => {
    const db = userClient(h, learner);
    const award = await db.rpc('award_xp', { p_idempotency_key: crypto.randomUUID(), p_user_id: learner.id, p_amount: 1000, p_reason: 'mission_completed', p_enrollment_id: enrollmentId });
    expect(award.error).not.toBeNull(); // execute revoked from authenticated
    const stranger = await createTestUser(h, 'forger-stranger');
    try {
      const strangerDb = userClient(h, stranger);
      const hijack = await strangerDb.rpc('set_enrollment_source_language', { p_enrollment_id: enrollmentId, p_source_language_code: 'ru' } as never);
      expect(hijack.error !== null || hijack.data === null || (Array.isArray(hijack.data) && hijack.data.length === 0)).toBe(true);
      const still = await h.service.from('user_course_enrollments').select('source_language_code').eq('id', enrollmentId).single();
      expect(still.data?.source_language_code).toBe('en');
    } finally {
      await deleteTestUsers(h, [stranger]);
    }
    const total = await h.service.rpc('user_total_xp', { p_user_id: learner.id });
    expect(Number(total.data)).toBe(0);
  });

  it('API: inflated or unbacked XP claims and client-assigned acoustic observations are rejected or normalised', async () => {
    const attempt = await h.service.from('mission_attempts').insert({ user_id: learner.id, enrollment_id: enrollmentId, mission_id: missionId, client_attempt_id: crypto.randomUUID(), completed_at: new Date().toISOString() }).select('id').single();
    seeder.track('mission_attempts', attempt.data!.id);
    const res = await call(h, '/v1/me/progress/sync', {
      token: learner.token,
      body: syncBody('phone', [
        { enrollmentId, revision: 1, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: attempt.data!.id, amount: 100_000 } },
        { enrollmentId, revision: 2, payload: { type: 'xp_claim', reason: 'achievement', referenceId: crypto.randomUUID(), amount: 25 } },
        { enrollmentId, revision: 3, payload: { type: 'xp_claim', reason: 'daily_goal', referenceId: null, amount: 10 } },
        { enrollmentId, revision: 4, payload: { type: 'observation', observation: { enrollmentId, skillKey: 'greet.basic', observationType: 'pronunciation', scenarioId: 'x', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 1, scorerKind: 'human', scorerVersion: 'me', uncertainty: 0, note: null } } },
      ]),
    });
    expect(res.status).toBe(200);
    const [inflated, unbacked, noRef, acoustic] = res.json.data.results;
    expect(inflated).toMatchObject({ resolution: 'applied', xpCredited: 50 });
    expect(unbacked.resolution).toBe('rejected');
    expect(noRef.resolution).toBe('rejected');
    expect(acoustic.resolution).toBe('rejected');
    const total = await h.service.rpc('user_total_xp', { p_user_id: learner.id });
    expect(Number(total.data)).toBe(50);
    const progress = await call(h, '/v1/me/progress', { token: learner.token });
    expect(progress.json.data.totalXp).toBe(50);
  });

  it('API: a client-reported pronunciation observation from a deterministic scorer never advances mastery on its own', async () => {
    const res = await call(h, '/v1/me/progress/sync', { token: learner.token, body: syncBody('phone', [{ enrollmentId, revision: 5, payload: { type: 'observation', observation: { enrollmentId, skillKey: 'pronounce.umlaut', observationType: 'pronunciation', scenarioId: 'x', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 1, scorerKind: 'deterministic', scorerVersion: 'client', uncertainty: 0, note: null } } }]) });
    expect(res.status).toBe(200);
    const mastery = await h.service.from('user_skill_mastery').select('mastery_state, evidence_count').eq('enrollment_id', enrollmentId).eq('skill_key', 'pronounce.umlaut').maybeSingle();
    // Either not materialised at all, or recorded with zero usable evidence (pronunciation from non-acoustic scorers is excluded).
    if (mastery.data) {
      expect(['not_attempted', 'emerging']).toContain(mastery.data.mastery_state);
    }
  });
});
