/**
 * §6.1 `GET /v1/courses/:trackId/manifest?source=fr&version=N` (ADR-004): the compact, versioned course
 * manifest for (track, source). Built from published rows through the learner's RLS client, then edge-cached
 * under `manifestCacheKey()` and invalidated by `manifest.invalidated` events on publish/unpublish.
 * Non-personal: the same bytes serve every learner of that (track, source) pair. Served from `course_manifests`
 * (the copy stored on publish; RLS exposes published versions only) when one exists, built live otherwise.
 */
import { CourseTrackIdSchema, ManifestQuerySchema, getCourseTrack, type CourseManifest } from '@langquest/contracts';
import { manifestCacheKey } from '@langquest/media/manifests';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { respondOk } from '../../http/envelope';
import { parseParams, parseQuery } from '../../http/validate';

export const MANIFEST_TTL_SECONDS = 3600;

export function registerManifestRoutes(define: DefineRoute): void {
  define('courseManifest', {}, async (c) => {
    const { trackId } = parseParams(c, z.object({ trackId: CourseTrackIdSchema }));
    const query = parseQuery(c, ManifestQuerySchema);
    const s = c.get('services')!;
    const { repos } = s.requireUser();
    const key = manifestCacheKey({ kind: 'course', courseTrackId: trackId, sourceLanguageCode: query.source });
    const ifNoneMatch = c.req.header('if-none-match');
    const cached = await s.cache.get(key);
    if (cached) {
      if (ifNoneMatch && cached.etag && ifNoneMatch === cached.etag) return new Response(null, { status: 304, headers: { ETag: cached.etag, 'Cache-Control': `private, max-age=${MANIFEST_TTL_SECONDS}` } });
      // The cached body is the full envelope: the manifest version lives under `data`.
      const parsed = JSON.parse(cached.body) as { data?: { version?: number } };
      if (query.version === undefined || query.version === parsed.data?.version) {
        return new Response(cached.body, { status: 200, headers: { 'content-type': 'application/json', ETag: cached.etag ?? '', 'Cache-Control': `private, max-age=${MANIFEST_TTL_SECONDS}`, 'X-Cache': 'HIT' } });
      }
    }
    // Stored copy (published version; a specific `?version=` only when that version was published), else a live build.
    let stored = await repos.manifests.getLatestCourseManifest(trackId, query.source);
    if (stored && query.version !== undefined && stored.version !== query.version) stored = (await repos.manifests.getCourseManifestVersion(trackId, query.source, query.version)) ?? null;
    if (stored && !stored.published_at) stored = null;
    const manifest = stored ? (stored.manifest as unknown as CourseManifest) : await repos.curriculum.buildManifest(trackId, query.source, getCourseTrack(trackId).targetVarietyId);
    const body = JSON.stringify({ ok: true, data: manifest });
    const etag = `"${manifest.checksum.slice(0, 32)}"`;
    // Only the latest stored/live manifest is edge-cached under the versionless key (older versions are served directly).
    if (!stored || query.version === undefined || stored.version === query.version) await s.cache.put(key, body, Math.min(MANIFEST_TTL_SECONDS, manifest.cacheTtlSeconds || MANIFEST_TTL_SECONDS), etag);
    if (ifNoneMatch && ifNoneMatch === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return respondOk(c, manifest, 200, { ETag: etag, 'Cache-Control': `private, max-age=${MANIFEST_TTL_SECONDS}`, 'X-Cache': 'MISS', 'X-Manifest-Source': stored ? 'stored' : 'live' });
  });
}
