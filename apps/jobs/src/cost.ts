/**
 * Per-job cost accounting (§12). Every AI call made during a job flows through a job-scoped
 * `AiRequestSink` (so `ai_requests` rows are written with the job's trace id), storage operations are
 * counted per class and priced with the shared R2 pricing, and the total is written to
 * `processing_jobs.cost_actual_usd` plus a `job_cost` telemetry event.
 *
 * Ledger attribution (R-5.4-03): a job has no learner enrollment. Handlers build their `LanguageContext` with the
 * job id in `enrollmentId` (`jobLanguageContext`), and the adapters copy that id into every record, so the row is
 * written with `enrollment_id = null` (the job id stays in `redacted_log.jobId`): the job id is not an
 * enrollment, and writing it would fail the `ai_requests.enrollment_id` foreign key and lose the cost row. A
 * handler acting for a staff member (a model benchmark) records through `attributed()`, which names the staff
 * actor (`user_id`), the DB profile it measured (`profile_id`) and the purpose in `redacted_log`.
 */
import type { AiRequestRecord, AiRequestSink } from '@langquest/ai';
import type { Insert } from '@langquest/db';
import { DEFAULT_R2_PRICING, estimateR2Cost, roundUsd, type R2Pricing } from '@langquest/telemetry';

export type StorageOp = 'get' | 'put' | 'list' | 'multipart' | 'delete' | 'copy';

export interface JobCostSummary {
  aiUsd: number;
  storageUsd: number;
  usd: number;
  aiCalls: number;
  unpricedAiCalls: number;
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  classAOps: number;
  classBOps: number;
  bytesIn: number;
  bytesOut: number;
  ffmpegMs: number;
}

export interface JobCostTrackerOptions {
  jobId: string;
  traceId: string;
  /** Refuse further AI calls past this (USD); `null` = no ceiling. */
  maxUsd?: number | null;
  r2Pricing?: R2Pricing;
  /** Persist `ai_requests` rows (service role); optional in tests. */
  persistAiRequest?: (row: Insert<'ai_requests'>) => Promise<void>;
  onPersistError?: (error: unknown) => void;
}

/**
 * Who a job's AI rows are attributed to. `userId` is the staff member who requested the job (`auth.users.id`),
 * `profileId` an `ai_model_profiles.id` the handler has read from the DB (never a package-default id), and
 * `purpose` a short tag written to `redacted_log.purpose` (e.g. `model_benchmark`).
 */
export interface JobAiAttribution {
  userId?: string | null;
  profileId?: string | null;
  purpose: string;
  /** Extra redacted metadata (sample ids, sample set); never prompts or learner data. */
  log?: Record<string, unknown>;
}

export class CostCeilingExceeded extends Error {
  constructor(
    readonly usd: number,
    readonly ceilingUsd: number,
  ) {
    super(`Job AI spend ${usd.toFixed(4)} USD exceeds the per-job ceiling ${ceilingUsd.toFixed(2)} USD`);
    this.name = 'CostCeilingExceeded';
  }
}

export class JobCostTracker implements AiRequestSink {
  readonly jobId: string;
  readonly traceId: string;
  readonly records: AiRequestRecord[] = [];
  private readonly ops: Record<StorageOp, number> = { get: 0, put: 0, list: 0, multipart: 0, delete: 0, copy: 0 };
  private bytesIn = 0;
  private bytesOut = 0;
  private ffmpegMs = 0;
  private readonly maxUsd: number | null;
  private readonly pricing: R2Pricing;
  private readonly persist: ((row: Insert<'ai_requests'>) => Promise<void>) | null;
  private readonly onPersistError: ((error: unknown) => void) | null;
  private readonly pending: Promise<void>[] = [];

  constructor(options: JobCostTrackerOptions) {
    this.jobId = options.jobId;
    this.traceId = options.traceId;
    this.maxUsd = options.maxUsd ?? null;
    this.pricing = options.r2Pricing ?? DEFAULT_R2_PRICING;
    this.persist = options.persistAiRequest ?? null;
    this.onPersistError = options.onPersistError ?? null;
  }

  /** `AiRequestSink` — called by the reasoner/recognizer for every attempt. */
  record(entry: AiRequestRecord): void {
    this.recordAttributed(entry, null);
  }

  /**
   * A sink that records through this tracker (same ceiling, same ledger) with the given attribution stamped on
   * every row. The caller vouches for `profileId` (a row it read from `ai_model_profiles`).
   */
  attributed(attribution: JobAiAttribution): AiRequestSink {
    return { record: (entry) => this.recordAttributed(entry, attribution) };
  }

  /** The `ai_requests` row a record is persisted as (public so the mapping is testable without a database). */
  toLedgerRow(entry: AiRequestRecord, attribution: JobAiAttribution | null = null): Insert<'ai_requests'> {
    return {
      user_id: attribution?.userId !== undefined ? attribution.userId : entry.userId,
      // The job id stands in for an enrollment in job language contexts; it is never an enrollment row.
      enrollment_id: entry.enrollmentId === this.jobId ? null : entry.enrollmentId,
      task: entry.task,
      provider: entry.provider,
      model: entry.model,
      profile_id: attribution?.profileId ?? null,
      fallback_index: entry.fallbackIndex,
      latency_ms: entry.latencyMs,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      audio_seconds: entry.audioSeconds,
      estimated_cost_usd: entry.estimatedCostUsd,
      success: entry.success,
      error_code: entry.errorCode,
      trace_id: entry.traceId || this.traceId,
      redacted_log: { ...(entry.redactedLog ?? {}), ...(attribution?.log ?? {}), ...(attribution ? { purpose: attribution.purpose } : {}), jobId: this.jobId } as never,
    };
  }

  private recordAttributed(entry: AiRequestRecord, attribution: JobAiAttribution | null): void {
    this.records.push(entry);
    if (this.persist) {
      const p = this.persist(this.toLedgerRow(entry, attribution)).catch((error) => this.onPersistError?.(error));
      this.pending.push(p);
    }
  }

  /** Count a storage operation (R2 class A/B billing). */
  storage(op: StorageOp, bytes = 0): void {
    this.ops[op] += 1;
    if (op === 'get') this.bytesIn += bytes;
    if (op === 'put' || op === 'multipart' || op === 'copy') this.bytesOut += bytes;
  }

  ffmpeg(durationMs: number): void {
    this.ffmpegMs += Math.max(0, durationMs);
  }

  aiUsd(): number {
    return roundUsd(this.records.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0));
  }

  /** Throws when the AI ceiling is already exceeded — call before starting another paid call. */
  assertBudget(): void {
    if (this.maxUsd === null) return;
    const usd = this.aiUsd();
    if (usd > this.maxUsd) throw new CostCeilingExceeded(usd, this.maxUsd);
  }

  summary(): JobCostSummary {
    const classAOps = this.ops.put + this.ops.list + this.ops.multipart + this.ops.copy;
    const classBOps = this.ops.get;
    const storage = estimateR2Cost({ classAOps, classBOps, applyFreeTier: false }, this.pricing);
    const aiUsd = this.aiUsd();
    return {
      aiUsd,
      storageUsd: storage.usd,
      usd: roundUsd(aiUsd + storage.usd),
      aiCalls: this.records.length,
      unpricedAiCalls: this.records.filter((r) => r.estimatedCostUsd === null).length,
      audioSeconds: this.records.reduce((s, r) => s + (r.audioSeconds ?? 0), 0),
      inputTokens: this.records.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
      outputTokens: this.records.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
      classAOps,
      classBOps,
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
      ffmpegMs: this.ffmpegMs,
    };
  }

  /** Wait for background `ai_requests` writes. */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }
}
