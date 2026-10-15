import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToHex, composePartHashes, computeMultipartChecksum, createSha256, hashAsyncIterable, hashNodeStream, hashWebStream, hexToBytes, sha256Hex, sha256HexSync, sha256HexWebCrypto, verifyMultipartChecksum } from './hashing';
import { fixturePath, fixturesDir, readFixture } from './test/fixtures';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function randomBytes(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

describe('sha256 (pure TS)', () => {
  it('matches known vectors', () => {
    expect(sha256HexSync('')).toBe(EMPTY);
    expect(sha256HexSync('abc')).toBe(ABC);
    expect(sha256HexSync('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('is chunk-boundary independent and matches node:crypto on 1 MiB of data', () => {
    const data = randomBytes(1024 * 1024 + 13);
    const expected = createHash('sha256').update(data).digest('hex');
    expect(sha256HexSync(data)).toBe(expected);
    const h = createSha256();
    let off = 0;
    const sizes = [1, 63, 64, 65, 1000, 4096, 100_000];
    let i = 0;
    while (off < data.length) {
      const n = sizes[i++ % sizes.length]!;
      h.update(data.subarray(off, off + n));
      off += n;
    }
    expect(h.bytesHashed).toBe(data.length);
    expect(h.hex()).toBe(expected);
  });

  it('handles the 55/56/64-byte padding edge cases', () => {
    for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const data = randomBytes(n, n);
      expect(sha256HexSync(data)).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });

  it('hex helpers round-trip', () => {
    const bytes = randomBytes(40);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
    expect(() => hexToBytes('abc')).toThrow();
  });
});

describe('sha256 across runtimes', () => {
  it('WebCrypto, pure TS and node:crypto produce identical hex', async () => {
    const data = randomBytes(50_000, 3);
    const pure = sha256HexSync(data);
    expect(await sha256HexWebCrypto(data)).toBe(pure);
    expect(await sha256Hex(data)).toBe(pure);
    expect(createHash('sha256').update(data).digest('hex')).toBe(pure);
    expect((await hashAsyncIterable((async function* () { yield data.subarray(0, 100); yield data.subarray(100); })())).sha256).toBe(pure);
    const web = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data.subarray(0, 777)); c.enqueue(data.subarray(777)); c.close(); } });
    expect(await hashWebStream(web)).toEqual({ sha256: pure, byteLength: data.length });
  });

  it.skipIf(!fixturesDir())('hashes a fixture file identically via Node stream, buffer and WebCrypto', async () => {
    const buf = await readFixture('mp3');
    const viaNode = await hashNodeStream(createReadStream(fixturePath('mp3')));
    expect(viaNode.byteLength).toBe(buf.byteLength);
    expect(viaNode.sha256).toBe(sha256HexSync(buf));
    expect(viaNode.sha256).toBe(await sha256HexWebCrypto(buf));
  });
});

describe('multipart checksum contract', () => {
  it('computes per-part hashes, whole-file hash and a verifiable composite', async () => {
    const data = randomBytes(2_500, 11);
    const checksum = await computeMultipartChecksum(data, 1000);
    expect(checksum.parts.map((p) => p.byteLength)).toEqual([1000, 1000, 500]);
    expect(checksum.wholeFileSha256).toBe(sha256HexSync(data));
    expect(checksum.parts[1]!.sha256).toBe(sha256HexSync(data.subarray(1000, 2000)));
    expect(checksum.compositeSha256).toMatch(/^[a-f0-9]{64}-3$/);
    expect(composePartHashes(checksum.parts)).toBe(checksum.compositeSha256);
    expect(verifyMultipartChecksum(checksum)).toEqual({ ok: true });
  });

  it('works with Blob-like sources (browser File)', async () => {
    const data = randomBytes(3_000, 5);
    const blob = new Blob([new Uint8Array(data).buffer as ArrayBuffer]);
    const fromBlob = await computeMultipartChecksum(blob, 1024);
    const fromBytes = await computeMultipartChecksum(data, 1024);
    expect(fromBlob).toEqual(fromBytes);
  });

  it('rejects tampered manifests', async () => {
    const checksum = await computeMultipartChecksum(randomBytes(2_048, 2), 1024);
    expect(verifyMultipartChecksum({ ...checksum, parts: [checksum.parts[1]!, checksum.parts[0]!] }).ok).toBe(false);
    expect(verifyMultipartChecksum({ ...checksum, byteLength: 2049 }).ok).toBe(false);
    expect(verifyMultipartChecksum({ ...checksum, compositeSha256: `${'0'.repeat(64)}-2` }).ok).toBe(false);
    expect(() => composePartHashes([{ partNumber: 2, sha256: 'a'.repeat(64) }])).toThrow(/contiguous/);
  });
});
