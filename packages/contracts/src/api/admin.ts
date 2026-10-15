/** §6.4 — administrator endpoints (uploads, imports, labeling, processing, content, licenses, models, analytics). */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { CapabilitySchema } from '../ai/capability';
import { AiTaskNameSchema, ModelProfileInputSchema, ModelProfileSchema } from '../ai/model-profile';
import { AssetKindSchema, ContentStateSchema, JobStateSchema, LearnerLevelSchema, ProcessingJobTypeSchema, ReviewStatusSchema, UploadStatusSchema } from '../enums';
import { BytesSchema, IsoDateSchema, JsonObjectSchema, KeySchema, MillisSchema, NonNegativeIntSchema, PercentSchema, Sha256Schema, TimestamptzSchema, UnitIntervalSchema, UrlSchema, UuidSchema } from '../primitives';
import { pageOf, PaginationQuerySchema } from './common';

// --- uploads (multipart lifecycle, §7.2) -----------------------------------

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/ogg',
  'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/svg+xml',
  'application/json', 'text/csv',
] as const;
export const UploadMimeTypeSchema = z.enum(ALLOWED_UPLOAD_MIME_TYPES);

export const UploadInitiateRequestSchema = z.object({
  filename: z.string().min(1).max(512),
  /** Original relative path for folder imports (legacy metadata only, never the object key). */
  relativePath: z.string().max(2048).optional(),
  contentType: UploadMimeTypeSchema,
  byteLength: BytesSchema.min(1),
  clientChecksumSha256: Sha256Schema,
  /** Unique per logical upload; retries with the same key resume the same upload. */
  idempotencyKey: z.string().min(8).max(128),
  partSizeBytes: z.number().int().min(5 * 1024 * 1024).max(512 * 1024 * 1024).optional(),
  kind: AssetKindSchema.default('audio'),
});
export type UploadInitiateRequest = z.infer<typeof UploadInitiateRequestSchema>;

export const UploadInitiateResponseSchema = z.object({
  uploadId: UuidSchema,
  storageKey: z.string(),
  partSizeBytes: BytesSchema,
  partCount: NonNegativeIntSchema,
  expiresAt: TimestamptzSchema,
  status: UploadStatusSchema,
  /** When a verified asset with the same checksum already exists (dedupe never merges rights/metadata silently). */
  duplicateOfAssetId: UuidSchema.nullable(),
  resumed: z.boolean(),
  completedPartNumbers: z.array(z.number().int().min(1)),
});
export type UploadInitiateResponse = z.infer<typeof UploadInitiateResponseSchema>;

export const UploadPartsSignRequestSchema = z.object({ partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(100) });
export const UploadPartsSignResponseSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1), url: UrlSchema, expiresAt: TimestamptzSchema })),
});

export const UploadCompleteRequestSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1), byteLength: BytesSchema })).min(1),
  clientChecksumSha256: Sha256Schema,
});
export const UploadCompleteResponseSchema = z.object({
  uploadId: UuidSchema,
  status: UploadStatusSchema,
  assetId: UuidSchema.nullable(),
  verifiedChecksumSha256: Sha256Schema.nullable(),
  byteLength: BytesSchema,
  durationMs: MillisSchema.nullable(),
  contentState: ContentStateSchema.nullable(),
  queuedJobIds: z.array(UuidSchema),
  failureCode: z.string().nullable(),
});
export type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;

export const UploadAbortRequestSchema = z.object({ reason: z.string().max(200).optional() });
export const UploadAbortResponseSchema = z.object({ uploadId: UuidSchema, status: UploadStatusSchema });

// --- imports ----------------------------------------------------------------

export const ImportR2PrefixRequestSchema = z.object({
  prefix: z.string().min(1).max(1024),
  dryRun: z.boolean().default(true),
  inheritFolderMetadata: z.boolean().default(true),
  /** Optional sidecar manifest key (CSV/JSON) inside the prefix. */
  manifestKey: z.string().max(1024).optional(),
  defaultTrackId: CourseTrackIdSchema.optional(),
  defaultInstructionLanguage: SourceLanguageCodeSchema.optional(),
  defaultCollectionId: UuidSchema.optional(),
  idempotencyKey: z.string().min(8).max(128),
});
export const ImportR2PrefixResponseSchema = z.object({
  jobId: UuidSchema,
  dryRun: z.boolean(),
  discovered: z.object({ objects: NonNegativeIntSchema, audio: NonNegativeIntSchema, sidecars: NonNegativeIntSchema, alreadyImported: NonNegativeIntSchema, unsupported: NonNegativeIntSchema }),
  sample: z.array(z.object({ key: z.string(), byteLength: BytesSchema, inferred: JsonObjectSchema })).max(50),
});

export const ImportManifestRowSchema = z.object({
  /** Matches by storage key, legacy path or asset id — at least one required. */
  storageKey: z.string().optional(),
  legacyPath: z.string().optional(),
  assetId: UuidSchema.optional(),
  collectionTitle: z.string().optional(),
  collectionId: UuidSchema.optional(),
  chapterTitle: z.string().optional(),
  chapterOrder: NonNegativeIntSchema.optional(),
  lessonTitle: z.string().optional(),
  lessonOrder: NonNegativeIntSchema.optional(),
  episodeNumber: NonNegativeIntSchema.optional(),
  targetVarietyId: VarietyIdSchema.optional(),
  instructionLanguage: SourceLanguageCodeSchema.optional(),
  spokenLanguageCodes: z.array(z.string()).optional(),
  regionalDialect: z.string().optional(),
  speakerName: z.string().optional(),
  level: LearnerLevelSchema.optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).optional(),
  scene: z.string().optional(),
  description: z.string().optional(),
  licenseId: z.string().optional(),
  rightsOwner: z.string().optional(),
}).refine((r) => r.storageKey || r.legacyPath || r.assetId, { message: 'Row needs storageKey, legacyPath or assetId' });
export type ImportManifestRow = z.infer<typeof ImportManifestRowSchema>;

export const ImportManifestRequestSchema = z.object({
  format: z.enum(['csv', 'json']),
  /** Either an uploaded manifest file or inline rows (≤ 5000). */
  uploadId: UuidSchema.optional(),
  rows: z.array(ImportManifestRowSchema).max(5000).optional(),
  dryRun: z.boolean().default(true),
  idempotencyKey: z.string().min(8).max(128),
}).refine((v) => v.uploadId !== undefined || v.rows !== undefined, { message: 'uploadId or rows is required', path: ['rows'] });
export const ImportManifestResponseSchema = z.object({
  jobId: UuidSchema,
  dryRun: z.boolean(),
  rowCount: NonNegativeIntSchema,
  matched: NonNegativeIntSchema,
  unmatched: z.array(z.object({ row: NonNegativeIntSchema, reason: z.string() })).max(200),
  validationErrors: z.array(z.object({ row: NonNegativeIntSchema, field: z.string(), message: z.string() })).max(200),
});

// --- bulk label / assets ----------------------------------------------------

export const BulkLabelPatchSchema = z
  .object({
    targetVarietyId: VarietyIdSchema.nullable(),
    instructionLanguage: SourceLanguageCodeSchema.nullable(),
    spokenLanguageCodes: z.array(z.string()),
    regionalDialect: z.string().nullable(),
    speakerId: UuidSchema.nullable(),
    collectionId: UuidSchema.nullable(),
    chapterId: UuidSchema.nullable(),
    chapterOrder: NonNegativeIntSchema.nullable(),
    lessonOrder: NonNegativeIntSchema.nullable(),
    level: LearnerLevelSchema.nullable(),
    topic: z.string().nullable(),
    addTags: z.array(z.string()),
    removeTags: z.array(z.string()),
    scene: z.string().nullable(),
    description: z.string().nullable(),
    coverVisualAssetId: UuidSchema.nullable(),
    contentRightsId: UuidSchema.nullable(),
    state: ContentStateSchema,
    visibility: z.enum(['private', 'authenticated']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'patch must set at least one field' });
export type BulkLabelPatch = z.infer<typeof BulkLabelPatchSchema>;

export const AssetsListQuerySchema = z
  .object({
    status: ContentStateSchema.optional(),
    q: z.string().max(200).optional(),
    kind: AssetKindSchema.optional(),
    targetVarietyId: VarietyIdSchema.optional(),
    instructionLanguage: SourceLanguageCodeSchema.optional(),
    collectionId: UuidSchema.optional(),
    chapterId: UuidSchema.optional(),
    speakerId: UuidSchema.optional(),
    rightsVerified: z.coerce.boolean().optional(),
    transcriptStatus: z.string().optional(),
    jobState: JobStateSchema.optional(),
    legacyPathPrefix: z.string().max(1024).optional(),
    uploadedAfter: TimestamptzSchema.optional(),
    uploadedBefore: TimestamptzSchema.optional(),
    sort: z.enum(['created_desc', 'created_asc', 'filename', 'duration', 'state']).default('created_desc'),
  })
  .extend(PaginationQuerySchema.shape);
export type AssetsListQuery = z.infer<typeof AssetsListQuerySchema>;

export const BulkLabelRequestSchema = z
  .object({
    assetIds: z.array(UuidSchema).max(5000).optional(),
    lessonIds: z.array(UuidSchema).max(5000).optional(),
    /** Select-by-filter alternative to explicit ids. */
    filter: AssetsListQuerySchema.omit({ cursor: true, limit: true, sort: true }).optional(),
    patch: BulkLabelPatchSchema,
    /** Whether children inherit (reversible, recorded in content_revisions). */
    applyToChildren: z.boolean().default(false),
    idempotencyKey: z.string().min(8).max(128),
  })
  .refine((v) => v.assetIds || v.lessonIds || v.filter, { message: 'assetIds, lessonIds or filter is required', path: ['assetIds'] });
export const BulkLabelResponseSchema = z.object({
  affected: NonNegativeIntSchema,
  revisionIds: z.array(UuidSchema),
  skipped: z.array(z.object({ id: UuidSchema, reason: z.string() })).max(200),
});

export const AdminAssetSummarySchema = z.object({
  id: UuidSchema,
  kind: AssetKindSchema,
  storageKey: z.string(),
  legacyFilename: z.string().nullable(),
  legacyPath: z.string().nullable(),
  mimeType: z.string(),
  byteLength: BytesSchema,
  durationMs: MillisSchema.nullable(),
  checksumSha256: Sha256Schema,
  state: ContentStateSchema,
  rightsVerified: z.boolean(),
  contentRightsId: UuidSchema.nullable(),
  lesson: z.object({ id: UuidSchema, title: z.string(), chapterId: UuidSchema, collectionId: UuidSchema }).nullable(),
  targetVarietyId: VarietyIdSchema.nullable(),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
  speakerIds: z.array(UuidSchema),
  transcriptStatus: z.string(),
  latestJob: z.object({ id: UuidSchema, type: ProcessingJobTypeSchema, state: JobStateSchema, progressPct: PercentSchema }).nullable(),
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export const AssetsListResponseSchema = pageOf(AdminAssetSummarySchema);

export const AudioLessonPatchRequestSchema = z
  .object({
    titleTranslations: z.record(z.string(), z.string()),
    descriptionTranslations: z.record(z.string(), z.string()),
    chapterId: UuidSchema,
    sortOrder: NonNegativeIntSchema,
    episodeNumber: NonNegativeIntSchema.nullable(),
    level: LearnerLevelSchema.nullable(),
    targetVarietyId: VarietyIdSchema.nullable(),
    instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
    spokenLanguageCodes: z.array(z.string()),
    regionalDialect: z.string().nullable(),
    topic: z.string().nullable(),
    tags: z.array(z.string()),
    scene: z.string().nullable(),
    speakerIds: z.array(UuidSchema),
    coverVisualAssetId: UuidSchema.nullable(),
    contentRightsId: UuidSchema.nullable(),
    state: ContentStateSchema,
    visibility: z.enum(['private', 'authenticated']),
    qualityReviewStatus: z.enum(['unreviewed', 'approved', 'rejected']),
    expectedRevision: NonNegativeIntSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });
export type AudioLessonPatchRequest = z.infer<typeof AudioLessonPatchRequestSchema>;
export const AudioLessonPatchResponseSchema = z.object({ lessonId: UuidSchema, revision: NonNegativeIntSchema, state: ContentStateSchema });

// --- processing -------------------------------------------------------------

export const AssetProcessRequestSchema = z.object({
  operations: z.array(ProcessingJobTypeSchema).min(1).max(10),
  priority: z.number().int().min(0).max(10).default(5),
  params: JsonObjectSchema.optional(),
  /** Reuse prior results by content hash unless forced. */
  force: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128),
});
export const ProcessingJobDtoSchema = z.object({
  id: UuidSchema,
  type: ProcessingJobTypeSchema,
  state: JobStateSchema,
  parentAssetId: UuidSchema.nullable(),
  progressPct: PercentSchema,
  attempts: NonNegativeIntSchema,
  provider: z.string().nullable(),
  costEstimateUsd: z.number().min(0).nullable(),
  costActualUsd: z.number().min(0).nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  outputAssetIds: z.array(UuidSchema),
  output: JsonObjectSchema.nullable(),
  createdAt: TimestamptzSchema,
  startedAt: TimestamptzSchema.nullable(),
  finishedAt: TimestamptzSchema.nullable(),
});
export type ProcessingJobDto = z.infer<typeof ProcessingJobDtoSchema>;
export const AssetProcessResponseSchema = z.object({ jobs: z.array(ProcessingJobDtoSchema), reusedFromHash: z.boolean() });
export const ProcessingJobResponseSchema = ProcessingJobDtoSchema;

// --- content factory (§9.8) -------------------------------------------------

export const ContentGenerateRequestSchema = z.object({
  targetTrack: CourseTrackIdSchema,
  sourceLanguage: SourceLanguageCodeSchema,
  intentKeys: z.array(KeySchema).min(1).max(50),
  level: LearnerLevelSchema,
  scene: z.string().max(200).optional(),
  characterId: UuidSchema.optional(),
  /** Number of mission drafts to produce per intent set. */
  count: z.number().int().min(1).max(20).default(1),
  idempotencyKey: z.string().min(8).max(128),
});
export type ContentGenerateRequest = z.infer<typeof ContentGenerateRequestSchema>;

/** §9.8 draft content schema. Placeholder drafts never go live without native review and rights. */
export const DraftContentSchema = z.object({
  intentId: KeySchema,
  targetTrack: CourseTrackIdSchema,
  targetVariety: VarietyIdSchema,
  sourceLanguage: SourceLanguageCodeSchema,
  mission: z.object({ title: z.string(), level: LearnerLevelSchema, objectiveIds: z.array(z.string()), scene: z.string(), characterId: z.string() }),
  expressions: z.array(z.object({ targetText: z.string(), sourceMeaning: z.string(), register: z.string(), nativeReviewed: z.boolean(), approvedForPublishing: z.boolean() })),
  publication: z.object({ status: z.enum(['draft', 'review_requested', 'approved', 'rejected']), requiresVerifiedSourceRights: z.boolean(), requiresNativeReview: z.boolean() }),
});
export type DraftContent = z.infer<typeof DraftContentSchema>;

export const ContentGenerateResponseSchema = z.object({ jobId: UuidSchema, draftIds: z.array(UuidSchema), replayed: z.boolean() });

export const ContentRequestReviewRequestSchema = z.object({ reviewerId: UuidSchema.optional(), note: z.string().max(1000).optional(), targetVarietyId: VarietyIdSchema.optional() });
export const ContentRequestReviewResponseSchema = z.object({ contentId: UuidSchema, state: ContentStateSchema, reviewStatus: ReviewStatusSchema });

export const PublishChecklistSchema = z.object({
  titlePresent: z.boolean(),
  languagePresent: z.boolean(),
  fileIntegrityVerified: z.boolean(),
  audioAccessible: z.boolean(),
  speakerMetadataPresent: z.boolean(),
  chapterLinked: z.boolean(),
  rightsVerified: z.boolean(),
  nativeReviewed: z.boolean(),
  altTextPresent: z.boolean(),
});
export type PublishChecklist = z.infer<typeof PublishChecklistSchema>;

export const ContentPublishRequestSchema = z.object({
  entityTable: z.enum(['audio_lessons', 'audio_course_collections', 'missions', 'lesson_courses', 'expressions', 'characters', 'visual_assets']),
  expectedRevision: NonNegativeIntSchema,
  note: z.string().max(1000).optional(),
});
export const ContentPublishResponseSchema = z.object({
  contentId: UuidSchema,
  state: ContentStateSchema,
  revision: NonNegativeIntSchema,
  checklist: PublishChecklistSchema,
  /** When blocked, lists which checklist items failed (e.g. rights) so the UI explains why. */
  blockedBy: z.array(z.string()),
  manifestInvalidated: z.boolean(),
});
export type ContentPublishResponse = z.infer<typeof ContentPublishResponseSchema>;

export const ContentUnpublishRequestSchema = z.object({
  entityTable: ContentPublishRequestSchema.shape.entityTable,
  reason: z.enum(['rights_revoked', 'quality', 'takedown', 'editorial', 'other']),
  note: z.string().max(1000).optional(),
});
export const ContentUnpublishResponseSchema = z.object({ contentId: UuidSchema, state: ContentStateSchema, offlineEligibilityRevoked: z.boolean(), manifestInvalidated: z.boolean() });

// --- licenses ---------------------------------------------------------------

export const LicensesAttributionsQuerySchema = z.object({ trackId: CourseTrackIdSchema.optional(), onlyUnverified: z.coerce.boolean().optional() }).extend(PaginationQuerySchema.shape);
export const AttributionItemSchema = z.object({
  contentRightsId: UuidSchema,
  licenseId: z.string(),
  licenseVersion: z.string().nullable(),
  originUrl: UrlSchema.nullable(),
  authors: z.array(z.string()),
  attributionRequired: z.boolean(),
  attributionText: z.string().nullable(),
  commercialRedistribution: z.boolean(),
  verified: z.boolean(),
  expiresAt: TimestamptzSchema.nullable(),
  revokedAt: TimestamptzSchema.nullable(),
  usedBy: z.array(z.object({ entityTable: z.string(), entityId: UuidSchema, state: ContentStateSchema })),
});
export const LicensesAttributionsResponseSchema = pageOf(AttributionItemSchema);

// --- models -----------------------------------------------------------------

export const ModelsListQuerySchema = z.object({ task: AiTaskNameSchema.optional(), targetVariety: VarietyIdSchema.optional(), sourceLanguage: SourceLanguageCodeSchema.optional() });
export const ModelsListResponseSchema = z.object({
  profiles: z.array(ModelProfileSchema),
  /** Discovery metadata from the router (pricing is informational; never hard-coded elsewhere). */
  availableModels: z.array(z.object({ id: z.string(), provider: z.string(), modalities: z.array(z.string()), contextLength: NonNegativeIntSchema.nullable(), pricing: JsonObjectSchema.nullable() })),
});

export const ModelConfigPutRequestSchema = ModelProfileInputSchema.extend({
  /** Optimistic concurrency. */
  expectedVersion: NonNegativeIntSchema.optional(),
  /** Publishing a model change requires passing language-specific smoke tests (§8.7). */
  requireSmokeTests: z.boolean().default(true),
});
export const ModelConfigPutResponseSchema = z.object({ profile: ModelProfileSchema, smokeTests: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string().nullable() })) });

export const ModelBenchmarkRequestSchema = z.object({
  profileId: UuidSchema.optional(),
  model: z.string().optional(),
  targetVariety: VarietyIdSchema,
  sourceLanguage: SourceLanguageCodeSchema.optional(),
  sampleSetId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(128),
});
export const ModelBenchmarkResponseSchema = z.object({ jobId: UuidSchema, benchmarkId: UuidSchema.nullable(), state: JobStateSchema });

// --- analytics (§12.2) ------------------------------------------------------

export const AnalyticsQuerySchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  trackId: CourseTrackIdSchema.optional(),
  sourceLanguage: SourceLanguageCodeSchema.optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

const series = <T extends z.ZodType>(value: T) => z.array(z.object({ period: IsoDateSchema, value }));

export const AnalyticsQualityResponseSchema = z.object({
  nativeReviewedFraction: UnitIntervalSchema,
  rightsCoverageFraction: UnitIntervalSchema,
  localizationCoverageBySource: z.array(z.object({ sourceLanguage: SourceLanguageCodeSchema, trackId: CourseTrackIdSchema, pct: PercentSchema })),
  liveCapabilityByTrack: z.array(z.object({ trackId: CourseTrackIdSchema, task: AiTaskNameSchema, capability: CapabilitySchema })),
  unresolvedTakedowns: NonNegativeIntSchema,
  transcriptAlignmentQuality: UnitIntervalSchema.nullable(),
  falseCorrectionRateByTrack: z.array(z.object({ trackId: CourseTrackIdSchema, rate: UnitIntervalSchema.nullable() })),
  missionCompletionWithoutHints: series(UnitIntervalSchema),
  recall7Day: series(UnitIntervalSchema.nullable()),
  recall30Day: series(UnitIntervalSchema.nullable()),
});

export const AnalyticsCostResponseSchema = z.object({
  totalUsd: z.number().min(0),
  byTask: z.array(z.object({ task: AiTaskNameSchema, requests: NonNegativeIntSchema, tokens: NonNegativeIntSchema, audioSeconds: z.number().min(0), usd: z.number().min(0) })),
  byProvider: z.array(z.object({ provider: z.string(), usd: z.number().min(0) })),
  storageGb: z.number().min(0),
  r2Operations: NonNegativeIntSchema,
  estimatedUsdPerActiveLearner: z.number().min(0).nullable(),
  usdPerMeaningfulConversation: z.number().min(0).nullable(),
  usdPerReviewedLesson: z.number().min(0).nullable(),
  timeline: series(z.number().min(0)),
  /** Reconciliation against provider invoices when available. */
  reconciliation: z.object({ invoicedUsd: z.number().min(0).nullable(), deltaUsd: z.number().nullable(), asOf: TimestamptzSchema.nullable() }),
});

export const AnalyticsUsageResponseSchema = z.object({
  activeLearners: series(NonNegativeIntSchema),
  concurrentVoiceSessionsPeak: series(NonNegativeIntSchema),
  missionsCompleted: series(NonNegativeIntSchema),
  speakingSeconds: series(NonNegativeIntSchema),
  audioListenSeconds: series(NonNegativeIntSchema),
  downloadsCompleted: series(NonNegativeIntSchema),
  retentionD7: UnitIntervalSchema.nullable(),
  retentionD30: UnitIntervalSchema.nullable(),
  byTrack: z.array(z.object({ trackId: CourseTrackIdSchema, activeLearners: NonNegativeIntSchema, enrollmentsBySource: z.array(z.object({ sourceLanguage: SourceLanguageCodeSchema, count: NonNegativeIntSchema })) })),
});

export const AnalyticsErrorsResponseSchema = z.object({
  apiErrorRate: series(UnitIntervalSchema),
  providerFailures: z.array(z.object({ provider: z.string(), task: AiTaskNameSchema, failures: NonNegativeIntSchema, fallbacksUsed: NonNegativeIntSchema })),
  mediaFailureRate: UnitIntervalSchema.nullable(),
  downloadFailureRate: UnitIntervalSchema.nullable(),
  timeouts: NonNegativeIntSchema,
  latency: z.object({ apiP95Ms: MillisSchema.nullable(), timeToFirstAiAudioP95Ms: MillisSchema.nullable(), interruptionLatencyP95Ms: MillisSchema.nullable(), mediaStartP99Ms: MillisSchema.nullable() }),
  sttConfidenceByTrack: z.array(z.object({ trackId: CourseTrackIdSchema, meanConfidence: UnitIntervalSchema.nullable(), languageMismatchRate: UnitIntervalSchema.nullable() })),
  alerts: z.array(z.object({ kind: z.enum(['runaway_cost', 'attack', 'provider_outage', 'rights_expiry']), since: TimestamptzSchema, detail: z.string() })),
});
