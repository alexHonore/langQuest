/**
 * Base64 helpers that work identically on Hermes, browsers and Node (no `Buffer`,
 * no `atob` dependency), used for inline audio payloads (§6.2 `AudioInput.inline`).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
LOOKUP['-'.charCodeAt(0)] = 62;
LOOKUP['_'.charCodeAt(0)] = 63;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  if (i < bytes.length) {
    const rem = bytes.length - i;
    const n = (bytes[i]! << 16) | ((rem > 1 ? bytes[i + 1]! : 0) << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += rem > 1 ? ALPHABET[(n >> 6) & 63]! : '=';
    out += '=';
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/_-]/g, '');
  const padding = (input.match(/=+$/)?.[0].length ?? 0) || (4 - (clean.length % 4)) % 4;
  const outLen = Math.floor((clean.length * 3) / 4) - (padding === 2 ? 2 : padding === 1 ? 1 : 0);
  const out = new Uint8Array(Math.max(0, outLen));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)]!;
    const b = i + 1 < clean.length ? LOOKUP[clean.charCodeAt(i + 1)]! : 0;
    const c = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)]! : 0;
    const d = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)]! : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Strip a `data:` URI prefix when present. */
export function stripDataUri(value: string): string {
  const idx = value.indexOf('base64,');
  return idx >= 0 ? value.slice(idx + 'base64,'.length) : value;
}
