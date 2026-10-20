/**
 * Deterministic character ids (RFC 4122 UUID v5) — pure TypeScript SHA-1 so the
 * same helper runs on React Native, in Node and in the browser without `node:crypto`.
 *
 * `CHARACTER_UUID_NAMESPACE` mirrors `@langquest/db` (`character-uuid.ts`); the db tests
 * fail on any drift. Never change it: `characters.id` rows and their FKs are derived from it.
 */

export const CHARACTER_UUID_NAMESPACE = 'd0a6e7c4-9d2b-4f3a-8e1c-5b7f2c9a1e34';
/** Name prefix hashed with the roster id. */
export const CHARACTER_UUID_NAME_PREFIX = 'langquest.character:';

/** The database `characters.character_key` for a roster id (identity — the roster slug is the key). */
export const characterKey = (rosterId: string): string => rosterId;

const utf8Bytes = (text: string): Uint8Array => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i += 1;
      }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return Uint8Array.from(out);
};

/** SHA-1 (FIPS 180-4) over bytes. */
function sha1Bytes(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const padded = Math.ceil((bytes.length + 1 + 8) / 64) * 64;
  const msg = new Uint8Array(padded);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(padded - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded - 4, bitLength >>> 0, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i += 1) {
      const x =
        (w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number);
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] as number)) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const digest = new Uint8Array(20);
  const dv = new DataView(digest.buffer);
  dv.setUint32(0, h0, false);
  dv.setUint32(4, h1, false);
  dv.setUint32(8, h2, false);
  dv.setUint32(12, h3, false);
  dv.setUint32(16, h4, false);
  return digest;
}

const uuidToBytes = (uuid: string): Uint8Array => {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** RFC 4122 UUID v5 (SHA-1 name-based) of `name` under `namespace`. */
export function uuidV5(namespace: string, name: string): string {
  const ns = uuidToBytes(namespace);
  const nameBytes = utf8Bytes(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const hash = sha1Bytes(input);
  hash[6] = ((hash[6] as number) & 0x0f) | 0x50;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(hash.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Deterministic `characters.id` for a roster slug: UUID v5 of
 * `CHARACTER_UUID_NAME_PREFIX + slug` under {@link CHARACTER_UUID_NAMESPACE}.
 * Identical to `characterUuid()` in `@langquest/db`, so the id mobile sends to
 * `POST /v1/ai/conversation/session` is the seeded database row.
 */
export function stableCharacterUuid(slug: string): string {
  return uuidV5(CHARACTER_UUID_NAMESPACE, CHARACTER_UUID_NAME_PREFIX + slug);
}
