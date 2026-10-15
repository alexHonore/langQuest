import { describe, expect, it } from 'vitest';
import { buildLanguageContext, TelemetryEventSchema } from '@langquest/contracts';
import { categoryOf, createTelemetryContext, createTelemetryEvent, defaultIdGenerator, EVENT_NAMES_BY_CATEGORY, PercentileAccumulator, recallBucket, telemetry, withLanguageContext, withPrivacyLevel } from './events';

const ctx = createTelemetryContext({ platform: 'ios', appVersion: '1.2.3', now: () => '2026-10-14T12:00:00.000Z', newId: () => '0d8c1b48-5c7e-4d7a-9c2a-0f6a1e3b4c5d' });
const MISSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';

describe('context', () => {
  it('defaults to anonymous with null identifiers', () => {
    expect(ctx.privacyLevel).toBe('anonymous');
    expect(ctx.userHash).toBeNull();
    expect(ctx.enrollmentId).toBeNull();
  });
  it('binds the enrollment language context (own source language, not a profile default)', () => {
    const lc = buildLanguageContext({ uiLocale: 'fr-CA', enrollmentId: MISSION, sourceLanguageCode: 'fr', courseTrackId: 'arabic-moroccan' });
    const bound = withLanguageContext(ctx, lc);
    expect(bound.enrollmentId).toBe(MISSION);
    expect(bound.trackId).toBe('arabic-moroccan');
    expect(bound.targetVarietyId).toBe('ary');
    expect(bound.sourceLanguageCode).toBe('fr');
    expect(withPrivacyLevel(bound, 'pseudonymous').privacyLevel).toBe('pseudonymous');
  });
  it('generates RFC 4122 v4 ids', () => {
    expect(defaultIdGenerator()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('constructors', () => {
  it('stamps base fields, category and validates', () => {
    const e = telemetry.missionCompleted(ctx, { missionId: MISSION, withoutHints: true, durationMs: 480_000, objectivesCompleted: 3, objectivesTotal: 3 });
    expect(e.name).toBe('mission_completed');
    expect(e.category).toBe('learning_outcome');
    expect(e.eventId).toBe('0d8c1b48-5c7e-4d7a-9c2a-0f6a1e3b4c5d');
    expect(e.occurredAt).toBe('2026-10-14T12:00:00.000Z');
    expect(e.platform).toBe('ios');
    expect(TelemetryEventSchema.safeParse(e).success).toBe(true);
  });
  it('rejects invalid props at the call site', () => {
    expect(() => telemetry.missionCompleted(ctx, { missionId: 'not-a-uuid', withoutHints: true, durationMs: 1, objectivesCompleted: 0, objectivesTotal: 0 })).toThrow();
    expect(() => telemetry.appStart(ctx, { coldStartMs: -1, lowEndDevice: false })).toThrow();
  });
  it('redacts free text in props automatically', () => {
    const crash = telemetry.clientCrash(ctx, { fingerprint: 'NPE while mailing jane@example.com', fatal: true, screen: 'x'.repeat(200) });
    expect(crash.props.fingerprint).toBe('NPE while mailing [email]');
    expect(crash.props.screen).toMatch(/^hash:[0-9a-f]{16}$/);
    const err = telemetry.apiError(ctx, { route: '/v1/me', code: 'unauthorized', status: 401, traceId: 'Bearer abcdefghijklmnopqrstuvwxyz' });
    expect(err.props.traceId).toBe('[secret]');
  });
  it('honours per-event overrides', () => {
    const e = telemetry.screenView(ctx, { screen: 'home', rtl: false, scriptMode: null }, { privacyLevel: 'pseudonymous', occurredAt: '2026-01-01T00:00:00.000Z', userHash: 'u_x' });
    expect(e.privacyLevel).toBe('pseudonymous');
    expect(e.occurredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(e.userHash).toBe('u_x');
  });
  it('covers every event name with the right category', () => {
    const all = Object.values(EVENT_NAMES_BY_CATEGORY).flat();
    expect(all).toHaveLength(24);
    expect(new Set(all).size).toBe(24);
    for (const [cat, names] of Object.entries(EVENT_NAMES_BY_CATEGORY)) for (const n of names) expect(categoryOf(n)).toBe(cat);
    expect(Object.keys(telemetry)).toHaveLength(24);
  });
  it('builds learning-outcome KPIs: false-correction flags, transfer, recall horizons', () => {
    const p = telemetry.pronunciationFeedback(ctx, { assessmentMode: 'reference-comparison', intelligibility: 'understood', numericScorePresent: false, learnerFlaggedFalseCorrection: true });
    expect(p.props.learnerFlaggedFalseCorrection).toBe(true);
    const t = createTelemetryEvent(ctx, 'transfer_success', { skillKey: 'order_coffee', unseenScenario: true, success: true });
    expect(t.category).toBe('learning_outcome');
    expect(recallBucket(7)).toBe('7d');
    expect(recallBucket(8)).toBe('7d');
    expect(recallBucket(30)).toBe('30d');
    expect(recallBucket(25)).toBe('30d');
    expect(recallBucket(15)).toBe('other');
    expect(recallBucket(1)).toBe('other');
  });
});

describe('PercentileAccumulator', () => {
  it('computes nearest-rank percentiles and ingests performance events', () => {
    const acc = new PercentileAccumulator();
    for (let i = 1; i <= 100; i++) acc.add('media_seek_ms', i);
    const s = acc.summary('media_seek_ms')!;
    expect(s).toMatchObject({ count: 100, min: 1, max: 100, p50: 50, p95: 95, p99: 99 });
    expect(s.mean).toBeCloseTo(50.5);
    acc.addEvent(telemetry.appStart(ctx, { coldStartMs: 1200, lowEndDevice: true }));
    acc.addEvent(telemetry.mediaStart(ctx, { timeToFirstFrameMs: 300, cacheHit: false, assetBytes: null }));
    acc.addEvent(telemetry.aiLatency(ctx, { task: 'realtime_conversation', timeToFirstAudioMs: 650, totalMs: 2000, interruptionLatencyMs: 180, fallbackUsed: false }));
    expect(acc.summary('cold_start_ms')?.p99).toBe(1200);
    expect(acc.summary('time_to_first_frame_ms')?.p50).toBe(300);
    expect(acc.summary('time_to_first_audio_ms')?.max).toBe(650);
    expect(acc.summary('interruption_latency_ms')?.min).toBe(180);
    expect(acc.summary('ai_total_ms')?.count).toBe(1);
    expect(acc.summary('nothing')).toBeNull();
    acc.add('x', Number.NaN);
    acc.add('x', -5);
    expect(acc.summary('x')).toBeNull();
  });
  it('is bounded by capacity', () => {
    const acc = new PercentileAccumulator(3);
    for (const v of [1, 2, 3, 4, 5]) acc.add('m', v);
    expect(acc.summary('m')).toMatchObject({ count: 3, min: 3, max: 5 });
    acc.reset('m');
    expect(acc.metrics()).toEqual([]);
    expect(() => new PercentileAccumulator(0)).toThrow();
  });
});
