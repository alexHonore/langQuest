/**
 * Hasher facade: a Web Worker pool when available, main-thread chunked hashing otherwise.
 * The engine only sees `hash(file, partSizeBytes, onProgress, signal)`.
 */
import { hashBlobChunked, HashAbortedError, type ChunkedHashResult } from './hashing';
import type { HashWorkerMessage } from './hash.worker';

export interface Hasher {
  readonly mode: 'worker' | 'main-thread';
  hash(file: Blob, partSizeBytes: number, onProgress?: (hashedBytes: number) => void, signal?: AbortSignal): Promise<ChunkedHashResult>;
  dispose(): void;
}

export function createMainThreadHasher(): Hasher {
  return {
    mode: 'main-thread',
    hash: (file, partSizeBytes, onProgress, signal) => hashBlobChunked(file, { partSizeBytes, onProgress, signal, yieldBetweenChunks: true, chunkBytes: 2 * 1024 * 1024 }),
    dispose: () => undefined,
  };
}

interface Pending {
  resolve: (r: ChunkedHashResult) => void;
  reject: (e: Error) => void;
  onProgress?: (n: number) => void;
}

/** Round-robin pool of hashing workers (default: half the hardware threads, 1..4). */
export function createWorkerHasher(poolSize?: number): Hasher {
  const size = Math.max(1, Math.min(4, poolSize ?? Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  const workers: Worker[] = [];
  const pending = new Map<string, Pending & { worker: Worker }>();
  for (let i = 0; i < size; i++) {
    const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<HashWorkerMessage>) => {
      const msg = event.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      if ('progress' in msg) entry.onProgress?.(msg.progress);
      else if ('result' in msg) {
        pending.delete(msg.id);
        entry.resolve(msg.result);
      } else if ('cancelled' in msg) {
        pending.delete(msg.id);
        entry.reject(new HashAbortedError());
      } else {
        pending.delete(msg.id);
        entry.reject(new Error(msg.error));
      }
    };
    worker.onerror = (event) => {
      for (const [id, entry] of pending) {
        if (entry.worker === worker) {
          pending.delete(id);
          entry.reject(new Error(event.message || 'Hash worker crashed'));
        }
      }
    };
    workers.push(worker);
  }
  let next = 0;
  return {
    mode: 'worker',
    hash(file, partSizeBytes, onProgress, signal) {
      const worker = workers[next % workers.length]!;
      next += 1;
      const id = globalThis.crypto.randomUUID();
      return new Promise<ChunkedHashResult>((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress, worker });
        signal?.addEventListener('abort', () => worker.postMessage({ id, cancel: true }), { once: true });
        worker.postMessage({ id, file, partSizeBytes });
      });
    },
    dispose() {
      for (const w of workers) w.terminate();
      pending.clear();
    },
  };
}

/** Prefer workers; fall back honestly when the environment lacks them. */
export function createHasher(): Hasher {
  if (typeof Worker !== 'undefined' && typeof navigator !== 'undefined') {
    try {
      return createWorkerHasher();
    } catch {
      return createMainThreadHasher();
    }
  }
  return createMainThreadHasher();
}
