/**
 * Account lifecycle (A28, migration 100): the service-role RPCs that delete or purge a learner.
 *
 * `delete_account` removes every user-owned row and the learner's own evidence ledgers, anonymises
 * the ledgers that must be retained (cost / audit / safety) and marks the learner's recordings
 * deleted; the append-only triggers honour a transaction-local bypass that only these functions set.
 * It does NOT delete `auth.users`: the API calls `auth.admin.deleteUser(userId)` afterwards (the
 * cascade is then trivial) — unless the summary says `authUserDeletable: false` (a staff account
 * with editorial attribution), in which case the account is deactivated instead.
 *
 * `purge_test_user` is the local/CI cleanup: it refuses anything but an `@langquest.test` e-mail,
 * runs `delete_account(…, true)` and deletes the `auth.users` row itself.
 */
import type { DbClient } from '../client';
import { unwrap } from '../errors';

/** Summary returned by `delete_account` / `purge_test_user` (jsonb → camelCase keys). */
export interface AccountDeletionSummary {
  userId: string;
  deletedTables: string[];
  anonymisedTables: string[];
  retainedForLegalReasons: string[];
  recordingsDeleted: number;
  /** False when NOT NULL editorial attribution (content_revisions / publication_events) blocks the auth.users delete. */
  authUserDeletable: boolean;
  /** Rows touched per table. */
  counts: Record<string, number>;
  deletedAt: string;
  /** Only set by `purge_test_user`. */
  authUserDeleted?: boolean;
}

export interface AccountLifecycleRepository {
  /** Service role only (42501 otherwise). Idempotent: a second call reports zero counts. */
  deleteAccount(userId: string, opts?: { deleteOptInRecordings?: boolean }): Promise<AccountDeletionSummary>;
  /** Service role only; `@langquest.test` accounts only (42501 otherwise, P0002 when unknown). */
  purgeTestUser(userId: string): Promise<AccountDeletionSummary>;
}

function asSummary(value: unknown, context: string): AccountDeletionSummary {
  if (!value || typeof value !== 'object') throw new Error(`${context}: unexpected RPC result`);
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const counts: Record<string, number> = {};
  if (v.counts && typeof v.counts === 'object') {
    for (const [k, n] of Object.entries(v.counts as Record<string, unknown>)) if (typeof n === 'number') counts[k] = n;
  }
  return {
    userId: String(v.userId ?? ''),
    deletedTables: strings(v.deletedTables),
    anonymisedTables: strings(v.anonymisedTables),
    retainedForLegalReasons: strings(v.retainedForLegalReasons),
    recordingsDeleted: typeof v.recordingsDeleted === 'number' ? v.recordingsDeleted : 0,
    authUserDeletable: v.authUserDeletable !== false,
    counts,
    deletedAt: String(v.deletedAt ?? ''),
    ...(typeof v.authUserDeleted === 'boolean' ? { authUserDeleted: v.authUserDeleted } : {}),
  };
}

export function accountLifecycleRepository(db: DbClient): AccountLifecycleRepository {
  return {
    async deleteAccount(userId, opts) {
      const result = unwrap(
        await db.rpc('delete_account', { p_user_id: userId, p_delete_opt_in_recordings: opts?.deleteOptInRecordings ?? true }),
        'account.deleteAccount',
      );
      return asSummary(result, 'account.deleteAccount');
    },
    async purgeTestUser(userId) {
      const result = unwrap(await db.rpc('purge_test_user', { p_user_id: userId }), 'account.purgeTestUser');
      return asSummary(result, 'account.purgeTestUser');
    },
  };
}
