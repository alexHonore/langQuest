/**
 * Pure helpers for the load script (unit-tested in `load.smoke.test.ts`): option parsing from env/argv, latency
 * percentiles and the report shape. Kept free of I/O so the smoke test runs in CI while the actual load run never does.
 */

export interface LoadOptions {
  baseUrl: string;
  token: string | null;
  trackId: string;
  source: string;
  enrollmentId: string | null;
  concurrency: number;
  durationSeconds: number;
  /** Share of requests that are sync POSTs (the rest are manifest GETs). */
  syncShare: number;
  warmupSeconds: number;
}

export const DEFAULTS: LoadOptions = {
  baseUrl: 'http://localhost:8787',
  token: null,
  trackId: 'arabic-moroccan',
  source: 'fr',
  enrollmentId: null,
  concurrency: 8,
  durationSeconds: 20,
  syncShare: 0.3,
  warmupSeconds: 2,
};

const num = (value: string | undefined, fallback: number, { min, max }: { min: number; max: number }): number => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${value}"`);
  return Math.min(max, Math.max(min, n));
};

/** `LOAD_*` env wins over defaults; `--key=value` argv wins over env. */
export function parseOptions(env: Record<string, string | undefined>, argv: readonly string[] = []): LoadOptions {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/i.exec(arg);
    if (m) flags.set(m[1]!.toLowerCase(), m[2]!);
  }
  const pick = (flag: string, envKey: string): string | undefined => flags.get(flag) ?? env[envKey];
  return {
    baseUrl: (pick('base-url', 'LOAD_BASE_URL') ?? DEFAULTS.baseUrl).replace(/\/+$/, ''),
    token: pick('token', 'LOAD_TOKEN') ?? null,
    trackId: pick('track', 'LOAD_TRACK') ?? DEFAULTS.trackId,
    source: pick('source', 'LOAD_SOURCE') ?? DEFAULTS.source,
    enrollmentId: pick('enrollment', 'LOAD_ENROLLMENT_ID') ?? null,
    concurrency: num(pick('concurrency', 'LOAD_CONCURRENCY'), DEFAULTS.concurrency, { min: 1, max: 512 }),
    durationSeconds: num(pick('duration', 'LOAD_DURATION_S'), DEFAULTS.durationSeconds, { min: 1, max: 3600 }),
    syncShare: num(pick('sync-share', 'LOAD_SYNC_SHARE'), DEFAULTS.syncShare, { min: 0, max: 1 }),
    warmupSeconds: num(pick('warmup', 'LOAD_WARMUP_S'), DEFAULTS.warmupSeconds, { min: 0, max: 600 }),
  };
}

export interface Sample {
  route: 'manifest' | 'sync';
  status: number;
  latencyMs: number;
  /** `X-Cache` header when present. */
  cache: string | null;
  error: string | null;
}

export interface RouteReport {
  route: Sample['route'];
  count: number;
  errors: number;
  statuses: Record<string, number>;
  cacheHits: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
  rps: number;
}

export interface LoadReport {
  options: Omit<LoadOptions, 'token'> & { tokenPresent: boolean };
  startedAt: string;
  elapsedSeconds: number;
  totalRequests: number;
  routes: RouteReport[];
  /** Spec §14.3: never assert capacity without evidence; this is the evidence, nothing more. */
  caveat: string;
}

/** Nearest-rank percentile on a sorted copy; null for empty input. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

export function summarise(samples: readonly Sample[], elapsedSeconds: number): RouteReport[] {
  const routes: Sample['route'][] = ['manifest', 'sync'];
  return routes.map((route) => {
    const mine = samples.filter((s) => s.route === route);
    const latencies = mine.filter((s) => s.error === null).map((s) => s.latencyMs);
    const statuses: Record<string, number> = {};
    for (const s of mine) statuses[String(s.status)] = (statuses[String(s.status)] ?? 0) + 1;
    return {
      route,
      count: mine.length,
      errors: mine.filter((s) => s.error !== null || s.status >= 500).length,
      statuses,
      cacheHits: mine.filter((s) => s.cache === 'HIT').length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : null,
      mean: latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)) : null,
      rps: elapsedSeconds > 0 ? Number((mine.length / elapsedSeconds).toFixed(2)) : 0,
    };
  });
}

export function buildReport(options: LoadOptions, samples: readonly Sample[], startedAt: Date, elapsedSeconds: number): LoadReport {
  const { token, ...rest } = options;
  return {
    options: { ...rest, tokenPresent: Boolean(token) },
    startedAt: startedAt.toISOString(),
    elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
    totalRequests: samples.length,
    routes: summarise(samples, elapsedSeconds),
    caveat: 'Latencies measured from this client against the given base URL (wrangler dev or a deployment) with the stated concurrency; they do not establish production capacity.',
  };
}

/** A sync body for one learner device: one `enrollment_opened` + one `activity_minutes` event per request (cheap, idempotent). */
export function syncPayload(enrollmentId: string, deviceId: string, revision: number): unknown {
  const now = new Date().toISOString();
  return {
    deviceId,
    clientSentAt: now,
    events: [
      { clientEventId: crypto.randomUUID(), enrollmentId, deviceId, revision, occurredAt: now, payload: { type: 'enrollment_opened', enrollmentId } },
      { clientEventId: crypto.randomUUID(), enrollmentId, deviceId, revision: revision + 1, occurredAt: now, payload: { type: 'activity_minutes', activityDate: now.slice(0, 10), minutesActive: 1, speakingSeconds: 0 } },
    ],
  };
}
