/** AI model profiles (§8.2 / §8.7): task × variety × source routing rows. Never contain secrets. */
import { modelProfileSpecificity } from '@langquest/contracts';
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Insert, Row, Update } from '../types';

export interface AiProfilesRepository {
  list(filter?: { task?: Row<'ai_model_profiles'>['task']; enabledOnly?: boolean }): Promise<Row<'ai_model_profiles'>[]>;
  getById(id: string): Promise<Row<'ai_model_profiles'> | null>;
  /**
   * Resolves the most specific ENABLED profile for (task, variety, source):
   * exact → (task, variety, any) → (task, any, source) → (task, any, any). Null when nothing is enabled.
   */
  resolve(task: Row<'ai_model_profiles'>['task'], targetVarietyId: string | null, sourceLanguageCode: string | null): Promise<Row<'ai_model_profiles'> | null>;
  /** Upsert on the (task, variety, source) scope; bumps `version`. */
  upsert(row: Insert<'ai_model_profiles'>): Promise<Row<'ai_model_profiles'>>;
  update(id: string, patch: Update<'ai_model_profiles'>): Promise<Row<'ai_model_profiles'>>;
  recordBenchmark(row: Insert<'ai_model_benchmarks'>): Promise<Row<'ai_model_benchmarks'>>;
  listBenchmarks(profileId: string): Promise<Row<'ai_model_benchmarks'>[]>;
  /** Append-only request log (service role). */
  logRequest(row: Insert<'ai_requests'>): Promise<void>;
}

export function aiProfilesRepository(db: DbClient): AiProfilesRepository {
  return {
    async list(filter) {
      let q = db.from('ai_model_profiles').select('*').order('task').order('target_variety_id', { nullsFirst: true });
      if (filter?.task) q = q.eq('task', filter.task);
      if (filter?.enabledOnly) q = q.eq('enabled', true);
      return unwrap(await q, 'aiProfiles.list');
    },
    async getById(id) {
      return unwrapMaybe(await db.from('ai_model_profiles').select('*').eq('id', id).single(), 'aiProfiles.getById');
    },
    async resolve(task, targetVarietyId, sourceLanguageCode) {
      const rows = unwrap(await db.from('ai_model_profiles').select('*').eq('task', task).eq('enabled', true), 'aiProfiles.resolve');
      const candidates = rows.filter(
        (r) => (r.target_variety_id === null || r.target_variety_id === targetVarietyId) && (r.source_language_code === null || r.source_language_code === sourceLanguageCode),
      );
      candidates.sort(
        (a, b) =>
          modelProfileSpecificity({ targetVariety: b.target_variety_id as never, sourceLanguage: b.source_language_code as never }) -
          modelProfileSpecificity({ targetVariety: a.target_variety_id as never, sourceLanguage: a.source_language_code as never }),
      );
      return candidates[0] ?? null;
    },
    async upsert(row) {
      let lookup = db.from('ai_model_profiles').select('id, version').eq('task', row.task);
      lookup = row.target_variety_id == null ? lookup.is('target_variety_id', null) : lookup.eq('target_variety_id', row.target_variety_id);
      lookup = row.source_language_code == null ? lookup.is('source_language_code', null) : lookup.eq('source_language_code', row.source_language_code);
      const existing = unwrapMaybe(await lookup.maybeSingle(), 'aiProfiles.upsert.lookup');
      if (existing) {
        return unwrap(await db.from('ai_model_profiles').update({ ...row, version: existing.version + 1 }).eq('id', existing.id).select('*').single(), 'aiProfiles.upsert.update');
      }
      return unwrap(await db.from('ai_model_profiles').insert(row).select('*').single(), 'aiProfiles.upsert.insert');
    },
    async update(id, patch) {
      return unwrap(await db.from('ai_model_profiles').update(patch).eq('id', id).select('*').single(), 'aiProfiles.update');
    },
    async recordBenchmark(row) {
      return unwrap(await db.from('ai_model_benchmarks').insert(row).select('*').single(), 'aiProfiles.recordBenchmark');
    },
    async listBenchmarks(profileId) {
      return unwrap(await db.from('ai_model_benchmarks').select('*').eq('profile_id', profileId).order('created_at', { ascending: false }), 'aiProfiles.listBenchmarks');
    },
    async logRequest(row) {
      unwrap(await db.from('ai_requests').insert(row), 'aiProfiles.logRequest');
    },
  };
}
