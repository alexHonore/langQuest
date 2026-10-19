/**
 * Server-only HMAC secrets and salts (§8.6, §11). Every helper fails closed: when the dedicated secret is missing the
 * caller gets `capability_unsupported` instead of a value silently derived from a Supabase key. The anon key ships in
 * every mobile/admin bundle and the service-role key is the most sensitive value in the Worker, so neither may ever
 * become key material for tickets handed to clients, pseudonyms in ledgers, or media URLs that appear in CDN logs.
 */
import { hmacSha256Hex } from '@langquest/telemetry/privacy';
import type { ApiEnv } from '../env';
import { problem } from '../http/envelope';

type SecretEnv = Pick<ApiEnv, 'AI_SESSION_TICKET_SECRET' | 'LEARNER_PSEUDONYM_SALT' | 'MEDIA_STREAM_SECRET'>;

/** Secret for short-lived conversation session tickets (`signSessionTicket`). */
export function sessionTicketSecret(env: Pick<SecretEnv, 'AI_SESSION_TICKET_SECRET'>): string {
  if (!env.AI_SESSION_TICKET_SECRET) throw problem.unsupported('Session tickets are not configured on this deployment (AI_SESSION_TICKET_SECRET missing)');
  return env.AI_SESSION_TICKET_SECRET;
}

/**
 * Salt for `pseudonymizeLearnerId` (ai_requests, quality incidents). A dedicated `LEARNER_PSEUDONYM_SALT` wins;
 * otherwise a domain-separated derivation of the ticket secret is used so the two key materials never coincide.
 * Returns null when AI is not configured at all (rows then stay without a learner hash).
 */
export function learnerPseudonymSalt(env: Pick<SecretEnv, 'AI_SESSION_TICKET_SECRET' | 'LEARNER_PSEUDONYM_SALT'>): string | null {
  if (env.LEARNER_PSEUDONYM_SALT) return env.LEARNER_PSEUDONYM_SALT;
  if (env.AI_SESSION_TICKET_SECRET) return hmacSha256Hex(env.AI_SESSION_TICKET_SECRET, 'langquest:learner-pseudonym:v1');
  return null;
}

/** Secret for Worker-proxied media stream tokens (dedicated `MEDIA_STREAM_SECRET`, else the ticket secret). */
export function mediaStreamSecret(env: Pick<SecretEnv, 'MEDIA_STREAM_SECRET' | 'AI_SESSION_TICKET_SECRET'>): string {
  const secret = env.MEDIA_STREAM_SECRET ?? env.AI_SESSION_TICKET_SECRET;
  if (!secret) throw problem.unsupported('Worker-proxied media streaming is not configured on this deployment (MEDIA_STREAM_SECRET or AI_SESSION_TICKET_SECRET missing)');
  return secret;
}
