/**
 * CORS allowlist, security headers, body-size limits and per-request timeouts (§11).
 *
 * - CORS: only origins listed in `CORS_ALLOWED_ORIGINS` are reflected; mobile apps (no Origin) are
 *   unaffected. `*` is never used because requests carry Authorization headers.
 * - Security headers: no sniffing, no framing, strict referrer, a restrictive CSP (this API serves JSON
 *   and media redirects only) and HSTS in production.
 * - Body limit: default 1 MiB; speech routes allow larger inline clips (declared per route group).
 * - Timeout: an AbortSignal is raced against the handler so a stuck provider never pins a Worker.
 */
import type { MiddlewareHandler } from 'hono';
import { RequestTimeoutError, respondErr } from '../http/envelope';
import type { AppEnv } from '../types';

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Authorization,Content-Type,Idempotency-Key,X-Request-Id,X-Client-Platform,X-Client-Version,Range';
const EXPOSED_HEADERS = 'X-Request-Id,ETag,Content-Range,Accept-Ranges,Retry-After,X-RateLimit-Remaining,X-Idempotent-Replay';

export function corsAllowlist(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header('origin');
    const config = c.get('config');
    const allowed = origin !== undefined && isOriginAllowed(origin, config.corsOrigins, config.env.API_ENV);
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

/** Exact-match allowlist; in development any localhost origin is accepted so admin/mobile web dev works. */
export function isOriginAllowed(origin: string, allowlist: readonly string[], apiEnv: string): boolean {
  if (allowlist.includes(origin)) return true;
  if (apiEnv === 'development') {
    try {
      const u = new URL(origin);
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
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

/** Per-request wall-clock budget; a timeout maps to `provider_unavailable` (retryable). */
export function requestTimeout(ms: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RequestTimeoutError(ms)), ms);
    });
    try {
      await Promise.race([next(), timeout]);
    } catch (error) {
      if (error instanceof RequestTimeoutError) {
        c.get('log').warn('http.timeout', { ms });
        return respondErr(c, 'provider_unavailable', 'The request took too long and was cancelled. Please retry.');
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
