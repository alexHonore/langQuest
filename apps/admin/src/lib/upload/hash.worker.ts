/// <reference lib="webworker" />
/**
 * Web Worker entry: hashes a File off the main thread so queues with thousands of files
 * never freeze the UI. Protocol: `{ id, file, partSizeBytes }` in; `{ id, progress }`
 * messages, then `{ id, result }` or `{ id, error }`.
 */
import { hashBlobChunked } from './hashing';

export interface HashWorkerRequest {
  id: string;
  file: Blob;
  partSizeBytes: number;
}
export type HashWorkerMessage =
  | { id: string; progress: number }
  | { id: string; result: { sha256: string; byteLength: number; partSizeBytes: number; partHashes: Record<number, string> } }
  | { id: string; error: string }
  | { id: string; cancelled: true };

const controllers = new Map<string, AbortController>();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<HashWorkerRequest | { id: string; cancel: true }>) => {
  const data = event.data;
  if ('cancel' in data) {
    controllers.get(data.id)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(data.id, controller);
  let lastPost = 0;
  try {
    const result = await hashBlobChunked(data.file, {
      partSizeBytes: data.partSizeBytes,
      signal: controller.signal,
      onProgress: (hashedBytes) => {
        const now = Date.now();
        if (now - lastPost > 120 || hashedBytes === data.file.size) {
          lastPost = now;
          scope.postMessage({ id: data.id, progress: hashedBytes } satisfies HashWorkerMessage);
        }
      },
    });
    scope.postMessage({ id: data.id, result } satisfies HashWorkerMessage);
  } catch (error) {
    if (controller.signal.aborted) scope.postMessage({ id: data.id, cancelled: true } satisfies HashWorkerMessage);
    else scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) } satisfies HashWorkerMessage);
  } finally {
    controllers.delete(data.id);
  }
};
