/**
 * Shared test harness: offline app factory (fake verifier + role resolver) for unit tests, and a local-stack
 * harness (real Supabase via Docker) for integration tests. Integration suites skip with a clear message when
 * the stack is not reachable (CONVENTIONS §7).
 */
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { describe } from 'vitest';
import { detectLocalStack, type LocalStack } from '@langquest/db/local-stack';
import { createServiceClient, type DbClient } from '@langquest/db/client';
import type { Role } from '@langquest/contracts';
import { createApp, type AppContext, type AppOptions } from '../app';
import type { Env } from '../env';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const TEST_JWT_SECRET = 'unit-test-jwt-secret-with-at-least-32-characters';

export const offlineEnv: Env = {
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  AI_SESSION_TICKET_SECRET: 'ticket-secret-with-at-least-32-characters',
  CORS_ALLOWED_ORIGINS: 'https://admin.example.test',
  API_ENV: 'development',
  LOG_LEVEL: 'error',
};

/** App that never touches a database: roles come from `roles`, tokens are HS256 with `TEST_JWT_SECRET`. */
export function offlineApp(roles: Record<string, Role[]> = {}, overrides: Partial<AppOptions> = {}): AppContext {
  const lines: string[] = [];
  return createApp({ env: offlineEnv, logSink: (l) => lines.push(l), roleResolver: async (userId) => roles[userId] ?? [], ...overrides });
}

export async function signTestToken(userId: string, opts: { secret?: string; role?: string; expiresInSeconds?: number; email?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: opts.role ?? 'authenticated', email: opts.email ?? `${userId}@test.local`, aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresInSeconds ?? 3600))
    .sign(new TextEncoder().encode(opts.secret ?? TEST_JWT_SECRET));
}

export interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: response bodies are inspected ad hoc
export async function call(app: AppContext, path: string, opts: CallOptions = {}): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await app.app.request(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

// --- local stack ------------------------------------------------------------------------

export const stack: LocalStack | null = detectLocalStack({ cwd: REPO_ROOT });

/** JWT secret of the local stack (`supabase status -o json` → JWT_SECRET); null when unavailable. */
export function localJwtSecret(): string | null {
  if (process.env.SUPABASE_LOCAL_JWT_SECRET) return process.env.SUPABASE_LOCAL_JWT_SECRET;
  const result = spawnSync('supabase', ['status', '-o', 'json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20_000 });
  if (result.status !== 0 || !result.stdout) return null;
  const start = result.stdout.indexOf('{');
  try {
    return (JSON.parse(result.stdout.slice(start)) as { JWT_SECRET?: string }).JWT_SECRET ?? null;
  } catch {
    return null;
  }
}

export function describeWithStack(suite: string): typeof describe {
  if (stack) return describe;
  const message = `[${suite}] Local Supabase stack not reachable. Run \`pnpm supabase start\` (Docker) or set SUPABASE_LOCAL_URL + SUPABASE_LOCAL_ANON_KEY + SUPABASE_LOCAL_SERVICE_ROLE_KEY.`;
  if (process.env.LANGQUEST_REQUIRE_LOCAL_STACK === '1') throw new Error(message);
  console.warn(`${message} Skipping stack-bound integration tests.`);
  return describe.skip as unknown as typeof describe;
}

export interface StackHarness {
  app: AppContext;
  service: DbClient;
  env: Env;
}

/** App bound to the local stack. Extra env (e.g. OPENROUTER_API_KEY) can be layered for live tests. */
export function stackApp(extra: Partial<Env> = {}, overrides: Partial<AppOptions> = {}): StackHarness {
  if (!stack) throw new Error('local stack not reachable');
  const env: Env = {
    SUPABASE_URL: stack.url,
    SUPABASE_ANON_KEY: stack.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey,
    SUPABASE_JWT_SECRET: localJwtSecret() ?? undefined,
    AI_SESSION_TICKET_SECRET: 'integration-ticket-secret-32-characters-long',
    API_ENV: 'development',
    LOG_LEVEL: 'error',
    ...extra,
  };
  const lines: string[] = [];
  const app = createApp({ env, logSink: (l) => lines.push(l), ...overrides });
  const service = createServiceClient({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY });
  return { app, service, env };
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  /** GoTrue refresh token (for `/v1/auth/session/refresh` tests). */
  refreshToken: string;
}

export async function createStackUser(h: StackHarness, label: string, opts: { role?: Role; defaultSourceLanguageCode?: string; uiLocale?: string } = {}): Promise<TestUser> {
  const email = `api-${label}-${crypto.randomUUID()}@test.local`;
  const password = `pw-${crypto.randomUUID()}`;
  const created = await h.service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { ui_locale: opts.uiLocale ?? 'fr-CA', default_source_language_code: opts.defaultSourceLanguageCode ?? 'fr' } });
  if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
  const id = created.data.user.id;
  if (opts.role) {
    const granted = await h.service.from('user_roles').insert({ user_id: id, role: opts.role });
    if (granted.error) throw new Error(`grant role failed: ${granted.error.message}`);
  }
  const auth = createClient(h.env.SUPABASE_URL, h.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(`signIn failed: ${signed.error?.message}`);
  return { id, email, token: signed.data.session.access_token, refreshToken: signed.data.session.refresh_token };
}

export async function deleteStackUsers(h: StackHarness, ids: string[]): Promise<void> {
  for (const id of ids) await h.service.auth.admin.deleteUser(id).catch(() => undefined);
}
