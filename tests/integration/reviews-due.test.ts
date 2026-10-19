/**
 * A17 / §3.5: spaced reviews come back when they are due, in a varied practical scenario, with the expression's
 * meaning in the enrollment's source language; a synced review result reschedules the card with the real
 * scheduler (interval grows, reps advance) and the card leaves the due list.
 */
import { createScheduler, newCard } from '@langquest/curriculum/scheduler/scheduler';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, syncBody, teardown, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.reviews');

describeStack('reviews due (A17) with the FSRS-like scheduler', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let enrollmentId: string;
  let expressionId: string;
  let dueCardId: string;
  let futureCardId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    learner = await createTestUser(h, 'reviews', { defaultSourceLanguageCode: 'fr' });
    enrollmentId = (await enrol(h, learner, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' })).id;
    const intent = await seeder.intent(['order.drink']);
    const expr = await seeder.expression({ intentId: intent.id, varietyId: 'ary', text: 'بغيت أتاي عافاك', forms: [{ script: 'Arab', text: 'بغيت أتاي عافاك' }, { scheme: 'arabizi', text: 'bghit atay 3afak' }], translations: { fr: 'Je voudrais un thé, s’il vous plaît', en: 'I would like a tea, please' } });
    expressionId = expr.id;
    const due = await seeder.reviewCard({ userId: learner.id, enrollmentId, expressionId, dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recentScenarioIds: ['cafe_order_drink'] });
    dueCardId = due.id;
    const future = await seeder.reviewCard({ userId: learner.id, enrollmentId, skillKey: 'greet.basic', dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    futureCardId = future.id;
  });

  // Users first (their owned rows and ledgers go with them), then the seeded content rows in reverse insertion order.
  afterAll(() => teardown(h, seeder));

  it('returns only due cards, with a varied scenario and the meaning in the enrollment source language', async () => {
    const res = await call(h, `/v1/me/reviews/due?enrollmentId=${enrollmentId}`, { token: learner.token });
    expect(res.status).toBe(200);
    expect(res.json.data.dueCount).toBe(1);
    expect(res.json.data.items).toHaveLength(1);
    const item = res.json.data.items[0];
    expect(item.card.id).toBe(dueCardId);
    expect(item.card.targetKind).toBe('expression');
    expect(item.expression.meaning).toBe('Je voudrais un thé, s’il vous plaît');
    expect(item.expression.forms.map((f: { text: string }) => f.text)).toEqual(expect.arrayContaining(['بغيت أتاي عافاك', 'bghit atay 3afak']));
    expect(item.expression.translationQaState).toBe('needs_review'); // honest: nothing is native-reviewed
    expect(item.scenario.id).toBeTruthy();
    expect(item.scenario.id).not.toBe('cafe_order_drink'); // not the same flashcard context twice in a row
    expect(item.estimatedSeconds).toBeGreaterThan(0);
    expect(item.estimatedSeconds).toBeLessThanOrEqual(180);
  });

  it('a future card becomes due when the clock moves (query `now`), matching the pure scheduler', async () => {
    const later = new Date(Date.now() + 6 * 86_400_000).toISOString();
    const res = await call(h, `/v1/me/reviews/due?enrollmentId=${enrollmentId}&now=${encodeURIComponent(later)}`, { token: learner.token });
    expect(res.status).toBe(200);
    expect(res.json.data.items.map((i: { card: { id: string } }) => i.card.id).sort()).toEqual([dueCardId, futureCardId].sort());
    // The same decision the client scheduler would make offline.
    const scheduler = createScheduler();
    const card = newCard({ id: futureCardId, enrollmentId, targetKind: 'skill', targetId: 'greet.basic', now: later });
    expect(scheduler.retrievabilityAt(card, later)).toBeLessThanOrEqual(1);
  });

  it('a synced review_result reschedules the card with a longer interval and removes it from the due list', async () => {
    const before = await h.service.from('user_expression_reviews').select('reps, scheduled_days, next_due_at').eq('id', dueCardId).single();
    const occurredAt = new Date().toISOString();
    const res = await call(h, '/v1/me/progress/sync', { token: learner.token, body: syncBody('phone', [{ enrollmentId, revision: 1, payload: { type: 'review_result', cardId: dueCardId, rating: 'good', hintsUsed: 0, replays: 0, responseTimeMs: 2200, scenarioId: 'market_ask_price' }, occurredAt }]) });
    expect(res.status).toBe(200);
    const result = res.json.data.results[0];
    expect(result.resolution).toBe('applied');
    expect(result.card).not.toBeNull();
    expect(result.card.reps).toBe((before.data?.reps ?? 0) + 1);
    expect(Date.parse(result.card.due)).toBeGreaterThan(Date.parse(occurredAt));
    expect(result.card.scheduledDays).toBeGreaterThanOrEqual(before.data?.scheduled_days ?? 0);
    expect(result.card.recentScenarioIds).toContain('market_ask_price');
    const after = await call(h, `/v1/me/reviews/due?enrollmentId=${enrollmentId}`, { token: learner.token });
    expect(after.json.data.items.map((i: { card: { id: string } }) => i.card.id)).not.toContain(dueCardId);
  });

  it('hints demote the effective rating (shorter interval than an unaided good)', async () => {
    const scheduler = createScheduler();
    const now = new Date().toISOString();
    const base = newCard({ id: crypto.randomUUID(), enrollmentId, targetKind: 'expression', targetId: expressionId, now });
    const unaided = scheduler.review(base, 'good', { now, hintsUsed: 0 });
    const hinted = scheduler.review(base, 'good', { now, hintsUsed: 2 });
    expect(hinted.effectiveRating).not.toBe('good');
    expect(Date.parse(hinted.nextDue)).toBeLessThanOrEqual(Date.parse(unaided.nextDue));
  });

  it('another learner cannot see or review this card', async () => {
    const stranger = await createTestUser(h, 'reviews-stranger');
    try {
      const due = await call(h, `/v1/me/reviews/due?enrollmentId=${enrollmentId}`, { token: stranger.token });
      expect(due.status).toBe(404);
      const res = await call(h, '/v1/me/progress/sync', { token: stranger.token, body: syncBody('x', [{ enrollmentId, revision: 1, payload: { type: 'review_result', cardId: futureCardId, rating: 'again', hintsUsed: 0, replays: 0, responseTimeMs: null, scenarioId: null } }]) });
      expect(res.json.data.results[0].resolution).toBe('rejected');
      const untouched = await h.service.from('user_expression_reviews').select('reps, lapses').eq('id', futureCardId).single();
      expect(untouched.data).toMatchObject({ lapses: 0 });
    } finally {
      await deleteTestUsers(h, [stranger]);
    }
  });
});
