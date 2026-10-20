/**
 * Shared harness for integration tests that need the LOCAL Supabase stack.
 *
 * - Detects the stack once per test file (`SUPABASE_LOCAL_*` env or `supabase status`).
 * - Without a stack the suite is skipped with a clear message — unless
 *   `LANGQUEST_REQUIRE_LOCAL_STACK=1` is set (CI), in which case the file FAILS so a missing
 *   Docker stack can never turn the RLS regression suite green by omission.
 * - `createTestUser` provisions a confirmed auth user, signs in and returns an RLS-bound client.
 * - Stack suites never leave the machine: `describeWithStack` installs the network guard
 *   (`./network-guard`), which refuses requests to non-local hosts and fails the test that made one
 *   (lifted only by `LANGQUEST_LIVE_TESTS=1`).
 * - Rows a suite inserts with the service client are registered with `trackRow` and removed by
 *   `deleteTrackedRows`; users go through `deleteTestUsers` (`purge_test_user`).
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describe } from 'vitest';
import { createUserClient, type DbClient } from '../client';
import { detectLocalStack, type LocalStack } from '../local-stack';
import type { TableName } from '../types';
import { installNetworkGuard, registerNetworkGuardHooks } from './network-guard';

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
  if (stack) {
    installNetworkGuard({ allow: [stack.url] });
    registerNetworkGuardHooks(suite);
    return describe;
  }
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
  // `@langquest.test` so `purge_test_user` (migration 100) accepts the account at cleanup time.
  const email = `rls-${label}-${randomUUID()}@langquest.test`;
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

/**
 * Purges test users: `purge_test_user` (service-only RPC, `@langquest.test` accounts) deletes the
 * user-owned rows AND the append-only evidence ledgers the plain auth cascade cannot touch, then the
 * auth.users row; `auth.admin.deleteUser` remains as a fallback. Errors are ignored so cleanup never
 * masks a failure.
 *
 * The account's `feedback_reports` are deleted first: `delete_account` keeps a learner's reports as
 * anonymised product feedback, but a test account's reports are test data (the table is not
 * append-only, so the service role may delete them).
 *
 * What a purge leaves by design (append-only, never deleted): `ai_requests` and `audit_logs` rows lose
 * their user reference, `delete_account` itself appends one `account.delete_account` audit row, and an
 * asset the account owned keeps `disposition = 'deleted'` plus a `removed` provenance event — so delete
 * tracked assets BEFORE purging their owner (`deleteTrackedRows`).
 */
export async function deleteTestUsers(service: DbClient, ids: string[]): Promise<void> {
  for (const id of ids) {
    // Same guard as purge_test_user: only an @langquest.test account's reports are test data.
    const email = (await service.auth.admin.getUserById(id).catch(() => null))?.data.user?.email ?? '';
    if (/@langquest\.test$/i.test(email)) {
      const feedback = await service.from('feedback_reports').delete().eq('user_id', id);
      if (feedback.error) console.warn(`[db harness] delete feedback_reports of ${id} failed: ${feedback.error.message}`);
    }
    const purged = await service.rpc('purge_test_user', { p_user_id: id }).then((r) => !r.error, () => false);
    if (!purged) await service.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

export interface TrackedRow {
  table: TableName;
  id: string;
}

/**
 * Register a row the suite inserted with the service client (processing_jobs, media_assets, …) so
 * `deleteTrackedRows` removes it at teardown. Track in INSERTION order (a parent before the rows that
 * reference it): teardown walks the list backwards. Returns the id for chaining.
 */
export function trackRow(rows: TrackedRow[], table: TableName, id: string): string {
  rows.push({ table, id });
  return id;
}

/**
 * Delete tracked rows by id in reverse insertion order and empty the list. A refused delete is logged
 * (never thrown, never hidden). Call it BEFORE `deleteTestUsers` for assets a test user owns: purging
 * the owner first appends an `asset_provenance_events` row (append-only), whose `ON DELETE CASCADE`
 * then refuses the asset delete for good. Idempotent; safe after a half-failed `beforeAll`.
 */
export async function deleteTrackedRows(service: DbClient, rows: TrackedRow[]): Promise<void> {
  for (const { table, id } of [...rows].reverse()) {
    const res = await service.from(table).delete().eq('id' as never, id as never);
    if (res.error) console.warn(`[db harness] delete ${table} ${id} failed: ${res.error.message}`);
  }
  rows.length = 0;
}

/** A key that satisfies the `^[a-z0-9]+(?:[._][a-z0-9]+)*$` check used by content keys. */
export const testKey = (prefix: string): string => `${prefix}.${randomUUID().replace(/-/g, '')}`;
