/**
 * Typed HTTP client for the LangQuest API (`/v1/*`, spec §6, CONVENTIONS §3).
 *
 * - Routes come from `@langquest/contracts` `ROUTES`; paths are built with `buildPath`.
 * - Learner/admin routes send `Authorization: Bearer <Supabase access token>`.
 * - Every response is parsed through the contract envelope (`{ok, data} | {ok:false, error}`)
 *   and the caller's Zod schema, so a malformed payload surfaces as a typed error.
 * - Transient failures (network, 408/429/5xx, timeouts) retry with bounded exponential backoff
 *   and jitter; non-idempotent calls are retried only when an `Idempotency-Key` is attached.
 * - Pure TS: no React Native imports, so it is unit-tested with a fake `fetch`.
 */
import {
  API_ERROR_HTTP_STATUS,
  ApiFailureSchema,
  IDEMPOTENCY_KEY_HEADER,
  ROUTES,
  buildPath,
  type ApiErrorCode,
  type RouteKey,
  type RouteParams,
} from '@langquest/contracts';
import type { z } from 'zod';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token (refreshing when needed) or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  fetch?: FetchLike;
  /** Default per-request timeout. */
  timeoutMs?: number;
  /** Maximum retry attempts for transient failures (default 3). */
  maxRetries?: number;
  /** Base backoff in ms (default 400); grows ×2 per attempt with jitter, capped at 8 s. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Called with (routeKey, code, status) on every API failure, for telemetry. */
  onError?: (info: { route: RouteKey; code: ApiErrorCode | 'network' | 'timeout' | 'invalid_response'; status: number | null; traceId: string | null }) => void;
  /** Called when a learner route gets 401 so the app can sign out / refresh. */
  onUnauthorized?: () => void;
}

export interface CallOptions<K extends RouteKey, T> {
  params?: RouteParams<K>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Zod schema for the `data` field of a successful envelope. */
  schema: z.ZodType<T>;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Override retry count for this call. */
  maxRetries?: number;
}

export type ApiFailureKind = ApiErrorCode | 'network' | 'timeout' | 'invalid_response' | 'not_configured';

/** Thrown by the client. `retryable` tells UI whether a retry button makes sense. */
export class ApiClientError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly traceId: string | null;
  readonly details: unknown;
  readonly route: RouteKey;
  /**
   * Server-suggested wait before retrying the SAME request (from the `Retry-After` header, or
   * `details.retryAfterSeconds` for `turn_in_progress`), in ms; null when the server gave none.
   */
  readonly retryAfterMs: number | null;
  constructor(route: RouteKey, kind: ApiFailureKind, message: string, status: number | null = null, traceId: string | null = null, details?: unknown, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.route = route;
    this.kind = kind;
    this.status = status;
    this.traceId = traceId;
    this.details = details;
    this.retryAfterMs = retryAfterMs ?? retryAfterFromDetails(details);
  }
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'provider_unavailable' || this.kind === 'rate_limited' || this.kind === 'internal';
  }
  /** True when the device is offline or the server is unreachable (not an application error). */
  get isConnectivity(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 8_000;
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ApiClient {
  call<K extends RouteKey, T>(route: K, options: CallOptions<K, T>): Promise<T>;
  readonly baseUrl: string;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutDefault = options.timeoutMs ?? 20_000;
  const maxRetriesDefault = options.maxRetries ?? 3;
  const backoffBase = options.backoffMs ?? 400;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  const backoffFor = (attempt: number): number => {
    const exp = Math.min(8_000, backoffBase * 2 ** attempt);
    return Math.round(exp * (0.5 + random() * 0.5));
  };

  async function call<K extends RouteKey, T>(route: K, opts: CallOptions<K, T>): Promise<T> {
    const def = ROUTES[route];
    const path = buildPath(route, opts.params as RouteParams<K>, opts.query);
    const url = `${baseUrl}${path}`;
    const idempotent = def.method === 'GET' || def.method === 'PUT' || def.method === 'DELETE' || Boolean(opts.idempotencyKey);
    const maxRetries = idempotent ? (opts.maxRetries ?? maxRetriesDefault) : 0;

    let attempt = 0;
    while (true) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (opts.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = opts.idempotencyKey;
      if (def.auth !== 'public') {
        const token = await options.getAccessToken();
        if (!token) {
          options.onUnauthorized?.();
          throw new ApiClientError(route, 'unauthorized', 'Not signed in', 401);
        }
        headers.Authorization = `Bearer ${token}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutDefault);
      const onOuterAbort = (): void => controller.abort();
      opts.signal?.addEventListener('abort', onOuterAbort);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: def.method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onOuterAbort);
        const aborted = opts.signal?.aborted ?? false;
        const kind: ApiFailureKind = aborted ? 'network' : controller.signal.aborted ? 'timeout' : 'network';
        if (!aborted && attempt < maxRetries) {
          await sleep(backoffFor(attempt));
          attempt += 1;
          continue;
        }
        options.onError?.({ route, code: kind, status: null, traceId: null });
        throw new ApiClientError(route, kind, error instanceof Error ? error.message : 'Network error');
      }
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);

      let json: unknown = null;
      const text = await response.text();
      if (text.length > 0) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }

      if (response.ok) {
        const envelope = json as { ok?: boolean; data?: unknown } | null;
        if (!envelope || envelope.ok !== true) {
          const failure = ApiFailureSchema.safeParse(json);
          if (failure.success) {
            options.onError?.({ route, code: failure.data.error.code, status: response.status, traceId: failure.data.error.traceId ?? null });
            throw new ApiClientError(route, failure.data.error.code, failure.data.error.message, response.status, failure.data.error.traceId ?? null, failure.data.error.details);
          }
          options.onError?.({ route, code: 'invalid_response', status: response.status, traceId: null });
          throw new ApiClientError(route, 'invalid_response', 'Unexpected response shape', response.status);
        }
        const parsed = opts.schema.safeParse(envelope.data);
        if (!parsed.success) {
          options.onError?.({ route, code: 'invalid_response', status: response.status, traceId: null });
          throw new ApiClientError(route, 'invalid_response', `Response failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`, response.status, null, parsed.error.issues);
        }
        return parsed.data;
      }

      const failure = ApiFailureSchema.safeParse(json);
      const code: ApiErrorCode = failure.success ? failure.data.error.code : statusToCode(response.status);
      const message = failure.success ? failure.data.error.message : `HTTP ${response.status}`;
      const traceId = failure.success ? (failure.data.error.traceId ?? null) : null;

      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        await sleep(retryAfterMs !== null && retryAfterMs > 0 ? Math.min(MAX_RETRY_AFTER_MS, retryAfterMs) : backoffFor(attempt));
        attempt += 1;
        continue;
      }
      if (response.status === 401) options.onUnauthorized?.();
      options.onError?.({ route, code, status: response.status, traceId });
      throw new ApiClientError(route, code, message, response.status, traceId, failure.success ? failure.data.error.details : undefined, retryAfterMs);
    }
  }

  return { call, baseUrl };
}

/** `Retry-After` as ms: delta-seconds or an HTTP date; null when absent or unparseable. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function retryAfterFromDetails(details: unknown): number | null {
  const seconds = (details as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function statusToCode(status: number): ApiErrorCode {
  for (const [code, s] of Object.entries(API_ERROR_HTTP_STATUS) as [ApiErrorCode, number][]) {
    if (s === status && code !== 'idempotent_replay') return code;
  }
  return status >= 500 ? 'internal' : 'validation_failed';
}

/** A client that fails fast with `not_configured` (no API base URL in the build). */
export function createUnconfiguredClient(): ApiClient {
  return {
    baseUrl: '',
    call: async (route) => {
      throw new ApiClientError(route, 'not_configured', 'API base URL is not configured (EXPO_PUBLIC_API_BASE_URL)');
    },
  };
}
