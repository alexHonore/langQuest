/**
 * Retry planning for the local `jobs/:id/retry` adapter route.
 *
 * A retry must never create a row no runner will ever pick up (it would sit `pending` forever and
 * read as "queued" in the UI). The plan therefore:
 *   1. refuses jobs that are still pending / running,
 *   2. refuses job types that the `apps/jobs` runner has no handler for (`benchmark_model`,
 *      `image_generate`, and extension types without a `params.handler` marker),
 *   3. routes asset-parented jobs through the API (`adminAssetProcess`, which audits and wakes the
 *      queue backend) and only falls back to a direct `enqueue_processing_job` for jobs that have no
 *      parent asset (imports, content generation, manifest regeneration).
 *
 * Cross-package gap: the runner's job-type → handler table lives in `apps/jobs/src/queue/types.ts`
 * and is mirrored here; it should be exported from `@langquest/contracts` so both stay in sync.
 */
import { PROCESSING_JOB_TYPE_EXTENSION_VALUES, isProcessingJobTypeAll, type ProcessingJobType, type ProcessingJobTypeAll } from '@langquest/contracts';

/** Handler names registered by `apps/jobs/src/handlers/index.ts` (`buildRegistry`). */
export const RUNNER_HANDLER_NAMES = ['inspect_asset', 'transcode', 'transcribe', 'align', 'translate_transcript', 'infer_metadata', 'import_r2_prefix', 'import_manifest', 'generate_content', 'regenerate_manifest', 'render_cover', 'cleanup_orphan_uploads'] as const;
export type RunnerHandlerName = (typeof RUNNER_HANDLER_NAMES)[number];

/** Mirror of `JOB_TYPE_HANDLERS` in `apps/jobs/src/queue/types.ts`; `null` = no runner serves it. */
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
 * Which `apps/jobs` handler would run a job row, exactly as `resolveHandlerName` does there:
 * an explicit `params.handler` wins, then the base map; extension types without a marker are
 * not served by the current runner (it keys its map on the base set).
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
  | { kind: 'api_asset_process'; assetId: string; operation: ProcessingJobTypeAll; params: Record<string, unknown>; priority: number }
  | { kind: 'local_enqueue'; jobType: ProcessingJobTypeAll; params: Record<string, unknown>; priority: number; idempotencyKey: string };

/** Human hint for job types that cannot be retried from the queue screen. */
function unservedHint(jobType: string): string {
  if (jobType === 'benchmark_model') return 'Benchmarks are run synchronously by the API; start a new one from the AI models screen.';
  if (jobType === 'image_generate') return 'Image generation has no runner yet.';
  return 'The job carries no params.handler marker, so the runner would never claim it.';
}

/**
 * Plan a retry for `job`. `priorityOverride` comes from the request body; `now` seeds the
 * idempotency key for direct enqueues (unique per retry so the original failed row is kept).
 */
export function planJobRetry(job: RetryableJob, priorityOverride: number | undefined, now: number = Date.now()): RetryPlan {
  if (job.state === 'running' || job.state === 'pending') return { kind: 'refused', code: 'precondition_failed', message: `Job is ${job.state}; retry applies to failed or review_needed jobs.` };
  if (!isProcessingJobTypeAll(job.job_type)) return { kind: 'refused', code: 'validation_failed', message: `Unknown job type "${job.job_type}"` };
  if (runnerHandlerFor(job) === null) return { kind: 'refused', code: 'precondition_failed', message: `No runner serves job type "${job.job_type}". ${unservedHint(job.job_type)}` };
  const params = (job.params && typeof job.params === 'object' && !Array.isArray(job.params) ? job.params : {}) as Record<string, unknown>;
  const priority = priorityOverride ?? job.priority;
  if (job.parent_asset_id) return { kind: 'api_asset_process', assetId: job.parent_asset_id, operation: job.job_type, params, priority };
  return { kind: 'local_enqueue', jobType: job.job_type, params, priority, idempotencyKey: `${job.idempotency_key}:retry:${job.attempts + 1}:${now.toString(36)}` };
}
