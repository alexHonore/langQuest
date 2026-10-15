/**
 * HMAC tokens for Worker-proxied media streams (§4.4 "authenticated Worker proxy where practical"), used when
 * the R2 binding exists but S3 presigning credentials do not. Token = `{assetId}.{expiresAtSec}.{sig}`; the
 * signature covers the asset id, expiry and the learner id so a URL cannot be replayed for another asset.
 */
import { hmacSha256Hex } from '@langquest/telemetry/privacy';
import type { ApiEnv } from '../env';

export const mediaStreamSecret = (env: Pick<ApiEnv, 'MEDIA_STREAM_SECRET' | 'AI_SESSION_TICKET_SECRET' | 'SUPABASE_SERVICE_ROLE_KEY'>): string => env.MEDIA_STREAM_SECRET ?? env.AI_SESSION_TICKET_SECRET ?? `stream:${env.SUPABASE_SERVICE_ROLE_KEY}`;

export function signStreamToken(secret: string, assetId: string, userId: string, expiresAtSec: number): string {
  const sig = hmacSha256Hex(secret, `${assetId}|${userId}|${expiresAtSec}`).slice(0, 40);
  return `${assetId}.${expiresAtSec}.${encodeURIComponent(userId)}.${sig}`;
}

export function verifyStreamToken(secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)): { assetId: string; userId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [assetId, expRaw, userRaw, sig] = parts as [string, string, string, string];
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < nowSec) return null;
  const userId = decodeURIComponent(userRaw);
  const expected = hmacSha256Hex(secret, `${assetId}|${userId}|${exp}`).slice(0, 40);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { assetId, userId } : null;
}
