/** §6.1 — learner account, catalog, enrollments, missions, reviews, progress. */
import { z } from 'zod';
import { CourseTrackIdSchema, CourseTrackSchema, LanguageSchema, LanguageVarietySchema, SourceLanguageCodeSchema, VarietyIdSchema, WritingSystemSchema } from '../catalog';
import { EvaluatorOutputSchema } from '../ai/conversation';
import { AccessibilityOptionsSchema, NotificationPreferencesSchema, PrivacyOptionsSchema } from '../db/identity';
import { CoverageMetricsSchema } from '../db/identity';
import { CoverageStatusSchema, EnrollmentStatusSchema, LearnerLevelSchema, LearningSpeedSchema, LessonTypeSchema, MasteryStateSchema, MissionStepTypeSchema, MissionTypeSchema, ObservationOutcomeSchema, RegisterSchema, RoleSchema, ScriptModeSchema, XpReasonSchema } from '../enums';
import { CourseCapabilitiesSchema } from '../capabilities';
import { CourseManifestSchema, SceneIdSchema, VisualRefSchema, AssetRefSchema } from '../manifest';
import { Bcp47Schema, JsonObjectSchema, KeySchema, MillisSchema, NonNegativeIntSchema, TimestamptzSchema, UnitIntervalSchema, UuidSchema } from '../primitives';
import { ReviewCardSchema, ReviewRatingSchema, SkillMasterySnapshotSchema, SkillObservationInputSchema } from '../srs';
import { confirmQuery, pageOf, PaginationQuerySchema, patchOf, QueryBooleanSchema } from './common';

// --- auth -------------------------------------------------------------------

export const SessionRefreshRequestSchema = z.object({ refreshToken: z.string().min(1) });
export const SessionRefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: TimestamptzSchema,
});

// --- me ---------------------------------------------------------------------

export const EnrollmentDtoSchema = z.object({
  id: UuidSchema,
  courseTrackId: CourseTrackIdSchema,
  sourceLanguageCode: SourceLanguageCodeSchema,
  targetVarietyId: VarietyIdSchema,
  preferredTargetVariantId: VarietyIdSchema.nullable(),
  regionalPreference: z.string().nullable(),
  scriptMode: ScriptModeSchema,
  learnerLevel: LearnerLevelSchema,
  status: EnrollmentStatusSchema,
  preferredLearningSpeed: LearningSpeedSchema,
  activeMissionId: UuidSchema.nullable(),
  translationPeekLanguageCode: SourceLanguageCodeSchema.nullable(),
  addedAt: TimestamptzSchema,
  lastOpenedAt: TimestamptzSchema.nullable(),
  /** Coverage of this (track, source) pair so the UI can show honest editorial status. */
  coverage: z.object({ status: CoverageStatusSchema, nativeReviewed: z.boolean(), editorialNoteKey: z.string().nullable(), fallbackSourceLanguageCode: SourceLanguageCodeSchema.nullable() }),
  /**
   * Live capability snapshot for this enrollment's (track, source) pair (CONVENTIONS §8): drives which tabs /
   * sections / controls the client renders. Always present in API responses; optional in the schema so fixtures
   * built before 2026-10-19 still parse.
   */
  capabilities: CourseCapabilitiesSchema.optional(),
});
export type EnrollmentDto = z.infer<typeof EnrollmentDtoSchema>;

export const MeResponseSchema = z.object({
  userId: UuidSchema,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  uiLocale: Bcp47Schema,
  /** Null until the learner has chosen an instruction language (prefill for NEW enrollments only). */
  defaultSourceLanguageCode: SourceLanguageCodeSchema.nullable(),
  timeZone: z.string(),
  privacyOptions: PrivacyOptionsSchema,
  accessibilityOptions: AccessibilityOptionsSchema,
  roles: z.array(RoleSchema),
  enrollments: z.array(EnrollmentDtoSchema),
  createdAt: TimestamptzSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const PatchSettingsRequestSchema = z
  .object({
    displayName: z.string().max(80).nullable(),
    uiLocale: Bcp47Schema,
    /** Changes the prefill for NEW enrollments only. Existing enrollments are untouched. `null` clears the prefill. */
    defaultSourceLanguageCode: SourceLanguageCodeSchema.nullable(),
    timeZone: z.string(),
    privacyOptions: patchOf(PrivacyOptionsSchema),
    accessibilityOptions: patchOf(AccessibilityOptionsSchema),
    notificationPreferences: patchOf(NotificationPreferencesSchema),
    audioSpeed: z.number().min(0.5).max(1.5),
    defaultHintBehavior: z.enum(['on_request', 'after_pause', 'always']),
    conversationMode: z.enum(['push_to_talk', 'hands_free', 'text_only']),
    offlineDownloadSettings: z.object({ autoDownload: z.boolean(), wifiOnly: z.boolean(), maxStorageMb: NonNegativeIntSchema }).partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one setting must be provided' });
export type PatchSettingsRequest = z.infer<typeof PatchSettingsRequestSchema>;
export const PatchSettingsResponseSchema = MeResponseSchema;

// --- catalog ----------------------------------------------------------------

export const LanguagesResponseSchema = z.object({
  languages: z.array(LanguageSchema),
  varieties: z.array(LanguageVarietySchema),
  writingSystems: z.array(WritingSystemSchema),
  tracks: z.array(CourseTrackSchema),
  sourceLanguages: z.array(z.object({ code: SourceLanguageCodeSchema, priorityTier: z.number().int().min(1).max(4) })),
});
export type LanguagesResponse = z.infer<typeof LanguagesResponseSchema>;

export const CoursesQuerySchema = z.object({
  source: SourceLanguageCodeSchema.optional(),
  target: VarietyIdSchema.optional(),
});
export type CoursesQuery = z.infer<typeof CoursesQuerySchema>;

/** Per-source editorial status (§2.1): honest, never a silent fallback. */
export const SourceCoverageSchema = z.object({
  sourceLanguageCode: SourceLanguageCodeSchema,
  status: CoverageStatusSchema,
  metrics: CoverageMetricsSchema,
  nativeReviewed: z.boolean(),
  reviewedAt: TimestamptzSchema.nullable(),
  editorialNoteKey: z.string().nullable(),
  /** Offered to the learner as an explicit opt-in when coverage is partial. */
  fallbackSourceLanguageCode: SourceLanguageCodeSchema.nullable(),
});
export type SourceCoverage = z.infer<typeof SourceCoverageSchema>;

export const CourseSummarySchema = z.object({
  track: CourseTrackSchema,
  publicationState: z.enum(['published', 'coming_soon', 'in_review']),
  coverArt: VisualRefSchema.nullable(),
  /** Coverage for the requested source (or all sources when none requested). */
  coverage: z.array(SourceCoverageSchema),
  publishedMissionCount: NonNegativeIntSchema,
  publishedAudioLessonCount: NonNegativeIntSchema,
  characterCount: NonNegativeIntSchema,
  /** Live capability snapshot for the track (model/voice/pronunciation availability). */
  capabilities: z.object({ speechRecognition: z.boolean(), speechSynthesis: z.boolean(), realtimeConversation: z.boolean(), pronunciationScoring: z.enum(['full', 'partial', 'limited', 'none']) }),
});
export type CourseSummary = z.infer<typeof CourseSummarySchema>;
export const CoursesResponseSchema = z.object({ courses: z.array(CourseSummarySchema) });

export const CoverageQuerySchema = z.object({ source: SourceLanguageCodeSchema.optional() });
export const CoverageResponseSchema = z.object({
  courseTrackId: CourseTrackIdSchema,
  coverage: z.array(SourceCoverageSchema),
  /** Present when `?source=` was given: the live capability snapshot of that (track, source) pair (CONVENTIONS §8). */
  capabilities: CourseCapabilitiesSchema.optional(),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

// --- enrollments ------------------------------------------------------------

/** §6.5 — `sourceLanguageCode` is REQUIRED; the profile default is only a UI prefill. */
export const EnrollmentCreateRequestSchema = z
  .object({
    courseTrackId: CourseTrackIdSchema,
    sourceLanguageCode: SourceLanguageCodeSchema,
    targetVarietyId: VarietyIdSchema.optional(),
    scriptMode: ScriptModeSchema.optional(),
    regionalPreference: z.string().min(1).max(64).optional(),
    learnerLevel: LearnerLevelSchema.optional(),
    preferredLearningSpeed: LearningSpeedSchema.optional(),
  })
  .strict();
export type EnrollmentCreateRequest = z.infer<typeof EnrollmentCreateRequestSchema>;
export const EnrollmentCreateResponseSchema = EnrollmentDtoSchema;

/**
 * Changing the source language never resets mastery, bookmarks or progress (§2.1).
 * Route contract: `PATCH /v1/me/enrollments/:id?confirm=archive` (`EnrollmentPatchQuerySchema`) is required
 * when the patch sets `status: 'archived'`; without it the API answers `precondition_failed`.
 */
export const EnrollmentPatchRequestSchema = z
  .object({
    sourceLanguageCode: SourceLanguageCodeSchema,
    scriptMode: ScriptModeSchema,
    preferredTargetVariantId: VarietyIdSchema.nullable(),
    regionalPreference: z.string().min(1).max(64).nullable(),
    learnerLevel: LearnerLevelSchema,
    status: EnrollmentStatusSchema,
    preferredLearningSpeed: LearningSpeedSchema,
    translationPeekLanguageCode: SourceLanguageCodeSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });
export type EnrollmentPatchRequest = z.infer<typeof EnrollmentPatchRequestSchema>;
export const EnrollmentPatchResponseSchema = EnrollmentDtoSchema;

/**
 * Query for `PATCH /v1/me/enrollments/:id`. Setting `status: 'archived'` on a non-archived enrollment needs
 * `?confirm=archive`; otherwise the API answers `precondition_failed` with `details.requiredConfirmation`.
 * Archiving keeps all progress and is reversible (restore by patching `status` back to `active`).
 */
export const EnrollmentPatchQuerySchema = confirmQuery('archive');
export type EnrollmentPatchQuery = z.infer<typeof EnrollmentPatchQuerySchema>;

/** Query for `GET /v1/me/enrollments`: archived enrollments are hidden unless `includeArchived=true`. */
export const EnrollmentsListQuerySchema = z.object({ includeArchived: QueryBooleanSchema.default(false) });
export type EnrollmentsListQuery = z.infer<typeof EnrollmentsListQuerySchema>;
export const EnrollmentsListResponseSchema = z.object({ enrollments: z.array(EnrollmentDtoSchema) });

/**
 * Query for `DELETE /v1/me/enrollments/:id` (`ROUTES.enrollmentDelete`). Deletion is permanent and erases the
 * enrollment's own progress (other enrollments and the account are untouched); `?confirm=delete` is required
 * and a request without it answers `precondition_failed` with `details.requiredConfirmation: 'delete'`.
 */
export const EnrollmentDeleteQuerySchema = confirmQuery('delete');
export type EnrollmentDeleteQuery = z.infer<typeof EnrollmentDeleteQuerySchema>;
export const EnrollmentDeleteResponseSchema = z.object({ deleted: z.literal(true), enrollmentId: UuidSchema });
export type EnrollmentDeleteResponse = z.infer<typeof EnrollmentDeleteResponseSchema>;

// --- manifest ---------------------------------------------------------------

export const ManifestQuerySchema = z.object({
  source: SourceLanguageCodeSchema,
  version: z.coerce.number().int().min(0).optional(),
});
export const ManifestResponseSchema = CourseManifestSchema;

// --- missions ---------------------------------------------------------------

export const MissionExpressionSchema = z.object({
  id: UuidSchema,
  canonicalText: z.string(),
  /** Forms per script/transliteration (`native`, `latin`). */
  forms: z.array(z.object({ script: z.string().nullable(), transliterationScheme: z.string().nullable(), text: z.string() })),
  /** Natural meaning in the enrollment's source language. */
  meaning: z.string(),
  contextNote: z.string().nullable(),
  register: RegisterSchema,
  audio: z.array(z.object({ asset: AssetRefSchema, speechRate: z.enum(['slow', 'normal', 'fast']), synthetic: z.boolean(), regionalOption: z.string().nullable() })),
  translationQaState: z.enum(['machine_draft', 'needs_review', 'reviewed', 'approved', 'rejected']),
});
export type MissionExpression = z.infer<typeof MissionExpressionSchema>;

export const MissionStepDetailSchema = z.object({
  id: UuidSchema,
  order: NonNegativeIntSchema,
  type: MissionStepTypeSchema,
  lessonType: LessonTypeSchema.nullable(),
  /** Source-language instruction text (localized to the enrollment's source language). */
  instruction: z.string(),
  hints: z.array(z.string()),
  expressions: z.array(MissionExpressionSchema),
  promptAssets: z.array(AssetRefSchema),
  visuals: z.array(VisualRefSchema),
  /** Valid semantic responses as intent ids — never exact phrase requirements. */
  validIntentIds: z.array(z.string()),
  successConditions: JsonObjectSchema,
  branching: JsonObjectSchema.nullable(),
  estimatedSeconds: NonNegativeIntSchema,
  offlineCapable: z.boolean(),
});

export const MissionDetailQuerySchema = z.object({ source: SourceLanguageCodeSchema, enrollmentId: UuidSchema.optional() });
export const MissionDetailResponseSchema = z.object({
  id: UuidSchema,
  revision: NonNegativeIntSchema,
  type: MissionTypeSchema,
  title: z.string(),
  level: LearnerLevelSchema,
  targetVarietyId: VarietyIdSchema,
  sourceLanguageCode: SourceLanguageCodeSchema,
  /** Honest flag: false when this mission's localization for the requested source is not complete. */
  localizationComplete: z.boolean(),
  goals: z.array(z.object({ id: z.string(), description: z.string(), skillKeys: z.array(KeySchema) })),
  recommendedMinutes: z.number(),
  sceneArt: VisualRefSchema.nullable(),
  /** Editorial scene id (see `ManifestMissionSchema.sceneId`); optional for responses produced before it existed. */
  sceneId: SceneIdSchema.nullable().optional(),
  characters: z.array(z.object({ id: UuidSchema, name: z.string(), role: z.string(), portrait: VisualRefSchema.nullable(), syntheticVoice: z.boolean() })),
  steps: z.array(MissionStepDetailSchema),
  narrative: JsonObjectSchema.nullable(),
});
export type MissionDetailResponse = z.infer<typeof MissionDetailResponseSchema>;

export const MissionAttemptCreateRequestSchema = z.object({
  enrollmentId: UuidSchema,
  /** Client-generated UUID; replay returns the same attempt. */
  clientAttemptId: UuidSchema,
  missionRevision: NonNegativeIntSchema,
  startedAt: TimestamptzSchema,
});
export const MissionAttemptCreateResponseSchema = z.object({
  attemptId: UuidSchema,
  missionId: UuidSchema,
  replayed: z.boolean(),
  startedAt: TimestamptzSchema,
});

export const StepResultSchema = z.object({
  stepId: UuidSchema,
  outcome: ObservationOutcomeSchema,
  hintsUsed: NonNegativeIntSchema,
  replays: NonNegativeIntSchema,
  durationMs: MillisSchema,
  /** Transcript / speech-evaluation ids produced during the step, for evidence linking. */
  speechAssessmentIds: z.array(UuidSchema),
  /** Anticipation steps: learner attempted before reveal (§14.1 A16). */
  attemptedBeforeReveal: z.boolean().nullable(),
  selectedIntentId: z.string().nullable(),
  conversationSessionId: UuidSchema.nullable(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const MissionEvaluateRequestSchema = z.object({
  attemptId: UuidSchema,
  enrollmentId: UuidSchema,
  completedAt: TimestamptzSchema,
  stepResults: z.array(StepResultSchema).min(1),
  /** Client event id for the XP award; duplicates never double-award. */
  clientEventId: UuidSchema,
});
export type MissionEvaluateRequest = z.infer<typeof MissionEvaluateRequestSchema>;

export const MissionEvaluateResponseSchema = z.object({
  attemptId: UuidSchema,
  /** `evaluation.confidence` is `null` whenever no evaluator ran (see `evaluatorRan`). */
  evaluation: EvaluatorOutputSchema,
  /** Honest flag: false when the result is rubric-only (no LLM evaluator). Optional for older servers. */
  evaluatorRan: z.boolean().optional(),
  xpAwarded: NonNegativeIntSchema,
  xpReplayed: z.boolean(),
  masteryChanges: z.array(z.object({ skillKey: KeySchema, from: MasteryStateSchema, to: MasteryStateSchema })),
  scheduledReviews: z.array(z.object({ cardId: UuidSchema, targetKind: z.enum(['expression', 'skill']), targetId: z.string(), due: TimestamptzSchema })),
  achievementsUnlocked: z.array(KeySchema),
  nextMissionId: UuidSchema.nullable(),
});
export type MissionEvaluateResponse = z.infer<typeof MissionEvaluateResponseSchema>;

// --- reviews ----------------------------------------------------------------

export const ReviewsDueQuerySchema = z.object({
  enrollmentId: UuidSchema,
  limit: z.coerce.number().int().min(1).max(50).default(12),
  now: TimestamptzSchema.optional(),
});
export const ReviewItemSchema = z.object({
  card: ReviewCardSchema,
  /** Varied practical scenario chosen for this review (§3.5), not identical flashcard recall. */
  scenario: z.object({ id: z.string(), description: z.string(), characterId: UuidSchema.nullable(), sceneArt: VisualRefSchema.nullable() }),
  expression: MissionExpressionSchema.nullable(),
  skill: z.object({ skillKey: KeySchema, descriptor: z.string() }).nullable(),
  /** Review takes 1–3 minutes; interleaved with new content. */
  estimatedSeconds: NonNegativeIntSchema,
});
export const ReviewsDueResponseSchema = z.object({
  enrollmentId: UuidSchema,
  dueCount: NonNegativeIntSchema,
  items: z.array(ReviewItemSchema),
  generatedAt: TimestamptzSchema,
});
export type ReviewsDueResponse = z.infer<typeof ReviewsDueResponseSchema>;

// --- progress sync (idempotent batch) --------------------------------------

export const ProgressEventPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('review_result'), cardId: UuidSchema, rating: ReviewRatingSchema, hintsUsed: NonNegativeIntSchema, replays: NonNegativeIntSchema, responseTimeMs: MillisSchema.nullable(), scenarioId: z.string().nullable() }),
  z.object({ type: z.literal('step_completed'), attemptId: UuidSchema, stepId: UuidSchema, outcome: ObservationOutcomeSchema, hintsUsed: NonNegativeIntSchema, durationMs: MillisSchema }),
  z.object({ type: z.literal('mission_abandoned'), attemptId: UuidSchema, atStepIndex: NonNegativeIntSchema }),
  z.object({ type: z.literal('audio_progress'), lessonId: UuidSchema, positionMs: MillisSchema, durationMs: MillisSchema.nullable(), completed: z.boolean() }),
  z.object({ type: z.literal('bookmark_created'), lessonId: UuidSchema, positionMs: MillisSchema, note: z.string().max(500).nullable() }),
  z.object({ type: z.literal('xp_claim'), reason: XpReasonSchema, referenceId: UuidSchema.nullable(), amount: NonNegativeIntSchema }),
  z.object({ type: z.literal('activity_minutes'), activityDate: z.string(), minutesActive: NonNegativeIntSchema, speakingSeconds: NonNegativeIntSchema }),
  z.object({ type: z.literal('observation'), observation: SkillObservationInputSchema }),
  z.object({ type: z.literal('enrollment_opened'), enrollmentId: UuidSchema }),
]);
export type ProgressEventPayload = z.infer<typeof ProgressEventPayloadSchema>;

export const ProgressSyncEventSchema = z.object({
  /** Immutable client UUID — the idempotency key. */
  clientEventId: UuidSchema,
  enrollmentId: UuidSchema.nullable(),
  deviceId: z.string().min(1).max(128),
  /** Monotonic per-device revision for ordering and conflict resolution. */
  revision: NonNegativeIntSchema,
  occurredAt: TimestamptzSchema,
  payload: ProgressEventPayloadSchema,
});
export type ProgressSyncEvent = z.infer<typeof ProgressSyncEventSchema>;

export const ProgressSyncRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  /** Client wall-clock at send time, for clock-skew estimation. */
  clientSentAt: TimestamptzSchema,
  events: z.array(ProgressSyncEventSchema).min(1).max(500),
});
export type ProgressSyncRequest = z.infer<typeof ProgressSyncRequestSchema>;

export const ProgressSyncResultSchema = z.object({
  clientEventId: UuidSchema,
  resolution: z.enum(['applied', 'duplicate', 'superseded', 'rejected']),
  reason: z.string().nullable(),
  /** For XP claims: the amount actually credited (0 on duplicate). */
  xpCredited: NonNegativeIntSchema.nullable(),
  /** Updated review card when a review result was applied. */
  card: ReviewCardSchema.nullable(),
});
export const ProgressSyncResponseSchema = z.object({
  results: z.array(ProgressSyncResultSchema),
  serverTime: TimestamptzSchema,
  estimatedClockSkewMs: z.number().int(),
  /** Server-side revision watermark the client should persist. */
  serverRevision: NonNegativeIntSchema,
});
export type ProgressSyncResponse = z.infer<typeof ProgressSyncResponseSchema>;

// --- skills & progress ------------------------------------------------------

export const SkillsQuerySchema = z.object({ enrollmentId: UuidSchema }).extend(PaginationQuerySchema.shape);
export const SkillProgressItemSchema = SkillMasterySnapshotSchema.extend({
  descriptor: z.string(),
  cefrCanDo: z.string().nullable(),
  recentObservationTypes: z.array(z.string()),
});
export const SkillsResponseSchema = pageOf(SkillProgressItemSchema);

export const ProgressResponseSchema = z.object({
  userId: UuidSchema,
  totalXp: NonNegativeIntSchema,
  level: NonNegativeIntSchema,
  /** Streak is optional and never punitive (§3.8). */
  streak: z.object({ currentDays: NonNegativeIntSchema, longestDays: NonNegativeIntSchema, enabled: z.boolean() }),
  perEnrollment: z.array(
    z.object({
      enrollmentId: UuidSchema,
      courseTrackId: CourseTrackIdSchema,
      sourceLanguageCode: SourceLanguageCodeSchema,
      xp: NonNegativeIntSchema,
      missionsCompleted: NonNegativeIntSchema,
      missionsCompletedWithoutHints: NonNegativeIntSchema,
      reviewsDue: NonNegativeIntSchema,
      masteryCounts: z.record(MasteryStateSchema, NonNegativeIntSchema),
      speakingSecondsLast7Days: NonNegativeIntSchema,
      recall7DayPct: UnitIntervalSchema.nullable(),
      recall30DayPct: UnitIntervalSchema.nullable(),
      storyMilestonesUnlocked: z.array(z.string()),
    }),
  ),
  achievements: z.array(z.object({ key: KeySchema, unlockedAt: TimestamptzSchema, enrollmentId: UuidSchema.nullable() })),
});
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>;

/** GET /v1/me/export — portable learner data bundle (§11 export). */
export const MeExportResponseSchema = z.object({
  exportedAt: TimestamptzSchema,
  profile: MeResponseSchema,
  enrollments: z.array(EnrollmentDtoSchema),
  progress: z.record(z.string(), z.unknown()),
  conversationSummaries: z.array(z.record(z.string(), z.unknown())),
  audioProgress: z.array(z.record(z.string(), z.unknown())),
  notes: z.array(z.string()),
});
export type MeExportResponse = z.infer<typeof MeExportResponseSchema>;

/** DELETE /v1/me — requires explicit confirmation text; deletion follows the disclosed policy. */
export const MeDeleteRequestSchema = z.object({
  confirmation: z.literal('DELETE'),
  deleteOptInRecordings: z.boolean().default(true),
});
export type MeDeleteRequest = z.infer<typeof MeDeleteRequestSchema>;
export const MeDeleteResponseSchema = z.object({
  status: z.enum(['deleted', 'scheduled']),
  anonymisedTables: z.array(z.string()),
  retainedForLegalReasons: z.array(z.string()),
});
export type MeDeleteResponse = z.infer<typeof MeDeleteResponseSchema>;

// --- inferred types (additive; every request/response schema has a matching type) ---

export type SessionRefreshRequest = z.infer<typeof SessionRefreshRequestSchema>;
export type SessionRefreshResponse = z.infer<typeof SessionRefreshResponseSchema>;
export type PatchSettingsResponse = z.infer<typeof PatchSettingsResponseSchema>;
export type CoursesResponse = z.infer<typeof CoursesResponseSchema>;
export type CoverageQuery = z.infer<typeof CoverageQuerySchema>;
export type EnrollmentCreateResponse = z.infer<typeof EnrollmentCreateResponseSchema>;
export type EnrollmentPatchResponse = z.infer<typeof EnrollmentPatchResponseSchema>;
export type EnrollmentsListResponse = z.infer<typeof EnrollmentsListResponseSchema>;
export type ManifestQuery = z.infer<typeof ManifestQuerySchema>;
export type ManifestResponse = z.infer<typeof ManifestResponseSchema>;
export type MissionStepDetail = z.infer<typeof MissionStepDetailSchema>;
export type MissionDetailQuery = z.infer<typeof MissionDetailQuerySchema>;
export type MissionAttemptCreateRequest = z.infer<typeof MissionAttemptCreateRequestSchema>;
export type MissionAttemptCreateResponse = z.infer<typeof MissionAttemptCreateResponseSchema>;
export type ReviewsDueQuery = z.infer<typeof ReviewsDueQuerySchema>;
export type ReviewItem = z.infer<typeof ReviewItemSchema>;
export type ProgressSyncResult = z.infer<typeof ProgressSyncResultSchema>;
export type SkillsQuery = z.infer<typeof SkillsQuerySchema>;
export type SkillProgressItem = z.infer<typeof SkillProgressItemSchema>;
export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;
