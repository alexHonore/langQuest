/**
 * §6.4 content lifecycle (§7.6, §9.8, A20): content-factory draft jobs, review requests, the rights-gated
 * publish checklist (`@langquest/media` `canPublish`), unpublish/takedown propagation and licence attributions.
 * Publishing records `publication_events` + `content_revisions`, emits `lesson.published` and
 * `manifest.invalidated` (edge cache purge), and is audit-logged.
 */
import { ContentGenerateRequestSchema, ContentGenerateResponseSchema, ContentPublishRequestSchema, ContentPublishResponseSchema, ContentRequestReviewRequestSchema, ContentRequestReviewResponseSchema, ContentUnpublishRequestSchema, ContentUnpublishResponseSchema, LicensesAttributionsQuerySchema, LicensesAttributionsResponseSchema, UuidSchema, getCourseTrack, isCourseTrackId, tracksForVariety, type ContentState, type CourseTrackId } from '@langquest/contracts';
import type { Row } from '@langquest/db/types';
import type { InvalidationInput } from '@langquest/media/manifests';
import { canPublish, propagateTakedown, type PublishGateInput } from '@langquest/media/rights';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, loadContent, locateContent, recordPublicationEvent, recordRevision, stateOf, titleOf, transitionContent, type ContentRow } from '../../lib/content';
import { rightsFor, rightsRecord } from '../../lib/rights';
import type { RequestServices } from '../../services/context';

const IdParams = z.object({ id: UuidSchema });

const trackIdsForVariety = (varietyId: string | null): CourseTrackId[] => (varietyId ? tracksForVariety(varietyId as never).map((t) => t.id) : []);

async function manifestsFor(s: RequestServices, content: ContentRow): Promise<InvalidationInput[]> {
  switch (content.table) {
    case 'missions':
    case 'characters':
    case 'expressions':
      return trackIdsForVariety(content.row.target_variety_id).map((courseTrackId) => ({ kind: 'course', courseTrackId, collectionId: null, sourceLanguageCode: null }));
    case 'lesson_courses':
      return isCourseTrackId(content.row.course_track_id) ? [{ kind: 'course', courseTrackId: content.row.course_track_id, collectionId: null, sourceLanguageCode: null }] : [];
    case 'audio_course_collections':
      return [{ kind: 'audio_collection', courseTrackId: null, collectionId: content.row.id, sourceLanguageCode: null }];
    case 'audio_lessons': {
      const ch = (await s.service.from('audio_chapters').select('collection_id').eq('id', content.row.chapter_id).maybeSingle()).data;
      return ch ? [{ kind: 'audio_collection', courseTrackId: null, collectionId: ch.collection_id, sourceLanguageCode: null }] : [];
    }
    default:
      return [];
  }
}

async function gateInputFor(s: RequestServices, content: ContentRow): Promise<PublishGateInput> {
  const state = stateOf(content);
  switch (content.table) {
    case 'audio_lessons': {
      const lesson = content.row;
      const [links, speakerLinks, chapter] = await Promise.all([
        s.service.from('audio_lesson_assets').select('asset_type, media_assets!inner(id, byte_length, disposition, state, derivation, etag)').eq('lesson_id', lesson.id).then((r) => (r.data ?? []) as unknown as { asset_type: string; media_assets: { id: string; byte_length: number; disposition: string; state: string; derivation: string | null; etag: string | null } }[]),
        s.service.from('lesson_speakers').select('speakers!inner(display_name, consent_state)').eq('lesson_id', lesson.id).then((r) => (r.data ?? []) as unknown as { speakers: { display_name: string; consent_state: Row<'speakers'>['consent_state'] } }[]),
        s.service.from('audio_chapters').select('collection_id, audio_course_collections!inner(content_rights_id)').eq('id', lesson.chapter_id).maybeSingle().then((r) => r.data as unknown as { collection_id: string; audio_course_collections: { content_rights_id: string | null } } | null),
      ]);
      const primary = links.find((l) => l.asset_type === 'mobile_encoded') ?? links.find((l) => l.asset_type === 'master') ?? null;
      const verifiedUpload = primary ? (await s.service.from('uploads').select('verified_checksum_sha256').eq('draft_asset_id', primary.media_assets.id).not('verified_checksum_sha256', 'is', null).limit(1).maybeSingle()).data : null;
      const rights = await rightsFor(s, lesson.content_rights_id ?? chapter?.audio_course_collections.content_rights_id);
      return {
        entityKind: 'audio_lesson',
        currentState: state,
        title: titleOf(lesson.title_translations),
        languageCode: lesson.target_variety_id ?? lesson.instruction_language_code,
        asset: primary ? { checksumVerified: Boolean(verifiedUpload) || primary.media_assets.derivation !== null, disposition: primary.media_assets.disposition as 'active', accessible: primary.media_assets.disposition === 'active', byteLength: primary.media_assets.byte_length } : null,
        speakers: { known: speakerLinks.length > 0, entries: speakerLinks.map((sl) => ({ name: sl.speakers.display_name, consentState: sl.speakers.consent_state as 'unknown' | 'pending' | 'granted' | 'revoked' })) },
        chapterId: lesson.chapter_id,
        rights: rightsRecord(rights),
        nativeReviewed: lesson.quality_review_status === 'approved',
      };
    }
    case 'audio_course_collections':
      return { entityKind: 'audio_collection', currentState: state, title: titleOf(content.row.title_translations), languageCode: content.row.target_variety_id ?? content.row.instruction_language_code, rights: rightsRecord(await rightsFor(s, content.row.content_rights_id)), speakers: null, nativeReviewed: false };
    case 'missions':
      return { entityKind: 'mission', currentState: state, title: titleOf(content.row.title_translations), languageCode: content.row.target_variety_id, rights: rightsRecord(await rightsFor(s, content.row.chapter_id ? (await s.service.from('chapters').select('lesson_courses!inner(content_rights_id)').eq('id', content.row.chapter_id).maybeSingle().then((r) => (r.data as unknown as { lesson_courses: { content_rights_id: string | null } } | null)?.lesson_courses.content_rights_id ?? null)) : null)), nativeReviewed: false, requireNativeReview: true };
    case 'lesson_courses':
      return { entityKind: 'mission', currentState: state, title: titleOf(content.row.title_translations), languageCode: content.row.course_track_id, rights: rightsRecord(await rightsFor(s, content.row.content_rights_id)), nativeReviewed: false };
    case 'expressions':
      return { entityKind: 'expression', currentState: state, title: content.row.canonical_text, languageCode: content.row.target_variety_id, rights: rightsRecord(await rightsFor(s, content.row.content_rights_id)), nativeReviewed: content.row.reviewed, requireNativeReview: true };
    case 'characters':
      return { entityKind: 'character', currentState: state, title: content.row.name, languageCode: content.row.target_variety_id, rights: null, nativeReviewed: false };
    case 'visual_assets':
      return { entityKind: 'visual_asset', currentState: state, title: content.row.alt_text_key, languageCode: 'und', asset: { checksumVerified: Boolean(content.row.content_hash), disposition: 'active', accessible: true, byteLength: content.row.byte_length }, rights: rightsRecord(await rightsFor(s, content.row.license_id)), altTextPresent: content.row.alt_text_key.length > 0, nativeReviewed: content.row.review_status === 'approved' };
  }
}

export function registerContentRoutes(define: DefineRoute): void {
  define('adminContentGenerate', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, ContentGenerateRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const key = `content_generate:${body.idempotencyKey}`;
    const before = (await s.service.from('processing_jobs').select('id').eq('idempotency_key', key).maybeSingle()).data;
    const job = await s.repos.processingJobs.enqueue({ jobType: 'content_generate', idempotencyKey: key, requestedBy: principal.userId, provider: 'openrouter', params: { targetTrack: body.targetTrack, targetVariety: getCourseTrack(body.targetTrack).targetVarietyId, sourceLanguage: body.sourceLanguage, intentKeys: body.intentKeys, level: body.level, scene: body.scene ?? null, characterId: body.characterId ?? null, count: body.count, publication: { status: 'draft', requiresVerifiedSourceRights: true, requiresNativeReview: true } } });
    const draftIds = ((job.output as { draftIds?: string[] } | null)?.draftIds ?? []).filter((v) => typeof v === 'string');
    s.audit({ action: 'content.generate', entityTable: 'processing_jobs', entityId: job.id, after: { targetTrack: body.targetTrack, sourceLanguage: body.sourceLanguage, intents: body.intentKeys.length, replayed: Boolean(before) } });
    return respondOk(c, ContentGenerateResponseSchema.parse({ jobId: job.id, draftIds, replayed: Boolean(before) }), before ? 200 : 202);
  });

  define('adminContentRequestReview', { role: 'languageReviewer' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentRequestReviewRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const content = await locateContent(s, id);
    const from = stateOf(content);
    const target: ContentState = from === 'published' ? 'published' : 'review_needed';
    if (target !== from) await transitionContent(s, content, target);
    const revision = await recordRevision(s, content.table, id, { requestReview: true, note: body.note ?? null, reviewerId: body.reviewerId ?? null }, body.note);
    await recordPublicationEvent(s, content.table, id, revision, from, target, body.note ?? 'review requested');
    const variety = 'target_variety_id' in content.row ? content.row.target_variety_id : null;
    if (variety && body.targetVarietyId && body.targetVarietyId !== variety) throw problem.validation(`Content is ${variety}; review cannot target ${body.targetVarietyId}`);
    if (variety) {
      const source = 'source_language_code' in content.row ? (content.row as { source_language_code?: string | null }).source_language_code : null;
      if (source) await s.events.emit('translation.review_requested', { entityTable: content.table, entityId: id, sourceLanguageCode: source as never, targetVarietyId: variety as never, requestedBy: principal.userId, reviewerId: body.reviewerId ?? null }, { idempotencyKey: `review:${content.table}:${id}:${revision}`, traceId: s.requestId });
    }
    s.audit({ action: 'content.request_review', entityTable: content.table, entityId: id, before: { state: from }, after: { state: target, reviewerId: body.reviewerId ?? null } });
    return respondOk(c, ContentRequestReviewResponseSchema.parse({ contentId: id, state: target, reviewStatus: 'pending' }));
  });

  define('adminContentPublish', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentPublishRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const content = await loadContent(s, body.entityTable, id);
    const revision = await currentRevision(s, content.table, id);
    if (body.expectedRevision !== revision) throw problem.precondition(`Content revision is ${revision}, expected ${body.expectedRevision}`, { currentRevision: revision });
    const gate = canPublish(await gateInputFor(s, content));
    if (!gate.allowed) {
      s.audit({ action: 'content.publish_blocked', entityTable: content.table, entityId: id, after: { blockedBy: gate.blockedBy } });
      return respondOk(c, ContentPublishResponseSchema.parse({ contentId: id, state: stateOf(content), revision, checklist: gate.checklist, blockedBy: gate.blockedBy, manifestInvalidated: false }));
    }
    const from = stateOf(content);
    const nextRevision = revision + 1;
    const extra: Record<string, unknown> = {};
    if (content.table === 'missions' || content.table === 'lesson_courses' || content.table === 'audio_lessons') extra.published_revision = nextRevision;
    if (content.table === 'audio_course_collections') extra.published_version = nextRevision;
    await transitionContent(s, content, 'published', extra);
    await recordRevision(s, content.table, id, { publish: true, note: body.note ?? null }, body.note);
    await recordPublicationEvent(s, content.table, id, nextRevision, from, 'published', body.note);
    const manifests = await manifestsFor(s, content);
    for (const m of manifests) await s.events.emit('manifest.invalidated', { ...m, newVersion: nextRevision, reason: 'published' }, { idempotencyKey: `manifest.invalidated:${content.table}:${id}:${nextRevision}:${m.courseTrackId ?? m.collectionId}`, traceId: s.requestId });
    if (content.table === 'audio_lessons' || content.table === 'missions' || content.table === 'lesson_courses' || content.table === 'audio_course_collections') {
      const trackId = content.table === 'lesson_courses' ? content.row.course_track_id : content.table === 'audio_course_collections' ? content.row.course_track_id : content.table === 'missions' ? (trackIdsForVariety(content.row.target_variety_id)[0] ?? null) : null;
      await s.events.emit('lesson.published', { entityTable: content.table, entityId: id, revision: nextRevision, courseTrackId: trackId && isCourseTrackId(trackId) ? trackId : null, publishedBy: principal.userId, state: 'published' }, { idempotencyKey: `lesson.published:${content.table}:${id}:${nextRevision}`, traceId: s.requestId });
    }
    s.audit({ action: 'content.publish', entityTable: content.table, entityId: id, before: { state: from, revision }, after: { state: 'published', revision: nextRevision, manifests: manifests.length } });
    return respondOk(c, ContentPublishResponseSchema.parse({ contentId: id, state: 'published', revision: nextRevision, checklist: gate.checklist, blockedBy: [], manifestInvalidated: manifests.length > 0 }));
  });

  define('adminContentUnpublish', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentUnpublishRequestSchema);
    const s = c.get('services')!;
    const content = await loadContent(s, body.entityTable, id);
    const from = stateOf(content);
    const manifests = await manifestsFor(s, content);
    const assetIds = content.table === 'audio_lessons' ? ((await s.service.from('audio_lesson_assets').select('asset_id').eq('lesson_id', id)).data ?? []).map((l) => l.asset_id) : [];
    const packs = content.table === 'audio_lessons' ? ((await s.service.from('user_download_manifests').select('id').eq('lesson_id', id).is('revoked_at', null)).data ?? []).map((p) => p.id) : [];
    // `lesson_courses` are course-level content; the takedown planner treats them like missions.
    const plan = propagateTakedown({ entity: { table: content.table === 'lesson_courses' ? 'missions' : content.table, id, state: from }, reason: body.reason, manifests, assetIds, dependentPackIds: packs });
    if (plan.newState !== from) await transitionContent(s, content, plan.newState);
    if (plan.revokePlaybackForAssetIds.length) await s.service.from('media_assets').update({ disposition: 'revoked' }).in('id', plan.revokePlaybackForAssetIds);
    if (plan.dependentPackIds.length) await s.service.from('user_download_manifests').update({ revoked_at: new Date().toISOString() }).in('id', plan.dependentPackIds);
    const revision = await recordRevision(s, content.table, id, { unpublish: true, reason: body.reason, note: body.note ?? null }, body.note);
    await recordPublicationEvent(s, content.table, id, revision, from, plan.newState, `${body.reason}${body.note ? `: ${body.note}` : ''}`);
    for (const m of plan.manifestInvalidations) await s.events.emit('manifest.invalidated', { kind: m.kind, courseTrackId: m.courseTrackId, collectionId: m.collectionId, sourceLanguageCode: m.sourceLanguageCode, newVersion: revision, reason: m.reason }, { idempotencyKey: `manifest.invalidated:${content.table}:${id}:${revision}:${m.courseTrackId ?? m.collectionId}`, traceId: s.requestId });
    s.audit({ action: 'content.unpublish', entityTable: content.table, entityId: id, before: { state: from }, after: { state: plan.newState, reason: body.reason, revokedAssets: plan.revokePlaybackForAssetIds.length, revokedPacks: plan.dependentPackIds.length } });
    return respondOk(c, ContentUnpublishResponseSchema.parse({ contentId: id, state: plan.newState, offlineEligibilityRevoked: plan.offlineEligibilityRevoked, manifestInvalidated: plan.manifestInvalidations.length > 0 }));
  });

  define('adminLicensesAttributions', {}, async (c) => {
    const q = parseQuery(c, LicensesAttributionsQuerySchema);
    const s = c.get('services')!;
    let query = s.service.from('content_rights').select('*').order('created_at', { ascending: false }).limit(q.limit + 1);
    if (q.onlyUnverified) query = query.eq('verified', false);
    if (q.cursor) query = query.lt('created_at', q.cursor);
    const res = await query;
    if (res.error) throw problem.internal(res.error.message);
    const rows = (res.data ?? []).slice(0, q.limit);
    const ids = rows.map((r) => r.id);
    const [assets, lessons, collections, expressions] = ids.length
      ? await Promise.all([
          s.service.from('media_assets').select('id, content_rights_id, state').in('content_rights_id', ids).then((r) => r.data ?? []),
          s.service.from('audio_lessons').select('id, content_rights_id, state').in('content_rights_id', ids).then((r) => r.data ?? []),
          s.service.from('audio_course_collections').select('id, content_rights_id, state, course_track_id').in('content_rights_id', ids).then((r) => r.data ?? []),
          s.service.from('expressions').select('id, content_rights_id, state').in('content_rights_id', ids).then((r) => r.data ?? []),
        ])
      : [[], [], [], []];
    const items = rows
      .map((r) => ({
        contentRightsId: r.id,
        licenseId: r.license_id,
        licenseVersion: r.license_version,
        originUrl: r.origin_url && /^https?:\/\//.test(r.origin_url) ? r.origin_url : null,
        authors: r.authors,
        attributionRequired: r.attribution_required,
        attributionText: r.attribution_text,
        commercialRedistribution: r.commercial_redistribution,
        verified: r.verified,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        usedBy: [
          ...assets.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'media_assets', entityId: a.id, state: a.state })),
          ...lessons.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'audio_lessons', entityId: a.id, state: a.state })),
          ...collections.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'audio_course_collections', entityId: a.id, state: a.state })),
          ...expressions.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'expressions', entityId: a.id, state: a.state })),
        ],
        _trackIds: collections.filter((a) => a.content_rights_id === r.id).map((a) => a.course_track_id),
      }))
      .filter((it) => !q.trackId || it._trackIds.includes(q.trackId))
      .map(({ _trackIds, ...it }) => it);
    return respondOk(c, LicensesAttributionsResponseSchema.parse({ items, nextCursor: (res.data ?? []).length > q.limit ? (rows[rows.length - 1]?.created_at ?? null) : null, total: null }));
  });
}
