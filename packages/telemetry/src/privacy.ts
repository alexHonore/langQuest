/**
 * Privacy primitives for telemetry (§11): free-text redaction, learner-id pseudonymisation,
 * retention policy constants and privacy-level projection of telemetry events.
 *
 * Everything here is synchronous and dependency-free so it runs identically on Cloudflare
 * Workers, Node job runners, the Next.js admin and the Expo app. SHA-256 is implemented in
 * pure TypeScript because the Web Crypto API only offers an async digest.
 */
import { PRIVACY_REDACTIONS, type PrivacyLevel, type TelemetryEvent } from '@langquest/contracts';

// ---------------------------------------------------------------------------
// SHA-256 / HMAC (pure TS, FIPS 180-4)
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const encoder = new TextEncoder();

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? encoder.encode(input) : input;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Raw SHA-256 digest of a string or byte array. */
export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const msg = toBytes(input);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!, false);
  return out;
}

/** Lower-case hex encoding. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** SHA-256 hex digest. */
export function sha256Hex(input: string | Uint8Array): string {
  return toHex(sha256Bytes(input));
}

/** HMAC-SHA256 hex digest (RFC 2104). */
export function hmacSha256Hex(key: string | Uint8Array, message: string | Uint8Array): string {
  let k = toBytes(key);
  if (k.length > 64) k = sha256Bytes(k);
  const block = new Uint8Array(64);
  block.set(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = block[i]! ^ 0x36;
    opad[i] = block[i]! ^ 0x5c;
  }
  const msg = toBytes(message);
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad);
  inner.set(msg, 64);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad);
  outer.set(innerHash, 64);
  return toHex(sha256Bytes(outer));
}

// ---------------------------------------------------------------------------
// Free-text redaction
// ---------------------------------------------------------------------------

/** Options for {@link redactText}. */
export interface RedactTextOptions {
  /** Strings longer than this (in code points) are replaced by a hash reference. Default 64. */
  maxFreeTextLength?: number;
  /** Prefix used for hashed free text. Default `hash:`. */
  hashPrefix?: string;
}

export const DEFAULT_MAX_FREE_TEXT_LENGTH = 64;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone numbers: optional +, 7..15 digits possibly separated by spaces, dots, dashes or parentheses.
const PHONE_RE = /(?:(?<![\w])(?:\+|00)?\d[\d\s().-]{6,}\d)(?![\w])/g;
const BEARER_RE = /\b(?:Bearer|token|api[_-]?key)\s*[:=]?\s*[A-Za-z0-9._-]{12,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

export const REDACTED_EMAIL = '[email]';
export const REDACTED_PHONE = '[phone]';
export const REDACTED_SECRET = '[secret]';

/** True when `value` looks like a hash reference produced by {@link hashFreeText}. */
export function isHashRef(value: string, prefix = 'hash:'): boolean {
  return value.startsWith(prefix) && /^[0-9a-f]{16}$/.test(value.slice(prefix.length));
}

/** Replace free text by a short, stable, non-reversible reference (`hash:<16 hex>`). */
export function hashFreeText(text: string, prefix = 'hash:'): string {
  return `${prefix}${sha256Hex(text).slice(0, 16)}`;
}

function countPhoneDigits(match: string): number {
  return match.replace(/\D/g, '').length;
}

/**
 * Redact a single string: strips emails, phone numbers and bearer-token-like secrets, and
 * replaces long free text by a hash reference so that no learner utterance, prompt or
 * transcript ever leaves the process in clear text.
 */
export function redactText(value: string, options: RedactTextOptions = {}): string {
  const max = options.maxFreeTextLength ?? DEFAULT_MAX_FREE_TEXT_LENGTH;
  const prefix = options.hashPrefix ?? 'hash:';
  if (isHashRef(value, prefix)) return value;
  let out = value.replace(JWT_RE, REDACTED_SECRET).replace(BEARER_RE, REDACTED_SECRET).replace(EMAIL_RE, REDACTED_EMAIL);
  out = out.replace(PHONE_RE, (m) => {
    const digits = countPhoneDigits(m);
    return digits >= 7 && digits <= 15 ? REDACTED_PHONE : m;
  });
  if (Array.from(out).length > max) return hashFreeText(out, prefix);
  return out;
}

/** Recursively redact every string inside a JSON-like value (arrays/objects are copied). */
export function redactDeep<T>(value: T, options: RedactTextOptions = {}): T {
  if (typeof value === 'string') return redactText(value, options) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, options)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, options);
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Learner pseudonymisation
// ---------------------------------------------------------------------------

/**
 * Derive a stable pseudonymous learner id from a Supabase `user_id` and a server-only salt.
 * The salt must never ship to clients; rotating it unlinks historical analytics.
 */
export function pseudonymizeLearnerId(userId: string, salt: string): string {
  if (!salt) throw new Error('pseudonymizeLearnerId: salt must be non-empty');
  return `u_${hmacSha256Hex(salt, userId.trim().toLowerCase()).slice(0, 32)}`;
}

/** True when `value` has the shape produced by {@link pseudonymizeLearnerId}. */
export function isPseudonymousLearnerId(value: string): boolean {
  return /^u_[0-9a-f]{32}$/.test(value);
}

/** Convenience wrapper binding a salt once (e.g. from `TELEMETRY_PSEUDONYM_SALT`). */
export class Pseudonymizer {
  readonly #salt: string;
  constructor(salt: string) {
    if (!salt) throw new Error('Pseudonymizer: salt must be non-empty');
    this.#salt = salt;
  }
  learner(userId: string): string {
    return pseudonymizeLearnerId(userId, this.#salt);
  }
  /** Pseudonymise any other identifier (device id, email for support lookups) under a namespace. */
  other(namespace: string, value: string): string {
    return `${namespace}_${hmacSha256Hex(this.#salt, `${namespace}:${value}`).slice(0, 32)}`;
  }
}

// ---------------------------------------------------------------------------
// Retention policy (§11) — operator constants, surfaced in the privacy notice
// ---------------------------------------------------------------------------

export const RETENTION_POLICY = {
  /** Raw telemetry events (pseudonymous). */
  telemetryEventsDays: 90,
  /** Aggregated daily learning metrics (no learner ids). */
  dailyMetricsDays: 730,
  /** `ai_requests` ledger rows (redacted metadata only). */
  aiRequestLogDays: 180,
  /** Learner voice recordings when the learner opted into retention (§11). */
  learnerAudioDays: 30,
  /** Conversation transcripts kept for the learner's own history. */
  conversationTranscriptDays: 365,
  /** Crash fingerprints / client error reports. */
  clientCrashDays: 90,
  /** Audit logs for admin actions. */
  auditLogDays: 1825,
} as const satisfies Record<string, number>;
export type RetentionKey = keyof typeof RETENTION_POLICY;

/** Oldest `occurredAt` (inclusive) still retained for a given policy key at time `now`. */
export function retentionCutoff(key: RetentionKey, now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_POLICY[key] * 86_400_000);
}

/** True when an event with `occurredAt` is past the retention window and should be purged. */
export function isExpired(key: RetentionKey, occurredAt: string | Date, now: Date = new Date()): boolean {
  const t = typeof occurredAt === 'string' ? Date.parse(occurredAt) : occurredAt.getTime();
  return t < retentionCutoff(key, now).getTime();
}

// ---------------------------------------------------------------------------
// Privacy-level projection of telemetry events
// ---------------------------------------------------------------------------

const PRIVACY_RANK: Record<PrivacyLevel, number> = { anonymous: 0, pseudonymous: 1, personal: 2 };

/** True when `level` is at most as identifying as `ceiling`. */
export function privacyAtMost(level: PrivacyLevel, ceiling: PrivacyLevel): boolean {
  return PRIVACY_RANK[level] <= PRIVACY_RANK[ceiling];
}

/**
 * Project an event onto a privacy ceiling: the exported event keeps the lower of its own level
 * and `ceiling`, strips the base fields listed in `PRIVACY_REDACTIONS` for that level and
 * redacts every string in `props`. Never mutates the input.
 */
export function applyPrivacyLevel<E extends TelemetryEvent>(event: E, ceiling: PrivacyLevel = event.privacyLevel, options: RedactTextOptions = {}): E {
  const level: PrivacyLevel = privacyAtMost(event.privacyLevel, ceiling) ? event.privacyLevel : ceiling;
  const copy: Record<string, unknown> = { ...event, privacyLevel: level, props: redactDeep(event.props, options) };
  for (const field of PRIVACY_REDACTIONS[level]) copy[field] = null;
  return copy as E;
}
