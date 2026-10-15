import type { PlaybackUrlResponse } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackLeaseCache, URL_RENEWAL_POLICY, isLeaseExpired, renewalDecision } from './url-renewal';

const T0 = Date.parse('2026-10-14T12:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();

describe('renewalDecision', () => {
  it('is fresh well before expiry and schedules the next check at the window edge', () => {
    const d = renewalDecision({ lease: { expiresAt: iso(T0 + 15 * 60_000) }, now: T0, remainingPlaybackMs: 60_000, rate: 1, playing: true });
    expect(d.renew).toBe(false);
    expect(d.reason).toBe('fresh');
    expect(d.checkAgainInMs).toBe(15 * 60_000 - URL_RENEWAL_POLICY.clockSkewMs - URL_RENEWAL_POLICY.renewBeforeExpiryMs);
  });

  it('renews immediately when expired (including clock skew)', () => {
    const d = renewalDecision({ lease: { expiresAt: iso(T0 + 20_000) }, now: T0, remainingPlaybackMs: 60_000, rate: 1, playing: true });
    expect(d).toMatchObject({ renew: true, reason: 'expired' });
    expect(isLeaseExpired({ expiresAt: iso(T0 + 20_000) }, T0)).toBe(true);
  });

  it('inside the window: swaps only when playback outlives the URL, or when paused (free swap)', () => {
    const lease = { expiresAt: iso(T0 + 90_000) };
    expect(renewalDecision({ lease, now: T0, remainingPlaybackMs: 20_000, rate: 1, playing: true }).renew).toBe(false);
    expect(renewalDecision({ lease, now: T0, remainingPlaybackMs: 30 * 60_000, rate: 1, playing: true })).toMatchObject({ renew: true, reason: 'expiring_soon' });
    expect(renewalDecision({ lease, now: T0, remainingPlaybackMs: 20_000, rate: 1, playing: false }).renew).toBe(true);
    // At 2× rate the same 100 s of audio finishes before expiry.
    expect(renewalDecision({ lease, now: T0, remainingPlaybackMs: 100_000, rate: 2, playing: true }).renew).toBe(false);
  });

  it('flags playback that outlives the URL ahead of time without swapping yet', () => {
    const d = renewalDecision({ lease: { expiresAt: iso(T0 + 10 * 60_000) }, now: T0, remainingPlaybackMs: 50 * 60_000, rate: 1, playing: true });
    expect(d).toMatchObject({ renew: false, reason: 'playback_outlives_url' });
  });
});

describe('PlaybackLeaseCache', () => {
  const response = (n: number, now: number): PlaybackUrlResponse => ({ assetId: 'a', url: `https://m/a?v=${n}`, expiresAt: iso(now + 15 * 60_000), method: 'signed_get', contentType: 'audio/mpeg', byteLength: 10, etag: null, supportsRange: true, contentHash: 'c'.repeat(64) });

  it('caches a fresh lease, dedupes concurrent fetches and refetches once stale', async () => {
    let now = T0;
    let n = 0;
    const fetchUrl = vi.fn(async () => response(++n, now));
    const cache = new PlaybackLeaseCache(fetchUrl, () => now);
    const [a, b] = await Promise.all([cache.acquire('a'), cache.acquire('a')]);
    expect(a.url).toBe(b.url);
    expect(fetchUrl).toHaveBeenCalledTimes(1);
    expect(fetchUrl).toHaveBeenLastCalledWith('a', { renewal: false });
    now += 14 * 60_000; // inside the renewal window
    const c = await cache.acquire('a');
    expect(c.url).toBe('https://m/a?v=2');
    expect(fetchUrl).toHaveBeenLastCalledWith('a', { renewal: true });
  });

  it('caps reactive renewals so a broken URL cannot loop forever', async () => {
    const now = T0;
    let n = 0;
    const cache = new PlaybackLeaseCache(async () => response(++n, now), () => now);
    for (let i = 0; i < URL_RENEWAL_POLICY.maxReactiveRenewals; i += 1) expect(await cache.renewAfterFailure('a')).not.toBeNull();
    expect(await cache.renewAfterFailure('a')).toBeNull();
  });
});
