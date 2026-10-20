import 'server-only';
/**
 * Server-side setup status: observes `/healthz` and `/v1/courses` (both public) and the public env, then
 * derives the checklist + deployment capabilities (`derive.ts`).
 * Cached per process for a short TTL so the studio layout can read it on every navigation without
 * hammering the API; the cache holds deployment-level facts only (no user data).
 */
import { z } from 'zod';
import { CoursesResponseSchema } from '@langquest/contracts';
import { publicEnv } from '@/src/lib/env';
import { deriveSetup, type MediaMode, type SetupSignals, type SetupStatus } from './derive';

const TTL_MS = 30_000;
const TIMEOUT_MS = 4_000;

const HealthSchema = z.object({ ok: z.literal(true), data: z.object({ status: z.string(), media: z.enum(['none', 's3', 'binding', 's3+binding']) }) });
const CoursesEnvelope = z.object({ ok: z.literal(true), data: CoursesResponseSchema });

let cache: { at: number; promise: Promise<SetupStatus> } | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function observe(): Promise<SetupStatus> {
  const env = publicEnv();
  const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/+$/, '');
  const [healthRaw, coursesRaw] = await Promise.all([fetchJson(`${base}/healthz`), fetchJson(`${base}/v1/courses`)]);
  const health = HealthSchema.safeParse(healthRaw);
  const courses = CoursesEnvelope.safeParse(coursesRaw);
  const signals: SetupSignals = {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    health: health.success ? { mediaMode: health.data.data.media as MediaMode } : null,
    tracks: courses.success ? courses.data.data.courses.map((c) => c.capabilities) : null,
  };
  return deriveSetup(signals);
}

/** Current setup status (cached ~30 s per server process). Never throws: an unreachable API is a `missing` item. */
export function loadSetupStatus(options: { fresh?: boolean } = {}): Promise<SetupStatus> {
  const now = Date.now();
  if (!options.fresh && cache && now - cache.at < TTL_MS) return cache.promise;
  const promise = observe().catch(() =>
    deriveSetup({ supabaseUrl: safeUrl('NEXT_PUBLIC_SUPABASE_URL'), apiBaseUrl: safeUrl('NEXT_PUBLIC_API_BASE_URL'), health: null, tracks: null }),
  );
  cache = { at: now, promise };
  return promise;
}

function safeUrl(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_API_BASE_URL'): string {
  try {
    return publicEnv()[name];
  } catch {
    return '';
  }
}
