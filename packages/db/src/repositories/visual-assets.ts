/** Visual assets and bindings (§10.2C). */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import { clampLimit, type Insert, type PageQuery, type PageResult, type Row, type Update } from '../types';

export interface VisualAssetsListFilter extends PageQuery {
  type?: Row<'visual_assets'>['type'];
  reviewStatus?: Row<'visual_assets'>['review_status'];
  origin?: Row<'visual_assets'>['origin'];
  /** Case-insensitive substring of the en/fr alt text or the storage key. */
  q?: string;
  /** Exclude assets superseded by a replacement (`replaced_by_asset_id` set). Default true. */
  excludeReplaced?: boolean;
}

/** Slots a visual asset can fill, each mapped onto its real storage (see `assignVisualSlot`). */
export const VISUAL_SLOT_TARGETS = {
  audio_course_collections: ['cover'],
  audio_chapters: ['cover'],
  audio_lessons: ['cover'],
  lesson_courses: ['cover'],
  chapters: ['cover', 'map'],
  characters: ['portrait'],
  missions: ['scene', 'context_object', 'story_panel', 'celebration', 'map'],
} as const;
export type VisualSlotEntityTable = keyof typeof VISUAL_SLOT_TARGETS;
export type VisualSlot = (typeof VISUAL_SLOT_TARGETS)[VisualSlotEntityTable][number];
export interface VisualAssignmentTarget {
  entityTable: VisualSlotEntityTable;
  entityId: string;
  slot: VisualSlot;
}
export interface VisualAssignment extends VisualAssignmentTarget {
  visualAssetId: string;
  /** `audio_cover_art` / `mission_visual_bindings` row id; null for column-backed slots. */
  bindingId: string | null;
  assignedAt: string | null;
}

export interface VisualAssetsRepository {
  getById(id: string): Promise<Row<'visual_assets'> | null>;
  /** Paged admin listing (`adminVisualAssetsList`). */
  listPaged(filter?: VisualAssetsListFilter): Promise<PageResult<Row<'visual_assets'>>>;
  /** Everywhere the asset is used: `audio_cover_art`, `mission_visual_bindings` and the `*_visual_asset_id` columns. */
  listAssignments(visualAssetId: string): Promise<VisualAssignment[]>;
  /** Current assignment of one slot on one entity (null when empty). */
  getSlotAssignment(target: VisualAssignmentTarget): Promise<VisualAssignment | null>;
  /**
   * Points a slot at `visualAssetId` (or clears it with null). Column slots are updated in place; `cover` on
   * audio collections/chapters/lessons also keeps `audio_cover_art` in sync; mission slots are
   * `mission_visual_bindings` rows (one per (mission, role, asset)). Returns the resulting assignment.
   */
  assignVisualSlot(target: VisualAssignmentTarget, visualAssetId: string | null): Promise<VisualAssignment | null>;
  /** Moves every assignment of `fromAssetId` to `toAssetId` and marks the old row replaced; returns the count moved. */
  replaceEverywhere(fromAssetId: string, toAssetId: string): Promise<number>;
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

const escapeLike = (s: string): string => s.replace(/[\\%_,()]/g, (m) => `\\${m}`);
const COLUMN_SLOT: Record<string, { table: 'lesson_courses' | 'chapters' | 'characters' | 'audio_course_collections' | 'audio_chapters' | 'audio_lessons'; column: 'cover_visual_asset_id' | 'map_visual_asset_id' | 'portrait_visual_asset_id' } | undefined> = {
  'lesson_courses:cover': { table: 'lesson_courses', column: 'cover_visual_asset_id' },
  'chapters:cover': { table: 'chapters', column: 'cover_visual_asset_id' },
  'chapters:map': { table: 'chapters', column: 'map_visual_asset_id' },
  'characters:portrait': { table: 'characters', column: 'portrait_visual_asset_id' },
  'audio_course_collections:cover': { table: 'audio_course_collections', column: 'cover_visual_asset_id' },
  'audio_chapters:cover': { table: 'audio_chapters', column: 'cover_visual_asset_id' },
  'audio_lessons:cover': { table: 'audio_lessons', column: 'cover_visual_asset_id' },
};
const COVER_ART_COLUMN = { audio_course_collections: 'collection_id', audio_chapters: 'chapter_id', audio_lessons: 'lesson_id' } as const;

export function visualAssetsRepository(db: DbClient): VisualAssetsRepository {
  const assertSlot = (t: VisualAssignmentTarget): void => {
    const allowed = VISUAL_SLOT_TARGETS[t.entityTable] as readonly string[] | undefined;
    if (!allowed || !allowed.includes(t.slot)) throw new Error(`visual slot ${t.slot} is not valid for ${t.entityTable}`);
  };
  return {
    async getById(id) {
      return unwrapMaybe(await db.from('visual_assets').select('*').eq('id', id).single(), 'visual.getById');
    },
    async listPaged(filter) {
      const limit = clampLimit(filter?.limit);
      let q = db.from('visual_assets').select('*').order('created_at').order('id').limit(limit + 1);
      if (filter?.type) q = q.eq('type', filter.type);
      if (filter?.reviewStatus) q = q.eq('review_status', filter.reviewStatus);
      if (filter?.origin) q = q.eq('origin', filter.origin);
      if (filter?.excludeReplaced !== false) q = q.is('replaced_by_asset_id', null);
      if (filter?.q) {
        const term = `%${escapeLike(filter.q)}%`;
        q = q.or(`alt_text_translations->>en.ilike.${term},alt_text_translations->>fr.ilike.${term},storage_key.ilike.${term},alt_text_key.ilike.${term}`);
      }
      if (filter?.cursor) q = q.gt('created_at', filter.cursor);
      const rows = unwrap(await q, 'visual.listPaged');
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.created_at ?? null) : null };
    },
    async listAssignments(visualAssetId) {
      const out: VisualAssignment[] = [];
      const [covers, bindings, lc, ch, chMap, chars, acol, achap, aless] = await Promise.all([
        db.from('audio_cover_art').select('id, collection_id, chapter_id, lesson_id, created_at').eq('visual_asset_id', visualAssetId),
        db.from('mission_visual_bindings').select('id, mission_id, role, created_at').eq('visual_asset_id', visualAssetId),
        db.from('lesson_courses').select('id, updated_at').eq('cover_visual_asset_id', visualAssetId),
        db.from('chapters').select('id, updated_at').eq('cover_visual_asset_id', visualAssetId),
        db.from('chapters').select('id, updated_at').eq('map_visual_asset_id', visualAssetId),
        db.from('characters').select('id, updated_at').eq('portrait_visual_asset_id', visualAssetId),
        db.from('audio_course_collections').select('id, updated_at').eq('cover_visual_asset_id', visualAssetId),
        db.from('audio_chapters').select('id, updated_at').eq('cover_visual_asset_id', visualAssetId),
        db.from('audio_lessons').select('id, updated_at').eq('cover_visual_asset_id', visualAssetId),
      ]);
      const coverRows = unwrap(covers, 'visual.listAssignments.cover_art');
      const coverKey = new Set<string>();
      for (const c of coverRows) {
        const target: VisualAssignmentTarget | null = c.collection_id ? { entityTable: 'audio_course_collections', entityId: c.collection_id, slot: 'cover' } : c.chapter_id ? { entityTable: 'audio_chapters', entityId: c.chapter_id, slot: 'cover' } : c.lesson_id ? { entityTable: 'audio_lessons', entityId: c.lesson_id, slot: 'cover' } : null;
        if (!target) continue;
        coverKey.add(`${target.entityTable}:${target.entityId}`);
        out.push({ ...target, visualAssetId, bindingId: c.id, assignedAt: c.created_at });
      }
      for (const b of unwrap(bindings, 'visual.listAssignments.bindings')) out.push({ entityTable: 'missions', entityId: b.mission_id, slot: b.role as VisualSlot, visualAssetId, bindingId: b.id, assignedAt: b.created_at });
      const column = (res: { data: { id: string; updated_at: string }[] | null; error: unknown }, entityTable: VisualSlotEntityTable, slot: VisualSlot, ctx: string) => {
        for (const r of unwrap(res as never, ctx) as { id: string; updated_at: string }[]) {
          if (slot === 'cover' && coverKey.has(`${entityTable}:${r.id}`)) continue; // already listed via audio_cover_art
          out.push({ entityTable, entityId: r.id, slot, visualAssetId, bindingId: null, assignedAt: r.updated_at });
        }
      };
      column(lc, 'lesson_courses', 'cover', 'visual.listAssignments.lesson_courses');
      column(ch, 'chapters', 'cover', 'visual.listAssignments.chapters');
      column(chMap, 'chapters', 'map', 'visual.listAssignments.chapters.map');
      column(chars, 'characters', 'portrait', 'visual.listAssignments.characters');
      column(acol, 'audio_course_collections', 'cover', 'visual.listAssignments.audio_course_collections');
      column(achap, 'audio_chapters', 'cover', 'visual.listAssignments.audio_chapters');
      column(aless, 'audio_lessons', 'cover', 'visual.listAssignments.audio_lessons');
      return out;
    },
    async getSlotAssignment(target) {
      assertSlot(target);
      if (target.entityTable === 'missions') {
        const rows = unwrap(await db.from('mission_visual_bindings').select('id, visual_asset_id, created_at').eq('mission_id', target.entityId).eq('role', target.slot).order('sort_order').limit(1), 'visual.getSlotAssignment.mission');
        const b = rows[0];
        return b ? { ...target, visualAssetId: b.visual_asset_id, bindingId: b.id, assignedAt: b.created_at } : null;
      }
      const col = COLUMN_SLOT[`${target.entityTable}:${target.slot}`]!;
      const row = unwrapMaybe(await db.from(col.table).select(`id, updated_at, ${col.column}`).eq('id', target.entityId).maybeSingle(), 'visual.getSlotAssignment') as { id: string; updated_at: string; [k: string]: string | null } | null;
      const assetId = row?.[col.column] ?? null;
      if (!assetId) return null;
      let bindingId: string | null = null;
      if (target.entityTable in COVER_ART_COLUMN) {
        const fk = COVER_ART_COLUMN[target.entityTable as keyof typeof COVER_ART_COLUMN];
        const art = unwrap(await db.from('audio_cover_art').select('id').eq(fk, target.entityId).eq('visual_asset_id', assetId).limit(1), 'visual.getSlotAssignment.cover_art');
        bindingId = art[0]?.id ?? null;
      }
      return { ...target, visualAssetId: assetId, bindingId, assignedAt: row?.updated_at ?? null };
    },
    async assignVisualSlot(target, visualAssetId) {
      assertSlot(target);
      if (target.entityTable === 'missions') {
        const existing = unwrap(await db.from('mission_visual_bindings').select('id').eq('mission_id', target.entityId).eq('role', target.slot), 'visual.assignVisualSlot.mission.read');
        if (existing.length) unwrap(await db.from('mission_visual_bindings').delete().in('id', existing.map((e) => e.id)), 'visual.assignVisualSlot.mission.clear');
        if (!visualAssetId) return null;
        const row = unwrap(await db.from('mission_visual_bindings').insert({ mission_id: target.entityId, visual_asset_id: visualAssetId, role: target.slot }).select('id, created_at').single(), 'visual.assignVisualSlot.mission.insert');
        return { ...target, visualAssetId, bindingId: row.id, assignedAt: row.created_at };
      }
      const col = COLUMN_SLOT[`${target.entityTable}:${target.slot}`]!;
      const updated = unwrap(await db.from(col.table).update({ [col.column]: visualAssetId } as never).eq('id', target.entityId).select('id, updated_at').single(), 'visual.assignVisualSlot.column') as { id: string; updated_at: string };
      let bindingId: string | null = null;
      if (target.entityTable in COVER_ART_COLUMN) {
        const fk = COVER_ART_COLUMN[target.entityTable as keyof typeof COVER_ART_COLUMN];
        unwrap(await db.from('audio_cover_art').delete().eq(fk, target.entityId), 'visual.assignVisualSlot.cover_art.clear');
        if (visualAssetId) {
          const art = unwrap(await db.from('audio_cover_art').insert({ [fk]: target.entityId, visual_asset_id: visualAssetId } as never).select('id').single(), 'visual.assignVisualSlot.cover_art.insert') as { id: string };
          bindingId = art.id;
        }
      }
      return visualAssetId ? { ...target, visualAssetId, bindingId, assignedAt: updated.updated_at } : null;
    },
    async replaceEverywhere(fromAssetId, toAssetId) {
      const assignments = await this.listAssignments(fromAssetId);
      for (const a of assignments) await this.assignVisualSlot({ entityTable: a.entityTable, entityId: a.entityId, slot: a.slot }, toAssetId);
      unwrap(await db.from('visual_assets').update({ replaced_by_asset_id: toAssetId }).eq('id', fromAssetId), 'visual.replaceEverywhere.mark');
      return assignments.length;
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
