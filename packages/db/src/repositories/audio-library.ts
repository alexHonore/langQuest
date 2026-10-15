/** Audio library (§5.3, §6.3): collections, chapters, lessons, assets, transcripts, learner audio state. */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import { clampLimit, type Insert, type PageQuery, type PageResult, type Row, type Update } from '../types';
import { MEDIA_ASSET_COLUMNS, type MediaAssetRow } from './rights';

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
  /** Revision-guarded upsert: an older client revision never overwrites a newer position. */
  putProgress(row: Insert<'user_audio_progress'> & { user_id: string; lesson_id: string; revision: number }): Promise<{ row: Row<'user_audio_progress'>; superseded: boolean }>;
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
  upsertTranscript(row: Insert<'transcripts'>): Promise<Row<'transcripts'>>;
  replaceTranscriptSegments(transcriptId: string, segments: Omit<Insert<'transcript_segments'>, 'transcript_id'>[]): Promise<Row<'transcript_segments'>[]>;
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
    async putProgress(row) {
      const existing = unwrapMaybe(await db.from('user_audio_progress').select('*').eq('user_id', row.user_id).eq('lesson_id', row.lesson_id).single(), 'audio.putProgress.read');
      if (existing && existing.revision > row.revision) return { row: existing, superseded: true };
      const merged: Insert<'user_audio_progress'> = {
        ...row,
        completed: Boolean(existing?.completed) || Boolean(row.completed),
        completed_at: existing?.completed_at ?? row.completed_at ?? (row.completed ? new Date().toISOString() : null),
        play_count: (existing?.play_count ?? 0) + 1,
      };
      const saved = unwrap(await db.from('user_audio_progress').upsert(merged, { onConflict: 'user_id,lesson_id' }).select('*').single(), 'audio.putProgress');
      return { row: saved, superseded: false };
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
    async upsertTranscript(row) {
      return unwrap(await db.from('transcripts').upsert(row, { onConflict: 'lesson_id,revision' }).select('*').single(), 'audio.upsertTranscript');
    },
    async replaceTranscriptSegments(transcriptId, segments) {
      unwrap(await db.from('transcript_segments').delete().eq('transcript_id', transcriptId), 'audio.replaceTranscriptSegments.delete');
      if (segments.length === 0) return [];
      const rows = segments.map((s, i) => ({ ...s, transcript_id: transcriptId, sort_index: s.sort_index ?? i }));
      return unwrap(await db.from('transcript_segments').insert(rows).select('*').order('sort_index'), 'audio.replaceTranscriptSegments.insert');
    },
  };
}
