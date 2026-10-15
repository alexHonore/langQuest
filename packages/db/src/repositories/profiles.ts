/** Profiles + account settings (§5.1). Profile defaults never rewrite enrollments. */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Insert, Row, Update } from '../types';

export interface ProfilesRepository {
  getByUserId(userId: string): Promise<Row<'profiles'> | null>;
  /** Idempotent upsert on `user_id` (the auth trigger normally creates the row first). */
  upsert(profile: Insert<'profiles'>): Promise<Row<'profiles'>>;
  /** Patches profile fields. Changing `default_source_language_code` only affects FUTURE enrollments. */
  update(userId: string, patch: Update<'profiles'>): Promise<Row<'profiles'>>;
  getSettings(userId: string): Promise<Row<'account_settings'> | null>;
  upsertSettings(settings: Insert<'account_settings'>): Promise<Row<'account_settings'>>;
  /** Staff roles for a user (empty for learners). */
  listRoles(userId: string): Promise<Row<'user_roles'>[]>;
}

export function profilesRepository(db: DbClient): ProfilesRepository {
  return {
    async getByUserId(userId) {
      return unwrapMaybe(await db.from('profiles').select('*').eq('user_id', userId).single(), 'profiles.getByUserId');
    },
    async upsert(profile) {
      return unwrap(await db.from('profiles').upsert(profile, { onConflict: 'user_id' }).select('*').single(), 'profiles.upsert');
    },
    async update(userId, patch) {
      return unwrap(await db.from('profiles').update(patch).eq('user_id', userId).select('*').single(), 'profiles.update');
    },
    async getSettings(userId) {
      return unwrapMaybe(await db.from('account_settings').select('*').eq('user_id', userId).single(), 'profiles.getSettings');
    },
    async upsertSettings(settings) {
      return unwrap(await db.from('account_settings').upsert(settings, { onConflict: 'user_id' }).select('*').single(), 'profiles.upsertSettings');
    },
    async listRoles(userId) {
      return unwrap(await db.from('user_roles').select('*').eq('user_id', userId), 'profiles.listRoles');
    },
  };
}
