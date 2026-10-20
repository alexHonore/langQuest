/**
 * §6.4 asset management (§7.3): filtered asset listing, bulk labelling (reversible via `content_revisions`),
 * lesson patching with optimistic concurrency, processing requests (deduplicated by content hash) and job status.
 * Every mutation is audit-logged with the editor id and request id.
 *
 * Integrity rules shared with the other admin routes (`./content`):
 * - publication only goes through the rights-gated publish endpoint; a move out of `published`
 *   (`state: 'unpublished'`) runs THE takedown (`takeDownContent`, reason `editorial`), exactly as
 *   `POST /v1/admin/content/:id/unpublish` does — never a bare state write. Field edits sent in the same request are
 *   folded into the takedown (`TakedownEdit`): one revision, one conditional row write, so they land together or not
 *   at all;
 * - every lesson revision carries its restorable snapshot (`guardedEdit`);
 * - the lesson PATCH guard is atomic (`guardedEdit` claims `expectedRevision + 1` under the unique key, and the row
 *   update is conditional on the `updated_at` that was read);
 * - an edit of a published lesson refreshes the learner manifests that list it (`invalidatePublishedContent`),
 *   including the manifest of the collection it left when `chapterId` moves it to another collection.
 */
import { AssetProcessRequestSchema, AssetProcessResponseSchema, AssetsListQuerySchema, AssetsListResponseSchema, AudioLessonPatchRequestSchema, AudioLessonPatchResponseSchema, BulkLabelRequestSchema, BulkLabelResponseSchema, ProcessingJobResponseSchema, UuidSchema, type ContentRevisionRef, type ContentState, type ProcessingJobDto } from '@langquest/contracts';
import type { Row, Update } from '@langquest/db/types';
import { canTransitionContent } from '@langquest/media/rights';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision } from '../../lib/content';
import { loadRights } from '../../lib/rights';
import type { RequestServices } from '../../services/context';
import { RowChangedError, guardedEdit, invalidatePublishedContent, restorableSnapshot, staleRevision, takeDownContent, updateIfUnchanged } from './content';

const IdParams = z.object({ id: UuidSchema });

export function jobToDto(job: Row<'processing_jobs'>): ProcessingJobDto {
  return ProcessingJobResponseSchema.parse({
    id: job.id,
    type: job.job_type,
    state: job.state,
    parentAssetId: job.parent_asset_id,
    progressPct: Number(job.progress_pct),
    attempts: job.attempts,
    provider: job.provider,
    costEstimateUsd: job.cost_estimate_usd === null ? null : Number(job.cost_estimate_usd),
    costActualUsd: job.cost_actual_usd === null ? null : Number(job.cost_actual_usd),
    failureCode: job.failure_code,
    failureMessage: job.failure_message,
    outputAssetIds: job.output_asset_ids,
    output: (job.output as Record<string, unknown> | null) ?? null,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
  });
}

type ListQuery = z.infer<typeof AssetsListQuerySchema>;
type LessonLink = { asset_id: string; lesson_id: string; audio_lessons: { id: string; title_translations: unknown; chapter_id: string; target_variety_id: string | null; instruction_language_code: string | null; transcript_status: string; audio_chapters: { collection_id: string } | null } | null };

async function queryAssets(s: RequestServices, q: Omit<ListQuery, 'cursor' | 'limit' | 'sort'> & { cursor?: string; limit: number; sort: ListQuery['sort'] }): Promise<{ assets: Row<'media_assets'>[]; nextCursor: string | null }> {
  let query = s.service.from('media_assets').select('*').neq('disposition', 'deleted');
  if (q.status) query = query.eq('state', q.status);
  if (q.kind) query = query.eq('kind', q.kind);
  if (q.legacyPathPrefix) query = query.like('legacy_path', `${q.legacyPathPrefix}%`);
  if (q.uploadedAfter) query = query.gte('created_at', q.uploadedAfter);
  if (q.uploadedBefore) query = query.lte('created_at', q.uploadedBefore);
  if (q.q) {
    const needle = q.q.replace(/[%,()]/g, ' ').trim();
    if (needle) query = query.or(`legacy_filename.ilike.%${needle}%,legacy_path.ilike.%${needle}%,storage_key.ilike.%${needle}%`);
  }
  const ascending = q.sort === 'created_asc' || q.sort === 'filename' || q.sort === 'state';
  const column = q.sort === 'filename' ? 'legacy_filename' : q.sort === 'duration' ? 'duration_ms' : q.sort === 'state' ? 'state' : 'created_at';
  query = query.order(column, { ascending, nullsFirst: false }).order('id');
  if (q.cursor && column === 'created_at') query = ascending ? query.gt('created_at', q.cursor) : query.lt('created_at', q.cursor);
  const res = await query.limit(q.limit + 1);
  if (res.error) throw problem.internal(`Could not list assets: ${res.error.message}`);
  const rows = res.data ?? [];
  const page = rows.slice(0, q.limit);
  return { assets: page, nextCursor: rows.length > q.limit && column === 'created_at' ? (page[page.length - 1]?.created_at ?? null) : null };
}

async function lessonLinks(s: RequestServices, assetIds: string[]): Promise<Map<string, LessonLink>> {
  if (!assetIds.length) return new Map();
  const res = await s.service.from('audio_lesson_assets').select('asset_id, lesson_id, audio_lessons!inner(id, title_translations, chapter_id, target_variety_id, instruction_language_code, transcript_status, audio_chapters!inner(collection_id))').in('asset_id', assetIds);
  const map = new Map<string, LessonLink>();
  for (const l of (res.data ?? []) as unknown as LessonLink[]) if (!map.has(l.asset_id)) map.set(l.asset_id, l);
  return map;
}

export function registerAssetRoutes(define: DefineRoute): void {
  define('adminAssetsList', {}, async (c) => {
    const q = parseQuery(c, AssetsListQuerySchema);
    const s = c.get('services')!;
    const { assets, nextCursor } = await queryAssets(s, q);
    const ids = assets.map((a) => a.id);
    const [links, jobs, rights] = await Promise.all([
      lessonLinks(s, ids),
      ids.length ? s.service.from('processing_jobs').select('*').in('parent_asset_id', ids).order('created_at', { ascending: false }).limit(ids.length * 5).then((r) => r.data ?? []) : Promise.resolve([]),
      loadRights(s, assets.map((a) => a.content_rights_id)),
    ]);
    const lessonIds = [...new Set([...links.values()].map((l) => l.lesson_id))];
    const speakers = lessonIds.length ? ((await s.service.from('lesson_speakers').select('lesson_id, speaker_id').in('lesson_id', lessonIds)).data ?? []) : [];
    const latestJob = new Map<string, Row<'processing_jobs'>>();
    for (const j of jobs) if (j.parent_asset_id && !latestJob.has(j.parent_asset_id)) latestJob.set(j.parent_asset_id, j);
    const items = assets
      .map((a) => {
        const link = links.get(a.id);
        const lesson = link?.audio_lessons ?? null;
        const job = latestJob.get(a.id) ?? null;
        const r = a.content_rights_id ? (rights.get(a.content_rights_id) ?? null) : null;
        const title = ((lesson?.title_translations ?? {}) as Record<string, string>).en ?? Object.values((lesson?.title_translations ?? {}) as Record<string, string>)[0] ?? '';
        return {
          id: a.id,
          kind: a.kind,
          storageKey: a.storage_key,
          legacyFilename: a.legacy_filename,
          legacyPath: a.legacy_path,
          mimeType: a.mime_type,
          byteLength: a.byte_length,
          durationMs: a.duration_ms,
          checksumSha256: a.checksum_sha256,
          state: a.state,
          rightsVerified: Boolean(r?.verified),
          contentRightsId: a.content_rights_id,
          lesson: lesson ? { id: lesson.id, title, chapterId: lesson.chapter_id, collectionId: lesson.audio_chapters?.collection_id ?? lesson.chapter_id } : null,
          targetVarietyId: lesson?.target_variety_id ?? null,
          instructionLanguageCode: lesson?.instruction_language_code ?? null,
          speakerIds: lesson ? speakers.filter((sp) => sp.lesson_id === lesson.id).map((sp) => sp.speaker_id) : [],
          transcriptStatus: lesson?.transcript_status ?? 'none',
          latestJob: job ? { id: job.id, type: job.job_type, state: job.state, progressPct: Number(job.progress_pct) } : null,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
        };
      })
      .filter((it) => (q.rightsVerified === undefined || it.rightsVerified === q.rightsVerified) && (!q.collectionId || it.lesson?.collectionId === q.collectionId) && (!q.chapterId || it.lesson?.chapterId === q.chapterId) && (!q.speakerId || it.speakerIds.includes(q.speakerId)) && (!q.transcriptStatus || it.transcriptStatus === q.transcriptStatus) && (!q.jobState || it.latestJob?.state === q.jobState) && (!q.targetVarietyId || it.targetVarietyId === q.targetVarietyId) && (!q.instructionLanguage || it.instructionLanguageCode === q.instructionLanguage));
    return respondOk(c, AssetsListResponseSchema.parse({ items, nextCursor, total: null }));
  });

  define('adminAssetsBulkLabel', { role: 'contentEditor', timeoutMs: 55_000 }, async (c) => {
    const body = await parseBody(c, BulkLabelRequestSchema);
    // Publication only goes through the rights-gated publish endpoint (same rule as `adminAudioLessonPatch`): a bulk
    // `state: 'published'` would move approved lessons/assets live without the rights + native-review checklist.
    if (body.patch.state === 'published') throw problem.precondition('Bulk labelling cannot publish; use POST /v1/admin/content/:id/publish (rights gate) for each item');
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    let assetIds = body.assetIds ?? [];
    if (body.filter) assetIds = [...new Set([...assetIds, ...(await queryAssets(s, { ...body.filter, limit: 5000, sort: 'created_desc' })).assets.map((a) => a.id)])];
    const links = await lessonLinks(s, assetIds);
    const lessonIds = new Set<string>([...(body.lessonIds ?? []), ...[...links.values()].map((l) => l.lesson_id)]);
    const p = body.patch;
    const note = `bulk-label ${body.idempotencyKey}`;
    const assetPatch: Update<'media_assets'> = {};
    if (p.state !== undefined) assetPatch.state = p.state;
    if (p.visibility !== undefined) assetPatch.visibility = p.visibility;
    if (p.contentRightsId !== undefined) assetPatch.content_rights_id = p.contentRightsId;
    const lessonPatch: Update<'audio_lessons'> = {};
    if (p.targetVarietyId !== undefined) lessonPatch.target_variety_id = p.targetVarietyId;
    if (p.instructionLanguage !== undefined) lessonPatch.instruction_language_code = p.instructionLanguage;
    if (p.spokenLanguageCodes !== undefined) lessonPatch.spoken_language_codes = p.spokenLanguageCodes;
    if (p.regionalDialect !== undefined) lessonPatch.regional_dialect = p.regionalDialect;
    if (p.chapterId !== undefined && p.chapterId !== null) lessonPatch.chapter_id = p.chapterId;
    if (p.lessonOrder !== undefined && p.lessonOrder !== null) lessonPatch.sort_order = p.lessonOrder;
    if (p.level !== undefined) lessonPatch.level = p.level;
    if (p.topic !== undefined) lessonPatch.topic = p.topic;
    if (p.scene !== undefined) lessonPatch.scene = p.scene;
    if (p.coverVisualAssetId !== undefined) lessonPatch.cover_visual_asset_id = p.coverVisualAssetId;
    if (p.contentRightsId !== undefined) lessonPatch.content_rights_id = p.contentRightsId;
    // `unpublished` is only reachable from `published`: that move is THE takedown (below), never a bare state write.
    if (p.state !== undefined && p.state !== 'unpublished') lessonPatch.state = p.state;
    if (p.visibility !== undefined) lessonPatch.visibility = p.visibility;
    const skipped: { id: string; reason: string }[] = [];
    const revisionIds: string[] = [];
    const revisions: ContentRevisionRef[] = [];
    let affected = 0;
    if (assetIds.length && Object.keys(assetPatch).length) {
      const existing = await s.service.from('media_assets').select('id, disposition, state').in('id', assetIds);
      for (const a of existing.data ?? []) {
        if (a.disposition === 'deleted' || a.disposition === 'revoked') {
          skipped.push({ id: a.id, reason: `asset is ${a.disposition}` });
          continue;
        }
        if (assetPatch.state && assetPatch.state !== a.state && !canTransitionContent(a.state as ContentState, assetPatch.state as ContentState)) {
          skipped.push({ id: a.id, reason: `cannot move from ${a.state} to ${assetPatch.state}` });
          continue;
        }
        const res = await s.service.from('media_assets').update(assetPatch).eq('id', a.id);
        if (res.error) {
          skipped.push({ id: a.id, reason: res.error.message });
          continue;
        }
        affected += 1;
        // A published asset leaving publication is recorded like the rights-revocation RPC records it (migration 120:
        // publication event, revision 0 — assets carry no content_revisions); its lessons are taken down below.
        if (a.state === 'published' && assetPatch.state === 'unpublished') {
          const event = await s.service.from('publication_events').insert({ entity_table: 'media_assets', entity_id: a.id, revision: 0, from_state: 'published', to_state: 'unpublished', actor_id: principal.userId, reason: `editorial: ${note}` });
          if (event.error) throw problem.internal(`Could not record the publication event: ${event.error.message}`);
        }
      }
    }
    for (const lessonId of lessonIds) {
      const lesson = (await s.service.from('audio_lessons').select('*').eq('id', lessonId).maybeSingle()).data;
      if (!lesson) {
        skipped.push({ id: lessonId, reason: 'lesson not found' });
        continue;
      }
      if (p.state && p.state !== lesson.state && !canTransitionContent(lesson.state as ContentState, p.state)) {
        skipped.push({ id: lessonId, reason: `cannot move from ${lesson.state} to ${p.state}` });
        continue;
      }
      const patch: Update<'audio_lessons'> = { ...lessonPatch };
      if (p.addTags || p.removeTags) patch.tags = [...new Set([...lesson.tags.filter((t) => !(p.removeTags ?? []).includes(t)), ...(p.addTags ?? [])])];
      if (p.description !== undefined) patch.description_translations = { en: p.description ?? '' } as never;
      const after = { ...lesson, ...patch } as Row<'audio_lessons'>;
      const diff: Record<string, unknown> = { bulk: true, patch: p as Record<string, unknown>, applyToChildren: body.applyToChildren };
      // A failed write (the row changed after it was read, or the database refused it) skips this lesson; nothing of
      // it was applied and no revision was recorded (there is no claim without `expectedRevision`).
      let writeError: unknown = null;
      const write = async (extra: Update<'audio_lessons'> = {}): Promise<Row<'audio_lessons'>> => {
        try {
          const columns = { ...patch, ...extra };
          // Conditional on the row version read above: tags are merged from that read, never over a newer row.
          const row = Object.keys(columns).length ? ((await updateIfUnchanged(s, 'audio_lessons', lesson, columns, 'Lesson')) as Row<'audio_lessons'>) : lesson;
          if (p.speakerId) await s.service.from('lesson_speakers').upsert({ lesson_id: lessonId, speaker_id: p.speakerId, role: 'other' }, { onConflict: 'lesson_id,speaker_id,role' });
          return row;
        } catch (error) {
          writeError = error;
          throw error;
        }
      };
      try {
        if (p.state === 'unpublished' && lesson.state === 'published') {
          // THE takedown with the labels folded in: one revision, one conditional row write (labels + state), and the
          // manifests listing the lesson before and after the labels (a `chapterId` move) are both invalidated.
          const result = await takeDownContent(s, { table: 'audio_lessons', row: lesson }, { reason: 'editorial', note, via: 'bulk_label', edit: { diff, after, write: async (newState) => { await write({ state: newState }); } } });
          revisions.push({ entityTable: 'audio_lessons', entityId: lessonId, revision: result.revision });
        } else {
          const edit = await guardedEdit(s, { table: 'audio_lessons', id: lessonId, what: 'Lesson', expected: undefined, diff, snapshot: restorableSnapshot('audio_lessons', after), note }, () => write());
          revisions.push({ entityTable: 'audio_lessons', entityId: lessonId, revision: edit.revision });
          // `lesson` is the row before the labels: a lesson moved to another collection leaves that manifest too.
          await invalidatePublishedContent(s, { table: 'audio_lessons', row: edit.result }, edit.revision, { table: 'audio_lessons', row: lesson });
        }
      } catch (error) {
        if (writeError === null) throw error;
        skipped.push({ id: lessonId, reason: writeError instanceof RowChangedError ? 'lesson changed during the bulk edit; run it again' : writeError instanceof Error ? writeError.message : String(writeError) });
        continue;
      }
      revisionIds.push(lessonId);
      affected += 1;
    }
    s.audit({ action: 'assets.bulk_label', entityTable: 'media_assets', entityId: null, after: { affected, skipped: skipped.length, patch: p, idempotencyKey: body.idempotencyKey, actor: principal.userId } });
    return respondOk(c, BulkLabelResponseSchema.parse({ affected, revisionIds, revisions, skipped: skipped.slice(0, 200) }));
  });

  define('adminAudioLessonPatch', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, AudioLessonPatchRequestSchema);
    const s = c.get('services')!;
    const lesson = (await s.service.from('audio_lessons').select('*').eq('id', id).maybeSingle()).data;
    if (!lesson) throw problem.notFound('Lesson');
    const current = await currentRevision(s, 'audio_lessons', id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== current) throw staleRevision('Lesson', current, body.expectedRevision);
    if (body.state !== undefined && body.state !== lesson.state && !canTransitionContent(lesson.state as ContentState, body.state)) throw problem.precondition(`Lesson cannot move from ${lesson.state} to ${body.state}; use the publish endpoint for publication`);
    if (body.state === 'published') throw problem.precondition('Use POST /v1/admin/content/:id/publish (rights gate) to publish');
    // published → unpublished is THE takedown (`takeDownContent`), with the field edit below folded into it.
    const unpublish = body.state === 'unpublished' && lesson.state === 'published';
    const patch: Update<'audio_lessons'> = {};
    if (body.titleTranslations) patch.title_translations = { ...((lesson.title_translations as object) ?? {}), ...body.titleTranslations } as never;
    if (body.descriptionTranslations) patch.description_translations = { ...((lesson.description_translations as object) ?? {}), ...body.descriptionTranslations } as never;
    if (body.chapterId !== undefined) patch.chapter_id = body.chapterId;
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
    if (body.episodeNumber !== undefined) patch.episode_number = body.episodeNumber;
    if (body.level !== undefined) patch.level = body.level;
    if (body.targetVarietyId !== undefined) patch.target_variety_id = body.targetVarietyId;
    if (body.instructionLanguageCode !== undefined) patch.instruction_language_code = body.instructionLanguageCode;
    if (body.spokenLanguageCodes !== undefined) patch.spoken_language_codes = body.spokenLanguageCodes;
    if (body.regionalDialect !== undefined) patch.regional_dialect = body.regionalDialect;
    if (body.topic !== undefined) patch.topic = body.topic;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.scene !== undefined) patch.scene = body.scene;
    if (body.coverVisualAssetId !== undefined) patch.cover_visual_asset_id = body.coverVisualAssetId;
    if (body.contentRightsId !== undefined) patch.content_rights_id = body.contentRightsId;
    if (body.state !== undefined && !unpublish) patch.state = body.state;
    if (body.visibility !== undefined) patch.visibility = body.visibility;
    if (body.qualityReviewStatus !== undefined) patch.quality_review_status = body.qualityReviewStatus;
    const { expectedRevision: _expected, ...diff } = body;
    const after = { ...lesson, ...patch } as Row<'audio_lessons'>;
    // The update only applies to the row version read above (`updateIfUnchanged`: 412 instead of a lost update).
    const write = async (extra: Update<'audio_lessons'> = {}): Promise<Row<'audio_lessons'>> => {
      const columns = { ...patch, ...extra };
      const updated = Object.keys(columns).length ? ((await updateIfUnchanged(s, 'audio_lessons', lesson, columns, 'Lesson')) as Row<'audio_lessons'>) : lesson;
      if (body.speakerIds) {
        await s.service.from('lesson_speakers').delete().eq('lesson_id', id);
        if (body.speakerIds.length) await s.service.from('lesson_speakers').insert(body.speakerIds.map((speaker_id) => ({ lesson_id: id, speaker_id, role: 'other' })));
      }
      return updated;
    };
    let revision: number;
    let state: ContentState;
    if (unpublish) {
      // THE takedown with this request's edit folded in: ONE claim of `expectedRevision + 1` and ONE conditional row
      // write (fields + state), so the edit and the unpublish land together or not at all — a 412 never follows an
      // applied edit, and an edit is never left live because the takedown lost a race.
      const takedown = await takeDownContent(s, { table: 'audio_lessons', row: lesson }, { reason: 'editorial', note: null, via: 'lesson_patch', expected: body.expectedRevision, current, edit: { diff: diff as Record<string, unknown>, after, write: async (newState) => { await write({ state: newState }); } } });
      revision = takedown.revision;
      state = takedown.state;
    } else {
      // Atomic guard: revision `expectedRevision + 1` is claimed before the row is written (see `guardedEdit`).
      const edit = await guardedEdit(s, { table: 'audio_lessons', id, what: 'Lesson', expected: body.expectedRevision, current, diff: diff as Record<string, unknown>, snapshot: restorableSnapshot('audio_lessons', after) }, () => write());
      revision = edit.revision;
      state = edit.result.state as ContentState;
      // `lesson` is the row before the edit: a `chapterId` move to another collection refreshes the manifest it left.
      await invalidatePublishedContent(s, { table: 'audio_lessons', row: edit.result }, revision, { table: 'audio_lessons', row: lesson });
    }
    s.audit({ action: 'audio_lesson.patch', entityTable: 'audio_lessons', entityId: id, before: { state: lesson.state }, after: { state, revision, fields: Object.keys(patch), unpublished: unpublish } });
    return respondOk(c, AudioLessonPatchResponseSchema.parse({ lessonId: id, revision, state }));
  });

  define('adminAssetProcess', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, AssetProcessRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const asset = (await s.service.from('media_assets').select('id, checksum_sha256, disposition').eq('id', id).maybeSingle()).data;
    if (!asset) throw problem.notFound('Asset');
    if (asset.disposition !== 'active') throw problem.rights(`Asset is ${asset.disposition}; processing is blocked`);
    const jobs: ProcessingJobDto[] = [];
    let reusedFromHash = false;
    for (const op of body.operations) {
      const key = body.force ? `${op}:${asset.id}:${asset.checksum_sha256}:${Date.now()}` : `${op}:${asset.id}:${asset.checksum_sha256}`;
      const before = body.force ? null : (await s.service.from('processing_jobs').select('id, state').eq('idempotency_key', key).maybeSingle()).data;
      if (before?.state === 'succeeded') reusedFromHash = true;
      const job = await s.repos.processingJobs.enqueue({ jobType: op, idempotencyKey: key, parentAssetId: asset.id, priority: body.priority, requestedBy: principal.userId, params: body.params ?? {} });
      if (s.config.env.JOBS_BACKEND === 'cloudflare_queues' && s.config.bindings.JOBS_QUEUE && !before) await s.config.bindings.JOBS_QUEUE.send({ jobId: job.id, jobType: op });
      jobs.push(jobToDto(job));
    }
    s.audit({ action: 'asset.process', entityTable: 'media_assets', entityId: id, after: { operations: body.operations, force: body.force, jobs: jobs.map((j) => j.id) } });
    return respondOk(c, AssetProcessResponseSchema.parse({ jobs, reusedFromHash }), 202);
  });

  define('adminProcessingJob', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const job = await s.repos.processingJobs.getById(id);
    if (!job) throw problem.notFound('Processing job');
    return respondOk(c, jobToDto(job));
  });
}
