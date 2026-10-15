/**
 * Cost accounting (§12, §14.3 "budget telemetry").
 *
 * - {@link PricingTable} turns an OpenRouter models snapshot (the shape stored under
 *   `docs/provider-matrix/openrouter-models-snapshot-*.json`) into per-unit USD prices and can be
 *   refreshed at runtime from a fresh `/api/v1/models` pull. Prices are never hard-coded (§12.3).
 * - {@link estimateR2Cost} prices Cloudflare R2 storage/operations from refreshable inputs.
 * - {@link CostLedger} records AI / storage / job costs with attribution and aggregates them into
 *   the §12.2 dashboard numbers: cost per completed speaking mission, per active learner, per
 *   reviewed lesson.
 * - {@link CostAnomalyDetector} compares each bucket (typically a day) against a rolling baseline
 *   and emits **operator** alerts. These alerts are for the on-call dashboard only: the product is
 *   free and unlimited, so nothing here ever throttles, meters or messages a learner.
 * - {@link createProfileBudgetDetectors} turns `ai_model_profiles.daily_budget_usd` into one
 *   hard-ceiling detector per task; give the map to the ledger (`budgetDetectors`) together with an
 *   {@link AlertSink} and every priced request is checked against the operator budget.
 */
import { z } from 'zod';
import type { AiTaskName, Insert, JsonObject, ModelProfile } from '@langquest/contracts';
import { AiTaskNameSchema, NonNegativeIntSchema, UuidSchema } from '@langquest/contracts';
import type { AlertSink } from './sinks';

// ---------------------------------------------------------------------------
// OpenRouter pricing snapshot
// ---------------------------------------------------------------------------

/** Numeric string or number as published by OpenRouter (`"0.0000001"`). */
const UsdPerUnitSchema = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: 'custom', message: `invalid price: ${String(v)}` });
    return z.NEVER;
  }
  return n;
});

/** One speech/transcription model row (`pricing.prompt` / `pricing.completion`). */
export const SnapshotSpeechModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
    pricing: z.object({ prompt: UsdPerUnitSchema, completion: UsdPerUnitSchema.optional() }),
  })
  .loose();

/** One chat candidate row (`prompt` / `completion` at the top level). */
export const SnapshotChatModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    ctx: z.number().optional(),
    prompt: UsdPerUnitSchema,
    completion: UsdPerUnitSchema,
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  })
  .loose();

/** Shape of `docs/provider-matrix/openrouter-models-snapshot-YYYY-MM-DD.json`. */
export const PricingSnapshotSchema = z
  .object({
    transcription: z.array(SnapshotSpeechModelSchema).default([]),
    speech: z.array(SnapshotSpeechModelSchema).default([]),
    chat_candidates: z.array(SnapshotChatModelSchema).default([]),
  })
  .loose();
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;

/** Billable unit of a model's input or output. */
export const PRICING_UNIT_VALUES = ['token', 'audio_second', 'character'] as const;
export type PricingUnit = (typeof PRICING_UNIT_VALUES)[number];

export const PRICED_MODEL_CATEGORY_VALUES = ['chat', 'transcription', 'speech'] as const;
export type PricedModelCategory = (typeof PRICED_MODEL_CATEGORY_VALUES)[number];

/** Resolved per-unit price of one model. */
export interface ModelPrice {
  modelId: string;
  name: string | null;
  category: PricedModelCategory;
  inputUnit: PricingUnit;
  outputUnit: PricingUnit;
  inputUsdPerUnit: number;
  outputUsdPerUnit: number;
}

/**
 * Unit conventions for OpenRouter list prices (verified against the Oct 2026 snapshot: e.g.
 * AssemblyAI at 0.0000833 USD/unit = 0.30 USD/hour of audio, HeyGen voice at 15 USD per million
 * characters). Override per model via {@link PricingTableOptions.unitOverrides} when a provider
 * documents something else.
 */
export const DEFAULT_CATEGORY_UNITS: Readonly<Record<PricedModelCategory, { input: PricingUnit; output: PricingUnit }>> = {
  chat: { input: 'token', output: 'token' },
  transcription: { input: 'audio_second', output: 'token' },
  speech: { input: 'character', output: 'audio_second' },
};

export interface PricingTableOptions {
  /** When the snapshot was captured (ISO). Defaults to now. */
  snapshotAt?: string;
  /** Per-model unit overrides. */
  unitOverrides?: Record<string, Partial<{ input: PricingUnit; output: PricingUnit }>>;
}

/** Usage of one AI request, as reported by the provider (nulls = not reported). */
export interface AiUsage {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Audio seconds consumed (STT input) or produced (TTS output). */
  audioSeconds?: number | null;
  /** Characters synthesised (TTS input). */
  characters?: number | null;
}

export interface CostEstimate {
  modelId: string;
  /** False when the model is not in the pricing table; `usd` is then 0 and must be surfaced as "unpriced", not as free. */
  priced: boolean;
  usd: number;
  inputUsd: number;
  outputUsd: number;
  inputUnit: PricingUnit | null;
  outputUnit: PricingUnit | null;
  /** Units actually billed. */
  inputUnits: number;
  outputUnits: number;
}

function unitsFor(unit: PricingUnit, usage: AiUsage, side: 'input' | 'output'): number {
  switch (unit) {
    case 'token':
      return (side === 'input' ? usage.inputTokens : usage.outputTokens) ?? 0;
    case 'audio_second':
      return usage.audioSeconds ?? 0;
    case 'character':
      return usage.characters ?? 0;
  }
}

/** Round to micro-dollars to keep ledgers stable across platforms. */
export function roundUsd(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Refreshable in-memory price list. Build it from a snapshot file at boot and call
 * {@link PricingTable.refresh} with a fresh OpenRouter pull on a schedule; the ledger keeps a
 * reference to the table so estimates automatically use the latest prices.
 */
export class PricingTable {
  #prices = new Map<string, ModelPrice>();
  #snapshotAt: string;
  readonly #unitOverrides: NonNullable<PricingTableOptions['unitOverrides']>;

  constructor(snapshot: unknown, options: PricingTableOptions = {}) {
    this.#unitOverrides = options.unitOverrides ?? {};
    this.#snapshotAt = options.snapshotAt ?? new Date().toISOString();
    this.refresh(snapshot, options.snapshotAt);
  }

  /** Parse and load a snapshot (validated with {@link PricingSnapshotSchema}). */
  static fromSnapshot(snapshot: unknown, options?: PricingTableOptions): PricingTable {
    return new PricingTable(snapshot, options);
  }

  /** Replace all prices atomically with a new snapshot; throws (and keeps the old prices) on invalid input. */
  refresh(snapshot: unknown, snapshotAt?: string): void {
    const parsed = PricingSnapshotSchema.parse(snapshot);
    const next = new Map<string, ModelPrice>();
    const put = (category: PricedModelCategory, id: string, name: string | undefined, prompt: number, completion: number) => {
      const units = { ...DEFAULT_CATEGORY_UNITS[category], ...(this.#unitOverrides[id] ?? {}) };
      next.set(id, { modelId: id, name: name ?? null, category, inputUnit: units.input, outputUnit: units.output, inputUsdPerUnit: prompt, outputUsdPerUnit: completion });
    };
    for (const m of parsed.chat_candidates) put('chat', m.id, m.name, m.prompt, m.completion);
    for (const m of parsed.transcription) put('transcription', m.id, m.name, m.pricing.prompt, m.pricing.completion ?? 0);
    for (const m of parsed.speech) put('speech', m.id, m.name, m.pricing.prompt, m.pricing.completion ?? 0);
    this.#prices = next;
    this.#snapshotAt = snapshotAt ?? new Date().toISOString();
  }

  get snapshotAt(): string {
    return this.#snapshotAt;
  }

  get size(): number {
    return this.#prices.size;
  }

  has(modelId: string): boolean {
    return this.#prices.has(modelId);
  }

  get(modelId: string): ModelPrice | null {
    return this.#prices.get(modelId) ?? null;
  }

  list(category?: PricedModelCategory): ModelPrice[] {
    const all = [...this.#prices.values()];
    return category ? all.filter((p) => p.category === category) : all;
  }

  /** Estimate the USD cost of one request from reported usage. Unknown models yield `priced: false`. */
  estimate(usage: AiUsage): CostEstimate {
    const price = this.get(usage.model);
    if (!price) {
      return { modelId: usage.model, priced: false, usd: 0, inputUsd: 0, outputUsd: 0, inputUnit: null, outputUnit: null, inputUnits: 0, outputUnits: 0 };
    }
    const inputUnits = unitsFor(price.inputUnit, usage, 'input');
    const outputUnits = unitsFor(price.outputUnit, usage, 'output');
    const inputUsd = roundUsd(inputUnits * price.inputUsdPerUnit);
    const outputUsd = roundUsd(outputUnits * price.outputUsdPerUnit);
    return { modelId: usage.model, priced: true, usd: roundUsd(inputUsd + outputUsd), inputUsd, outputUsd, inputUnit: price.inputUnit, outputUnit: price.outputUnit, inputUnits, outputUnits };
  }
}

// ---------------------------------------------------------------------------
// Cloudflare R2 pricing inputs
// ---------------------------------------------------------------------------

export const R2PricingSchema = z.object({
  /** Standard storage, USD per GB-month. */
  storageUsdPerGbMonth: z.number().min(0),
  /** Class A operations (PUT, POST, LIST, multipart), USD per million. */
  classAUsdPerMillion: z.number().min(0),
  /** Class B operations (GET, HEAD), USD per million. */
  classBUsdPerMillion: z.number().min(0),
  /** Internet egress, USD per GB (R2 charges none as of Oct 2026). */
  egressUsdPerGb: z.number().min(0),
  /** Free tier allowances per month, subtracted before pricing when `applyFreeTier` is set. */
  freeTier: z.object({ storageGbMonths: z.number().min(0), classAOps: z.number().min(0), classBOps: z.number().min(0) }),
  /** Where these numbers were read from and when; revalidate before deploy (§12.3). */
  source: z.string(),
  checkedAt: z.string(),
});
export type R2Pricing = z.infer<typeof R2PricingSchema>;

/**
 * R2 Standard list prices as checked on 2026-10-14 (https://developers.cloudflare.com/r2/pricing/).
 * Pass a refreshed object to {@link estimateR2Cost} / {@link CostLedger} rather than editing this.
 */
export const DEFAULT_R2_PRICING: R2Pricing = {
  storageUsdPerGbMonth: 0.015,
  classAUsdPerMillion: 4.5,
  classBUsdPerMillion: 0.36,
  egressUsdPerGb: 0,
  freeTier: { storageGbMonths: 10, classAOps: 1_000_000, classBOps: 10_000_000 },
  source: 'https://developers.cloudflare.com/r2/pricing/',
  checkedAt: '2026-10-14',
};

export type StorageOperation = 'get' | 'put' | 'list' | 'delete' | 'multipart';

/** R2 operation classes: class A are writes/lists, class B are reads. DELETE is free. */
export function r2OperationClass(operation: StorageOperation): 'A' | 'B' | 'free' {
  switch (operation) {
    case 'get':
      return 'B';
    case 'put':
    case 'list':
    case 'multipart':
      return 'A';
    case 'delete':
      return 'free';
  }
}

export interface R2UsageInput {
  classAOps?: number;
  classBOps?: number;
  /** Average stored GB × months (e.g. 250 GB for a month = 250). */
  storageGbMonths?: number;
  egressGb?: number;
  applyFreeTier?: boolean;
}

export interface R2CostEstimate {
  usd: number;
  storageUsd: number;
  classAUsd: number;
  classBUsd: number;
  egressUsd: number;
}

/** Price Cloudflare R2 usage. */
export function estimateR2Cost(usage: R2UsageInput, pricing: R2Pricing = DEFAULT_R2_PRICING): R2CostEstimate {
  const free = usage.applyFreeTier ? pricing.freeTier : { storageGbMonths: 0, classAOps: 0, classBOps: 0 };
  const storage = Math.max(0, (usage.storageGbMonths ?? 0) - free.storageGbMonths);
  const a = Math.max(0, (usage.classAOps ?? 0) - free.classAOps);
  const b = Math.max(0, (usage.classBOps ?? 0) - free.classBOps);
  const storageUsd = roundUsd(storage * pricing.storageUsdPerGbMonth);
  const classAUsd = roundUsd((a / 1_000_000) * pricing.classAUsdPerMillion);
  const classBUsd = roundUsd((b / 1_000_000) * pricing.classBUsdPerMillion);
  const egressUsd = roundUsd((usage.egressGb ?? 0) * pricing.egressUsdPerGb);
  return { usd: roundUsd(storageUsd + classAUsd + classBUsd + egressUsd), storageUsd, classAUsd, classBUsd, egressUsd };
}

// ---------------------------------------------------------------------------
// Cost ledger
// ---------------------------------------------------------------------------

/** What a cost entry is attributed to; every field optional, all pseudonymous. */
export const CostAttributionSchema = z.object({
  userHash: z.string().nullable().default(null),
  enrollmentId: UuidSchema.nullable().default(null),
  trackId: z.string().nullable().default(null),
  sourceLanguageCode: z.string().nullable().default(null),
  missionId: UuidSchema.nullable().default(null),
  conversationSessionId: UuidSchema.nullable().default(null),
  /** Audio lesson (for cost per quality-reviewed lesson). */
  lessonId: UuidSchema.nullable().default(null),
  jobId: UuidSchema.nullable().default(null),
  task: AiTaskNameSchema.nullable().default(null),
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
});
export type CostAttribution = z.infer<typeof CostAttributionSchema>;
export type CostAttributionInput = z.input<typeof CostAttributionSchema>;

export const COST_ENTRY_KIND_VALUES = ['ai', 'storage', 'job'] as const;
export type CostEntryKind = (typeof COST_ENTRY_KIND_VALUES)[number];

export interface CostEntry {
  id: string;
  kind: CostEntryKind;
  occurredAt: string;
  usd: number;
  /** False when a price was unavailable (`usd` is then 0 and the entry is counted in `unpricedCount`). */
  priced: boolean;
  attribution: CostAttribution;
  /** Raw usage for reconciliation against provider invoices (§12.2). */
  usage: { inputTokens: number | null; outputTokens: number | null; audioSeconds: number | null; characters: number | null; classAOps: number; classBOps: number; bytes: number | null; cpuMs: number | null };
}

/** Input to {@link CostLedger.recordAiRequest}: mirrors the `ai_requests` ledger table. */
export interface AiRequestRecord {
  traceId: string;
  task: AiTaskName;
  provider: string;
  model: string;
  success: boolean;
  /** Raw Supabase user id, only when attribution is permitted; stored on `ai_requests.user_id`. */
  userId?: string | null;
  userHash?: string | null;
  enrollmentId?: string | null;
  trackId?: string | null;
  sourceLanguageCode?: string | null;
  profileId?: string | null;
  fallbackIndex?: number;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  audioSeconds?: number | null;
  characters?: number | null;
  errorCode?: string | null;
  missionId?: string | null;
  conversationSessionId?: string | null;
  lessonId?: string | null;
  /** Already-redacted metadata (never raw prompts). */
  redactedLog?: JsonObject | null;
  occurredAt?: string;
  id?: string;
}

export type AiRequestInsert = Insert<'ai_requests'>;

export interface CostSummary {
  totalUsd: number;
  byKind: Record<CostEntryKind, number>;
  byTask: Partial<Record<AiTaskName, number>>;
  byModel: Record<string, number>;
  byTrack: Record<string, number>;
  entryCount: number;
  unpricedCount: number;
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  classAOps: number;
  classBOps: number;
}

/** A unit-cost figure with its denominator so dashboards can show "n/a" rather than divide by zero. */
export interface UnitCost {
  usd: number;
  numeratorUsd: number;
  denominator: number;
  /** Null when `denominator` is 0. */
  perUnitUsd: number | null;
}

export interface CostLedgerOptions {
  r2Pricing?: R2Pricing;
  now?: () => string;
  newId?: () => string;
  /**
   * Per-task detectors (typically {@link createProfileBudgetDetectors}). Every AI request is fed
   * into its task's detector as `ai_cost:task:<task>` bucketed by {@link CostLedgerOptions.bucket}.
   */
  budgetDetectors?: ReadonlyMap<AiTaskName, CostAnomalyDetector>;
  /** Detector fed the `ai_cost:total` series (rolling baseline across all AI tasks). */
  totalDetector?: CostAnomalyDetector;
  /** Where {@link OperatorAlert}s are delivered. Without one, alerts are only returned to the caller. */
  alertSink?: AlertSink;
  /** Called when `alertSink.deliver` rejects. Delivery failures never fail the request path. */
  onAlertDeliveryError?: (error: unknown, alert: OperatorAlert) => void;
  /** Bucket key for a timestamp. Default {@link dayBucket} (UTC day). */
  bucket?: (occurredAt: string) => string;
}

/** Series name for the all-tasks AI spend. */
export const AI_COST_TOTAL_SERIES = 'ai_cost:total';

/** Series name for one task's AI spend (`ai_cost:task:<task>`). */
export function aiCostTaskSeries(task: AiTaskName): string {
  return `ai_cost:task:${task}`;
}

/** Result of {@link CostLedger.recordAiRequest}. */
export interface AiRequestRecording {
  entry: CostEntry;
  estimate: CostEstimate;
  /** Ready-to-insert `ai_requests` row. */
  insert: AiRequestInsert;
  /** Operator alerts raised by this request (budget ceiling and/or baseline anomaly); also sent to the alert sink. */
  alerts: OperatorAlert[];
}

function fallbackId(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === 'function' ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * In-memory ledger of cost entries with §12.2 aggregations. Persist entries through
 * `SupabaseTableSink.writeAiRequests` (see `sinks.ts`); the ledger itself is a pure computation,
 * except that each AI request is also fed to the configured anomaly/budget detectors and any
 * resulting {@link OperatorAlert} is forwarded to the {@link AlertSink}.
 */
export class CostLedger {
  readonly #pricing: PricingTable;
  readonly #r2: R2Pricing;
  readonly #entries: CostEntry[] = [];
  readonly #now: () => string;
  readonly #newId: () => string;
  readonly #budgetDetectors: ReadonlyMap<AiTaskName, CostAnomalyDetector>;
  readonly #totalDetector: CostAnomalyDetector | null;
  readonly #alertSink: AlertSink | null;
  readonly #onAlertDeliveryError: ((error: unknown, alert: OperatorAlert) => void) | null;
  readonly #bucket: (occurredAt: string) => string;
  readonly #deliveries = new Set<Promise<void>>();

  constructor(pricing: PricingTable, options: CostLedgerOptions = {}) {
    this.#pricing = pricing;
    this.#r2 = options.r2Pricing ?? DEFAULT_R2_PRICING;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newId = options.newId ?? fallbackId;
    this.#budgetDetectors = options.budgetDetectors ?? new Map();
    this.#totalDetector = options.totalDetector ?? null;
    this.#alertSink = options.alertSink ?? null;
    this.#onAlertDeliveryError = options.onAlertDeliveryError ?? null;
    this.#bucket = options.bucket ?? dayBucket;
  }

  get pricing(): PricingTable {
    return this.#pricing;
  }

  entries(): readonly CostEntry[] {
    return this.#entries;
  }

  /** Detectors this ledger feeds, by task (read-only view for dashboards). */
  get budgetDetectors(): ReadonlyMap<AiTaskName, CostAnomalyDetector> {
    return this.#budgetDetectors;
  }

  /** Wait for every in-flight alert delivery (tests, graceful shutdown). */
  async flushAlerts(): Promise<void> {
    await Promise.allSettled([...this.#deliveries]);
  }

  #dispatch(alerts: readonly OperatorAlert[]): void {
    const sink = this.#alertSink;
    if (!sink) return;
    for (const alert of alerts) {
      const p: Promise<void> = Promise.resolve()
        .then(() => sink.deliver(alert))
        .catch((error: unknown) => this.#onAlertDeliveryError?.(error, alert))
        .finally(() => this.#deliveries.delete(p));
      this.#deliveries.add(p);
    }
  }

  /**
   * Price one AI request and append it. Returns the entry, a ready-to-insert `ai_requests` row and
   * any operator alerts the request triggered. Unpriced requests still advance the detectors'
   * buckets (with 0 USD) so a day closes even when the first request of the next day is unknown.
   */
  recordAiRequest(record: AiRequestRecord): AiRequestRecording {
    const estimate = this.#pricing.estimate({ model: record.model, inputTokens: record.inputTokens ?? null, outputTokens: record.outputTokens ?? null, audioSeconds: record.audioSeconds ?? null, characters: record.characters ?? null });
    const entry: CostEntry = {
      id: record.id ?? this.#newId(),
      kind: 'ai',
      occurredAt: record.occurredAt ?? this.#now(),
      usd: estimate.usd,
      priced: estimate.priced,
      attribution: CostAttributionSchema.parse({
        userHash: record.userHash ?? null,
        enrollmentId: record.enrollmentId ?? null,
        trackId: record.trackId ?? null,
        sourceLanguageCode: record.sourceLanguageCode ?? null,
        missionId: record.missionId ?? null,
        conversationSessionId: record.conversationSessionId ?? null,
        lessonId: record.lessonId ?? null,
        task: record.task,
        provider: record.provider,
        model: record.model,
      }),
      usage: { inputTokens: record.inputTokens ?? null, outputTokens: record.outputTokens ?? null, audioSeconds: record.audioSeconds ?? null, characters: record.characters ?? null, classAOps: 0, classBOps: 0, bytes: null, cpuMs: null },
    };
    this.#entries.push(entry);
    const insert: AiRequestInsert = {
      user_id: record.userId ?? null,
      enrollment_id: record.enrollmentId ?? null,
      task: record.task,
      provider: record.provider,
      model: record.model,
      profile_id: record.profileId ?? null,
      fallback_index: NonNegativeIntSchema.parse(record.fallbackIndex ?? 0),
      latency_ms: record.latencyMs ?? null,
      input_tokens: record.inputTokens ?? null,
      output_tokens: record.outputTokens ?? null,
      audio_seconds: record.audioSeconds ?? null,
      estimated_cost_usd: estimate.priced ? estimate.usd : null,
      success: record.success,
      error_code: record.errorCode ?? null,
      trace_id: record.traceId,
      redacted_log: record.redactedLog ?? null,
      created_at: entry.occurredAt,
    };
    const alerts: OperatorAlert[] = [];
    const bucket = this.#bucket(entry.occurredAt);
    const taskAlert = this.#budgetDetectors.get(record.task)?.observe(aiCostTaskSeries(record.task), bucket, estimate.usd);
    if (taskAlert) alerts.push(taskAlert);
    const totalAlert = this.#totalDetector?.observe(AI_COST_TOTAL_SERIES, bucket, estimate.usd);
    if (totalAlert) alerts.push(totalAlert);
    this.#dispatch(alerts);
    return { entry, estimate, insert, alerts };
  }

  /** Price a batch of R2 operations (the `storage_ops` event shape) and append it. */
  recordStorageOps(input: { operation: StorageOperation; count: number; bytes?: number | null; attribution?: CostAttributionInput; occurredAt?: string }): CostEntry {
    const cls = r2OperationClass(input.operation);
    const classAOps = cls === 'A' ? input.count : 0;
    const classBOps = cls === 'B' ? input.count : 0;
    const est = estimateR2Cost({ classAOps, classBOps }, this.#r2);
    const entry: CostEntry = {
      id: this.#newId(),
      kind: 'storage',
      occurredAt: input.occurredAt ?? this.#now(),
      usd: est.usd,
      priced: true,
      attribution: CostAttributionSchema.parse(input.attribution ?? {}),
      usage: { inputTokens: null, outputTokens: null, audioSeconds: null, characters: null, classAOps, classBOps, bytes: input.bytes ?? null, cpuMs: null },
    };
    this.#entries.push(entry);
    return entry;
  }

  /** Append the actual (or estimated) cost of a processing job (transcode, transcription, alignment…). */
  recordJob(input: { jobId: string; usd: number | null; cpuMs?: number | null; attribution?: CostAttributionInput; occurredAt?: string }): CostEntry {
    const entry: CostEntry = {
      id: this.#newId(),
      kind: 'job',
      occurredAt: input.occurredAt ?? this.#now(),
      usd: input.usd === null ? 0 : roundUsd(input.usd),
      priced: input.usd !== null,
      attribution: CostAttributionSchema.parse({ ...(input.attribution ?? {}), jobId: input.jobId }),
      usage: { inputTokens: null, outputTokens: null, audioSeconds: null, characters: null, classAOps: 0, classBOps: 0, bytes: null, cpuMs: input.cpuMs ?? null },
    };
    this.#entries.push(entry);
    return entry;
  }

  /** Sum of entries matching an optional predicate. */
  total(predicate?: (entry: CostEntry) => boolean): number {
    let sum = 0;
    for (const e of this.#entries) if (!predicate || predicate(e)) sum += e.usd;
    return roundUsd(sum);
  }

  summary(): CostSummary {
    const s: CostSummary = { totalUsd: 0, byKind: { ai: 0, storage: 0, job: 0 }, byTask: {}, byModel: {}, byTrack: {}, entryCount: this.#entries.length, unpricedCount: 0, audioSeconds: 0, inputTokens: 0, outputTokens: 0, classAOps: 0, classBOps: 0 };
    for (const e of this.#entries) {
      s.totalUsd += e.usd;
      s.byKind[e.kind] += e.usd;
      if (!e.priced) s.unpricedCount += 1;
      if (e.attribution.task) s.byTask[e.attribution.task] = roundUsd((s.byTask[e.attribution.task] ?? 0) + e.usd);
      if (e.attribution.model) s.byModel[e.attribution.model] = roundUsd((s.byModel[e.attribution.model] ?? 0) + e.usd);
      if (e.attribution.trackId) s.byTrack[e.attribution.trackId] = roundUsd((s.byTrack[e.attribution.trackId] ?? 0) + e.usd);
      s.audioSeconds += e.usage.audioSeconds ?? 0;
      s.inputTokens += e.usage.inputTokens ?? 0;
      s.outputTokens += e.usage.outputTokens ?? 0;
      s.classAOps += e.usage.classAOps;
      s.classBOps += e.usage.classBOps;
    }
    s.totalUsd = roundUsd(s.totalUsd);
    for (const k of COST_ENTRY_KIND_VALUES) s.byKind[k] = roundUsd(s.byKind[k]);
    return s;
  }

  static #unit(numeratorUsd: number, denominator: number): UnitCost {
    const n = roundUsd(numeratorUsd);
    return { usd: n, numeratorUsd: n, denominator, perUnitUsd: denominator > 0 ? roundUsd(n / denominator) : null };
  }

  /**
   * Cost per completed speaking mission: AI spend attributed to the given missions (by mission id
   * or by the conversation sessions they ran) divided by the number of completed missions.
   */
  costPerCompletedSpeakingMission(completed: Iterable<{ missionId: string; conversationSessionIds?: readonly string[] }>): UnitCost {
    const missionIds = new Set<string>();
    const sessionIds = new Set<string>();
    let count = 0;
    for (const m of completed) {
      count += 1;
      missionIds.add(m.missionId);
      for (const s of m.conversationSessionIds ?? []) sessionIds.add(s);
    }
    const usd = this.total((e) => e.kind === 'ai' && ((e.attribution.missionId !== null && missionIds.has(e.attribution.missionId)) || (e.attribution.conversationSessionId !== null && sessionIds.has(e.attribution.conversationSessionId))));
    return CostLedger.#unit(usd, count);
  }

  /**
   * Estimated expense per active learner: all spend (AI + storage + jobs) over the ledger divided
   * by the number of active learners. Pass the active set (pseudonymous hashes) or just a count.
   */
  costPerActiveLearner(active: Iterable<string> | number): UnitCost {
    const count = typeof active === 'number' ? active : new Set(active).size;
    return CostLedger.#unit(this.total(), count);
  }

  /** Cost per quality-reviewed lesson: spend attributed to the given lesson ids divided by their number. */
  costPerReviewedLesson(reviewedLessonIds: Iterable<string>): UnitCost {
    const ids = new Set(reviewedLessonIds);
    const usd = this.total((e) => e.attribution.lessonId !== null && ids.has(e.attribution.lessonId));
    return CostLedger.#unit(usd, ids.size);
  }

  /** Cost per meaningful conversation: AI spend attributed to the given conversation sessions. */
  costPerConversation(sessionIds: Iterable<string>): UnitCost {
    const ids = new Set(sessionIds);
    const usd = this.total((e) => e.kind === 'ai' && e.attribution.conversationSessionId !== null && ids.has(e.attribution.conversationSessionId));
    return CostLedger.#unit(usd, ids.size);
  }

  /** Drop entries older than `before` (after they were persisted). Returns how many were removed. */
  prune(before: string | Date): number {
    const cutoff = typeof before === 'string' ? Date.parse(before) : before.getTime();
    const keep = this.#entries.filter((e) => Date.parse(e.occurredAt) >= cutoff);
    const removed = this.#entries.length - keep.length;
    this.#entries.length = 0;
    this.#entries.push(...keep);
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Anomaly detection → operator alerts
// ---------------------------------------------------------------------------

export const OPERATOR_ALERT_SEVERITY_VALUES = ['warning', 'critical'] as const;
export type OperatorAlertSeverity = (typeof OPERATOR_ALERT_SEVERITY_VALUES)[number];

/**
 * An alert for the operations dashboard / on-call channel. `audience` is a literal so a sink can
 * never route it to a learner surface by accident; LangQuest has no learner-facing limits.
 */
export interface OperatorAlert {
  kind: 'operator_alert';
  audience: 'operators';
  learnerFacing: false;
  severity: OperatorAlertSeverity;
  /** Series name, e.g. `ai_cost:total`, `ai_cost:track:arabic-moroccan`, `r2_ops`. */
  series: string;
  /** Bucket key, e.g. an ISO date. */
  bucket: string;
  observedUsd: number;
  baselineMeanUsd: number;
  baselineStdUsd: number;
  baselinePoints: number;
  /** observed / baseline mean (Infinity when the baseline is 0). */
  ratio: number;
  thresholdUsd: number;
  detectedAt: string;
  message: string;
}

export interface CostAnomalyDetectorOptions {
  /** Number of completed buckets in the rolling baseline. Default 14. */
  windowSize?: number;
  /** Minimum completed buckets before alerts fire. Default 3. */
  minBaselinePoints?: number;
  /** Warn when observed ≥ mean × ratio. Default 2. */
  warningRatio?: number;
  /** Critical when observed ≥ mean × ratio. Default 4. */
  criticalRatio?: number;
  /** Also require observed ≥ mean + sigma × std. Default 3. */
  sigma?: number;
  /** Never alert below this absolute spend (avoids noise on tiny baselines). Default 1 USD. */
  absoluteFloorUsd?: number;
  /** Hard ceiling per bucket that alerts (critical) regardless of baseline, e.g. a daily budget. */
  hardCeilingUsd?: number | null;
  now?: () => string;
}

interface SeriesState {
  completed: { bucket: string; usd: number }[];
  current: { bucket: string; usd: number } | null;
  alerted: Set<string>;
}

/**
 * Rolling-baseline detector. Call {@link CostAnomalyDetector.observe} for every priced entry (or
 * for periodic bucket totals); it returns an {@link OperatorAlert} the first time a bucket crosses
 * the threshold for its series. Buckets must be fed in order per series; a new bucket key closes
 * the previous one and adds it to the baseline.
 */
export class CostAnomalyDetector {
  readonly #opts: Required<Omit<CostAnomalyDetectorOptions, 'now' | 'hardCeilingUsd'>> & { hardCeilingUsd: number | null; now: () => string };
  readonly #series = new Map<string, SeriesState>();

  constructor(options: CostAnomalyDetectorOptions = {}) {
    this.#opts = {
      windowSize: options.windowSize ?? 14,
      minBaselinePoints: options.minBaselinePoints ?? 3,
      warningRatio: options.warningRatio ?? 2,
      criticalRatio: options.criticalRatio ?? 4,
      sigma: options.sigma ?? 3,
      absoluteFloorUsd: options.absoluteFloorUsd ?? 1,
      hardCeilingUsd: options.hardCeilingUsd ?? null,
      now: options.now ?? (() => new Date().toISOString()),
    };
    if (this.#opts.windowSize < 1) throw new Error('CostAnomalyDetector: windowSize must be ≥ 1');
  }

  #state(series: string): SeriesState {
    let s = this.#series.get(series);
    if (!s) {
      s = { completed: [], current: null, alerted: new Set() };
      this.#series.set(series, s);
    }
    return s;
  }

  /** Seed the baseline with historical bucket totals (oldest first), e.g. from `daily_learning_metrics`. */
  seed(series: string, history: readonly { bucket: string; usd: number }[]): void {
    const s = this.#state(series);
    s.completed.push(...history.map((h) => ({ bucket: h.bucket, usd: h.usd })));
    if (s.completed.length > this.#opts.windowSize) s.completed.splice(0, s.completed.length - this.#opts.windowSize);
  }

  /** Baseline statistics over completed buckets. */
  baseline(series: string): { mean: number; std: number; points: number } {
    const s = this.#series.get(series);
    const pts = s?.completed ?? [];
    if (pts.length === 0) return { mean: 0, std: 0, points: 0 };
    const mean = pts.reduce((a, p) => a + p.usd, 0) / pts.length;
    const variance = pts.reduce((a, p) => a + (p.usd - mean) ** 2, 0) / pts.length;
    return { mean, std: Math.sqrt(variance), points: pts.length };
  }

  /** Current running total of the open bucket. */
  current(series: string): { bucket: string; usd: number } | null {
    const c = this.#series.get(series)?.current;
    return c ? { ...c } : null;
  }

  /** Add `usd` to `bucket` of `series`; returns an alert when the bucket first crosses a threshold. */
  observe(series: string, bucket: string, usd: number): OperatorAlert | null {
    if (!Number.isFinite(usd) || usd < 0) return null;
    const s = this.#state(series);
    if (s.current && s.current.bucket !== bucket) {
      s.completed.push(s.current);
      if (s.completed.length > this.#opts.windowSize) s.completed.shift();
      s.current = null;
    }
    if (!s.current) s.current = { bucket, usd: 0 };
    s.current.usd = roundUsd(s.current.usd + usd);
    if (s.alerted.has(bucket)) return null;

    const observed = s.current.usd;
    const o = this.#opts;
    const { mean, std, points } = this.baseline(series);
    const fire = (severity: OperatorAlertSeverity, thresholdUsd: number, why: string): OperatorAlert => {
      s.alerted.add(bucket);
      const ratio = mean > 0 ? observed / mean : Number.POSITIVE_INFINITY;
      return {
        kind: 'operator_alert',
        audience: 'operators',
        learnerFacing: false,
        severity,
        series,
        bucket,
        observedUsd: observed,
        baselineMeanUsd: roundUsd(mean),
        baselineStdUsd: roundUsd(std),
        baselinePoints: points,
        ratio,
        thresholdUsd: roundUsd(thresholdUsd),
        detectedAt: o.now(),
        message: `[${severity}] ${series} ${bucket}: ${observed.toFixed(4)} USD ${why}. Operator review only; learners are never limited.`,
      };
    };

    if (o.hardCeilingUsd !== null && observed >= o.hardCeilingUsd) return fire('critical', o.hardCeilingUsd, `reached the hard ceiling of ${o.hardCeilingUsd} USD`);
    if (points < o.minBaselinePoints || observed < o.absoluteFloorUsd) return null;
    const sigmaThreshold = mean + o.sigma * std;
    const critical = Math.max(mean * o.criticalRatio, sigmaThreshold);
    const warning = Math.max(mean * o.warningRatio, sigmaThreshold);
    if (observed >= critical) return fire('critical', critical, `is ≥ ${o.criticalRatio}× the ${points}-bucket baseline (${mean.toFixed(4)} USD)`);
    if (observed >= warning) return fire('warning', warning, `is ≥ ${o.warningRatio}× the ${points}-bucket baseline (${mean.toFixed(4)} USD)`);
    return null;
  }
}

/** Day bucket key (UTC) for an ISO timestamp. */
export function dayBucket(occurredAt: string | Date): string {
  const d = typeof occurredAt === 'string' ? new Date(occurredAt) : occurredAt;
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Model-profile budgets → detectors
// ---------------------------------------------------------------------------

/** The slice of a model profile the budget helpers read. */
export type ProfileBudgetSource = Pick<ModelProfile, 'task' | 'dailyBudgetUsd' | 'enabled'>;

export interface ProfileBudgetOptions {
  /** Also honour budgets on disabled profiles. Default false. */
  includeDisabled?: boolean;
}

/**
 * Collapse `ai_model_profiles.daily_budget_usd` into one ceiling per task: the **tightest** budget
 * among that task's profiles (a task is routed by variety × source, and all of its profiles share
 * one `ai_cost:task:<task>` series). Profiles with a `null` budget contribute nothing; tasks with
 * no budgeted profile are absent from the map.
 */
export function profileDailyBudgets(profiles: readonly ProfileBudgetSource[], options: ProfileBudgetOptions = {}): Map<AiTaskName, number> {
  const out = new Map<AiTaskName, number>();
  for (const p of profiles) {
    if (p.dailyBudgetUsd === null || !Number.isFinite(p.dailyBudgetUsd) || p.dailyBudgetUsd < 0) continue;
    if (!p.enabled && !options.includeDisabled) continue;
    const current = out.get(p.task);
    if (current === undefined || p.dailyBudgetUsd < current) out.set(p.task, p.dailyBudgetUsd);
  }
  return out;
}

export interface ProfileBudgetDetectorOptions extends ProfileBudgetOptions, Omit<CostAnomalyDetectorOptions, 'hardCeilingUsd'> {}

/**
 * Build one {@link CostAnomalyDetector} per budgeted task with `hardCeilingUsd` set to that task's
 * daily budget (see {@link profileDailyBudgets}); the remaining options tune the rolling baseline
 * the same detector also applies. Pass the result to `new CostLedger(pricing, { budgetDetectors })`
 * so {@link CostLedger.recordAiRequest} raises a **critical, operator-only** alert the moment a
 * day's spend on a task reaches its budget. Budgets protect operations; they never limit learners,
 * and nothing here throttles or rejects a request.
 */
export function createProfileBudgetDetectors(profiles: readonly ProfileBudgetSource[], options: ProfileBudgetDetectorOptions = {}): Map<AiTaskName, CostAnomalyDetector> {
  const { includeDisabled, ...detectorOptions } = options;
  const detectors = new Map<AiTaskName, CostAnomalyDetector>();
  for (const [task, hardCeilingUsd] of profileDailyBudgets(profiles, { includeDisabled: includeDisabled ?? false })) {
    detectors.set(task, new CostAnomalyDetector({ ...detectorOptions, hardCeilingUsd }));
  }
  return detectors;
}
