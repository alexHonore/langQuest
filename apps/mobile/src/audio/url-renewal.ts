/**
 * Signed playback URL leases (§4.4, §14.1 A22). Mirrors the server policy in
 * `@langquest/media/playback` (`SIGNED_URL_POLICY`): renew inside the window
 * before expiry, treat a 403 / playback error on a remote URL as "expired",
 * never renew in a hot loop. Pure and unit-tested; the network call is injected.
 */
import type { PlaybackUrlResponse } from '@langquest/contracts';

export const URL_RENEWAL_POLICY = {
  /** Renew when less than this remains (matches `SIGNED_URL_POLICY.renewBeforeExpirySeconds`). */
  renewBeforeExpiryMs: 2 * 60_000,
  /** Allowed clock skew between device and server. */
  clockSkewMs: 30_000,
  /** Reactive renewals (after a mid-stream failure) allowed inside `renewalWindowMs`. */
  maxReactiveRenewals: 3,
  renewalWindowMs: 60_000,
  /** Minimum delay between proactive checks. */
  minCheckMs: 1_000,
} as const;

export interface PlaybackLease {
  assetId: string;
  url: string;
  expiresAt: string;
  contentHash: string;
  method: PlaybackUrlResponse['method'];
  obtainedAt: number;
}

export type RenewalReason = 'expired' | 'expiring_soon' | 'playback_outlives_url' | 'fresh';

export interface RenewalDecision {
  renew: boolean;
  reason: RenewalReason;
  /** When to evaluate again (ms). 0 means "now". */
  checkAgainInMs: number;
  msRemaining: number;
}

export function isLeaseExpired(lease: Pick<PlaybackLease, 'expiresAt'>, now: number): boolean {
  return now + URL_RENEWAL_POLICY.clockSkewMs >= Date.parse(lease.expiresAt);
}

/**
 * Decide whether the player should swap to a renewed URL. The swap costs a
 * brief rebuffer, so it only happens when the current URL will not outlive
 * the remaining playback (or is already inside the expiry window).
 */
export function renewalDecision(input: { lease: Pick<PlaybackLease, 'expiresAt'>; now: number; remainingPlaybackMs: number | null; rate: number; playing: boolean }): RenewalDecision {
  const msLeft = Date.parse(input.lease.expiresAt) - input.now - URL_RENEWAL_POLICY.clockSkewMs;
  const msRemaining = Math.max(0, msLeft);
  if (msLeft <= 0) return { renew: true, reason: 'expired', checkAgainInMs: 0, msRemaining: 0 };
  const windowMs = URL_RENEWAL_POLICY.renewBeforeExpiryMs;
  const rate = input.rate > 0 ? input.rate : 1;
  const remaining = input.remainingPlaybackMs;
  const outlives = remaining !== null && remaining / rate > msLeft;
  if (msLeft <= windowMs) {
    // Inside the window: swap only when playback actually needs the URL past its expiry
    // (or when paused, where a swap is free of any audible gap).
    if (!input.playing || outlives || remaining === null) return { renew: true, reason: 'expiring_soon', checkAgainInMs: 0, msRemaining };
    return { renew: false, reason: 'fresh', checkAgainInMs: Math.max(URL_RENEWAL_POLICY.minCheckMs, msLeft), msRemaining };
  }
  return { renew: false, reason: outlives ? 'playback_outlives_url' : 'fresh', checkAgainInMs: Math.max(URL_RENEWAL_POLICY.minCheckMs, msLeft - windowMs), msRemaining };
}

export interface PlaybackUrlFetcher {
  (assetId: string, options: { renewal: boolean }): Promise<PlaybackUrlResponse>;
}

/**
 * Caches one lease per asset, dedupes concurrent fetches and guards reactive
 * renewals so a broken URL cannot trigger an endless refetch loop.
 */
export class PlaybackLeaseCache {
  private readonly leases = new Map<string, PlaybackLease>();
  private readonly inflight = new Map<string, Promise<PlaybackLease>>();
  private readonly reactive = new Map<string, number[]>();

  constructor(
    private readonly fetchUrl: PlaybackUrlFetcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  peek(assetId: string): PlaybackLease | null {
    return this.leases.get(assetId) ?? null;
  }

  /** A usable lease: cached when still fresh, otherwise fetched (deduplicated). */
  async acquire(assetId: string): Promise<PlaybackLease> {
    const cached = this.leases.get(assetId);
    if (cached && !isLeaseExpired(cached, this.now()) && Date.parse(cached.expiresAt) - this.now() > URL_RENEWAL_POLICY.renewBeforeExpiryMs) return cached;
    return this.fetch(assetId, cached !== undefined);
  }

  /** Proactive renewal regardless of the cache (deduplicated). */
  renew(assetId: string): Promise<PlaybackLease> {
    return this.fetch(assetId, true);
  }

  /**
   * Reactive renewal after a 403 / playback error. Returns null when the
   * renewal budget for this asset is exhausted (caller surfaces an error).
   */
  async renewAfterFailure(assetId: string): Promise<PlaybackLease | null> {
    const now = this.now();
    const recent = (this.reactive.get(assetId) ?? []).filter((t) => now - t < URL_RENEWAL_POLICY.renewalWindowMs);
    if (recent.length >= URL_RENEWAL_POLICY.maxReactiveRenewals) return null;
    recent.push(now);
    this.reactive.set(assetId, recent);
    return this.fetch(assetId, true);
  }

  invalidate(assetId: string): void {
    this.leases.delete(assetId);
  }

  clear(): void {
    this.leases.clear();
    this.reactive.clear();
  }

  private fetch(assetId: string, renewal: boolean): Promise<PlaybackLease> {
    const pending = this.inflight.get(assetId);
    if (pending) return pending;
    const p = this.fetchUrl(assetId, { renewal })
      .then((res) => {
        const lease: PlaybackLease = { assetId: res.assetId, url: res.url, expiresAt: res.expiresAt, contentHash: res.contentHash, method: res.method, obtainedAt: this.now() };
        this.leases.set(assetId, lease);
        return lease;
      })
      .finally(() => this.inflight.delete(assetId));
    this.inflight.set(assetId, p);
    return p;
  }
}
