/**
 * §6.3 audio library (§4.4, §7.6, A21–A23): published-only reads through the learner's RLS client, server-side
 * rights decisions, range-capable time-limited playback URLs (presigned S3 GET, or the Worker proxy when only
 * the R2 binding exists; `capability_unsupported` when R2 is not enabled — never a fake URL), transcripts by
 * language, idempotent progress, bookmarks and rights-gated download packs.
 */
import {
  AudioBookmarkCreateRequestSchema,
  AudioBookmarkResponseSchema,
  AudioChaptersResponseSchema,
  AudioCollectionsQuerySchema,
  AudioCollectionsResponseSchema,
  AudioLessonResponseSchema,
  AudioProgressPutRequestSchema,
  AudioProgressPutResponseSchema,
  DownloadPackQuerySchema,
  DownloadPackResponseSchema,
  PlaybackUrlRequestSchema,
  PlaybackUrlResponseSchema,
  TranscriptQuerySchema,
  TranscriptResponseSchema,
  UuidSchema,
  type AudioManifestLesson,
  type ContentState,
  type DownloadPackFile,
  type SourceLanguageCode,
} from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { extensionForMime } from '@langquest/media/keys';
import { buildAudioCollectionManifest, buildDownloadPackManifest, manifestCacheKey, packFilePath } from '@langquest/media/manifests';
import { authorizePlayback, computeExpiry, ttlForAsset, SIGNED_URL_POLICY } from '@langquest/media/playback';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { MEDIA_ASSET_COLUMNS, mediaAssetToRef, type MediaAssetPublicRow } from '../../lib/dto';
import { mediaStreamSecret, signStreamToken } from '../../lib/media-token';
import { attributionFor, loadRights, redistributable, rightsActive, rightsFor } from '../../lib/rights';
import { uuidFrom } from '../../lib/learning';
import { hasAnyRole } from '../../middleware/auth';
import { R2_UNAVAILABLE_MESSAGE } from '../../services/r2';
import type { RequestServices } from '../../services/context';

const IdParams = z.object({ id: UuidSchema });
const LessonParams = z.object({ lessonId: UuidSchema });
const title = (translations: unknown, lang: string | null): string => {
  const t = (translations ?? {}) as Record<string, string>;
  return (lang && t[lang]) || t.en || Object.values(t)[0] || '';
};
const description = (translations: unknown, lang: string | null): string | null => {
  const t = (translations ?? {}) as Record<string, string>;
  return (lang && t[lang]) || null;
};

/** Build a playback URL for an asset the caller is already authorised to play. */
async function playbackUrlFor(s: RequestServices, asset: Pick<Row<'media_assets'>, 'id' | 'storage_key' | 'duration_ms' | 'mime_type'>, userId: string, purpose: 'playback' | 'download'): Promise<{ url: string; expiresAt: string; method: 'signed_get' | 'worker_proxy' }> {
  const ttl = ttlForAsset({ durationMs: asset.duration_ms, purpose });
  const expiresAt = computeExpiry(new Date(), ttl);
  if (s.media.canPresign) return { url: await s.media.presignGet(asset.storage_key, ttl, { responseContentType: asset.mime_type }), expiresAt, method: 'signed_get' };
  if (s.media.available) {
    const token = signStreamToken(mediaStreamSecret(s.config.env), asset.id, userId, Math.floor(Date.parse(expiresAt) / 1000));
    return { url: `${s.config.env.API_ENV === 'production' ? 'https://api.langquest.app' : 'http://localhost:8787'}/v1/media/stream/${asset.id}?t=${encodeURIComponent(token)}`, expiresAt, method: 'worker_proxy' };
  }
  throw problem.unsupported(R2_UNAVAILABLE_MESSAGE);
}

export function registerAudioRoutes(define: DefineRoute): void {
  define('audioCollections', {}, async (c) => {
    const query = parseQuery(c, AudioCollectionsQuerySchema);
    const s = c.get('services')!;
    const { db, repos } = s.requireUser();
    const page = await repos.audioLibrary.listCollections({ courseTrackId: query.trackId, instructionLanguageCode: query.instructionLanguage, targetVarietyId: query.language, cursor: query.cursor, limit: query.limit });
    const items = query.q ? page.items.filter((col) => JSON.stringify(col.title_translations).toLowerCase().includes(query.q!.toLowerCase())) : page.items;
    const ids = items.map((col) => col.id);
    const [chapters, lessons, rights] = await Promise.all([
      ids.length ? db.from('audio_chapters').select('id, collection_id').in('collection_id', ids).then((r) => r.data ?? []) : Promise.resolve([]),
      ids.length ? db.from('audio_lessons').select('id, chapter_id, listen_length_ms, audio_chapters!inner(collection_id)').in('audio_chapters.collection_id', ids).then((r) => (r.data ?? []) as unknown as { id: string; chapter_id: string; listen_length_ms: number | null; audio_chapters: { collection_id: string } }[]) : Promise.resolve([]),
      loadRights(s, items.map((col) => col.content_rights_id)),
    ]);
    const lang = query.instructionLanguage ?? null;
    const out = items.map((col) => {
      const chapterIds = new Set(chapters.filter((ch) => ch.collection_id === col.id).map((ch) => ch.id));
      const lessonRows = lessons.filter((l) => chapterIds.has(l.chapter_id));
      const r = col.content_rights_id ? (rights.get(col.content_rights_id) ?? null) : null;
      return {
        id: col.id,
        title: title(col.title_translations, lang),
        description: description(col.description_translations, lang),
        courseTrackId: col.course_track_id,
        targetVarietyId: col.target_variety_id,
        instructionLanguageCode: col.instruction_language_code,
        region: col.region,
        instructorName: null,
        coverArt: null,
        chapterCount: chapterIds.size,
        lessonCount: lessonRows.length,
        totalDurationMs: lessonRows.some((l) => l.listen_length_ms !== null) ? lessonRows.reduce((n, l) => n + (l.listen_length_ms ?? 0), 0) : null,
        attributionText: attributionFor(r, title(col.title_translations, lang)),
        offlineEligible: col.state === 'published' && redistributable(r),
        version: col.published_version ?? 0,
      };
    });
    return respondOk(c, AudioCollectionsResponseSchema.parse({ items: out, nextCursor: page.nextCursor, total: null }));
  });

  define('audioCollectionChapters', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const { db, repos } = s.requireUser();
    const collection = await repos.audioLibrary.getCollection(id);
    if (!collection) throw problem.notFound('Collection');
    const lang = collection.instruction_language_code;
    const cacheKey = manifestCacheKey({ kind: 'audio_collection', collectionId: id, instructionLanguageCode: (lang as never) ?? null, version: collection.published_version ?? 0 });
    const cached = await s.cache.get(cacheKey);
    if (cached) return new Response(cached.body, { status: 200, headers: { 'content-type': 'application/json', 'Cache-Control': 'private, max-age=300', 'X-Cache': 'HIT' } });
    const chapters = await repos.audioLibrary.listChapters(id);
    const chapterIds = chapters.map((ch) => ch.id);
    const lessons = chapterIds.length ? ((await db.from('audio_lessons').select('*').in('chapter_id', chapterIds).order('sort_order')).data ?? []) : [];
    const lessonIds = lessons.map((l) => l.id);
    const [links, speakerLinks, transcripts, rightsRows] = await Promise.all([
      lessonIds.length ? db.from('audio_lesson_assets').select('*').in('lesson_id', lessonIds).then((r) => r.data ?? []) : Promise.resolve([]),
      lessonIds.length ? db.from('lesson_speakers').select('lesson_id, speakers!inner(display_name)').in('lesson_id', lessonIds).then((r) => (r.data ?? []) as unknown as { lesson_id: string; speakers: { display_name: string } | null }[]) : Promise.resolve([]),
      lessonIds.length ? db.from('transcripts').select('lesson_id, status, id').in('lesson_id', lessonIds).then((r) => r.data ?? []) : Promise.resolve([]),
      loadRights(s, [collection.content_rights_id, ...lessons.map((l) => l.content_rights_id)]),
    ]);
    const assetIds = [...new Set(links.map((l) => l.asset_id))];
    const media = assetIds.length ? (((await db.from('media_assets').select(MEDIA_ASSET_COLUMNS).in('id', assetIds)).data as MediaAssetPublicRow[] | null) ?? []) : [];
    const mediaById = new Map(media.map((m) => [m.id, m]));
    const transcriptIds = transcripts.map((t) => t.id);
    const translationLangs = transcriptIds.length ? ((await db.from('transcript_translations').select('language_code, transcript_segments!inner(transcript_id)').in('transcript_segments.transcript_id', transcriptIds)).data ?? []) as unknown as { language_code: string; transcript_segments: { transcript_id: string } }[] : [];
    const collectionRights = collection.content_rights_id ? (rightsRows.get(collection.content_rights_id) ?? null) : null;
    const toLesson = (l: Row<'audio_lessons'>): AudioManifestLesson => {
      const r = l.content_rights_id ? (rightsRows.get(l.content_rights_id) ?? collectionRights) : collectionRights;
      const tr = transcripts.filter((t) => t.lesson_id === l.id);
      const langs = [...new Set(translationLangs.filter((x) => tr.some((t) => t.id === x.transcript_segments.transcript_id)).map((x) => x.language_code))];
      return {
        id: l.id,
        order: l.sort_order,
        title: title(l.title_translations, lang),
        description: description(l.description_translations, lang),
        durationMs: l.listen_length_ms,
        level: l.level as AudioManifestLesson['level'],
        speakerNames: speakerLinks.filter((sp) => sp.lesson_id === l.id).map((sp) => sp.speakers?.display_name ?? '').filter(Boolean),
        assets: links.filter((lk) => lk.lesson_id === l.id && mediaById.has(lk.asset_id)).map((lk) => mediaAssetToRef(mediaById.get(lk.asset_id)!)),
        transcriptAvailable: tr.some((t) => t.status === 'ready' || t.status === 'reviewed'),
        transcriptLanguages: langs,
        offlineEligible: l.state === 'published' && redistributable(r),
      };
    };
    const manifest = buildAudioCollectionManifest({
      collectionId: collection.id,
      title: title(collection.title_translations, lang),
      targetVarietyId: collection.target_variety_id as never,
      instructionLanguageCode: (lang ?? null) as SourceLanguageCode | null,
      version: collection.published_version ?? 0,
      coverArt: null,
      attributionText: attributionFor(collectionRights, title(collection.title_translations, lang)),
      chapters: chapters.map((ch) => ({ id: ch.id, order: ch.sort_order, title: title(ch.title_translations, lang), summary: description(ch.summary_translations, lang), coverArt: null, lessons: lessons.filter((l) => l.chapter_id === ch.id).map(toLesson) })),
    });
    const body = JSON.stringify({ ok: true, data: AudioChaptersResponseSchema.parse({ manifest }) });
    await s.cache.put(cacheKey, body, 300, `"${manifest.checksum.slice(0, 32)}"`);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'Cache-Control': 'private, max-age=300', 'X-Cache': 'MISS' } });
  });

  define('audioLesson', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const found = await repos.audioLibrary.getLesson(id);
    if (!found) throw problem.notFound('Lesson');
    const { lesson, assets, speakers } = found;
    const chapter = (await db.from('audio_chapters').select('id, collection_id').eq('id', lesson.chapter_id).maybeSingle()).data;
    const lang = lesson.instruction_language_code;
    const [progress, bookmarks, transcript, rights, tags] = await Promise.all([
      repos.audioLibrary.getProgress(principal.userId, id),
      repos.audioLibrary.listBookmarks(principal.userId, id),
      repos.audioLibrary.getTranscript(id),
      rightsFor(s, lesson.content_rights_id),
      db.from('lesson_tags').select('tag').eq('lesson_id', id).then((r) => (r.data ?? []).map((t) => t.tag)),
    ]);
    const transcriptLanguages = transcript ? [...new Set((((await db.from('transcript_translations').select('language_code').in('segment_id', transcript.segments.map((sg) => sg.id).slice(0, 500))).data ?? []) as { language_code: string }[]).map((t) => t.language_code))] : [];
    return respondOk(
      c,
      AudioLessonResponseSchema.parse({
        id: lesson.id,
        collectionId: chapter?.collection_id ?? lesson.chapter_id,
        chapterId: lesson.chapter_id,
        title: title(lesson.title_translations, lang),
        description: description(lesson.description_translations, lang),
        order: lesson.sort_order,
        level: lesson.level,
        targetVarietyId: lesson.target_variety_id,
        instructionLanguageCode: lesson.instruction_language_code,
        spokenLanguageCodes: lesson.spoken_language_codes,
        speakers: speakers.map((sp) => ({ id: sp.id, displayName: sp.display_name, role: 'other', synthetic: sp.synthetic })),
        tags: [...new Set([...lesson.tags, ...tags])],
        durationMs: lesson.listen_length_ms,
        assets: assets.filter((a) => a.media).map((a) => ({ ref: mediaAssetToRef(a.media as MediaAssetPublicRow), type: a.asset_type })),
        coverArt: null,
        transcriptStatus: lesson.transcript_status,
        transcriptLanguages,
        attributionText: attributionFor(rights, title(lesson.title_translations, lang), speakers.map((sp) => sp.display_name)),
        offlineEligible: lesson.state === 'published' && redistributable(rights),
        progress: progress ? { positionMs: progress.position_ms, completed: progress.completed, revision: progress.revision } : null,
        bookmarks: bookmarks.map((b) => ({ id: b.id, positionMs: b.position_ms, note: b.note })),
        linkedMissionIds: [],
      }),
    );
  });

  define('audioPlaybackUrl', { idempotent: false }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, PlaybackUrlRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const assetRes = await s.service.from('media_assets').select('*').eq('id', id).maybeSingle();
    if (!assetRes.data) throw problem.notFound('Asset');
    let asset = assetRes.data;
    const linkRes = await s.service.from('audio_lesson_assets').select('lesson_id, asset_type, audio_lessons!inner(id, state, content_rights_id, visibility)').eq('asset_id', id).limit(1).maybeSingle();
    const link = linkRes.data as unknown as { lesson_id: string; asset_type: string; audio_lessons: { id: string; state: Row<'audio_lessons'>['state']; content_rights_id: string | null; visibility: string } } | null;
    if (link && body.preferredType && body.preferredType !== link.asset_type) {
      const sibling = await s.service.from('audio_lesson_assets').select('asset_id, media_assets!inner(*)').eq('lesson_id', link.lesson_id).eq('asset_type', body.preferredType).limit(1).maybeSingle();
      const siblingAsset = (sibling.data as unknown as { media_assets: Row<'media_assets'> } | null)?.media_assets;
      if (siblingAsset && siblingAsset.disposition === 'active') asset = siblingAsset;
    }
    const rights = await rightsFor(s, link?.audio_lessons.content_rights_id ?? asset.content_rights_id);
    const contentState = link?.audio_lessons.state ?? asset.state;
    const auth = authorizePlayback({
      requester: { userId: principal.userId, isAdmin: hasAnyRole(principal, 'contentEditor') },
      asset: { ownerId: asset.owner_id, visibility: asset.visibility as 'private' | 'authenticated' | 'public', disposition: asset.disposition as 'active' | 'quarantined' | 'revoked' | 'deleted' },
      contentState: contentState as ContentState,
      rightsActive: rightsActive(rights),
      learnerHasAccess: link ? link.audio_lessons.state === 'published' : false,
    });
    if (!auth.allowed) {
      if (auth.code === 'not_found') throw problem.notFound('Asset');
      if (auth.code === 'rights_blocked') throw problem.rights('This recording cannot be played: its rights are not verified or have been revoked');
      if (auth.code === 'unauthorized') throw problem.unauthorized();
      throw problem.forbidden();
    }
    const url = await playbackUrlFor(s, asset, principal.userId, 'playback');
    if (body.renewal) s.log.info('playback.renewed', { assetId: asset.id, mode: auth.mode });
    return respondOk(c, PlaybackUrlResponseSchema.parse({ assetId: asset.id, url: url.url, expiresAt: url.expiresAt, method: url.method, contentType: asset.mime_type, byteLength: asset.byte_length, etag: asset.etag, supportsRange: true, contentHash: asset.checksum_sha256 }), 200, { 'Cache-Control': 'no-store' });
  });

  define('audioLessonTranscript', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const query = parseQuery(c, TranscriptQuerySchema);
    const s = c.get('services')!;
    const { db, repos } = s.requireUser();
    let language = query.language ?? null;
    if (query.enrollmentId && !language) {
      const e = (await db.from('user_course_enrollments').select('source_language_code').eq('id', query.enrollmentId).maybeSingle()).data;
      language = (e?.source_language_code ?? null) as SourceLanguageCode | null;
    }
    const found = await repos.audioLibrary.getTranscript(id, language ?? undefined);
    if (!found) throw problem.notFound('Transcript');
    const { transcript, segments, translations } = found;
    const segmentIds = segments.map((sg) => sg.id);
    const words = segmentIds.length ? ((await db.from('transcript_word_alignments').select('*').in('segment_id', segmentIds).order('word_index')).data ?? []) : [];
    const translationBySegment = new Map(translations.map((t) => [t.segment_id, t]));
    const coveragePct = Number(transcript.coverage_pct);
    return respondOk(
      c,
      TranscriptResponseSchema.parse({
        lessonId: id,
        transcriptId: transcript.id,
        revision: transcript.revision,
        status: transcript.status,
        primaryLanguageCode: transcript.primary_language_code,
        languageMode: transcript.language_mode,
        reviewed: transcript.qa_state === 'reviewed' || transcript.qa_state === 'approved',
        coveragePct: Number.isFinite(coveragePct) ? coveragePct : 0,
        segments: segments.map((sg) => {
          const tr = translationBySegment.get(sg.id);
          const ws = words.filter((w) => w.segment_id === sg.id);
          return { id: sg.id, index: sg.sort_index, startMs: sg.start_ms, endMs: sg.end_ms, text: sg.text, transliteration: null, speakerLabel: sg.speaker_label, languageCode: sg.language_code, confidence: sg.confidence, translation: tr ? { languageCode: tr.language_code, text: tr.text, qaState: tr.qa_state } : null, words: ws.map((w) => ({ word: w.word, startMs: w.start_ms, endMs: w.end_ms, expressionId: w.expression_id })), linkedExpressionIds: [...new Set(ws.map((w) => w.expression_id).filter((v): v is string => v !== null))] };
        }),
        translationUnavailableFor: language && translations.length === 0 ? language : null,
      }),
      200,
      { 'Cache-Control': 'private, max-age=300' },
    );
  });

  define('audioProgressPut', { idempotent: false }, async (c) => {
    const { lessonId } = parseParams(c, LessonParams);
    const body = await parseBody(c, AudioProgressPutRequestSchema);
    const s = c.get('services')!;
    const { repos, principal } = s.requireUser();
    const [result] = await repos.progress.applySyncEvents([{ clientEventId: body.clientEventId, enrollmentId: null, deviceId: body.deviceId, revision: body.revision, occurredAt: body.occurredAt, payload: { type: 'audio_progress', lessonId, positionMs: body.positionMs, durationMs: body.durationMs, completed: body.completed } }]);
    if (!result) throw problem.internal('Sync returned no result');
    if (result.resolution === 'rejected') throw problem.validation(`Progress rejected: ${result.reason ?? 'unknown'}`);
    const row = await repos.audioLibrary.getProgress(principal.userId, lessonId);
    return respondOk(c, AudioProgressPutResponseSchema.parse({ lessonId, positionMs: row?.position_ms ?? body.positionMs, completed: row?.completed ?? body.completed, revision: row?.revision ?? body.revision, resolution: result.resolution }));
  });

  define('audioBookmarkCreate', {}, async (c) => {
    const body = await parseBody(c, AudioBookmarkCreateRequestSchema);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const existing = await db.from('bookmarks').select('*').eq('client_event_id', body.clientEventId).maybeSingle();
    if (existing.data) {
      const b = existing.data;
      return respondOk(c, AudioBookmarkResponseSchema.parse({ id: b.id, lessonId: b.lesson_id, positionMs: b.position_ms, note: b.note, segmentId: b.segment_id, createdAt: b.created_at, replayed: true }));
    }
    const lesson = await db.from('audio_lessons').select('id').eq('id', body.lessonId).maybeSingle();
    if (!lesson.data) throw problem.notFound('Lesson');
    let row;
    try {
      row = await repos.audioLibrary.createBookmark({ user_id: principal.userId, lesson_id: body.lessonId, position_ms: body.positionMs, note: body.note, segment_id: body.segmentId, client_event_id: body.clientEventId });
    } catch (error) {
      if (error instanceof DbError && error.code === '23503') throw problem.validation('Unknown segment');
      throw error;
    }
    return respondOk(c, AudioBookmarkResponseSchema.parse({ id: row.id, lessonId: row.lesson_id, positionMs: row.position_ms, note: row.note, segmentId: row.segment_id, createdAt: row.created_at, replayed: false }), 201);
  });

  define('audioDownloadPack', {}, async (c) => {
    const { lessonId } = parseParams(c, LessonParams);
    const query = parseQuery(c, DownloadPackQuerySchema);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const found = await repos.audioLibrary.getLesson(lessonId);
    if (!found) throw problem.notFound('Lesson');
    const { lesson, assets, speakers } = found;
    const chapter = (await db.from('audio_chapters').select('collection_id').eq('id', lesson.chapter_id).maybeSingle()).data;
    const rights = await rightsFor(s, lesson.content_rights_id);
    const distributionAllowed = lesson.state === 'published' && redistributable(rights);
    if (!distributionAllowed) throw problem.rights('This lesson cannot be downloaded for offline use: redistribution rights are not verified');
    if (!s.media.canPresign && !s.media.available) throw problem.unsupported(R2_UNAVAILABLE_MESSAGE);
    const playable = assets.filter((a) => a.media && a.media.disposition === 'active' && (a.asset_type === 'mobile_encoded' || a.asset_type === 'master' || a.asset_type === 'slow'));
    const preferred = playable.some((a) => a.asset_type === 'mobile_encoded') ? playable.filter((a) => a.asset_type !== 'master') : playable;
    if (!preferred.length) throw problem.notFound('Playable audio for this lesson');
    const files: DownloadPackFile[] = [];
    for (const a of preferred) {
      const m = a.media as MediaAssetPublicRow;
      const url = await playbackUrlFor(s, { id: m.id, storage_key: m.storage_key, duration_ms: m.duration_ms, mime_type: m.mime_type }, principal.userId, 'download');
      files.push({ assetId: m.id, kind: m.kind as DownloadPackFile['kind'], path: packFilePath({ assetId: m.id, mimeType: m.mime_type }, extensionForMime(m.mime_type) ?? 'bin'), contentHash: m.checksum_sha256, byteLength: m.byte_length, mimeType: m.mime_type, url: url.url, urlExpiresAt: url.expiresAt });
    }
    const version = lesson.published_revision ?? 0;
    const packId = uuidFrom(`pack:${lesson.id}:${query.deviceId}:${version}`);
    const transcript = query.includeTranscript ? await repos.audioLibrary.getTranscript(lessonId) : null;
    const manifest = buildDownloadPackManifest({ packId, lessonId: lesson.id, collectionId: chapter?.collection_id ?? lesson.chapter_id, version, files, includesTranscript: Boolean(transcript), distributionAllowed: true, attributionText: attributionFor(rights, title(lesson.title_translations, lesson.instruction_language_code), speakers.map((sp) => sp.display_name)) });
    await repos.audioLibrary.upsertDownloadManifest({ user_id: principal.userId, lesson_id: lesson.id, pack_id: packId, version, checksum: manifest.checksum, total_bytes: manifest.totalBytes, device_id: query.deviceId });
    s.log.info('download_pack.issued', { lessonId, files: files.length, ttl: SIGNED_URL_POLICY.downloadTtlSeconds });
    return respondOk(c, DownloadPackResponseSchema.parse({ manifest }), 200, { 'Cache-Control': 'no-store' });
  });
}
