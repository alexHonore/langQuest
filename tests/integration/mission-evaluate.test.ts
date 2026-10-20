/**
 * §6.1 mission loop (A11/A16/A27): attempts are idempotent on `clientAttemptId`; evaluation runs the deterministic
 * rubric, writes observations → mastery → XP (once, server-validated) → review cards → achievements → planner; a
 * replayed evaluation never double-awards; failed missions award nothing; anticipation steps that were revealed
 * without an attempt count as `revealed` autonomy, not unaided success.
 *
 * Step outcomes the client reports are claims: a speaking step is credited only against a grading row the speech route
 * wrote for one of the learner's takes (`apps/api/src/lib/xp-credit.ts`), so each evaluation first records the takes
 * (`recordSpeechGradings`), one per speaking step of the mission.
 */
import { MissionEvaluateResponseSchema } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, describeWithStack, enrol, recordSpeechGradings, Seeder, teardown, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.mission');

describeStack('mission attempt → evaluate → progress', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let enrollmentId: string;
  let missionId: string;
  let nextMissionId: string;
  let stepIds: string[];
  let expressionId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    learner = await createTestUser(h, 'mission', { defaultSourceLanguageCode: 'en' });
    enrollmentId = (await enrol(h, learner, { courseTrackId: 'spanish-spain', sourceLanguageCode: 'en' })).id;
    const course = await seeder.course({ trackId: 'spanish-spain' });
    const chapter = await seeder.chapter({ courseId: course.id });
    const intent = await seeder.intent(['order.drink']);
    const expr = await seeder.expression({ intentId: intent.id, varietyId: 'es-ES', text: 'Un café con leche, por favor', forms: [{ script: 'Latn', text: 'Un café con leche, por favor' }], translations: { en: 'A latte, please', fr: 'Un café au lait, s’il vous plaît' } });
    expressionId = expr.id;
    const mission = await seeder.mission({ chapterId: chapter.id, varietyId: 'es-ES', titles: { en: 'Order at the café' }, goals: [{ id: 'g1', skill_keys: ['order.drink'] }], sortOrder: 0 });
    missionId = mission.id;
    await seeder.localization(mission.id, 'en', { title: 'Order at the café', instructions: 'Order a drink politely.' });
    const steps = await seeder.steps(mission.id, ['context_listening', 'modeled_expression', 'anticipation', 'feedback_retry', 'review_recall'], [expr.id]);
    stepIds = steps.map((s) => s.id);
    const next = await seeder.mission({ chapterId: chapter.id, varietyId: 'es-ES', titles: { en: 'Ask for the bill' }, goals: [{ id: 'g1', skill_keys: ['pay.ask_bill'] }], sortOrder: 1 });
    nextMissionId = next.id;
    await seeder.steps(next.id, ['context_listening', 'modeled_expression']);
  });

  // Users first (their owned rows and ledgers go with them), then the seeded content rows in reverse insertion order.
  afterAll(() => teardown(h, seeder));

  const stepResult = (stepId: string, overrides: Partial<Record<string, unknown>> = {}) => ({ stepId, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 45_000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: null, ...overrides });

  it('mission detail is localized and exposes semantic (intent) expectations, never exact phrases', async () => {
    const res = await call(h, `/v1/missions/${missionId}?source=en&enrollmentId=${enrollmentId}`, { token: learner.token });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ id: missionId, title: 'Order at the café', sourceLanguageCode: 'en', targetVarietyId: 'es-ES', localizationComplete: false });
    expect(res.json.data.steps).toHaveLength(5);
    const modeled = res.json.data.steps.find((s: { type: string }) => s.type === 'modeled_expression');
    expect(modeled.expressions[0]).toMatchObject({ id: expressionId, meaning: 'A latte, please', translationQaState: 'needs_review' });
    expect(Array.isArray(modeled.validIntentIds)).toBe(true);
  });

  it('attempts are idempotent on clientAttemptId and scoped to the enrollment variety', async () => {
    const clientAttemptId = crypto.randomUUID();
    const body = { enrollmentId, clientAttemptId, missionRevision: 0, startedAt: new Date().toISOString() };
    const first = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body });
    expect(first.status).toBe(201);
    expect(first.json.data.replayed).toBe(false);
    const replay = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body });
    expect(replay.status).toBe(200);
    expect(replay.json.data).toMatchObject({ attemptId: first.json.data.attemptId, replayed: true });
    const otherVariety = await enrol(h, learner, { courseTrackId: 'italian', sourceLanguageCode: 'en' });
    const wrong = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body: { ...body, enrollmentId: otherVariety.id, clientAttemptId: crypto.randomUUID() } });
    expect(wrong.status).toBe(422);
  });

  it('evaluates once: XP 50 canonical, mastery recorded, reviews scheduled, next mission from the planner; replay never double-awards', async () => {
    const attempt = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body: { enrollmentId, clientAttemptId: crypto.randomUUID(), missionRevision: 0, startedAt: new Date().toISOString() } });
    const attemptId = attempt.json.data.attemptId as string;
    // Four speaking steps (modeled_expression, anticipation, feedback_retry, review_recall), four graded takes.
    await recordSpeechGradings(h.service, { userId: learner.id, enrollmentId, missionId, expressionId, outcomes: ['success', 'success', 'success', 'success'] });
    const clientEventId = crypto.randomUUID();
    const body = { attemptId, enrollmentId, completedAt: new Date().toISOString(), clientEventId, stepResults: stepIds.map((id, i) => stepResult(id, i === 2 ? { attemptedBeforeReveal: true } : {})) };
    const res = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const data = MissionEvaluateResponseSchema.parse(res.json.data);
    expect(data.xpAwarded).toBeGreaterThanOrEqual(50);
    expect(data.xpReplayed).toBe(false);
    expect(data.evaluation.objectivesCompleted).toContain('g1');
    expect(data.scheduledReviews.some((r) => r.targetKind === 'expression' && r.targetId === expressionId)).toBe(true);
    expect(data.nextMissionId).toBe(nextMissionId);
    const skills = await call(h, `/v1/me/skills?enrollmentId=${enrollmentId}`, { token: learner.token });
    expect(skills.json.data.items.map((i: { skillKey: string }) => i.skillKey)).toContain('order.drink');
    const progressBefore = await call(h, '/v1/me/progress', { token: learner.token });
    const xpBefore = progressBefore.json.data.totalXp as number;
    expect(xpBefore).toBeGreaterThanOrEqual(50);
    // Replay (same clientEventId, same attempt): identical outcome, no new XP, no duplicate evidence.
    const replay = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body });
    expect(replay.status).toBe(200);
    expect(replay.json.data.xpReplayed).toBe(true);
    const progressAfter = await call(h, '/v1/me/progress', { token: learner.token });
    expect(progressAfter.json.data.totalXp).toBe(xpBefore);
    const observations = await h.service.from('learning_observations').select('id').eq('enrollment_id', enrollmentId).eq('mission_attempt_id', attemptId);
    const perStep = observations.data?.length ?? 0;
    expect(perStep).toBeGreaterThan(0);
    const ledger = await h.service.from('xp_ledger').select('reason').eq('user_id', learner.id).eq('reason', 'mission_completed');
    expect(ledger.data).toHaveLength(1);
    const per = progressAfter.json.data.perEnrollment.find((p: { enrollmentId: string }) => p.enrollmentId === enrollmentId);
    expect(per.missionsCompleted).toBe(1);
    expect(per.missionsCompletedWithoutHints).toBe(1);
  });

  it('a failed mission awards nothing and schedules no reviews; a revealed anticipation step is not unaided', async () => {
    const attempt = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body: { enrollmentId, clientAttemptId: crypto.randomUUID(), missionRevision: 0, startedAt: new Date().toISOString() } });
    const attemptId = attempt.json.data.attemptId as string;
    // The takes of this attempt were graded as misses (the first attempt's successful takes are already used).
    await recordSpeechGradings(h.service, { userId: learner.id, enrollmentId, missionId, expressionId, outcomes: ['fail', 'fail', 'fail', 'fail'] });
    const before = await h.service.rpc('user_total_xp', { p_user_id: learner.id });
    const res = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body: { attemptId, enrollmentId, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: stepIds.map((id) => stepResult(id, { outcome: 'fail', attemptedBeforeReveal: false, hintsUsed: 2 })) } });
    expect(res.status).toBe(200);
    expect(res.json.data.xpAwarded).toBe(0);
    expect(res.json.data.scheduledReviews).toEqual([]);
    const after = await h.service.rpc('user_total_xp', { p_user_id: learner.id });
    expect(Number(after.data)).toBe(Number(before.data));
    const obs = await h.service.from('learning_observations').select('autonomy, outcome').eq('mission_attempt_id', attemptId);
    expect(obs.data?.length).toBeGreaterThan(0);
    expect(obs.data?.every((o) => o.autonomy === 'revealed' && o.outcome === 'fail')).toBe(true);
  });

  it('rejects step ids from other missions and attempts owned by another enrollment', async () => {
    const attempt = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body: { enrollmentId, clientAttemptId: crypto.randomUUID(), missionRevision: 0, startedAt: new Date().toISOString() } });
    const attemptId = attempt.json.data.attemptId as string;
    const foreignStep = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body: { attemptId, enrollmentId, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: [stepResult(crypto.randomUUID())] } });
    expect(foreignStep.status).toBe(422);
    const wrongMission = await call(h, `/v1/missions/${nextMissionId}/evaluate`, { token: learner.token, body: { attemptId, enrollmentId, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: [stepResult(stepIds[0]!)] } });
    expect(wrongMission.status).toBe(404);
  });
});
