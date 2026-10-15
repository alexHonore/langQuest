/**
 * Idempotency for mutating requests (CONVENTIONS §3): a client may resend a request with the same
 * `Idempotency-Key`; the first response is stored (KV when bound, else in-memory) and replayed with
 * `X-Idempotent-Replay: true`. A reused key with a different body is a `conflict`.
 *
 * This is a transport-level safety net. Domain idempotency (sync event UUIDs, `client_turn_id`,
 * `client_attempt_id`, `award_xp` keys) is enforced in the database regardless of this header.
 */
import { IDEMPOTENCY_KEY_HEADER } from '@langquest/contracts';
import { sha256Hex } from '@langquest/telemetry/privacy';
import type { MiddlewareHandler } from 'hono';
import type { KVNamespaceLike } from '../env';
import { respondErr } from '../http/envelope';
import type { AppEnv } from '../types';

export interface StoredResponse {
  status: number;
  body: string;
  contentType: string;
  fingerprint: string;
  storedAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<StoredResponse | null>;
  put(key: string, value: StoredResponse, ttlSeconds: number): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, StoredResponse & { expiresAt: number }>();
  async get(key: string): Promise<StoredResponse | null> {
    const v = this.map.get(key);
    if (!v) return null;
    if (v.expiresAt < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return v;
  }
  async put(key: string, value: StoredResponse, ttlSeconds: number): Promise<void> {
    if (this.map.size > 10_000) this.map.clear();
    this.map.set(key, { ...value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

export class KvIdempotencyStore implements IdempotencyStore {
  constructor(private readonly kv: KVNamespaceLike) {}
  async get(key: string): Promise<StoredResponse | null> {
    const raw = await this.kv.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredResponse;
    } catch {
      return null;
    }
  }
  async put(key: string, value: StoredResponse, ttlSeconds: number): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  }
}

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function idempotency(store: IdempotencyStore): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
    const header = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (!header) return next();
    if (!KEY_PATTERN.test(header)) return respondErr(c, 'validation_failed', `${IDEMPOTENCY_KEY_HEADER} must be 8–128 characters of [A-Za-z0-9._:-]`);
    c.set('idempotencyKey', header);
    const principal = c.get('principal');
    const subject = principal?.userId ?? c.get('clientKey');
    const bodyText = await c.req.raw.clone().text();
    const fingerprint = sha256Hex(`${c.req.method}\n${c.req.path}\n${bodyText}`);
    const storeKey = `idem:${subject}:${header}`;
    const existing = await store.get(storeKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return respondErr(c, 'conflict', 'Idempotency-Key was already used with a different request body');
      return new Response(existing.body, { status: existing.status, headers: { 'content-type': existing.contentType, 'X-Idempotent-Replay': 'true' } });
    }
    await next();
    const res = c.res;
    if (res && res.status < 500) {
      const body = await res.clone().text();
      await store.put(storeKey, { status: res.status, body, contentType: res.headers.get('content-type') ?? 'application/json', fingerprint, storedAt: Date.now() }, IDEMPOTENCY_TTL_SECONDS);
    }
  };
}
