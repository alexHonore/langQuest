/**
 * Token forgery helpers for the security suites. Only the local stack's HS256 secret (never a hosted project's)
 * is used to mint "valid-looking" tokens; everything else here is deliberately invalid.
 */
import { SignJWT } from 'jose';

export interface ForgeOptions {
  secret: string;
  role?: string;
  expiresInSeconds?: number;
  email?: string;
  alg?: 'HS256' | 'HS384';
}

/** Mint an HS256 token for `userId` with the given secret (expired when `expiresInSeconds` is negative). */
export async function forgeToken(userId: string, opts: ForgeOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: opts.role ?? 'authenticated', email: opts.email ?? `${userId}@forged.invalid`, aud: 'authenticated' })
    .setProtectedHeader({ alg: opts.alg ?? 'HS256' })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresInSeconds ?? 3600))
    .sign(new TextEncoder().encode(opts.secret));
}

const b64url = (input: string): string => Buffer.from(input).toString('base64url');

/** An `alg: none` token (unsigned) — must always be rejected. */
export function noneAlgToken(userId: string): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.`;
}

/**
 * Flip a character in the MIDDLE of the signature segment of a real token. (The last base64url character only
 * carries padding bits for 64-byte ES256 signatures, so flipping it would not change the decoded signature.)
 */
export function tamperSignature(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a JWS compact token');
  const sig = parts[2]!;
  const at = Math.floor(sig.length / 2);
  const current = sig[at]!;
  const replacement = current === 'A' ? 'B' : 'A';
  return `${parts[0]}.${parts[1]}.${sig.slice(0, at)}${replacement}${sig.slice(at + 1)}`;
}

/** Re-encode the payload with another subject but keep the original signature (classic swap attack). */
export function swapSubject(token: string, newSubject: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a JWS compact token');
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  payload.sub = newSubject;
  return `${parts[0]}.${b64url(JSON.stringify(payload))}.${parts[2]}`;
}
