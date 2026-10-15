/**
 * Handler registry contract shared by both queue backends (ADR-005): the Postgres poll loop and the
 * Cloudflare Queues consumer invoke the same `JobHandler`s. A handler is keyed by its **handler name**;
 * the `processing_jobs.job_type` domain is mapped onto handler names here.
 *
 * The DB domain (`verify, extract_metadata, transcode, transcribe, align, detect_language, describe,
 * segment_lessons, generate_cover, import_prefix, import_manifest, content_generate, benchmark_model,
 * image_generate`) has no dedicated value for `translate_transcript`, `regenerate_manifest` and
 * `cleanup_orphan_uploads`; those run under the carrier type `describe` with `params.handler` set
 * (see `EXTENSION_CARRIER_JOB_TYPE`). Adding proper enum values is tracked as a cross-package gap.
 */
import type { ProcessingJobType, DomainEvent, DomainEventType, DomainEventPayload } from '@langquest/contracts';
import { PROCESSING_JOB_TYPE_VALUES } from '@langquest/contracts';
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

/** DB job type → handler. `null` = no handler in this runner (benchmark/image generation live elsewhere). */
export const JOB_TYPE_HANDLERS: Readonly<Record<ProcessingJobType, HandlerName | null>> = {
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

/** Carrier job type for handlers that have no dedicated `processing_job_type` value yet. */
export const EXTENSION_CARRIER_JOB_TYPE: ProcessingJobType = 'describe';

/** Primary DB job type to enqueue for a handler (plus `params.handler` for extension handlers). */
export const HANDLER_PRIMARY_JOB_TYPE: Readonly<Record<HandlerName, ProcessingJobType>> = {
  inspect_asset: 'verify',
  transcode: 'transcode',
  transcribe: 'transcribe',
  align: 'align',
  translate_transcript: EXTENSION_CARRIER_JOB_TYPE,
  infer_metadata: 'describe',
  import_r2_prefix: 'import_prefix',
  import_manifest: 'import_manifest',
  generate_content: 'content_generate',
  regenerate_manifest: EXTENSION_CARRIER_JOB_TYPE,
  render_cover: 'generate_cover',
  cleanup_orphan_uploads: EXTENSION_CARRIER_JOB_TYPE,
};

/** Handlers that need `params.handler` because they ride on the carrier type. */
export const EXTENSION_HANDLERS: readonly HandlerName[] = ['translate_transcript', 'regenerate_manifest', 'cleanup_orphan_uploads'];

export const isProcessingJobType = (v: unknown): v is ProcessingJobType => typeof v === 'string' && (PROCESSING_JOB_TYPE_VALUES as readonly string[]).includes(v);

/** Resolve which handler should run a row: explicit `params.handler` wins, else the job-type map. */
export function resolveHandlerName(job: Pick<ProcessingJobRow, 'job_type' | 'params'>): HandlerName | null {
  const params = (job.params ?? {}) as Record<string, unknown>;
  if (isHandlerName(params.handler)) return params.handler;
  return isProcessingJobType(job.job_type) ? JOB_TYPE_HANDLERS[job.job_type] : null;
}

/** Enqueue arguments for a handler + params (adds `params.handler` for extension handlers). */
export function enqueueSpecFor(handler: HandlerName, params: Record<string, unknown>): { jobType: ProcessingJobType; params: Record<string, unknown> } {
  const jobType = HANDLER_PRIMARY_JOB_TYPE[handler];
  const needsMarker = EXTENSION_HANDLERS.includes(handler) || JOB_TYPE_HANDLERS[jobType] !== handler;
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
  /** DB job types this handler serves (for the claim filter). */
  jobTypes: readonly ProcessingJobType[];
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

  /** Every DB job type some registered handler can serve (used as the claim filter). */
  jobTypes(): ProcessingJobType[] {
    const set = new Set<ProcessingJobType>();
    for (const h of this.byName.values()) for (const t of h.jobTypes) set.add(t);
    if (EXTENSION_HANDLERS.some((n) => this.byName.has(n))) set.add(EXTENSION_CARRIER_JOB_TYPE);
    return [...set];
  }

  /** Resolve the handler for a claimed row, or `null` when nothing here can run it. */
  resolve(job: Pick<ProcessingJobRow, 'job_type' | 'params'>): JobHandler | null {
    const name = resolveHandlerName(job);
    return name ? this.get(name) : null;
  }
}
