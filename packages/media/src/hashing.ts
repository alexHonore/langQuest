/**
 * Content hashing (§7.2 dedupe by SHA-256, §4.4 content-addressed object keys).
 *
 * Three interchangeable implementations that produce byte-identical lowercase hex:
 *  - a pure-TypeScript incremental SHA-256 (`createSha256`) that streams anywhere
 *    (Node, Cloudflare Workers, browsers) and is synchronous — used for manifest
 *    checksums and multipart part hashing;
 *  - Web Crypto `crypto.subtle.digest` for whole buffers (`sha256HexWebCrypto`);
 *  - `node:crypto` for Node streams (`hashNodeStream`), loaded lazily so this module
 *    never imports Node built-ins at module scope and stays Workers-safe.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const HEX = '0123456789abcdef';

/** Lowercase hex encoding of a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += HEX[b >> 4]! + HEX[b & 0x0f]!;
  }
  return out;
}

/** Decode lowercase/uppercase hex into bytes. Throws on odd length or non-hex characters. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const textEncoder = new TextEncoder();

/** Coerce string (UTF-8) or binary input to `Uint8Array`. */
export function toBytes(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof input === 'string') return textEncoder.encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return input;
}

/** Incremental SHA-256 hasher (pure TypeScript, synchronous, environment-agnostic). */
export interface Sha256Hasher {
  /** Feed more bytes. Returns `this` for chaining. */
  update(data: Uint8Array | ArrayBuffer | string): Sha256Hasher;
  /** Finalize and return the 32-byte digest. The hasher cannot be reused afterwards. */
  digest(): Uint8Array;
  /** Finalize and return the lowercase hex digest. */
  hex(): string;
  /** Total number of bytes fed so far. */
  readonly bytesHashed: number;
}

class Sha256Impl implements Sha256Hasher {
  private readonly state = new Uint32Array(INITIAL_STATE);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLength = 0;
  private finalized = false;
  bytesHashed = 0;

  update(input: Uint8Array | ArrayBuffer | string): Sha256Hasher {
    if (this.finalized) throw new Error('SHA-256 hasher already finalized');
    const data = toBytes(input);
    let offset = 0;
    this.bytesHashed += data.length;
    if (this.blockLength > 0) {
      const take = Math.min(64 - this.blockLength, data.length);
      this.block.set(data.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength === 64) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.block.set(data.subarray(offset), 0);
      this.blockLength = data.length - offset;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finalized) throw new Error('SHA-256 hasher already finalized');
    this.finalized = true;
    const bitLengthHigh = Math.floor(this.bytesHashed / 0x20000000); // bytes * 8 / 2^32
    const bitLengthLow = (this.bytesHashed << 3) >>> 0;
    this.block[this.blockLength++] = 0x80;
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength);
      this.compress(this.block, 0);
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength, 56);
    const view = new DataView(this.block.buffer, this.block.byteOffset, 64);
    view.setUint32(56, bitLengthHigh, false);
    view.setUint32(60, bitLengthLow, false);
    this.compress(this.block, 0);
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, this.state[i] as number, false);
    return out;
  }

  hex(): string {
    return bytesToHex(this.digest());
  }

  private compress(chunk: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((chunk[j] as number) << 24) |
        ((chunk[j + 1] as number) << 16) |
        ((chunk[j + 2] as number) << 8) |
        (chunk[j + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    const st = this.state;
    let a = st[0] as number;
    let b = st[1] as number;
    let c = st[2] as number;
    let d = st[3] as number;
    let e = st[4] as number;
    let f = st[5] as number;
    let g = st[6] as number;
    let h = st[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    st[0] = (a + (st[0] as number)) >>> 0;
    st[1] = (b + (st[1] as number)) >>> 0;
    st[2] = (c + (st[2] as number)) >>> 0;
    st[3] = (d + (st[3] as number)) >>> 0;
    st[4] = (e + (st[4] as number)) >>> 0;
    st[5] = (f + (st[5] as number)) >>> 0;
    st[6] = (g + (st[6] as number)) >>> 0;
    st[7] = (h + (st[7] as number)) >>> 0;
  }
}

/** Create a new incremental SHA-256 hasher. */
export function createSha256(): Sha256Hasher {
  return new Sha256Impl();
}

/** Synchronous SHA-256 hex of a whole buffer or string (pure TS). */
export function sha256HexSync(input: Uint8Array | ArrayBuffer | string): string {
  return createSha256().update(input).hex();
}

function subtleCrypto(): SubtleCrypto | null {
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  return g.crypto?.subtle ?? null;
}

/** SHA-256 hex of a whole buffer using Web Crypto (Workers, browsers, Node ≥ 19). */
export async function sha256HexWebCrypto(input: Uint8Array | ArrayBuffer | string): Promise<string> {
  const subtle = subtleCrypto();
  if (!subtle) throw new Error('Web Crypto (crypto.subtle) is not available in this runtime');
  const bytes = toBytes(input);
  // Copy into a fresh ArrayBuffer so SharedArrayBuffer-backed / offset views are accepted everywhere.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await subtle.digest('SHA-256', copy);
  return bytesToHex(new Uint8Array(digest));
}

/** SHA-256 hex of a whole buffer: Web Crypto when available, pure TS otherwise. Output is identical. */
export async function sha256Hex(input: Uint8Array | ArrayBuffer | string): Promise<string> {
  return subtleCrypto() ? sha256HexWebCrypto(input) : sha256HexSync(input);
}

/** Result of hashing a stream: digest plus the number of bytes consumed. */
export interface StreamHashResult {
  sha256: string;
  byteLength: number;
}

/** Hash any async iterable of byte chunks (Node `Readable`, async generators, …) with the pure hasher. */
export async function hashAsyncIterable(chunks: AsyncIterable<Uint8Array | ArrayBuffer | string>): Promise<StreamHashResult> {
  const hasher = createSha256();
  for await (const chunk of chunks) hasher.update(chunk);
  return { sha256: hasher.hex(), byteLength: hasher.bytesHashed };
}

/** Hash a Web `ReadableStream<Uint8Array>` (Workers / R2 `.body`) incrementally. Works in every runtime. */
export async function hashWebStream(stream: ReadableStream<Uint8Array>): Promise<StreamHashResult> {
  const reader = stream.getReader();
  const hasher = createSha256();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: hasher.hex(), byteLength: hasher.bytesHashed };
}

/** Minimal structural type for a Node `Readable` so this module does not import `node:stream`. */
export type NodeReadableLike = AsyncIterable<Uint8Array | string> & { readonly readable?: boolean };

/**
 * Hash a Node readable stream with `node:crypto` (native speed for multi-GB masters).
 * The module is imported lazily so bundling for Workers does not pull in Node built-ins;
 * if `node:crypto` is unavailable, falls back to the pure hasher with identical output.
 */
export async function hashNodeStream(stream: NodeReadableLike): Promise<StreamHashResult> {
  type CreateHash = (alg: string) => { update(d: Uint8Array | string): unknown; digest(enc: 'hex'): string };
  let createHash: CreateHash | null = null;
  try {
    const mod = (await import('node:crypto')) as unknown as { createHash: CreateHash };
    createHash = mod.createHash;
  } catch {
    createHash = null;
  }
  if (createHash === null) return hashAsyncIterable(stream);
  const hash = createHash('sha256');
  let byteLength = 0;
  for await (const chunk of stream) {
    const bytes = toBytes(chunk);
    byteLength += bytes.byteLength;
    hash.update(bytes);
  }
  return { sha256: hash.digest('hex'), byteLength };
}

// --- multipart (browser) checksum contract --------------------------------------

/** Per-part digest produced while the browser slices a file for multipart upload. */
export interface PartHash {
  /** 1-based part number, matching the S3/R2 multipart part number. */
  partNumber: number;
  /** Byte offset of the part within the file. */
  offset: number;
  /** Part length in bytes (only the last part may be shorter than the part size). */
  byteLength: number;
  /** SHA-256 hex of the part's bytes. */
  sha256: string;
}

/**
 * Checksum manifest the client sends at `complete`: the whole-file SHA-256 (the dedupe key and
 * object-key hash) plus the ordered per-part hashes. `compositeSha256` is derived from the part
 * hashes alone, so the server can verify part integrity from R2 metadata without re-reading
 * the whole object, and verify the whole-file hash later in a background `verify` job.
 */
export interface MultipartChecksum {
  wholeFileSha256: string;
  byteLength: number;
  partSizeBytes: number;
  parts: PartHash[];
  /** SHA-256 over the concatenated raw part digests, suffixed with `-<partCount>` (S3-style composite). */
  compositeSha256: string;
}

/** Compose the composite hash from ordered part hashes: `sha256(concat(rawPartDigests))-N`. */
export function composePartHashes(parts: ReadonlyArray<Pick<PartHash, 'partNumber' | 'sha256'>>): string {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < sorted.length; i++) {
    if ((sorted[i] as PartHash).partNumber !== i + 1) throw new Error(`Part numbers must be contiguous from 1; missing part ${i + 1}`);
  }
  const hasher = createSha256();
  for (const p of sorted) hasher.update(hexToBytes(p.sha256));
  return `${hasher.hex()}-${sorted.length}`;
}

/** Any object that can be sliced into byte ranges (browser `File`/`Blob`, or an in-memory buffer). */
export type SliceableSource = Uint8Array | { readonly size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } };

/**
 * Hash a file in a single pass for multipart upload: the whole-file digest and one digest per part.
 * Memory use is bounded by `partSizeBytes` (each part is read once).
 */
export async function computeMultipartChecksum(source: SliceableSource, partSizeBytes: number): Promise<MultipartChecksum> {
  if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) throw new Error('partSizeBytes must be a positive integer');
  const size = source instanceof Uint8Array ? source.byteLength : source.size;
  const whole = createSha256();
  const parts: PartHash[] = [];
  let offset = 0;
  let partNumber = 1;
  while (offset < size || (size === 0 && partNumber === 1)) {
    const end = Math.min(offset + partSizeBytes, size);
    const bytes = source instanceof Uint8Array ? source.subarray(offset, end) : new Uint8Array(await source.slice(offset, end).arrayBuffer());
    whole.update(bytes);
    parts.push({ partNumber, offset, byteLength: bytes.byteLength, sha256: sha256HexSync(bytes) });
    offset = end;
    partNumber++;
    if (size === 0) break;
  }
  return { wholeFileSha256: whole.hex(), byteLength: size, partSizeBytes, parts, compositeSha256: composePartHashes(parts) };
}

/** Structural verification of a client checksum manifest (sizes, contiguity, composite). */
export function verifyMultipartChecksum(checksum: MultipartChecksum): { ok: true } | { ok: false; reason: string } {
  const { parts, partSizeBytes, byteLength } = checksum;
  if (parts.length === 0) return { ok: false, reason: 'no parts' };
  let expectedOffset = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as PartHash;
    if (p.partNumber !== i + 1) return { ok: false, reason: `part ${i + 1} missing or out of order` };
    if (p.offset !== expectedOffset) return { ok: false, reason: `part ${p.partNumber} offset mismatch` };
    const isLast = i === parts.length - 1;
    if (!isLast && p.byteLength !== partSizeBytes) return { ok: false, reason: `part ${p.partNumber} is not a full part` };
    if (isLast && (p.byteLength <= 0 || p.byteLength > partSizeBytes)) return { ok: false, reason: 'last part has invalid length' };
    if (!/^[a-f0-9]{64}$/.test(p.sha256)) return { ok: false, reason: `part ${p.partNumber} hash is not sha256 hex` };
    expectedOffset += p.byteLength;
  }
  if (expectedOffset !== byteLength) return { ok: false, reason: 'parts do not cover the declared byte length' };
  if (composePartHashes(parts) !== checksum.compositeSha256) return { ok: false, reason: 'composite hash mismatch' };
  if (!/^[a-f0-9]{64}$/.test(checksum.wholeFileSha256)) return { ok: false, reason: 'whole-file hash is not sha256 hex' };
  return { ok: true };
}
