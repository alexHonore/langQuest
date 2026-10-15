/**
 * Chunked SHA-256 for browser `File`/`Blob` objects: one pass yields the whole-file digest
 * (dedupe key / object key) and one digest per multipart part, with progress callbacks and
 * cancellation. Memory stays bounded by `chunkBytes`. Runs identically in a Web Worker, on
 * the main thread and in Node tests (uses the pure hasher from `@langquest/media`).
 */
import { createSha256 } from '@langquest/media';

export interface BlobLike {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface ChunkedHashOptions {
  partSizeBytes: number;
  /** Read granularity; default 4 MiB. Smaller keeps the UI responsive on the main thread. */
  chunkBytes?: number;
  onProgress?: (hashedBytes: number) => void;
  signal?: AbortSignal;
  /** Yield to the event loop between chunks (main-thread mode). */
  yieldBetweenChunks?: boolean;
}

export interface ChunkedHashResult {
  sha256: string;
  byteLength: number;
  partSizeBytes: number;
  partHashes: Record<number, string>;
}

export class HashAbortedError extends Error {
  constructor() {
    super('Hashing aborted');
    this.name = 'HashAbortedError';
  }
}

const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function hashBlobChunked(blob: BlobLike, options: ChunkedHashOptions): Promise<ChunkedHashResult> {
  const { partSizeBytes } = options;
  if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) throw new Error('partSizeBytes must be a positive integer');
  const chunkBytes = Math.min(options.chunkBytes ?? 4 * 1024 * 1024, partSizeBytes);
  const whole = createSha256();
  const partHashes: Record<number, string> = {};
  let offset = 0;
  let partNumber = 1;
  let partHasher = createSha256();
  let partStart = 0;
  const size = blob.size;

  while (offset < size) {
    if (options.signal?.aborted) throw new HashAbortedError();
    const partEnd = Math.min(partStart + partSizeBytes, size);
    const end = Math.min(offset + chunkBytes, partEnd);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    whole.update(bytes);
    partHasher.update(bytes);
    offset = end;
    options.onProgress?.(offset);
    if (offset >= partEnd) {
      partHashes[partNumber] = partHasher.hex();
      partNumber += 1;
      partStart = partEnd;
      partHasher = createSha256();
    }
    if (options.yieldBetweenChunks) await yieldToLoop();
  }
  if (size === 0) partHashes[1] = partHasher.hex();
  return { sha256: whole.hex(), byteLength: size, partSizeBytes, partHashes };
}
