/**
 * Telemetry sinks: where validated, privacy-projected events go.
 *
 * - {@link ConsoleSink} — structured logs (dev, Workers tail, job runner).
 * - {@link BufferedSink} — batching + retry with backoff in front of any other sink.
 * - {@link FanoutSink} — write to several sinks; one failure never blocks the others.
 * - {@link SupabaseTableSink} — persists `ai_requests` ledger rows and aggregates learning-outcome
 *   events into `daily_learning_metrics` through an injected (service-role) client.
 * - {@link PostHogSink} — product analytics; a no-op when no API key is configured.
 *
 * Every sink applies {@link applyPrivacyLevel} with its own ceiling before export, so a sink can
 * never emit more identifying data than it was configured for.
 *
 * Operator alerts travel on a separate path ({@link AlertSink}): they are not telemetry events,
 * never carry learner identifiers, and {@link projectForSink} refuses them outright so a
 * learner-level sink can never see one. Implementations: {@link ConsoleAlertSink},
 * {@link WebhookAlertSink}, {@link FanoutAlertSink}, {@link InMemoryAlertSink};
 * {@link toAnalyticsAlert} maps an alert onto the admin `/v1/admin/analytics/errors` `alerts` row.
 */
import { z } from 'zod';
import { IsoDateSchema, masteryRank, type Insert, type PrivacyLevel, type TelemetryEvent } from '@langquest/contracts';
import type { OperatorAlert, OperatorAlertSeverity } from './cost';
import { recallBucket } from './events';
import { applyPrivacyLevel } from './privacy';

// ---------------------------------------------------------------------------
// Sink contract
// ---------------------------------------------------------------------------

export interface Sink {
  readonly name: string;
  /** Persist a batch. Must reject on failure so {@link BufferedSink} can retry. */
  write(events: readonly TelemetryEvent[]): Promise<void>;
  /** Flush any internal buffer (optional). */
  flush?(): Promise<void>;
  /** Flush and release resources (optional). */
  close?(): Promise<void>;
}

export interface SinkOptions {
  /** Most identifying level this sink may export. Default `pseudonymous`. */
  privacyCeiling?: PrivacyLevel;
}

/** Runtime check for an {@link OperatorAlert} (alerts are never valid telemetry events). */
export function isOperatorAlert(value: unknown): value is OperatorAlert {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'operator_alert' && (value as { audience?: unknown }).audience === 'operators';
}

/**
 * Project every event onto the sink's ceiling. Throws if an operator alert was smuggled into the
 * batch: alerts have their own delivery path ({@link AlertSink}) and must never reach a
 * learner-level sink or projection.
 */
export function projectForSink(events: readonly TelemetryEvent[], ceiling: PrivacyLevel): TelemetryEvent[] {
  return events.map((e) => {
    if (isOperatorAlert(e)) throw new Error('projectForSink: operator alerts are not telemetry events; deliver them through an AlertSink');
    return applyPrivacyLevel(e, ceiling);
  });
}

// ---------------------------------------------------------------------------
// ConsoleSink
// ---------------------------------------------------------------------------

export interface ConsoleLike {
  log(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

export interface ConsoleSinkOptions extends SinkOptions {
  console?: ConsoleLike;
  /** `json` prints one JSON line per event; `pretty` prints `name category {props}`. Default `json`. */
  format?: 'json' | 'pretty';
  prefix?: string;
}

/** Logs each event as one structured line. */
export class ConsoleSink implements Sink {
  readonly name = 'console';
  readonly #console: ConsoleLike;
  readonly #format: 'json' | 'pretty';
  readonly #prefix: string;
  readonly #ceiling: PrivacyLevel;

  constructor(options: ConsoleSinkOptions = {}) {
    this.#console = options.console ?? console;
    this.#format = options.format ?? 'json';
    this.#prefix = options.prefix ?? '[telemetry]';
    this.#ceiling = options.privacyCeiling ?? 'pseudonymous';
  }

  async write(events: readonly TelemetryEvent[]): Promise<void> {
    for (const e of projectForSink(events, this.#ceiling)) {
      if (this.#format === 'json') this.#console.log(`${this.#prefix} ${JSON.stringify(e)}`);
      else this.#console.log(`${this.#prefix} ${e.name} (${e.category})`, e.props);
    }
  }
}

// ---------------------------------------------------------------------------
// FanoutSink
// ---------------------------------------------------------------------------

/** Writes to all sinks; rejects with an AggregateError only after every sink was attempted. */
export class FanoutSink implements Sink {
  readonly name = 'fanout';
  readonly #sinks: readonly Sink[];

  constructor(sinks: readonly Sink[]) {
    this.#sinks = sinks;
  }

  async write(events: readonly TelemetryEvent[]): Promise<void> {
    const results = await Promise.allSettled(this.#sinks.map((s) => s.write(events)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) throw new AggregateError(failures.map((f) => f.reason), `${failures.length}/${this.#sinks.length} sinks failed`);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.#sinks.map((s) => s.flush?.()));
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.#sinks.map((s) => s.close?.()));
  }
}

// ---------------------------------------------------------------------------
// BufferedSink
// ---------------------------------------------------------------------------

export interface BufferedSinkOptions {
  /** Flush when this many events are queued. Default 100. */
  maxBatchSize?: number;
  /** Flush at least this often while events are queued; 0 disables the timer. Default 5000. */
  flushIntervalMs?: number;
  /** Attempts per batch before dropping it. Default 3. */
  maxRetries?: number;
  /** Base backoff; doubles per attempt. Default 500. */
  backoffMs?: number;
  /** Max queued events; oldest are dropped beyond it. Default 5000. */
  maxQueueSize?: number;
  /** Called with dropped events (queue overflow or retries exhausted). */
  onDrop?: (events: readonly TelemetryEvent[], reason: 'overflow' | 'retries_exhausted') => void;
  /** Called on every failed attempt. */
  onError?: (error: unknown, attempt: number) => void;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable timer for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Batches writes to an inner sink and retries failed batches with exponential backoff. */
export class BufferedSink implements Sink {
  readonly name: string;
  readonly #inner: Sink;
  readonly #o: Required<Omit<BufferedSinkOptions, 'onDrop' | 'onError' | 'setTimer' | 'clearTimer'>> & Pick<BufferedSinkOptions, 'onDrop' | 'onError'> & { setTimer: NonNullable<BufferedSinkOptions['setTimer']>; clearTimer: NonNullable<BufferedSinkOptions['clearTimer']> };
  #queue: TelemetryEvent[] = [];
  #timer: unknown = null;
  #flushing: Promise<void> | null = null;
  #closed = false;
  #dropped = 0;

  constructor(inner: Sink, options: BufferedSinkOptions = {}) {
    this.#inner = inner;
    this.name = `buffered(${inner.name})`;
    this.#o = {
      maxBatchSize: options.maxBatchSize ?? 100,
      flushIntervalMs: options.flushIntervalMs ?? 5000,
      maxRetries: options.maxRetries ?? 3,
      backoffMs: options.backoffMs ?? 500,
      maxQueueSize: options.maxQueueSize ?? 5000,
      sleep: options.sleep ?? defaultSleep,
      onDrop: options.onDrop,
      onError: options.onError,
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
    if (this.#o.maxBatchSize < 1 || this.#o.maxRetries < 1) throw new Error('BufferedSink: maxBatchSize and maxRetries must be ≥ 1');
  }

  /** Events waiting to be flushed. */
  get pending(): number {
    return this.#queue.length;
  }

  /** Events dropped so far (overflow + exhausted retries). */
  get dropped(): number {
    return this.#dropped;
  }

  async write(events: readonly TelemetryEvent[]): Promise<void> {
    if (this.#closed) throw new Error('BufferedSink: closed');
    this.#queue.push(...events);
    const overflow = this.#queue.length - this.#o.maxQueueSize;
    if (overflow > 0) {
      const dropped = this.#queue.splice(0, overflow);
      this.#dropped += dropped.length;
      this.#o.onDrop?.(dropped, 'overflow');
    }
    if (this.#queue.length >= this.#o.maxBatchSize) void this.flush();
    else this.#schedule();
  }

  #schedule(): void {
    if (this.#timer !== null || this.#o.flushIntervalMs <= 0 || this.#queue.length === 0) return;
    this.#timer = this.#o.setTimer(() => {
      this.#timer = null;
      void this.flush();
    }, this.#o.flushIntervalMs);
  }

  /** Drain the queue (all batches), retrying each batch. Concurrent calls share one drain. */
  async flush(): Promise<void> {
    if (this.#flushing) return this.#flushing;
    this.#flushing = this.#drain().finally(() => {
      this.#flushing = null;
      this.#schedule();
    });
    return this.#flushing;
  }

  async #drain(): Promise<void> {
    if (this.#timer !== null) {
      this.#o.clearTimer(this.#timer);
      this.#timer = null;
    }
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, this.#o.maxBatchSize);
      await this.#writeWithRetry(batch);
    }
  }

  async #writeWithRetry(batch: TelemetryEvent[]): Promise<void> {
    for (let attempt = 1; attempt <= this.#o.maxRetries; attempt++) {
      try {
        await this.#inner.write(batch);
        return;
      } catch (error) {
        this.#o.onError?.(error, attempt);
        if (attempt < this.#o.maxRetries) await this.#o.sleep(this.#o.backoffMs * 2 ** (attempt - 1));
      }
    }
    this.#dropped += batch.length;
    this.#o.onDrop?.(batch, 'retries_exhausted');
  }

  async close(): Promise<void> {
    await this.flush();
    this.#closed = true;
    if (this.#timer !== null) {
      this.#o.clearTimer(this.#timer);
      this.#timer = null;
    }
    await this.#inner.close?.();
  }
}

// ---------------------------------------------------------------------------
// SupabaseTableSink
// ---------------------------------------------------------------------------

/**
 * Row of the `daily_learning_metrics` aggregate table (one row per day × track × source language ×
 * metric). `value` is the numerator (e.g. recalled reviews, seconds) and `sample_count` the
 * denominator (e.g. reviews observed) so rates are recomputed, not stored.
 *
 * NOTE: `@langquest/contracts` has no table definition for this yet; the schema lives here until
 * the contracts/db packages add one (unique key: `metric_date, track_id, source_language_code, metric_key`).
 */
export const DailyLearningMetricRowSchema = z.object({
  metric_date: IsoDateSchema,
  track_id: z.string().nullable(),
  source_language_code: z.string().nullable(),
  metric_key: z.string().min(1),
  value: z.number(),
  sample_count: z.number().int().min(0),
});
export type DailyLearningMetricRow = z.infer<typeof DailyLearningMetricRowSchema>;

export const DAILY_LEARNING_METRIC_KEYS = [
  'missions_completed',
  'missions_completed_without_hints',
  'review_recall_7d',
  'review_recall_30d',
  'review_recall_other',
  'transfer_success',
  'false_correction_flags',
  'pronunciation_feedback',
  'pronunciation_numeric_scores',
  'speaking_seconds',
  'skill_advances',
] as const;
export type DailyLearningMetricKey = (typeof DAILY_LEARNING_METRIC_KEYS)[number];

/** Fold learning-outcome events into aggregate rows (no learner identifiers survive). */
export function aggregateDailyLearningMetrics(events: readonly TelemetryEvent[]): DailyLearningMetricRow[] {
  const rows = new Map<string, DailyLearningMetricRow>();
  const bump = (e: TelemetryEvent, key: DailyLearningMetricKey, value: number, samples = 1) => {
    const metric_date = e.occurredAt.slice(0, 10);
    const id = `${metric_date}|${e.trackId ?? ''}|${e.sourceLanguageCode ?? ''}|${key}`;
    const row = rows.get(id) ?? { metric_date, track_id: e.trackId, source_language_code: e.sourceLanguageCode, metric_key: key, value: 0, sample_count: 0 };
    row.value += value;
    row.sample_count += samples;
    rows.set(id, row);
  };
  for (const e of events) {
    switch (e.name) {
      case 'mission_completed':
        bump(e, 'missions_completed', 1);
        bump(e, 'missions_completed_without_hints', e.props.withoutHints ? 1 : 0);
        break;
      case 'review_recall':
        bump(e, `review_recall_${recallBucket(e.props.intervalDays)}`, e.props.recalled ? 1 : 0);
        break;
      case 'transfer_success':
        bump(e, 'transfer_success', e.props.success ? 1 : 0);
        break;
      case 'pronunciation_feedback':
        bump(e, 'pronunciation_feedback', 1);
        bump(e, 'false_correction_flags', e.props.learnerFlaggedFalseCorrection ? 1 : 0);
        bump(e, 'pronunciation_numeric_scores', e.props.numericScorePresent ? 1 : 0);
        break;
      case 'speaking_time':
        bump(e, 'speaking_seconds', e.props.seconds);
        break;
      case 'skill_state_changed':
        bump(e, 'skill_advances', masteryRank(e.props.to) > masteryRank(e.props.from) ? 1 : 0);
        break;
      default:
        break;
    }
  }
  return [...rows.values()].map((r) => DailyLearningMetricRowSchema.parse(r));
}

/** Minimal slice of `SupabaseClient` used by the sink (so tests inject a fake). */
export interface SupabaseLikeClient {
  from(table: string): {
    insert(rows: readonly Record<string, unknown>[]): PromiseLike<{ error: { message: string } | null }>;
    upsert(rows: readonly Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): PromiseLike<{ error: { message: string } | null }>;
  };
}

export interface SupabaseTableSinkOptions extends SinkOptions {
  tables?: { aiRequests?: string; dailyLearningMetrics?: string; /** Optional raw event table; when unset, non-learning events are not persisted. */ rawEvents?: string | null };
  /** Called with the daily rows before upsert; the current day's rows are merged server-side by the RPC/trigger or replaced — pick via `dailyMetricsMode`. */
  dailyMetricsMode?: 'upsert_replace' | 'insert';
}

/**
 * Persists telemetry to Supabase with the service-role client injected by the API/job runner.
 * Learning-outcome events are folded into `daily_learning_metrics`; AI request rows come from the
 * cost ledger via {@link SupabaseTableSink.writeAiRequests}.
 */
export class SupabaseTableSink implements Sink {
  readonly name = 'supabase';
  readonly #client: SupabaseLikeClient;
  readonly #tables: { aiRequests: string; dailyLearningMetrics: string; rawEvents: string | null };
  readonly #ceiling: PrivacyLevel;
  readonly #mode: 'upsert_replace' | 'insert';

  constructor(client: SupabaseLikeClient, options: SupabaseTableSinkOptions = {}) {
    this.#client = client;
    this.#tables = { aiRequests: options.tables?.aiRequests ?? 'ai_requests', dailyLearningMetrics: options.tables?.dailyLearningMetrics ?? 'daily_learning_metrics', rawEvents: options.tables?.rawEvents ?? null };
    this.#ceiling = options.privacyCeiling ?? 'pseudonymous';
    this.#mode = options.dailyMetricsMode ?? 'upsert_replace';
  }

  async write(events: readonly TelemetryEvent[]): Promise<void> {
    const projected = projectForSink(events, this.#ceiling);
    const rows = aggregateDailyLearningMetrics(projected);
    if (rows.length > 0) {
      const table = this.#client.from(this.#tables.dailyLearningMetrics);
      const res = this.#mode === 'insert' ? await table.insert(rows) : await table.upsert(rows, { onConflict: 'metric_date,track_id,source_language_code,metric_key' });
      if (res.error) throw new Error(`SupabaseTableSink(${this.#tables.dailyLearningMetrics}): ${res.error.message}`);
    }
    if (this.#tables.rawEvents) {
      const raw = projected.map((e) => ({ event_id: e.eventId, occurred_at: e.occurredAt, name: e.name, category: e.category, platform: e.platform, app_version: e.appVersion, user_hash: e.userHash, enrollment_id: e.enrollmentId, track_id: e.trackId, source_language_code: e.sourceLanguageCode, privacy_level: e.privacyLevel, props: e.props }));
      const res = await this.#client.from(this.#tables.rawEvents).upsert(raw, { onConflict: 'event_id', ignoreDuplicates: true });
      if (res.error) throw new Error(`SupabaseTableSink(${this.#tables.rawEvents}): ${res.error.message}`);
    }
  }

  /** Insert `ai_requests` ledger rows (from `CostLedger.recordAiRequest(...).insert`). */
  async writeAiRequests(rows: readonly Insert<'ai_requests'>[]): Promise<void> {
    if (rows.length === 0) return;
    const res = await this.#client.from(this.#tables.aiRequests).insert(rows as readonly Record<string, unknown>[]);
    if (res.error) throw new Error(`SupabaseTableSink(${this.#tables.aiRequests}): ${res.error.message}`);
  }
}

// ---------------------------------------------------------------------------
// PostHogSink
// ---------------------------------------------------------------------------

export interface PostHogSinkOptions extends SinkOptions {
  /** Project API key. **When missing or empty the sink is a documented no-op** (`enabled === false`). */
  apiKey?: string | null;
  /** Ingestion host. Default `https://eu.i.posthog.com` (EU data region by default, §11). */
  host?: string;
  fetch?: typeof fetch;
  /** Extra properties attached to every event (e.g. `{ env: 'staging' }`). */
  globalProperties?: Record<string, unknown>;
}

/**
 * Sends events to PostHog's `/batch/` endpoint. `distinct_id` is the pseudonymous `userHash`,
 * else the rotating `sessionId`, else `"anonymous"`; the raw user id never reaches PostHog.
 */
export class PostHogSink implements Sink {
  readonly name = 'posthog';
  readonly enabled: boolean;
  readonly #apiKey: string;
  readonly #host: string;
  readonly #fetch: typeof fetch | null;
  readonly #ceiling: PrivacyLevel;
  readonly #global: Record<string, unknown>;

  constructor(options: PostHogSinkOptions = {}) {
    this.#apiKey = options.apiKey ?? '';
    this.enabled = this.#apiKey.length > 0;
    this.#host = (options.host ?? 'https://eu.i.posthog.com').replace(/\/+$/, '');
    this.#fetch = options.fetch ?? (typeof fetch === 'function' ? fetch : null);
    this.#ceiling = options.privacyCeiling ?? 'pseudonymous';
    this.#global = options.globalProperties ?? {};
  }

  /** Build the batch payload (exposed for tests and for offline queuing). */
  toPayload(events: readonly TelemetryEvent[], sentAt = new Date().toISOString()): { api_key: string; batch: Record<string, unknown>[]; sent_at: string } {
    const batch = projectForSink(events, this.#ceiling).map((e) => ({
      event: e.name,
      distinct_id: e.userHash ?? e.sessionId ?? 'anonymous',
      timestamp: e.occurredAt,
      uuid: e.eventId,
      properties: {
        ...this.#global,
        category: e.category,
        platform: e.platform,
        app_version: e.appVersion,
        enrollment_id: e.enrollmentId,
        track_id: e.trackId,
        target_variety_id: e.targetVarietyId,
        source_language_code: e.sourceLanguageCode,
        privacy_level: e.privacyLevel,
        $session_id: e.sessionId,
        ...e.props,
      },
    }));
    return { api_key: this.#apiKey, batch, sent_at: sentAt };
  }

  async write(events: readonly TelemetryEvent[]): Promise<void> {
    if (!this.enabled || events.length === 0) return;
    if (!this.#fetch) throw new Error('PostHogSink: no fetch implementation available');
    const res = await this.#fetch(`${this.#host}/batch/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.toPayload(events)) });
    if (!res.ok) throw new Error(`PostHogSink: HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Operator alerts (§0.3 "escalate operator alerts when expense is atypical", §12.2)
// ---------------------------------------------------------------------------

/**
 * Delivery target for {@link OperatorAlert}s. Deliberately **not** a {@link Sink}: alerts are
 * operator-only, carry no learner identifiers, and must never be mixed into a telemetry batch.
 */
export interface AlertSink {
  readonly name: string;
  /** Deliver one alert. Must reject on failure so the caller can report it. */
  deliver(alert: OperatorAlert): Promise<void>;
}

export interface ConsoleAlertSinkOptions {
  console?: ConsoleLike;
  prefix?: string;
}

/** Logs each alert as one JSON line (`error` for critical, `log` for warning). */
export class ConsoleAlertSink implements AlertSink {
  readonly name = 'console-alert';
  readonly #console: ConsoleLike;
  readonly #prefix: string;

  constructor(options: ConsoleAlertSinkOptions = {}) {
    this.#console = options.console ?? console;
    this.#prefix = options.prefix ?? '[operator-alert]';
  }

  async deliver(alert: OperatorAlert): Promise<void> {
    const line = `${this.#prefix} ${JSON.stringify(alert)}`;
    if (alert.severity === 'critical' && this.#console.error) this.#console.error(line);
    else this.#console.log(line);
  }
}

export interface WebhookAlertSinkOptions {
  /** Incoming-webhook URL (Slack/Discord/PagerDuty-style or an internal endpoint). Empty → no-op. */
  url?: string | null;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Only deliver alerts at or above this severity. Default `warning` (everything). */
  minSeverity?: OperatorAlertSeverity;
  /** Build the request body; default is `{ text, alert }` (Slack-compatible `text` + full payload). */
  body?: (alert: OperatorAlert) => unknown;
}

const SEVERITY_RANK: Record<OperatorAlertSeverity, number> = { warning: 0, critical: 1 };

/**
 * POSTs each alert as JSON to a webhook. **When no URL is configured the sink is a documented
 * no-op** (`enabled === false`) so environments without an on-call channel still boot.
 */
export class WebhookAlertSink implements AlertSink {
  readonly name = 'webhook-alert';
  readonly enabled: boolean;
  readonly #url: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch | null;
  readonly #minRank: number;
  readonly #body: (alert: OperatorAlert) => unknown;

  constructor(options: WebhookAlertSinkOptions = {}) {
    this.#url = options.url ?? '';
    this.enabled = this.#url.length > 0;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? (typeof fetch === 'function' ? fetch : null);
    this.#minRank = SEVERITY_RANK[options.minSeverity ?? 'warning'];
    this.#body = options.body ?? ((alert) => ({ text: alert.message, alert }));
  }

  async deliver(alert: OperatorAlert): Promise<void> {
    if (!this.enabled || SEVERITY_RANK[alert.severity] < this.#minRank) return;
    if (!this.#fetch) throw new Error('WebhookAlertSink: no fetch implementation available');
    const res = await this.#fetch(this.#url, { method: 'POST', headers: { 'content-type': 'application/json', ...this.#headers }, body: JSON.stringify(this.#body(alert)) });
    if (!res.ok) throw new Error(`WebhookAlertSink: HTTP ${res.status}`);
  }
}

/** Delivers to every alert sink; rejects with an AggregateError only after all were attempted. */
export class FanoutAlertSink implements AlertSink {
  readonly name = 'fanout-alert';
  readonly #sinks: readonly AlertSink[];

  constructor(sinks: readonly AlertSink[]) {
    this.#sinks = sinks;
  }

  async deliver(alert: OperatorAlert): Promise<void> {
    const results = await Promise.allSettled(this.#sinks.map((s) => s.deliver(alert)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) throw new AggregateError(failures.map((f) => f.reason), `${failures.length}/${this.#sinks.length} alert sinks failed`);
  }
}

/** Row shape of `AnalyticsErrorsResponse.alerts[]` in `@langquest/contracts`. */
export interface AnalyticsAlert {
  kind: 'runaway_cost' | 'attack' | 'provider_outage' | 'rights_expiry';
  since: string;
  detail: string;
}

/** Map an operator alert onto the admin analytics `alerts` row (kind `runaway_cost`). */
export function toAnalyticsAlert(alert: OperatorAlert): AnalyticsAlert {
  return { kind: 'runaway_cost', since: alert.detectedAt, detail: alert.message };
}

/**
 * Keeps the most recent alerts in memory so an admin analytics route (or a test) can list them.
 * Per-process only; pair it with a webhook/console sink for durable delivery.
 */
export class InMemoryAlertSink implements AlertSink {
  readonly name = 'memory-alert';
  readonly #alerts: OperatorAlert[] = [];
  readonly #capacity: number;

  constructor(capacity = 100) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('InMemoryAlertSink: capacity must be a positive integer');
    this.#capacity = capacity;
  }

  async deliver(alert: OperatorAlert): Promise<void> {
    this.#alerts.push(alert);
    if (this.#alerts.length > this.#capacity) this.#alerts.splice(0, this.#alerts.length - this.#capacity);
  }

  /** Newest last. */
  recent(): readonly OperatorAlert[] {
    return this.#alerts;
  }

  /** Alerts since `since` (inclusive) as admin analytics rows. */
  toAnalyticsAlerts(since?: string): AnalyticsAlert[] {
    const cutoff = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
    return this.#alerts.filter((a) => Date.parse(a.detectedAt) >= cutoff).map(toAnalyticsAlert);
  }

  clear(): void {
    this.#alerts.length = 0;
  }
}
