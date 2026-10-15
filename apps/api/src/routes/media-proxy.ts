/**
 * Worker-proxied media streaming (§4.4): used when the `MEDIA` R2 binding exists without S3 presigning
 * credentials. The URL carries a short-lived HMAC token issued by `/v1/audio/assets/:id/playback-url` after
 * authorization; this route re-checks the asset disposition, honours `Range`, and sets ETag / Content-Range /
 * Cache-Control through `buildMediaResponseHeaders`.
 */
import { buildMediaResponseHeaders, parseRangeHeader } from '@langquest/media/playback';
import type { Hono } from 'hono';
import { respondErr } from '../http/envelope';
import { mediaStreamSecret, verifyStreamToken } from '../lib/media-token';
import type { SharedServices } from '../services/context';
import type { AppEnv } from '../types';

export const MEDIA_STREAM_PATH = '/v1/media/stream/:assetId';

export function registerMediaProxyRoutes(app: Hono<AppEnv>, shared: SharedServices): void {
  app.get(MEDIA_STREAM_PATH, async (c) => {
    const token = c.req.query('t');
    const assetId = c.req.param('assetId');
    const verified = token ? verifyStreamToken(mediaStreamSecret(shared.config.env), token) : null;
    if (!verified || verified.assetId !== assetId) return respondErr(c, 'unauthorized', 'Invalid or expired media token; request a new playback URL');
    if (!shared.media.available) return respondErr(c, 'capability_unsupported', 'Media storage is not configured');
    const assetRes = await shared.service.from('media_assets').select('id, storage_key, mime_type, byte_length, etag, checksum_sha256, visibility, disposition').eq('id', assetId).maybeSingle();
    const asset = assetRes.data;
    if (!asset || asset.disposition !== 'active') return respondErr(c, 'not_found', 'Asset not found');
    const range = parseRangeHeader(c.req.header('range'), asset.byte_length);
    const ttlSeconds = 300;
    const headersFor = (etag: string | null) => buildMediaResponseHeaders({ contentType: asset.mime_type, totalLength: asset.byte_length, etag, contentHash: asset.checksum_sha256, range, visibility: asset.visibility as 'private' | 'authenticated' | 'public', ttlSeconds });
    if (range.kind === 'unsatisfiable' || range.kind === 'invalid') {
      const h = headersFor(asset.etag);
      return new Response(null, { status: h.status, headers: h.headers });
    }
    const streamRange = range.kind === 'partial' ? { offset: range.start, length: range.length } : undefined;
    let object;
    try {
      object = await shared.media.stream(asset.storage_key, streamRange);
    } catch (error) {
      c.get('log').error('media.stream_failed', { error });
      return respondErr(c, 'provider_unavailable', 'Media storage is temporarily unavailable');
    }
    if (!object) return respondErr(c, 'not_found', 'Media object missing');
    const h = headersFor(object.etag ?? asset.etag);
    if (c.req.method === 'HEAD') return new Response(null, { status: h.status, headers: h.headers });
    return new Response(object.body, { status: h.status, headers: h.headers });
  });
}
