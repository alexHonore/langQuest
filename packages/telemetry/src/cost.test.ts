import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiRequestsTable, ModelProfileSchema, type ModelProfile } from '@langquest/contracts';
import { AI_COST_TOTAL_SERIES, aiCostTaskSeries, CostAnomalyDetector, CostLedger, createProfileBudgetDetectors, dayBucket, DEFAULT_R2_PRICING, estimateR2Cost, PricingSnapshotSchema, PricingTable, profileDailyBudgets, r2OperationClass, roundUsd, type OperatorAlert } from './cost';
import type { AlertSink } from './sinks';

const SNAPSHOT_PATH = resolve(__dirname, '../../../docs/provider-matrix/openrouter-models-snapshot-2026-10-14.json');
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as unknown;
const pricing = PricingTable.fromSnapshot(snapshot, { snapshotAt: '2026-10-14T00:00:00.000Z' });

const T = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const S1 = '33333333-3333-4333-8333-333333333333';
const L1 = '44444444-4444-4444-8444-444444444444';

describe('PricingTable', () => {
  it('parses the repo snapshot shape and prices chat/transcription/speech models', () => {
    expect(PricingSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(pricing.size).toBeGreaterThan(200);
    expect(pricing.snapshotAt).toBe('2026-10-14T00:00:00.000Z');
    const haiku = pricing.get('anthropic/claude-haiku-5.5')!;
    expect(haiku).toMatchObject({ category: 'chat', inputUnit: 'token', outputUnit: 'token', inputUsdPerUnit: 1e-7, outputUsdPerUnit: 5e-7 });
    const chat = pricing.estimate({ model: 'anthropic/claude-haiku-5.5', inputTokens: 1_000_000, outputTokens: 100_000 });
    expect(chat.priced).toBe(true);
    expect(chat.usd).toBeCloseTo(0.1 + 0.05, 6);
    const stt = pricing.estimate({ model: 'assemblyai/universal-3-6-pro', audioSeconds: 3600 });
    expect(stt.inputUnit).toBe('audio_second');
    expect(stt.usd).toBeCloseTo(0.3, 3);
    const tts = pricing.estimate({ model: 'heygen/heygen-voice-1', characters: 1_000_000 });
    expect(tts.inputUnit).toBe('character');
    expect(tts.usd).toBeCloseTo(15, 6);
  });
  it('reports unknown models as unpriced rather than free', () => {
    const e = pricing.estimate({ model: 'nobody/unknown', inputTokens: 10 });
    expect(e).toMatchObject({ priced: false, usd: 0, inputUnit: null });
  });
  it('refreshes atomically and keeps old prices on invalid input', () => {
    const t = new PricingTable({ chat_candidates: [{ id: 'x/one', prompt: '0.000001', completion: '0.000002' }] });
    expect(t.estimate({ model: 'x/one', inputTokens: 1000, outputTokens: 1000 }).usd).toBeCloseTo(0.003, 9);
    expect(() => t.refresh({ chat_candidates: [{ id: 'x/one', prompt: 'abc', completion: '0' }] })).toThrow();
    expect(t.has('x/one')).toBe(true);
    t.refresh({ chat_candidates: [{ id: 'x/one', prompt: 0.000002, completion: 0.000002 }] }, '2026-11-01T00:00:00.000Z');
    expect(t.estimate({ model: 'x/one', inputTokens: 1000, outputTokens: 1000 }).usd).toBeCloseTo(0.004, 9);
    expect(t.snapshotAt).toBe('2026-11-01T00:00:00.000Z');
    expect(t.list('chat')).toHaveLength(1);
  });
  it('supports per-model unit overrides', () => {
    const t = new PricingTable({ transcription: [{ id: 'p/stt', pricing: { prompt: '0.001', completion: '0' } }] }, { unitOverrides: { 'p/stt': { input: 'token' } } });
    expect(t.get('p/stt')?.inputUnit).toBe('token');
    expect(t.estimate({ model: 'p/stt', inputTokens: 10, audioSeconds: 999 }).usd).toBeCloseTo(0.01, 9);
  });
});

describe('R2 pricing', () => {
  it('classifies operations and prices usage with the free tier', () => {
    expect(r2OperationClass('get')).toBe('B');
    expect(r2OperationClass('put')).toBe('A');
    expect(r2OperationClass('multipart')).toBe('A');
    expect(r2OperationClass('delete')).toBe('free');
    const e = estimateR2Cost({ classAOps: 2_000_000, classBOps: 20_000_000, storageGbMonths: 1010, egressGb: 500 });
    expect(e.classAUsd).toBeCloseTo(9, 6);
    expect(e.classBUsd).toBeCloseTo(7.2, 6);
    expect(e.storageUsd).toBeCloseTo(15.15, 6);
    expect(e.egressUsd).toBe(0);
    const f = estimateR2Cost({ classAOps: 2_000_000, classBOps: 20_000_000, storageGbMonths: 1010, applyFreeTier: true });
    expect(f.classAUsd).toBeCloseTo(4.5, 6);
    expect(f.classBUsd).toBeCloseTo(3.6, 6);
    expect(f.storageUsd).toBeCloseTo(15, 6);
    expect(DEFAULT_R2_PRICING.source).toContain('cloudflare.com');
  });
});

describe('CostLedger', () => {
  function ledger() {
    let i = 0;
    return new CostLedger(pricing, { now: () => '2026-10-14T12:00:00.000Z', newId: () => `id-${++i}` });
  }

  it('records AI requests with a valid ai_requests insert row', () => {
    const l = ledger();
    const { entry, estimate, insert } = l.recordAiRequest({ traceId: 'tr-1', task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, inputTokens: 2000, outputTokens: 500, userId: T, enrollmentId: T, trackId: 'arabic-moroccan', missionId: M1, conversationSessionId: S1, latencyMs: 900 });
    expect(estimate.priced).toBe(true);
    expect(entry.usd).toBeCloseTo(0.0002 + 0.00025, 9);
    expect(AiRequestsTable.insert.safeParse(insert).success).toBe(true);
    expect(insert.estimated_cost_usd).toBe(entry.usd);
    expect(insert.trace_id).toBe('tr-1');
    expect(insert.created_at).toBe('2026-10-14T12:00:00.000Z');
    const unknown = l.recordAiRequest({ traceId: 'tr-2', task: 'speech_recognition', provider: 'other', model: 'x/unknown', success: false, errorCode: 'timeout', audioSeconds: 10 });
    expect(unknown.insert.estimated_cost_usd).toBeNull();
    expect(l.summary().unpricedCount).toBe(1);
  });

  it('aggregates cost per completed speaking mission, per active learner and per reviewed lesson', () => {
    const l = ledger();
    const chat = (missionId: string, session: string | null, userHash: string, lessonId: string | null = null) =>
      l.recordAiRequest({ traceId: 't', task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, inputTokens: 1_000_000, outputTokens: 0, missionId, conversationSessionId: session, userHash, lessonId, trackId: 'french' });
    chat(M1, S1, 'u_a'); // 0.1
    chat(M1, null, 'u_a'); // 0.1
    chat(M2, null, 'u_b'); // 0.1 (mission not completed)
    l.recordAiRequest({ traceId: 't', task: 'transcription_alignment', provider: 'openrouter', model: 'assemblyai/universal-3-6-pro', success: true, audioSeconds: 3600, lessonId: L1 }); // 0.3
    l.recordStorageOps({ operation: 'put', count: 1_000_000 }); // 4.5
    l.recordStorageOps({ operation: 'get', count: 1_000_000, bytes: 10 }); // 0.36
    l.recordStorageOps({ operation: 'delete', count: 1_000_000 }); // 0
    l.recordJob({ jobId: T, usd: 0.5, cpuMs: 1000, attribution: { lessonId: L1 } });
    l.recordJob({ jobId: T, usd: null });

    const s = l.summary();
    expect(s.totalUsd).toBeCloseTo(0.3 + 0.3 + 4.86 + 0.5, 6);
    expect(s.byKind.ai).toBeCloseTo(0.6, 6);
    expect(s.byKind.storage).toBeCloseTo(4.86, 6);
    expect(s.byKind.job).toBeCloseTo(0.5, 6);
    expect(s.byTask.character_dialogue).toBeCloseTo(0.3, 6);
    expect(s.byTrack.french).toBeCloseTo(0.3, 6);
    expect(s.classAOps).toBe(1_000_000);
    expect(s.classBOps).toBe(1_000_000);
    expect(s.audioSeconds).toBe(3600);
    expect(s.unpricedCount).toBe(1);

    const perMission = l.costPerCompletedSpeakingMission([{ missionId: M1, conversationSessionIds: [S1] }]);
    expect(perMission.numeratorUsd).toBeCloseTo(0.2, 6);
    expect(perMission.perUnitUsd).toBeCloseTo(0.2, 6);
    expect(l.costPerCompletedSpeakingMission([]).perUnitUsd).toBeNull();

    const perLearner = l.costPerActiveLearner(['u_a', 'u_b', 'u_a']);
    expect(perLearner.denominator).toBe(2);
    expect(perLearner.perUnitUsd).toBeCloseTo(s.totalUsd / 2, 6);
    expect(l.costPerActiveLearner(0).perUnitUsd).toBeNull();

    const perLesson = l.costPerReviewedLesson([L1]);
    expect(perLesson.perUnitUsd).toBeCloseTo(0.8, 6);
    expect(l.costPerConversation([S1]).perUnitUsd).toBeCloseTo(0.1, 6);
  });

  it('prunes persisted entries by age', () => {
    const l = new CostLedger(pricing);
    l.recordJob({ jobId: T, usd: 1, occurredAt: '2026-01-01T00:00:00.000Z' });
    l.recordJob({ jobId: T, usd: 1, occurredAt: '2026-10-01T00:00:00.000Z' });
    expect(l.prune('2026-06-01T00:00:00.000Z')).toBe(1);
    expect(l.entries()).toHaveLength(1);
    expect(roundUsd(1 / 3)).toBe(0.333333);
    expect(dayBucket('2026-10-14T23:59:59.000Z')).toBe('2026-10-14');
  });
});

describe('CostAnomalyDetector', () => {
  it('stays silent until the baseline exists, then alerts once per bucket as an operator-only event', () => {
    const d = new CostAnomalyDetector({ windowSize: 7, minBaselinePoints: 3, warningRatio: 2, criticalRatio: 4, sigma: 0, absoluteFloorUsd: 1, now: () => '2026-10-14T12:00:00.000Z' });
    expect(d.observe('ai_cost:total', '2026-10-01', 10)).toBeNull();
    expect(d.observe('ai_cost:total', '2026-10-02', 10)).toBeNull();
    expect(d.observe('ai_cost:total', '2026-10-03', 10)).toBeNull();
    expect(d.observe('ai_cost:total', '2026-10-04', 10)).toBeNull(); // closes 03; baseline = 3 points, mean 10
    expect(d.baseline('ai_cost:total')).toMatchObject({ mean: 10, points: 3 });
    expect(d.observe('ai_cost:total', '2026-10-04', 9)).toBeNull(); // 19 < 20
    const warn = d.observe('ai_cost:total', '2026-10-04', 2)!; // 21 ≥ 20
    expect(warn).toMatchObject({ kind: 'operator_alert', audience: 'operators', learnerFacing: false, severity: 'warning', series: 'ai_cost:total', bucket: '2026-10-04', observedUsd: 21, baselineMeanUsd: 10, baselinePoints: 3, detectedAt: '2026-10-14T12:00:00.000Z' });
    expect(warn.ratio).toBeCloseTo(2.1);
    expect(warn.message).toContain('learners are never limited');
    expect(d.observe('ai_cost:total', '2026-10-04', 100)).toBeNull(); // already alerted for this bucket
    expect(d.current('ai_cost:total')).toEqual({ bucket: '2026-10-04', usd: 121 });
    // next bucket: baseline now mean of (10,10,10,121) = 37.75 → critical at 151
    expect(d.observe('ai_cost:total', '2026-10-05', 50)).toBeNull(); // 50 < 75.5 warning threshold
    const crit = d.observe('ai_cost:total', '2026-10-05', 110)!; // 160 ≥ 151
    expect(crit.severity).toBe('critical');
  });
  it('respects absolute floor, sigma gating and the hard ceiling', () => {
    const d = new CostAnomalyDetector({ minBaselinePoints: 2, absoluteFloorUsd: 5, sigma: 3 });
    d.seed('r2', [{ bucket: 'd1', usd: 0.1 }, { bucket: 'd2', usd: 0.1 }]);
    expect(d.observe('r2', 'd3', 1)).toBeNull(); // below floor despite 10× ratio
    const noisy = new CostAnomalyDetector({ minBaselinePoints: 2, absoluteFloorUsd: 0, sigma: 3 });
    noisy.seed('s', [{ bucket: 'a', usd: 0 }, { bucket: 'b', usd: 20 }]); // mean 10, std 10 → sigma threshold 40
    expect(noisy.observe('s', 'c', 25)).toBeNull(); // 2.5× mean but < mean+3σ
    expect(noisy.observe('s', 'c', 20)?.severity).toBe('critical'); // 45 ≥ max(40, 40)
    const ceiling = new CostAnomalyDetector({ hardCeilingUsd: 100 });
    expect(ceiling.observe('ai', 'day', 99)).toBeNull();
    expect(ceiling.observe('ai', 'day', 1)?.severity).toBe('critical');
    expect(ceiling.observe('ai', 'day', -1)).toBeNull();
    expect(() => new CostAnomalyDetector({ windowSize: 0 })).toThrow();
  });
  it('keeps a rolling window', () => {
    const d = new CostAnomalyDetector({ windowSize: 2, minBaselinePoints: 1, absoluteFloorUsd: 0, sigma: 0 });
    for (const [b, v] of [['1', 100], ['2', 1], ['3', 1], ['4', 1]] as const) d.observe('s', b, v);
    expect(d.baseline('s')).toMatchObject({ mean: 1, points: 2 });
  });
});

describe('model-profile budgets → operator alerts', () => {
  const profile = (task: ModelProfile['task'], dailyBudgetUsd: number | null, enabled = true, idSuffix = '1'): ModelProfile =>
    ModelProfileSchema.parse({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${idSuffix}`,
      task,
      targetVariety: null,
      sourceLanguage: null,
      provider: 'openrouter',
      primaryModel: 'anthropic/claude-haiku-5.5',
      fallbackModels: [],
      params: {},
      latencyClass: 'realtime',
      enabled,
      version: 1,
      benchmarkStatus: 'unbenchmarked',
      dailyBudgetUsd,
      updatedAt: '2026-10-14T00:00:00.000Z',
    });

  it('collapses profile budgets to the tightest ceiling per task and skips null/disabled budgets', () => {
    const budgets = profileDailyBudgets([
      profile('character_dialogue', 10, true, '1'),
      profile('character_dialogue', 25, true, '2'),
      profile('speech_recognition', null, true, '3'),
      profile('speech_synthesis', 3, false, '4'),
    ]);
    expect([...budgets]).toEqual([['character_dialogue', 10]]);
    expect(profileDailyBudgets([profile('speech_synthesis', 3, false)], { includeDisabled: true }).get('speech_synthesis')).toBe(3);
    const detectors = createProfileBudgetDetectors([profile('character_dialogue', 10), profile('speech_recognition', null)], { minBaselinePoints: 1 });
    expect([...detectors.keys()]).toEqual(['character_dialogue']);
    expect(detectors.get('character_dialogue')!.observe('x', 'd', 9.99)).toBeNull();
    expect(detectors.get('character_dialogue')!.observe('x', 'd', 0.01)?.severity).toBe('critical');
  });

  it('CostLedger feeds the task budget detector and raises a critical operator-only alert at the budget', async () => {
    const delivered: OperatorAlert[] = [];
    const sink: AlertSink = { name: 'test', deliver: async (a) => void delivered.push(a) };
    const budgetDetectors = createProfileBudgetDetectors([profile('character_dialogue', 10)], { now: () => '2026-10-14T12:00:00.000Z' });
    const ledger = new CostLedger(pricing, { now: () => '2026-10-14T12:00:00.000Z', budgetDetectors, alertSink: sink });
    // haiku: 1e-7/token input → 50,000,000 tokens = 5 USD per request
    const req = () => ledger.recordAiRequest({ traceId: 't', task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, inputTokens: 50_000_000, outputTokens: 0, userHash: 'u_a', enrollmentId: T, trackId: 'arabic-moroccan' });
    expect(req().alerts).toEqual([]); // 5.0
    expect(ledger.recordAiRequest({ traceId: 't', task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, inputTokens: 49_990_000, outputTokens: 0 }).alerts).toEqual([]); // 9.999
    const { alerts, entry } = ledger.recordAiRequest({ traceId: 't', task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, inputTokens: 5_010_000, outputTokens: 0 }); // 10.5
    expect(entry.usd).toBeCloseTo(0.501, 6);
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert).toMatchObject({ kind: 'operator_alert', audience: 'operators', learnerFacing: false, severity: 'critical', series: aiCostTaskSeries('character_dialogue'), bucket: '2026-10-14', thresholdUsd: 10, detectedAt: '2026-10-14T12:00:00.000Z' });
    expect(alert.observedUsd).toBeCloseTo(10.5, 6);
    expect(alert.message).toContain('hard ceiling of 10 USD');
    expect(alert.message).toContain('learners are never limited');
    // the alert carries no learner attribution
    expect(JSON.stringify(alert)).not.toContain('u_a');
    expect(JSON.stringify(alert)).not.toContain(T);
    await ledger.flushAlerts();
    expect(delivered).toEqual([alert]);
    // once per bucket; other tasks are untouched; the request itself is still recorded (never throttled)
    expect(req().alerts).toEqual([]);
    expect(ledger.recordAiRequest({ traceId: 't', task: 'speech_recognition', provider: 'openrouter', model: 'assemblyai/universal-3-6-pro', success: true, audioSeconds: 360_000 }).alerts).toEqual([]);
    expect(ledger.entries()).toHaveLength(5);
    expect(ledger.budgetDetectors.get('character_dialogue')!.current(aiCostTaskSeries('character_dialogue'))).toEqual({ bucket: '2026-10-14', usd: 15.5 });
    // next day opens a new bucket and alerts again when crossed
    const next = ledger.recordAiRequest({ traceId: 't', task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, inputTokens: 100_000_000, outputTokens: 0, occurredAt: '2026-10-15T01:00:00.000Z' });
    expect(next.alerts[0]).toMatchObject({ severity: 'critical', bucket: '2026-10-15' });
  });

  it('feeds the total series, reports delivery failures and never throws on them', async () => {
    const errors: unknown[] = [];
    const sink: AlertSink = { name: 'broken', deliver: async () => { throw new Error('channel down'); } };
    const totalDetector = new CostAnomalyDetector({ hardCeilingUsd: 1 });
    const ledger = new CostLedger(pricing, { totalDetector, alertSink: sink, onAlertDeliveryError: (e) => errors.push(e), bucket: () => 'all' });
    const { alerts } = ledger.recordAiRequest({ traceId: 't', task: 'learner_evaluation', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, inputTokens: 10_000_000, outputTokens: 0 }); // 1 USD
    expect(alerts.map((a) => a.series)).toEqual([AI_COST_TOTAL_SERIES]);
    await ledger.flushAlerts();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('channel down');
    // unpriced requests still advance the bucket with 0 USD
    expect(ledger.recordAiRequest({ traceId: 't', task: 'learner_evaluation', provider: 'other', model: 'x/unknown', success: true }).alerts).toEqual([]);
    expect(totalDetector.current(AI_COST_TOTAL_SERIES)).toEqual({ bucket: 'all', usd: 1 });
  });
});
