/**
 * Shared test harness: offline app factory (fake verifier + role resolver) for unit tests, and a local-stack
 * harness (real Supabase via Docker) for integration tests. Integration suites skip with a clear message when
 * the stack is not reachable (CONVENTIONS §7).
 */
import { DefaultCapabilityRegistry } from '@langquest/ai/capability/registry';
import { CharacterAgent } from '@langquest/ai/conversation/character-agent';
import { Evaluator } from '@langquest/ai/conversation/evaluator';
import { SessionSummariser } from '@langquest/ai/conversation/summariser';
import { LanguageGuard } from '@langquest/ai/prompts/language-guard';
import { PipelineRealtimeProvider } from '@langquest/ai/realtime/pipeline';
import type { FakeReasoner } from '@langquest/ai/test-support/fakes';
import type { AiServices } from '@langquest/ai';
import { unsupportedCapability, type SpeechRecognizer, type SpeechSynthesizer } from '@langquest/contracts';
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

/**
 * Stack users get a `@langquest.test` email so the service-only `purge_test_user` RPC (migration 100) accepts them:
 * a plain GoTrue admin delete is refused once the account owns append-only ledger rows (XP, sync events, ai_requests),
 * which every conversation / progress suite creates, and that refusal used to be swallowed — leaking one auth user
 * and (through `conversation_sessions.character_id ON DELETE RESTRICT`) one published test character per run.
 */
export async function createStackUser(h: StackHarness, label: string, opts: { role?: Role; defaultSourceLanguageCode?: string; uiLocale?: string } = {}): Promise<TestUser> {
  const email = `api-${label}-${crypto.randomUUID()}@langquest.test`;
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

/**
 * Purge stack users through `purge_test_user` (runs `delete_account` under the append-only bypass, drops editorial
 * rows the account authored, deletes the auth row). A user the suite already deleted through `DELETE /v1/me` is
 * unknown (P0002) and skipped; any other failure falls back to the GoTrue admin delete and is logged, never swallowed.
 * Call this BEFORE deleting published rows the users' sessions reference (characters, missions): those FKs restrict.
 */
export async function deleteStackUsers(h: StackHarness, ids: string[]): Promise<void> {
  for (const id of ids) {
    const purged = await h.service.rpc('purge_test_user', { p_user_id: id });
    if (!purged.error || purged.error.code === 'P0002') continue;
    const fallback = await h.service.auth.admin.deleteUser(id);
    if (fallback.error) console.warn(`[api harness] purge_test_user(${id}) failed (${purged.error.message}); GoTrue delete also failed: ${fallback.error.message}`);
  }
}

/** Delete seeded rows by id and warn (never throw, never hide) when a delete is refused, e.g. by a RESTRICT FK. */
export async function deleteStackRows(h: StackHarness, table: 'characters' | 'missions' | 'conversation_sessions' | 'course_manifests', ids: string[]): Promise<void> {
  if (!ids.length) return;
  const res = await h.service.from(table).delete().in('id', ids);
  if (res.error) console.warn(`[api harness] delete ${table} ${ids.join(',')} failed: ${res.error.message}`);
}

/**
 * Offline AI services for stack tests: a scripted `FakeReasoner` behind the REAL character agent, evaluator and
 * summariser (schemas + language guard apply), no STT/TTS/assessor. Pass as `aiFactory: async () => fakeAiServices(r)`.
 */
export function fakeAiServices(reasoner: FakeReasoner): AiServices {
  const none = (provider: string) => unsupportedCapability(provider, ['provider_unavailable'], ['not configured in tests']);
  const recognizer: SpeechRecognizer = { provider: 'fake-stt', supports: async () => none('fake-stt'), transcribe: async () => ({ text: '', confidence: null, provider: 'fake-stt', language: null, words: [], durationMs: null }) as never };
  const synthesizer: SpeechSynthesizer = { provider: 'fake-tts', supports: async () => none('fake-tts'), synthesize: async () => { throw new Error('no TTS in tests'); } };
  const characterAgent = new CharacterAgent({ reasoner, guard: new LanguageGuard() });
  const pipeline = new PipelineRealtimeProvider({ recognizer, synthesizer, characterAgent, ticketSecret: 'integration-ticket-secret-32-characters-long' });
  const registry = new DefaultCapabilityRegistry({ recognizers: [recognizer], synthesizers: [synthesizer], realtime: [pipeline], assessors: [] });
  const assessor = { provider: 'none', capability: async (locale: string) => unsupportedCapability('none', ['provider_unavailable'], [`no assessor for ${locale}`]) };
  return { env: { OPENROUTER_API_KEY: 'test' }, reasoner, characterAgent, pipeline, registry, assessor, recognizer, synthesizer, evaluator: new Evaluator({ reasoner }), summariser: new SessionSummariser(reasoner) } as unknown as AiServices;
}
