/**
 * In-process API harness: builds the Hono app from `apps/api/src/app.ts` with env taken from the local stack and
 * drives it with `app.request()` — no network hop, no wrangler. Background work (`waitUntil`) is collected so tests
 * can `flush()` audit/telemetry writes before asserting on them.
 */
import { createServiceClient, type DbClient } from '@langquest/db/client';
import { guardFetch, installNetworkGuard } from '@langquest/db/__tests__/network-guard';
import { createApp, type AppContext, type AppOptions } from '../../../apps/api/src/app';
import type { Env } from '../../../apps/api/src/env';
import { getStack, type TestStack } from './stack';

export type { AppContext } from '../../../apps/api/src/app';
export type { Env } from '../../../apps/api/src/env';

export interface ApiHarness {
  app: AppContext;
  /** Service-role client (bypasses RLS) for seeding and verification only — never handed to a route. */
  service: DbClient;
  env: Env;
  stack: TestStack;
  /** Lines the app logged (JSON); handy when a test fails. */
  logs: string[];
  /** Auth users created through `createTestUser` on this harness; `teardown` purges them all. */
  users: string[];
}

/** Secret shared by every harness app so HMAC media tokens can be forged/verified in tests. */
export const TEST_TICKET_SECRET = 'tests-ticket-secret-with-at-least-32-characters';

/**
 * Build an app bound to the local stack. Extra env (e.g. OPENROUTER_API_KEY for live tests) can be layered. The app's
 * own fetch is the network-guarded one (non-local hosts are refused) unless `overrides.fetch` supplies a fake.
 */
export function createApiHarness(extra: Partial<Env> = {}, overrides: Partial<AppOptions> = {}): ApiHarness {
  const stack = getStack();
  if (!stack) throw new Error('local Supabase stack not reachable (guard the suite with describeWithStack)');
  installNetworkGuard({ allow: [stack.url] });
  const env: Env = {
    SUPABASE_URL: stack.url,
    SUPABASE_ANON_KEY: stack.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey,
    SUPABASE_JWT_SECRET: stack.jwtSecret ?? undefined,
    AI_SESSION_TICKET_SECRET: TEST_TICKET_SECRET,
    CORS_ALLOWED_ORIGINS: 'http://localhost:8081',
    API_ENV: 'development',
    LOG_LEVEL: 'error',
    ...extra,
  };
  const logs: string[] = [];
  const app = createApp({ env, logSink: (line) => logs.push(line), fetch: guardFetch(globalThis.fetch), ...overrides });
  const service = createServiceClient({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY });
  return { app, service, env, stack, logs, users: [] };
}

export interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface CallResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are inspected ad hoc in tests
  json: any;
  text: string;
  headers: Headers;
}

/** Issue one request against the in-process app. JSON bodies are encoded; the envelope is parsed when present. */
export async function call(h: Pick<ApiHarness, 'app'>, path: string, opts: CallOptions = {}): Promise<CallResult> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await h.app.app.request(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Build a sync request body for `POST /v1/me/progress/sync` from one or more payloads. */
export function syncBody(deviceId: string, events: Array<{ enrollmentId: string | null; revision: number; payload: unknown; clientEventId?: string; occurredAt?: string }>) {
  const now = new Date().toISOString();
  return {
    deviceId,
    clientSentAt: now,
    events: events.map((e) => ({ clientEventId: e.clientEventId ?? crypto.randomUUID(), enrollmentId: e.enrollmentId, deviceId, revision: e.revision, occurredAt: e.occurredAt ?? now, payload: e.payload })),
  };
}
