/** Visual assets and bindings (§10.2C). */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Insert, Row, Update } from '../types';

export interface VisualAssetsRepository {
  getById(id: string): Promise<Row<'visual_assets'> | null>;
  getByIds(ids: string[]): Promise<Row<'visual_assets'>[]>;
  findByHash(contentHash: string): Promise<Row<'visual_assets'> | null>;
  list(filter?: { type?: Row<'visual_assets'>['type']; reviewStatus?: Row<'visual_assets'>['review_status']; limit?: number }): Promise<Row<'visual_assets'>[]>;
  insert(row: Insert<'visual_assets'>): Promise<Row<'visual_assets'>>;
  update(id: string, patch: Update<'visual_assets'>): Promise<Row<'visual_assets'>>;
  listMascotAnimations(filter?: { state?: Row<'mascot_animations'>['state']; sizeVariant?: Row<'mascot_animations'>['size_variant'] }): Promise<Row<'mascot_animations'>[]>;
  upsertMascotAnimation(row: Insert<'mascot_animations'>): Promise<Row<'mascot_animations'>>;
  listCharacterVariants(characterId: string): Promise<Row<'character_visual_variants'>[]>;
  upsertCharacterVariant(row: Insert<'character_visual_variants'>): Promise<Row<'character_visual_variants'>>;
  listMissionBindings(missionId: string): Promise<Row<'mission_visual_bindings'>[]>;
  upsertMissionBinding(row: Insert<'mission_visual_bindings'>): Promise<Row<'mission_visual_bindings'>>;
  listCoverArt(target: { collectionId?: string; chapterId?: string; lessonId?: string }): Promise<Row<'audio_cover_art'>[]>;
  upsertCoverArt(row: Insert<'audio_cover_art'>): Promise<Row<'audio_cover_art'>>;
}

export function visualAssetsRepository(db: DbClient): VisualAssetsRepository {
  return {
    async getById(id) {
      return unwrapMaybe(await db.from('visual_assets').select('*').eq('id', id).single(), 'visual.getById');
    },
    async getByIds(ids) {
      return ids.length ? unwrap(await db.from('visual_assets').select('*').in('id', ids), 'visual.getByIds') : [];
    },
    async findByHash(contentHash) {
      return unwrapMaybe(await db.from('visual_assets').select('*').eq('content_hash', contentHash).limit(1).maybeSingle(), 'visual.findByHash');
    },
    async list(filter) {
      let q = db.from('visual_assets').select('*').order('created_at', { ascending: false }).limit(filter?.limit ?? 100);
      if (filter?.type) q = q.eq('type', filter.type);
      if (filter?.reviewStatus) q = q.eq('review_status', filter.reviewStatus);
      return unwrap(await q, 'visual.list');
    },
    async insert(row) {
      return unwrap(await db.from('visual_assets').insert(row).select('*').single(), 'visual.insert');
    },
    async update(id, patch) {
      return unwrap(await db.from('visual_assets').update(patch).eq('id', id).select('*').single(), 'visual.update');
    },
    async listMascotAnimations(filter) {
      let q = db.from('mascot_animations').select('*');
      if (filter?.state) q = q.eq('state', filter.state);
      if (filter?.sizeVariant) q = q.eq('size_variant', filter.sizeVariant);
      return unwrap(await q, 'visual.listMascotAnimations');
    },
    async upsertMascotAnimation(row) {
      return unwrap(await db.from('mascot_animations').upsert(row).select('*').single(), 'visual.upsertMascotAnimation');
    },
    async listCharacterVariants(characterId) {
      return unwrap(await db.from('character_visual_variants').select('*').eq('character_id', characterId), 'visual.listCharacterVariants');
    },
    async upsertCharacterVariant(row) {
      return unwrap(await db.from('character_visual_variants').upsert(row).select('*').single(), 'visual.upsertCharacterVariant');
    },
    async listMissionBindings(missionId) {
      return unwrap(await db.from('mission_visual_bindings').select('*').eq('mission_id', missionId).order('sort_order'), 'visual.listMissionBindings');
    },
    async upsertMissionBinding(row) {
      return unwrap(await db.from('mission_visual_bindings').upsert(row).select('*').single(), 'visual.upsertMissionBinding');
    },
    async listCoverArt(target) {
      let q = db.from('audio_cover_art').select('*');
      if (target.collectionId) q = q.eq('collection_id', target.collectionId);
      if (target.chapterId) q = q.eq('chapter_id', target.chapterId);
      if (target.lessonId) q = q.eq('lesson_id', target.lessonId);
      return unwrap(await q, 'visual.listCoverArt');
    },
    async upsertCoverArt(row) {
      return unwrap(await db.from('audio_cover_art').upsert(row).select('*').single(), 'visual.upsertCoverArt');
    },
  };
}
