/**
 * HMAC tokens for Worker-proxied media streams (§4.4 "authenticated Worker proxy where practical"), used when
 * the R2 binding exists but S3 presigning credentials do not. Token = `{assetId}.{expiresAtSec}.{subject}.{sig}`
 * where `subject` is a pseudonymous learner hash (never the raw user id: playback URLs end up in CDN/proxy logs)
 * and `sig` is the full HMAC-SHA256 over asset id, subject and expiry, so a URL cannot be replayed for another
 * asset, another learner or after expiry. The secret comes from `lib/secrets.ts` (fails closed, never a Supabase key).
 */
import { hmacSha256Hex } from '@langquest/telemetry/privacy';

export { mediaStreamSecret } from './secrets';

/** Stable pseudonymous subject carried in stream URLs (16 hex chars keyed by the stream secret). */
export function streamSubject(secret: string, userId: string): string {
  return hmacSha256Hex(secret, `subject:${userId.trim().toLowerCase()}`).slice(0, 16);
}

export function signStreamToken(secret: string, assetId: string, userId: string, expiresAtSec: number): string {
  const subject = streamSubject(secret, userId);
  const sig = hmacSha256Hex(secret, `${assetId}|${subject}|${expiresAtSec}`);
  return `${assetId}.${expiresAtSec}.${subject}.${sig}`;
}

export interface VerifiedStreamToken {
  assetId: string;
  /** Pseudonymous learner subject (compare with `streamSubject(secret, userId)` when needed). */
  subject: string;
  expiresAtSec: number;
}

export function verifyStreamToken(secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)): VerifiedStreamToken | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [assetId, expRaw, subject, sig] = parts as [string, string, string, string];
  if (!/^\d{1,12}$/.test(expRaw) || !/^[0-9a-f]{16}$/.test(subject) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < nowSec) return null;
  const expected = hmacSha256Hex(secret, `${assetId}|${subject}|${exp}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { assetId, subject, expiresAtSec: exp } : null;
}
