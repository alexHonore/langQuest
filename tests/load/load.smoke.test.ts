/**
 * Smoke test of the load script's pure helpers (option parsing, percentiles, report shape). The actual load run
 * (`pnpm --filter @langquest/tests load`) hits a running `wrangler dev` and is documented in load/README.md; it is
 * intentionally not part of any test project.
 */
import { describe, expect, it } from 'vitest';
import { buildReport, DEFAULTS, parseOptions, percentile, summarise, syncPayload, type Sample } from './lib';

describe('load script helpers', () => {
  it('parses knobs from env and argv (argv wins), clamping to sane ranges', () => {
    const fromEnv = parseOptions({ LOAD_BASE_URL: 'http://localhost:8787/', LOAD_CONCURRENCY: '32', LOAD_DURATION_S: '5', LOAD_TOKEN: 't', LOAD_SYNC_SHARE: '0.5' });
    expect(fromEnv).toMatchObject({ baseUrl: 'http://localhost:8787', concurrency: 32, durationSeconds: 5, token: 't', syncShare: 0.5 });
    const fromArgv = parseOptions({ LOAD_CONCURRENCY: '32' }, ['--concurrency=4', '--track=japanese', '--source=en', '--enrollment=abc']);
    expect(fromArgv).toMatchObject({ concurrency: 4, trackId: 'japanese', source: 'en', enrollmentId: 'abc' });
    expect(parseOptions({ LOAD_CONCURRENCY: '99999' }).concurrency).toBe(512);
    expect(parseOptions({ LOAD_SYNC_SHARE: '7' }).syncShare).toBe(1);
    expect(parseOptions({})).toEqual(DEFAULTS);
    expect(() => parseOptions({ LOAD_CONCURRENCY: 'many' })).toThrow();
  });

  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 99)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([10, 1, 5], 50)).toBe(5);
  });

  it('summarises per route with statuses, cache hits and error rates, and the report carries the capacity caveat', () => {
    const samples: Sample[] = [
      { route: 'manifest', status: 200, latencyMs: 12, cache: 'MISS', error: null },
      { route: 'manifest', status: 304, latencyMs: 4, cache: 'HIT', error: null },
      { route: 'manifest', status: 200, latencyMs: 8, cache: 'HIT', error: null },
      { route: 'sync', status: 200, latencyMs: 40, cache: null, error: null },
      { route: 'sync', status: 0, latencyMs: 1000, cache: null, error: 'ECONNREFUSED' },
    ];
    const routes = summarise(samples, 10);
    const manifest = routes.find((r) => r.route === 'manifest')!;
    expect(manifest).toMatchObject({ count: 3, errors: 0, cacheHits: 2, statuses: { '200': 2, '304': 1 }, max: 12, rps: 0.3 });
    expect(manifest.p50).toBe(8);
    const sync = routes.find((r) => r.route === 'sync')!;
    expect(sync).toMatchObject({ count: 2, errors: 1, p50: 40 });
    const report = buildReport({ ...DEFAULTS, token: 'secret' }, samples, new Date('2026-10-15T00:00:00Z'), 10);
    expect(report.options).not.toHaveProperty('token');
    expect(report.options.tokenPresent).toBe(true);
    expect(report.totalRequests).toBe(5);
    expect(report.caveat).toMatch(/do not establish production capacity/);
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('builds a valid, idempotent-by-construction sync payload', () => {
    const body = syncPayload('11111111-1111-4111-8111-111111111111', 'dev', 3) as { events: Array<{ clientEventId: string; revision: number; payload: { type: string } }> };
    expect(body.events.map((e) => e.payload.type)).toEqual(['enrollment_opened', 'activity_minutes']);
    expect(body.events.map((e) => e.revision)).toEqual([3, 4]);
    expect(new Set(body.events.map((e) => e.clientEventId)).size).toBe(2);
  });
});
