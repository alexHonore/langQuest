/** Audio library (§5.3, §6.3): collections, chapters, lessons, assets, transcripts, learner audio state. */
import { randomUUID } from 'node:crypto';
import type { PostgrestError } from '@supabase/supabase-js';
import type { DbClient } from '../client';
import { DbError, unwrap, unwrapMaybe } from '../errors';
import { clampLimit, type Insert, type PageQuery, type PageResult, type Row, type Update } from '../types';
import { MEDIA_ASSET_COLUMNS, type MediaAssetRow } from './rights';

export interface PutProgressInput {
  user_id: string;
  lesson_id: string;
  revision: number;
  position_ms: number;
  duration_ms?: number | null;
  completed?: boolean;
  /** Client event UUID (idempotency key); a fresh one is generated when omitted. */
  last_client_event_id?: string | null;
  /** Writing device; `unknown` when omitted (then only wall-clock ordering applies). */
  last_device_id?: string | null;
  /** Client time of the position; `now()` when omitted. */
  last_occurred_at?: string | null;
}
export interface PutProgressResult {
  row: Row<'user_audio_progress'>;
  /** True when the stored position was newer (per-device revision or cross-device wall clock). */
  superseded: boolean;
  resolution: 'applied' | 'duplicate' | 'superseded';
  /** `older_revision` | `older_event` | `same_client_event` | null. */
  reason: string | null;
}

export interface CollectionsAdminFilter extends PageQuery {
  q?: string;
  courseTrackId?: string;
  instructionLanguageCode?: string;
  targetVarietyId?: string;
  state?: Row<'audio_course_collections'>['state'];
}

const SEARCHABLE_TITLE_LANGS = ['en', 'fr', 'es', 'ru'] as const;
const escapeLike = (s: string): string => s.replace(/[\\%_,()]/g, (m) => `\\${m}`);

export interface LessonWithAssets {
  lesson: Row<'audio_lessons'>;
  /** `media` carries the learner-visible columns only (owner / import paths are staff-only, 070 §8). */
  assets: (Row<'audio_lesson_assets'> & { media: MediaAssetRow | null })[];
  speakers: Row<'speakers'>[];
}

export interface AudioLibraryRepository {
  listCollections(filter?: { courseTrackId?: string; instructionLanguageCode?: string; targetVarietyId?: string } & PageQuery): Promise<PageResult<Row<'audio_course_collections'>>>;
  getCollection(id: string): Promise<Row<'audio_course_collections'> | null>;
  listChapters(collectionId: string): Promise<Row<'audio_chapters'>[]>;
  listLessons(chapterId: string): Promise<Row<'audio_lessons'>[]>;
  getLesson(id: string): Promise<LessonWithAssets | null>;
  /** Latest transcript for a lesson with its segments (and translations in `languageCode` when given). */
  getTranscript(lessonId: string, languageCode?: string): Promise<{ transcript: Row<'transcripts'>; segments: Row<'transcript_segments'>[]; translations: Row<'transcript_translations'>[] } | null>;
  getProgress(userId: string, lessonId: string): Promise<Row<'user_audio_progress'> | null>;
  /**
   * Listening-position write. Delegates to `apply_sync_events` → `apply_audio_progress` (migration 110) so the
   * single PUT and the batch sync resolve conflicts identically: same device → per-device `revision` decides;
   * another device → skew-corrected `last_occurred_at` decides; `completed` is sticky. Idempotent on
   * `last_client_event_id` (generated when omitted); `superseded` stays for older callers, `resolution`/`reason`
   * carry the RPC's verdict. Learner JWTs act on themselves; the service role passes `user_id`.
   */
  putProgress(row: PutProgressInput, opts?: { clientSentAt?: string }): Promise<PutProgressResult>;
  listBookmarks(userId: string, lessonId?: string): Promise<Row<'bookmarks'>[]>;
  /** Idempotent on (user_id, client_event_id). */
  createBookmark(row: Insert<'bookmarks'>): Promise<Row<'bookmarks'>>;
  deleteBookmark(userId: string, id: string): Promise<void>;
  listDownloadManifests(userId: string): Promise<Row<'user_download_manifests'>[]>;
  upsertDownloadManifest(row: Insert<'user_download_manifests'>): Promise<Row<'user_download_manifests'>>;
  // editor writes
  upsertCollection(row: Insert<'audio_course_collections'>): Promise<Row<'audio_course_collections'>>;
  upsertChapter(row: Insert<'audio_chapters'>): Promise<Row<'audio_chapters'>>;
  upsertLesson(row: Insert<'audio_lessons'>): Promise<Row<'audio_lessons'>>;
  updateLesson(id: string, patch: Update<'audio_lessons'>): Promise<Row<'audio_lessons'>>;
  attachLessonAsset(row: Insert<'audio_lesson_assets'>): Promise<Row<'audio_lesson_assets'>>;
  // --- admin structure routes (contracts `adminCollection*` / `adminChapter*` / `adminLesson*`, 2026-10-19) ---
  /** Paged admin listing with `q` (title in en/fr/es/ru), `state`, track and instruction-language filters. */
  listCollectionsAdmin(filter?: CollectionsAdminFilter): Promise<PageResult<Row<'audio_course_collections'>>>;
  updateCollection(id: string, patch: Update<'audio_course_collections'>): Promise<Row<'audio_course_collections'>>;
  /** Cascades to chapters/lessons/links (FK `on delete cascade`); the caller refuses published children first. */
  deleteCollection(id: string): Promise<void>;
  getChapter(id: string): Promise<Row<'audio_chapters'> | null>;
  updateChapter(id: string, patch: Update<'audio_chapters'>): Promise<Row<'audio_chapters'>>;
  deleteChapter(id: string): Promise<void>;
  deleteLesson(id: string): Promise<void>;
  /** Atomic full-permutation reorder (`reorder_audio_chapters` RPC; `23514` when ids are not exactly the children). */
  reorderChapters(collectionId: string, orderedIds: string[]): Promise<{ id: string; sortOrder: number }[]>;
  /** Atomic full-permutation reorder (`reorder_audio_lessons` RPC). */
  reorderLessons(chapterId: string, orderedIds: string[]): Promise<{ id: string; sortOrder: number }[]>;
  /** Chapter and lesson counts per collection (missing ids → 0/0). */
  countCollectionChildren(collectionIds: string[]): Promise<Map<string, { chapters: number; lessons: number }>>;
  /** Lesson count per chapter (missing ids → 0). */
  countChapterLessons(chapterIds: string[]): Promise<Map<string, number>>;
  listLessonAssets(lessonId: string): Promise<Row<'audio_lesson_assets'>[]>;
  /** Lessons (other than `exceptLessonId`) an asset is linked to, for "moved from" bookkeeping. */
  listLessonLinksForAsset(assetId: string, exceptLessonId?: string): Promise<Row<'audio_lesson_assets'>[]>;
  /** Removes the link(s) for one asset (all asset types unless `assetType` given); returns the number removed. */
  detachLessonAsset(lessonId: string, assetId: string, assetType?: Row<'audio_lesson_assets'>['asset_type']): Promise<number>;
  listLessonSpeakers(lessonId: string): Promise<Row<'lesson_speakers'>[]>;
  /** Replaces the lesson's speaker links in `role` (default `other`); returns the resulting links. */
  setLessonSpeakers(lessonId: string, speakerIds: string[], role?: Row<'lesson_speakers'>['role']): Promise<Row<'lesson_speakers'>[]>;
  upsertTranscript(row: Insert<'transcripts'>): Promise<Row<'transcripts'>>;
  replaceTranscriptSegments(transcriptId: string, segments: Omit<Insert<'transcript_segments'>, 'transcript_id'>[]): Promise<Row<'transcript_segments'>[]>;
  // --- explicit-column lookups/writes the jobs runner and admin needed (migration 100, cross-package gaps) ---
  getTranscriptById(id: string): Promise<Row<'transcripts'> | null>;
  /** Every transcript revision of a lesson, oldest revision first. */
  listTranscriptsForLesson(lessonId: string): Promise<Row<'transcripts'>[]>;
  /** Transcripts produced from the given source assets, newest first. */
  listTranscriptsForAssets(assetIds: string[]): Promise<Row<'transcripts'>[]>;
  updateTranscript(id: string, patch: Update<'transcripts'>): Promise<Row<'transcripts'>>;
  listTranscriptSegments(transcriptId: string): Promise<Row<'transcript_segments'>[]>;
  updateTranscriptSegment(id: string, patch: Update<'transcript_segments'>): Promise<Row<'transcript_segments'>>;
  /** Upsert on (segment_id, language_code); returns the number of rows written. */
  upsertTranscriptTranslations(rows: Insert<'transcript_translations'>[]): Promise<number>;
  listTranscriptTranslations(segmentIds: string[], languageCode?: string): Promise<Row<'transcript_translations'>[]>;
  /** Replaces the word alignments of one segment; returns the number of rows written. */
  replaceWordAlignments(segmentId: string, rows: Omit<Insert<'transcript_word_alignments'>, 'segment_id'>[]): Promise<number>;
  listWordAlignments(segmentId: string): Promise<Row<'transcript_word_alignments'>[]>;
  /** Upsert on (lesson_id, topic_key). */
  upsertLessonTopics(rows: Insert<'lesson_topics'>[]): Promise<Row<'lesson_topics'>[]>;
  listLessonTopics(lessonId: string): Promise<Row<'lesson_topics'>[]>;
  /** Lessons an asset is attached to (distinct ids). */
  findLessonIdsForAsset(assetId: string): Promise<string[]>;
  /** Distinct `primary_language_code`s of a lesson's usable transcripts (not `none`/`failed`). */
  listTranscriptLanguagesForLesson(lessonId: string): Promise<string[]>;
  findCollectionByTitle(title: string, languageCode: string): Promise<Row<'audio_course_collections'> | null>;
  findChapterByTitle(collectionId: string, title: string, languageCode: string): Promise<Row<'audio_chapters'> | null>;
}

export function audioLibraryRepository(db: DbClient): AudioLibraryRepository {
  return {
    async listCollections(filter) {
      const limit = clampLimit(filter?.limit);
      let q = db.from('audio_course_collections').select('*').order('sort_order').order('created_at').limit(limit + 1);
      if (filter?.courseTrackId) q = q.eq('course_track_id', filter.courseTrackId);
      if (filter?.instructionLanguageCode) q = q.eq('instruction_language_code', filter.instructionLanguageCode);
      if (filter?.targetVarietyId) q = q.eq('target_variety_id', filter.targetVarietyId);
      if (filter?.cursor) q = q.gt('created_at', filter.cursor);
      const rows = unwrap(await q, 'audio.listCollections');
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.created_at ?? null) : null };
    },
    async getCollection(id) {
      return unwrapMaybe(await db.from('audio_course_collections').select('*').eq('id', id).single(), 'audio.getCollection');
    },
    async listChapters(collectionId) {
      return unwrap(await db.from('audio_chapters').select('*').eq('collection_id', collectionId).order('sort_order'), 'audio.listChapters');
    },
    async listLessons(chapterId) {
      return unwrap(await db.from('audio_lessons').select('*').eq('chapter_id', chapterId).order('sort_order'), 'audio.listLessons');
    },
    async getLesson(id) {
      const lesson = unwrapMaybe(await db.from('audio_lessons').select('*').eq('id', id).single(), 'audio.getLesson');
      if (!lesson) return null;
      const [links, speakerLinks] = await Promise.all([
        unwrap(await db.from('audio_lesson_assets').select('*').eq('lesson_id', id).order('sort_order'), 'audio.getLesson.assets'),
        unwrap(await db.from('lesson_speakers').select('speaker_id').eq('lesson_id', id), 'audio.getLesson.speakerLinks'),
      ]);
      const assetIds = links.map((l) => l.asset_id);
      const speakerIds = speakerLinks.map((s) => s.speaker_id);
      const [media, speakers] = await Promise.all([
        assetIds.length ? unwrap(await db.from('media_assets').select(MEDIA_ASSET_COLUMNS).in('id', assetIds), 'audio.getLesson.media') : [],
        speakerIds.length ? unwrap(await db.from('speakers').select('*').in('id', speakerIds), 'audio.getLesson.speakers') : [],
      ]);
      const mediaById = new Map(media.map((m) => [m.id, m]));
      return { lesson, assets: links.map((l) => ({ ...l, media: mediaById.get(l.asset_id) ?? null })), speakers };
    },
    async getTranscript(lessonId, languageCode) {
      const transcript = unwrapMaybe(
        await db.from('transcripts').select('*').eq('lesson_id', lessonId).order('revision', { ascending: false }).limit(1).single(),
        'audio.getTranscript',
      );
      if (!transcript) return null;
      const segments = unwrap(await db.from('transcript_segments').select('*').eq('transcript_id', transcript.id).order('sort_index'), 'audio.getTranscript.segments');
      const segmentIds = segments.map((s) => s.id);
      const translations =
        languageCode && segmentIds.length
          ? unwrap(await db.from('transcript_translations').select('*').in('segment_id', segmentIds).eq('language_code', languageCode), 'audio.getTranscript.translations')
          : [];
      return { transcript, segments, translations };
    },
    async getProgress(userId, lessonId) {
      return unwrapMaybe(await db.from('user_audio_progress').select('*').eq('user_id', userId).eq('lesson_id', lessonId).single(), 'audio.getProgress');
    },
    async putProgress(row, opts) {
      const clientEventId = row.last_client_event_id ?? randomUUID();
      const event = {
        clientEventId,
        enrollmentId: null,
        deviceId: row.last_device_id ?? 'unknown',
        revision: row.revision,
        occurredAt: row.last_occurred_at ?? new Date().toISOString(),
        payload: { type: 'audio_progress', lessonId: row.lesson_id, positionMs: row.position_ms, durationMs: row.duration_ms ?? null, completed: row.completed ?? false },
      };
      const args: { p_events: (typeof event)[]; p_user_id: string; p_client_sent_at?: string } = { p_events: [event], p_user_id: row.user_id };
      if (opts?.clientSentAt) args.p_client_sent_at = opts.clientSentAt;
      const results = unwrap(await db.rpc('apply_sync_events', args as never), 'audio.putProgress.apply');
      const result = results[0];
      if (!result || result.resolution === 'rejected') {
        throw new DbError({ name: 'PostgrestError', message: `rejected: ${result?.reason ?? 'no result'}`, code: 'P0001', details: result?.reason ?? '', hint: '' } as PostgrestError, 'audio.putProgress');
      }
      const saved = unwrapMaybe(await db.from('user_audio_progress').select('*').eq('user_id', row.user_id).eq('lesson_id', row.lesson_id).maybeSingle(), 'audio.putProgress.read');
      if (!saved) throw new DbError({ name: 'PostgrestError', message: 'no progress row after apply', code: 'P0002', details: '', hint: '' } as PostgrestError, 'audio.putProgress');
      const resolution = result.resolution as PutProgressResult['resolution'];
      return { row: saved, superseded: resolution === 'superseded', resolution, reason: result.reason ?? null };
    },
    async listBookmarks(userId, lessonId) {
      let q = db.from('bookmarks').select('*').eq('user_id', userId).order('position_ms');
      if (lessonId) q = q.eq('lesson_id', lessonId);
      return unwrap(await q, 'audio.listBookmarks');
    },
    async createBookmark(row) {
      return unwrap(await db.from('bookmarks').upsert(row, { onConflict: 'user_id,client_event_id', ignoreDuplicates: false }).select('*').single(), 'audio.createBookmark');
    },
    async deleteBookmark(userId, id) {
      unwrap(await db.from('bookmarks').delete().eq('user_id', userId).eq('id', id), 'audio.deleteBookmark');
    },
    async listDownloadManifests(userId) {
      return unwrap(await db.from('user_download_manifests').select('*').eq('user_id', userId).is('revoked_at', null), 'audio.listDownloadManifests');
    },
    async upsertDownloadManifest(row) {
      return unwrap(await db.from('user_download_manifests').upsert(row, { onConflict: 'user_id,lesson_id,pack_id' }).select('*').single(), 'audio.upsertDownloadManifest');
    },
    async upsertCollection(row) {
      return unwrap(await db.from('audio_course_collections').upsert(row).select('*').single(), 'audio.upsertCollection');
    },
    async upsertChapter(row) {
      return unwrap(await db.from('audio_chapters').upsert(row).select('*').single(), 'audio.upsertChapter');
    },
    async upsertLesson(row) {
      return unwrap(await db.from('audio_lessons').upsert(row).select('*').single(), 'audio.upsertLesson');
    },
    async updateLesson(id, patch) {
      return unwrap(await db.from('audio_lessons').update(patch).eq('id', id).select('*').single(), 'audio.updateLesson');
    },
    async attachLessonAsset(row) {
      return unwrap(await db.from('audio_lesson_assets').upsert(row, { onConflict: 'lesson_id,asset_id,asset_type' }).select('*').single(), 'audio.attachLessonAsset');
    },
    async listCollectionsAdmin(filter) {
      const limit = clampLimit(filter?.limit);
      let q = db.from('audio_course_collections').select('*').order('created_at').order('id').limit(limit + 1);
      if (filter?.courseTrackId) q = q.eq('course_track_id', filter.courseTrackId);
      if (filter?.instructionLanguageCode) q = q.eq('instruction_language_code', filter.instructionLanguageCode);
      if (filter?.targetVarietyId) q = q.eq('target_variety_id', filter.targetVarietyId);
      if (filter?.state) q = q.eq('state', filter.state);
      if (filter?.q) {
        const term = `%${escapeLike(filter.q)}%`;
        q = q.or(SEARCHABLE_TITLE_LANGS.map((l) => `title_translations->>${l}.ilike.${term}`).join(','));
      }
      if (filter?.cursor) q = q.gt('created_at', filter.cursor);
      const rows = unwrap(await q, 'audio.listCollectionsAdmin');
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.created_at ?? null) : null };
    },
    async updateCollection(id, patch) {
      return unwrap(await db.from('audio_course_collections').update(patch).eq('id', id).select('*').single(), 'audio.updateCollection');
    },
    async deleteCollection(id) {
      unwrap(await db.from('audio_course_collections').delete().eq('id', id), 'audio.deleteCollection');
    },
    async getChapter(id) {
      return unwrapMaybe(await db.from('audio_chapters').select('*').eq('id', id).maybeSingle(), 'audio.getChapter');
    },
    async updateChapter(id, patch) {
      return unwrap(await db.from('audio_chapters').update(patch).eq('id', id).select('*').single(), 'audio.updateChapter');
    },
    async deleteChapter(id) {
      unwrap(await db.from('audio_chapters').delete().eq('id', id), 'audio.deleteChapter');
    },
    async deleteLesson(id) {
      unwrap(await db.from('audio_lessons').delete().eq('id', id), 'audio.deleteLesson');
    },
    async reorderChapters(collectionId, orderedIds) {
      const rows = unwrap(await db.rpc('reorder_audio_chapters', { p_collection_id: collectionId, p_ordered_ids: orderedIds }), 'audio.reorderChapters');
      return rows.map((r) => ({ id: r.id, sortOrder: r.sort_order }));
    },
    async reorderLessons(chapterId, orderedIds) {
      const rows = unwrap(await db.rpc('reorder_audio_lessons', { p_chapter_id: chapterId, p_ordered_ids: orderedIds }), 'audio.reorderLessons');
      return rows.map((r) => ({ id: r.id, sortOrder: r.sort_order }));
    },
    async countCollectionChildren(collectionIds) {
      const out = new Map<string, { chapters: number; lessons: number }>();
      if (collectionIds.length === 0) return out;
      const chapters = unwrap(await db.from('audio_chapters').select('id, collection_id').in('collection_id', collectionIds), 'audio.countCollectionChildren.chapters');
      const chapterIds = chapters.map((c) => c.id);
      const lessons = chapterIds.length ? unwrap(await db.from('audio_lessons').select('id, chapter_id').in('chapter_id', chapterIds), 'audio.countCollectionChildren.lessons') : [];
      const collectionOfChapter = new Map(chapters.map((c) => [c.id, c.collection_id]));
      for (const id of collectionIds) out.set(id, { chapters: 0, lessons: 0 });
      for (const c of chapters) out.get(c.collection_id)!.chapters += 1;
      for (const l of lessons) {
        const collectionId = collectionOfChapter.get(l.chapter_id);
        if (collectionId) out.get(collectionId)!.lessons += 1;
      }
      return out;
    },
    async countChapterLessons(chapterIds) {
      const out = new Map<string, number>();
      if (chapterIds.length === 0) return out;
      const lessons = unwrap(await db.from('audio_lessons').select('id, chapter_id').in('chapter_id', chapterIds), 'audio.countChapterLessons');
      for (const id of chapterIds) out.set(id, 0);
      for (const l of lessons) out.set(l.chapter_id, (out.get(l.chapter_id) ?? 0) + 1);
      return out;
    },
    async listLessonAssets(lessonId) {
      return unwrap(await db.from('audio_lesson_assets').select('*').eq('lesson_id', lessonId).order('sort_order'), 'audio.listLessonAssets');
    },
    async listLessonLinksForAsset(assetId, exceptLessonId) {
      let q = db.from('audio_lesson_assets').select('*').eq('asset_id', assetId);
      if (exceptLessonId) q = q.neq('lesson_id', exceptLessonId);
      return unwrap(await q, 'audio.listLessonLinksForAsset');
    },
    async detachLessonAsset(lessonId, assetId, assetType) {
      let q = db.from('audio_lesson_assets').delete().eq('lesson_id', lessonId).eq('asset_id', assetId);
      if (assetType) q = q.eq('asset_type', assetType);
      const rows = unwrap(await q.select('id'), 'audio.detachLessonAsset');
      return rows.length;
    },
    async listLessonSpeakers(lessonId) {
      return unwrap(await db.from('lesson_speakers').select('*').eq('lesson_id', lessonId).order('created_at'), 'audio.listLessonSpeakers');
    },
    async setLessonSpeakers(lessonId, speakerIds, role = 'other') {
      const wanted = [...new Set(speakerIds)];
      const current = unwrap(await db.from('lesson_speakers').select('*').eq('lesson_id', lessonId).eq('role', role), 'audio.setLessonSpeakers.read');
      const stale = current.filter((c) => !wanted.includes(c.speaker_id)).map((c) => c.id);
      if (stale.length) unwrap(await db.from('lesson_speakers').delete().in('id', stale), 'audio.setLessonSpeakers.delete');
      const have = new Set(current.map((c) => c.speaker_id));
      const missing = wanted.filter((id) => !have.has(id)).map((speaker_id) => ({ lesson_id: lessonId, speaker_id, role }));
      if (missing.length) unwrap(await db.from('lesson_speakers').insert(missing), 'audio.setLessonSpeakers.insert');
      return unwrap(await db.from('lesson_speakers').select('*').eq('lesson_id', lessonId).order('created_at'), 'audio.setLessonSpeakers.list');
    },
    async upsertTranscript(row) {
      return unwrap(await db.from('transcripts').upsert(row, { onConflict: 'lesson_id,revision' }).select('*').single(), 'audio.upsertTranscript');
    },
    async replaceTranscriptSegments(transcriptId, segments) {
      unwrap(await db.from('transcript_segments').delete().eq('transcript_id', transcriptId), 'audio.replaceTranscriptSegments.delete');
      if (segments.length === 0) return [];
      const rows = segments.map((s, i) => ({ ...s, transcript_id: transcriptId, sort_index: s.sort_index ?? i }));
      return unwrap(await db.from('transcript_segments').insert(rows).select('*').order('sort_index'), 'audio.replaceTranscriptSegments.insert');
    },
    async getTranscriptById(id) {
      return unwrapMaybe(await db.from('transcripts').select('*').eq('id', id).maybeSingle(), 'audio.getTranscriptById');
    },
    async listTranscriptsForLesson(lessonId) {
      return unwrap(await db.from('transcripts').select('*').eq('lesson_id', lessonId).order('revision'), 'audio.listTranscriptsForLesson');
    },
    async listTranscriptsForAssets(assetIds) {
      if (assetIds.length === 0) return [];
      return unwrap(await db.from('transcripts').select('*').in('source_asset_id', assetIds).order('created_at', { ascending: false }), 'audio.listTranscriptsForAssets');
    },
    async updateTranscript(id, patch) {
      return unwrap(await db.from('transcripts').update(patch).eq('id', id).select('*').single(), 'audio.updateTranscript');
    },
    async listTranscriptSegments(transcriptId) {
      return unwrap(await db.from('transcript_segments').select('*').eq('transcript_id', transcriptId).order('sort_index'), 'audio.listTranscriptSegments');
    },
    async updateTranscriptSegment(id, patch) {
      return unwrap(await db.from('transcript_segments').update(patch).eq('id', id).select('*').single(), 'audio.updateTranscriptSegment');
    },
    async upsertTranscriptTranslations(rows) {
      if (rows.length === 0) return 0;
      unwrap(await db.from('transcript_translations').upsert(rows, { onConflict: 'segment_id,language_code' }), 'audio.upsertTranscriptTranslations');
      return rows.length;
    },
    async listTranscriptTranslations(segmentIds, languageCode) {
      if (segmentIds.length === 0) return [];
      let q = db.from('transcript_translations').select('*').in('segment_id', segmentIds);
      if (languageCode) q = q.eq('language_code', languageCode);
      return unwrap(await q, 'audio.listTranscriptTranslations');
    },
    async replaceWordAlignments(segmentId, rows) {
      unwrap(await db.from('transcript_word_alignments').delete().eq('segment_id', segmentId), 'audio.replaceWordAlignments.delete');
      if (rows.length === 0) return 0;
      unwrap(await db.from('transcript_word_alignments').insert(rows.map((r) => ({ ...r, segment_id: segmentId }))), 'audio.replaceWordAlignments.insert');
      return rows.length;
    },
    async listWordAlignments(segmentId) {
      return unwrap(await db.from('transcript_word_alignments').select('*').eq('segment_id', segmentId).order('start_ms'), 'audio.listWordAlignments');
    },
    async upsertLessonTopics(rows) {
      if (rows.length === 0) return [];
      return unwrap(await db.from('lesson_topics').upsert(rows, { onConflict: 'lesson_id,topic_key' }).select('*'), 'audio.upsertLessonTopics');
    },
    async listLessonTopics(lessonId) {
      return unwrap(await db.from('lesson_topics').select('*').eq('lesson_id', lessonId).order('topic_key'), 'audio.listLessonTopics');
    },
    async findLessonIdsForAsset(assetId) {
      const rows = unwrap(await db.from('audio_lesson_assets').select('lesson_id').eq('asset_id', assetId), 'audio.findLessonIdsForAsset');
      return [...new Set(rows.map((r) => r.lesson_id))];
    },
    async listTranscriptLanguagesForLesson(lessonId) {
      const rows = unwrap(await db.from('transcripts').select('primary_language_code, status').eq('lesson_id', lessonId), 'audio.listTranscriptLanguagesForLesson');
      return [...new Set(rows.filter((t) => t.status !== 'failed' && t.status !== 'none').map((t) => t.primary_language_code))];
    },
    async findCollectionByTitle(title, languageCode) {
      const rows = unwrap(await db.from('audio_course_collections').select('*').eq(`title_translations->>${languageCode}`, title).limit(1), 'audio.findCollectionByTitle');
      return rows[0] ?? null;
    },
    async findChapterByTitle(collectionId, title, languageCode) {
      const rows = unwrap(await db.from('audio_chapters').select('*').eq('collection_id', collectionId).eq(`title_translations->>${languageCode}`, title).limit(1), 'audio.findChapterByTitle');
      return rows[0] ?? null;
    },
  };
}
