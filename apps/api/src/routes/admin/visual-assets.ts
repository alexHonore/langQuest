/**
 * §10.2A visual assets (`adminVisualAsset*`): image-only `upload-initiate` (regular multipart lifecycle with
 * `kind: 'image'`), `register` (verified upload → `visual_assets` row: content hash from the verified checksum,
 * dimensions sniffed from the object header, per-language alt text, review state `draft`), patch, `replace`
 * (new bytes under a NEW immutable key: assignments move, the old row keeps `replacedByAssetId`), and
 * `assign` / `unassign` of the real storage slots (`VISUAL_SLOT_TARGETS`). Every mutation records a revision + audit.
 *
 * Every revision carries the restorable snapshot of the row as the mutation leaves it (`recordRestorableRevision` /
 * `guardedEdit` in `./content`, R-7.3-04), so `POST /v1/admin/content/:id/rollback` with `entityTable: 'visual_assets'`
 * can restore any of them (the restorable columns are `ROLLBACK_RESTORABLE_COLUMNS.visual_assets`; `review_status` is
 * the asset's lifecycle state and is never restored). The `expectedRevision` guards of patch / assign / unassign are
 * atomic: revision `expectedRevision + 1` is claimed under the unique key before anything is written.
 */
import {
  UuidSchema,
  VisualAssetAssignRequestSchema,
  VisualAssetAssignResponseSchema,
  VisualAssetPatchRequestSchema,
  VisualAssetRegisterRequestSchema,
  VisualAssetReplaceRequestSchema,
  VisualAssetReplaceResponseSchema,
  VisualAssetResponseSchema,
  VisualAssetUnassignRequestSchema,
  VisualAssetUnassignResponseSchema,
  VisualAssetUploadInitiateRequestSchema,
  VisualAssetUploadInitiateResponseSchema,
  VisualAssetsListQuerySchema,
  VisualAssetsListResponseSchema,
  isCourseTrackId,
  type VisualAssetAssignmentTarget,
  type VisualAssetDto,
} from '@langquest/contracts';
import { VISUAL_SLOT_TARGETS, type VisualAssignment, type VisualAssignmentTarget } from '@langquest/db/repositories/visual-assets';
import type { Insert, Row, Update } from '@langquest/db/types';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, currentRevisions } from '../../lib/content';
import { createDiff, findIdempotentCreate } from '../../lib/idempotent-create';
import { imageMimeMatches, sniffImage } from '../../lib/images';
import { hasAnyRole } from '../../middleware/auth';
import type { RequestServices } from '../../services/context';
import { R2_UNAVAILABLE_MESSAGE } from '../../services/r2';
import { guardedEdit, recordRestorableRevision, restorableSnapshot, staleRevision } from './content';
import { initiateUploadSession } from './uploads';

const IdParams = z.object({ id: UuidSchema });
/** Bytes read from the object head for dimension sniffing (SVG root tags can sit after a long prolog). */
const SNIFF_BYTES = 64 * 1024;

type Translations = Record<string, string>;
const translations = (value: unknown): Translations => {
  const out: Translations = {};
  for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
};
const hasEnglishAlt = (t: Translations): boolean => typeof t.en === 'string' && t.en.trim().length > 0;
/** `alt_text_key` is NOT NULL and catalog-shaped; uploaded assets carry their own translations, the key only names them. */
const uploadedAltKey = (assetId: string): string => `visual.uploaded.${assetId.replace(/-/g, '')}`;

function toAssignment(a: VisualAssignment) {
  return { entityTable: a.entityTable, entityId: a.entityId, slot: a.slot, bindingId: a.bindingId, assignedAt: a.assignedAt };
}

async function visualDto(s: RequestServices, row: Row<'visual_assets'>, revision?: number): Promise<VisualAssetDto> {
  const [assignments, rev] = await Promise.all([s.repos.visualAssets.listAssignments(row.id), revision === undefined ? currentRevision(s, 'visual_assets', row.id) : Promise.resolve(revision)]);
  return VisualAssetResponseSchema.parse({
    id: row.id,
    type: row.type,
    storageKey: row.storage_key,
    styleVersion: row.style_version,
    contentHash: row.content_hash,
    licenseId: row.license_id,
    altTextKey: row.alt_text_key,
    focalPoint: row.focal_point,
    dimensions: row.dimensions,
    localeNeutral: row.locale_neutral,
    reviewStatus: row.review_status,
    origin: row.origin,
    dominantColors: row.dominant_colors,
    variants: row.variants,
    generationBrief: row.generation_brief,
    createdAt: row.created_at,
    altTextTranslations: translations(row.alt_text_translations),
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    moderationStatus: row.moderation_status,
    replacedByAssetId: row.replaced_by_asset_id,
    assignments: assignments.map(toAssignment),
    revision: rev,
    updatedAt: row.updated_at,
  });
}

async function loadVisual(s: RequestServices, id: string): Promise<Row<'visual_assets'>> {
  const row = await s.repos.visualAssets.getById(id);
  if (!row) throw problem.notFound('Visual asset');
  return row;
}

/** A completed + verified image upload owned by the caller (admins may register any editor's upload). */
async function loadVerifiedImageUpload(s: RequestServices, uploadId: string): Promise<Row<'uploads'> & { verified_checksum_sha256: string }> {
  const { principal } = s.requireUser();
  const upload = await s.repos.uploads.getById(uploadId);
  if (!upload) throw problem.notFound('Upload');
  if (upload.user_id !== principal.userId && !hasAnyRole(principal, 'admin')) throw problem.forbidden('This upload belongs to another editor');
  if (!upload.declared_mime_type.startsWith('image/')) throw problem.validation(`Upload is ${upload.declared_mime_type}; visual assets need an image upload`);
  if (upload.status !== 'verified' || !upload.verified_checksum_sha256) throw problem.precondition(`Upload is ${upload.status}; complete and verify it before registering`, { status: upload.status });
  return upload as Row<'uploads'> & { verified_checksum_sha256: string };
}

/** Pixel dimensions + container check from the stored object (honest refusal when the header is not understood). */
async function sniffUploadedImage(s: RequestServices, upload: Row<'uploads'>): Promise<{ width: number; height: number }> {
  if (!s.media.available) throw problem.unsupported(R2_UNAVAILABLE_MESSAGE);
  const head = await s.media.readBytes(upload.storage_key, 0, Math.max(0, Math.min(upload.declared_byte_length, SNIFF_BYTES) - 1));
  if (!head) throw problem.precondition('Uploaded object is missing from storage; upload it again');
  const sniffed = sniffImage(head);
  if (!sniffed) throw problem.validation('Could not read the image dimensions from the upload (unsupported or truncated container)', { declaredMimeType: upload.declared_mime_type });
  if (!imageMimeMatches(upload.declared_mime_type, sniffed.mimeType)) throw problem.validation(`Upload was declared ${upload.declared_mime_type} but contains ${sniffed.mimeType}`, { declaredMimeType: upload.declared_mime_type, sniffedMimeType: sniffed.mimeType });
  return { width: sniffed.width, height: sniffed.height };
}

const toRepoTarget = (t: VisualAssetAssignmentTarget): VisualAssignmentTarget => {
  const allowed = VISUAL_SLOT_TARGETS[t.entityTable as keyof typeof VISUAL_SLOT_TARGETS] as readonly string[] | undefined;
  if (!allowed || !allowed.includes(t.slot)) throw problem.validation(`Slot "${t.slot}" is not valid for ${t.entityTable}`, { entityTable: t.entityTable, slots: [...(allowed ?? [])] });
  return t as VisualAssignmentTarget;
};

/** The target row must exist (every slot table has an `id`); a missing entity is a validation error, never a silent no-op. */
async function assertTargetExists(s: RequestServices, t: VisualAssignmentTarget): Promise<void> {
  const res = await s.service.from(t.entityTable).select('id').eq('id', t.entityId).maybeSingle();
  if (res.error || !res.data) throw problem.validation(`${t.entityTable} ${t.entityId} does not exist`, { entityTable: t.entityTable, entityId: t.entityId });
}

/** Learner manifests that render the slot: audio tables → the collection manifest, course tables → the track manifest. */
async function invalidateForTarget(s: RequestServices, t: VisualAssignmentTarget, revision: number): Promise<boolean> {
  let payload: { kind: 'course'; courseTrackId: string } | { kind: 'audio_collection'; collectionId: string } | null = null;
  if (t.entityTable === 'audio_course_collections') payload = { kind: 'audio_collection', collectionId: t.entityId };
  else if (t.entityTable === 'audio_chapters') {
    const ch = await s.repos.audioLibrary.getChapter(t.entityId);
    if (ch) payload = { kind: 'audio_collection', collectionId: ch.collection_id };
  } else if (t.entityTable === 'audio_lessons') {
    const ch = (await s.service.from('audio_lessons').select('audio_chapters!inner(collection_id)').eq('id', t.entityId).maybeSingle()).data as unknown as { audio_chapters: { collection_id: string } | null } | null;
    if (ch?.audio_chapters) payload = { kind: 'audio_collection', collectionId: ch.audio_chapters.collection_id };
  } else if (t.entityTable === 'lesson_courses') {
    const course = (await s.service.from('lesson_courses').select('course_track_id').eq('id', t.entityId).maybeSingle()).data;
    if (course && isCourseTrackId(course.course_track_id)) payload = { kind: 'course', courseTrackId: course.course_track_id };
  } else if (t.entityTable === 'chapters') {
    const course = (await s.service.from('chapters').select('lesson_courses!inner(course_track_id)').eq('id', t.entityId).maybeSingle()).data as unknown as { lesson_courses: { course_track_id: string } | null } | null;
    if (course?.lesson_courses && isCourseTrackId(course.lesson_courses.course_track_id)) payload = { kind: 'course', courseTrackId: course.lesson_courses.course_track_id };
  }
  // missions / characters: variety-scoped art reaches several tracks; those manifests are refreshed on publish.
  if (!payload) return false;
  const event = payload.kind === 'course' ? { kind: 'course' as const, courseTrackId: payload.courseTrackId as never, collectionId: null, sourceLanguageCode: null } : { kind: 'audio_collection' as const, courseTrackId: null, collectionId: payload.collectionId, sourceLanguageCode: null };
  await s.events.emit('manifest.invalidated', { ...event, newVersion: revision, reason: 'asset_replaced' }, { idempotencyKey: `manifest.invalidated:visual:${t.entityTable}:${t.entityId}:${t.slot}:${revision}:${Date.now()}`, traceId: s.requestId });
  return true;
}

export function registerVisualAssetRoutes(define: DefineRoute): void {
  define('adminVisualAssetsList', {}, async (c) => {
    const q = parseQuery(c, VisualAssetsListQuerySchema);
    const s = c.get('services')!;
    const page = await s.repos.visualAssets.listPaged({ type: q.type, reviewStatus: q.reviewStatus, origin: q.origin, q: q.q, cursor: q.cursor, limit: q.limit });
    const revisions = await currentRevisions(s, 'visual_assets', page.items.map((r) => r.id));
    let items = await Promise.all(page.items.map((r) => visualDto(s, r, revisions.get(r.id) ?? 0)));
    // Assignment filters are evaluated on the page (assignments live in several tables): honest, if coarse, paging.
    if (q.entityTable || q.entityId) items = items.filter((it) => it.assignments.some((a) => (!q.entityTable || a.entityTable === q.entityTable) && (!q.entityId || a.entityId === q.entityId)));
    if (q.unassigned !== undefined) items = items.filter((it) => (it.assignments.length === 0) === q.unassigned);
    return respondOk(c, VisualAssetsListResponseSchema.parse({ items, nextCursor: page.nextCursor, total: null }));
  });

  define('adminVisualAssetUploadInitiate', { role: 'contentEditor', idempotent: false }, async (c) => {
    const body = await parseBody(c, VisualAssetUploadInitiateRequestSchema);
    const { response, status } = await initiateUploadSession(c.get('services')!, { ...body, kind: 'image' });
    return respondOk(c, VisualAssetUploadInitiateResponseSchema.parse({ ...response, kind: 'visual' }), status);
  });

  define('adminVisualAssetRegister', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, VisualAssetRegisterRequestSchema);
    const s = c.get('services')!;
    const replay = await findIdempotentCreate(s, 'visual_asset.register', body.idempotencyKey);
    if (replay) {
      const existing = await s.repos.visualAssets.getById(replay);
      if (existing) return respondOk(c, await visualDto(s, existing), 200);
    }
    const upload = await loadVerifiedImageUpload(s, body.uploadId);
    if (body.contentRightsId && !(await s.repos.rights.getById(body.contentRightsId))) throw problem.validation('contentRightsId does not exist');
    const duplicate = await s.repos.visualAssets.findByHash(upload.verified_checksum_sha256);
    if (duplicate) throw problem.conflict('An identical image is already registered', { duplicateOfAssetId: duplicate.id });
    const dimensions = await sniffUploadedImage(s, upload);
    const id = crypto.randomUUID();
    const row: Insert<'visual_assets'> = {
      id,
      type: body.type,
      storage_key: upload.storage_key,
      style_version: body.styleVersion,
      content_hash: upload.verified_checksum_sha256,
      license_id: body.contentRightsId,
      alt_text_key: uploadedAltKey(id),
      alt_text_translations: body.altTextTranslations as never,
      focal_point: body.focalPoint as never,
      dimensions: dimensions as never,
      locale_neutral: body.localeNeutral,
      review_status: 'draft',
      origin: body.origin,
      mime_type: upload.declared_mime_type,
      byte_length: upload.declared_byte_length,
      moderation_status: 'unchecked',
      source_file_asset_id: upload.draft_asset_id,
      generation_brief: body.generationBrief as never,
      dominant_colors: [],
      variants: [] as never,
    };
    const created = await s.repos.visualAssets.insert(row);
    // `crop` has no column yet (contracts gap noted): it is kept in the revision diff for the variant-derivation job.
    await recordRestorableRevision(s, 'visual_assets', created.id, createDiff('visual_asset.register', body.idempotencyKey, { uploadId: upload.id, crop: body.crop }), { row: created });
    s.audit({ action: 'visual_asset.register', entityTable: 'visual_assets', entityId: created.id, after: { idempotencyKey: body.idempotencyKey, uploadId: upload.id, type: created.type, origin: created.origin, dimensions, mimeType: created.mime_type } });
    return respondOk(c, await visualDto(s, created), 201);
  });

  define('adminVisualAssetGet', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    return respondOk(c, await visualDto(s, await loadVisual(s, id)));
  });

  define('adminVisualAssetPatch', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, VisualAssetPatchRequestSchema);
    const s = c.get('services')!;
    const before = await loadVisual(s, id);
    const revision = await currentRevision(s, 'visual_assets', id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== revision) throw staleRevision('Visual asset', revision, body.expectedRevision);
    if (before.replaced_by_asset_id) throw problem.precondition('This asset was replaced; edit the replacement instead', { replacedByAssetId: before.replaced_by_asset_id });
    if (body.contentRightsId && !(await s.repos.rights.getById(body.contentRightsId))) throw problem.validation('contentRightsId does not exist');
    const patch: Update<'visual_assets'> = {};
    if (body.type !== undefined) patch.type = body.type;
    if (body.styleVersion !== undefined) patch.style_version = body.styleVersion;
    if (body.altTextTranslations !== undefined) patch.alt_text_translations = { ...translations(before.alt_text_translations), ...body.altTextTranslations } as never;
    if (body.focalPoint !== undefined) patch.focal_point = body.focalPoint as never;
    if (body.localeNeutral !== undefined) patch.locale_neutral = body.localeNeutral;
    if (body.contentRightsId !== undefined) patch.license_id = body.contentRightsId;
    if (body.generationBrief !== undefined) patch.generation_brief = body.generationBrief as never;
    if (body.reviewStatus !== undefined && body.reviewStatus !== before.review_status) {
      const { principal } = s.requireUser();
      if (!hasAnyRole(principal, 'languageReviewer')) throw problem.forbidden('Changing the review status requires a reviewer role');
      const alt = (patch.alt_text_translations as Translations | undefined) ?? translations(before.alt_text_translations);
      // Uploaded art carries its own alt text; catalog-backed art (`alt_text_key` in the locale catalogs) is exempt.
      if (body.reviewStatus === 'approved' && before.alt_text_key.startsWith('visual.uploaded.') && !hasEnglishAlt(alt)) throw problem.precondition('Approval needs English alt text (accessibility checklist)');
      patch.review_status = body.reviewStatus;
    }
    const { expectedRevision: _expected, ...diff } = body;
    // Snapshot of the row as the patch leaves it, computed before writing; with `expectedRevision` the next revision is
    // claimed first, so of two editors at the same revision exactly one writes.
    const { result: updated, revision: next } = await guardedEdit(s, { table: 'visual_assets', id, what: 'Visual asset', expected: body.expectedRevision, current: revision, diff: diff as Record<string, unknown>, snapshot: restorableSnapshot('visual_assets', { ...before, ...patch }) }, async () => (Object.keys(patch).length ? await s.repos.visualAssets.update(id, patch) : before));
    s.audit({ action: 'visual_asset.patch', entityTable: 'visual_assets', entityId: id, before: { reviewStatus: before.review_status }, after: { fields: Object.keys(patch), reviewStatus: updated.review_status, revision: next } });
    return respondOk(c, await visualDto(s, updated, next));
  });

  define('adminVisualAssetReplace', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, VisualAssetReplaceRequestSchema);
    const s = c.get('services')!;
    const before = await loadVisual(s, id);
    const revision = await currentRevision(s, 'visual_assets', id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== revision) throw staleRevision('Visual asset', revision, body.expectedRevision);
    const replayId = await findIdempotentCreate(s, 'visual_asset.replace', body.idempotencyKey);
    if (replayId) {
      const replacement = await s.repos.visualAssets.getById(replayId);
      if (replacement) return respondOk(c, VisualAssetReplaceResponseSchema.parse({ previousAssetId: id, asset: await visualDto(s, replacement), movedAssignments: (await s.repos.visualAssets.listAssignments(replacement.id)).length, manifestInvalidated: false, replayed: true }), 200);
    }
    if (before.replaced_by_asset_id) throw problem.precondition('This asset was already replaced', { replacedByAssetId: before.replaced_by_asset_id });
    const upload = await loadVerifiedImageUpload(s, body.uploadId);
    if (upload.verified_checksum_sha256 === before.content_hash) throw problem.validation('The upload has the same bytes as the current asset');
    const duplicate = await s.repos.visualAssets.findByHash(upload.verified_checksum_sha256);
    if (duplicate) throw problem.conflict('An identical image is already registered', { duplicateOfAssetId: duplicate.id });
    const dimensions = await sniffUploadedImage(s, upload);
    const newId = crypto.randomUUID();
    const created = await s.repos.visualAssets.insert({
      id: newId,
      type: before.type,
      storage_key: upload.storage_key,
      style_version: before.style_version,
      content_hash: upload.verified_checksum_sha256,
      license_id: before.license_id,
      alt_text_key: before.alt_text_key.startsWith('visual.uploaded.') ? uploadedAltKey(newId) : before.alt_text_key,
      alt_text_translations: before.alt_text_translations,
      focal_point: body.keepFocalPoint ? before.focal_point : null,
      dimensions: dimensions as never,
      locale_neutral: before.locale_neutral,
      // New bytes are unreviewed art: approval never carries over silently.
      review_status: 'draft',
      origin: before.origin,
      mime_type: upload.declared_mime_type,
      byte_length: upload.declared_byte_length,
      moderation_status: 'unchecked',
      source_file_asset_id: upload.draft_asset_id,
      generation_brief: before.generation_brief,
      dominant_colors: [],
      variants: [] as never,
    });
    const assignmentsBefore = await s.repos.visualAssets.listAssignments(id);
    const movedAssignments = await s.repos.visualAssets.replaceEverywhere(id, newId);
    await recordRestorableRevision(s, 'visual_assets', newId, createDiff('visual_asset.replace', body.idempotencyKey, { replaces: id, keepFocalPoint: body.keepFocalPoint, keepCrop: body.keepCrop, note: body.note ?? null }), { row: created });
    const oldRevision = await recordRestorableRevision(s, 'visual_assets', id, { replacedBy: newId, movedAssignments, note: body.note ?? null }, { row: { ...before, replaced_by_asset_id: newId }, note: body.note });
    let manifestInvalidated = false;
    for (const a of assignmentsBefore) manifestInvalidated = (await invalidateForTarget(s, { entityTable: a.entityTable, entityId: a.entityId, slot: a.slot }, oldRevision)) || manifestInvalidated;
    s.audit({ action: 'visual_asset.replace', entityTable: 'visual_assets', entityId: id, before: { contentHash: before.content_hash }, after: { replacementId: newId, contentHash: created.content_hash, movedAssignments, manifestInvalidated } });
    return respondOk(c, VisualAssetReplaceResponseSchema.parse({ previousAssetId: id, asset: await visualDto(s, created), movedAssignments, manifestInvalidated, replayed: false }), 201);
  });

  define('adminVisualAssetAssign', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, VisualAssetAssignRequestSchema);
    const s = c.get('services')!;
    const asset = await loadVisual(s, id);
    const revision = await currentRevision(s, 'visual_assets', id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== revision) throw staleRevision('Visual asset', revision, body.expectedRevision);
    if (asset.replaced_by_asset_id) throw problem.precondition('This asset was replaced; assign the replacement instead', { replacedByAssetId: asset.replaced_by_asset_id });
    const target = toRepoTarget({ entityTable: body.entityTable, entityId: body.entityId, slot: body.slot });
    await assertTargetExists(s, target);
    const current = await s.repos.visualAssets.getSlotAssignment(target);
    if (current && current.visualAssetId === id) {
      return respondOk(c, VisualAssetAssignResponseSchema.parse({ assignment: toAssignment(current), replacedAssetId: null, manifestInvalidated: false }), 200);
    }
    if (current && !body.replaceExisting) throw problem.conflict(`Slot ${body.slot} on ${body.entityTable} ${body.entityId} already holds ${current.visualAssetId}; pass replaceExisting to swap it`, { currentAssetId: current.visualAssetId });
    const { result: assignment, revision: next } = await guardedEdit(s, { table: 'visual_assets', id, what: 'Visual asset', expected: body.expectedRevision, current: revision, diff: { assign: target, replacedAssetId: current?.visualAssetId ?? null, idempotencyKey: body.idempotencyKey }, snapshot: restorableSnapshot('visual_assets', asset) }, async () => {
      const written = await s.repos.visualAssets.assignVisualSlot(target, id);
      if (!written) throw problem.internal('Assignment did not persist');
      return written;
    });
    const manifestInvalidated = await invalidateForTarget(s, target, next);
    s.audit({ action: 'visual_asset.assign', entityTable: body.entityTable, entityId: body.entityId, before: { slot: body.slot, assetId: current?.visualAssetId ?? null }, after: { slot: body.slot, assetId: id, manifestInvalidated } });
    return respondOk(c, VisualAssetAssignResponseSchema.parse({ assignment: toAssignment(assignment), replacedAssetId: current?.visualAssetId ?? null, manifestInvalidated }), 201);
  });

  define('adminVisualAssetUnassign', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, VisualAssetUnassignRequestSchema);
    const s = c.get('services')!;
    const asset = await loadVisual(s, id);
    const revision = await currentRevision(s, 'visual_assets', id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== revision) throw staleRevision('Visual asset', revision, body.expectedRevision);
    const target = toRepoTarget({ entityTable: body.entityTable, entityId: body.entityId, slot: body.slot });
    await assertTargetExists(s, target);
    const current = await s.repos.visualAssets.getSlotAssignment(target);
    if (!current || current.visualAssetId !== id) {
      return respondOk(c, VisualAssetUnassignResponseSchema.parse({ target, removed: false, manifestInvalidated: false }));
    }
    const { revision: next } = await guardedEdit(s, { table: 'visual_assets', id, what: 'Visual asset', expected: body.expectedRevision, current: revision, diff: { unassign: target }, snapshot: restorableSnapshot('visual_assets', asset) }, () => s.repos.visualAssets.assignVisualSlot(target, null));
    const manifestInvalidated = await invalidateForTarget(s, target, next);
    s.audit({ action: 'visual_asset.unassign', entityTable: body.entityTable, entityId: body.entityId, before: { slot: body.slot, assetId: id }, after: { slot: body.slot, assetId: null, manifestInvalidated } });
    return respondOk(c, VisualAssetUnassignResponseSchema.parse({ target, removed: true, manifestInvalidated }));
  });
}
