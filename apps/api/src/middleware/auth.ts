/**
 * Supabase JWT verification and role resolution (§11, ADR-003).
 *
 * Verification order, chosen by the token's `alg` header:
 *   1. ES256/RS256 → JWKS from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached per isolate by jose).
 *   2. HS256 → `SUPABASE_JWT_SECRET` (legacy projects / local stack).
 *   3. HS256 without a configured secret → the token is checked against Supabase Auth itself
 *      (`GET /auth/v1/user`), cached briefly per token hash. Slower but never trusts an unverified token.
 *
 * The verified access token is forwarded to supabase-js so RLS stays in force for learner routes.
 * Staff roles are read server-side from `user_roles` (service client) and cached per request only.
 */
import type { Role } from '@langquest/contracts';
import { ROLE_VALUES } from '@langquest/contracts';
import type { DbClient } from '@langquest/db/client';
import { sha256Hex } from '@langquest/telemetry/privacy';
import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type { ApiEnv } from '../env';
import { problem, respondErr } from '../http/envelope';
import type { AppEnv, Principal } from '../types';
import { peekTokens, RATE_POLICIES, takeToken, type RateLimitStore } from './rate-limit';

export interface VerifiedToken {
  userId: string;
  email: string | null;
  role: string;
  expiresAt: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export class TokenError extends Error {
  constructor(
    message: string,
    readonly reason: 'malformed' | 'expired' | 'bad_signature' | 'unsupported_alg' | 'not_authenticated' | 'provider_unavailable',
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

interface VerifierDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

const ACCEPTED_ROLES = new Set(['authenticated']);

/** Build a verifier bound to one Supabase project. Safe to keep per isolate (JWKS cache). */
export function createTokenVerifier(env: Pick<ApiEnv, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_JWT_SECRET'>, deps: VerifierDeps = {}): TokenVerifier {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL);
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  const secretKey = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;
  const remoteCache = new Map<string, { value: VerifiedToken; expiresAt: number }>();

  const fromPayload = (payload: JWTPayload): VerifiedToken => {
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const role = typeof payload.role === 'string' ? payload.role : 'anon';
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;
    if (!sub) throw new TokenError('Token has no subject', 'malformed');
    if (!ACCEPTED_ROLES.has(role)) throw new TokenError(`Token role "${role}" is not accepted by this API`, 'not_authenticated');
    return { userId: sub, email: typeof payload.email === 'string' ? payload.email : null, role, expiresAt: exp * 1000 };
  };

  const verifyRemote = async (token: string): Promise<VerifiedToken> => {
    const key = sha256Hex(token);
    const cached = remoteCache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    let res: Response;
    try {
      res = await fetchImpl(new URL('/auth/v1/user', env.SUPABASE_URL), { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    } catch {
      throw new TokenError('Could not reach the auth service', 'provider_unavailable');
    }
    if (res.status === 401 || res.status === 403) throw new TokenError('Token rejected by the auth service', 'bad_signature');
    if (!res.ok) throw new TokenError('Auth service error', 'provider_unavailable');
    const user = (await res.json()) as { id?: string; email?: string | null; role?: string; aud?: string };
    if (!user.id) throw new TokenError('Auth service returned no user', 'malformed');
    // The remote check proves the token is live; exp comes from the (unverified) payload for cache bounds.
    let exp = now() + 60_000;
    try {
      const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split('.')[1] ?? ''))) as JWTPayload;
      if (typeof payload.exp === 'number') exp = Math.min(exp, payload.exp * 1000);
    } catch {
      /* keep the short default */
    }
    const value: VerifiedToken = { userId: user.id, email: user.email ?? null, role: user.role ?? 'authenticated', expiresAt: exp };
    if (!ACCEPTED_ROLES.has(value.role)) throw new TokenError('Token role is not accepted by this API', 'not_authenticated');
    if (remoteCache.size > 5000) remoteCache.clear();
    remoteCache.set(key, { value, expiresAt: Math.min(exp, now() + 60_000) });
    return value;
  };

  return {
    async verify(token) {
      let header: ReturnType<typeof decodeProtectedHeader>;
      try {
        header = decodeProtectedHeader(token);
      } catch {
        throw new TokenError('Malformed token', 'malformed');
      }
      const alg = header.alg ?? '';
      try {
        if (alg === 'HS256' || alg === 'HS384' || alg === 'HS512') {
          if (!secretKey) return await verifyRemote(token);
          const { payload } = await jwtVerify(token, secretKey, { algorithms: [alg] });
          return fromPayload(payload);
        }
        if (alg === 'ES256' || alg === 'RS256' || alg === 'ES384' || alg === 'RS384' || alg === 'RS512' || alg === 'ES512') {
          jwks ??= createRemoteJWKSet(jwksUrl, { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000, [customFetch]: fetchImpl as never });
          const { payload } = await jwtVerify(token, jwks, { algorithms: [alg] });
          return fromPayload(payload);
        }
        throw new TokenError(`Unsupported token algorithm ${alg || '(none)'}`, 'unsupported_alg');
      } catch (error) {
        if (error instanceof TokenError) throw error;
        const code = (error as { code?: string }).code ?? '';
        if (code === 'ERR_JWT_EXPIRED') throw new TokenError('Token has expired', 'expired');
        if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || code === 'ERR_JWKS_NO_MATCHING_KEY' || code === 'ERR_JWS_INVALID' || code === 'ERR_JWT_INVALID') throw new TokenError('Token signature is invalid', 'bad_signature');
        if (code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JOSE_GENERIC') throw new TokenError('Could not verify token right now', 'provider_unavailable');
        throw new TokenError('Token could not be verified', 'bad_signature');
      }
    },
  };
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read active staff roles for a user with the service client (server-verified). */
export async function resolveRoles(service: DbClient, userId: string, nowIso = new Date().toISOString()): Promise<Role[]> {
  const res = await service.from('user_roles').select('role, expires_at').eq('user_id', userId);
  if (res.error) throw res.error;
  const roles = (res.data ?? []).filter((r) => !r.expires_at || r.expires_at > nowIso).map((r) => r.role);
  return roles.filter((r): r is Role => (ROLE_VALUES as readonly string[]).includes(r));
}

export interface AuthDeps {
  verifier: TokenVerifier;
  /** Service client factory for role lookup (lazy: learners without a Bearer never trigger it). */
  serviceClient: () => DbClient;
  /** Test hook: replace the `user_roles` lookup. */
  roleResolver?: (userId: string) => Promise<Role[]>;
  /**
   * Abuse-control store for FAILED token checks per client key (`RATE_POLICIES.auth`). Once the bucket is empty,
   * further Bearer tokens from that client are answered `rate_limited` before the verifier (and its possible
   * network call to Supabase Auth) runs — credential stuffing never costs an upstream request per probe.
   */
  failureStore?: RateLimitStore;
}

/** Distinct from the per-route `rl:auth:k:` bucket: route traffic (e.g. refresh probes) never locks out valid tokens. */
const authFailureKey = (clientKey: string): string => `rl:auth_fail:k:${clientKey}`;

const rateLimited = (c: Parameters<MiddlewareHandler<AppEnv>>[0], retryAfterSeconds: number): Response => {
  c.get('log').warn('rate_limit.blocked', { klass: 'auth', subject: 'client' });
  const res = respondErr(c, 'rate_limited', 'Too many failed authentication attempts from this network. This is an abuse guard, not a usage limit — please retry in a moment.');
  res.headers.set('Retry-After', String(retryAfterSeconds));
  return res;
};

const extractBearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
};

/**
 * Verify the Bearer token and attach the principal. When `optional` is true a missing token is allowed
 * (public routes still benefit from a principal for rate limiting); an invalid token is always rejected.
 */
export function authenticate(deps: AuthDeps, options: { optional?: boolean; resolveRoles?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = extractBearer(c.req.header('authorization'));
    if (!token) {
      if (options.optional) return next();
      return respondErr(c, 'unauthorized', 'Authentication required: send a Supabase access token as a Bearer token');
    }
    const failureKey = authFailureKey(c.get('clientKey'));
    if (deps.failureStore && (await peekTokens(deps.failureStore, failureKey, RATE_POLICIES.auth)) < 1) {
      // Bucket already exhausted by earlier failures: do not even decode/verify (no upstream call, no CPU).
      return rateLimited(c, Math.max(1, Math.ceil(60 / RATE_POLICIES.auth.perMinute)));
    }
    let verified: VerifiedToken;
    try {
      verified = await deps.verifier.verify(token);
    } catch (error) {
      if (error instanceof TokenError) {
        c.get('log').warn('auth.rejected', { reason: error.reason });
        if (error.reason === 'provider_unavailable') return respondErr(c, 'provider_unavailable', 'Authentication service is temporarily unavailable');
        if (deps.failureStore) {
          const taken = await takeToken(deps.failureStore, failureKey, RATE_POLICIES.auth);
          if (!taken.allowed) return rateLimited(c, taken.retryAfterSeconds);
        }
        return respondErr(c, 'unauthorized', error.reason === 'expired' ? 'Your session has expired. Please sign in again.' : 'Invalid access token');
      }
      throw error;
    }
    let roles: Role[] = [];
    if (options.resolveRoles !== false) {
      try {
        roles = deps.roleResolver ? await deps.roleResolver(verified.userId) : await resolveRoles(deps.serviceClient(), verified.userId);
      } catch (error) {
        c.get('log').error('auth.roles_failed', { error });
        return respondErr(c, 'internal', 'Could not resolve account roles');
      }
    }
    const principal: Principal = { userId: verified.userId, email: verified.email, accessToken: token, tokenRole: verified.role, roles, expiresAt: verified.expiresAt };
    c.set('principal', principal);
    return next();
  };
}

/** Role classes used by admin routes (mirrors the SQL helpers `is_staff`, `is_content_editor`, `is_admin`). */
export const ROLE_SETS = {
  staff: ['super_admin', 'admin', 'content_editor', 'language_reviewer', 'support_readonly'],
  contentEditor: ['super_admin', 'admin', 'content_editor'],
  languageReviewer: ['super_admin', 'admin', 'content_editor', 'language_reviewer'],
  admin: ['super_admin', 'admin'],
  support: ['super_admin', 'admin', 'support_readonly'],
} as const satisfies Record<string, readonly Role[]>;
export type RoleSet = keyof typeof ROLE_SETS;

export const hasAnyRole = (principal: Principal | undefined, set: RoleSet): boolean => Boolean(principal && principal.roles.some((r) => (ROLE_SETS[set] as readonly Role[]).includes(r)));

/** Require a verified principal holding at least one role of the set (403 otherwise, never 404 leaks). */
export function requireRoles(set: RoleSet): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal');
    if (!principal) return respondErr(c, 'unauthorized', 'Authentication required');
    if (!hasAnyRole(principal, set)) {
      c.get('log').warn('auth.forbidden', { required: set });
      return respondErr(c, 'forbidden', 'This action requires a staff role');
    }
    return next();
  };
}

/** Helper for handlers: the principal is guaranteed after `authenticate()`. */
export function requirePrincipal(c: { get(key: 'principal'): Principal | undefined }): Principal {
  const p = c.get('principal');
  if (!p) throw problem.unauthorized();
  return p;
}
