/**
 * Operator-side abuse control (§11 "Rate limits protect authentication and DDoS … *not* subscription
 * quotas"). Token buckets per principal (user id) or per client key (hashed IP) with class-specific
 * budgets. Limits are generous for human use and exist only to stop scripted abuse, credential stuffing
 * and runaway clients; they are never surfaced as a learner allowance, meter or "remaining credits".
 *
 * Storage: `RATE_LIMIT` KV binding when present (shared across isolates, eventually consistent), else an
 * in-memory map (per isolate — still effective against single-source floods, documented in the README).
 */
import type { MiddlewareHandler } from 'hono';
import type { KVNamespaceLike } from '../env';
import { respondErr } from '../http/envelope';
import type { AppEnv } from '../types';

export interface BucketPolicy {
  /** Sustained requests per minute. */
  perMinute: number;
  /** Burst capacity (bucket size). */
  burst: number;
}

/** Abuse-control classes. Tune via code review, never per learner. */
export const RATE_POLICIES = {
  /** Unauthenticated/public catalog traffic per client key. */
  public: { perMinute: 240, burst: 120 } satisfies BucketPolicy,
  /** Authenticated learner traffic per user (progress sync, catalog, audio). */
  learner: { perMinute: 600, burst: 200 } satisfies BucketPolicy,
  /** Auth-sensitive endpoints (session refresh, failed-token probes) per client key. */
  auth: { perMinute: 30, burst: 15 } satisfies BucketPolicy,
  /** AI/speech endpoints per user: a human cannot exceed this; scripts can. */
  ai: { perMinute: 90, burst: 30 } satisfies BucketPolicy,
  /** Admin mutations per user. */
  admin: { perMinute: 300, burst: 100 } satisfies BucketPolicy,
  /**
   * Pre-authentication ceiling per client key, taken BEFORE any JWT verification or role lookup so floods of
   * missing/garbage/expired tokens are throttled without a network call to Supabase Auth or a `user_roles` query.
   * Deliberately above every per-principal class (a shared NAT serves many honest learners).
   */
  ingress: { perMinute: 1200, burst: 400 } satisfies BucketPolicy,
} as const;
export type RateClass = keyof typeof RATE_POLICIES;

interface BucketState {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitStore {
  get(key: string): Promise<BucketState | null>;
  put(key: string, state: BucketState, ttlSeconds: number): Promise<void>;
}

/** In-memory store (per isolate). */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly map = new Map<string, BucketState & { expiresAt: number }>();
  async get(key: string): Promise<BucketState | null> {
    const v = this.map.get(key);
    if (!v) return null;
    if (v.expiresAt < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return { tokens: v.tokens, updatedAt: v.updatedAt };
  }
  async put(key: string, state: BucketState, ttlSeconds: number): Promise<void> {
    if (this.map.size > 50_000) this.map.clear();
    this.map.set(key, { ...state, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/** KV-backed store. */
export class KvRateLimitStore implements RateLimitStore {
  constructor(private readonly kv: KVNamespaceLike) {}
  async get(key: string): Promise<BucketState | null> {
    const raw = await this.kv.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as BucketState;
    } catch {
      return null;
    }
  }
  async put(key: string, state: BucketState, ttlSeconds: number): Promise<void> {
    await this.kv.put(key, JSON.stringify(state), { expirationTtl: Math.max(60, ttlSeconds) });
  }
}

export interface TakeResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Current token count without consuming (refill applied); used to short-circuit auth probes before verifying. */
export async function peekTokens(store: RateLimitStore, key: string, policy: BucketPolicy, now = Date.now()): Promise<number> {
  const refillPerMs = policy.perMinute / 60_000;
  const prev = (await store.get(key)) ?? { tokens: policy.burst, updatedAt: now };
  const elapsed = Math.max(0, now - prev.updatedAt);
  return Math.min(policy.burst, prev.tokens + elapsed * refillPerMs);
}

/** Token-bucket take: refill by elapsed time, then consume one token when available. */
export async function takeToken(store: RateLimitStore, key: string, policy: BucketPolicy, now = Date.now()): Promise<TakeResult> {
  const refillPerMs = policy.perMinute / 60_000;
  const prev = (await store.get(key)) ?? { tokens: policy.burst, updatedAt: now };
  const elapsed = Math.max(0, now - prev.updatedAt);
  const tokens = Math.min(policy.burst, prev.tokens + elapsed * refillPerMs);
  if (tokens >= 1) {
    await store.put(key, { tokens: tokens - 1, updatedAt: now }, 120);
    return { allowed: true, remaining: Math.floor(tokens - 1), retryAfterSeconds: 0 };
  }
  await store.put(key, { tokens, updatedAt: now }, 120);
  return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)) };
}

export interface RateLimitOptions {
  store: RateLimitStore;
  /** Which class applies; may depend on whether a principal is present. */
  classify: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => RateClass;
  /**
   * `principal` (default): key by user id when authenticated, else by client key. `client`: always key by the
   * hashed client IP — used before authentication and for credential endpoints where the caller's identity is
   * exactly what is being probed (§11 "protect authentication").
   */
  keyBy?: 'principal' | 'client';
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const klass = options.classify(c);
    const policy = RATE_POLICIES[klass];
    const principal = options.keyBy === 'client' ? undefined : c.get('principal');
    const subject = principal ? `u:${principal.userId}` : `k:${c.get('clientKey')}`;
    const key = `rl:${klass}:${subject}`;
    const result = await takeToken(options.store, key, policy);
    c.header('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      c.get('log').warn('rate_limit.blocked', { klass, subject: principal ? 'user' : 'client' });
      const res = respondErr(c, 'rate_limited', 'Too many requests in a short time. This is an abuse guard, not a usage limit — please retry in a moment.');
      res.headers.set('Retry-After', String(result.retryAfterSeconds));
      return res;
    }
    return next();
  };
}
