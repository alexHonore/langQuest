/**
 * Speakers (§7.3): the people/voices behind recordings. Consent + rights live here (`consent_state`,
 * `content_rights_id`); a `null` `target_variety_id` means "unknown", never an inferred neighbour.
 * Learners only see `granted` speakers (070 RLS); editors write.
 */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import { clampLimit, type Insert, type PageQuery, type PageResult, type Row, type Update } from '../types';

export interface SpeakersListFilter extends PageQuery {
  /** Case-insensitive substring of `display_name` or `region`. */
  q?: string;
  targetVarietyId?: string;
  consentState?: Row<'speakers'>['consent_state'];
  synthetic?: boolean;
}

export interface SpeakersRepository {
  list(filter?: SpeakersListFilter): Promise<PageResult<Row<'speakers'>>>;
  getById(id: string): Promise<Row<'speakers'> | null>;
  getByIds(ids: string[]): Promise<Row<'speakers'>[]>;
  create(row: Insert<'speakers'>): Promise<Row<'speakers'>>;
  update(id: string, patch: Update<'speakers'>): Promise<Row<'speakers'>>;
  /** Fails (23503 / RLS) while `lesson_speakers` rows still reference the speaker: reassign or detach first. */
  delete(id: string): Promise<void>;
  /** Number of distinct lessons linked to each speaker (ids missing from the map have 0). */
  lessonCounts(speakerIds: string[]): Promise<Map<string, number>>;
  /** Moves every `lesson_speakers` link from one speaker to another; returns the number of lessons touched. */
  reassignLessons(fromSpeakerId: string, toSpeakerId: string): Promise<number>;
}

const escapeLike = (s: string): string => s.replace(/[\\%_,()]/g, (m) => `\\${m}`);

export function speakersRepository(db: DbClient): SpeakersRepository {
  return {
    async list(filter) {
      const limit = clampLimit(filter?.limit);
      let q = db.from('speakers').select('*').order('created_at').order('id').limit(limit + 1);
      if (filter?.targetVarietyId) q = q.eq('target_variety_id', filter.targetVarietyId);
      if (filter?.consentState) q = q.eq('consent_state', filter.consentState);
      if (filter?.synthetic !== undefined) q = q.eq('synthetic', filter.synthetic);
      if (filter?.q) {
        const term = `%${escapeLike(filter.q)}%`;
        q = q.or(`display_name.ilike.${term},region.ilike.${term}`);
      }
      if (filter?.cursor) q = q.gt('created_at', filter.cursor);
      const rows = unwrap(await q, 'speakers.list');
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.created_at ?? null) : null };
    },
    async getById(id) {
      return unwrapMaybe(await db.from('speakers').select('*').eq('id', id).maybeSingle(), 'speakers.getById');
    },
    async getByIds(ids) {
      return ids.length ? unwrap(await db.from('speakers').select('*').in('id', ids), 'speakers.getByIds') : [];
    },
    async create(row) {
      return unwrap(await db.from('speakers').insert(row).select('*').single(), 'speakers.create');
    },
    async update(id, patch) {
      return unwrap(await db.from('speakers').update(patch).eq('id', id).select('*').single(), 'speakers.update');
    },
    async delete(id) {
      unwrap(await db.from('speakers').delete().eq('id', id), 'speakers.delete');
    },
    async lessonCounts(speakerIds) {
      const counts = new Map<string, number>();
      if (speakerIds.length === 0) return counts;
      const rows = unwrap(await db.from('lesson_speakers').select('speaker_id, lesson_id').in('speaker_id', speakerIds), 'speakers.lessonCounts');
      const seen = new Map<string, Set<string>>();
      for (const r of rows) {
        const set = seen.get(r.speaker_id) ?? new Set<string>();
        set.add(r.lesson_id);
        seen.set(r.speaker_id, set);
      }
      for (const [id, set] of seen) counts.set(id, set.size);
      return counts;
    },
    async reassignLessons(fromSpeakerId, toSpeakerId) {
      const links = unwrap(await db.from('lesson_speakers').select('id, lesson_id, role').eq('speaker_id', fromSpeakerId), 'speakers.reassignLessons.read');
      if (links.length === 0) return 0;
      const existing = unwrap(await db.from('lesson_speakers').select('lesson_id, role').eq('speaker_id', toSpeakerId), 'speakers.reassignLessons.existing');
      const taken = new Set(existing.map((e) => `${e.lesson_id}:${e.role}`));
      const movable = links.filter((l) => !taken.has(`${l.lesson_id}:${l.role}`));
      const duplicates = links.filter((l) => taken.has(`${l.lesson_id}:${l.role}`));
      if (movable.length) unwrap(await db.from('lesson_speakers').update({ speaker_id: toSpeakerId }).in('id', movable.map((l) => l.id)), 'speakers.reassignLessons.update');
      // the target already voices these lessons in the same role: drop the now-redundant links
      if (duplicates.length) unwrap(await db.from('lesson_speakers').delete().in('id', duplicates.map((l) => l.id)), 'speakers.reassignLessons.dedupe');
      return new Set(links.map((l) => l.lesson_id)).size;
    },
  };
}
