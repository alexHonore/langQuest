import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chunkedHashToMultipartChecksum, computeMultipartChecksum, hashBlobChunked, HashAbortedError, verifyMultipartChecksum } from './hashing';

const bytes = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
};
const node = (d: Uint8Array) => createHash('sha256').update(d).digest('hex');

describe('hashBlobChunked', () => {
  it('matches node crypto for whole file and parts, with progress', async () => {
    const data = bytes(1_000_003);
    const blob = new Blob([data]);
    const progress: number[] = [];
    const result = await hashBlobChunked(blob, { partSizeBytes: 300_000, chunkBytes: 70_000, onProgress: (n) => progress.push(n) });
    expect(result.sha256).toBe(node(data));
    expect(result.byteLength).toBe(data.byteLength);
    expect(Object.keys(result.partHashes)).toHaveLength(4);
    for (let n = 1; n <= 4; n++) {
      const start = (n - 1) * 300_000;
      const end = Math.min(start + 300_000, data.byteLength);
      expect(result.partHashes[n]).toBe(node(data.subarray(start, end)));
    }
    expect(progress.at(-1)).toBe(data.byteLength);
    expect(progress.length).toBeGreaterThan(10);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('is engine independent: web crypto per-part digests equal the pure hasher and computeMultipartChecksum', async () => {
    const data = bytes(250_000, 3);
    const auto = await hashBlobChunked(new Blob([data]), { partSizeBytes: 100_000, chunkBytes: 1_000_000 });
    const pure = await hashBlobChunked(data, { partSizeBytes: 100_000, chunkBytes: 1_000_000, engine: 'pure' });
    const small = await hashBlobChunked(data, { partSizeBytes: 100_000, chunkBytes: 7_777 });
    expect(pure).toEqual(auto);
    expect(small).toEqual(auto);
    const legacy = await computeMultipartChecksum(data, 100_000);
    expect(chunkedHashToMultipartChecksum(auto)).toEqual(legacy);
    expect(verifyMultipartChecksum(chunkedHashToMultipartChecksum(auto))).toEqual({ ok: true });
  });

  it('handles empty blobs and part sizes larger than the file', async () => {
    const empty = await hashBlobChunked(new Blob([]), { partSizeBytes: 1024 });
    expect(empty.sha256).toBe(node(new Uint8Array()));
    expect(empty.partHashes[1]).toBe(node(new Uint8Array()));
    const small = await hashBlobChunked(new Blob([bytes(10)]), { partSizeBytes: 1024, yieldBetweenChunks: true });
    expect(Object.keys(small.partHashes)).toEqual(['1']);
  });

  it('rejects bad options', async () => {
    await expect(hashBlobChunked(new Blob([]), { partSizeBytes: 0 })).rejects.toThrow(/partSizeBytes/);
    await expect(hashBlobChunked(new Blob([]), { partSizeBytes: 10, chunkBytes: -1 })).rejects.toThrow(/chunkBytes/);
  });

  it('aborts through the signal, before starting and mid-way', async () => {
    const controller = new AbortController();
    const blob = new Blob([bytes(500_000)]);
    const promise = hashBlobChunked(blob, { partSizeBytes: 100_000, chunkBytes: 10_000, signal: controller.signal, onProgress: (n) => n > 50_000 && controller.abort() });
    await expect(promise).rejects.toBeInstanceOf(HashAbortedError);
    const pre = new AbortController();
    pre.abort();
    await expect(hashBlobChunked(blob, { partSizeBytes: 100_000, signal: pre.signal })).rejects.toThrow('Hashing aborted');
  });
});
