/**
 * §7.3 library structure (`adminCollection*` / `adminChapter*` / `adminLesson*`): collections → chapters → lessons
 * with atomic full-permutation reorders (`reorder_audio_chapters` / `reorder_audio_lessons`, migration 120).
 *
 * Rules: creates are idempotent on `idempotencyKey`; patches honour `expectedRevision` (412 on mismatch); deletes
 * are refused (`conflict`) while the entity or any child is `published`, and so are detaching audio from a published
 * lesson and moving it off one by attaching it elsewhere; detached assets return to `imported_draft`
 * and are never deleted; every mutation writes `content_revisions` + an audit row; changes under a published
 * collection emit `manifest.invalidated` so the edge cache and stored audio manifest are refreshed.
 *
 * Integrity (shared helpers in `./content`): every revision carries the restorable snapshot of its row
 * (`recordRestorableRevision`, R-7.3-04), and the `expectedRevision` guards are atomic (`guardedEdit`): everything
 * that can be refused (permutation, asset checks) is checked first, then revision `expectedRevision + 1` is claimed
 * under the unique key, then the write runs — row updates conditional on the `updated_at` that was read.
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
import type { MediaAssetRow } from '@langquest/db/repositories/rights';
import type { Insert, Row, Update } from '@langquest/db/types';
import { canTransitionContent } from '@langquest/media/rights';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, currentRevisions, titleOf } from '../../lib/content';
import { createDiff, findIdempotentCreate } from '../../lib/idempotent-create';
import type { RequestServices } from '../../services/context';
import { guardedEdit, recordRestorableRevision, restorableSnapshot, staleRevision, updateIfUnchanged } from './content';

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
  if (expected !== undefined && expected !== current) throw staleRevision(what, current, expected);
}

/**
 * The reorder RPCs' rule (a full permutation of the current children, each once), checked BEFORE a revision is
 * claimed so a malformed list is a plain 422 (the RPC still enforces it atomically).
 */
function assertPermutation(child: 'chapter' | 'lesson', parent: 'collection' | 'chapter', currentIds: readonly string[], orderedIds: readonly string[]): void {
  const ordered = new Set(orderedIds);
  if (ordered.size !== orderedIds.length || ordered.size !== currentIds.length || currentIds.some((cid) => !ordered.has(cid))) throw problem.validation(`orderedIds must list every ${child} of the ${parent} exactly once`, { orderedIds: [...orderedIds] });
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

interface AttachPlan {
  asset: MediaAssetRow;
  assetType: Row<'audio_lesson_assets'>['asset_type'];
  sortOrder: number;
  /** Links of the same asset type on other lessons: the asset moves from them. */
  moveFrom: Row<'audio_lesson_assets'>[];
  movedFromLessonId: string | null;
}

/** Check that an asset can be linked and plan the move (read-only: nothing is written before every check passed). */
async function planAttach(s: RequestServices, lessonId: string | null, input: { assetId: string; assetType: Row<'audio_lesson_assets'>['asset_type']; sortOrder: number }): Promise<AttachPlan> {
  const asset = await s.repos.rights.getAsset(input.assetId);
  if (!asset) throw problem.validation('assetId does not exist', { assetId: input.assetId });
  if (asset.kind !== 'audio') throw problem.validation(`Asset is ${asset.kind}; only audio assets can be attached to a lesson`);
  if (asset.disposition !== 'active') throw problem.rights(`Asset is ${asset.disposition} and cannot be attached`);
  const moveFrom = (await s.repos.audioLibrary.listLessonLinksForAsset(input.assetId, lessonId ?? undefined)).filter((l) => l.asset_type === input.assetType);
  // Moving the audio of a PUBLISHED lesson would leave that lesson live without it (and its manifest stale): refused
  // like the direct detach (`adminLessonAssetDetach`), before anything is written.
  if (moveFrom.length) {
    const res = await s.service.from('audio_lessons').select('id, state').in('id', [...new Set(moveFrom.map((l) => l.lesson_id))]);
    if (res.error) throw problem.internal(`Could not read the lessons using this asset: ${res.error.message}`);
    const published = (res.data ?? []).filter((l) => l.state === 'published').map((l) => l.id);
    if (published.length) throw problem.conflict('This audio belongs to a published lesson; unpublish that lesson before moving its audio', { publishedLessonIds: published });
  }
  return { asset, assetType: input.assetType, sortOrder: input.sortOrder, moveFrom, movedFromLessonId: moveFrom[0]?.lesson_id ?? null };
}

/** Link the planned asset to `lessonId`, moving it from the other lessons (each records a revision with snapshot). */
async function performAttach(s: RequestServices, lessonId: string, plan: AttachPlan): Promise<void> {
  for (const link of plan.moveFrom) {
    await s.repos.audioLibrary.detachLessonAsset(link.lesson_id, plan.asset.id, plan.assetType);
    await recordRestorableRevision(s, 'audio_lessons', link.lesson_id, { assetMovedTo: lessonId, assetId: plan.asset.id, assetType: plan.assetType });
  }
  await s.repos.audioLibrary.attachLessonAsset({ lesson_id: lessonId, asset_id: plan.asset.id, asset_type: plan.assetType, sort_order: plan.sortOrder });
  if (plan.asset.state === 'imported_draft' && canTransitionContent('imported_draft', 'metadata_needed')) await s.repos.rights.updateAsset(plan.asset.id, { state: 'metadata_needed' }).catch(() => undefined);
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
    await recordRestorableRevision(s, 'audio_course_collections', created.id, createDiff('collection.create', body.idempotencyKey), { row: created });
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
    const current = await currentRevision(s, 'audio_course_collections', id);
    assertRevision('Collection', current, body.expectedRevision);
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
    const { expectedRevision: _expected, ...diff } = body;
    const { result: updated, revision } = await guardedEdit(s, { table: 'audio_course_collections', id, what: 'Collection', expected: body.expectedRevision, current, diff: diff as Record<string, unknown>, snapshot: restorableSnapshot('audio_course_collections', { ...before, ...patch }) }, async () => (Object.keys(patch).length ? ((await updateIfUnchanged(s, 'audio_course_collections', before, patch, 'Collection')) as Row<'audio_course_collections'>) : before));
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
    const current = await currentRevision(s, 'audio_course_collections', id);
    assertRevision('Collection', current, body.expectedRevision);
    assertPermutation('chapter', 'collection', (await s.repos.audioLibrary.listChapters(id)).map((ch) => ch.id), body.orderedIds);
    // The RPC still rejects partial lists / foreign ids / duplicates atomically (23514 → `validation_failed`).
    const { result: items, revision } = await guardedEdit(s, { table: 'audio_course_collections', id, what: 'Collection', expected: body.expectedRevision, current, diff: { reorderChapters: body.orderedIds, idempotencyKey: body.idempotencyKey }, snapshot: restorableSnapshot('audio_course_collections', collection) }, () => s.repos.audioLibrary.reorderChapters(id, body.orderedIds));
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
    await recordRestorableRevision(s, 'audio_chapters', created.id, createDiff('chapter.create', body.idempotencyKey, { collectionId: collection.id }), { row: created });
    const revision = await recordRestorableRevision(s, 'audio_course_collections', collection.id, { chapterAdded: created.id }, { row: collection });
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
    const current = await currentRevision(s, 'audio_chapters', id);
    assertRevision('Chapter', current, body.expectedRevision);
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
    const { expectedRevision: _expected, ...diff } = body;
    const { result: updated, revision } = await guardedEdit(s, { table: 'audio_chapters', id, what: 'Chapter', expected: body.expectedRevision, current, diff: diff as Record<string, unknown>, snapshot: restorableSnapshot('audio_chapters', { ...before, ...patch }) }, async () => (Object.keys(patch).length ? ((await updateIfUnchanged(s, 'audio_chapters', before, patch, 'Chapter')) as Row<'audio_chapters'>) : before));
    // A move is recorded on both collections (and both manifests are invalidated when published).
    const touched = moved ? [before.collection_id, updated.collection_id] : [updated.collection_id];
    let manifestInvalidated = false;
    for (const collectionId of touched) {
      const collection = await s.repos.audioLibrary.getCollection(collectionId);
      if (!collection) continue;
      const rev = await recordRestorableRevision(s, 'audio_course_collections', collectionId, moved ? { chapterMoved: id, from: before.collection_id, to: updated.collection_id } : { chapterPatched: id, revision }, { row: collection });
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
        const movedLesson = await s.repos.audioLibrary.updateLesson(lesson.id, { chapter_id: target.id, sort_order: offset + i });
        await recordRestorableRevision(s, 'audio_lessons', lesson.id, { movedToChapter: target.id, fromChapter: id }, { row: movedLesson });
        movedLessonIds.push(lesson.id);
      }
    } else if (lessons.length) {
      const links = (await s.service.from('audio_lesson_assets').select('asset_id').in('lesson_id', lessons.map((l) => l.id))).data ?? [];
      orphanAssetIds = links.map((l) => l.asset_id);
    }
    await s.repos.audioLibrary.deleteChapter(id);
    const released = await releaseOrphanedAssets(s, orphanAssetIds);
    const collection = await s.repos.audioLibrary.getCollection(chapter.collection_id);
    if (collection) await invalidateCollectionManifest(s, collection, await recordRestorableRevision(s, 'audio_course_collections', collection.id, { chapterDeleted: id, movedLessonIds }, { row: collection }), 'localization_updated');
    s.audit({ action: 'chapter.delete', entityTable: 'audio_chapters', entityId: id, before: { collectionId: chapter.collection_id, lessons: lessons.length }, after: { movedLessonIds, releasedAssets: released.length } });
    return respondOk(c, ChapterDeleteResponseSchema.parse({ id, deleted: true, movedLessonIds }));
  });

  define('adminLessonsReorder', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ReorderRequestSchema);
    const s = c.get('services')!;
    const chapter = await loadChapter(s, id);
    const current = await currentRevision(s, 'audio_chapters', id);
    assertRevision('Chapter', current, body.expectedRevision);
    assertPermutation('lesson', 'chapter', (await s.repos.audioLibrary.listLessons(id)).map((l) => l.id), body.orderedIds);
    const { result: items, revision } = await guardedEdit(s, { table: 'audio_chapters', id, what: 'Chapter', expected: body.expectedRevision, current, diff: { reorderLessons: body.orderedIds, idempotencyKey: body.idempotencyKey }, snapshot: restorableSnapshot('audio_chapters', chapter) }, () => s.repos.audioLibrary.reorderLessons(id, body.orderedIds));
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
    // The asset is checked before the lesson exists: a refused attach never leaves a half-created lesson behind.
    const attach = body.assetId ? await planAttach(s, null, { assetId: body.assetId, assetType: 'master', sortOrder: 0 }) : null;
    const row: Insert<'audio_lessons'> = { chapter_id: chapter.id, title_translations: body.titleTranslations as never, description_translations: body.descriptionTranslations as never, sort_order: body.sortOrder, level: body.level, target_variety_id: body.targetVarietyId, instruction_language_code: body.instructionLanguageCode, state: 'imported_draft', visibility: 'private' };
    const created = await s.repos.audioLibrary.upsertLesson(row);
    if (body.speakerIds.length) await s.repos.audioLibrary.setLessonSpeakers(created.id, body.speakerIds);
    if (attach) await performAttach(s, created.id, attach);
    const movedFromLessonId = attach?.movedFromLessonId ?? null;
    await recordRestorableRevision(s, 'audio_lessons', created.id, createDiff('lesson.create', body.idempotencyKey, { chapterId: chapter.id, assetId: body.assetId ?? null, movedFromLessonId }), { row: created });
    const collection = await s.repos.audioLibrary.getCollection(chapter.collection_id);
    if (collection) await invalidateCollectionManifest(s, collection, await recordRestorableRevision(s, 'audio_course_collections', collection.id, { lessonAdded: created.id, chapterId: chapter.id }, { row: collection }), 'localization_updated');
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
    if (collection) await invalidateCollectionManifest(s, collection, await recordRestorableRevision(s, 'audio_course_collections', collection.id, { lessonDeleted: id }, { row: collection }), 'localization_updated');
    s.audit({ action: 'lesson.delete', entityTable: 'audio_lessons', entityId: id, before: { title: titleOf(lesson.title_translations), state: lesson.state, chapterId: lesson.chapter_id }, after: { detachedAssetIds } });
    return respondOk(c, LessonDeleteResponseSchema.parse({ id, deleted: true, detachedAssetIds }));
  });

  define('adminLessonAssetAttach', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, LessonAssetAttachRequestSchema);
    const s = c.get('services')!;
    const lesson = await loadLesson(s, id);
    const current = await currentRevision(s, 'audio_lessons', id);
    assertRevision('Lesson', current, body.expectedRevision);
    const plan = await planAttach(s, lesson.id, { assetId: body.assetId, assetType: body.assetType, sortOrder: body.sortOrder });
    const { movedFromLessonId } = plan;
    const { revision } = await guardedEdit(s, { table: 'audio_lessons', id, what: 'Lesson', expected: body.expectedRevision, current, diff: { attachAsset: body.assetId, assetType: body.assetType, sortOrder: body.sortOrder, movedFromLessonId }, snapshot: restorableSnapshot('audio_lessons', lesson) }, () => performAttach(s, lesson.id, plan));
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
    const revision = await recordRestorableRevision(s, 'audio_lessons', id, { detachAsset: assetId, removedLinks: removed }, { row: lesson });
    s.audit({ action: 'lesson.asset_detach', entityTable: 'audio_lessons', entityId: id, after: { assetId, removedLinks: removed, assetState: asset?.state ?? null, revision } });
    return respondOk(c, LessonAssetDetachResponseSchema.parse({ lessonId: id, assetId, revision, assetState: asset?.state ?? 'imported_draft' }));
  });
}
