/**
 * §6.1 `GET /v1/courses/:trackId/manifest?source=fr&version=N` (ADR-004): the compact, versioned course
 * manifest for (track, source). Built from published rows through the learner's RLS client, then edge-cached
 * under `manifestCacheKey()` and invalidated by `manifest.invalidated` events on publish/unpublish.
 * Non-personal: the same bytes serve every learner of that (track, source) pair.
 */
import { CourseTrackIdSchema, ManifestQuerySchema, getCourseTrack } from '@langquest/contracts';
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
      const parsed = JSON.parse(cached.body) as { version: number };
      if (query.version === undefined || query.version === parsed.version) {
        return new Response(cached.body, { status: 200, headers: { 'content-type': 'application/json', ETag: cached.etag ?? '', 'Cache-Control': `private, max-age=${MANIFEST_TTL_SECONDS}`, 'X-Cache': 'HIT' } });
      }
    }
    const manifest = await repos.curriculum.buildManifest(trackId, query.source, getCourseTrack(trackId).targetVarietyId);
    const body = JSON.stringify({ ok: true, data: manifest });
    const etag = `"${manifest.checksum.slice(0, 32)}"`;
    await s.cache.put(key, body, Math.min(MANIFEST_TTL_SECONDS, manifest.cacheTtlSeconds || MANIFEST_TTL_SECONDS), etag);
    if (ifNoneMatch && ifNoneMatch === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return respondOk(c, manifest, 200, { ETag: etag, 'Cache-Control': `private, max-age=${MANIFEST_TTL_SECONDS}`, 'X-Cache': 'MISS' });
  });
}
