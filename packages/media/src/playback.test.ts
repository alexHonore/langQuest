import { describe, expect, it } from 'vitest';
import { authorizePlayback, buildMediaResponseHeaders, computeExpiry, etagMatches, isUrlExpired, parseRangeHeader, shouldRenew, SIGNED_URL_POLICY, ttlForAsset } from './playback';

const NOW = new Date('2026-10-14T12:00:00Z');

describe('ttl and expiry', () => {
  it('sizes TTLs to the remaining playback with bounds', () => {
    expect(ttlForAsset({ durationMs: 60_000 })).toBe(SIGNED_URL_POLICY.defaultTtlSeconds);
    expect(ttlForAsset({ durationMs: 45 * 60_000 })).toBe(45 * 60 + SIGNED_URL_POLICY.playbackMarginSeconds);
    expect(ttlForAsset({ durationMs: 3 * 3600_000 })).toBe(SIGNED_URL_POLICY.maxTtlSeconds);
    expect(ttlForAsset({ durationMs: 45 * 60_000, positionMs: 40 * 60_000 })).toBe(SIGNED_URL_POLICY.defaultTtlSeconds);
    expect(ttlForAsset({ durationMs: null, purpose: 'download' })).toBe(SIGNED_URL_POLICY.downloadTtlSeconds);
    expect(computeExpiry(NOW, 60)).toBe('2026-10-14T12:01:00.000Z');
    expect(() => computeExpiry(NOW, 0)).toThrow();
    expect(isUrlExpired('2026-10-14T12:00:10Z', NOW)).toBe(true);
    expect(isUrlExpired('2026-10-14T12:05:00Z', NOW)).toBe(false);
  });

  it('decides renewal mid-playback (A22)', () => {
    expect(shouldRenew({ expiresAt: '2026-10-14T11:59:00Z', now: NOW })).toMatchObject({ renew: true, reason: 'expired', checkAgainInMs: 0 });
    expect(shouldRenew({ expiresAt: '2026-10-14T12:02:00Z', now: NOW })).toMatchObject({ renew: true, reason: 'expiring_soon' });
    const fresh = shouldRenew({ expiresAt: '2026-10-14T12:15:00Z', now: NOW, remainingPlaybackMs: 60_000 });
    expect(fresh.renew).toBe(false);
    expect(fresh.reason).toBe('fresh');
    expect(fresh.checkAgainInMs).toBe((15 * 60 - 30 - 120) * 1000);
    const outlives = shouldRenew({ expiresAt: '2026-10-14T12:15:00Z', now: NOW, remainingPlaybackMs: 40 * 60_000 });
    expect(outlives).toMatchObject({ renew: false, reason: 'playback_outlives_url' });
    expect(shouldRenew({ expiresAt: '2026-10-14T12:15:00Z', now: NOW, remainingPlaybackMs: 20 * 60_000, playbackRate: 2 }).reason).toBe('fresh');
  });
});

describe('byte ranges and headers', () => {
  it('parses Range headers', () => {
    expect(parseRangeHeader(undefined, 1000)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ kind: 'partial', start: 0, end: 499, length: 500 });
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ kind: 'partial', start: 500, end: 999, length: 500 });
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ kind: 'partial', start: 800, end: 999, length: 200 });
    expect(parseRangeHeader('bytes=0-5000', 1000)).toEqual({ kind: 'partial', start: 0, end: 999, length: 1000 });
    expect(parseRangeHeader('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=0-100,200-300', 1000)).toEqual({ kind: 'invalid' });
    expect(parseRangeHeader('bytes=-', 1000)).toEqual({ kind: 'invalid' });
    expect(parseRangeHeader('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });
  it('builds 200/206/416 responses with ETag, ranges and bounded caching', () => {
    const common = { contentType: 'audio/mp4', totalLength: 1000, etag: 'abc', contentHash: 'f'.repeat(64), visibility: 'private' as const, ttlSeconds: 900 };
    const full = buildMediaResponseHeaders({ ...common, range: { kind: 'full' } });
    expect(full.status).toBe(200);
    expect(full.headers).toMatchObject({ 'Accept-Ranges': 'bytes', 'Content-Length': '1000', ETag: '"abc"', 'Cache-Control': 'private, max-age=900, no-transform', 'X-Content-Hash': `sha256:${'f'.repeat(64)}` });
    const partial = buildMediaResponseHeaders({ ...common, range: parseRangeHeader('bytes=100-199', 1000) });
    expect(partial.status).toBe(206);
    expect(partial.headers['Content-Range']).toBe('bytes 100-199/1000');
    expect(partial.headers['Content-Length']).toBe('100');
    const bad = buildMediaResponseHeaders({ ...common, range: { kind: 'unsatisfiable' } });
    expect(bad.status).toBe(416);
    expect(bad.headers['Content-Range']).toBe('bytes */1000');
    const pub = buildMediaResponseHeaders({ ...common, visibility: 'public', ttlSeconds: 999_999, range: { kind: 'full' }, downloadFilename: 'leçon 3.m4a' });
    expect(pub.headers['Cache-Control']).toBe('public, max-age=86400, immutable');
    expect(pub.headers['Content-Disposition']).toBe("attachment; filename*=UTF-8''le%C3%A7on%203.m4a");
    expect(etagMatches('"abc", W/"def"', 'def')).toBe(true);
    expect(etagMatches('*', 'x')).toBe(true);
    expect(etagMatches('"abc"', 'zzz')).toBe(false);
    expect(etagMatches(null, 'abc')).toBe(false);
  });
});

describe('authorizePlayback', () => {
  const asset = { ownerId: 'owner', visibility: 'private' as const, disposition: 'active' as const };
  it('serves published rights-active content to learners with access, and only that', () => {
    const learner = { userId: 'u1', isAdmin: false };
    expect(authorizePlayback({ requester: learner, asset, contentState: 'published', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: true, mode: 'learner' });
    expect(authorizePlayback({ requester: learner, asset, contentState: 'published', rightsActive: true, learnerHasAccess: false })).toEqual({ allowed: false, code: 'forbidden' });
    expect(authorizePlayback({ requester: learner, asset, contentState: 'published', rightsActive: false, learnerHasAccess: true })).toEqual({ allowed: false, code: 'rights_blocked' });
    expect(authorizePlayback({ requester: learner, asset, contentState: 'approved', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: false, code: 'forbidden' });
    expect(authorizePlayback({ requester: { userId: null, isAdmin: false }, asset, contentState: 'published', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: false, code: 'unauthorized' });
  });
  it('lets owners stage privately and admins review; never serves revoked assets', () => {
    expect(authorizePlayback({ requester: { userId: 'owner', isAdmin: false }, asset, contentState: 'imported_draft', rightsActive: false, learnerHasAccess: false })).toEqual({ allowed: true, mode: 'owner_staging' });
    expect(authorizePlayback({ requester: { userId: 'admin', isAdmin: true }, asset, contentState: 'rights_unverified', rightsActive: false, learnerHasAccess: false })).toEqual({ allowed: true, mode: 'admin_review' });
    expect(authorizePlayback({ requester: { userId: 'admin', isAdmin: true }, asset: { ...asset, disposition: 'revoked' }, contentState: 'published', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: false, code: 'rights_blocked' });
    expect(authorizePlayback({ requester: { userId: 'admin', isAdmin: true }, asset: { ...asset, disposition: 'deleted' }, contentState: null, rightsActive: false, learnerHasAccess: false })).toEqual({ allowed: false, code: 'not_found' });
    expect(authorizePlayback({ requester: { userId: null, isAdmin: false }, asset: { ...asset, visibility: 'public' }, contentState: 'published', rightsActive: true, learnerHasAccess: false })).toEqual({ allowed: true, mode: 'public' });
  });
});
