/**
 * FSRS-like memory model (spec §3.5). Parameterised by a weight vector so the
 * algorithm stays pluggable and testable; defaults follow the published FSRS-4.5
 * shape (17 weights, power forgetting curve).
 *
 * Memory state: stability S (days until R = 90%), difficulty D (1..10),
 * retrievability R (probability of recall now).
 */
import type { MemoryState, ReviewRating } from '@langquest/contracts';

/** Default weight vector (FSRS-4.5 published defaults). */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466,
];

const DECAY = -0.5;
const FACTOR = 19 / 81;
const MIN_STABILITY = 0.01;

export const RATING_GRADE: Readonly<Record<ReviewRating, 1 | 2 | 3 | 4>> = { again: 1, hard: 2, good: 3, easy: 4 };

const clampDifficulty = (d: number): number => Math.min(10, Math.max(1, d));

export interface MemoryModel {
  readonly weights: readonly number[];
  /** Retrievability after `elapsedDays` for a given stability. */
  retrievability(elapsedDays: number, stability: number): number;
  /** Interval (days) at which retrievability decays to `desiredRetention`. */
  intervalForRetention(stability: number, desiredRetention: number): number;
  initialStability(rating: ReviewRating): number;
  initialDifficulty(rating: ReviewRating): number;
  nextDifficulty(difficulty: number, rating: ReviewRating): number;
  nextRecallStability(difficulty: number, stability: number, retrievability: number, rating: ReviewRating): number;
  nextForgetStability(difficulty: number, stability: number, retrievability: number): number;
  /** Full transition of a graduated card. */
  next(memory: MemoryState, elapsedDays: number, rating: ReviewRating): MemoryState;
  /** First review of a new card. */
  initial(rating: ReviewRating): MemoryState;
}

/** Build a memory model for a weight vector (defaults when omitted or malformed). */
export function createMemoryModel(weights?: readonly number[]): MemoryModel {
  const w = weights && weights.length >= 17 ? weights : DEFAULT_WEIGHTS;
  const W = (i: number): number => w[i] ?? DEFAULT_WEIGHTS[i] ?? 0;

  const retrievability = (elapsedDays: number, stability: number): number => {
    if (stability <= 0) return 0;
    return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
  };
  const intervalForRetention = (stability: number, desiredRetention: number): number => {
    const r = Math.min(0.99, Math.max(0.01, desiredRetention));
    return (stability / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
  };
  const initialStability = (rating: ReviewRating): number => Math.max(MIN_STABILITY, W(RATING_GRADE[rating] - 1));
  const initialDifficulty = (rating: ReviewRating): number => clampDifficulty(W(4) - (RATING_GRADE[rating] - 3) * W(5));
  const nextDifficulty = (difficulty: number, rating: ReviewRating): number => {
    const raw = difficulty - W(6) * (RATING_GRADE[rating] - 3);
    // mean reversion toward the difficulty of a "good" first rating
    return clampDifficulty(W(7) * initialDifficulty('good') + (1 - W(7)) * raw);
  };
  const nextRecallStability = (difficulty: number, stability: number, r: number, rating: ReviewRating): number => {
    const hardPenalty = rating === 'hard' ? W(15) : 1;
    const easyBonus = rating === 'easy' ? W(16) : 1;
    const growth = Math.exp(W(8)) * (11 - difficulty) * Math.pow(stability, -W(9)) * (Math.exp(W(10) * (1 - r)) - 1) * hardPenalty * easyBonus;
    return Math.max(MIN_STABILITY, stability * (growth + 1));
  };
  const nextForgetStability = (difficulty: number, stability: number, r: number): number => {
    const s = W(11) * Math.pow(difficulty, -W(12)) * (Math.pow(stability + 1, W(13)) - 1) * Math.exp(W(14) * (1 - r));
    return Math.max(MIN_STABILITY, Math.min(s, stability));
  };
  const initial = (rating: ReviewRating): MemoryState => ({ stability: initialStability(rating), difficulty: initialDifficulty(rating), retrievability: 1 });
  const next = (memory: MemoryState, elapsedDays: number, rating: ReviewRating): MemoryState => {
    const r = retrievability(elapsedDays, memory.stability);
    const difficulty = nextDifficulty(memory.difficulty, rating);
    const stability = rating === 'again' ? nextForgetStability(memory.difficulty, memory.stability, r) : nextRecallStability(memory.difficulty, memory.stability, r, rating);
    return { stability, difficulty, retrievability: 1 };
  };

  return { weights: w, retrievability, intervalForRetention, initialStability, initialDifficulty, nextDifficulty, nextRecallStability, nextForgetStability, next, initial };
}

export const DEFAULT_MEMORY_MODEL: MemoryModel = createMemoryModel();
