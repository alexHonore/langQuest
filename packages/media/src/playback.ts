/**
 * Signed playback URL policy helpers (§4.4, §14.1 A21/A22). Platform-agnostic: the API signs
 * with R2/S3 presigning or serves through a Worker proxy; this module decides TTLs, renewal
 * timing, byte-range semantics and the response headers that make seeking/resume work.
 */
import type { ContentState } from '@langquest/contracts';

export const SIGNED_URL_POLICY = {
  /** Default lifetime of a playback URL. */
  defaultTtlSeconds: 15 * 60,
  /** Hard upper bound (long audiobooks still renew rather than getting multi-hour URLs). */
  maxTtlSeconds: 60 * 60,
  /** Minimum lifetime so a URL handed to a native player is not already stale. */
  minTtlSeconds: 2 * 60,
  /** Renew when less than this remains (A22: expiry mid-playback must be invisible). */
  renewBeforeExpirySeconds: 2 * 60,
  /** Download packs get longer URLs because the client may be on a slow connection. */
  downloadTtlSeconds: 60 * 60,
  /** Extra margin added to the remaining playback time when sizing a TTL. */
  playbackMarginSeconds: 5 * 60,
  /** Allowed clock skew between client and server when judging expiry. */
  clockSkewSeconds: 30,
} as const;

/** Choose a TTL (seconds) for an asset: covers the remaining playback with margin, clamped to policy bounds. */
export function ttlForAsset(input: { durationMs: number | null; positionMs?: number; purpose?: 'playback' | 'download' }): number {
  if (input.purpose === 'download') return SIGNED_URL_POLICY.downloadTtlSeconds;
  const remainingMs = input.durationMs === null ? 0 : Math.max(0, input.durationMs - (input.positionMs ?? 0));
  const wanted = Math.ceil(remainingMs / 1000) + SIGNED_URL_POLICY.playbackMarginSeconds;
  return Math.max(SIGNED_URL_POLICY.minTtlSeconds, Math.min(SIGNED_URL_POLICY.maxTtlSeconds, Math.max(wanted, SIGNED_URL_POLICY.defaultTtlSeconds)));
}

export function computeExpiry(now: Date, ttlSeconds: number): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error('ttlSeconds must be positive');
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

export function isUrlExpired(expiresAt: string, now: Date): boolean {
  return now.getTime() + SIGNED_URL_POLICY.clockSkewSeconds * 1000 >= Date.parse(expiresAt);
}

export interface RenewalDecision {
  renew: boolean;
  reason: 'expired' | 'expiring_soon' | 'playback_outlives_url' | 'fresh';
  /** Milliseconds until the client should ask again (0 = now). */
  checkAgainInMs: number;
  secondsRemaining: number;
}

/**
 * Decide whether the player should fetch a renewed URL now. Renews when the URL is expired, inside
 * the renewal window, or when the remaining playback (at the current rate) outlives the URL.
 */
export function shouldRenew(input: { expiresAt: string; now: Date; remainingPlaybackMs?: number | null; playbackRate?: number }): RenewalDecision {
  const msLeft = Date.parse(input.expiresAt) - input.now.getTime() - SIGNED_URL_POLICY.clockSkewSeconds * 1000;
  const secondsRemaining = Math.max(0, Math.floor(msLeft / 1000));
  if (msLeft <= 0) return { renew: true, reason: 'expired', checkAgainInMs: 0, secondsRemaining: 0 };
  const windowMs = SIGNED_URL_POLICY.renewBeforeExpirySeconds * 1000;
  if (msLeft <= windowMs) return { renew: true, reason: 'expiring_soon', checkAgainInMs: 0, secondsRemaining };
  const rate = input.playbackRate && input.playbackRate > 0 ? input.playbackRate : 1;
  const remaining = input.remainingPlaybackMs ?? null;
  if (remaining !== null && remaining / rate > msLeft) {
    // Playback will outlive the URL: renew proactively once we enter the window, not immediately.
    return { renew: false, reason: 'playback_outlives_url', checkAgainInMs: Math.max(1000, msLeft - windowMs), secondsRemaining };
  }
  return { renew: false, reason: 'fresh', checkAgainInMs: Math.max(1000, msLeft - windowMs), secondsRemaining };
}

// --- byte ranges -------------------------------------------------------------------------

export type RangeResult = { kind: 'full' } | { kind: 'partial'; start: number; end: number; length: number } | { kind: 'unsatisfiable' } | { kind: 'invalid' };

/** Parse a single-range `Range` header against a known total length (multi-range requests are rejected as invalid). */
export function parseRangeHeader(header: string | null | undefined, totalLength: number): RangeResult {
  if (!header) return { kind: 'full' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: 'invalid' };
  const [, startRaw, endRaw] = m;
  if (startRaw === '' && endRaw === '') return { kind: 'invalid' };
  if (totalLength <= 0) return { kind: 'unsatisfiable' };
  let start: number;
  let end: number;
  if (startRaw === '') {
    const suffix = Number.parseInt(endRaw!, 10);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, totalLength - suffix);
    end = totalLength - 1;
  } else {
    start = Number.parseInt(startRaw!, 10);
    end = endRaw === '' ? totalLength - 1 : Math.min(Number.parseInt(endRaw!, 10), totalLength - 1);
  }
  if (start >= totalLength || start > end) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end, length: end - start + 1 };
}

export interface MediaResponseHeadersInput {
  contentType: string;
  totalLength: number;
  etag: string | null;
  contentHash: string;
  range: RangeResult;
  /** Private media is never shared-cacheable; public assets may be cached longer. */
  visibility: 'private' | 'authenticated' | 'public';
  /** Seconds until the signed URL expires; caps `max-age` so caches never outlive the authorization. */
  ttlSeconds: number;
  /** Original filename for `Content-Disposition` (downloads only; sanitised by the caller). */
  downloadFilename?: string | null;
}

/** HTTP status + headers for a media response (range-capable, ETag, content-length, cache-control, hash). */
export function buildMediaResponseHeaders(input: MediaResponseHeadersInput): { status: 200 | 206 | 416; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': input.contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Content-Hash': `sha256:${input.contentHash}`,
    'Cache-Control': input.visibility === 'public' ? `public, max-age=${Math.max(0, Math.min(86400, input.ttlSeconds))}, immutable` : `private, max-age=${Math.max(0, Math.min(input.ttlSeconds, 3600))}, no-transform`,
  };
  if (input.etag) headers.ETag = input.etag.startsWith('"') ? input.etag : `"${input.etag}"`;
  if (input.downloadFilename) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(input.downloadFilename)}`;
  if (input.range.kind === 'unsatisfiable' || input.range.kind === 'invalid') {
    headers['Content-Range'] = `bytes */${input.totalLength}`;
    return { status: 416, headers };
  }
  if (input.range.kind === 'partial') {
    headers['Content-Range'] = `bytes ${input.range.start}-${input.range.end}/${input.totalLength}`;
    headers['Content-Length'] = String(input.range.length);
    return { status: 206, headers };
  }
  headers['Content-Length'] = String(input.totalLength);
  return { status: 200, headers };
}

/** `If-None-Match` / `If-Range` evaluation for ETag-based conditional requests. */
export function etagMatches(headerValue: string | null | undefined, etag: string | null): boolean {
  if (!headerValue || !etag) return false;
  const normalized = etag.replace(/^W\//, '').replace(/^"|"$/g, '');
  return headerValue.split(',').map((v) => v.trim().replace(/^W\//, '').replace(/^"|"$/g, '')).some((v) => v === '*' || v === normalized);
}

// --- authorization -----------------------------------------------------------------------

export interface PlaybackAuthInput {
  requester: { userId: string | null; isAdmin: boolean };
  asset: { ownerId: string | null; visibility: 'private' | 'authenticated' | 'public'; disposition: 'active' | 'quarantined' | 'revoked' | 'deleted' };
  /** State of the lesson/content the asset belongs to (null for orphan assets). */
  contentState: ContentState | null;
  rightsActive: boolean;
  /** Learner has an enrollment/collection access that includes this content (RLS-equivalent check done by the caller). */
  learnerHasAccess: boolean;
}

export type PlaybackAuthResult = { allowed: true; mode: 'public' | 'learner' | 'owner_staging' | 'admin_review' } | { allowed: false; code: 'unauthorized' | 'forbidden' | 'rights_blocked' | 'not_found' };

/**
 * Decide whether a playback URL may be issued (§7.6: learners only get published, rights-active
 * content; owners/admins may stage privately; revoked assets are never served).
 */
export function authorizePlayback(input: PlaybackAuthInput): PlaybackAuthResult {
  const { asset, requester } = input;
  if (asset.disposition === 'deleted') return { allowed: false, code: 'not_found' };
  if (asset.disposition === 'revoked' || asset.disposition === 'quarantined') return { allowed: false, code: 'rights_blocked' };
  if (asset.visibility === 'public' && input.contentState === 'published') return { allowed: true, mode: 'public' };
  if (!requester.userId) return { allowed: false, code: 'unauthorized' };
  if (requester.isAdmin) return { allowed: true, mode: 'admin_review' };
  if (asset.ownerId && asset.ownerId === requester.userId) return { allowed: true, mode: 'owner_staging' };
  if (input.contentState === 'published' && input.rightsActive && input.learnerHasAccess) return { allowed: true, mode: 'learner' };
  if (input.contentState === 'published' && !input.rightsActive) return { allowed: false, code: 'rights_blocked' };
  return { allowed: false, code: 'forbidden' };
}
