/**
 * Upload engine (spec §7.2): initiate → hash → multipart PUT to presigned R2 part URLs →
 * complete (checksum) → server verification. Concurrency-limited across files and parts,
 * pausable, cancellable, retryable, resumable (state persisted through `UploadStore`,
 * re-initiate with the same idempotency key returns the completed part numbers), with local
 * (same queue) and remote (same checksum already stored) duplicate detection.
 *
 * The engine owns no DOM; the page subscribes to snapshots. All I/O goes through injected
 * ports (`api`, `store`, `hasher`, `transport`) so the integration test runs in Node.
 */
import { UPLOAD_LIMITS } from '@langquest/media';
import type { AssetKind, UploadInitiateRequest, VisualAssetUploadInitiateRequest } from '@langquest/contracts';
import type { ApiClient } from '../api';
import { ApiClientError } from '../api';
import { HashAbortedError } from './hashing';
import type { Hasher } from './hasher';
import { findLocalDuplicate, isSchedulable, partLength, reduceUpload, remainingParts, type UploadEvent } from './machine';
import { kindForMime, relativePathOf, resolveMimeType, suggestFromPath } from './path';
import type { UploadStore } from './store';
import { PartUploadError, type PartTransport } from './transport';
import type { Id3Preview, PersistedUpload, UploadItem } from './types';

export interface UploadEngineOptions {
  api: Pick<ApiClient, 'call'>;
  store: UploadStore;
  hasher: Hasher;
  transport: PartTransport;
  /** Files uploaded concurrently (default 3). */
  fileConcurrency?: number;
  /** Parts per file in flight (default 4). */
  partConcurrency?: number;
  /** Part size requested from the API (default 16 MiB; the server may adjust). */
  partSizeBytes?: number;
  /** Retries per part on retryable transport errors (default 3). */
  maxPartRetries?: number;
  /** Optional ID3 preview reader (skipped when absent). */
  readTags?: (file: Blob) => Promise<Id3Preview | null>;
  newId?: () => string;
  now?: () => number;
  /** Back-off between part retries; injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Route that opens the multipart session. `adminUploadInitiate` (default) accepts any asset kind;
   * `adminVisualAssetUploadInitiate` is the image-only §10.2A variant (`kind` is fixed server-side to
   * `image`), whose verified upload is then turned into a `visual_assets` row by `adminVisualAssetRegister`.
   * Sign / complete / abort are shared by both.
   */
  initiateRoute?: 'adminUploadInitiate' | 'adminVisualAssetUploadInitiate';
}

export type UploadListener = (items: readonly UploadItem[]) => void;

export interface AddFileInput {
  file: File;
  relativePath?: string;
}

const defaultId = () => globalThis.crypto.randomUUID();
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class UploadEngine {
  private readonly items = new Map<string, UploadItem>();
  private readonly order: string[] = [];
  private readonly listeners = new Set<UploadListener>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Set<string>();
  private readonly opts: Required<Pick<UploadEngineOptions, 'fileConcurrency' | 'partConcurrency' | 'partSizeBytes' | 'maxPartRetries' | 'newId' | 'now' | 'sleep'>> & UploadEngineOptions;
  private started = false;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: UploadEngineOptions) {
    this.opts = {
      fileConcurrency: 3,
      partConcurrency: 4,
      partSizeBytes: UPLOAD_LIMITS.defaultPartBytes,
      maxPartRetries: 3,
      newId: defaultId,
      now: () => Date.now(),
      sleep: defaultSleep,
      ...options,
    };
  }

  // ----------------------------------------------------------------------- state

  getItems(): UploadItem[] {
    return this.order.map((id) => this.items.get(id)!).filter(Boolean);
  }

  getItem(localId: string): UploadItem | undefined {
    return this.items.get(localId);
  }

  subscribe(listener: UploadListener): () => void {
    this.listeners.add(listener);
    listener(this.getItems());
    return () => this.listeners.delete(listener);
  }

  private notify(immediate = false) {
    if (this.disposed) return;
    if (immediate) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
      const snapshot = this.getItems();
      for (const l of this.listeners) l(snapshot);
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      const snapshot = this.getItems();
      for (const l of this.listeners) l(snapshot);
    }, 80);
  }

  private dispatch(localId: string, event: UploadEvent): UploadItem | undefined {
    const current = this.items.get(localId);
    if (!current) return undefined;
    const next = reduceUpload(current, event);
    if (next === current) return current;
    this.items.set(localId, next);
    const stateChanged = next.state !== current.state;
    if (stateChanged || event.type === 'part_done' || event.type === 'hashed' || event.type === 'initiated') void this.persist(next);
    this.notify(stateChanged);
    return next;
  }

  private async persist(item: UploadItem) {
    const record: PersistedUpload = {
      localId: item.localId,
      name: item.name,
      relativePath: item.relativePath,
      size: item.size,
      mimeType: item.mimeType,
      kind: item.kind,
      checksumSha256: item.checksumSha256,
      partSizeBytes: item.partSizeBytes,
      partCount: item.partCount,
      uploadId: item.uploadId,
      storageKey: item.storageKey,
      completedParts: item.completedParts,
      idempotencyKey: item.idempotencyKey,
      state: item.state,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    try {
      if (item.state === 'done' || item.state === 'duplicate' || item.state === 'cancelled' || item.state === 'unsupported') await this.opts.store.remove(item.localId);
      else await this.opts.store.put(record);
    } catch {
      // Persistence is best-effort; the upload itself continues.
    }
  }

  // ----------------------------------------------------------------------- queue management

  /** Restore interrupted sessions from the store. They wait (`paused`, no file) until the user re-selects the file. */
  async restore(): Promise<UploadItem[]> {
    const records = await this.opts.store.list();
    const restored: UploadItem[] = [];
    for (const r of records) {
      if (this.items.has(r.localId)) continue;
      const item: UploadItem = {
        localId: r.localId,
        file: null,
        name: r.name,
        relativePath: r.relativePath,
        size: r.size,
        mimeType: r.mimeType,
        kind: r.kind,
        state: 'paused',
        hashedBytes: r.checksumSha256 ? r.size : 0,
        checksumSha256: r.checksumSha256,
        partHashes: {},
        partSizeBytes: r.partSizeBytes,
        partCount: r.partCount,
        uploadId: r.uploadId,
        storageKey: r.storageKey,
        completedParts: r.completedParts ?? {},
        inFlight: {},
        idempotencyKey: r.idempotencyKey,
        error: null,
        duplicateOfAssetId: null,
        duplicateOfLocalId: null,
        resumed: true,
        result: null,
        tags: null,
        suggestion: suggestFromPath(r.relativePath),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
      this.items.set(item.localId, item);
      this.order.push(item.localId);
      restored.push(item);
    }
    this.notify(true);
    return restored;
  }

  /** Add files. A file matching a restored session (name + size + path) re-attaches to it instead of creating a new item. */
  addFiles(inputs: readonly AddFileInput[], defaults: { kind?: AssetKind } = {}): UploadItem[] {
    const added: UploadItem[] = [];
    for (const input of inputs) {
      const relativePath = relativePathOf(input.file, input.relativePath);
      const existing = this.getItems().find((i) => i.file === null && i.name === input.file.name && i.size === input.file.size && i.relativePath === relativePath);
      if (existing) {
        const attached: UploadItem = { ...existing, file: input.file, state: 'queued', updatedAt: this.opts.now() };
        this.items.set(existing.localId, attached);
        added.push(attached);
        continue;
      }
      if (this.getItems().some((i) => i.file !== null && i.name === input.file.name && i.size === input.file.size && i.relativePath === relativePath)) continue;
      const mime = resolveMimeType(input.file.name, input.file.type);
      const kind = defaults.kind ?? (mime ? kindForMime(mime) : 'document');
      const item: UploadItem = {
        localId: this.opts.newId(),
        file: input.file,
        name: input.file.name,
        relativePath,
        size: input.file.size,
        mimeType: mime ?? input.file.type ?? 'application/octet-stream',
        kind,
        state: 'queued',
        hashedBytes: 0,
        checksumSha256: null,
        partHashes: {},
        partSizeBytes: null,
        partCount: 0,
        uploadId: null,
        storageKey: null,
        completedParts: {},
        inFlight: {},
        idempotencyKey: `up-${this.opts.newId()}`,
        error: null,
        duplicateOfAssetId: null,
        duplicateOfLocalId: null,
        resumed: false,
        result: null,
        tags: null,
        suggestion: suggestFromPath(relativePath),
        createdAt: this.opts.now(),
        updatedAt: this.opts.now(),
      };
      if (!mime) item.state = 'unsupported';
      if (mime) {
        const limit = UPLOAD_LIMITS.maxFileBytesByKind[kind] || UPLOAD_LIMITS.maxFileBytes;
        if (input.file.size > limit) {
          item.state = 'unsupported';
          item.error = `too_large:${limit}`;
        } else if (input.file.size === 0) {
          item.state = 'unsupported';
          item.error = 'empty_file';
        }
      } else item.error = `unsupported_type:${input.file.type || input.file.name.split('.').pop() || '?'}`;
      this.items.set(item.localId, item);
      this.order.push(item.localId);
      added.push(item);
      if (item.state === 'queued' && item.kind === 'audio' && this.opts.readTags) {
        void this.opts.readTags(input.file).then((tags) => {
          const current = this.items.get(item.localId);
          if (current && tags) {
            this.items.set(item.localId, { ...current, tags });
            this.notify();
          }
        });
      }
    }
    this.notify(true);
    if (this.started) this.schedule();
    return added;
  }

  start() {
    this.started = true;
    this.schedule();
  }

  pause(localId?: string) {
    const targets = localId ? [localId] : this.order;
    for (const id of targets) {
      this.controllers.get(id)?.abort('pause');
      this.dispatch(id, { type: 'pause' });
    }
    if (!localId) this.started = false;
  }

  resume(localId?: string) {
    const targets = localId ? [localId] : this.order;
    for (const id of targets) this.dispatch(id, { type: 'resume' });
    this.started = true;
    this.schedule();
  }

  retry(localId?: string) {
    const targets = localId ? [localId] : this.order.filter((id) => this.items.get(id)?.state === 'failed');
    for (const id of targets) this.dispatch(id, { type: 'retry' });
    this.started = true;
    this.schedule();
  }

  async cancel(localId: string) {
    const item = this.items.get(localId);
    if (!item) return;
    this.controllers.get(localId)?.abort('cancel');
    const next = this.dispatch(localId, { type: 'cancel' });
    if (item.uploadId && next?.state === 'cancelled' && item.state !== 'done' && item.state !== 'duplicate') {
      try {
        await this.opts.api.call('adminUploadAbort', { params: { id: item.uploadId }, body: { reason: 'cancelled by editor' } });
      } catch {
        // The orphan sweeper on the API aborts stale multipart uploads; nothing else to do here.
      }
    }
  }

  remove(localId: string) {
    const item = this.items.get(localId);
    if (!item) return;
    if (!['done', 'duplicate', 'cancelled', 'failed', 'unsupported', 'paused', 'queued'].includes(item.state)) return;
    this.items.delete(localId);
    const idx = this.order.indexOf(localId);
    if (idx !== -1) this.order.splice(idx, 1);
    void this.opts.store.remove(localId);
    this.notify(true);
  }

  clearFinished() {
    for (const id of [...this.order]) {
      const s = this.items.get(id)?.state;
      if (s === 'done' || s === 'duplicate' || s === 'cancelled' || s === 'unsupported') this.remove(id);
    }
  }

  dispose() {
    this.disposed = true;
    for (const c of this.controllers.values()) c.abort('dispose');
    this.listeners.clear();
    this.opts.hasher.dispose();
  }

  /** Resolves once no item is active or queued (tests and "leave page" guards). */
  async idle(): Promise<void> {
    while (this.getItems().some((i) => isSchedulable(i) || this.running.has(i.localId))) await new Promise<void>((r) => setTimeout(r, 5));
  }

  // ----------------------------------------------------------------------- scheduler

  private schedule() {
    if (!this.started || this.disposed) return;
    for (const id of this.order) {
      if (this.running.size >= this.opts.fileConcurrency) break;
      const item = this.items.get(id);
      if (!item || !isSchedulable(item) || this.running.has(id)) continue;
      this.running.add(id);
      void this.runItem(id).finally(() => {
        this.running.delete(id);
        this.controllers.delete(id);
        this.schedule();
      });
    }
  }

  private async runItem(localId: string) {
    const controller = new AbortController();
    this.controllers.set(localId, controller);
    const signal = controller.signal;
    try {
      let item = this.items.get(localId)!;
      if (!item.file) return;

      // 1. hash (skipped when resuming with a known checksum)
      if (!item.checksumSha256) {
        this.items.set(localId, { ...item, state: 'hashing' });
        this.notify(true);
        const result = await this.opts.hasher.hash(item.file, this.opts.partSizeBytes, (n) => this.dispatch(localId, { type: 'hash_progress', hashedBytes: n }), signal);
        item = this.dispatch(localId, { type: 'hashed', checksumSha256: result.sha256, partHashes: result.partHashes })!;
      } else {
        item = this.dispatch(localId, { type: 'initiating' })!;
      }
      if (signal.aborted) return;

      // 2. local duplicate (same bytes earlier in this queue)
      const localDup = findLocalDuplicate(this.getItems(), item);
      if (localDup) {
        this.dispatch(localId, { type: 'duplicate', assetId: null, localId: localDup.localId });
        return;
      }

      // 3. initiate (idempotent → resume)
      const base = {
        filename: item.name,
        relativePath: item.relativePath !== item.name ? item.relativePath : undefined,
        byteLength: item.size,
        clientChecksumSha256: item.checksumSha256!,
        idempotencyKey: item.idempotencyKey,
        ...(this.opts.partSizeBytes >= UPLOAD_LIMITS.minPartBytes ? { partSizeBytes: this.opts.partSizeBytes } : {}),
      };
      const init =
        this.opts.initiateRoute === 'adminVisualAssetUploadInitiate'
          ? await this.opts.api.call('adminVisualAssetUploadInitiate', {
              body: { ...base, contentType: item.mimeType as VisualAssetUploadInitiateRequest['contentType'] } satisfies VisualAssetUploadInitiateRequest,
              idempotencyKey: item.idempotencyKey,
              signal,
            })
          : await this.opts.api.call('adminUploadInitiate', {
              body: { ...base, contentType: item.mimeType as UploadInitiateRequest['contentType'], kind: item.kind } satisfies UploadInitiateRequest,
              idempotencyKey: item.idempotencyKey,
              signal,
            });
      if (init.duplicateOfAssetId) {
        this.dispatch(localId, { type: 'duplicate', assetId: init.duplicateOfAssetId, localId: null });
        try {
          await this.opts.api.call('adminUploadAbort', { params: { id: init.uploadId }, body: { reason: 'duplicate content hash' } });
        } catch {
          /* best effort */
        }
        return;
      }
      item = this.dispatch(localId, {
        type: 'initiated',
        uploadId: init.uploadId,
        storageKey: init.storageKey,
        partSizeBytes: init.partSizeBytes,
        partCount: init.partCount,
        resumed: init.resumed,
        completedPartNumbers: init.completedPartNumbers,
      })!;
      if (signal.aborted) return;

      // 4. upload remaining parts (sign in batches, bounded concurrency)
      await this.uploadParts(localId, signal);
      if (signal.aborted) return;
      item = this.items.get(localId)!;
      if (item.state !== 'uploading') return;

      // 5. complete + verify
      this.dispatch(localId, { type: 'completing' });
      const parts = Object.entries(item.completedParts)
        .map(([n, p]) => ({ partNumber: Number(n), etag: p.etag, byteLength: p.byteLength }))
        .sort((a, b) => a.partNumber - b.partNumber);
      const result = await this.opts.api.call('adminUploadComplete', {
        params: { id: item.uploadId! },
        body: { parts, clientChecksumSha256: item.checksumSha256! },
        idempotencyKey: `${item.idempotencyKey}-complete`,
        signal,
      });
      if (result.status === 'completed') this.dispatch(localId, { type: 'verifying' });
      this.dispatch(localId, { type: 'completed', result });
    } catch (error) {
      if (signal.aborted || error instanceof HashAbortedError) return; // pause/cancel already applied
      if (error instanceof ApiClientError && error.code === 'conflict') {
        this.dispatch(localId, { type: 'fail', message: `conflict: ${error.message}` });
        return;
      }
      this.dispatch(localId, { type: 'fail', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async uploadParts(localId: string, signal: AbortSignal) {
    const urls = new Map<number, string>();
    const signBatch = async () => {
      const item = this.items.get(localId)!;
      const unsigned = remainingParts(item).filter((n) => !urls.has(n)).slice(0, UPLOAD_LIMITS.maxPartsPerSignRequest);
      if (unsigned.length === 0) return;
      const signed = await this.opts.api.call('adminUploadPartsSign', { params: { id: item.uploadId! }, body: { partNumbers: unsigned }, signal });
      for (const p of signed.parts) urls.set(p.partNumber, p.url);
    };

    const queue = remainingParts(this.items.get(localId)!);
    let failure: Error | null = null;
    const worker = async () => {
      while (queue.length > 0 && !signal.aborted && !failure) {
        const n = queue.shift()!;
        if (!urls.has(n)) await signBatch();
        const url = urls.get(n);
        if (!url) {
          failure = new Error(`No presigned URL for part ${n}`);
          return;
        }
        try {
          await this.putPartWithRetry(localId, n, url, signal);
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: this.opts.partConcurrency }, () => worker()));
    if (failure && !signal.aborted) throw failure;
  }

  private async putPartWithRetry(localId: string, partNumber: number, url: string, signal: AbortSignal) {
    const item = this.items.get(localId)!;
    const size = partLength(item.partSizeBytes!, item.partCount, item.size, partNumber);
    const start = item.partSizeBytes! * (partNumber - 1);
    const blob = item.file!.slice(start, start + size);
    let attempt = 0;
    for (;;) {
      try {
        const { etag } = await this.opts.transport.putPart(url, blob, {
          signal,
          contentType: item.mimeType,
          onProgress: (bytes) => this.dispatch(localId, { type: 'part_progress', partNumber, bytes }),
        });
        this.dispatch(localId, { type: 'part_done', partNumber, etag, byteLength: size });
        return;
      } catch (error) {
        if (signal.aborted) throw error;
        const retryable = error instanceof PartUploadError ? error.retryable : true;
        attempt += 1;
        if (!retryable || attempt > this.opts.maxPartRetries) throw error;
        this.dispatch(localId, { type: 'part_progress', partNumber, bytes: 0 });
        await this.opts.sleep(Math.min(8000, 300 * 2 ** (attempt - 1)));
      }
    }
  }
}
