/**
 * Job execution + the Postgres poll loop (ADR-005, `JOBS_BACKEND=postgres`).
 *
 * - `JobExecutor.execute(job)` runs one **already claimed** row: per-job scratch dir, heartbeat timer that
 *   extends the lease (and aborts the handler when the lease is lost), Zod-validated params, cost
 *   accounting, then `complete_processing_job` / `fail_processing_job` (backoff + `review_needed` on
 *   exhaustion are decided in SQL).
 * - `PostgresJobRunner` claims with `claim_processing_job` (FOR UPDATE SKIP LOCKED) up to `concurrency`
 *   jobs at a time, sweeps expired leases with `requeue_expired_jobs`, exits when idle (cron mode) and
 *   shuts down gracefully on SIGINT/SIGTERM (stops claiming, lets running jobs finish or abort them).
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AiCapabilityError, AiProviderUnavailableError, OpenRouterError, StructuredOutputError } from '@langquest/ai';
import { telemetry } from '@langquest/telemetry';
import { DbError } from '@langquest/db';
import { CostCeilingExceeded, JobCostTracker } from '../cost';
import { FfmpegError } from '../ffmpeg';
import type { Logger } from '../logger';
import { AiUnavailableError, type JobServices } from '../services';
import { JobFailure, type HandlerName, type HandlerRegistry, type JobContext, type JobHandler, type JobResult, type ProcessingJobRow, resolveHandlerName } from './types';

export type JobOutcome =
  | { status: 'succeeded'; job: ProcessingJobRow; result: JobResult; costUsd: number }
  | { status: 'failed'; job: ProcessingJobRow; code: string; message: string; retry: boolean };

export interface ExecutorOptions {
  services: JobServices;
  registry: HandlerRegistry;
  workerId: string;
  leaseSeconds?: number;
  heartbeatMs?: number;
  log?: Logger;
  /** Process-wide shutdown signal; every running job inherits it. */
  signal?: AbortSignal;
}

/** Classify an arbitrary error into a failure code + retry decision. */
export function classifyError(error: unknown): { code: string; message: string; retry: boolean; backoffSeconds?: number } {
  if (error instanceof JobFailure) return { code: error.code, message: error.message, retry: error.retry, backoffSeconds: error.backoffSeconds };
  if (error instanceof CostCeilingExceeded) return { code: 'cost_ceiling_exceeded', message: error.message, retry: false };
  if (error instanceof AiUnavailableError) return { code: 'provider_unavailable', message: error.message, retry: true, backoffSeconds: 600 };
  if (error instanceof AiCapabilityError) return { code: 'capability_unsupported', message: error.message, retry: false };
  if (error instanceof AiProviderUnavailableError) return { code: 'provider_unavailable', message: error.message, retry: true, backoffSeconds: 300 };
  if (error instanceof StructuredOutputError) return { code: 'ai_output_invalid', message: error.message, retry: true, backoffSeconds: 120 };
  if (error instanceof OpenRouterError) return { code: `openrouter_${error.kind}`, message: error.message, retry: error.retryable, backoffSeconds: error.kind === 'rate_limited' ? 300 : 120 };
  if (error instanceof FfmpegError) return { code: 'ffmpeg_failed', message: error.message, retry: false };
  if (error instanceof DbError) return { code: `db_${error.code}`, message: error.message, retry: !error.isForbidden && !error.isUniqueViolation };
  if (error instanceof Error && error.name === 'AbortError') return { code: 'aborted', message: error.message, retry: true, backoffSeconds: 30 };
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'unhandled_error', message, retry: true };
}

export class JobExecutor {
  private readonly services: JobServices;
  private readonly registry: HandlerRegistry;
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly heartbeatMs: number;
  private readonly log: Logger;
  private readonly signal: AbortSignal | undefined;

  constructor(options: ExecutorOptions) {
    this.services = options.services;
    this.registry = options.registry;
    this.workerId = options.workerId;
    this.leaseSeconds = options.leaseSeconds ?? options.services.env.JOBS_LEASE_SECONDS;
    this.heartbeatMs = options.heartbeatMs ?? options.services.env.JOBS_HEARTBEAT_MS;
    this.log = options.log ?? options.services.log;
    this.signal = options.signal;
  }

  /** Run a claimed job to completion (`succeeded` / `failed`), always releasing the row. */
  async execute(job: ProcessingJobRow): Promise<JobOutcome> {
    const { services } = this;
    const jobs = services.repos.processingJobs;
    const handlerName = resolveHandlerName(job);
    const handler = handlerName ? this.registry.get(handlerName) : null;
    const log = this.log.child({ jobId: job.id, jobType: job.job_type, handler: handlerName, attempt: job.attempts });
    const traceId = `job:${job.id}:${job.attempts}`;

    if (!handler) {
      const message = `No handler registered for job type ${job.job_type}${handlerName ? ` (handler ${handlerName})` : ''}`;
      log.error('job.no_handler');
      const failed = await jobs.fail(job.id, this.workerId, 'no_handler', message, { retry: false });
      return { status: 'failed', job: failed, code: 'no_handler', message, retry: false };
    }

    const abort = new AbortController();
    const onParentAbort = () => abort.abort(new Error('shutdown'));
    if (this.signal?.aborted) onParentAbort();
    this.signal?.addEventListener('abort', onParentAbort, { once: true });

    const workDir = join(services.workRoot, job.id);
    await mkdir(workDir, { recursive: true });

    const cost = new JobCostTracker({
      jobId: job.id,
      traceId,
      maxUsd: services.env.JOBS_MAX_COST_PER_JOB_USD,
      persistAiRequest: services.client ? (row) => services.db.logAiRequest(row) : undefined,
      onPersistError: (error) => log.warn('job.ai_request_persist_failed', { error }),
    });

    let lastProgress = Number(job.progress_pct ?? 0);
    let leaseLost = false;
    const heartbeat = async (pct?: number): Promise<void> => {
      try {
        const ok = await jobs.heartbeat(job.id, this.workerId, pct, this.leaseSeconds);
        if (!ok && !leaseLost) {
          leaseLost = true;
          log.error('job.lease_lost', { message: 'heartbeat rejected: another worker owns this job now' });
          abort.abort(new Error('lease_lost'));
        }
      } catch (error) {
        log.warn('job.heartbeat_failed', { error });
      }
    };
    const timer = setInterval(() => void heartbeat(), this.heartbeatMs);

    const startedAt = Date.now();
    log.info('job.start', { params: Object.keys((job.params as object) ?? {}) });

    const ctx: JobContext = {
      job,
      handler: handler.name,
      workerId: this.workerId,
      params: {},
      services,
      log,
      workDir,
      signal: abort.signal,
      traceId,
      cost,
      progress: async (pct, note) => {
        const clamped = Math.max(lastProgress, Math.min(100, Math.max(0, pct)));
        lastProgress = clamped;
        if (note) log.debug('job.progress', { pct: clamped, note });
        await heartbeat(clamped);
      },
      emit: (type, payload, idempotencyKey) => services.events.emit(type, payload, idempotencyKey, traceId, { jobId: job.id, requestedBy: job.requested_by }),
    };

    let outcome: JobOutcome;
    try {
      const parsed = handler.paramsSchema.safeParse(job.params ?? {});
      if (!parsed.success) throw new JobFailure('invalid_params', `Invalid params for ${handler.name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, { retry: false });
      ctx.params = parsed.data as Record<string, unknown>;
      const result = await (handler as JobHandler<Record<string, unknown>>).run(ctx);
      await cost.flush();
      const summary = cost.summary();
      const output = { ...(result.output ?? {}), _cost: summary, _durationMs: Date.now() - startedAt, _worker: this.workerId };
      const completed = await jobs.complete(job.id, this.workerId, output, result.outputAssetIds ?? [], summary.usd);
      outcome = { status: 'succeeded', job: completed, result, costUsd: summary.usd };
      log.info('job.succeeded', { durationMs: Date.now() - startedAt, costUsd: summary.usd, outputAssetIds: result.outputAssetIds?.length ?? 0 });
    } catch (error) {
      await cost.flush();
      const cls = classifyError(error);
      const summary = cost.summary();
      log.error('job.failed', { code: cls.code, retry: cls.retry, durationMs: Date.now() - startedAt, costUsd: summary.usd, error });
      let failedRow = job;
      if (!leaseLost) {
        try {
          failedRow = await jobs.fail(job.id, this.workerId, cls.code, cls.message.slice(0, 2000), { retry: cls.retry, backoffSeconds: cls.backoffSeconds });
        } catch (failError) {
          log.error('job.fail_rpc_failed', { error: failError });
        }
      }
      outcome = { status: 'failed', job: failedRow, code: cls.code, message: cls.message, retry: cls.retry };
    } finally {
      clearInterval(timer);
      this.signal?.removeEventListener('abort', onParentAbort);
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    try {
      const summary = cost.summary();
      const event = telemetry.jobCost(services.telemetry.ctx, { jobId: job.id, jobType: job.job_type, estimatedUsd: job.cost_estimate_usd === null ? null : Number(job.cost_estimate_usd), actualUsd: summary.usd, cpuMs: summary.ffmpegMs || null });
      await services.telemetry.sink.write([event]);
    } catch (error) {
      log.warn('job.telemetry_failed', { error });
    }
    return outcome;
  }
}

export interface RunDirectOptions {
  services: JobServices;
  registry: HandlerRegistry;
  workerId: string;
  handler: HandlerName;
  jobType: string;
  params: Record<string, unknown>;
  parentAssetId?: string | null;
  requestedBy?: string | null;
  log?: Logger;
}

/**
 * Run a handler in-process WITHOUT a queue row (local testing / cron one-offs such as manifest
 * regeneration). A synthetic `processing_jobs` row is passed to the handler and the claim/heartbeat/
 * complete/fail RPCs are shimmed, so nothing is written to `processing_jobs`; everything the handler
 * itself writes (assets, transcripts, …) is real.
 */
export async function runDirect(options: RunDirectOptions): Promise<JobOutcome> {
  const now = options.services.now().toISOString();
  const id = options.services.newId();
  const row: ProcessingJobRow = {
    id,
    job_type: options.jobType,
    parent_asset_id: options.parentAssetId ?? null,
    parent_entity_table: null,
    parent_entity_id: null,
    state: 'running',
    priority: 5,
    attempts: 1,
    max_attempts: 1,
    progress_pct: 0,
    provider: null,
    params: { ...options.params, handler: options.handler } as never,
    cost_estimate_usd: null,
    cost_actual_usd: null,
    failure_code: null,
    failure_message: null,
    output_asset_ids: [],
    output: null,
    idempotency_key: `direct:${id}`,
    requested_by: options.requestedBy ?? null,
    started_at: now,
    finished_at: null,
    locked_by: options.workerId,
    locked_until: null,
    created_at: now,
    updated_at: now,
  };
  const real = options.services.repos.processingJobs;
  const shim: typeof real = {
    ...real,
    heartbeat: async () => true,
    complete: async (_jobId, _worker, output, outputAssetIds, cost) => ({ ...row, state: 'succeeded', output: (output ?? null) as never, output_asset_ids: outputAssetIds ?? [], cost_actual_usd: cost ?? null, finished_at: options.services.now().toISOString() }),
    fail: async (_jobId, _worker, code, message) => ({ ...row, state: 'failed', failure_code: code, failure_message: message ?? null, finished_at: options.services.now().toISOString() }),
  };
  const services: JobServices = { ...options.services, repos: { ...options.services.repos, processingJobs: shim } };
  const executor = new JobExecutor({ services, registry: options.registry, workerId: options.workerId, log: options.log });
  return executor.execute(row);
}

export interface RunnerOptions extends ExecutorOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  requeueSweepMs?: number;
  jobTypes?: string[] | null;
  idleExitMs?: number;
  maxRuntimeMs?: number;
  /** Injected sleep (tests). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RunnerStats {
  claimed: number;
  succeeded: number;
  failed: number;
  sweeps: number;
  requeued: number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export class PostgresJobRunner {
  readonly stats: RunnerStats = { claimed: 0, succeeded: 0, failed: 0, sweeps: 0, requeued: 0 };
  private readonly services: JobServices;
  private readonly registry: HandlerRegistry;
  private readonly executor: JobExecutor;
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly requeueSweepMs: number;
  private readonly jobTypes: string[] | null;
  private readonly idleExitMs: number;
  private readonly maxRuntimeMs: number;
  private readonly leaseSeconds: number;
  private readonly log: Logger;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly shutdown = new AbortController();
  private readonly running = new Set<Promise<void>>();
  private stopReason: string | null = null;

  constructor(options: RunnerOptions) {
    this.services = options.services;
    this.registry = options.registry;
    this.workerId = options.workerId;
    this.log = options.log ?? options.services.log;
    this.concurrency = options.concurrency ?? options.services.env.JOBS_CONCURRENCY;
    this.pollIntervalMs = options.pollIntervalMs ?? options.services.env.JOBS_POLL_INTERVAL_MS;
    this.requeueSweepMs = options.requeueSweepMs ?? options.services.env.JOBS_REQUEUE_SWEEP_MS;
    this.leaseSeconds = options.leaseSeconds ?? options.services.env.JOBS_LEASE_SECONDS;
    this.idleExitMs = options.idleExitMs ?? options.services.env.JOBS_IDLE_EXIT_MS;
    this.maxRuntimeMs = options.maxRuntimeMs ?? options.services.env.JOBS_MAX_RUNTIME_MS;
    this.sleep = options.sleep ?? defaultSleep;
    const filter = options.jobTypes && options.jobTypes.length ? options.jobTypes : null;
    const supported = this.registry.jobTypes();
    this.jobTypes = filter ? filter.filter((t) => (supported as string[]).includes(t)) : supported;
    this.executor = new JobExecutor({ ...options, signal: this.shutdown.signal, leaseSeconds: this.leaseSeconds, log: this.log });
    options.signal?.addEventListener('abort', () => this.stop('parent_signal'), { once: true });
  }

  get workerIdentity(): string {
    return this.workerId;
  }

  /** Stop claiming; running jobs are allowed to finish (they observe the abort signal for long work). */
  stop(reason = 'stop'): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.log.info('runner.stopping', { reason, running: this.running.size });
    this.shutdown.abort(new Error(reason));
  }

  /** Move leases that expired without a heartbeat back to pending / review_needed (`requeue_expired_jobs`). */
  async sweep(): Promise<number> {
    try {
      const moved = (await this.services.repos.processingJobs.requeueExpired(500)).length;
      this.stats.sweeps += 1;
      this.stats.requeued += moved;
      if (moved) this.log.warn('runner.requeued_expired', { moved });
      return moved;
    } catch (error) {
      this.log.warn('runner.sweep_failed', { error });
      return 0;
    }
  }

  /** Claim and execute at most one job. Returns the outcome, or null when the queue had nothing claimable. */
  async runOne(): Promise<JobOutcome | null> {
    const job = await this.services.repos.processingJobs.claim(this.workerId, this.jobTypes as never, this.leaseSeconds);
    if (!job) return null;
    this.stats.claimed += 1;
    const outcome = await this.executor.execute(job);
    if (outcome.status === 'succeeded') this.stats.succeeded += 1;
    else this.stats.failed += 1;
    return outcome;
  }

  /** Poll loop; resolves when stopped, idle-exit or max-runtime triggers, after running jobs settle. */
  async start(): Promise<RunnerStats> {
    const startedAt = Date.now();
    let lastActivity = Date.now();
    let lastSweep = 0;
    this.log.info('runner.start', { workerId: this.workerId, concurrency: this.concurrency, jobTypes: this.jobTypes, pollIntervalMs: this.pollIntervalMs, idleExitMs: this.idleExitMs });

    while (!this.stopReason) {
      if (this.maxRuntimeMs > 0 && Date.now() - startedAt >= this.maxRuntimeMs) {
        this.stop('max_runtime');
        break;
      }
      if (Date.now() - lastSweep >= this.requeueSweepMs) {
        lastSweep = Date.now();
        await this.sweep();
      }
      let claimedThisRound = 0;
      while (this.running.size < this.concurrency && !this.stopReason) {
        let job: ProcessingJobRow | null = null;
        try {
          job = await this.services.repos.processingJobs.claim(this.workerId, this.jobTypes as never, this.leaseSeconds);
        } catch (error) {
          this.log.error('runner.claim_failed', { error });
          break;
        }
        if (!job) break;
        claimedThisRound += 1;
        this.stats.claimed += 1;
        lastActivity = Date.now();
        const task = this.executor
          .execute(job)
          .then((outcome) => {
            if (outcome.status === 'succeeded') this.stats.succeeded += 1;
            else this.stats.failed += 1;
            lastActivity = Date.now();
          })
          .catch((error) => this.log.error('runner.execute_crashed', { jobId: job!.id, error }))
          .finally(() => this.running.delete(task));
        this.running.add(task);
      }
      if (claimedThisRound === 0) {
        if (this.idleExitMs > 0 && this.running.size === 0 && Date.now() - lastActivity >= this.idleExitMs) {
          this.stop('idle');
          break;
        }
        await this.sleep(this.pollIntervalMs, this.shutdown.signal);
      } else if (this.running.size >= this.concurrency) {
        await Promise.race([...this.running]);
      }
    }
    await Promise.allSettled([...this.running]);
    this.log.info('runner.stopped', { reason: this.stopReason, ...this.stats });
    return this.stats;
  }
}
