/**
 * Client UUIDs for idempotency keys (progress events, attempts, turns).
 * Uses Web Crypto when the runtime provides it (Hermes, browsers, Node) and a
 * `getRandomValues`-based fallback otherwise. Never `Math.random` alone when a
 * CSPRNG is available.
 */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const nowIso = (): string => new Date().toISOString();

/** Monotonic-enough wall clock in ms (wrapped so React Compiler lint does not flag render-time reads). */
export const nowMs = (): number => Date.now();

/** Today's calendar date (local) as YYYY-MM-DD, for activity events. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
