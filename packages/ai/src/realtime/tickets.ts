/**
 * Short-lived HMAC-signed session tickets handed to clients instead of provider keys (§8.6, §11).
 * Format: `base64url(payloadJson).base64url(hmacSha256(secret, payloadB64))`.
 */
import { z } from 'zod';
import { ConversationPipelineSchema } from '@langquest/contracts';
import { base64UrlDecode, base64UrlEncode, hmacSha256, timingSafeEqual } from '../util';

export const SessionTicketPayloadSchema = z.object({
  v: z.literal(1),
  sessionId: z.string().uuid(),
  userId: z.string().min(1),
  enrollmentId: z.string().uuid(),
  pipeline: ConversationPipelineSchema,
  /** Unix seconds. */
  iat: z.number().int(),
  exp: z.number().int(),
});
export type SessionTicketPayload = z.infer<typeof SessionTicketPayloadSchema>;

const te = new TextEncoder();
const td = new TextDecoder();

export const DEFAULT_TICKET_TTL_SECONDS = 15 * 60;

export async function signSessionTicket(input: Omit<SessionTicketPayload, 'v' | 'iat' | 'exp'> & { ttlSeconds?: number; now?: number }, secret: string): Promise<{ token: string; expiresAt: string }> {
  if (!secret || secret.length < 16) throw new Error('Session ticket secret must be at least 16 characters');
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: SessionTicketPayload = { v: 1, sessionId: input.sessionId, userId: input.userId, enrollmentId: input.enrollmentId, pipeline: input.pipeline, iat, exp: iat + (input.ttlSeconds ?? DEFAULT_TICKET_TTL_SECONDS) };
  const body = base64UrlEncode(te.encode(JSON.stringify(payload)));
  const sig = base64UrlEncode(await hmacSha256(secret, body));
  return { token: `${body}.${sig}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export type TicketVerification = { ok: true; payload: SessionTicketPayload } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'not_yet_valid' };

export async function verifySessionTicket(token: string, secret: string, now: number = Date.now()): Promise<TicketVerification> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts as [string, string];
  let expected: Uint8Array;
  let provided: Uint8Array;
  try {
    expected = await hmacSha256(secret, body);
    provided = base64UrlDecode(sig);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!timingSafeEqual(expected, provided)) return { ok: false, reason: 'bad_signature' };
  let payload: SessionTicketPayload;
  try {
    payload = SessionTicketPayloadSchema.parse(JSON.parse(td.decode(base64UrlDecode(body))));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const nowSec = Math.floor(now / 1000);
  if (payload.exp <= nowSec) return { ok: false, reason: 'expired' };
  if (payload.iat > nowSec + 60) return { ok: false, reason: 'not_yet_valid' };
  return { ok: true, payload };
}
