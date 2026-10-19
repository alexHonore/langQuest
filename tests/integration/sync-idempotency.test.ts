/**
 * A27 / §4.5 / §4.6: offline-first progress sync is idempotent across devices. The same client event from two
 * devices is applied once; replays answer `duplicate`; XP claims are validated server-side (owned, completed
 * reference row + canonical amount); engine-handled events (observation, review_result) survive and are marked
 * applied; events for someone else's enrollment are rejected and never leak.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, syncBody, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.sync');

describeStack('progress sync idempotency (A27)', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let alice: TestUser;
  let bob: TestUser;
  let enrollmentId: string;
  let missionId: string;
  let completedAttemptId: string;
  let openAttemptId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    [alice, bob] = await Promise.all([createTestUser(h, 'sync-alice', { defaultSourceLanguageCode: 'fr' }), createTestUser(h, 'sync-bob')]);
    enrollmentId = (await enrol(h, alice, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' })).id;
    const mission = await seeder.mission({ varietyId: 'ary' });
    missionId = mission.id;
    const completed = await h.service.from('mission_attempts').insert({ user_id: alice.id, enrollment_id: enrollmentId, mission_id: missionId, client_attempt_id: crypto.randomUUID(), completed_at: new Date().toISOString() }).select('id').single();
    completedAttemptId = completed.data!.id;
    seeder.track('mission_attempts', completedAttemptId);
    const open = await h.service.from('mission_attempts').insert({ user_id: alice.id, enrollment_id: enrollmentId, mission_id: missionId, client_attempt_id: crypto.randomUUID() }).select('id').single();
    openAttemptId = open.data!.id;
    seeder.track('mission_attempts', openAttemptId);
  });

  afterAll(async () => {
    await h.app.flush();
    await seeder.cleanup();
    await deleteTestUsers(h, [alice, bob]);
  });

  it('pays the same XP claim once when two devices race, then answers duplicate forever', async () => {
    const clientEventId = crypto.randomUUID();
    const claim = (device: string) => syncBody(device, [{ clientEventId, enrollmentId, revision: 3, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: completedAttemptId, amount: 9999 } }]);
    const [phone, tablet] = await Promise.all([call(h, '/v1/me/progress/sync', { token: alice.token, body: claim('phone') }), call(h, '/v1/me/progress/sync', { token: alice.token, body: claim('tablet') })]);
    expect(phone.status).toBe(200);
    expect(tablet.status).toBe(200);
    const results = [phone.json.data.results[0], tablet.json.data.results[0]];
    expect(results.filter((r) => r.resolution === 'applied')).toHaveLength(1);
    expect(results.filter((r) => r.resolution === 'duplicate')).toHaveLength(1);
    expect(results.find((r) => r.resolution === 'applied').xpCredited).toBe(50); // canonical, not the 9999 the client sent
    for (let i = 0; i < 3; i++) {
      const replay = await call(h, '/v1/me/progress/sync', { token: alice.token, body: claim(i % 2 ? 'phone' : 'tablet') });
      expect(replay.json.data.results[0].resolution).toBe('duplicate');
      expect(replay.json.data.results[0].xpCredited ?? 0).toBe(0);
    }
    const ledger = await h.service.from('xp_ledger').select('amount, reason').eq('user_id', alice.id);
    expect(ledger.data).toEqual([{ amount: 50, reason: 'mission_completed' }]);
    const total = await h.service.rpc('user_total_xp', { p_user_id: alice.id });
    expect(Number(total.data)).toBe(50);
    const events = await h.service.from('device_sync_events').select('client_event_id, resolution, applied_at').eq('user_id', alice.id).eq('client_event_id', clientEventId);
    expect(events.data).toHaveLength(1); // the ledger is append-only and unique per client event
    expect(events.data![0]!.resolution).toBe('applied');
  });

  it('rejects claims that are not backed by an owned, completed reference row', async () => {
    const res = await call(h, '/v1/me/progress/sync', {
      token: alice.token,
      body: syncBody('phone', [
        { enrollmentId, revision: 4, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: openAttemptId, amount: 50 } },
        { enrollmentId, revision: 5, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: null, amount: 50 } },
        { enrollmentId, revision: 6, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: crypto.randomUUID(), amount: 50 } },
        { enrollmentId, revision: 7, payload: { type: 'xp_claim', reason: 'achievement', referenceId: completedAttemptId, amount: 25 } },
      ]),
    });
    expect(res.status).toBe(200);
    for (const r of res.json.data.results) {
      expect(r.resolution, JSON.stringify(r)).toBe('rejected');
      expect(r.xpCredited ?? 0).toBe(0);
    }
    const total = await h.service.rpc('user_total_xp', { p_user_id: alice.id });
    expect(Number(total.data)).toBe(50);
  });

  it('a second claim for the same completed attempt under a new client event is still paid only once', async () => {
    const res = await call(h, '/v1/me/progress/sync', { token: alice.token, body: syncBody('laptop', [{ enrollmentId, revision: 8, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: completedAttemptId, amount: 50 } }]) });
    const r = res.json.data.results[0];
    // Honest answer: the event is recorded, but the reference was already paid (xp_ledger_reference_once).
    expect(r.xpCredited ?? 0).toBe(0);
    expect(r.resolution === 'duplicate' || (r.resolution === 'applied' && r.reason === 'already_awarded')).toBe(true);
    const ledger = await h.service.from('xp_ledger').select('id').eq('user_id', alice.id).eq('reference_id', completedAttemptId);
    expect(ledger.data).toHaveLength(1);
    const total = await h.service.rpc('user_total_xp', { p_user_id: alice.id });
    expect(Number(total.data)).toBe(50);
  });

  it('engine-handled observations survive, recompute mastery, and are marked applied exactly once', async () => {
    const clientEventId = crypto.randomUUID();
    const observation = { enrollmentId, skillKey: 'order.drink', observationType: 'semantic_success', scenarioId: 'cafe', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 0.9, scorerKind: 'deterministic', scorerVersion: 'tests', uncertainty: 0.2, note: null };
    const body = syncBody('phone', [{ clientEventId, enrollmentId, revision: 9, payload: { type: 'observation', observation } }]);
    const first = await call(h, '/v1/me/progress/sync', { token: alice.token, body });
    expect(first.json.data.results[0].resolution).toBe('applied');
    const replay = await call(h, '/v1/me/progress/sync', { token: alice.token, body });
    expect(replay.json.data.results[0].resolution).toBe('duplicate');
    const observations = await h.service.from('learning_observations').select('id').eq('enrollment_id', enrollmentId).eq('skill_key', 'order.drink');
    expect(observations.data).toHaveLength(1);
    const mastery = await call(h, `/v1/me/skills?enrollmentId=${enrollmentId}`, { token: alice.token });
    expect(mastery.json.data.items.map((i: { skillKey: string }) => i.skillKey)).toContain('order.drink');
    const applied = await h.service.from('device_sync_events').select('applied_at, resolution').eq('user_id', alice.id).eq('client_event_id', clientEventId).single();
    expect(applied.data?.resolution).toBe('applied');
    expect(applied.data?.applied_at).toBeTruthy();
  });

  it('refuses client-assigned acoustic/human scorer kinds (only server assessors may claim those)', async () => {
    const forged = { enrollmentId, skillKey: 'pronounce.q', observationType: 'pronunciation', scenarioId: 'cafe', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 1, scorerKind: 'acoustic_assessor', scorerVersion: 'fake', uncertainty: 0, note: null };
    const res = await call(h, '/v1/me/progress/sync', { token: alice.token, body: syncBody('phone', [{ enrollmentId, revision: 10, payload: { type: 'observation', observation: forged } }]) });
    expect(res.json.data.results[0].resolution).toBe('rejected');
    const rows = await h.service.from('learning_observations').select('id').eq('enrollment_id', enrollmentId).eq('skill_key', 'pronounce.q');
    expect(rows.data).toHaveLength(0);
  });

  it('rejects events aimed at another learner\'s enrollment without revealing it exists', async () => {
    const res = await call(h, '/v1/me/progress/sync', { token: bob.token, body: syncBody('bob-phone', [{ enrollmentId, revision: 1, payload: { type: 'enrollment_opened', enrollmentId } }, { enrollmentId, revision: 2, payload: { type: 'xp_claim', reason: 'mission_completed', referenceId: completedAttemptId, amount: 50 } }]) });
    expect(res.status).toBe(200);
    for (const r of res.json.data.results) expect(r.resolution).toBe('rejected');
    const bobXp = await h.service.rpc('user_total_xp', { p_user_id: bob.id });
    expect(Number(bobXp.data)).toBe(0);
    const touched = await h.service.from('user_course_enrollments').select('last_opened_at').eq('id', enrollmentId).single();
    expect(touched.data?.last_opened_at).toBeNull();
  });

  it('validates the batch shape before touching the database', async () => {
    expect((await call(h, '/v1/me/progress/sync', { token: alice.token, body: { deviceId: 'x', clientSentAt: new Date().toISOString(), events: [] } })).status).toBe(422);
    expect((await call(h, '/v1/me/progress/sync', { token: alice.token, body: syncBody('x', [{ enrollmentId, revision: 1, payload: { type: 'bogus' } }]) })).status).toBe(422);
    expect((await call(h, '/v1/me/progress/sync', { body: syncBody('x', [{ enrollmentId, revision: 1, payload: { type: 'enrollment_opened', enrollmentId } }]) })).status).toBe(401);
  });
});
