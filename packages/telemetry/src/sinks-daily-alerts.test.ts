import { describe, expect, it, vi } from 'vitest';
import { AnalyticsErrorsResponseSchema, type Insert, type TelemetryEvent } from '@langquest/contracts';
import { CostAnomalyDetector, createOperatorAlert, OperatorAlertSchema, type OperatorAlert } from './cost';
import { createTelemetryContext, telemetry } from './events';
import {
  aggregateDailyLearningCounters,
  createMemoryAlertTransport,
  createResendAlertTransport,
  DAILY_LEARNING_COUNTERS_CONFLICT_KEY,
  DailyLearningCounterRowSchema,
  EmailAlertSink,
  formatAlertEmail,
  mergeDailyLearningCounters,
  SupabaseTableSink,
  toAnalyticsAlert,
  type DailyLearningCounterRow,
  type SupabaseLikeClient,
  type SupabaseLikeSelect,
} from './sinks';

const E1 = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const E2 = '2b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const users: Record<string, string> = { [E1]: U1 };
const resolve = (id: string) => users[id] ?? null;

const ctx = (enrollmentId: string | null, now = '2026-10-14T08:00:00.000Z') => createTelemetryContext({ platform: 'android', appVersion: '2.0.0', privacyLevel: 'personal', userHash: 'u', enrollmentId, trackId: 'french', targetVarietyId: 'fr', sourceLanguageCode: 'en', now: () => now });
const c1 = ctx(E1);

function batch(): TelemetryEvent[] {
  return [
    telemetry.missionCompleted(c1, { missionId: M, withoutHints: true, durationMs: 90_000, objectivesCompleted: 1, objectivesTotal: 1 }),
    telemetry.missionCompleted(c1, { missionId: M, withoutHints: false, durationMs: 60_000, objectivesCompleted: 1, objectivesTotal: 1 }),
    telemetry.reviewRecall(c1, { cardId: C, intervalDays: 7, recalled: true, hintsUsed: 0 }),
    telemetry.reviewRecall(c1, { cardId: C, intervalDays: 7, recalled: true, hintsUsed: 0 }),
    telemetry.reviewRecall(c1, { cardId: C, intervalDays: 30, recalled: false, hintsUsed: 1 }),
    telemetry.speakingTime(c1, { seconds: 45, context: 'conversation' }),
    telemetry.conversationFunnel(c1, { step: 'ended', turnCount: 12 }),
    telemetry.conversationFunnel(c1, { step: 'first_turn', turnCount: 1 }),
    telemetry.screenView(c1, { screen: 'home', rtl: false, scriptMode: null }),
    telemetry.missionCompleted(ctx(E1, '2026-10-15T01:00:00.000Z'), { missionId: M, withoutHints: true, durationMs: 1000, objectivesCompleted: 1, objectivesTotal: 1 }),
    telemetry.missionCompleted(ctx(E2), { missionId: M, withoutHints: true, durationMs: 1000, objectivesCompleted: 1, objectivesTotal: 1 }),
    telemetry.speakingTime(ctx(null), { seconds: 5, context: 'drill' }),
  ];
}

describe('aggregateDailyLearningCounters', () => {
  it('folds events into per-enrollment day rows matching the DB table and reports skips', async () => {
    const { rows, skipped } = await aggregateDailyLearningCounters(batch(), resolve);
    expect(skipped).toEqual({ noEnrollment: 1, unknownEnrollment: 1 });
    expect(rows).toHaveLength(2);
    const day = rows.find((r) => r.metric_date === '2026-10-14')!;
    expect(day).toEqual({
      user_id: U1,
      enrollment_id: E1,
      metric_date: '2026-10-14',
      minutes_active: 3,
      speaking_seconds: 45,
      missions_completed: 2,
      missions_completed_without_hints: 1,
      reviews_due: 3,
      reviews_completed: 3,
      review_recall_pct: 66.7,
      conversation_turns: 12,
      xp_earned: 0,
    });
    expect(rows.find((r) => r.metric_date === '2026-10-15')).toMatchObject({ missions_completed: 1, review_recall_pct: null, minutes_active: 0 });
    // Compile-time: rows are valid inserts for the generated table type.
    const insert: Insert<'daily_learning_metrics'> = day;
    expect(DailyLearningCounterRowSchema.parse(insert)).toEqual(day);
  });

  it('resolves user ids asynchronously and once per enrollment', async () => {
    const lookup = vi.fn(async (id: string) => resolve(id));
    await aggregateDailyLearningCounters(batch(), lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('merges counters and re-derives the recall rate', () => {
    const a: DailyLearningCounterRow = { user_id: U1, enrollment_id: E1, metric_date: '2026-10-14', minutes_active: 1, speaking_seconds: 10, missions_completed: 1, missions_completed_without_hints: 0, reviews_due: 2, reviews_completed: 2, review_recall_pct: 50, conversation_turns: 1, xp_earned: 5 };
    const b: DailyLearningCounterRow = { ...a, minutes_active: 2, reviews_due: 2, reviews_completed: 2, review_recall_pct: 100, xp_earned: 0 };
    const merged = mergeDailyLearningCounters(a, b);
    expect(merged).toMatchObject({ minutes_active: 3, speaking_seconds: 20, missions_completed: 2, reviews_completed: 4, review_recall_pct: 75, conversation_turns: 2, xp_earned: 5 });
    expect(() => mergeDailyLearningCounters(a, { ...b, metric_date: '2026-10-15' })).toThrow(/different/);
  });
});

function fakeClient(existing: Record<string, unknown>[] = []) {
  const calls: Array<{ table: string; op: 'insert' | 'upsert' | 'select'; rows?: readonly Record<string, unknown>[]; options?: unknown; filters?: Array<[string, readonly string[]]> }> = [];
  let fail: string | null = null;
  const client: SupabaseLikeClient = {
    from: (table) => ({
      insert: async (rows) => (calls.push({ table, op: 'insert', rows }), { error: fail === table ? { message: 'db down' } : null }),
      upsert: async (rows, options) => (calls.push({ table, op: 'upsert', rows, options }), { error: fail === table ? { message: 'db down' } : null }),
      select: () => {
        const filters: Array<[string, readonly string[]]> = [];
        calls.push({ table, op: 'select', filters });
        const q: SupabaseLikeSelect = {
          in: (col, values) => (filters.push([col, values]), q),
          then: (onOk, onErr) => Promise.resolve({ data: existing, error: null }).then(onOk, onErr),
        };
        return q;
      },
    }),
  };
  return { client, calls, setFail: (t: string | null) => (fail = t) };
}

describe('SupabaseTableSink per_enrollment shape', () => {
  it('validates its configuration honestly', () => {
    const { client } = fakeClient();
    expect(() => new SupabaseTableSink(client, { dailyMetricsShape: 'per_enrollment', privacyCeiling: 'personal' })).toThrow(/userIdForEnrollment/);
    expect(() => new SupabaseTableSink(client, { dailyMetricsShape: 'per_enrollment', userIdForEnrollment: resolve })).toThrow(/personal/);
    expect(() => new SupabaseTableSink(client, { dailyMetricsMode: 'read_add_upsert' })).toThrow(/per_enrollment/);
  });

  it('upserts real-shape rows on the enrollment/day key and reports skips', async () => {
    const { client, calls } = fakeClient();
    const onSkipped = vi.fn();
    const sink = new SupabaseTableSink(client, { dailyMetricsShape: 'per_enrollment', privacyCeiling: 'personal', userIdForEnrollment: resolve, onSkipped });
    await sink.write(batch());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: 'daily_learning_metrics', op: 'upsert', options: { onConflict: DAILY_LEARNING_COUNTERS_CONFLICT_KEY } });
    expect(calls[0]!.rows).toHaveLength(2);
    expect(calls[0]!.rows![0]).toMatchObject({ user_id: U1, enrollment_id: E1 });
    expect(onSkipped).toHaveBeenCalledWith({ noEnrollment: 1, unknownEnrollment: 1 });
    await sink.write([telemetry.screenView(c1, { screen: 'home', rtl: false, scriptMode: null })]);
    expect(calls).toHaveLength(1);
  });

  it('read_add_upsert adds the batch onto the stored counters', async () => {
    const stored = { user_id: U1, enrollment_id: E1, metric_date: '2026-10-14', minutes_active: 10, speaking_seconds: 5, missions_completed: 1, missions_completed_without_hints: 1, reviews_due: 1, reviews_completed: 1, review_recall_pct: 0, conversation_turns: 0, xp_earned: 40, id: 'x', created_at: 'c', updated_at: 'u' };
    const { client, calls } = fakeClient([stored]);
    const sink = new SupabaseTableSink(client, { dailyMetricsShape: 'per_enrollment', dailyMetricsMode: 'read_add_upsert', privacyCeiling: 'personal', userIdForEnrollment: resolve });
    await sink.write(batch());
    expect(calls.map((c) => c.op)).toEqual(['select', 'upsert']);
    expect(calls[0]!.filters).toEqual([
      ['enrollment_id', [E1]],
      ['metric_date', ['2026-10-14', '2026-10-15']],
    ]);
    const day = calls[1]!.rows!.find((r) => r.metric_date === '2026-10-14')!;
    expect(day).toMatchObject({ minutes_active: 13, speaking_seconds: 50, missions_completed: 3, reviews_completed: 4, review_recall_pct: 50, conversation_turns: 12, xp_earned: 40 });
    expect(calls[1]!.rows!.find((r) => r.metric_date === '2026-10-15')).toMatchObject({ missions_completed: 1 });
  });

  it('read_add_upsert needs select() and surfaces db errors', async () => {
    const noSelect: SupabaseLikeClient = { from: () => ({ insert: async () => ({ error: null }), upsert: async () => ({ error: null }) }) };
    const sink = new SupabaseTableSink(noSelect, { dailyMetricsShape: 'per_enrollment', dailyMetricsMode: 'read_add_upsert', privacyCeiling: 'personal', userIdForEnrollment: resolve });
    await expect(sink.write(batch())).rejects.toThrow(/select/);
    const { client, setFail } = fakeClient();
    setFail('daily_learning_metrics');
    const failing = new SupabaseTableSink(client, { dailyMetricsShape: 'per_enrollment', dailyMetricsMode: 'insert', privacyCeiling: 'personal', userIdForEnrollment: resolve });
    await expect(failing.write(batch())).rejects.toThrow('db down');
  });

  it('delivers operator alerts to a table only when configured', async () => {
    const alert = createOperatorAlert({ category: 'provider_outage', severity: 'critical', series: 'provider:openrouter', message: 'OpenRouter 5xx for 10 minutes', detectedAt: '2026-10-14T09:00:00.000Z' });
    const off = fakeClient();
    const disabled = new SupabaseTableSink(off.client);
    expect(disabled.alertsEnabled).toBe(false);
    await disabled.deliver(alert);
    expect(off.calls).toHaveLength(0);
    const on = fakeClient();
    const sink = new SupabaseTableSink(on.client, { tables: { operatorAlerts: 'operator_alerts' } });
    expect(sink.alertsEnabled).toBe(true);
    await sink.deliver(alert);
    expect(on.calls[0]).toMatchObject({ table: 'operator_alerts', op: 'insert' });
    expect(on.calls[0]!.rows![0]).toMatchObject({ kind: 'operator_alert', category: 'provider_outage', severity: 'critical', series: 'provider:openrouter', bucket: '2026-10-14', detected_at: '2026-10-14T09:00:00.000Z' });
    on.setFail('operator_alerts');
    await expect(sink.deliver(alert)).rejects.toThrow('db down');
  });
});

describe('operator alert kind', () => {
  it('createOperatorAlert builds schema-valid non-cost alerts and maps analytics kinds', () => {
    const alert = createOperatorAlert({ category: 'attack', severity: 'warning', series: 'api:auth_bruteforce', message: '500 failed logins / 5 min from one ASN', detectedAt: '2026-10-14T09:00:00.000Z' });
    expect(alert).toMatchObject({ kind: 'operator_alert', audience: 'operators', learnerFacing: false, category: 'attack', bucket: '2026-10-14', observedUsd: 0, ratio: 0 });
    expect(OperatorAlertSchema.parse(alert)).toEqual(alert);
    expect(toAnalyticsAlert(alert)).toEqual({ kind: 'attack', since: '2026-10-14T09:00:00.000Z', detail: alert.message });
    expect(toAnalyticsAlert(createOperatorAlert({ category: 'rights_expiry', severity: 'warning', series: 'rights:asset:1', message: 'expires in 7 days' })).kind).toBe('rights_expiry');
    expect(toAnalyticsAlert(createOperatorAlert({ category: 'provider_outage', severity: 'critical', series: 'p', message: 'm' })).kind).toBe('provider_outage');
    expect(createOperatorAlert({ category: 'cost_anomaly', severity: 'warning', series: 's', message: 'm', observedUsd: 3, baselineMeanUsd: 0 }).ratio).toBe(Number.POSITIVE_INFINITY);
    expect(AnalyticsErrorsResponseSchema.shape.alerts.parse([toAnalyticsAlert(alert)])).toHaveLength(1);
  });

  it('detector alerts carry the cost_anomaly category, validate, and legacy alerts still map to runaway_cost', () => {
    const detector = new CostAnomalyDetector({ minBaselinePoints: 2, now: () => '2026-10-14T09:00:00.000Z' });
    detector.observe('ai_cost:total', '2026-10-11', 1);
    detector.observe('ai_cost:total', '2026-10-12', 1);
    detector.observe('ai_cost:total', '2026-10-13', 1);
    const alert = detector.observe('ai_cost:total', '2026-10-14', 40);
    expect(alert).not.toBeNull();
    expect(alert!.category).toBe('cost_anomaly');
    expect(OperatorAlertSchema.parse(alert)).toEqual(alert);
    const legacy: OperatorAlert = { kind: 'operator_alert', audience: 'operators', learnerFacing: false, severity: 'warning', series: 's', bucket: 'b', observedUsd: 1, baselineMeanUsd: 0, baselineStdUsd: 0, baselinePoints: 0, ratio: Number.POSITIVE_INFINITY, thresholdUsd: 1, detectedAt: '2026-10-14T00:00:00.000Z', message: 'm' };
    expect(toAnalyticsAlert(legacy).kind).toBe('runaway_cost');
    expect(OperatorAlertSchema.safeParse({ ...legacy, audience: 'learners' }).success).toBe(false);
  });
});

describe('EmailAlertSink + Resend transport', () => {
  const alert = createOperatorAlert({ category: 'cost_anomaly', severity: 'critical', series: 'ai_cost:total', message: 'spend <b>spiked</b>', detectedAt: '2026-10-14T09:00:00.000Z', observedUsd: 12, baselineMeanUsd: 2, thresholdUsd: 8 });

  it('formats a plain-text body with escaped html and sends through the transport', async () => {
    const body = formatAlertEmail(alert);
    expect(body.subject).toBe('[LangQuest ops] CRITICAL cost_anomaly: ai_cost:total (2026-10-14)');
    expect(body.text).toContain('Observed: 12.0000 USD');
    expect(body.text).toContain('learners are never limited');
    expect(body.html).toContain('&lt;b&gt;spiked&lt;/b&gt;');
    const transport = createMemoryAlertTransport();
    const sink = new EmailAlertSink({ transport, to: ['ops@example.test'], from: 'alerts@example.test', subjectPrefix: '[ops]', minSeverity: 'critical' });
    expect(sink.enabled).toBe(true);
    await sink.deliver(alert);
    await sink.deliver({ ...alert, severity: 'warning' });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ from: 'alerts@example.test', to: ['ops@example.test'], subject: '[ops] CRITICAL cost_anomaly: ai_cost:total (2026-10-14)', idempotencyKey: 'ai_cost:total|2026-10-14|critical' });
  });

  it('is a no-op without recipients, sender or a configured transport', async () => {
    const transport = createMemoryAlertTransport();
    const noTo = new EmailAlertSink({ transport, from: 'a@b.test' });
    const noFrom = new EmailAlertSink({ transport, to: ['x@y.test'] });
    const fetchMock = vi.fn();
    const noKey = new EmailAlertSink({ transport: createResendAlertTransport({ fetch: fetchMock as unknown as typeof fetch }), to: ['x@y.test'], from: 'a@b.test' });
    for (const s of [noTo, noFrom, noKey]) {
      expect(s.enabled).toBe(false);
      await s.deliver(alert);
    }
    expect(transport.sent).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await createResendAlertTransport({ fetch: fetchMock as unknown as typeof fetch }).send(noTo.toMessage(alert));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to Resend with bearer auth and an idempotency key, and surfaces HTTP failures', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    const transport = createResendAlertTransport({ apiKey: 're_test_key', baseUrl: 'https://api.resend.test/', fetch: fetchMock as unknown as typeof fetch });
    const sink = new EmailAlertSink({ transport, to: ['ops@example.test'], from: 'alerts@example.test' });
    await sink.deliver(alert);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('https://api.resend.test/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test_key');
    expect(headers['idempotency-key']).toBe('ai_cost:total|2026-10-14|critical');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: 'alerts@example.test', to: ['ops@example.test'], subject: expect.stringContaining('CRITICAL') });
    expect(body.html).toContain('<pre');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 });
    await expect(sink.deliver(alert)).rejects.toThrow('HTTP 422');
    const noFetch = createResendAlertTransport({ apiKey: 'k', fetch: undefined });
    expect(noFetch.enabled).toBe(true);
  });
});
