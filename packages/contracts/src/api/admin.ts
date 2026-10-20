/** §6.4 — administrator endpoints (uploads, imports, labeling, processing, content, licenses, models, analytics, speakers, library structure, rights, visual assets, suggestions). */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { CapabilitySchema } from '../ai/capability';
import { AiTaskNameSchema, ModelProfileInputSchema, ModelProfileSchema } from '../ai/model-profile';
import { AssetKindSchema, AudioAssetTypeSchema, ContentOriginSchema, ContentStateSchema, JobStateSchema, LearnerLevelSchema, ProcessingJobTypeAllSchema, ReviewStatusSchema, SpeakerConsentStateSchema, TranscriptStatusSchema, UploadStatusSchema, VisualAssetTypeSchema } from '../enums';
import { BytesSchema, FocalPointSchema, IsoDateSchema, JsonObjectSchema, JsonValueSchema, KeySchema, MillisSchema, NonNegativeIntSchema, PercentSchema, Sha256Schema, TimestamptzSchema, UnitIntervalSchema, UrlSchema, UuidSchema } from '../primitives';
import { AssetSuggestionKindSchema, AssetSuggestionProvenanceSchema } from '../db/audio-library';
import { VisualAssetSchema } from '../visual';
import { pageOf, PaginationQuerySchema, QueryBooleanSchema } from './common';

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
export type ImportR2PrefixRequest = z.infer<typeof ImportR2PrefixRequestSchema>;
/**
 * Shared dry-run fields for import responses. On `dryRun: true` nothing is enqueued: `jobId` carries the
 * deterministic plan id (uuid derived from the caller + idempotency key, so re-planning with the same key
 * yields the same id) and `planId` repeats it explicitly; `enqueued` is `false`. On a real run `jobId` is
 * the processing job and `enqueued` is `true`. `jobId` stays required so older clients keep working.
 */
export const ImportDryRunFieldsSchema = z.object({
  jobId: UuidSchema,
  dryRun: z.boolean(),
  /** Present on dry runs: the deterministic plan id (equals `jobId`). */
  planId: UuidSchema.optional(),
  /** Whether a processing job was actually enqueued (`false` on dry runs). Optional for older servers. */
  enqueued: z.boolean().optional(),
});
export type ImportDryRunFields = z.infer<typeof ImportDryRunFieldsSchema>;

export const ImportR2PrefixResponseSchema = ImportDryRunFieldsSchema.extend({
  discovered: z.object({ objects: NonNegativeIntSchema, audio: NonNegativeIntSchema, sidecars: NonNegativeIntSchema, alreadyImported: NonNegativeIntSchema, unsupported: NonNegativeIntSchema }),
  sample: z.array(z.object({ key: z.string(), byteLength: BytesSchema, inferred: JsonObjectSchema })).max(50),
});
export type ImportR2PrefixResponse = z.infer<typeof ImportR2PrefixResponseSchema>;

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
export type ImportManifestRequest = z.infer<typeof ImportManifestRequestSchema>;
export const ImportManifestResponseSchema = ImportDryRunFieldsSchema.extend({
  rowCount: NonNegativeIntSchema,
  matched: NonNegativeIntSchema,
  unmatched: z.array(z.object({ row: NonNegativeIntSchema, reason: z.string() })).max(200),
  validationErrors: z.array(z.object({ row: NonNegativeIntSchema, field: z.string(), message: z.string() })).max(200),
});
export type ImportManifestResponse = z.infer<typeof ImportManifestResponseSchema>;

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
    /** Strict query flag (`QueryBooleanSchema`): `false` lists the assets whose rights are NOT verified. */
    rightsVerified: QueryBooleanSchema.optional(),
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
export type BulkLabelRequest = z.infer<typeof BulkLabelRequestSchema>;

/** A `content_revisions` row is identified by (entityTable, entityId, revision), not by a uuid. */
export const ContentRevisionRefSchema = z.object({
  entityTable: z.string().min(1),
  entityId: UuidSchema,
  revision: NonNegativeIntSchema,
});
export type ContentRevisionRef = z.infer<typeof ContentRevisionRefSchema>;

export const BulkLabelResponseSchema = z.object({
  affected: NonNegativeIntSchema,
  /**
   * Ids of the touched entities (lesson/asset uuids) — kept for older clients. Prefer `revisions`,
   * which carries the full (table, id, revision) tuple written to `content_revisions`.
   */
  revisionIds: z.array(UuidSchema).optional(),
  revisions: z.array(ContentRevisionRefSchema).optional(),
  skipped: z.array(z.object({ id: UuidSchema, reason: z.string() })).max(200),
});
export type BulkLabelResponse = z.infer<typeof BulkLabelResponseSchema>;

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
  latestJob: z.object({ id: UuidSchema, type: ProcessingJobTypeAllSchema, state: JobStateSchema, progressPct: PercentSchema }).nullable(),
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
  operations: z.array(ProcessingJobTypeAllSchema).min(1).max(10),
  priority: z.number().int().min(0).max(10).default(5),
  params: JsonObjectSchema.optional(),
  /** Reuse prior results by content hash unless forced. */
  force: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128),
});
export const ProcessingJobDtoSchema = z.object({
  id: UuidSchema,
  type: ProcessingJobTypeAllSchema,
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
/** `reviewStatus` is `in_review` when a reviewer was assigned, `review_needed` otherwise (never `pending`). */
export const ContentRequestReviewResponseSchema = z.object({ contentId: UuidSchema, state: ContentStateSchema, reviewStatus: z.enum(['review_needed', 'in_review']) });

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

export const LicensesAttributionsQuerySchema = z.object({ trackId: CourseTrackIdSchema.optional(), onlyUnverified: QueryBooleanSchema.optional() }).extend(PaginationQuerySchema.shape);
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

// --- shared by the §7.3 / §7.5 / §10.2A admin resources ----------------------

/**
 * Translations keyed by source-language code (`en`, `fr`, …): never an untagged single string, so the UI
 * can show which languages a title/description actually has (no silent fallback to another language).
 */
export const LocalizedTranslationsSchema = z.record(z.string().min(2).max(10), z.string().max(2000));
export type LocalizedTranslations = z.infer<typeof LocalizedTranslationsSchema>;

/** `Idempotency-Key` echoed in the body of every admin create / reorder / revoke call. */
const IdempotencyKeySchema = z.string().min(8).max(128);
/** Optimistic concurrency: the `content_revisions` revision the editor last saw (`precondition_failed` on mismatch). */
const ExpectedRevisionSchema = NonNegativeIntSchema.optional();

const atLeastOneField = (v: Record<string, unknown>) => Object.keys(v).some((k) => k !== 'expectedRevision' && v[k] !== undefined);

type StripDefaults<T extends z.ZodRawShape> = { [K in keyof T]: T[K] extends z.ZodDefault<infer Inner extends z.ZodType> ? Inner : T[K] };
/**
 * PATCH body derived from a create schema: every field optional WITHOUT its create-time default (otherwise
 * `.partial()` would re-apply defaults and a patch could never be "empty"), plus `expectedRevision`, and at
 * least one real field required.
 */
function patchOf<T extends z.ZodRawShape>(create: z.ZodObject<T>, omit: readonly (keyof T & string)[] = []) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(create.shape)) {
    if (key === 'idempotencyKey' || omit.includes(key)) continue;
    shape[key] = (field instanceof z.ZodDefault ? field.removeDefault() : field) as z.ZodType;
  }
  return z
    .object(shape as Omit<StripDefaults<T>, 'idempotencyKey'>)
    .partial()
    .extend({ expectedRevision: ExpectedRevisionSchema })
    .refine(atLeastOneField, { message: 'At least one field must be provided' });
}

// --- speakers (§7.3; `speakers` table) --------------------------------------

export const SpeakerDtoSchema = z.object({
  id: UuidSchema,
  displayName: z.string(),
  pseudonymous: z.boolean(),
  /** Null = unknown; never an inferred neighbour variety. */
  targetVarietyId: VarietyIdSchema.nullable(),
  region: z.string().nullable(),
  consentState: SpeakerConsentStateSchema,
  contentRightsId: UuidSchema.nullable(),
  voiceDescription: z.string().nullable(),
  /** Synthetic voices must be surfaced as such everywhere (§8.6). */
  synthetic: z.boolean(),
  lessonCount: NonNegativeIntSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export type SpeakerDto = z.infer<typeof SpeakerDtoSchema>;

export const SpeakersListQuerySchema = z
  .object({
    q: z.string().max(100).optional(),
    targetVarietyId: VarietyIdSchema.optional(),
    consentState: SpeakerConsentStateSchema.optional(),
    synthetic: QueryBooleanSchema.optional(),
  })
  .extend(PaginationQuerySchema.shape);
export type SpeakersListQuery = z.infer<typeof SpeakersListQuerySchema>;
export const SpeakersListResponseSchema = pageOf(SpeakerDtoSchema);
export type SpeakersListResponse = z.infer<typeof SpeakersListResponseSchema>;

export const SpeakerCreateRequestSchema = z.object({
  displayName: z.string().min(1).max(200),
  pseudonymous: z.boolean().default(true),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  region: z.string().max(200).nullable().default(null),
  consentState: SpeakerConsentStateSchema.default('unknown'),
  contentRightsId: UuidSchema.nullable().default(null),
  voiceDescription: z.string().max(2000).nullable().default(null),
  synthetic: z.boolean().default(false),
  idempotencyKey: IdempotencyKeySchema,
});
export type SpeakerCreateRequest = z.infer<typeof SpeakerCreateRequestSchema>;
export const SpeakerPatchRequestSchema = patchOf(SpeakerCreateRequestSchema);
export type SpeakerPatchRequest = z.infer<typeof SpeakerPatchRequestSchema>;
export const SpeakerResponseSchema = SpeakerDtoSchema.extend({ revision: NonNegativeIntSchema });
export type SpeakerResponse = z.infer<typeof SpeakerResponseSchema>;
/** Deleting a speaker still linked to lessons is refused (`conflict`) unless `reassignToSpeakerId` is given. */
export const SpeakerDeleteRequestSchema = z.object({ reassignToSpeakerId: UuidSchema.optional(), reason: z.string().max(500).optional() });
export type SpeakerDeleteRequest = z.infer<typeof SpeakerDeleteRequestSchema>;
export const SpeakerDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), reassignedLessons: NonNegativeIntSchema });
export type SpeakerDeleteResponse = z.infer<typeof SpeakerDeleteResponseSchema>;

// --- library structure: collections → chapters → lessons (§7.3) -------------

export const CollectionDtoSchema = z.object({
  id: UuidSchema,
  titleTranslations: LocalizedTranslationsSchema,
  descriptionTranslations: LocalizedTranslationsSchema,
  courseTrackId: CourseTrackIdSchema.nullable(),
  targetVarietyId: VarietyIdSchema.nullable(),
  /** Instruction language spoken in the recordings (not the learner's enrollment source). */
  instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
  region: z.string().nullable(),
  instructorSpeakerId: UuidSchema.nullable(),
  coverVisualAssetId: UuidSchema.nullable(),
  contentRightsId: UuidSchema.nullable(),
  state: ContentStateSchema,
  sortOrder: NonNegativeIntSchema,
  chapterCount: NonNegativeIntSchema,
  lessonCount: NonNegativeIntSchema,
  revision: NonNegativeIntSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export type CollectionDto = z.infer<typeof CollectionDtoSchema>;
export const CollectionsListQuerySchema = z
  .object({ q: z.string().max(100).optional(), trackId: CourseTrackIdSchema.optional(), state: ContentStateSchema.optional(), instructionLanguage: SourceLanguageCodeSchema.optional() })
  .extend(PaginationQuerySchema.shape);
export type CollectionsListQuery = z.infer<typeof CollectionsListQuerySchema>;
export const CollectionsListResponseSchema = pageOf(CollectionDtoSchema);
export type CollectionsListResponse = z.infer<typeof CollectionsListResponseSchema>;
export const CollectionCreateRequestSchema = z.object({
  titleTranslations: LocalizedTranslationsSchema,
  descriptionTranslations: LocalizedTranslationsSchema.default({}),
  courseTrackId: CourseTrackIdSchema.nullable().default(null),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable().default(null),
  region: z.string().max(200).nullable().default(null),
  instructorSpeakerId: UuidSchema.nullable().default(null),
  coverVisualAssetId: UuidSchema.nullable().default(null),
  contentRightsId: UuidSchema.nullable().default(null),
  sortOrder: NonNegativeIntSchema.default(0),
  idempotencyKey: IdempotencyKeySchema,
});
export type CollectionCreateRequest = z.infer<typeof CollectionCreateRequestSchema>;
export const CollectionPatchRequestSchema = patchOf(CollectionCreateRequestSchema);
export type CollectionPatchRequest = z.infer<typeof CollectionPatchRequestSchema>;
export const CollectionChapterSummarySchema = z.object({ id: UuidSchema, sortOrder: NonNegativeIntSchema, titleTranslations: LocalizedTranslationsSchema, lessonCount: NonNegativeIntSchema, state: ContentStateSchema });
export const CollectionResponseSchema = CollectionDtoSchema.extend({ chapters: z.array(CollectionChapterSummarySchema) });
export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;
/** Deletion is refused (`conflict`) while the collection or any child is `published`. */
export const CollectionDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), orphanedAssetIds: z.array(UuidSchema) });
export type CollectionDeleteResponse = z.infer<typeof CollectionDeleteResponseSchema>;

export const ChapterDtoSchema = z.object({
  id: UuidSchema,
  collectionId: UuidSchema,
  titleTranslations: LocalizedTranslationsSchema,
  summaryTranslations: LocalizedTranslationsSchema,
  sortOrder: NonNegativeIntSchema,
  coverVisualAssetId: UuidSchema.nullable(),
  state: ContentStateSchema,
  lessonCount: NonNegativeIntSchema,
  revision: NonNegativeIntSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export type ChapterDto = z.infer<typeof ChapterDtoSchema>;
export const ChapterCreateRequestSchema = z.object({
  collectionId: UuidSchema,
  titleTranslations: LocalizedTranslationsSchema,
  summaryTranslations: LocalizedTranslationsSchema.default({}),
  sortOrder: NonNegativeIntSchema.default(0),
  coverVisualAssetId: UuidSchema.nullable().default(null),
  idempotencyKey: IdempotencyKeySchema,
});
export type ChapterCreateRequest = z.infer<typeof ChapterCreateRequestSchema>;
/** `collectionId` moves the chapter (recorded as a revision on both collections). */
export const ChapterPatchRequestSchema = patchOf(ChapterCreateRequestSchema);
export type ChapterPatchRequest = z.infer<typeof ChapterPatchRequestSchema>;
export const ChapterLessonSummarySchema = z.object({ id: UuidSchema, sortOrder: NonNegativeIntSchema, titleTranslations: LocalizedTranslationsSchema, state: ContentStateSchema, durationMs: MillisSchema.nullable() });
export const ChapterResponseSchema = ChapterDtoSchema.extend({ lessons: z.array(ChapterLessonSummarySchema) });
export type ChapterResponse = z.infer<typeof ChapterResponseSchema>;
/** Deletion is refused (`conflict`) while any lesson is `published`; `movedLessonIds` lists lessons moved by `moveLessonsToChapterId`. */
export const ChapterDeleteRequestSchema = z.object({ moveLessonsToChapterId: UuidSchema.optional() });
export type ChapterDeleteRequest = z.infer<typeof ChapterDeleteRequestSchema>;
export const ChapterDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), movedLessonIds: z.array(UuidSchema) });
export type ChapterDeleteResponse = z.infer<typeof ChapterDeleteResponseSchema>;

/**
 * Reorder = the FULL permutation of the parent's children (`reorder_audio_chapters` / `reorder_audio_lessons`
 * RPCs reject partial lists, duplicates and foreign ids with `validation_failed`).
 */
export const ReorderRequestSchema = z.object({
  orderedIds: z.array(UuidSchema).min(1).max(5000),
  expectedRevision: ExpectedRevisionSchema,
  idempotencyKey: IdempotencyKeySchema,
}).refine((v) => new Set(v.orderedIds).size === v.orderedIds.length, { message: 'orderedIds must not repeat an id', path: ['orderedIds'] });
export type ReorderRequest = z.infer<typeof ReorderRequestSchema>;
export const ReorderResponseSchema = z.object({ parentId: UuidSchema, revision: NonNegativeIntSchema, items: z.array(z.object({ id: UuidSchema, sortOrder: NonNegativeIntSchema })) });
export type ReorderResponse = z.infer<typeof ReorderResponseSchema>;

export const LessonCreateRequestSchema = z.object({
  chapterId: UuidSchema,
  titleTranslations: LocalizedTranslationsSchema,
  descriptionTranslations: LocalizedTranslationsSchema.default({}),
  sortOrder: NonNegativeIntSchema.default(0),
  level: LearnerLevelSchema.nullable().default(null),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable().default(null),
  speakerIds: z.array(UuidSchema).max(20).default([]),
  /** Optional initial master asset; equivalent to a follow-up `adminLessonAssetAttach`. */
  assetId: UuidSchema.optional(),
  idempotencyKey: IdempotencyKeySchema,
});
export type LessonCreateRequest = z.infer<typeof LessonCreateRequestSchema>;
export const LessonAssetLinkSchema = z.object({ assetId: UuidSchema, assetType: AudioAssetTypeSchema, sortOrder: NonNegativeIntSchema, state: ContentStateSchema, durationMs: MillisSchema.nullable() });
export const LessonDetailResponseSchema = z.object({
  id: UuidSchema,
  chapterId: UuidSchema,
  collectionId: UuidSchema,
  titleTranslations: LocalizedTranslationsSchema,
  descriptionTranslations: LocalizedTranslationsSchema,
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
  visibility: z.enum(['private', 'authenticated']),
  qualityReviewStatus: z.enum(['unreviewed', 'approved', 'rejected']),
  state: ContentStateSchema,
  revision: NonNegativeIntSchema,
  assets: z.array(LessonAssetLinkSchema),
  transcriptStatus: TranscriptStatusSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export type LessonDetailResponse = z.infer<typeof LessonDetailResponseSchema>;
/** Deleting a `published` lesson is refused (`conflict`); detached assets return to `imported_draft`, never deleted. */
export const LessonDeleteResponseSchema = z.object({ id: UuidSchema, deleted: z.boolean(), detachedAssetIds: z.array(UuidSchema) });
export type LessonDeleteResponse = z.infer<typeof LessonDeleteResponseSchema>;
export const LessonAssetAttachRequestSchema = z.object({ assetId: UuidSchema, assetType: AudioAssetTypeSchema.default('master'), sortOrder: NonNegativeIntSchema.default(0), expectedRevision: ExpectedRevisionSchema });
export type LessonAssetAttachRequest = z.infer<typeof LessonAssetAttachRequestSchema>;
export const LessonAssetAttachResponseSchema = z.object({
  lessonId: UuidSchema,
  assetId: UuidSchema,
  assetType: AudioAssetTypeSchema,
  revision: NonNegativeIntSchema,
  /** Set when the asset was moved from another lesson (recorded as a revision on both lessons). */
  movedFromLessonId: UuidSchema.nullable(),
});
export type LessonAssetAttachResponse = z.infer<typeof LessonAssetAttachResponseSchema>;
export const LessonAssetDetachResponseSchema = z.object({ lessonId: UuidSchema, assetId: UuidSchema, revision: NonNegativeIntSchema, /** Detached assets return to `imported_draft`, never deleted. */ assetState: ContentStateSchema });
export type LessonAssetDetachResponse = z.infer<typeof LessonAssetDetachResponseSchema>;

// --- content rights (§7.5; `content_rights` table) ---------------------------

export const VoiceRightsSchema = z.enum(['none', 'playback_only', 'synthesis_permitted']);
export type VoiceRights = z.infer<typeof VoiceRightsSchema>;
export const RightsUsageSchema = z.object({ entityTable: z.string(), entityId: UuidSchema, state: ContentStateSchema });
export type RightsUsage = z.infer<typeof RightsUsageSchema>;

export const ContentRightsDtoSchema = z.object({
  id: UuidSchema,
  originUrl: UrlSchema.nullable(),
  authors: z.array(z.string()),
  speakers: z.array(z.string()),
  permissionGrant: z.string(),
  licenseId: z.string(),
  licenseVersion: z.string().nullable(),
  commercialRedistribution: z.boolean(),
  attributionRequired: z.boolean(),
  attributionText: z.string().nullable(),
  alterationsPermitted: z.boolean(),
  aiProcessingPermitted: z.boolean(),
  voiceRights: VoiceRightsSchema,
  expiresAt: TimestamptzSchema.nullable(),
  revokedAt: TimestamptzSchema.nullable(),
  evidenceAssetId: UuidSchema.nullable(),
  verified: z.boolean(),
  /** `content_rights.reviewer_id` / `reviewed_at`: who verified the grant. */
  verifiedBy: UuidSchema.nullable(),
  verifiedAt: TimestamptzSchema.nullable(),
  /** Derived (`rightsAllowPublishing`): verified, not revoked, not expired, redistribution permitted. */
  publishable: z.boolean(),
  usedBy: z.array(RightsUsageSchema),
  revision: NonNegativeIntSchema,
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export type ContentRightsDto = z.infer<typeof ContentRightsDtoSchema>;
export const ContentRightsListQuerySchema = z
  .object({
    q: z.string().max(100).optional(),
    verified: QueryBooleanSchema.optional(),
    revoked: QueryBooleanSchema.optional(),
    expiringBefore: TimestamptzSchema.optional(),
    licenseId: z.string().max(120).optional(),
  })
  .extend(PaginationQuerySchema.shape);
export type ContentRightsListQuery = z.infer<typeof ContentRightsListQuerySchema>;
export const ContentRightsListResponseSchema = pageOf(ContentRightsDtoSchema);
export type ContentRightsListResponse = z.infer<typeof ContentRightsListResponseSchema>;
export const ContentRightsCreateRequestSchema = z.object({
  originUrl: UrlSchema.nullable().default(null),
  authors: z.array(z.string().min(1).max(200)).max(50).default([]),
  speakers: z.array(z.string().min(1).max(200)).max(50).default([]),
  permissionGrant: z.string().min(1).max(4000),
  licenseId: z.string().min(1).max(120),
  licenseVersion: z.string().max(40).nullable().default(null),
  commercialRedistribution: z.boolean().default(false),
  attributionRequired: z.boolean().default(true),
  attributionText: z.string().max(2000).nullable().default(null),
  alterationsPermitted: z.boolean().default(false),
  aiProcessingPermitted: z.boolean().default(false),
  voiceRights: VoiceRightsSchema.default('none'),
  expiresAt: TimestamptzSchema.nullable().default(null),
  evidenceAssetId: UuidSchema.nullable().default(null),
  /** Only `admin`/`super_admin` may set `verified: true` (`forbidden` otherwise); editors create unverified rows. */
  verified: z.boolean().default(false),
  idempotencyKey: IdempotencyKeySchema,
});
export type ContentRightsCreateRequest = z.infer<typeof ContentRightsCreateRequestSchema>;
export const ContentRightsPatchRequestSchema = patchOf(ContentRightsCreateRequestSchema);
export type ContentRightsPatchRequest = z.infer<typeof ContentRightsPatchRequestSchema>;
export const ContentRightsResponseSchema = ContentRightsDtoSchema;
export type ContentRightsResponse = z.infer<typeof ContentRightsResponseSchema>;
export const ContentRightsRevokeReasonSchema = z.enum(['rights_revoked', 'takedown', 'expired', 'other']);
/** Revoking unpublishes every dependent published entity and revokes offline eligibility in one transaction (§7.5). */
export const ContentRightsRevokeRequestSchema = z.object({ reason: ContentRightsRevokeReasonSchema, note: z.string().max(1000).optional(), idempotencyKey: IdempotencyKeySchema });
export type ContentRightsRevokeRequest = z.infer<typeof ContentRightsRevokeRequestSchema>;
export const ContentRightsRevokeResponseSchema = z.object({
  id: UuidSchema,
  revokedAt: TimestamptzSchema,
  /** Every entity the RPC changed (`previousState` null when the table has no publication state, e.g. speakers). */
  affected: z.array(z.object({ entityTable: z.string(), entityId: UuidSchema, previousState: z.string().nullable(), newState: z.string() })),
  manifestInvalidated: z.boolean(),
  replayed: z.boolean(),
});
export type ContentRightsRevokeResponse = z.infer<typeof ContentRightsRevokeResponseSchema>;

// --- visual assets (§10.2A: upload-initiate → register → assign / replace) ---

export const VISUAL_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/svg+xml'] as const;
export const VisualUploadMimeTypeSchema = z.enum(VISUAL_UPLOAD_MIME_TYPES);
/**
 * Image-only variant of `UploadInitiateRequest` (`kind` is fixed to `visual`). The bytes then go through the
 * regular multipart lifecycle (`adminUploadPartsSign` / `adminUploadComplete`) and `adminVisualAssetRegister`
 * turns the verified upload into a `visual_assets` row.
 */
export const VisualAssetUploadInitiateRequestSchema = UploadInitiateRequestSchema.omit({ kind: true, contentType: true }).extend({ contentType: VisualUploadMimeTypeSchema });
export type VisualAssetUploadInitiateRequest = z.infer<typeof VisualAssetUploadInitiateRequestSchema>;
export const VisualAssetUploadInitiateResponseSchema = UploadInitiateResponseSchema.extend({ kind: z.literal('visual') });
export type VisualAssetUploadInitiateResponse = z.infer<typeof VisualAssetUploadInitiateResponseSchema>;

/**
 * Where a visual asset is used. Slots map onto existing storage: `cover` → `audio_cover_art` /
 * `*_cover_visual_asset_id`, `map` → `chapters.map_visual_asset_id`, `portrait` → `characters.portrait_visual_asset_id`,
 * mission slots → `mission_visual_bindings.role`. `bindingId` is the binding row id when one exists, else null.
 */
export const VisualAssetEntityTableSchema = z.enum(['missions', 'lesson_courses', 'chapters', 'audio_course_collections', 'audio_chapters', 'audio_lessons', 'characters']);
export const VisualAssetSlotSchema = z.enum(['cover', 'map', 'portrait', 'scene', 'context_object', 'story_panel', 'celebration']);
export const VisualAssetAssignmentTargetSchema = z.object({ entityTable: VisualAssetEntityTableSchema, entityId: UuidSchema, slot: VisualAssetSlotSchema });
export type VisualAssetAssignmentTarget = z.infer<typeof VisualAssetAssignmentTargetSchema>;
export const VisualAssetAssignmentSchema = VisualAssetAssignmentTargetSchema.extend({ bindingId: UuidSchema.nullable(), assignedAt: TimestamptzSchema.nullable() });
export type VisualAssetAssignment = z.infer<typeof VisualAssetAssignmentSchema>;

export const VisualAssetDtoSchema = VisualAssetSchema.extend({
  /** Per-source-language alt text (`visual_assets.alt_text_translations`, migration 120). */
  altTextTranslations: LocalizedTranslationsSchema,
  mimeType: z.string(),
  byteLength: BytesSchema,
  moderationStatus: z.enum(['unchecked', 'passed', 'flagged']),
  replacedByAssetId: UuidSchema.nullable(),
  assignments: z.array(VisualAssetAssignmentSchema),
  revision: NonNegativeIntSchema,
  updatedAt: TimestamptzSchema,
});
export type VisualAssetDto = z.infer<typeof VisualAssetDtoSchema>;
export const VisualAssetsListQuerySchema = z
  .object({
    type: VisualAssetTypeSchema.optional(),
    reviewStatus: ReviewStatusSchema.optional(),
    origin: ContentOriginSchema.optional(),
    entityTable: VisualAssetEntityTableSchema.optional(),
    entityId: UuidSchema.optional(),
    unassigned: QueryBooleanSchema.optional(),
    q: z.string().max(100).optional(),
  })
  .extend(PaginationQuerySchema.shape);
export type VisualAssetsListQuery = z.infer<typeof VisualAssetsListQuerySchema>;
export const VisualAssetsListResponseSchema = pageOf(VisualAssetDtoSchema);
export type VisualAssetsListResponse = z.infer<typeof VisualAssetsListResponseSchema>;
/** Normalised crop rectangle (0–1) applied before variants are derived. */
export const CropRectSchema = z.object({ x: UnitIntervalSchema, y: UnitIntervalSchema, width: UnitIntervalSchema.min(Number.EPSILON), height: UnitIntervalSchema.min(Number.EPSILON) }).refine((c) => c.x + c.width <= 1 && c.y + c.height <= 1, { message: 'crop must stay inside the image' });
export const VisualAssetRegisterRequestSchema = z.object({
  /** Completed upload (`status: 'verified'`) created by `adminVisualAssetUploadInitiate`. */
  uploadId: UuidSchema,
  type: VisualAssetTypeSchema,
  styleVersion: z.string().min(1).max(40),
  /** Alt text per source language; `en` required (accessibility checklist). */
  altTextTranslations: LocalizedTranslationsSchema.refine((m) => typeof m.en === 'string' && m.en.trim().length > 0, { message: 'altTextTranslations.en is required' }),
  focalPoint: FocalPointSchema.nullable().default(null),
  crop: CropRectSchema.nullable().default(null),
  localeNeutral: z.boolean().default(true),
  origin: ContentOriginSchema,
  /** `visual_assets.license_id`. */
  contentRightsId: UuidSchema.nullable().default(null),
  generationBrief: JsonObjectSchema.nullable().default(null),
  idempotencyKey: IdempotencyKeySchema,
});
export type VisualAssetRegisterRequest = z.infer<typeof VisualAssetRegisterRequestSchema>;
export const VisualAssetPatchRequestSchema = z
  .object({
    type: VisualAssetTypeSchema,
    styleVersion: z.string().min(1).max(40),
    altTextTranslations: LocalizedTranslationsSchema,
    focalPoint: FocalPointSchema.nullable(),
    crop: CropRectSchema.nullable(),
    localeNeutral: z.boolean(),
    contentRightsId: UuidSchema.nullable(),
    generationBrief: JsonObjectSchema.nullable(),
    reviewStatus: ReviewStatusSchema,
  })
  .partial()
  .extend({ expectedRevision: ExpectedRevisionSchema })
  .refine(atLeastOneField, { message: 'At least one field must be provided' });
export type VisualAssetPatchRequest = z.infer<typeof VisualAssetPatchRequestSchema>;
export const VisualAssetResponseSchema = VisualAssetDtoSchema;
export type VisualAssetResponse = z.infer<typeof VisualAssetResponseSchema>;
/** New bytes under a NEW immutable key: assignments move to the new asset id, the old row gets `replacedByAssetId`. */
export const VisualAssetReplaceRequestSchema = z.object({
  uploadId: UuidSchema,
  keepFocalPoint: z.boolean().default(true),
  keepCrop: z.boolean().default(false),
  note: z.string().max(500).optional(),
  expectedRevision: ExpectedRevisionSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export type VisualAssetReplaceRequest = z.infer<typeof VisualAssetReplaceRequestSchema>;
export const VisualAssetReplaceResponseSchema = z.object({ previousAssetId: UuidSchema, asset: VisualAssetDtoSchema, movedAssignments: NonNegativeIntSchema, manifestInvalidated: z.boolean(), replayed: z.boolean() });
export type VisualAssetReplaceResponse = z.infer<typeof VisualAssetReplaceResponseSchema>;
export const VisualAssetAssignRequestSchema = VisualAssetAssignmentTargetSchema.extend({
  /** Replace an existing asset in the same slot instead of failing with `conflict`. */
  replaceExisting: z.boolean().default(false),
  expectedRevision: ExpectedRevisionSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export type VisualAssetAssignRequest = z.infer<typeof VisualAssetAssignRequestSchema>;
export const VisualAssetAssignResponseSchema = z.object({ assignment: VisualAssetAssignmentSchema, replacedAssetId: UuidSchema.nullable(), manifestInvalidated: z.boolean() });
export type VisualAssetAssignResponse = z.infer<typeof VisualAssetAssignResponseSchema>;
export const VisualAssetUnassignRequestSchema = VisualAssetAssignmentTargetSchema.extend({ expectedRevision: ExpectedRevisionSchema });
export type VisualAssetUnassignRequest = z.infer<typeof VisualAssetUnassignRequestSchema>;
export const VisualAssetUnassignResponseSchema = z.object({ target: VisualAssetAssignmentTargetSchema, removed: z.boolean(), manifestInvalidated: z.boolean() });
export type VisualAssetUnassignResponse = z.infer<typeof VisualAssetUnassignResponseSchema>;

// --- asset suggestions (§7.4; `asset_suggestions` table, migration 100) -----

// `AssetSuggestionKindSchema` (`asset_suggestions.kind`) comes from `../db/audio-library`.
/** Review queue uses the shared `review_status` enum; `approved` = applied, `rejected` = discarded. */
export const AssetSuggestionReviewStatusSchema = ReviewStatusSchema;

export const AssetSuggestionDtoSchema = z.object({
  id: UuidSchema,
  mediaAssetId: UuidSchema,
  lessonId: UuidSchema.nullable(),
  jobId: UuidSchema.nullable(),
  kind: AssetSuggestionKindSchema,
  /** The proposal as produced by the job (shape depends on `kind`); shown next to `currentValue` so reviewers can diff. */
  suggestion: JsonObjectSchema,
  /** Current value of the field(s) the suggestion targets, when the server can resolve it; null otherwise. */
  currentValue: JsonValueSchema.nullable(),
  /** Model self-reported confidence; shown as-is, never turned into a quality score. Null = not reported. */
  confidence: UnitIntervalSchema.nullable(),
  /** Never prompts with learner data. */
  provenance: AssetSuggestionProvenanceSchema,
  reviewStatus: AssetSuggestionReviewStatusSchema,
  reviewerId: UuidSchema.nullable(),
  decidedAt: TimestamptzSchema.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
});
export type AssetSuggestionDto = z.infer<typeof AssetSuggestionDtoSchema>;
export const AssetSuggestionsListQuerySchema = z
  .object({
    reviewStatus: AssetSuggestionReviewStatusSchema.optional(),
    kind: AssetSuggestionKindSchema.optional(),
    mediaAssetId: UuidSchema.optional(),
    lessonId: UuidSchema.optional(),
    jobId: UuidSchema.optional(),
    minConfidence: z.coerce.number().min(0).max(1).optional(),
  })
  .extend(PaginationQuerySchema.shape);
export type AssetSuggestionsListQuery = z.infer<typeof AssetSuggestionsListQuerySchema>;
export const AssetSuggestionsListResponseSchema = pageOf(AssetSuggestionDtoSchema);
export type AssetSuggestionsListResponse = z.infer<typeof AssetSuggestionsListResponseSchema>;
export const AssetSuggestionsGenerateRequestSchema = z
  .object({
    assetIds: z.array(UuidSchema).max(500).optional(),
    filter: AssetsListQuerySchema.omit({ cursor: true, limit: true, sort: true }).optional(),
    kinds: z.array(AssetSuggestionKindSchema).min(1).default(['metadata', 'language', 'lesson_structure', 'level', 'topics', 'tags']),
    /** Re-run for assets that already have pending suggestions. */
    force: z.boolean().default(false),
    idempotencyKey: IdempotencyKeySchema,
  })
  .refine((v) => v.assetIds !== undefined || v.filter !== undefined, { message: 'assetIds or filter is required', path: ['assetIds'] });
export type AssetSuggestionsGenerateRequest = z.infer<typeof AssetSuggestionsGenerateRequestSchema>;
export const AssetSuggestionsGenerateResponseSchema = z.object({ jobIds: z.array(UuidSchema), queuedAssets: NonNegativeIntSchema, skipped: z.array(z.object({ assetId: UuidSchema, reason: z.string() })).max(200), replayed: z.boolean() });
export type AssetSuggestionsGenerateResponse = z.infer<typeof AssetSuggestionsGenerateResponseSchema>;
export const AssetSuggestionResponseSchema = AssetSuggestionDtoSchema;
export type AssetSuggestionResponse = z.infer<typeof AssetSuggestionResponseSchema>;
export const AssetSuggestionDecisionSchema = z.enum(['approve', 'reject']);
export const AssetSuggestionDecideRequestSchema = z.object({
  decision: AssetSuggestionDecisionSchema,
  /** Reviewer may edit the proposal before approving; stored as the applied value (same shape as `suggestion`). */
  overrideSuggestion: JsonObjectSchema.optional(),
  note: z.string().max(2000).optional(),
  expectedRevision: ExpectedRevisionSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export type AssetSuggestionDecideRequest = z.infer<typeof AssetSuggestionDecideRequestSchema>;
/** `applied` is true only when approving actually changed the target (a `content_revisions` row was written). */
export const AssetSuggestionDecideResponseSchema = z.object({ suggestion: AssetSuggestionDtoSchema, applied: z.boolean(), revision: ContentRevisionRefSchema.nullable(), replayed: z.boolean() });
export type AssetSuggestionDecideResponse = z.infer<typeof AssetSuggestionDecideResponseSchema>;
export const AssetSuggestionsBulkDecideRequestSchema = z.object({ suggestionIds: z.array(UuidSchema).min(1).max(500), decision: AssetSuggestionDecisionSchema, note: z.string().max(2000).optional(), idempotencyKey: IdempotencyKeySchema });
export type AssetSuggestionsBulkDecideRequest = z.infer<typeof AssetSuggestionsBulkDecideRequestSchema>;
export const AssetSuggestionsBulkDecideResponseSchema = z.object({ approved: NonNegativeIntSchema, rejected: NonNegativeIntSchema, skipped: z.array(z.object({ id: UuidSchema, reason: z.string() })).max(200), revisions: z.array(ContentRevisionRefSchema), replayed: z.boolean() });
export type AssetSuggestionsBulkDecideResponse = z.infer<typeof AssetSuggestionsBulkDecideResponseSchema>;

// --- inferred types (additive; every request/response schema has a matching type) ---

export type UploadMimeType = z.infer<typeof UploadMimeTypeSchema>;
export type UploadPartsSignRequest = z.infer<typeof UploadPartsSignRequestSchema>;
export type UploadPartsSignResponse = z.infer<typeof UploadPartsSignResponseSchema>;
export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;
export type UploadAbortRequest = z.infer<typeof UploadAbortRequestSchema>;
export type UploadAbortResponse = z.infer<typeof UploadAbortResponseSchema>;
export type AdminAssetSummary = z.infer<typeof AdminAssetSummarySchema>;
export type AssetsListResponse = z.infer<typeof AssetsListResponseSchema>;
export type AudioLessonPatchResponse = z.infer<typeof AudioLessonPatchResponseSchema>;
export type AssetProcessRequest = z.infer<typeof AssetProcessRequestSchema>;
export type AssetProcessResponse = z.infer<typeof AssetProcessResponseSchema>;
export type ProcessingJobResponse = z.infer<typeof ProcessingJobResponseSchema>;
export type ContentGenerateResponse = z.infer<typeof ContentGenerateResponseSchema>;
export type ContentRequestReviewRequest = z.infer<typeof ContentRequestReviewRequestSchema>;
export type ContentRequestReviewResponse = z.infer<typeof ContentRequestReviewResponseSchema>;
export type ContentPublishRequest = z.infer<typeof ContentPublishRequestSchema>;
export type ContentUnpublishRequest = z.infer<typeof ContentUnpublishRequestSchema>;
export type ContentUnpublishResponse = z.infer<typeof ContentUnpublishResponseSchema>;
export type LicensesAttributionsQuery = z.infer<typeof LicensesAttributionsQuerySchema>;
export type AttributionItem = z.infer<typeof AttributionItemSchema>;
export type LicensesAttributionsResponse = z.infer<typeof LicensesAttributionsResponseSchema>;
export type ModelsListQuery = z.infer<typeof ModelsListQuerySchema>;
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;
export type ModelConfigPutRequest = z.infer<typeof ModelConfigPutRequestSchema>;
export type ModelConfigPutResponse = z.infer<typeof ModelConfigPutResponseSchema>;
export type ModelBenchmarkRequest = z.infer<typeof ModelBenchmarkRequestSchema>;
export type ModelBenchmarkResponse = z.infer<typeof ModelBenchmarkResponseSchema>;
export type AnalyticsQualityResponse = z.infer<typeof AnalyticsQualityResponseSchema>;
export type AnalyticsCostResponse = z.infer<typeof AnalyticsCostResponseSchema>;
export type AnalyticsUsageResponse = z.infer<typeof AnalyticsUsageResponseSchema>;
export type AnalyticsErrorsResponse = z.infer<typeof AnalyticsErrorsResponseSchema>;
