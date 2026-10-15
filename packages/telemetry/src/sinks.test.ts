import { describe, expect, it, vi } from 'vitest';
import { AnalyticsErrorsResponseSchema, TelemetryEventSchema, type TelemetryEvent } from '@langquest/contracts';
import { CostAnomalyDetector, CostLedger, PricingTable, type OperatorAlert } from './cost';
import { createTelemetryContext, telemetry } from './events';
import { aggregateDailyLearningMetrics, BufferedSink, ConsoleAlertSink, ConsoleSink, FanoutAlertSink, FanoutSink, InMemoryAlertSink, isOperatorAlert, PostHogSink, projectForSink, SupabaseTableSink, toAnalyticsAlert, WebhookAlertSink, type Sink, type SupabaseLikeClient } from './sinks';

const ctx = createTelemetryContext({ platform: 'android', appVersion: '2.0.0', privacyLevel: 'personal', userHash: 'u_hash', sessionId: 's1', enrollmentId: '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b', trackId: 'french', targetVarietyId: 'fr', sourceLanguageCode: 'en', now: () => '2026-10-14T08:00:00.000Z' });
const M = '11111111-1111-4111-8111-111111111111';
const mission = (withoutHints: boolean) => telemetry.missionCompleted(ctx, { missionId: M, withoutHints, durationMs: 1000, objectivesCompleted: 1, objectivesTotal: 1 });

class MemorySink implements Sink {
  readonly name = 'memory';
  batches: TelemetryEvent[][] = [];
  failures = 0;
  constructor(private failTimes = 0) {}
  async write(events: readonly TelemetryEvent[]) {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      this.failures += 1;
      throw new Error('boom');
    }
    this.batches.push([...events]);
  }
}

describe('ConsoleSink', () => {
  it('logs projected JSON lines', async () => {
    const log = vi.fn();
    const sink = new ConsoleSink({ console: { log }, privacyCeiling: 'anonymous' });
    await sink.write([mission(true)]);
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse((log.mock.calls[0]![0] as string).replace('[telemetry] ', ''));
    expect(line.userHash).toBeNull();
    expect(line.privacyLevel).toBe('anonymous');
    const pretty = new ConsoleSink({ console: { log }, format: 'pretty' });
    await pretty.write([mission(true)]);
    expect(log).toHaveBeenLastCalledWith('[telemetry] mission_completed (learning_outcome)', expect.any(Object));
  });
});

describe('BufferedSink', () => {
  it('batches by size and retries with backoff before dropping', async () => {
    const inner = new MemorySink(2);
    const sleep = vi.fn(async () => {});
    const onError = vi.fn();
    const sink = new BufferedSink(inner, { maxBatchSize: 2, flushIntervalMs: 0, maxRetries: 3, backoffMs: 100, sleep, onError });
    await sink.write([mission(true)]);
    expect(sink.pending).toBe(1);
    await sink.write([mission(false)]);
    await sink.flush();
    expect(inner.batches).toHaveLength(1);
    expect(inner.batches[0]).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(sink.dropped).toBe(0);
  });
  it('drops a batch after exhausting retries and reports overflow', async () => {
    const inner = new MemorySink(99);
    const onDrop = vi.fn();
    const sink = new BufferedSink(inner, { maxBatchSize: 10, flushIntervalMs: 0, maxRetries: 2, sleep: async () => {}, onDrop, maxQueueSize: 2 });
    await sink.write([mission(true), mission(true), mission(false)]);
    expect(onDrop).toHaveBeenCalledWith(expect.any(Array), 'overflow');
    expect(sink.pending).toBe(2);
    await sink.flush();
    expect(onDrop).toHaveBeenLastCalledWith(expect.any(Array), 'retries_exhausted');
    expect(sink.dropped).toBe(3);
    expect(sink.pending).toBe(0);
  });
  it('flushes on the timer and refuses writes after close', async () => {
    const inner = new MemorySink();
    const timers: Array<() => void> = [];
    const sink = new BufferedSink(inner, { flushIntervalMs: 1000, setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => {} });
    await sink.write([mission(true)]);
    expect(timers).toHaveLength(1);
    timers[0]!();
    await sink.flush();
    expect(inner.batches).toHaveLength(1);
    await sink.close();
    await expect(sink.write([mission(true)])).rejects.toThrow('closed');
  });
});

describe('FanoutSink', () => {
  it('writes to all sinks and aggregates failures', async () => {
    const ok = new MemorySink();
    const bad = new MemorySink(1);
    const fan = new FanoutSink([ok, bad]);
    await expect(fan.write([mission(true)])).rejects.toBeInstanceOf(AggregateError);
    expect(ok.batches).toHaveLength(1);
    await fan.write([mission(true)]);
    expect(bad.batches).toHaveLength(1);
    await fan.flush();
    await fan.close();
  });
});

describe('aggregateDailyLearningMetrics', () => {
  it('folds learning outcomes into per-day/track/source rows without learner ids', () => {
    const rows = aggregateDailyLearningMetrics([
      mission(true),
      mission(false),
      telemetry.reviewRecall(ctx, { cardId: M, intervalDays: 7, recalled: true, hintsUsed: 0 }),
      telemetry.reviewRecall(ctx, { cardId: M, intervalDays: 7.5, recalled: false, hintsUsed: 1 }),
      telemetry.reviewRecall(ctx, { cardId: M, intervalDays: 31, recalled: true, hintsUsed: 0 }),
      telemetry.transferSuccess(ctx, { skillKey: 'k', unseenScenario: true, success: true }),
      telemetry.pronunciationFeedback(ctx, { assessmentMode: 'acoustic-assessor', intelligibility: 'understood', numericScorePresent: true, learnerFlaggedFalseCorrection: true }),
      telemetry.speakingTime(ctx, { seconds: 90, context: 'conversation' }),
      telemetry.skillStateChanged(ctx, { skillKey: 'k', from: 'emerging', to: 'practiced' }),
      telemetry.skillStateChanged(ctx, { skillKey: 'k', from: 'practiced', to: 'emerging' }),
      telemetry.screenView(ctx, { screen: 'home', rtl: false, scriptMode: null }),
    ]);
    const byKey = Object.fromEntries(rows.map((r) => [r.metric_key, r]));
    expect(byKey.missions_completed).toMatchObject({ metric_date: '2026-10-14', track_id: 'french', source_language_code: 'en', value: 2, sample_count: 2 });
    expect(byKey.missions_completed_without_hints).toMatchObject({ value: 1, sample_count: 2 });
    expect(byKey.review_recall_7d).toMatchObject({ value: 1, sample_count: 2 });
    expect(byKey.review_recall_30d).toMatchObject({ value: 1, sample_count: 1 });
    expect(byKey.transfer_success).toMatchObject({ value: 1, sample_count: 1 });
    expect(byKey.false_correction_flags).toMatchObject({ value: 1, sample_count: 1 });
    expect(byKey.pronunciation_numeric_scores).toMatchObject({ value: 1 });
    expect(byKey.speaking_seconds).toMatchObject({ value: 90, sample_count: 1 });
    expect(byKey.skill_advances).toMatchObject({ value: 1, sample_count: 2 });
    expect(rows.every((r) => !('user_hash' in r))).toBe(true);
  });
});

function fakeClient() {
  const calls: Array<{ table: string; op: 'insert' | 'upsert'; rows: readonly Record<string, unknown>[]; options?: unknown }> = [];
  let fail: string | null = null;
  const client: SupabaseLikeClient = {
    from: (table) => ({
      insert: async (rows) => (calls.push({ table, op: 'insert', rows }), { error: fail === table ? { message: 'db down' } : null }),
      upsert: async (rows, options) => (calls.push({ table, op: 'upsert', rows, options }), { error: fail === table ? { message: 'db down' } : null }),
    }),
  };
  return { client, calls, setFail: (t: string | null) => (fail = t) };
}

describe('SupabaseTableSink', () => {
  it('upserts daily metrics, skips raw events unless configured, inserts ai_requests', async () => {
    const { client, calls, setFail } = fakeClient();
    const sink = new SupabaseTableSink(client);
    await sink.write([mission(true), telemetry.screenView(ctx, { screen: 'home', rtl: false, scriptMode: null })]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: 'daily_learning_metrics', op: 'upsert', options: { onConflict: 'metric_date,track_id,source_language_code,metric_key' } });
    await sink.writeAiRequests([{ user_id: null, enrollment_id: null, task: 'character_dialogue', provider: 'openrouter', model: 'm', profile_id: null, fallback_index: 0, latency_ms: null, input_tokens: 1, output_tokens: 1, audio_seconds: null, estimated_cost_usd: 0.1, success: true, error_code: null, trace_id: 't', redacted_log: null }]);
    expect(calls[1]).toMatchObject({ table: 'ai_requests', op: 'insert' });
    await sink.writeAiRequests([]);
    expect(calls).toHaveLength(2);
    setFail('daily_learning_metrics');
    await expect(sink.write([mission(true)])).rejects.toThrow('db down');
  });
  it('writes projected raw events when a table is configured', async () => {
    const { client, calls } = fakeClient();
    const sink = new SupabaseTableSink(client, { tables: { rawEvents: 'telemetry_events' }, privacyCeiling: 'anonymous', dailyMetricsMode: 'insert' });
    await sink.write([mission(true)]);
    expect(calls[0]!.op).toBe('insert');
    const raw = calls[1]!;
    expect(raw.table).toBe('telemetry_events');
    expect(raw.rows[0]).toMatchObject({ name: 'mission_completed', user_hash: null, enrollment_id: null, privacy_level: 'anonymous' });
  });
});

describe('PostHogSink', () => {
  it('is a no-op without an API key', async () => {
    const fetchMock = vi.fn();
    const sink = new PostHogSink({ fetch: fetchMock as unknown as typeof fetch });
    expect(sink.enabled).toBe(false);
    await sink.write([mission(true)]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('posts a projected batch with pseudonymous distinct ids', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    const sink = new PostHogSink({ apiKey: 'phc_test', host: 'https://eu.i.posthog.com/', fetch: fetchMock as unknown as typeof fetch, globalProperties: { env: 'test' } });
    expect(sink.enabled).toBe(true);
    await sink.write([mission(true)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    const body = JSON.parse(init.body as string);
    expect(body.api_key).toBe('phc_test');
    expect(body.batch[0]).toMatchObject({ event: 'mission_completed', distinct_id: 'u_hash', properties: { env: 'test', track_id: 'french', enrollment_id: null, privacy_level: 'pseudonymous', withoutHints: true } });
    const failing = new PostHogSink({ apiKey: 'k', fetch: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch });
    await expect(failing.write([mission(true)])).rejects.toThrow('HTTP 500');
  });
  it('projectForSink never exceeds the ceiling', () => {
    const [p] = projectForSink([mission(true)], 'anonymous');
    expect(p!.userHash).toBeNull();
    expect(p!.sessionId).toBeNull();
  });
});

describe('operator alert delivery', () => {
  const pricing = new PricingTable({ chat_candidates: [{ id: 'x/one', prompt: '0.000001', completion: '0' }] });

  it('a critical alert reaches the alert sinks and never a telemetry sink or learner projection', async () => {
    const learnerSink = new MemorySink();
    const memory = new InMemoryAlertSink(10);
    const log = vi.fn();
    const error = vi.fn();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    const webhook = new WebhookAlertSink({ url: 'https://hooks.example.test/ops', fetch: fetchMock as unknown as typeof fetch, headers: { authorization: 'Bearer test' }, minSeverity: 'critical' });
    const alerts = new FanoutAlertSink([memory, new ConsoleAlertSink({ console: { log, error } }), webhook]);
    const ledger = new CostLedger(pricing, { now: () => '2026-10-14T09:00:00.000Z', totalDetector: new CostAnomalyDetector({ hardCeilingUsd: 10 }), alertSink: alerts });
    const { alerts: raised } = ledger.recordAiRequest({ traceId: 't', task: 'character_dialogue', provider: 'openrouter', model: 'x/one', success: true, inputTokens: 10_500_000, userHash: 'u_hash', enrollmentId: '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b' });
    await ledger.flushAlerts();
    expect(raised).toHaveLength(1);
    const alert = raised[0]!;
    expect(alert).toMatchObject({ severity: 'critical', audience: 'operators', learnerFacing: false });
    expect(memory.recent()).toEqual([alert]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.example.test/ops');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test');
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe(alert.message);
    expect(body.alert).toEqual(JSON.parse(JSON.stringify(alert)));
    expect(JSON.stringify(body)).not.toContain('u_hash');
    // Telemetry sinks never saw it, and it cannot be smuggled in as an event.
    expect(learnerSink.batches).toEqual([]);
    expect(isOperatorAlert(alert)).toBe(true);
    expect(isOperatorAlert(mission(true))).toBe(false);
    expect(TelemetryEventSchema.safeParse(alert).success).toBe(false);
    expect(() => projectForSink([alert as unknown as TelemetryEvent], 'personal')).toThrow('operator alerts are not telemetry events');
    await expect(new ConsoleSink({ console: { log } }).write([alert as unknown as TelemetryEvent])).rejects.toThrow('AlertSink');
    expect(aggregateDailyLearningMetrics([mission(true)])).not.toContainEqual(expect.objectContaining({ metric_key: expect.stringContaining('alert') }));
  });

  it('maps alerts onto the admin analytics alerts row', async () => {
    const memory = new InMemoryAlertSink(2);
    const mk = (detectedAt: string, severity: OperatorAlert['severity'] = 'warning'): OperatorAlert => ({ kind: 'operator_alert', audience: 'operators', learnerFacing: false, severity, series: 'ai_cost:total', bucket: detectedAt.slice(0, 10), observedUsd: 5, baselineMeanUsd: 1, baselineStdUsd: 0, baselinePoints: 3, ratio: 5, thresholdUsd: 2, detectedAt, message: 'm' });
    await memory.deliver(mk('2026-10-12T00:00:00.000Z'));
    await memory.deliver(mk('2026-10-13T00:00:00.000Z'));
    await memory.deliver(mk('2026-10-14T00:00:00.000Z', 'critical'));
    expect(memory.recent()).toHaveLength(2); // capacity
    const rows = memory.toAnalyticsAlerts('2026-10-14T00:00:00.000Z');
    expect(rows).toEqual([{ kind: 'runaway_cost', since: '2026-10-14T00:00:00.000Z', detail: 'm' }]);
    expect(AnalyticsErrorsResponseSchema.shape.alerts.safeParse(memory.toAnalyticsAlerts()).success).toBe(true);
    expect(toAnalyticsAlert(mk('2026-10-14T01:00:00.000Z'))).toEqual({ kind: 'runaway_cost', since: '2026-10-14T01:00:00.000Z', detail: 'm' });
    memory.clear();
    expect(memory.recent()).toEqual([]);
    expect(() => new InMemoryAlertSink(0)).toThrow();
  });

  it('webhook sink is a no-op without a URL, filters by severity and surfaces HTTP failures through the fanout', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 }));
    const disabled = new WebhookAlertSink({ fetch: fetchMock as unknown as typeof fetch });
    expect(disabled.enabled).toBe(false);
    const alert: OperatorAlert = { kind: 'operator_alert', audience: 'operators', learnerFacing: false, severity: 'warning', series: 's', bucket: 'b', observedUsd: 1, baselineMeanUsd: 0, baselineStdUsd: 0, baselinePoints: 0, ratio: Number.POSITIVE_INFINITY, thresholdUsd: 1, detectedAt: '2026-10-14T00:00:00.000Z', message: 'm' };
    await disabled.deliver(alert);
    const criticalOnly = new WebhookAlertSink({ url: 'https://hooks.example.test', fetch: fetchMock as unknown as typeof fetch, minSeverity: 'critical' });
    await criticalOnly.deliver(alert);
    expect(fetchMock).not.toHaveBeenCalled();
    const failing = new WebhookAlertSink({ url: 'https://hooks.example.test', fetch: fetchMock as unknown as typeof fetch });
    const memory = new InMemoryAlertSink();
    await expect(new FanoutAlertSink([failing, memory]).deliver(alert)).rejects.toThrow('1/2 alert sinks failed');
    expect(memory.recent()).toHaveLength(1);
  });
});
