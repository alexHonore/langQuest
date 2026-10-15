/**
 * Edge cache for non-personal manifests (ADR-004, §4.4): Cloudflare Cache API when available
 * (`caches.default`), with a per-isolate memory map as fallback so the same code runs under Node tests.
 * Keys follow `@langquest/media` `manifestCacheKey()`; invalidation deletes every source-language key of a
 * track (or every instruction language of a collection) on `manifest.invalidated`.
 */
import { LANGUAGE_CODES, type CourseTrackId, type SourceLanguageCode } from '@langquest/contracts';
import { manifestCacheKey } from '@langquest/media/manifests';

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

const CACHE_ORIGIN = 'https://cache.langquest.internal/';

export interface EdgeCache {
  get(key: string): Promise<{ body: string; etag: string | null } | null>;
  put(key: string, body: string, ttlSeconds: number, etag?: string | null): Promise<void>;
  delete(key: string): Promise<void>;
  invalidateCourse(courseTrackId: CourseTrackId, sourceLanguageCode: SourceLanguageCode | null): Promise<number>;
  invalidateAudioCollection(collectionId: string, instructionLanguageCode: SourceLanguageCode | null): Promise<number>;
}

const toRequest = (key: string): Request => new Request(`${CACHE_ORIGIN}${encodeURIComponent(key)}`);

export function createEdgeCache(options: { cache?: CacheLike | null } = {}): EdgeCache {
  const cfCache = options.cache === undefined ? resolveDefaultCache() : options.cache;
  const memory = new Map<string, { body: string; etag: string | null; expiresAt: number }>();

  const api: EdgeCache = {
    async get(key) {
      const mem = memory.get(key);
      if (mem && mem.expiresAt > Date.now()) return { body: mem.body, etag: mem.etag };
      if (mem) memory.delete(key);
      if (!cfCache) return null;
      try {
        const hit = await cfCache.match(toRequest(key));
        if (!hit) return null;
        return { body: await hit.text(), etag: hit.headers.get('etag') };
      } catch {
        return null;
      }
    },
    async put(key, body, ttlSeconds, etag) {
      if (memory.size > 2000) memory.clear();
      memory.set(key, { body, etag: etag ?? null, expiresAt: Date.now() + ttlSeconds * 1000 });
      if (!cfCache) return;
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` };
        if (etag) headers.etag = etag;
        await cfCache.put(toRequest(key), new Response(body, { headers }));
      } catch {
        /* cache is best-effort */
      }
    },
    async delete(key) {
      memory.delete(key);
      if (!cfCache) return;
      try {
        await cfCache.delete(toRequest(key));
      } catch {
        /* best-effort */
      }
    },
    async invalidateCourse(courseTrackId, sourceLanguageCode) {
      const sources = sourceLanguageCode ? [sourceLanguageCode] : [...LANGUAGE_CODES];
      let n = 0;
      for (const s of sources) {
        await api.delete(manifestCacheKey({ kind: 'course', courseTrackId, sourceLanguageCode: s }));
        n += 1;
      }
      return n;
    },
    async invalidateAudioCollection(collectionId, instructionLanguageCode) {
      const langs: (SourceLanguageCode | null)[] = instructionLanguageCode ? [instructionLanguageCode] : [null, ...LANGUAGE_CODES];
      let n = 0;
      for (const l of langs) {
        await api.delete(manifestCacheKey({ kind: 'audio_collection', collectionId, instructionLanguageCode: l }));
        n += 1;
      }
      return n;
    },
  };
  return api;
}

function resolveDefaultCache(): CacheLike | null {
  const g = globalThis as unknown as { caches?: { default?: CacheLike } };
  return g.caches && typeof g.caches === 'object' && g.caches.default ? g.caches.default : null;
}
