/**
 * Handler registry contract shared by both queue backends (ADR-005): the Postgres poll loop and the
 * Cloudflare Queues consumer invoke the same `JobHandler`s. A handler is keyed by its **handler name**;
 * every value of the `processing_jobs.job_type` domain (`PROCESSING_JOB_TYPE_VALUES_ALL`) is mapped onto a
 * handler name (or explicitly `null`) in `JOB_TYPE_HANDLERS`, and that map is the claim filter.
 *
 * Since migration 100 (2026-10-15) the domain carries a dedicated value for every handler, including
 * `translate_transcript`, `regenerate_manifest` and `cleanup_orphan_uploads`, which used to ride on the
 * carrier type `describe` + `params.handler`. New rows are enqueued with the dedicated type; rows written
 * before the migration (carrier type + `params.handler`) are still routed by `params.handler`, which always
 * wins over the job-type map (`resolveHandlerName`).
 */
import type { ProcessingJobTypeAll, DomainEvent, DomainEventType, DomainEventPayload } from '@langquest/contracts';
import { PROCESSING_JOB_TYPE_VALUES_ALL } from '@langquest/contracts';
import type { Row } from '@langquest/db';
import type { z } from 'zod';
import type { Logger } from '../logger';
import type { JobServices } from '../services';
import type { JobCostTracker } from '../cost';

export type ProcessingJobRow = Row<'processing_jobs'>;

export const HANDLER_NAMES = [
  'inspect_asset',
  'transcode',
  'transcribe',
  'align',
  'translate_transcript',
  'infer_metadata',
  'import_r2_prefix',
  'import_manifest',
  'generate_content',
  'regenerate_manifest',
  'render_cover',
  'cleanup_orphan_uploads',
] as const;
export type HandlerName = (typeof HANDLER_NAMES)[number];

export const isHandlerName = (v: unknown): v is HandlerName => typeof v === 'string' && (HANDLER_NAMES as readonly string[]).includes(v);

/**
 * DB job type → handler, over the WHOLE domain (base + extension values). `null` = no handler in this runner
 * (benchmark / image generation live elsewhere). `queue.test.ts` asserts every domain value is listed here.
 */
export const JOB_TYPE_HANDLERS: Readonly<Record<ProcessingJobTypeAll, HandlerName | null>> = {
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
  // Extension values (migration 100): dedicated types for the former carrier handlers …
  translate_transcript: 'translate_transcript',
  regenerate_manifest: 'regenerate_manifest',
  cleanup_orphan_uploads: 'cleanup_orphan_uploads',
  // … and handler-name aliases of base types, accepted so callers may enqueue by handler name.
  render_cover: 'render_cover',
  infer_metadata: 'infer_metadata',
  generate_content: 'generate_content',
  import_r2_prefix: 'import_r2_prefix',
};

/**
 * Carrier job type that `translate_transcript`, `regenerate_manifest` and `cleanup_orphan_uploads` rode on
 * before migration 100 (with `params.handler`). Kept only so pre-migration rows still resolve; nothing new
 * is enqueued with it.
 */
export const LEGACY_CARRIER_JOB_TYPE: ProcessingJobTypeAll = 'describe';
/** @deprecated use `LEGACY_CARRIER_JOB_TYPE`; new rows get their dedicated job type. */
export const EXTENSION_CARRIER_JOB_TYPE = LEGACY_CARRIER_JOB_TYPE;

/**
 * Primary DB job type to enqueue for a handler. Handlers that map onto a base value keep enqueuing it (API
 * routes, `EVENT_JOB_HINTS` and idempotency keys use the base names); the three former carrier handlers
 * enqueue their dedicated extension value.
 */
export const HANDLER_PRIMARY_JOB_TYPE: Readonly<Record<HandlerName, ProcessingJobTypeAll>> = {
  inspect_asset: 'verify',
  transcode: 'transcode',
  transcribe: 'transcribe',
  align: 'align',
  translate_transcript: 'translate_transcript',
  infer_metadata: 'describe',
  import_r2_prefix: 'import_prefix',
  import_manifest: 'import_manifest',
  generate_content: 'content_generate',
  regenerate_manifest: 'regenerate_manifest',
  render_cover: 'generate_cover',
  cleanup_orphan_uploads: 'cleanup_orphan_uploads',
};

/** Handlers whose pre-migration rows ride on `LEGACY_CARRIER_JOB_TYPE` + `params.handler`. */
export const LEGACY_CARRIER_HANDLERS: readonly HandlerName[] = ['translate_transcript', 'regenerate_manifest', 'cleanup_orphan_uploads'];
/** @deprecated use `LEGACY_CARRIER_HANDLERS`. */
export const EXTENSION_HANDLERS = LEGACY_CARRIER_HANDLERS;

/** True for every value the `processing_job_type` domain accepts (base + extension). */
export const isProcessingJobType = (v: unknown): v is ProcessingJobTypeAll => typeof v === 'string' && (PROCESSING_JOB_TYPE_VALUES_ALL as readonly string[]).includes(v);

/** Resolve which handler should run a row: explicit `params.handler` wins, else the job-type map. */
export function resolveHandlerName(job: Pick<ProcessingJobRow, 'job_type' | 'params'>): HandlerName | null {
  const params = (job.params ?? {}) as Record<string, unknown>;
  if (isHandlerName(params.handler)) return params.handler;
  return isProcessingJobType(job.job_type) ? JOB_TYPE_HANDLERS[job.job_type] : null;
}

/**
 * Enqueue arguments for a handler + params. Every handler has a dedicated job type now, so `params.handler`
 * is only added when the primary type maps to a different handler (defensive; never the case today).
 */
export function enqueueSpecFor(handler: HandlerName, params: Record<string, unknown>): { jobType: ProcessingJobTypeAll; params: Record<string, unknown> } {
  const jobType = HANDLER_PRIMARY_JOB_TYPE[handler];
  const needsMarker = JOB_TYPE_HANDLERS[jobType] !== handler;
  return { jobType, params: needsMarker ? { ...params, handler } : params };
}

/** Thrown by handlers to control retry semantics; anything else is treated as a retryable unhandled error. */
export class JobFailure extends Error {
  readonly code: string;
  readonly retry: boolean;
  readonly backoffSeconds: number | undefined;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, options: { retry?: boolean; backoffSeconds?: number; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'JobFailure';
    this.code = code;
    this.retry = options.retry ?? false;
    this.backoffSeconds = options.backoffSeconds;
    this.details = options.details;
  }
}

export interface JobResult {
  output?: Record<string, unknown>;
  outputAssetIds?: string[];
}

export interface JobContext<P = Record<string, unknown>> {
  job: ProcessingJobRow;
  handler: HandlerName;
  workerId: string;
  params: P;
  services: JobServices;
  log: Logger;
  /** Per-job scratch directory (deleted after the job). */
  workDir: string;
  /** Aborted on shutdown or when the lease is lost; long handlers must observe it. */
  signal: AbortSignal;
  /** Report progress 0..100 (also extends the lease). */
  progress(pct: number, note?: string): Promise<void>;
  cost: JobCostTracker;
  /** Emit a domain event (logged; may enqueue follow-up jobs when auto-chaining is on). */
  emit<T extends DomainEventType>(type: T, payload: DomainEventPayload<T>, idempotencyKey: string): Promise<DomainEvent>;
  traceId: string;
}

export interface JobHandler<P = Record<string, unknown>> {
  name: HandlerName;
  /** DB job types this handler serves (for the claim filter); the first one is its canonical type. */
  jobTypes: readonly ProcessingJobTypeAll[];
  /** `node` = needs ffmpeg / filesystem (never runs inside a Worker); `any` = pure DB + HTTP work. */
  runtime: 'node' | 'any';
  paramsSchema: z.ZodType<P>;
  run(ctx: JobContext<P>): Promise<JobResult>;
}

export class HandlerRegistry {
  private readonly byName = new Map<HandlerName, JobHandler>();

  register<P>(handler: JobHandler<P>): this {
    if (this.byName.has(handler.name)) throw new Error(`Handler ${handler.name} registered twice`);
    this.byName.set(handler.name, handler as unknown as JobHandler);
    return this;
  }

  get(name: HandlerName): JobHandler | null {
    return this.byName.get(name) ?? null;
  }

  has(name: HandlerName): boolean {
    return this.byName.has(name);
  }

  list(): JobHandler[] {
    return [...this.byName.values()];
  }

  /**
   * Every DB job type some registered handler can serve (used as the claim filter). Pre-migration carrier
   * rows (`describe` + `params.handler`) are claimed whenever the `describe` handler is registered, which the
   * full registry always does; a partial registry never claims `describe` rows it cannot run.
   */
  jobTypes(): ProcessingJobTypeAll[] {
    const set = new Set<ProcessingJobTypeAll>();
    for (const h of this.byName.values()) for (const t of h.jobTypes) set.add(t);
    return [...set];
  }

  /** Resolve the handler for a claimed row, or `null` when nothing here can run it. */
  resolve(job: Pick<ProcessingJobRow, 'job_type' | 'params'>): JobHandler | null {
    const name = resolveHandlerName(job);
    return name ? this.get(name) : null;
  }
}
