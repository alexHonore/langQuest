/**
 * Pluggable spaced-repetition scheduler for expressions AND communicative skills (§3.5).
 *
 *  - `Scheduler.review(card, grade, context)` applies one review and returns the new
 *    card, its next due time and the chosen interval, plus a `ReviewLogEntry` draft.
 *  - `selectDueCards()` picks reviews by retrievability (most fragile first) and
 *    `reviewBudget()` enforces the crowding guard so novel content is never crowded out.
 *  - All randomness (interval fuzz, scenario variety) is seeded from card identity.
 */
import {
  DEFAULT_SCHEDULER_PARAMS,
  SchedulerParamsSchema,
  type MemoryState,
  type ReviewCard,
  type ReviewCardState,
  type ReviewLogEntry,
  type ReviewRating,
  type ReviewTargetKind,
  type SchedulerParams,
} from '@langquest/contracts';
import { Seeded, fnv1a32 } from '../planner/random';
import { createMemoryModel, type MemoryModel } from './fsrs';

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

export interface ReviewContext {
  /** ISO timestamp of the review. */
  now: string;
  hintsUsed: number;
  replays?: number;
  responseTimeMs?: number | null;
  /** Optional evaluator quality 0..5; when present it refines the rating before the hint penalty. */
  quality?: number | null;
  scenarioId?: string | null;
  missionId?: string | null;
}

export interface ReviewResult {
  card: ReviewCard;
  nextDue: string;
  /** Scheduled interval in days (fractions for learning steps). */
  intervalDays: number;
  /** Rating actually applied after hint/quality adjustment. */
  effectiveRating: ReviewRating;
  log: Omit<ReviewLogEntry, 'id'>;
}

export interface Scheduler {
  readonly params: SchedulerParams;
  readonly model: MemoryModel;
  readonly version: string;
  review(card: ReviewCard, rating: ReviewRating, context: ReviewContext): ReviewResult;
  /** Probability of recall at `now`. */
  retrievabilityAt(card: ReviewCard, now: string): number;
}

const RATING_ORDER: readonly ReviewRating[] = ['again', 'hard', 'good', 'easy'];

/** Lower a rating by `levels` grades (never below `again`). */
export const demoteRating = (rating: ReviewRating, levels: number): ReviewRating => RATING_ORDER[Math.max(0, RATING_ORDER.indexOf(rating) - levels)]!;

/** Map an evaluator quality (0..5) to a rating. */
export function ratingFromQuality(quality: number): ReviewRating {
  if (quality >= 4.5) return 'easy';
  if (quality >= 3) return 'good';
  if (quality >= 2) return 'hard';
  return 'again';
}

/**
 * Hints lower the effective quality of a recall: one hint demotes by one grade,
 * two or more hints demote by two (a hinted "easy" is at best "hard"; a hinted "good"
 * after two hints is "again"). A reveal is always `again` for scheduling purposes.
 */
export function effectiveRating(rating: ReviewRating, hintsUsed: number, quality?: number | null): ReviewRating {
  let base = rating;
  if (quality !== null && quality !== undefined) {
    const q = ratingFromQuality(quality);
    base = RATING_ORDER.indexOf(q) < RATING_ORDER.indexOf(rating) ? q : rating;
  }
  if (hintsUsed <= 0) return base;
  return demoteRating(base, Math.min(2, hintsUsed));
}

/** Deterministic ±fuzz on an interval so reviews do not pile up on the same day. */
export function fuzzInterval(intervalDays: number, fuzzFactor: number, seedKey: string): number {
  if (fuzzFactor <= 0 || intervalDays < 2.5) return intervalDays;
  const rnd = new Seeded(seedKey).range(-1, 1);
  return Math.max(1, intervalDays * (1 + rnd * fuzzFactor));
}

const daysBetween = (fromIso: string | null, toIso: string): number => (fromIso ? Math.max(0, (new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_DAY) : 0);

/** Index of the learning/relearning step the card is currently on (derived from `scheduledDays`). */
export function currentStepIndex(card: ReviewCard, stepsMinutes: readonly number[]): number {
  const scheduledMinutes = Math.round(card.scheduledDays * 1440);
  const idx = stepsMinutes.findIndex((m) => Math.round(m) === scheduledMinutes);
  return idx < 0 ? 0 : idx;
}

/** Create a brand-new card (state `new`, due now). */
export function newCard(input: { id: string; enrollmentId: string; targetKind: ReviewTargetKind; targetId: string; now: string; difficultyHint?: number }): ReviewCard {
  const difficulty = input.difficultyHint === undefined ? 5 : Math.min(10, Math.max(1, 1 + input.difficultyHint * 9));
  return {
    id: input.id,
    enrollmentId: input.enrollmentId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    state: 'new',
    memory: { stability: 0, difficulty, retrievability: 0 },
    due: input.now,
    lastReviewedAt: null,
    reps: 0,
    lapses: 0,
    scheduledDays: 0,
    elapsedDays: 0,
    recentScenarioIds: [],
  };
}

/** Build the FSRS-like scheduler. */
export function createScheduler(overrides: Partial<SchedulerParams> = {}): Scheduler {
  const params = SchedulerParamsSchema.parse({ ...DEFAULT_SCHEDULER_PARAMS, ...overrides });
  const model = createMemoryModel(params.weights);
  const version = `${params.algorithmVersion}/r${params.desiredRetention}`;

  const retrievabilityAt = (card: ReviewCard, now: string): number => {
    if (card.state === 'new' || card.memory.stability <= 0) return 0;
    return model.retrievability(daysBetween(card.lastReviewedAt, now), card.memory.stability);
  };

  const graduatedInterval = (memory: MemoryState, seedKey: string): number => {
    const raw = model.intervalForRetention(memory.stability, params.desiredRetention);
    const capped = Math.min(params.maximumIntervalDays, Math.max(1, Math.round(raw)));
    return Math.min(params.maximumIntervalDays, Math.round(fuzzInterval(capped, params.fuzzFactor, seedKey)));
  };

  const review = (card: ReviewCard, rating: ReviewRating, context: ReviewContext): ReviewResult => {
    const applied = effectiveRating(rating, context.hintsUsed, context.quality);
    const elapsedDays = daysBetween(card.lastReviewedAt, context.now);
    const memoryBefore = card.state === 'new' ? null : card.memory;
    const seedKey = `${card.id}:${card.reps + 1}`;

    let memory: MemoryState;
    let state: ReviewCardState;
    let intervalDays: number;
    let lapses = card.lapses;

    const stepInterval = (steps: readonly number[], index: number): number => (steps[Math.min(index, steps.length - 1)] ?? 10) / 1440;

    if (card.state === 'new') {
      memory = model.initial(applied);
      if (applied === 'easy' || params.learningStepsMinutes.length === 0) {
        state = 'review';
        intervalDays = graduatedInterval(memory, seedKey);
      } else if (applied === 'good' && params.learningStepsMinutes.length === 1) {
        state = 'review';
        intervalDays = graduatedInterval(memory, seedKey);
      } else {
        state = 'learning';
        intervalDays = stepInterval(params.learningStepsMinutes, applied === 'good' ? 1 : 0);
      }
    } else if (card.state === 'learning' || card.state === 'relearning') {
      const steps = card.state === 'learning' ? params.learningStepsMinutes : params.relearningStepsMinutes;
      const idx = currentStepIndex(card, steps);
      // Short-interval steps still update memory using the elapsed time (bounded by the step).
      memory = model.next(card.memory, elapsedDays, applied);
      if (applied === 'again') {
        state = card.state;
        intervalDays = stepInterval(steps, 0);
      } else if (applied === 'hard') {
        state = card.state;
        intervalDays = stepInterval(steps, idx) * 1.5;
      } else if (applied === 'good' && idx + 1 < steps.length) {
        state = card.state;
        intervalDays = stepInterval(steps, idx + 1);
      } else {
        state = 'review';
        intervalDays = graduatedInterval(memory, seedKey);
      }
    } else {
      memory = model.next(card.memory, elapsedDays, applied);
      if (applied === 'again') {
        lapses += 1;
        if (params.relearningStepsMinutes.length > 0) {
          state = 'relearning';
          intervalDays = stepInterval(params.relearningStepsMinutes, 0);
        } else {
          state = 'review';
          intervalDays = 1;
        }
      } else {
        state = 'review';
        intervalDays = graduatedInterval(memory, seedKey);
        if (applied === 'hard') {
          // A hard recall never grows the interval by more than 20% over the previous schedule.
          const hardCap = Math.max(1, Math.round(card.scheduledDays * 1.2));
          intervalDays = Math.max(1, Math.min(intervalDays, hardCap));
        }
      }
    }

    const nextDue = new Date(new Date(context.now).getTime() + intervalDays * MS_PER_DAY).toISOString();
    const recent = context.scenarioId ? [...card.recentScenarioIds.filter((s) => s !== context.scenarioId), context.scenarioId].slice(-5) : card.recentScenarioIds;
    const nextCard: ReviewCard = {
      ...card,
      state,
      memory,
      due: nextDue,
      lastReviewedAt: context.now,
      reps: card.reps + 1,
      lapses,
      scheduledDays: intervalDays,
      elapsedDays,
      recentScenarioIds: recent,
    };
    return {
      card: nextCard,
      nextDue,
      intervalDays,
      effectiveRating: applied,
      log: {
        cardId: card.id,
        enrollmentId: card.enrollmentId,
        reviewedAt: context.now,
        rating: applied,
        quality: context.quality ?? null,
        hintsUsed: context.hintsUsed,
        replays: context.replays ?? 0,
        responseTimeMs: context.responseTimeMs ?? null,
        intervalDays: elapsedDays,
        scheduledDays: intervalDays,
        nextDue,
        memoryBefore,
        memoryAfter: memory,
        stateBefore: card.state,
        stateAfter: state,
        scenarioId: context.scenarioId ?? null,
        missionId: context.missionId ?? null,
        schedulerVersion: version,
      },
    };
  };

  return { params, model, version, review, retrievabilityAt };
}

// ---------------------------------------------------------------------------
// Due selection & crowding guard
// ---------------------------------------------------------------------------

export interface DueSelectionOptions {
  now: string;
  limit: number;
  /** Also include cards whose predicted retrievability fell below this even if not yet due. */
  retrievabilityThreshold?: number;
  /** Alternate expression/skill cards so a session is not all one kind. */
  interleaveKinds?: boolean;
}

export interface DueCard {
  card: ReviewCard;
  retrievability: number;
  overdueDays: number;
}

/**
 * Retention-based due selection: cards that are due (or predicted below the threshold),
 * most fragile first. Deterministic ordering.
 */
export function selectDueCards(scheduler: Scheduler, cards: readonly ReviewCard[], options: DueSelectionOptions): DueCard[] {
  const nowMs = new Date(options.now).getTime();
  const threshold = options.retrievabilityThreshold ?? -1;
  const due: DueCard[] = [];
  for (const card of cards) {
    const r = scheduler.retrievabilityAt(card, options.now);
    const dueMs = new Date(card.due).getTime();
    const isDue = dueMs <= nowMs || (card.state !== 'new' && r < threshold);
    if (!isDue) continue;
    due.push({ card, retrievability: r, overdueDays: Math.max(0, (nowMs - dueMs) / MS_PER_DAY) });
  }
  due.sort((a, b) => a.retrievability - b.retrievability || b.overdueDays - a.overdueDays || a.card.id.localeCompare(b.card.id));
  const picked = options.interleaveKinds ? interleaveByKind(due) : due;
  return picked.slice(0, Math.max(0, options.limit));
}

function interleaveByKind(items: readonly DueCard[]): DueCard[] {
  const expressions = items.filter((d) => d.card.targetKind === 'expression');
  const skills = items.filter((d) => d.card.targetKind === 'skill');
  const out: DueCard[] = [];
  let e = 0;
  let s = 0;
  while (e < expressions.length || s < skills.length) {
    if (e < expressions.length) out.push(expressions[e++]!);
    if (s < skills.length) out.push(skills[s++]!);
  }
  return out;
}

export interface ReviewBudgetInput {
  /** Total activity slots (or minutes) planned for the session. */
  sessionSlots: number;
  dueCount: number;
  /** Max share of the session that reviews may take (default 0.5, §3.5 crowding guard). */
  maxReviewShare?: number;
  params?: Pick<SchedulerParams, 'maxReviewsPerSession'>;
}

/** Review-crowding guard: how many reviews a session may contain. */
export function reviewBudget(input: ReviewBudgetInput): number {
  const share = Math.min(1, Math.max(0, input.maxReviewShare ?? 0.5));
  const cap = input.params?.maxReviewsPerSession ?? DEFAULT_SCHEDULER_PARAMS.maxReviewsPerSession;
  if (input.dueCount <= 0 || input.sessionSlots <= 0) return 0;
  return Math.max(1, Math.min(input.dueCount, cap, Math.floor(input.sessionSlots * share)));
}

/**
 * Choose a scenario for a review that differs from the card's recent scenarios (§3.5:
 * reintroduce in a different context, not identical flashcard recall). Deterministic.
 */
export function chooseReviewScenario(card: ReviewCard, scenarioIds: readonly string[], seedKey = `${card.id}:${card.reps}`): string | null {
  if (scenarioIds.length === 0) return null;
  const fresh = scenarioIds.filter((s) => !card.recentScenarioIds.includes(s));
  const pool = fresh.length ? fresh : scenarioIds;
  return pool[new Seeded(fnv1a32(seedKey)).int(pool.length)] ?? null;
}

/** Minutes until a card is due (negative when overdue). */
export const minutesUntilDue = (card: ReviewCard, now: string): number => (new Date(card.due).getTime() - new Date(now).getTime()) / MS_PER_MINUTE;
