/**
 * CORS allowlist, security headers, body-size limits and per-request timeouts (§11).
 *
 * - CORS: only origins listed in `CORS_ALLOWED_ORIGINS` are reflected; mobile apps (no Origin) are
 *   unaffected. `*` is never used because requests carry Authorization headers. The localhost shortcut exists
 *   only for `API_ENV=development` AND a request served from a local dev host (never a deployed hostname).
 * - Security headers: no sniffing, no framing, strict referrer, a restrictive CSP (this API serves JSON
 *   and media redirects only) and HSTS in production.
 * - Body limit: default 1 MiB; speech routes allow larger inline clips (declared per route group).
 * - Timeout: the handler is raced against a timer AND the request-scoped `abortSignal` is aborted, so provider
 *   calls started by the handler (OpenRouter, STT/TTS) stop spending once the client has received the error.
 */
import type { MiddlewareHandler } from 'hono';
import { RequestTimeoutError, respondErr } from '../http/envelope';
import type { AppEnv } from '../types';

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Authorization,Content-Type,Idempotency-Key,X-Request-Id,X-Client-Platform,X-Client-Version,Range';
/** `X-LangQuest-Analytics-Truncated`: the analytics panels name the reads cut at their page bound (`routes/admin/analytics.ts`), so the Studio in the browser can read it. */
const EXPOSED_HEADERS = 'X-Request-Id,ETag,Content-Range,Accept-Ranges,Retry-After,X-RateLimit-Remaining,X-Idempotent-Replay,X-LangQuest-Analytics-Truncated';

export function corsAllowlist(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header('origin');
    const config = c.get('config');
    const allowed = origin !== undefined && isOriginAllowed(origin, config.corsOrigins, config.env.API_ENV, requestHost(c.req.header('host'), c.req.url));
    if (c.req.method === 'OPTIONS') {
      const headers = new Headers({ 'Access-Control-Max-Age': '600', Vary: 'Origin' });
      if (allowed && origin) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Credentials', 'true');
        headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
        headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      }
      return new Response(null, { status: 204, headers });
    }
    await next();
    c.res.headers.append('Vary', 'Origin');
    if (allowed && origin) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Allow-Credentials', 'true');
      c.res.headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    }
  };
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Host the request was served on: the `Host` header (always present on a Worker), else the URL's host. */
export function requestHost(hostHeader: string | undefined, url: string): string | undefined {
  if (hostHeader) return hostHeader;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** True for hosts a developer machine serves (`localhost`, loopback, `*.localhost`), never for a deployed name. */
export function isLocalDevHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Exact-match allowlist. In development, a localhost origin is additionally accepted — but only when the request
 * itself reached a local dev host, so a Worker accidentally deployed with `API_ENV=development` still never
 * reflects developer-machine origins with credentials.
 */
export function isOriginAllowed(origin: string, allowlist: readonly string[], apiEnv: string, requestHost?: string): boolean {
  if (allowlist.includes(origin)) return true;
  if (apiEnv === 'development' && isLocalDevHost(requestHost)) {
    try {
      return isLocalDevHost(new URL(origin).host);
    } catch {
      return false;
    }
  }
  return false;
}

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    h.set('Cross-Origin-Resource-Policy', 'same-site');
    h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    if (c.get('config').env.API_ENV === 'production') h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  };
}

export const DEFAULT_BODY_LIMIT_BYTES = 1 * 1024 * 1024;
/** Inline base64 audio clips (≤ 8 MB base64 per contracts) plus JSON overhead. */
export const SPEECH_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

/**
 * Reject oversized bodies using Content-Length when present, and by counting bytes while reading
 * otherwise. Only JSON (and form-free) bodies are accepted on this API.
 */
export function bodyLimit(maxBytes: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
    const declared = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) return respondErr(c, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
    const type = c.req.header('content-type') ?? '';
    if (declared > 0 && !/^application\/json\b/i.test(type)) return respondErr(c, 'unsupported_media_type', 'Only application/json bodies are accepted');
    if (!c.req.header('content-length') && c.req.raw.body) {
      // Chunked bodies: read up to the limit, then re-create the request with the buffered body.
      const reader = c.req.raw.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return respondErr(c, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
      const buffered = new Uint8Array(total);
      let offset = 0;
      for (const ch of chunks) {
        buffered.set(ch, offset);
        offset += ch.byteLength;
      }
      c.req.raw = new Request(c.req.raw, { body: buffered });
    }
    return next();
  };
}

/** Combine several optional AbortSignals into one (first abort wins); `undefined` when none is given. */
export function combineAbortSignals(...signals: (AbortSignal | undefined | null)[]): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => Boolean(s));
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn.call(AbortSignal, present);
  const controller = new AbortController();
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/**
 * Per-request wall-clock budget; a timeout maps to `provider_unavailable` (retryable). The request-scoped
 * `abortSignal` (also wired to the client's own abort) is aborted on timeout so downstream provider calls stop.
 */
export function requestTimeout(ms: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const controller = new AbortController();
    c.set('abortSignal', combineAbortSignals(controller.signal, c.req.raw.signal) ?? controller.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new RequestTimeoutError(ms);
        timedOut = true;
        reject(error);
        controller.abort(error);
      }, ms);
    });
    const timeoutResponse = () => {
      c.get('log').warn('http.timeout', { ms });
      const res = respondErr(c, 'provider_unavailable', 'The request took too long and was cancelled. Please retry.');
      // The handler may have finalised a response in the same tick the deadline fired; the timeout is authoritative.
      c.res = res;
      return res;
    };
    try {
      await Promise.race([next(), timeout]);
    } catch (error) {
      // The deadline, or the abort it caused downstream (AbortError from an aborted provider call), is one outcome.
      if (error instanceof RequestTimeoutError || timedOut) return timeoutResponse();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (timedOut) return timeoutResponse();
  };
}
