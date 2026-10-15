import type { ReviewCard, ReviewRating } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MEMORY_MODEL, createMemoryModel } from './fsrs';
import { chooseReviewScenario, createScheduler, effectiveRating, fuzzInterval, newCard, reviewBudget, selectDueCards, type Scheduler } from './scheduler';

const ENROLLMENT = '00000000-0000-4000-8000-000000000001';
const T0 = '2026-10-01T09:00:00.000Z';
const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

const card = (id: string, kind: 'expression' | 'skill' = 'expression'): ReviewCard => newCard({ id: `00000000-0000-4000-8000-0000000000${id}`, enrollmentId: ENROLLMENT, targetKind: kind, targetId: `target-${id}`, now: T0 });

/** Review a card repeatedly, always exactly when it is due. */
function run(scheduler: Scheduler, start: ReviewCard, ratings: readonly ReviewRating[], hintsUsed = 0): { intervals: number[]; card: ReviewCard } {
  let c = start;
  const intervals: number[] = [];
  for (const rating of ratings) {
    const res = scheduler.review(c, rating, { now: c.due, hintsUsed });
    intervals.push(res.intervalDays);
    c = res.card;
  }
  return { intervals, card: c };
}

describe('memory model', () => {
  it('retrievability decays with time and interval grows with stability', () => {
    expect(DEFAULT_MEMORY_MODEL.retrievability(0, 10)).toBe(1);
    expect(DEFAULT_MEMORY_MODEL.retrievability(10, 10)).toBeCloseTo(0.9, 2);
    expect(DEFAULT_MEMORY_MODEL.retrievability(30, 10)).toBeLessThan(DEFAULT_MEMORY_MODEL.retrievability(10, 10));
    expect(DEFAULT_MEMORY_MODEL.intervalForRetention(10, 0.9)).toBeCloseTo(10, 5);
    expect(DEFAULT_MEMORY_MODEL.intervalForRetention(20, 0.9)).toBeGreaterThan(DEFAULT_MEMORY_MODEL.intervalForRetention(10, 0.9));
    expect(DEFAULT_MEMORY_MODEL.intervalForRetention(10, 0.8)).toBeGreaterThan(DEFAULT_MEMORY_MODEL.intervalForRetention(10, 0.9));
  });

  it('accepts custom weights and falls back to defaults for short vectors', () => {
    expect(createMemoryModel([1, 2]).weights).toEqual(DEFAULT_MEMORY_MODEL.weights);
    const custom = createMemoryModel([...DEFAULT_MEMORY_MODEL.weights.slice(0, 3), 30, ...DEFAULT_MEMORY_MODEL.weights.slice(4)]);
    expect(custom.initialStability('easy')).toBe(30);
  });
});

describe('scheduler', () => {
  const scheduler = createScheduler({ fuzzFactor: 0 });

  it('is deterministic for identical sequences', () => {
    const a = run(scheduler, card('01'), ['good', 'good', 'good', 'hard', 'good', 'easy']);
    const b = run(scheduler, card('01'), ['good', 'good', 'good', 'hard', 'good', 'easy']);
    expect(a).toEqual(b);
    expect(a.card.reps).toBe(6);
    expect(a.card.state).toBe('review');
  });

  it('intervals grow monotonically with successive successful recalls (property over ratings)', () => {
    for (const rating of ['good', 'easy'] as const) {
      const { intervals } = run(scheduler, card('02'), Array<ReviewRating>(8).fill(rating));
      const graduated = intervals.filter((i) => i >= 1);
      for (let i = 1; i < graduated.length; i++) expect(graduated[i]!, `${rating} step ${i}`).toBeGreaterThanOrEqual(graduated[i - 1]!);
      expect(graduated.at(-1)!).toBeGreaterThan(graduated[0]! * 3);
      expect(graduated.at(-1)!).toBeLessThanOrEqual(scheduler.params.maximumIntervalDays);
    }
  });

  it('hints lower the effective quality and shorten the schedule', () => {
    expect(effectiveRating('good', 0)).toBe('good');
    expect(effectiveRating('good', 1)).toBe('hard');
    expect(effectiveRating('good', 2)).toBe('again');
    expect(effectiveRating('easy', 3)).toBe('hard');
    expect(effectiveRating('good', 0, 1.5)).toBe('again');
    expect(effectiveRating('hard', 0, 5)).toBe('hard');
    const unaided = run(scheduler, card('03'), ['good', 'good', 'good', 'good'], 0);
    const hinted = run(scheduler, card('03'), ['good', 'good', 'good', 'good'], 1);
    expect(hinted.intervals.at(-1)!).toBeLessThan(unaided.intervals.at(-1)!);
    expect(hinted.card.memory.stability).toBeLessThan(unaided.card.memory.stability);
  });

  it('a failed review (again) shortens the interval and increments lapses', () => {
    const good = run(scheduler, card('04'), ['good', 'good', 'good', 'good']);
    const res = scheduler.review(good.card, 'again', { now: good.card.due, hintsUsed: 0 });
    expect(res.intervalDays).toBeLessThan(good.intervals.at(-1)!);
    expect(res.card.lapses).toBe(1);
    expect(res.card.state).toBe('relearning');
    expect(res.card.memory.stability).toBeLessThan(good.card.memory.stability);
    const back = scheduler.review(res.card, 'good', { now: res.card.due, hintsUsed: 0 });
    expect(back.card.state).toBe('review');
  });

  it('walks learning steps before graduating and logs every transition', () => {
    const first = scheduler.review(card('05'), 'good', { now: T0, hintsUsed: 0, scenarioId: 'cafe' });
    expect(first.card.state).toBe('learning');
    expect(first.intervalDays).toBeCloseTo(10 / 1440, 6);
    expect(first.log.stateBefore).toBe('new');
    expect(first.log.memoryBefore).toBeNull();
    expect(first.card.recentScenarioIds).toEqual(['cafe']);
    const second = scheduler.review(first.card, 'good', { now: first.card.due, hintsUsed: 0 });
    expect(second.card.state).toBe('review');
    expect(second.intervalDays).toBeGreaterThanOrEqual(1);
    const easy = scheduler.review(card('06'), 'easy', { now: T0, hintsUsed: 0 });
    expect(easy.card.state).toBe('review');
  });

  it('applies deterministic fuzz only to intervals >= 2.5 days', () => {
    expect(fuzzInterval(2, 0.05, 'k')).toBe(2);
    const a = fuzzInterval(30, 0.05, 'k');
    expect(a).toBe(fuzzInterval(30, 0.05, 'k'));
    expect(Math.abs(a - 30)).toBeLessThanOrEqual(1.5);
  });

  it('respects the desired retention parameter', () => {
    const relaxed = createScheduler({ desiredRetention: 0.8, fuzzFactor: 0 });
    const strict = createScheduler({ desiredRetention: 0.95, fuzzFactor: 0 });
    const r = run(relaxed, card('07'), ['good', 'good', 'good', 'good']);
    const s = run(strict, card('07'), ['good', 'good', 'good', 'good']);
    expect(r.intervals.at(-1)!).toBeGreaterThan(s.intervals.at(-1)!);
  });

  it('works for skill cards the same way as expression cards', () => {
    const skill = run(scheduler, card('08', 'skill'), ['good', 'good', 'good']);
    const expression = run(scheduler, card('08', 'expression'), ['good', 'good', 'good']);
    expect(skill.intervals).toEqual(expression.intervals);
    expect(skill.card.targetKind).toBe('skill');
  });
});

describe('due selection and crowding guard', () => {
  const scheduler = createScheduler({ fuzzFactor: 0 });

  it('selects due cards most-fragile first and interleaves kinds', () => {
    const strong = run(scheduler, card('11'), ['good', 'good', 'good', 'good']).card;
    const weak = run(scheduler, card('12', 'skill'), ['good', 'good']).card;
    const fresh = card('13');
    const future = { ...run(scheduler, card('14'), ['easy']).card };
    const now = addDays(Math.max(new Date(strong.due).getTime(), new Date(weak.due).getTime()) === new Date(strong.due).getTime() ? strong.due : weak.due, 3);
    const due = selectDueCards(scheduler, [strong, weak, fresh, future], { now, limit: 10, interleaveKinds: true });
    expect(due.map((d) => d.card.id)).toContain(fresh.id);
    expect(due.every((d) => new Date(d.card.due).getTime() <= new Date(now).getTime())).toBe(true);
    const ids = due.map((d) => d.card.id);
    expect(ids.indexOf(weak.id)).toBeLessThan(ids.indexOf(strong.id));
    expect(selectDueCards(scheduler, [future], { now: T0, limit: 10 })).toEqual([]);
    expect(selectDueCards(scheduler, [strong], { now: strong.lastReviewedAt!, limit: 10, retrievabilityThreshold: 0.999 })).toEqual([]);
  });

  it('caps reviews per session so new content is never crowded out', () => {
    expect(reviewBudget({ sessionSlots: 10, dueCount: 100 })).toBe(5);
    expect(reviewBudget({ sessionSlots: 10, dueCount: 3 })).toBe(3);
    expect(reviewBudget({ sessionSlots: 1, dueCount: 3 })).toBe(1);
    expect(reviewBudget({ sessionSlots: 10, dueCount: 0 })).toBe(0);
    expect(reviewBudget({ sessionSlots: 100, dueCount: 100, maxReviewShare: 0.9 })).toBe(12);
    expect(reviewBudget({ sessionSlots: 100, dueCount: 100, maxReviewShare: 0.9, params: { maxReviewsPerSession: 30 } })).toBe(30);
  });

  it('chooses a review scenario that differs from recent ones', () => {
    const c = { ...card('15'), recentScenarioIds: ['cafe', 'market'] };
    expect(chooseReviewScenario(c, ['cafe', 'market', 'taxi'])).toBe('taxi');
    expect(['cafe', 'market']).toContain(chooseReviewScenario(c, ['cafe', 'market']));
    expect(chooseReviewScenario(c, [])).toBeNull();
    expect(chooseReviewScenario(c, ['a', 'b', 'c', 'd'], 'seed')).toBe(chooseReviewScenario(c, ['a', 'b', 'c', 'd'], 'seed'));
  });
});
