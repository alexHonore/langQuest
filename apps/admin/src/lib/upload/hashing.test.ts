import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashBlobChunked, HashAbortedError } from './hashing';

const bytes = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
};

describe('hashBlobChunked', () => {
  it('matches node crypto for whole file and parts, with progress', async () => {
    const data = bytes(1_000_003);
    const blob = new Blob([data]);
    const progress: number[] = [];
    const result = await hashBlobChunked(blob, { partSizeBytes: 300_000, chunkBytes: 70_000, onProgress: (n) => progress.push(n) });
    expect(result.sha256).toBe(createHash('sha256').update(data).digest('hex'));
    expect(result.byteLength).toBe(data.byteLength);
    expect(Object.keys(result.partHashes)).toHaveLength(4);
    for (let n = 1; n <= 4; n++) {
      const start = (n - 1) * 300_000;
      const end = Math.min(start + 300_000, data.byteLength);
      expect(result.partHashes[n]).toBe(createHash('sha256').update(data.subarray(start, end)).digest('hex'));
    }
    expect(progress.at(-1)).toBe(data.byteLength);
    expect(progress.length).toBeGreaterThan(10);
  });

  it('handles empty blobs and part sizes larger than the file', async () => {
    const empty = await hashBlobChunked(new Blob([]), { partSizeBytes: 1024 });
    expect(empty.sha256).toBe(createHash('sha256').update(new Uint8Array()).digest('hex'));
    expect(empty.partHashes[1]).toBeDefined();
    const small = await hashBlobChunked(new Blob([bytes(10)]), { partSizeBytes: 1024 });
    expect(Object.keys(small.partHashes)).toEqual(['1']);
  });

  it('aborts through the signal', async () => {
    const controller = new AbortController();
    const blob = new Blob([bytes(500_000)]);
    const promise = hashBlobChunked(blob, { partSizeBytes: 100_000, chunkBytes: 10_000, signal: controller.signal, onProgress: (n) => n > 50_000 && controller.abort() });
    await expect(promise).rejects.toBeInstanceOf(HashAbortedError);
  });
});
