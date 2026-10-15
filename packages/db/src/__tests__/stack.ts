/**
 * Shared harness for integration tests that need the LOCAL Supabase stack.
 *
 * - Detects the stack once per test file (`SUPABASE_LOCAL_*` env or `supabase status`).
 * - Without a stack the suite is skipped with a clear message — unless
 *   `LANGQUEST_REQUIRE_LOCAL_STACK=1` is set (CI), in which case the file FAILS so a missing
 *   Docker stack can never turn the RLS regression suite green by omission.
 * - `createTestUser` provisions a confirmed auth user, signs in and returns an RLS-bound client.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describe } from 'vitest';
import { createUserClient, type DbClient } from '../client';
import { detectLocalStack, type LocalStack } from '../local-stack';

export const REQUIRE_LOCAL_STACK_ENV = 'LANGQUEST_REQUIRE_LOCAL_STACK';

/** Repo root (the directory holding `supabase/config.toml`). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

export const stack: LocalStack | null = detectLocalStack({ cwd: REPO_ROOT });

/** Env shape expected by the client factories (empty strings when no stack: never used at collection time). */
export const stackEnv = {
  SUPABASE_URL: stack?.url ?? '',
  SUPABASE_ANON_KEY: stack?.anonKey ?? '',
  SUPABASE_SERVICE_ROLE_KEY: stack?.serviceRoleKey ?? '',
};

/**
 * `describe` when the local stack is reachable; `describe.skip` (with a warning) otherwise.
 * Throws — failing the test file — when `LANGQUEST_REQUIRE_LOCAL_STACK=1` and no stack is reachable.
 */
export function describeWithStack(suite: string): typeof describe {
  if (stack) return describe;
  const message = `[${suite}] Local Supabase stack not reachable. Run \`pnpm supabase start\` (Docker) or set SUPABASE_LOCAL_URL + SUPABASE_LOCAL_ANON_KEY + SUPABASE_LOCAL_SERVICE_ROLE_KEY.`;
  if (process.env[REQUIRE_LOCAL_STACK_ENV] === '1') {
    throw new Error(
      `${message} ${REQUIRE_LOCAL_STACK_ENV}=1 forbids skipping the RLS regression suite.`,
    );
  }
  console.warn(`${message} Skipping stack-bound integration tests.`);
  return describe.skip as unknown as typeof describe;
}

export type StaffRole =
  'super_admin' | 'admin' | 'content_editor' | 'language_reviewer' | 'support_readonly';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  /** RLS-bound client (anon key + this user's access token). */
  client: DbClient;
}

/**
 * Creates a confirmed auth user via the service client, signs in with the password grant and
 * returns an RLS-bound client. Optionally grants a staff role (service-role insert into `user_roles`).
 * `defaultSourceLanguageCode: null` omits the signup metadata (OAuth-style signup → profile column NULL).
 */
export async function createTestUser(
  service: DbClient,
  label: string,
  opts: { role?: StaffRole; defaultSourceLanguageCode?: string | null; uiLocale?: string } = {},
): Promise<TestUser> {
  const email = `rls-${label}-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const user_metadata: Record<string, string> = { ui_locale: opts.uiLocale ?? 'fr-CA' };
  if (opts.defaultSourceLanguageCode !== null)
    user_metadata.default_source_language_code = opts.defaultSourceLanguageCode ?? 'fr';
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata,
  });
  if (created.error || !created.data.user)
    throw new Error(`createUser failed: ${created.error?.message}`);
  const id = created.data.user.id;
  if (opts.role) {
    const granted = await service.from('user_roles').insert({ user_id: id, role: opts.role });
    if (granted.error) throw new Error(`grant role failed: ${granted.error.message}`);
  }
  const auth = createClient(stackEnv.SUPABASE_URL, stackEnv.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session)
    throw new Error(`signIn failed: ${signed.error?.message}`);
  return {
    id,
    email,
    token: signed.data.session.access_token,
    client: createUserClient(stackEnv, signed.data.session.access_token),
  };
}

/** Deletes auth users (cascades every user-owned row). Errors are ignored so cleanup never masks a failure. */
export async function deleteTestUsers(service: DbClient, ids: string[]): Promise<void> {
  for (const id of ids) await service.auth.admin.deleteUser(id).catch(() => undefined);
}

/** A key that satisfies the `^[a-z0-9]+(?:[._][a-z0-9]+)*$` check used by content keys. */
export const testKey = (prefix: string): string => `${prefix}.${randomUUID().replace(/-/g, '')}`;
