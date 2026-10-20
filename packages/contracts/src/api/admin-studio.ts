/**
 * §6.4 / §7 Studio writes served by the Worker (R-4.3-01). They used to be local Next route handlers in
 * `apps/admin/app/api/admin/**` that wrote through the staff member's Supabase session; the Studio now reaches
 * only `/v1/admin/*` with its JWT and the Worker applies the server-verified role gate (`user_roles`):
 *
 * - coverage editorial status of a (track × instruction language) pair,
 * - transcript revisions (segments + per-source translations),
 * - editorial approve / reject of drafts (send-back stays on `adminContentRequestReview`),
 * - revision rollback (restores a snapshot as a NEW revision),
 * - processing-job retry,
 * - staff role grant / revoke,
 * - the AI models test harness (prompt / synthesize / transcribe probes through the Worker's own adapters).
 *
 * Request/response schemas plus the pure planners shared by the Worker handlers, their tests and the Studio.
 */
import { z } from 'zod';
import { AudioEncodingSchema } from '../ai/io';
import type { AiTaskName } from '../ai/model-profile';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { CoverageMetricsSchema, type CoverageMetrics } from '../db/identity';
import { ContentStateSchema, CoverageStatusSchema, JobStateSchema, type PROCESSING_JOB_TYPE_EXTENSION_VALUES, RoleSchema, TranslationQaStateSchema, isProcessingJobTypeAll, type ContentState, type CoverageStatus, type ProcessingJobType, type ProcessingJobTypeAll } from '../enums';
import { MillisSchema, NonNegativeIntSchema, PercentSchema, TimestamptzSchema, UnitIntervalSchema, UuidSchema } from '../primitives';

// --- coverage editorial status (`course_source_localizations`) ---------------------------------------------

/** `PUT /v1/admin/coverage` — one (track, instruction language) row; rows are created by the catalog seed. */
export const CoverageUpdateRequestSchema = z.object({
  courseTrackId: CourseTrackIdSchema,
  sourceLanguageCode: SourceLanguageCodeSchema,
  status: CoverageStatusSchema,
  metrics: CoverageMetricsSchema,
  nativeReviewed: z.boolean(),
  editorialNoteKey: z.string().max(200).nullable().default(null),
  /** Opt-in fallback instruction language offered to learners of a partial pair (never applied silently). */
  fallbackSourceLanguageCode: SourceLanguageCodeSchema.nullable().default(null),
});
export type CoverageUpdateRequest = z.infer<typeof CoverageUpdateRequestSchema>;
export const CoverageUpdateResponseSchema = z.object({ id: UuidSchema, status: CoverageStatusSchema });
export type CoverageUpdateResponse = z.infer<typeof CoverageUpdateResponseSchema>;

/**
 * Coverage honesty rules (mirror `@langquest/locales` `generateCourseSourceLocalizationRows`): `complete` needs a
 * native review with every metric at 100, a complete pair never advertises a fallback, and a fallback differs from
 * the source. Returns the client-facing message of the first violated rule, or `null`.
 */
export function coverageUpdateViolation(body: { status: CoverageStatus; metrics: CoverageMetrics; nativeReviewed: boolean; sourceLanguageCode: string; fallbackSourceLanguageCode: string | null }): string | null {
  const allFull = Object.values(body.metrics).every((v) => v >= 100);
  if (body.status === 'complete' && !(body.nativeReviewed && allFull)) return '"complete" requires nativeReviewed and every metric at 100%.';
  if (body.status === 'complete' && body.fallbackSourceLanguageCode) return 'A complete pair must not advertise a fallback language.';
  if (body.fallbackSourceLanguageCode === body.sourceLanguageCode) return 'Fallback must differ from the source language.';
  return null;
}

// --- transcript revisions (`transcripts`, `transcript_segments`, `transcript_translations`) ----------------

export const TranscriptSegmentInputSchema = z.object({
  sortIndex: z.number().int().min(0),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string().max(5000),
  speakerLabel: z.string().max(120).nullable().default(null),
  speakerId: UuidSchema.nullable().default(null),
  languageCode: z.string().max(12).nullable().default(null),
  targetVarietyId: VarietyIdSchema.nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  reviewed: z.boolean().default(false),
  translations: z.array(z.object({ languageCode: SourceLanguageCodeSchema, text: z.string().max(5000), qaState: TranslationQaStateSchema.default('needs_review') })).default([]),
});
export type TranscriptSegmentInput = z.infer<typeof TranscriptSegmentInputSchema>;

/** `PUT /v1/admin/transcripts/:lessonId` — saves the whole transcript as a NEW revision (earlier ones are kept). */
export const TranscriptSaveRequestSchema = z.object({
  primaryLanguageCode: z.string().min(2).max(12),
  languageMode: z.enum(['source', 'target', 'mixed']).default('mixed'),
  status: z.enum(['edited', 'reviewed']).default('edited'),
  qaState: TranslationQaStateSchema.default('needs_review'),
  accessRights: z.enum(['internal_only', 'learners', 'public']).default('internal_only'),
  durationMs: z.number().int().min(0).nullable().default(null),
  segments: z.array(TranscriptSegmentInputSchema).max(20000),
  note: z.string().max(500).optional(),
});
export type TranscriptSaveRequest = z.infer<typeof TranscriptSaveRequestSchema>;
export const TranscriptSaveResponseSchema = z.object({ transcriptId: UuidSchema, revision: NonNegativeIntSchema, coveragePct: PercentSchema, segments: NonNegativeIntSchema });
export type TranscriptSaveResponse = z.infer<typeof TranscriptSaveResponseSchema>;

/** Structural checks the schema cannot express (each would otherwise surface as a raw constraint error). */
export function transcriptSaveViolation(segments: readonly (Pick<TranscriptSegmentInput, 'sortIndex' | 'startMs' | 'endMs'> & { translations: readonly { languageCode: string }[] })[]): string | null {
  const seen = new Set<number>();
  for (const s of segments) {
    if (s.endMs < s.startMs) return `Segment ${s.sortIndex}: end before start`;
    if (seen.has(s.sortIndex)) return `Segment ${s.sortIndex}: duplicate sort index`;
    seen.add(s.sortIndex);
    const languages = new Set<string>();
    for (const tr of s.translations) {
      if (languages.has(tr.languageCode)) return `Segment ${s.sortIndex}: more than one ${tr.languageCode} translation`;
      languages.add(tr.languageCode);
    }
  }
  return null;
}

/** Share of the lesson covered by segments (0 when the duration is unknown), capped at 100. */
export function transcriptCoverageOf(segments: readonly Pick<TranscriptSegmentInput, 'startMs' | 'endMs'>[], durationMs: number | null): number {
  const coveredMs = segments.reduce((acc, s) => acc + Math.max(0, s.endMs - s.startMs), 0);
  return durationMs && durationMs > 0 ? Math.min(100, Math.round((coveredMs / durationMs) * 100)) : 0;
}

// --- editorial decisions (approve / reject drafts) ---------------------------------------------------------

/** Content tables whose `state` the Studio's approve / reject controls move. */
export const CONTENT_DECISION_TABLES = ['missions', 'expressions', 'audio_lessons', 'characters', 'audio_course_collections'] as const;
export const ContentDecisionTableSchema = z.enum(CONTENT_DECISION_TABLES);
export type ContentDecisionTable = z.infer<typeof ContentDecisionTableSchema>;
export const EditorialDecisionSchema = z.enum(['approve', 'reject']);
export type EditorialDecision = z.infer<typeof EditorialDecisionSchema>;

/** `POST /v1/admin/content/:id/decision`. Sending back to review is `adminContentRequestReview`. Never publishes. */
export const ContentDecisionRequestSchema = z.object({ entityTable: ContentDecisionTableSchema, decision: EditorialDecisionSchema, note: z.string().max(1000).optional() });
export type ContentDecisionRequest = z.infer<typeof ContentDecisionRequestSchema>;
export const ContentDecisionResponseSchema = z.object({
  contentId: UuidSchema,
  state: ContentStateSchema,
  revision: NonNegativeIntSchema,
  /** The content already was in the target state: nothing moved, no publication event. */
  noop: z.boolean(),
  publicationEventRecorded: z.boolean(),
});
export type ContentDecisionResponse = z.infer<typeof ContentDecisionResponseSchema>;

export const DECISION_TARGET_STATE: Readonly<Record<EditorialDecision, ContentState>> = { approve: 'approved', reject: 'rejected' };

export type DecisionPlan = { ok: true; from: ContentState; to: ContentState; noop: boolean } | { ok: false; code: 'validation_failed' | 'precondition_failed'; message: string; from: string | null; to: ContentState };

/**
 * Decide whether `decision` may be applied to content in `currentState`. Published content is never changed here
 * (unpublish goes through `adminContentUnpublish` with takedown propagation), and every other move must be a legal
 * §7.6 transition (`canTransition`, i.e. `@langquest/media` `canTransitionContent`). A repeated decision is a no-op.
 */
export function planDecision(currentState: string | null | undefined, decision: EditorialDecision, canTransition: (from: ContentState, to: ContentState) => boolean): DecisionPlan {
  const to = DECISION_TARGET_STATE[decision];
  const parsed = ContentStateSchema.safeParse(currentState);
  if (!parsed.success) return { ok: false, code: 'validation_failed', message: `Content has an unknown state "${String(currentState)}"`, from: currentState ?? null, to };
  const from = parsed.data;
  if (from === 'published') return { ok: false, code: 'precondition_failed', message: 'Unpublish before changing the editorial decision.', from, to };
  if (from === to) return { ok: true, from, to, noop: true };
  if (!canTransition(from, to)) return { ok: false, code: 'precondition_failed', message: `Content in state "${from}" cannot move to "${to}"`, from, to };
  return { ok: true, from, to, noop: false };
}

// --- revision rollback (`content_revisions.snapshot`) ------------------------------------------------------

export const ROLLBACK_ENTITY_TABLES = ['audio_lessons', 'audio_course_collections', 'audio_chapters', 'missions', 'lesson_courses', 'expressions', 'characters', 'visual_assets'] as const;
export const RollbackEntityTableSchema = z.enum(ROLLBACK_ENTITY_TABLES);
export type RollbackEntityTable = z.infer<typeof RollbackEntityTableSchema>;

/** `POST /v1/admin/content/:id/rollback` — restore a revision snapshot as a NEW revision; nothing is deleted. */
export const ContentRollbackRequestSchema = z.object({ entityTable: RollbackEntityTableSchema, revision: z.number().int().min(0), note: z.string().max(500).optional() });
export type ContentRollbackRequest = z.infer<typeof ContentRollbackRequestSchema>;
export const ContentRollbackResponseSchema = z.object({ entityId: UuidSchema, revision: NonNegativeIntSchema, restoredColumns: z.array(z.string()) });
export type ContentRollbackResponse = z.infer<typeof ContentRollbackResponseSchema>;

/**
 * Columns a rollback may restore per entity — never a lifecycle state (`state`, `review_status`), native-review flag or
 * publish column (those go through decide / publish / unpublish).
 */
export const ROLLBACK_RESTORABLE_COLUMNS: Readonly<Record<RollbackEntityTable, readonly string[]>> = {
  audio_lessons: ['title_translations', 'description_translations', 'sort_order', 'episode_number', 'level', 'target_variety_id', 'instruction_language_code', 'spoken_language_codes', 'regional_dialect', 'topic', 'tags', 'scene', 'visibility', 'content_rights_id', 'cover_visual_asset_id'],
  audio_course_collections: ['title_translations', 'description_translations', 'course_track_id', 'target_variety_id', 'instruction_language_code', 'region', 'instructor_speaker_id', 'cover_visual_asset_id', 'content_rights_id', 'sort_order'],
  audio_chapters: ['title_translations', 'summary_translations', 'sort_order', 'cover_visual_asset_id'],
  missions: ['title_key', 'sort_order'],
  lesson_courses: ['sort_order'],
  expressions: ['canonical_text', 'register', 'difficulty'],
  characters: ['name', 'role', 'personality'],
  // `review_status` is the visual asset's lifecycle state (`stateOf` in apps/api `lib/content`): never restorable.
  visual_assets: ['alt_text_key', 'focal_point'],
};

/** The restorable subset of a snapshot (empty when the snapshot holds none of the allowed columns). */
export function rollbackPatch(entityTable: RollbackEntityTable, snapshot: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const col of ROLLBACK_RESTORABLE_COLUMNS[entityTable]) if (col in snapshot) patch[col] = snapshot[col];
  return patch;
}

// --- processing-job retry ----------------------------------------------------------------------------------

/** `POST /v1/admin/processing-jobs/:id/retry` — enqueue a fresh job with the same parameters; the original row stays. */
export const ProcessingJobRetryRequestSchema = z.object({ priority: z.number().int().min(0).max(10).optional() });
export type ProcessingJobRetryRequest = z.infer<typeof ProcessingJobRetryRequestSchema>;
export const ProcessingJobRetryResponseSchema = z.object({
  jobId: UuidSchema,
  state: JobStateSchema,
  retriedJobId: UuidSchema,
  /** `asset_process`: asset-parented job re-run like `adminAssetProcess` with `force`; `enqueue`: direct re-enqueue. */
  via: z.enum(['asset_process', 'enqueue']),
});
export type ProcessingJobRetryResponse = z.infer<typeof ProcessingJobRetryResponseSchema>;

/** Handler names registered by `apps/jobs/src/handlers/index.ts` (`buildRegistry`). */
export const RUNNER_HANDLER_NAMES = ['inspect_asset', 'transcode', 'transcribe', 'align', 'translate_transcript', 'infer_metadata', 'import_r2_prefix', 'import_manifest', 'generate_content', 'regenerate_manifest', 'render_cover', 'cleanup_orphan_uploads'] as const;
export type RunnerHandlerName = (typeof RUNNER_HANDLER_NAMES)[number];

/** Mirror of `JOB_TYPE_HANDLERS` in `apps/jobs/src/queue/types.ts`; `null` = no runner serves the type. */
export const RUNNER_JOB_TYPE_HANDLERS: Readonly<Record<ProcessingJobType, RunnerHandlerName | null>> = {
  verify: 'inspect_asset',
  extract_metadata: 'inspect_asset',
  transcode: 'transcode',
  transcribe: 'transcribe',
  align: 'align',
  detect_language: 'infer_metadata',
  describe: 'infer_metadata',
  segment_lessons: 'infer_metadata',
  generate_cover: 'render_cover',
  import_prefix: 'import_r2_prefix',
  import_manifest: 'import_manifest',
  content_generate: 'generate_content',
  benchmark_model: null,
  image_generate: null,
};

/** Extension job types (migration 100) whose dedicated value the runner resolves only through `params.handler`. */
export const RUNNER_EXTENSION_HANDLER_BY_TYPE: Readonly<Record<(typeof PROCESSING_JOB_TYPE_EXTENSION_VALUES)[number], RunnerHandlerName>> = {
  translate_transcript: 'translate_transcript',
  regenerate_manifest: 'regenerate_manifest',
  cleanup_orphan_uploads: 'cleanup_orphan_uploads',
  render_cover: 'render_cover',
  infer_metadata: 'infer_metadata',
  generate_content: 'generate_content',
  import_r2_prefix: 'import_r2_prefix',
};

const isRunnerHandlerName = (v: unknown): v is RunnerHandlerName => typeof v === 'string' && (RUNNER_HANDLER_NAMES as readonly string[]).includes(v);

/**
 * Which `apps/jobs` handler would run a job row, exactly as `resolveHandlerName` does there: an explicit
 * `params.handler` wins, then the base map; extension types without a marker are not served by the current runner.
 */
export function runnerHandlerFor(job: { job_type: string; params: unknown }): RunnerHandlerName | null {
  const params = (job.params && typeof job.params === 'object' ? job.params : {}) as Record<string, unknown>;
  if (isRunnerHandlerName(params.handler)) return params.handler;
  if (job.job_type in RUNNER_JOB_TYPE_HANDLERS) return RUNNER_JOB_TYPE_HANDLERS[job.job_type as ProcessingJobType];
  return null;
}

export interface RetryableJob {
  id: string;
  job_type: string;
  state: string;
  params: unknown;
  parent_asset_id: string | null;
  parent_entity_table: string | null;
  parent_entity_id: string | null;
  priority: number;
  provider: string | null;
  max_attempts: number;
  idempotency_key: string;
  attempts: number;
}

export type RetryPlan =
  | { kind: 'refused'; code: 'precondition_failed' | 'validation_failed'; message: string }
  | { kind: 'asset_process'; assetId: string; operation: ProcessingJobTypeAll; params: Record<string, unknown>; priority: number }
  | { kind: 'enqueue'; jobType: ProcessingJobTypeAll; params: Record<string, unknown>; priority: number; idempotencyKey: string };

function unservedHint(jobType: string): string {
  if (jobType === 'benchmark_model') return 'Benchmarks are run synchronously by the API; start a new one from the AI models screen.';
  if (jobType === 'image_generate') return 'Image generation has no runner yet.';
  return 'The job carries no params.handler marker, so the runner would never claim it.';
}

/**
 * Plan a retry. A retry must never create a row no runner will pick up (it would sit `pending` forever and read
 * as "queued"), so pending / running jobs and unserved job types are refused. Asset-parented jobs are re-run like
 * `adminAssetProcess` with `force`; others are re-enqueued with a retry-unique idempotency key (`now` seeds it) so
 * the original failed row is kept.
 */
export function planJobRetry(job: RetryableJob, priorityOverride: number | undefined, now: number = Date.now()): RetryPlan {
  if (job.state === 'running' || job.state === 'pending') return { kind: 'refused', code: 'precondition_failed', message: `Job is ${job.state}; retry applies to failed or review_needed jobs.` };
  if (!isProcessingJobTypeAll(job.job_type)) return { kind: 'refused', code: 'validation_failed', message: `Unknown job type "${job.job_type}"` };
  if (runnerHandlerFor(job) === null) return { kind: 'refused', code: 'precondition_failed', message: `No runner serves job type "${job.job_type}". ${unservedHint(job.job_type)}` };
  const params = (job.params && typeof job.params === 'object' && !Array.isArray(job.params) ? job.params : {}) as Record<string, unknown>;
  const priority = priorityOverride ?? job.priority;
  if (job.parent_asset_id) return { kind: 'asset_process', assetId: job.parent_asset_id, operation: job.job_type, params, priority };
  return { kind: 'enqueue', jobType: job.job_type, params, priority, idempotencyKey: `${job.idempotency_key}:retry:${job.attempts + 1}:${now.toString(36)}` };
}

// --- staff roles (`user_roles`; super_admin only) ----------------------------------------------------------

/** `POST /v1/admin/users/:userId/roles` — grant (or re-grant with a new expiry) one role to a Supabase Auth user id. */
export const UserRoleGrantRequestSchema = z.object({ role: RoleSchema, expiresAt: TimestamptzSchema.nullable().default(null) });
export type UserRoleGrantRequest = z.infer<typeof UserRoleGrantRequestSchema>;
export const UserRoleGrantResponseSchema = z.object({ id: UuidSchema, userId: UuidSchema, role: RoleSchema, expiresAt: TimestamptzSchema.nullable() });
export type UserRoleGrantResponse = z.infer<typeof UserRoleGrantResponseSchema>;
/** `DELETE /v1/admin/users/:userId/roles/:role` — never your own `super_admin`. */
export const UserRoleRevokeResponseSchema = z.object({ userId: UuidSchema, role: RoleSchema, revoked: NonNegativeIntSchema });
export type UserRoleRevokeResponse = z.infer<typeof UserRoleRevokeResponseSchema>;

// --- AI models test harness ---------------------------------------------------------------------------------

/** Text tasks a prompt probe may run as (speech tasks are probed with the synthesize / transcribe modes). */
export const MODEL_TEST_TEXT_TASKS = ['character_dialogue', 'content_generation', 'scene_planning', 'meaning_assessment', 'source_explanation', 'learner_evaluation', 'language_quality_check'] as const satisfies readonly AiTaskName[];
export const ModelTestTextTaskSchema = z.enum(MODEL_TEST_TEXT_TASKS);

/**
 * `POST /v1/admin/models/test` (admins). Every probe runs through the Worker's own AI wiring, so it exercises what
 * learners get. Synthesize / transcribe probes are logged to `ai_requests`; prompt probes are not yet (see `traceId`):
 * - `prompt`: the task's structured-output path (`TextReasoner.generateStructured`) with `model` tried first and the
 *   task profile's chain (per-task model registry) as fallback;
 * - `synthesize`: the per-variety voice registry (the voice decides the model; variety boundary enforced);
 * - `transcribe`: the per-variety STT route.
 */
export const ModelTestRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('prompt'),
    task: ModelTestTextTaskSchema.default('character_dialogue'),
    targetVariety: VarietyIdSchema,
    sourceLanguage: SourceLanguageCodeSchema.default('en'),
    model: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(4000),
    system: z.string().max(4000).optional(),
  }),
  z.object({ mode: z.literal('synthesize'), targetVariety: VarietyIdSchema, text: z.string().min(1).max(1000), voiceId: z.string().max(120).optional() }),
  z.object({ mode: z.literal('transcribe'), targetVariety: VarietyIdSchema, audioBase64: z.string().min(1).max(8_000_000), encoding: AudioEncodingSchema }),
]);
export type ModelTestRequest = z.infer<typeof ModelTestRequestSchema>;

export const ModelTestResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('prompt'),
    task: ModelTestTextTaskSchema,
    targetVariety: VarietyIdSchema,
    sourceLanguage: SourceLanguageCodeSchema,
    requestedModel: z.string(),
    /** The routing chain the call was sent with (requested model first, then the task profile's models). */
    modelChain: z.array(z.string()).min(1),
    content: z.string(),
    latencyMs: MillisSchema,
    /**
     * Trace id the call was sent with. Known gap: no `ai_requests` row is written for prompt probes yet (the probe's
     * random enrollment id fails the row's foreign key), so this id matches no cost record today.
     */
    traceId: z.string(),
  }),
  z.object({
    mode: z.literal('synthesize'),
    targetVariety: VarietyIdSchema,
    voiceId: z.string(),
    model: z.string().nullable(),
    mimeType: z.string(),
    audioBase64: z.string(),
    durationMs: MillisSchema,
    latencyMs: MillisSchema,
    cached: z.boolean(),
    synthetic: z.literal(true),
    traceId: z.string(),
  }),
  z.object({
    mode: z.literal('transcribe'),
    targetVariety: VarietyIdSchema,
    text: z.string(),
    detectedLanguage: z.string().nullable(),
    confidence: UnitIntervalSchema.nullable(),
    durationMs: MillisSchema.nullable(),
    languageMismatch: z.boolean(),
    model: z.string(),
    segments: z.array(z.object({ index: NonNegativeIntSchema, text: z.string(), startMs: MillisSchema, endMs: MillisSchema })).max(50),
    latencyMs: MillisSchema,
    traceId: z.string(),
  }),
]);
export type ModelTestResponse = z.infer<typeof ModelTestResponseSchema>;
