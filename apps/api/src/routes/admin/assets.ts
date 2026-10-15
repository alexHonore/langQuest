/**
 * §6.4 asset management (§7.3): filtered asset listing, bulk labelling (reversible via `content_revisions`),
 * lesson patching with optimistic concurrency, processing requests (deduplicated by content hash) and job status.
 * Every mutation is audit-logged with the editor id and request id.
 */
import { AssetProcessRequestSchema, AssetProcessResponseSchema, AssetsListQuerySchema, AssetsListResponseSchema, AudioLessonPatchRequestSchema, AudioLessonPatchResponseSchema, BulkLabelRequestSchema, BulkLabelResponseSchema, ProcessingJobResponseSchema, UuidSchema, type ContentState, type ProcessingJobDto } from '@langquest/contracts';
import type { Row, Update } from '@langquest/db/types';
import { canTransitionContent } from '@langquest/media/rights';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, recordRevision } from '../../lib/content';
import { loadRights } from '../../lib/rights';
import type { RequestServices } from '../../services/context';

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
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    let assetIds = body.assetIds ?? [];
    if (body.filter) assetIds = [...new Set([...assetIds, ...(await queryAssets(s, { ...body.filter, limit: 5000, sort: 'created_desc' })).assets.map((a) => a.id)])];
    const links = await lessonLinks(s, assetIds);
    const lessonIds = new Set<string>([...(body.lessonIds ?? []), ...[...links.values()].map((l) => l.lesson_id)]);
    const p = body.patch;
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
    if (p.state !== undefined) lessonPatch.state = p.state;
    if (p.visibility !== undefined) lessonPatch.visibility = p.visibility;
    const skipped: { id: string; reason: string }[] = [];
    const revisionIds: string[] = [];
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
        if (res.error) skipped.push({ id: a.id, reason: res.error.message });
        else affected += 1;
      }
    }
    for (const lessonId of lessonIds) {
      const lesson = (await s.service.from('audio_lessons').select('id, state, tags').eq('id', lessonId).maybeSingle()).data;
      if (!lesson) {
        skipped.push({ id: lessonId, reason: 'lesson not found' });
        continue;
      }
      if (lessonPatch.state && lessonPatch.state !== lesson.state && !canTransitionContent(lesson.state as ContentState, lessonPatch.state as ContentState)) {
        skipped.push({ id: lessonId, reason: `cannot move from ${lesson.state} to ${lessonPatch.state}` });
        continue;
      }
      const patch: Update<'audio_lessons'> = { ...lessonPatch };
      if (p.addTags || p.removeTags) patch.tags = [...new Set([...lesson.tags.filter((t) => !(p.removeTags ?? []).includes(t)), ...(p.addTags ?? [])])];
      if (p.description !== undefined) patch.description_translations = { en: p.description ?? '' } as never;
      if (Object.keys(patch).length) {
        const res = await s.service.from('audio_lessons').update(patch).eq('id', lessonId);
        if (res.error) {
          skipped.push({ id: lessonId, reason: res.error.message });
          continue;
        }
      }
      if (p.speakerId) await s.service.from('lesson_speakers').upsert({ lesson_id: lessonId, speaker_id: p.speakerId, role: 'other' }, { onConflict: 'lesson_id,speaker_id,role' });
      const revision = await recordRevision(s, 'audio_lessons', lessonId, { bulk: true, patch: p as Record<string, unknown>, applyToChildren: body.applyToChildren }, `bulk-label ${body.idempotencyKey}`);
      revisionIds.push(`${lessonId}:${revision}`);
      affected += 1;
    }
    s.audit({ action: 'assets.bulk_label', entityTable: 'media_assets', entityId: null, after: { affected, skipped: skipped.length, patch: p, idempotencyKey: body.idempotencyKey, actor: principal.userId } });
    // Revision ids are `${lessonId}:${revision}` pairs; the contract expects uuids, so return the lesson ids touched.
    return respondOk(c, BulkLabelResponseSchema.parse({ affected, revisionIds: revisionIds.map((r) => r.split(':')[0]), skipped: skipped.slice(0, 200) }));
  });

  define('adminAudioLessonPatch', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, AudioLessonPatchRequestSchema);
    const s = c.get('services')!;
    const lesson = (await s.service.from('audio_lessons').select('*').eq('id', id).maybeSingle()).data;
    if (!lesson) throw problem.notFound('Lesson');
    const current = await currentRevision(s, 'audio_lessons', id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== current) throw problem.precondition(`Lesson revision is ${current}, expected ${body.expectedRevision}`, { currentRevision: current });
    if (body.state !== undefined && body.state !== lesson.state && !canTransitionContent(lesson.state as ContentState, body.state)) throw problem.precondition(`Lesson cannot move from ${lesson.state} to ${body.state}; use the publish endpoint for publication`);
    if (body.state === 'published') throw problem.precondition('Use POST /v1/admin/content/:id/publish (rights gate) to publish');
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
    if (body.state !== undefined) patch.state = body.state;
    if (body.visibility !== undefined) patch.visibility = body.visibility;
    if (body.qualityReviewStatus !== undefined) patch.quality_review_status = body.qualityReviewStatus;
    const updated = await s.service.from('audio_lessons').update(patch).eq('id', id).select('*').single();
    if (updated.error) throw problem.internal(`Could not update the lesson: ${updated.error.message}`);
    if (body.speakerIds) {
      await s.service.from('lesson_speakers').delete().eq('lesson_id', id);
      if (body.speakerIds.length) await s.service.from('lesson_speakers').insert(body.speakerIds.map((speaker_id) => ({ lesson_id: id, speaker_id, role: 'other' })));
    }
    const { expectedRevision: _expected, ...diff } = body;
    const revision = await recordRevision(s, 'audio_lessons', id, diff as Record<string, unknown>);
    s.audit({ action: 'audio_lesson.patch', entityTable: 'audio_lessons', entityId: id, before: { state: lesson.state }, after: { state: updated.data.state, revision, fields: Object.keys(patch) } });
    return respondOk(c, AudioLessonPatchResponseSchema.parse({ lessonId: id, revision, state: updated.data.state }));
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
