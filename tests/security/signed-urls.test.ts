/**
 * §4.4 / §11 / A22: the short-lived media URL model. Worker-proxied stream tokens are bound to (asset, learner,
 * expiry) and cannot be replayed for another asset or after expiry; the playback-URL route only answers for
 * assets a learner may play (published lesson, active rights) and never for drafts, revoked or quarantined
 * assets; TTLs stay within policy and the renewal decision keeps expiry invisible mid-playback.
 */
import { authorizePlayback, SIGNED_URL_POLICY, shouldRenew, ttlForAsset } from '@langquest/media/playback';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signStreamToken, streamSubject, verifyStreamToken } from '../../apps/api/src/lib/media-token';
import { call, createApiHarness, createTestUser, describeWithStack, enrol, Seeder, teardown, TEST_TICKET_SECRET, type ApiHarness, type TestUser } from '../src/harness';

describe('signed URL model (pure)', () => {
  const secret = 'stream-secret-for-tests-32-characters-long';
  const asset = crypto.randomUUID();
  const other = crypto.randomUUID();
  const user = crypto.randomUUID();

  it('a stream token is bound to asset, learner and expiry; tampering or replaying for another asset fails', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signStreamToken(secret, asset, user, now + 600);
    // The token carries a pseudonymous learner subject (never the raw user id: stream URLs end up in CDN/proxy logs).
    const subject = streamSubject(secret, user);
    expect(subject).toMatch(/^[0-9a-f]{16}$/);
    expect(token).not.toContain(user);
    expect(verifyStreamToken(secret, token, now)).toMatchObject({ assetId: asset, subject });
    expect(verifyStreamToken(secret, token.replace(asset, other), now)).toBeNull();
    expect(verifyStreamToken(secret, token.replace(subject, streamSubject(secret, crypto.randomUUID())), now)).toBeNull();
    expect(verifyStreamToken(secret, token, now + 601)).toBeNull();
    const [a, exp, u, sig] = token.split('.') as [string, string, string, string];
    expect(verifyStreamToken(secret, `${a}.${Number(exp) + 86_400}.${u}.${sig}`, now)).toBeNull();
    expect(verifyStreamToken('another-secret-that-is-also-32-chars-long', token, now)).toBeNull();
    expect(verifyStreamToken(secret, `${a}.${exp}.${u}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`, now)).toBeNull();
    expect(verifyStreamToken(secret, 'garbage', now)).toBeNull();
  });

  it('playback authorization never allows drafts, revoked/quarantined assets or rights-blocked content for learners', () => {
    const learner = { userId: user, isAdmin: false };
    const active = { ownerId: null, visibility: 'authenticated' as const, disposition: 'active' as const };
    expect(authorizePlayback({ requester: learner, asset: active, contentState: 'published', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: true, mode: 'learner' });
    expect(authorizePlayback({ requester: learner, asset: active, contentState: 'review_needed', rightsActive: true, learnerHasAccess: true }).allowed).toBe(false);
    expect(authorizePlayback({ requester: learner, asset: active, contentState: 'published', rightsActive: false, learnerHasAccess: true })).toEqual({ allowed: false, code: 'rights_blocked' });
    expect(authorizePlayback({ requester: learner, asset: { ...active, disposition: 'revoked' }, contentState: 'published', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: false, code: 'rights_blocked' });
    expect(authorizePlayback({ requester: learner, asset: { ...active, disposition: 'deleted' }, contentState: 'published', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: false, code: 'not_found' });
    expect(authorizePlayback({ requester: { userId: null, isAdmin: false }, asset: active, contentState: 'published', rightsActive: true, learnerHasAccess: true })).toEqual({ allowed: false, code: 'unauthorized' });
    expect(authorizePlayback({ requester: learner, asset: { ...active, visibility: 'private' }, contentState: 'published', rightsActive: true, learnerHasAccess: false })).toEqual({ allowed: false, code: 'forbidden' });
  });

  it('TTLs stay within policy and renewal happens before expiry, never after', () => {
    expect(ttlForAsset({ durationMs: 10 * 60 * 60 * 1000 })).toBe(SIGNED_URL_POLICY.maxTtlSeconds);
    expect(ttlForAsset({ durationMs: 1000 })).toBeGreaterThanOrEqual(SIGNED_URL_POLICY.minTtlSeconds);
    expect(ttlForAsset({ durationMs: null })).toBe(SIGNED_URL_POLICY.defaultTtlSeconds);
    expect(ttlForAsset({ durationMs: 60_000, purpose: 'download' })).toBe(SIGNED_URL_POLICY.downloadTtlSeconds);
    const now = new Date();
    const soon = new Date(now.getTime() + (SIGNED_URL_POLICY.renewBeforeExpirySeconds + SIGNED_URL_POLICY.clockSkewSeconds) * 1000 - 500).toISOString();
    expect(shouldRenew({ expiresAt: soon, now }).renew).toBe(true);
    const later = new Date(now.getTime() + SIGNED_URL_POLICY.maxTtlSeconds * 1000).toISOString();
    expect(shouldRenew({ expiresAt: later, now }).renew).toBe(false);
    expect(shouldRenew({ expiresAt: later, now, remainingPlaybackMs: 2 * SIGNED_URL_POLICY.maxTtlSeconds * 1000 }).reason).toBe('playback_outlives_url');
    expect(shouldRenew({ expiresAt: new Date(now.getTime() - 1000).toISOString(), now })).toMatchObject({ renew: true, reason: 'expired' });
  });
});

const describeStack = describeWithStack('security.signed-urls');

describeStack('playback-url and media proxy misuse (API)', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let publishedAssetId: string;
  let draftAssetId: string;
  let revokedAssetId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    learner = await createTestUser(h, 'media');
    await enrol(h, learner, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en' });
    const rights = await seeder.rights({ verified: true, commercialRedistribution: true });
    const collection = await seeder.audioCollection({ trackId: 'arabic-moroccan', varietyId: 'ary', rightsId: rights.id });
    const chapter = await seeder.audioChapter(collection.id);
    const lesson = await seeder.audioLesson({ chapterId: chapter.id, rightsId: rights.id });
    publishedAssetId = (await seeder.mediaAsset({ rightsId: rights.id })).id;
    await seeder.linkLessonAsset(lesson.id, publishedAssetId);
    revokedAssetId = (await seeder.mediaAsset({ rightsId: rights.id, disposition: 'revoked' })).id;
    await seeder.linkLessonAsset(lesson.id, revokedAssetId, 'slow');
    const draftLesson = await seeder.audioLesson({ chapterId: chapter.id, state: 'review_needed', rightsId: rights.id });
    draftAssetId = (await seeder.mediaAsset({ rightsId: rights.id, state: 'review_needed' })).id;
    await seeder.linkLessonAsset(draftLesson.id, draftAssetId);
  });

  // Users first (their owned rows and ledgers go with them), then the seeded content rows in reverse insertion order.
  afterAll(() => teardown(h, seeder));

  it('playback URLs are never minted for drafts, revoked assets, strangers or unauthenticated callers', async () => {
    expect((await call(h, `/v1/audio/assets/${publishedAssetId}/playback-url`, { body: {} })).status).toBe(401);
    const draft = await call(h, `/v1/audio/assets/${draftAssetId}/playback-url`, { token: learner.token, body: {} });
    expect([403, 404]).toContain(draft.status);
    const revoked = await call(h, `/v1/audio/assets/${revokedAssetId}/playback-url`, { token: learner.token, body: {} });
    expect([403, 404, 451]).toContain(revoked.status); // 451: rights_blocked
    expect(revoked.json.ok).toBe(false);
    const unknown = await call(h, `/v1/audio/assets/${crypto.randomUUID()}/playback-url`, { token: learner.token, body: {} });
    expect(unknown.status).toBe(404);
    // Authorized asset: without object storage the answer is an honest 501, never a fabricated URL.
    const ok = await call(h, `/v1/audio/assets/${publishedAssetId}/playback-url`, { token: learner.token, body: {} });
    expect([200, 501]).toContain(ok.status);
    if (ok.status === 200) {
      expect(ok.headers.get('cache-control')).toContain('no-store');
      expect(Date.parse(ok.json.data.expiresAt) - Date.now()).toBeLessThanOrEqual(SIGNED_URL_POLICY.maxTtlSeconds * 1000 + 5000);
    } else {
      expect(ok.json.error.code).toBe('capability_unsupported');
    }
  });

  it('the worker media proxy rejects missing, forged, expired and cross-asset tokens before touching storage', async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = signStreamToken(TEST_TICKET_SECRET, publishedAssetId, learner.id, now + 300);
    const expired = signStreamToken(TEST_TICKET_SECRET, publishedAssetId, learner.id, now - 1);
    const forged = signStreamToken('wrong-secret-that-is-at-least-32-characters', publishedAssetId, learner.id, now + 300);
    const crossAsset = signStreamToken(TEST_TICKET_SECRET, draftAssetId, learner.id, now + 300);
    expect((await call(h, `/v1/media/stream/${publishedAssetId}`)).status).toBe(401);
    expect((await call(h, `/v1/media/stream/${publishedAssetId}?t=${encodeURIComponent(expired)}`)).status).toBe(401);
    expect((await call(h, `/v1/media/stream/${publishedAssetId}?t=${encodeURIComponent(forged)}`)).status).toBe(401);
    expect((await call(h, `/v1/media/stream/${publishedAssetId}?t=${encodeURIComponent(crossAsset)}`)).status).toBe(401);
    const valid = await call(h, `/v1/media/stream/${publishedAssetId}?t=${encodeURIComponent(good)}`, { headers: { range: 'bytes=0-1023' } });
    // Storage is not configured in this harness: a valid token yields an honest 501, never bytes from elsewhere.
    expect([501, 206, 200]).toContain(valid.status);
    if (valid.status === 501) expect(valid.json.error.code).toBe('capability_unsupported');
  });
});
