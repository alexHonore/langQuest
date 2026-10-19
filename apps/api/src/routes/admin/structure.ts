/**
 * §7.3 library structure (`adminCollection*` / `adminChapter*` / `adminLesson*`): collections → chapters → lessons
 * with atomic full-permutation reorders (`reorder_audio_chapters` / `reorder_audio_lessons`, migration 120).
 *
 * Rules: creates are idempotent on `idempotencyKey`; patches honour `expectedRevision` (412 on mismatch); deletes
 * are refused (`conflict`) while the entity or any child is `published`; detached assets return to `imported_draft`
 * and are never deleted; every mutation writes `content_revisions` + an audit row; changes under a published
 * collection emit `manifest.invalidated` so the edge cache and stored audio manifest are refreshed.
 */
import {
  ChapterCreateRequestSchema,
  ChapterDeleteRequestSchema,
  ChapterDeleteResponseSchema,
  ChapterPatchRequestSchema,
  ChapterResponseSchema,
  CollectionCreateRequestSchema,
  CollectionDeleteResponseSchema,
  CollectionPatchRequestSchema,
  CollectionResponseSchema,
  CollectionsListQuerySchema,
  CollectionsListResponseSchema,
  LessonAssetAttachRequestSchema,
  LessonAssetAttachResponseSchema,
  LessonAssetDetachResponseSchema,
  LessonCreateRequestSchema,
  LessonDeleteResponseSchema,
  LessonDetailResponseSchema,
  ReorderRequestSchema,
  ReorderResponseSchema,
  UuidSchema,
  isCourseTrackId,
  type ChapterDto,
  type CollectionDto,
  type ContentState,
  type LessonDetailResponse,
} from '@langquest/contracts';
import type { Insert, Row, Update } from '@langquest/db/types';
import { canTransitionContent } from '@langquest/media/rights';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, currentRevisions, recordRevision, titleOf } from '../../lib/content';
import { createDiff, findIdempotentCreate } from '../../lib/idempotent-create';
import type { RequestServices } from '../../services/context';

const IdParams = z.object({ id: UuidSchema });
const LessonAssetParams = z.object({ id: UuidSchema, assetId: UuidSchema });

type Translations = Record<string, string>;
const translations = (value: unknown): Translations => {
  const out: Translations = {};
  for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
};
/** PATCH translations merge per language (a patch names only the languages it changes; an empty string clears one). */
const mergeTranslations = (current: unknown, patch: Translations | undefined): Translations | undefined => (patch === undefined ? undefined : { ...translations(current), ...patch });

// --- lookups ----------------------------------------------------------------

async function loadCollection(s: RequestServices, id: string): Promise<Row<'audio_course_collections'>> {
  const row = await s.repos.audioLibrary.getCollection(id);
  if (!row) throw problem.notFound('Collection');
  return row;
}
async function loadChapter(s: RequestServices, id: string): Promise<Row<'audio_chapters'>> {
  const row = await s.repos.audioLibrary.getChapter(id);
  if (!row) throw problem.notFound('Chapter');
  return row;
}
async function loadLesson(s: RequestServices, id: string): Promise<Row<'audio_lessons'>> {
  const res = await s.service.from('audio_lessons').select('*').eq('id', id).maybeSingle();
  if (res.error) throw problem.internal('Could not read the lesson');
  if (!res.data) throw problem.notFound('Lesson');
  return res.data;
}

function assertRevision(what: string, current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) throw problem.precondition(`${what} revision is ${current}, expected ${expected}`, { currentRevision: current });
}

/** Published collections feed the learner audio manifest: structural changes invalidate it (edge cache + stored copy). */
async function invalidateCollectionManifest(s: RequestServices, collection: Row<'audio_course_collections'>, revision: number, reason: 'published' | 'unpublished' | 'localization_updated' | 'rights_revoked'): Promise<boolean> {
  if (collection.state !== 'published') return false;
  await s.events.emit('manifest.invalidated', { kind: 'audio_collection', courseTrackId: null, collectionId: collection.id, sourceLanguageCode: null, newVersion: revision, reason }, { idempotencyKey: `manifest.invalidated:audio_course_collections:${collection.id}:${revision}:${Date.now()}`, traceId: s.requestId });
  return true;
}

/**
 * Assets that lost their last lesson link go back to `imported_draft` (never deleted): an orphaned upload is exactly the
 * raw-import situation that state names, so the reset bypasses the forward-only state machine for every non-terminal
 * state; `published` / `rejected` assets keep their state (publication is undone through the unpublish route only).
 */
async function releaseOrphanedAssets(s: RequestServices, assetIds: readonly string[]): Promise<string[]> {
  const released: string[] = [];
  for (const assetId of new Set(assetIds)) {
    const stillLinked = await s.repos.audioLibrary.listLessonLinksForAsset(assetId);
    if (stillLinked.length) continue;
    const asset = await s.repos.rights.getAsset(assetId);
    if (!asset) continue;
    released.push(assetId);
    if (asset.state !== 'imported_draft' && asset.state !== 'published' && asset.state !== 'rejected') await s.repos.rights.updateAsset(assetId, { state: 'imported_draft' });
  }
  return released;
}

// --- DTOs -------------------------------------------------------------------

function collectionDto(row: Row<'audio_course_collections'>, counts: { chapters: number; lessons: number }, revision: number): CollectionDto {
  return {
    id: row.id,
    titleTranslations: translations(row.title_translations),
    descriptionTranslations: translations(row.description_translations),
    courseTrackId: row.course_track_id && isCourseTrackId(row.course_track_id) ? row.course_track_id : null,
    targetVarietyId: row.target_variety_id as CollectionDto['targetVarietyId'],
    instructionLanguageCode: row.instruction_language_code as CollectionDto['instructionLanguageCode'],
    region: row.region,
    instructorSpeakerId: row.instructor_speaker_id,
    coverVisualAssetId: row.cover_visual_asset_id,
    contentRightsId: row.content_rights_id,
    state: row.state as ContentState,
    sortOrder: row.sort_order,
    chapterCount: counts.chapters,
    lessonCount: counts.lessons,
    revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function collectionResponse(s: RequestServices, row: Row<'audio_course_collections'>) {
  const [counts, revision, chapters] = await Promise.all([s.repos.audioLibrary.countCollectionChildren([row.id]), currentRevision(s, 'audio_course_collections', row.id), s.repos.audioLibrary.listChapters(row.id)]);
  const lessonCounts = await s.repos.audioLibrary.countChapterLessons(chapters.map((ch) => ch.id));
  return CollectionResponseSchema.parse({
    ...collectionDto(row, counts.get(row.id) ?? { chapters: 0, lessons: 0 }, revision),
    chapters: chapters.map((ch) => ({ id: ch.id, sortOrder: ch.sort_order, titleTranslations: translations(ch.title_translations), lessonCount: lessonCounts.get(ch.id) ?? 0, state: ch.state })),
  });
}

function chapterDto(row: Row<'audio_chapters'>, lessonCount: number, revision: number): ChapterDto {
  return {
    id: row.id,
    collectionId: row.collection_id,
    titleTranslations: translations(row.title_translations),
    summaryTranslations: translations(row.summary_translations),
    sortOrder: row.sort_order,
    coverVisualAssetId: row.cover_visual_asset_id,
    state: row.state as ContentState,
    lessonCount,
    revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function chapterResponse(s: RequestServices, row: Row<'audio_chapters'>) {
  const [lessons, revision] = await Promise.all([s.repos.audioLibrary.listLessons(row.id), currentRevision(s, 'audio_chapters', row.id)]);
  return ChapterResponseSchema.parse({
    ...chapterDto(row, lessons.length, revision),
    lessons: lessons.map((l) => ({ id: l.id, sortOrder: l.sort_order, titleTranslations: translations(l.title_translations), state: l.state, durationMs: l.listen_length_ms })),
  });
}

async function lessonResponse(s: RequestServices, lesson: Row<'audio_lessons'>): Promise<LessonDetailResponse> {
  const [chapter, links, speakerLinks, revision] = await Promise.all([loadChapter(s, lesson.chapter_id), s.repos.audioLibrary.listLessonAssets(lesson.id), s.repos.audioLibrary.listLessonSpeakers(lesson.id), currentRevision(s, 'audio_lessons', lesson.id)]);
  const assetIds = [...new Set(links.map((l) => l.asset_id))];
  const media = assetIds.length ? ((await s.service.from('media_assets').select('id, state, duration_ms').in('id', assetIds)).data ?? []) : [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  return LessonDetailResponseSchema.parse({
    id: lesson.id,
    chapterId: lesson.chapter_id,
    collectionId: chapter.collection_id,
    titleTranslations: translations(lesson.title_translations),
    descriptionTranslations: translations(lesson.description_translations),
    sortOrder: lesson.sort_order,
    episodeNumber: lesson.episode_number,
    level: lesson.level,
    targetVarietyId: lesson.target_variety_id,
    instructionLanguageCode: lesson.instruction_language_code,
    spokenLanguageCodes: lesson.spoken_language_codes,
    regionalDialect: lesson.regional_dialect,
    topic: lesson.topic,
    tags: lesson.tags,
    scene: lesson.scene,
    speakerIds: [...new Set(speakerLinks.map((sl) => sl.speaker_id))],
    coverVisualAssetId: lesson.cover_visual_asset_id,
    contentRightsId: lesson.content_rights_id,
    visibility: lesson.visibility,
    qualityReviewStatus: lesson.quality_review_status,
    state: lesson.state,
    revision,
    assets: links.map((l) => ({ assetId: l.asset_id, assetType: l.asset_type, sortOrder: l.sort_order, state: mediaById.get(l.asset_id)?.state ?? 'imported_draft', durationMs: mediaById.get(l.asset_id)?.duration_ms ?? null })),
    transcriptStatus: lesson.transcript_status,
    createdAt: lesson.created_at,
    updatedAt: lesson.updated_at,
  });
}

/** Link one asset to a lesson, moving it from another lesson when needed; returns the move source (or null). */
async function attachAsset(s: RequestServices, lesson: Row<'audio_lessons'>, input: { assetId: string; assetType: Row<'audio_lesson_assets'>['asset_type']; sortOrder: number }): Promise<{ movedFromLessonId: string | null }> {
  const asset = await s.repos.rights.getAsset(input.assetId);
  if (!asset) throw problem.validation('assetId does not exist', { assetId: input.assetId });
  if (asset.kind !== 'audio') throw problem.validation(`Asset is ${asset.kind}; only audio assets can be attached to a lesson`);
  if (asset.disposition !== 'active') throw problem.rights(`Asset is ${asset.disposition} and cannot be attached`);
  const elsewhere = (await s.repos.audioLibrary.listLessonLinksForAsset(input.assetId, lesson.id)).filter((l) => l.asset_type === input.assetType);
  let movedFromLessonId: string | null = null;
  for (const link of elsewhere) {
    await s.repos.audioLibrary.detachLessonAsset(link.lesson_id, input.assetId, input.assetType);
    await recordRevision(s, 'audio_lessons', link.lesson_id, { assetMovedTo: lesson.id, assetId: input.assetId, assetType: input.assetType });
    movedFromLessonId ??= link.lesson_id;
  }
  await s.repos.audioLibrary.attachLessonAsset({ lesson_id: lesson.id, asset_id: input.assetId, asset_type: input.assetType, sort_order: input.sortOrder });
  if (asset.state === 'imported_draft' && canTransitionContent('imported_draft', 'metadata_needed')) await s.repos.rights.updateAsset(input.assetId, { state: 'metadata_needed' }).catch(() => undefined);
  return { movedFromLessonId };
}

export function registerStructureRoutes(define: DefineRoute): void {
  // --- collections ---------------------------------------------------------
  define('adminCollectionsList', {}, async (c) => {
    const q = parseQuery(c, CollectionsListQuerySchema);
    const s = c.get('services')!;
    const page = await s.repos.audioLibrary.listCollectionsAdmin({ q: q.q, courseTrackId: q.trackId, state: q.state, instructionLanguageCode: q.instructionLanguage, cursor: q.cursor, limit: q.limit });
    const ids = page.items.map((r) => r.id);
    const [counts, revisions] = await Promise.all([s.repos.audioLibrary.countCollectionChildren(ids), currentRevisions(s, 'audio_course_collections', ids)]);
    return respondOk(c, CollectionsListResponseSchema.parse({ items: page.items.map((r) => collectionDto(r, counts.get(r.id) ?? { chapters: 0, lessons: 0 }, revisions.get(r.id) ?? 0)), nextCursor: page.nextCursor, total: null }));
  });

  define('adminCollectionCreate', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, CollectionCreateRequestSchema);
    const s = c.get('services')!;
    const replay = await findIdempotentCreate(s, 'collection.create', body.idempotencyKey);
    if (replay) {
      const existing = await s.repos.audioLibrary.getCollection(replay);
      if (existing) return respondOk(c, await collectionResponse(s, existing), 200);
    }
    if (body.instructorSpeakerId && !(await s.repos.speakers.getById(body.instructorSpeakerId))) throw problem.validation('instructorSpeakerId does not exist');
    if (body.contentRightsId && !(await s.repos.rights.getById(body.contentRightsId))) throw problem.validation('contentRightsId does not exist');
    const row: Insert<'audio_course_collections'> = { title_translations: body.titleTranslations as never, description_translations: body.descriptionTranslations as never, course_track_id: body.courseTrackId, target_variety_id: body.targetVarietyId, instruction_language_code: body.instructionLanguageCode, region: body.region, instructor_speaker_id: body.instructorSpeakerId, cover_visual_asset_id: body.coverVisualAssetId, content_rights_id: body.contentRightsId, sort_order: body.sortOrder, state: 'imported_draft' };
    const created = await s.repos.audioLibrary.upsertCollection(row);
    await recordRevision(s, 'audio_course_collections', created.id, createDiff('collection.create', body.idempotencyKey));
    s.audit({ action: 'collection.create', entityTable: 'audio_course_collections', entityId: created.id, after: { idempotencyKey: body.idempotencyKey, title: titleOf(created.title_translations), courseTrackId: created.course_track_id } });
    return respondOk(c, await collectionResponse(s, created), 201);
  });

  define('adminCollectionGet', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    return respondOk(c, await collectionResponse(s, await loadCollection(s, id)));
  });

  define('adminCollectionPatch', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, CollectionPatchRequestSchema);
    const s = c.get('services')!;
    const before = await loadCollection(s, id);
    assertRevision('Collection', await currentRevision(s, 'audio_course_collections', id), body.expectedRevision);
    if (body.instructorSpeakerId && !(await s.repos.speakers.getById(body.instructorSpeakerId))) throw problem.validation('instructorSpeakerId does not exist');
    if (body.contentRightsId && !(await s.repos.rights.getById(body.contentRightsId))) throw problem.validation('contentRightsId does not exist');
    const patch: Update<'audio_course_collections'> = {};
    const title = mergeTranslations(before.title_translations, body.titleTranslations);
    if (title) patch.title_translations = title as never;
    const desc = mergeTranslations(before.description_translations, body.descriptionTranslations);
    if (desc) patch.description_translations = desc as never;
    if (body.courseTrackId !== undefined) patch.course_track_id = body.courseTrackId;
    if (body.targetVarietyId !== undefined) patch.target_variety_id = body.targetVarietyId;
    if (body.instructionLanguageCode !== undefined) patch.instruction_language_code = body.instructionLanguageCode;
    if (body.region !== undefined) patch.region = body.region;
    if (body.instructorSpeakerId !== undefined) patch.instructor_speaker_id = body.instructorSpeakerId;
    if (body.coverVisualAssetId !== undefined) patch.cover_visual_asset_id = body.coverVisualAssetId;
    if (body.contentRightsId !== undefined) patch.content_rights_id = body.contentRightsId;
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
    const updated = Object.keys(patch).length ? await s.repos.audioLibrary.updateCollection(id, patch) : before;
    const { expectedRevision: _expected, ...diff } = body;
    const revision = await recordRevision(s, 'audio_course_collections', id, diff as Record<string, unknown>);
    const manifestInvalidated = await invalidateCollectionManifest(s, updated, revision, 'localization_updated');
    s.audit({ action: 'collection.patch', entityTable: 'audio_course_collections', entityId: id, before: { state: before.state }, after: { fields: Object.keys(patch), revision, manifestInvalidated } });
    return respondOk(c, await collectionResponse(s, updated));
  });

  define('adminCollectionDelete', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const collection = await loadCollection(s, id);
    const chapters = await s.repos.audioLibrary.listChapters(id);
    const chapterIds = chapters.map((ch) => ch.id);
    const lessons = chapterIds.length ? ((await s.service.from('audio_lessons').select('id, state').in('chapter_id', chapterIds)).data ?? []) : [];
    const published = [collection.state === 'published' ? `collection ${id}` : null, ...chapters.filter((ch) => ch.state === 'published').map((ch) => `chapter ${ch.id}`), ...lessons.filter((l) => l.state === 'published').map((l) => `lesson ${l.id}`)].filter((v): v is string => v !== null);
    if (published.length) throw problem.conflict('Unpublish the collection and its children before deleting it', { published });
    const lessonIds = lessons.map((l) => l.id);
    const links = lessonIds.length ? ((await s.service.from('audio_lesson_assets').select('asset_id').in('lesson_id', lessonIds)).data ?? []) : [];
    await s.repos.audioLibrary.deleteCollection(id);
    const orphanedAssetIds = await releaseOrphanedAssets(s, links.map((l) => l.asset_id));
    s.audit({ action: 'collection.delete', entityTable: 'audio_course_collections', entityId: id, before: { title: titleOf(collection.title_translations), state: collection.state, chapters: chapters.length, lessons: lessons.length }, after: { orphanedAssets: orphanedAssetIds.length } });
    return respondOk(c, CollectionDeleteResponseSchema.parse({ id, deleted: true, orphanedAssetIds }));
  });

  define('adminChaptersReorder', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ReorderRequestSchema);
    const s = c.get('services')!;
    const collection = await loadCollection(s, id);
    assertRevision('Collection', await currentRevision(s, 'audio_course_collections', id), body.expectedRevision);
    // The RPC rejects partial lists / foreign ids / duplicates with 23514 → `validation_failed` (toProblem).
    const items = await s.repos.audioLibrary.reorderChapters(id, body.orderedIds);
    const revision = await recordRevision(s, 'audio_course_collections', id, { reorderChapters: body.orderedIds, idempotencyKey: body.idempotencyKey });
    const manifestInvalidated = await invalidateCollectionManifest(s, collection, revision, 'localization_updated');
    s.audit({ action: 'collection.reorder_chapters', entityTable: 'audio_course_collections', entityId: id, after: { orderedIds: body.orderedIds, revision, manifestInvalidated } });
    return respondOk(c, ReorderResponseSchema.parse({ parentId: id, revision, items }));
  });

  // --- chapters ------------------------------------------------------------
  define('adminChapterCreate', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, ChapterCreateRequestSchema);
    const s = c.get('services')!;
    const replay = await findIdempotentCreate(s, 'chapter.create', body.idempotencyKey);
    if (replay) {
      const existing = await s.repos.audioLibrary.getChapter(replay);
      if (existing) return respondOk(c, await chapterResponse(s, existing), 200);
    }
    const collection = await loadCollection(s, body.collectionId);
    const row: Insert<'audio_chapters'> = { collection_id: collection.id, title_translations: body.titleTranslations as never, summary_translations: body.summaryTranslations as never, sort_order: body.sortOrder, cover_visual_asset_id: body.coverVisualAssetId, state: 'imported_draft' };
    const created = await s.repos.audioLibrary.upsertChapter(row);
    await recordRevision(s, 'audio_chapters', created.id, createDiff('chapter.create', body.idempotencyKey, { collectionId: collection.id }));
    const revision = await recordRevision(s, 'audio_course_collections', collection.id, { chapterAdded: created.id });
    await invalidateCollectionManifest(s, collection, revision, 'localization_updated');
    s.audit({ action: 'chapter.create', entityTable: 'audio_chapters', entityId: created.id, after: { idempotencyKey: body.idempotencyKey, collectionId: collection.id, title: titleOf(created.title_translations) } });
    return respondOk(c, await chapterResponse(s, created), 201);
  });

  define('adminChapterGet', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    return respondOk(c, await chapterResponse(s, await loadChapter(s, id)));
  });

  define('adminChapterPatch', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ChapterPatchRequestSchema);
    const s = c.get('services')!;
    const before = await loadChapter(s, id);
    assertRevision('Chapter', await currentRevision(s, 'audio_chapters', id), body.expectedRevision);
    const patch: Update<'audio_chapters'> = {};
    const title = mergeTranslations(before.title_translations, body.titleTranslations);
    if (title) patch.title_translations = title as never;
    const summary = mergeTranslations(before.summary_translations, body.summaryTranslations);
    if (summary) patch.summary_translations = summary as never;
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
    if (body.coverVisualAssetId !== undefined) patch.cover_visual_asset_id = body.coverVisualAssetId;
    const moved = body.collectionId !== undefined && body.collectionId !== before.collection_id;
    if (moved) {
      await loadCollection(s, body.collectionId!);
      patch.collection_id = body.collectionId;
    }
    const updated = Object.keys(patch).length ? await s.repos.audioLibrary.updateChapter(id, patch) : before;
    const { expectedRevision: _expected, ...diff } = body;
    const revision = await recordRevision(s, 'audio_chapters', id, diff as Record<string, unknown>);
    // A move is recorded on both collections (and both manifests are invalidated when published).
    const touched = moved ? [before.collection_id, updated.collection_id] : [updated.collection_id];
    let manifestInvalidated = false;
    for (const collectionId of touched) {
      const collection = await s.repos.audioLibrary.getCollection(collectionId);
      if (!collection) continue;
      const rev = await recordRevision(s, 'audio_course_collections', collectionId, moved ? { chapterMoved: id, from: before.collection_id, to: updated.collection_id } : { chapterPatched: id, revision });
      manifestInvalidated = (await invalidateCollectionManifest(s, collection, rev, 'localization_updated')) || manifestInvalidated;
    }
    s.audit({ action: 'chapter.patch', entityTable: 'audio_chapters', entityId: id, before: { collectionId: before.collection_id }, after: { fields: Object.keys(patch), revision, moved, manifestInvalidated } });
    return respondOk(c, await chapterResponse(s, updated));
  });

  define('adminChapterDelete', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ChapterDeleteRequestSchema);
    const s = c.get('services')!;
    const chapter = await loadChapter(s, id);
    const lessons = await s.repos.audioLibrary.listLessons(id);
    const published = [chapter.state === 'published' ? `chapter ${id}` : null, ...lessons.filter((l) => l.state === 'published').map((l) => `lesson ${l.id}`)].filter((v): v is string => v !== null);
    if (published.length) throw problem.conflict('Unpublish the chapter and its lessons before deleting it', { published });
    const movedLessonIds: string[] = [];
    let orphanAssetIds: string[] = [];
    if (lessons.length && body.moveLessonsToChapterId) {
      if (body.moveLessonsToChapterId === id) throw problem.validation('moveLessonsToChapterId must be another chapter');
      const target = await loadChapter(s, body.moveLessonsToChapterId);
      const offset = (await s.repos.audioLibrary.listLessons(target.id)).length;
      for (const [i, lesson] of lessons.entries()) {
        await s.repos.audioLibrary.updateLesson(lesson.id, { chapter_id: target.id, sort_order: offset + i });
        await recordRevision(s, 'audio_lessons', lesson.id, { movedToChapter: target.id, fromChapter: id });
        movedLessonIds.push(lesson.id);
      }
    } else if (lessons.length) {
      const links = (await s.service.from('audio_lesson_assets').select('asset_id').in('lesson_id', lessons.map((l) => l.id))).data ?? [];
      orphanAssetIds = links.map((l) => l.asset_id);
    }
    await s.repos.audioLibrary.deleteChapter(id);
    const released = await releaseOrphanedAssets(s, orphanAssetIds);
    const collection = await s.repos.audioLibrary.getCollection(chapter.collection_id);
    if (collection) await invalidateCollectionManifest(s, collection, await recordRevision(s, 'audio_course_collections', collection.id, { chapterDeleted: id, movedLessonIds }), 'localization_updated');
    s.audit({ action: 'chapter.delete', entityTable: 'audio_chapters', entityId: id, before: { collectionId: chapter.collection_id, lessons: lessons.length }, after: { movedLessonIds, releasedAssets: released.length } });
    return respondOk(c, ChapterDeleteResponseSchema.parse({ id, deleted: true, movedLessonIds }));
  });

  define('adminLessonsReorder', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ReorderRequestSchema);
    const s = c.get('services')!;
    const chapter = await loadChapter(s, id);
    assertRevision('Chapter', await currentRevision(s, 'audio_chapters', id), body.expectedRevision);
    const items = await s.repos.audioLibrary.reorderLessons(id, body.orderedIds);
    const revision = await recordRevision(s, 'audio_chapters', id, { reorderLessons: body.orderedIds, idempotencyKey: body.idempotencyKey });
    const collection = await s.repos.audioLibrary.getCollection(chapter.collection_id);
    const manifestInvalidated = collection ? await invalidateCollectionManifest(s, collection, revision, 'localization_updated') : false;
    s.audit({ action: 'chapter.reorder_lessons', entityTable: 'audio_chapters', entityId: id, after: { orderedIds: body.orderedIds, revision, manifestInvalidated } });
    return respondOk(c, ReorderResponseSchema.parse({ parentId: id, revision, items }));
  });

  // --- lessons -------------------------------------------------------------
  define('adminLessonCreate', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, LessonCreateRequestSchema);
    const s = c.get('services')!;
    const replay = await findIdempotentCreate(s, 'lesson.create', body.idempotencyKey);
    if (replay) {
      const existing = (await s.service.from('audio_lessons').select('*').eq('id', replay).maybeSingle()).data;
      if (existing) return respondOk(c, await lessonResponse(s, existing), 200);
    }
    const chapter = await loadChapter(s, body.chapterId);
    if (body.speakerIds.length) {
      const found = await s.repos.speakers.getByIds(body.speakerIds);
      const missing = body.speakerIds.filter((sid) => !found.some((f) => f.id === sid));
      if (missing.length) throw problem.validation('Unknown speaker ids', { speakerIds: missing });
    }
    const row: Insert<'audio_lessons'> = { chapter_id: chapter.id, title_translations: body.titleTranslations as never, description_translations: body.descriptionTranslations as never, sort_order: body.sortOrder, level: body.level, target_variety_id: body.targetVarietyId, instruction_language_code: body.instructionLanguageCode, state: 'imported_draft', visibility: 'private' };
    const created = await s.repos.audioLibrary.upsertLesson(row);
    if (body.speakerIds.length) await s.repos.audioLibrary.setLessonSpeakers(created.id, body.speakerIds);
    let movedFromLessonId: string | null = null;
    if (body.assetId) ({ movedFromLessonId } = await attachAsset(s, created, { assetId: body.assetId, assetType: 'master', sortOrder: 0 }));
    await recordRevision(s, 'audio_lessons', created.id, createDiff('lesson.create', body.idempotencyKey, { chapterId: chapter.id, assetId: body.assetId ?? null, movedFromLessonId }));
    const collection = await s.repos.audioLibrary.getCollection(chapter.collection_id);
    if (collection) await invalidateCollectionManifest(s, collection, await recordRevision(s, 'audio_course_collections', collection.id, { lessonAdded: created.id, chapterId: chapter.id }), 'localization_updated');
    s.audit({ action: 'lesson.create', entityTable: 'audio_lessons', entityId: created.id, after: { idempotencyKey: body.idempotencyKey, chapterId: chapter.id, title: titleOf(created.title_translations), assetId: body.assetId ?? null, speakers: body.speakerIds.length } });
    return respondOk(c, await lessonResponse(s, created), 201);
  });

  define('adminLessonGet', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    return respondOk(c, await lessonResponse(s, await loadLesson(s, id)));
  });

  define('adminLessonDelete', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const lesson = await loadLesson(s, id);
    if (lesson.state === 'published') throw problem.conflict('Unpublish the lesson before deleting it', { state: lesson.state });
    const links = await s.repos.audioLibrary.listLessonAssets(id);
    await s.repos.audioLibrary.deleteLesson(id);
    const detachedAssetIds = await releaseOrphanedAssets(s, links.map((l) => l.asset_id));
    const chapter = await s.repos.audioLibrary.getChapter(lesson.chapter_id);
    const collection = chapter ? await s.repos.audioLibrary.getCollection(chapter.collection_id) : null;
    if (collection) await invalidateCollectionManifest(s, collection, await recordRevision(s, 'audio_course_collections', collection.id, { lessonDeleted: id }), 'localization_updated');
    s.audit({ action: 'lesson.delete', entityTable: 'audio_lessons', entityId: id, before: { title: titleOf(lesson.title_translations), state: lesson.state, chapterId: lesson.chapter_id }, after: { detachedAssetIds } });
    return respondOk(c, LessonDeleteResponseSchema.parse({ id, deleted: true, detachedAssetIds }));
  });

  define('adminLessonAssetAttach', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, LessonAssetAttachRequestSchema);
    const s = c.get('services')!;
    const lesson = await loadLesson(s, id);
    assertRevision('Lesson', await currentRevision(s, 'audio_lessons', id), body.expectedRevision);
    const { movedFromLessonId } = await attachAsset(s, lesson, { assetId: body.assetId, assetType: body.assetType, sortOrder: body.sortOrder });
    const revision = await recordRevision(s, 'audio_lessons', id, { attachAsset: body.assetId, assetType: body.assetType, sortOrder: body.sortOrder, movedFromLessonId });
    s.audit({ action: 'lesson.asset_attach', entityTable: 'audio_lessons', entityId: id, after: { assetId: body.assetId, assetType: body.assetType, movedFromLessonId, revision } });
    return respondOk(c, LessonAssetAttachResponseSchema.parse({ lessonId: id, assetId: body.assetId, assetType: body.assetType, revision, movedFromLessonId }), movedFromLessonId ? 200 : 201);
  });

  define('adminLessonAssetDetach', { role: 'contentEditor' }, async (c) => {
    const { id, assetId } = parseParams(c, LessonAssetParams);
    const s = c.get('services')!;
    const lesson = await loadLesson(s, id);
    if (lesson.state === 'published') throw problem.conflict('Unpublish the lesson before detaching its audio', { state: lesson.state });
    const removed = await s.repos.audioLibrary.detachLessonAsset(id, assetId);
    if (removed === 0) throw problem.notFound('Lesson asset link');
    await releaseOrphanedAssets(s, [assetId]);
    const asset = await s.repos.rights.getAsset(assetId);
    const revision = await recordRevision(s, 'audio_lessons', id, { detachAsset: assetId, removedLinks: removed });
    s.audit({ action: 'lesson.asset_detach', entityTable: 'audio_lessons', entityId: id, after: { assetId, removedLinks: removed, assetState: asset?.state ?? null, revision } });
    return respondOk(c, LessonAssetDetachResponseSchema.parse({ lessonId: id, assetId, revision, assetState: asset?.state ?? 'imported_draft' }));
  });
}
