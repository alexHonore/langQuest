/**
 * Spaced repetition (§3.5) and skill observations (§3.4).
 *
 * The scheduler is FSRS-like and pluggable: these schemas fix the data shapes the
 * curriculum package, DB and API agree on; the algorithm itself lives in
 * `@langquest/curriculum`.
 */
import { z } from 'zod';
import {
  AutonomyLevelSchema,
  MasteryStateSchema,
  ObservationOutcomeSchema,
  ObservationTypeSchema,
  ScorerKindSchema,
} from './enums';
import { KeySchema, MillisSchema, NonNegativeIntSchema, TimestamptzSchema, UnitIntervalSchema, UuidSchema } from './primitives';

/** What a review card schedules: an expression or a communicative skill. */
export const ReviewTargetKindSchema = z.enum(['expression', 'skill']);
export type ReviewTargetKind = z.infer<typeof ReviewTargetKindSchema>;

export const ReviewCardStateSchema = z.enum(['new', 'learning', 'review', 'relearning']);
export type ReviewCardState = z.infer<typeof ReviewCardStateSchema>;

/** Learner rating of a review attempt (FSRS grades). */
export const ReviewRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);
export type ReviewRating = z.infer<typeof ReviewRatingSchema>;

/** FSRS-like memory state. */
export const MemoryStateSchema = z.object({
  /** Days until retrievability drops to 90%. */
  stability: z.number().min(0),
  /** 1..10, higher is harder. */
  difficulty: z.number().min(1).max(10),
  /** Probability of recall right now, [0,1]. */
  retrievability: UnitIntervalSchema,
});
export type MemoryState = z.infer<typeof MemoryStateSchema>;

export const ReviewCardSchema = z.object({
  id: UuidSchema,
  enrollmentId: UuidSchema,
  targetKind: ReviewTargetKindSchema,
  /** `expressions.id` (uuid) or `skills.skill_key`. */
  targetId: z.string().min(1),
  state: ReviewCardStateSchema,
  memory: MemoryStateSchema,
  due: TimestamptzSchema,
  lastReviewedAt: TimestamptzSchema.nullable(),
  reps: NonNegativeIntSchema,
  lapses: NonNegativeIntSchema,
  scheduledDays: z.number().min(0),
  elapsedDays: z.number().min(0),
  /** Scenario ids already used for this card so the next review can vary context (§3.5). */
  recentScenarioIds: z.array(z.string()).default([]),
});
export type ReviewCard = z.infer<typeof ReviewCardSchema>;

export const SchedulerParamsSchema = z.object({
  /** Target recall probability at the time of review. */
  desiredRetention: z.number().min(0.7).max(0.97).default(0.9),
  maximumIntervalDays: z.number().int().min(1).max(3650).default(365),
  /** Algorithm weight vector (FSRS `w`); length depends on `algorithmVersion`. */
  weights: z.array(z.number()).optional(),
  algorithmVersion: z.string().default('fsrs-like-1'),
  /** Minutes for learning steps before graduating. */
  learningStepsMinutes: z.array(z.number().positive()).default([1, 10]),
  relearningStepsMinutes: z.array(z.number().positive()).default([10]),
  /** Fuzz factor (0 disables) to avoid review pile-ups. */
  fuzzFactor: UnitIntervalSchema.default(0.05),
  /** Cap on reviews per session so novel content is not crowded out (§3.5). */
  maxReviewsPerSession: z.number().int().min(1).default(12),
});
export type SchedulerParams = z.infer<typeof SchedulerParamsSchema>;
export const DEFAULT_SCHEDULER_PARAMS: SchedulerParams = SchedulerParamsSchema.parse({});

export const ReviewLogEntrySchema = z.object({
  id: UuidSchema,
  cardId: UuidSchema,
  enrollmentId: UuidSchema,
  reviewedAt: TimestamptzSchema,
  rating: ReviewRatingSchema,
  /** Optional finer-grained quality 0..5 from the evaluator (not shown to learners as a score). */
  quality: z.number().min(0).max(5).nullable(),
  hintsUsed: NonNegativeIntSchema,
  replays: NonNegativeIntSchema,
  responseTimeMs: MillisSchema.nullable(),
  /** Actual elapsed interval since previous review, in days. */
  intervalDays: z.number().min(0),
  /** Scheduled interval chosen by this review, in days. */
  scheduledDays: z.number().min(0),
  nextDue: TimestamptzSchema,
  memoryBefore: MemoryStateSchema.nullable(),
  memoryAfter: MemoryStateSchema,
  stateBefore: ReviewCardStateSchema,
  stateAfter: ReviewCardStateSchema,
  scenarioId: z.string().nullable(),
  missionId: UuidSchema.nullable(),
  schedulerVersion: z.string(),
});
export type ReviewLogEntry = z.infer<typeof ReviewLogEntrySchema>;

/** §3.4 — an observation of learner behaviour, never an invented objective score. */
export const SkillObservationSchema = z.object({
  id: UuidSchema,
  enrollmentId: UuidSchema,
  skillKey: KeySchema,
  observationType: ObservationTypeSchema,
  scenarioId: z.string().min(1),
  missionId: UuidSchema.nullable(),
  missionAttemptId: UuidSchema.nullable(),
  conversationSessionId: UuidSchema.nullable(),
  expressionId: UuidSchema.nullable(),
  autonomy: AutonomyLevelSchema,
  hintsUsed: NonNegativeIntSchema,
  outcome: ObservationOutcomeSchema,
  /** Confidence that the learner's utterance was correctly captured (ASR/transcript confidence). */
  utteranceConfidence: UnitIntervalSchema.nullable(),
  scorerKind: ScorerKindSchema,
  /** Model/provider/prompt version string (e.g. `evaluator@2026-10-01/openrouter:…`). */
  scorerVersion: z.string().min(1),
  /** Scorer's own uncertainty about this observation, [0,1] (1 = fully uncertain). */
  uncertainty: UnitIntervalSchema,
  observedAt: TimestamptzSchema,
  /** Short, learner-safe note (no raw transcript dumps). */
  note: z.string().max(500).nullable(),
});
export type SkillObservation = z.infer<typeof SkillObservationSchema>;

/** Input half of an observation (before persistence assigns id/observedAt). */
export const SkillObservationInputSchema = SkillObservationSchema.omit({ id: true, observedAt: true }).extend({
  observedAt: TimestamptzSchema.optional(),
});
export type SkillObservationInput = z.infer<typeof SkillObservationInputSchema>;

/** Aggregated mastery snapshot per (enrollment, skill). */
export const SkillMasterySnapshotSchema = z.object({
  enrollmentId: UuidSchema,
  skillKey: KeySchema,
  masteryState: MasteryStateSchema,
  /** Internal weighted score, [0,1]; never shown as a grade. */
  internalScore: UnitIntervalSchema,
  evidenceCount: NonNegativeIntSchema,
  uncertainty: UnitIntervalSchema,
  lastPracticedAt: TimestamptzSchema.nullable(),
  dueAt: TimestamptzSchema.nullable(),
});
export type SkillMasterySnapshot = z.infer<typeof SkillMasterySnapshotSchema>;

/** Ordered mastery ladder for comparisons. */
export const MASTERY_ORDER = ['not_attempted', 'emerging', 'practiced', 'independent', 'durable'] as const;
export const masteryRank = (state: z.infer<typeof MasteryStateSchema>): number => MASTERY_ORDER.indexOf(state);
