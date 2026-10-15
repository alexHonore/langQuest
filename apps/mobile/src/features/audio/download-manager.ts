/**
 * Download manager (§4.4, §4.5, Phase 3): resumable per-file transfers from a
 * rights-gated download pack, checksum verification, progress, pause / cancel /
 * retry, Wi-Fi-only gating and safe cleanup. The file system and network are
 * injected ({@link DownloadFs}) so the state machine is unit-tested; the
 * `expo-file-system` implementation is in `expo-fs-adapter.ts`.
 *
 * Storage limits come from the device and the learner's own choices — never a
 * tier or quota (§0.2, Phase 3).
 */
import type { DownloadPackManifest } from '@langquest/contracts';
import { DownloadIndex, isPlayableOffline, recordFromManifest, type DownloadMeta, type DownloadRecord, type DownloadStatus } from './download-index';

export interface DownloadFs {
  /** Root directory URI for packs (created on demand). */
  packRoot(): string;
  ensureDirectory(uri: string): Promise<void>;
  /**
   * Download `url` to `destinationUri`, resuming when possible. Must reject with
   * `DownloadAbortedError` on cancellation and `DownloadHttpError` on non-2xx.
   */
  download(url: string, destinationUri: string, options: { onProgress: (bytesWritten: number, totalBytes: number) => void; signal: AbortSignal; expectedBytes: number }): Promise<void>;
  exists(uri: string): Promise<boolean>;
  size(uri: string): Promise<number | null>;
  /** SHA-256 hex, or null when the file is too large to hash on this device. */
  sha256(uri: string): Promise<string | null>;
  delete(uri: string): Promise<void>;
  deleteDirectory(uri: string): Promise<void>;
  /** Free bytes on the device volume (null when unknown). */
  freeBytes(): Promise<number | null>;
}

export class DownloadAbortedError extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'DownloadAbortedError';
  }
}

export class DownloadHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'DownloadHttpError';
  }
}

export interface DownloadManagerDeps {
  index: DownloadIndex;
  fs: DownloadFs;
  /** `GET /v1/me/audio-download-pack/:lessonId` (fresh signed URLs each call). */
  fetchPack: (lessonId: string) => Promise<DownloadPackManifest>;
  /** Current connectivity class. */
  network: () => Promise<{ online: boolean; wifi: boolean }>;
  /** Learner preference (Account → downloads). */
  wifiOnly: () => boolean;
  now: () => string;
  /** Max concurrent lesson downloads (default 2). */
  concurrency?: number;
  /** Keep this many bytes free on the device (default 200 MB). */
  minFreeBytes?: number;
  onEvent?: (event: DownloadEvent) => void;
}

export type DownloadEvent = { type: 'started' | 'completed' | 'cancelled' | 'paused'; lessonId: string } | { type: 'failed'; lessonId: string; error: string } | { type: 'waiting_wifi'; lessonId: string };

export type DownloadFailureCode = 'offline' | 'wifi_required' | 'rights_blocked' | 'media_unavailable' | 'checksum_mismatch' | 'disk_full' | 'http' | 'unknown';

const joinUri = (root: string, ...parts: string[]): string => [root.replace(/\/+$/, ''), ...parts.map((p) => p.replace(/^\/+/, ''))].join('/');

const MAX_FILE_RETRIES = 3;

export class DownloadManager {
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Set<string>();
  private readonly waiting: string[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly concurrency: number;
  private readonly minFreeBytes: number;

  constructor(private readonly deps: DownloadManagerDeps) {
    this.concurrency = deps.concurrency ?? 2;
    this.minFreeBytes = deps.minFreeBytes ?? 200 * 1024 * 1024;
  }

  /** Notified after every index write (screens re-read the index). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  isActive(lessonId: string): boolean {
    return this.running.has(lessonId) || this.waiting.includes(lessonId);
  }

  /** Queue a lesson for download. Idempotent: an existing complete download is kept. */
  async start(lessonId: string, meta: DownloadMeta): Promise<DownloadRecord | null> {
    const existing = await this.deps.index.get(lessonId);
    if (existing && isPlayableOffline(existing)) return existing;
    if (this.isActive(lessonId)) return existing;
    const now = this.deps.now();
    if (existing) await this.deps.index.update(lessonId, { status: 'queued', error: null, ...meta }, now);
    else {
      // Placeholder record until the pack manifest arrives (so the UI shows "queued" immediately).
      await this.deps.index.put({ ...recordFromManifest({ formatVersion: 1, packId: lessonId, lessonId, collectionId: lessonId, version: 0, checksum: '0'.repeat(64), generatedAt: now, totalBytes: 0, files: [{ assetId: lessonId, kind: 'audio', path: 'pending', contentHash: '0'.repeat(64), byteLength: 0, mimeType: 'audio/mpeg', url: 'https://pending.invalid/', urlExpiresAt: now }], includesTranscript: false, distributionAllowed: true, attributionText: null }, meta, now), files: [] });
    }
    this.notify();
    this.enqueue(lessonId);
    return this.deps.index.get(lessonId);
  }

  private enqueue(lessonId: string): void {
    if (!this.waiting.includes(lessonId)) this.waiting.push(lessonId);
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (this.running.size < this.concurrency && this.waiting.length > 0) {
      const lessonId = this.waiting.shift()!;
      this.running.add(lessonId);
      void this.run(lessonId).finally(() => {
        this.running.delete(lessonId);
        void this.pump();
      });
    }
  }

  /** Cancel an in-flight or queued download and delete partial files. */
  async cancel(lessonId: string): Promise<void> {
    const idx = this.waiting.indexOf(lessonId);
    if (idx >= 0) this.waiting.splice(idx, 1);
    this.controllers.get(lessonId)?.abort();
    await this.deps.index.update(lessonId, { status: 'cancelled' }, this.deps.now());
    await this.deleteFiles(lessonId);
    await this.deps.index.remove(lessonId);
    this.deps.onEvent?.({ type: 'cancelled', lessonId });
    this.notify();
  }

  /** Pause: abort the transfer but keep partial files for resume. */
  async pause(lessonId: string): Promise<void> {
    const idx = this.waiting.indexOf(lessonId);
    if (idx >= 0) this.waiting.splice(idx, 1);
    this.controllers.get(lessonId)?.abort();
    await this.deps.index.update(lessonId, { status: 'paused' }, this.deps.now());
    this.deps.onEvent?.({ type: 'paused', lessonId });
    this.notify();
  }

  async retry(lessonId: string): Promise<void> {
    const record = await this.deps.index.get(lessonId);
    if (!record) return;
    await this.deps.index.update(lessonId, { status: 'queued', error: null, files: record.files.map((f) => (f.state === 'error' ? { ...f, state: 'pending', error: null } : f)) }, this.deps.now());
    this.notify();
    this.enqueue(lessonId);
  }

  /** Delete a download and its files. */
  async remove(lessonId: string): Promise<void> {
    this.controllers.get(lessonId)?.abort();
    await this.deleteFiles(lessonId);
    await this.deps.index.remove(lessonId);
    this.notify();
  }

  /** Re-check downloads that were waiting for Wi-Fi (call on network change). */
  async onNetworkChange(): Promise<void> {
    const records = await this.deps.index.list();
    for (const r of records) if (r.status === 'waiting_wifi' || (r.status === 'downloading' && !this.isActive(r.lessonId))) this.enqueue(r.lessonId);
  }

  /** Resume transfers interrupted by an app restart (status still `downloading`/`queued`). */
  async resumeInterrupted(): Promise<void> {
    const records = await this.deps.index.list();
    for (const r of records) if ((r.status === 'downloading' || r.status === 'queued' || r.status === 'verifying') && !this.isActive(r.lessonId)) this.enqueue(r.lessonId);
  }

  /** Purge downloads whose rights were revoked (pack says distribution is no longer allowed). */
  async purgeRevoked(): Promise<string[]> {
    const purged: string[] = [];
    for (const r of await this.deps.index.list()) {
      if (!r.distributionAllowed) {
        await this.remove(r.lessonId);
        purged.push(r.lessonId);
      }
    }
    return purged;
  }

  private async deleteFiles(lessonId: string): Promise<void> {
    try {
      await this.deps.fs.deleteDirectory(joinUri(this.deps.fs.packRoot(), lessonId));
    } catch {
      /* nothing on disk */
    }
  }

  private async setStatus(lessonId: string, status: DownloadStatus, error: string | null = null): Promise<void> {
    await this.deps.index.update(lessonId, { status, error }, this.deps.now());
    this.notify();
  }

  private async run(lessonId: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(lessonId, controller);
    try {
      const net = await this.deps.network();
      if (!net.online) {
        await this.setStatus(lessonId, 'paused', 'offline');
        return;
      }
      if (this.deps.wifiOnly() && !net.wifi) {
        await this.setStatus(lessonId, 'waiting_wifi', 'wifi_required');
        this.deps.onEvent?.({ type: 'waiting_wifi', lessonId });
        return;
      }
      const existing = await this.deps.index.get(lessonId);
      if (!existing) return;
      let manifest: DownloadPackManifest;
      try {
        manifest = await this.deps.fetchPack(lessonId);
      } catch (error) {
        await this.setStatus(lessonId, 'error', classifyPackError(error));
        this.deps.onEvent?.({ type: 'failed', lessonId, error: classifyPackError(error) });
        return;
      }
      if (!manifest.distributionAllowed) {
        await this.setStatus(lessonId, 'error', 'rights_blocked');
        return;
      }
      // Rebuild the record from the manifest, keeping files already verified for the same hash.
      const meta: DownloadMeta = { title: existing.title, subtitle: existing.subtitle, durationMs: existing.durationMs, artworkUri: existing.artworkUri, courseTrackId: existing.courseTrackId };
      const fresh = recordFromManifest(manifest, meta, this.deps.now(), 'downloading');
      fresh.createdAt = existing.createdAt;
      fresh.files = fresh.files.map((f) => {
        const prev = existing.files.find((p) => p.assetId === f.assetId && p.contentHash === f.contentHash);
        return prev && prev.state === 'done' ? { ...f, state: 'done', localUri: prev.localUri, bytesWritten: prev.byteLength, verifiedBy: prev.verifiedBy } : f;
      });
      await this.deps.index.put(fresh);
      this.notify();
      this.deps.onEvent?.({ type: 'started', lessonId });

      const free = await this.deps.fs.freeBytes();
      const needed = manifest.totalBytes - fresh.files.filter((f) => f.state === 'done').reduce((n, f) => n + f.byteLength, 0);
      if (free !== null && free - needed < this.minFreeBytes) {
        await this.setStatus(lessonId, 'error', 'disk_full');
        this.deps.onEvent?.({ type: 'failed', lessonId, error: 'disk_full' });
        return;
      }

      const dir = joinUri(this.deps.fs.packRoot(), lessonId);
      await this.deps.fs.ensureDirectory(dir);
      for (const file of manifest.files) {
        const current = (await this.deps.index.get(lessonId))?.files.find((f) => f.assetId === file.assetId);
        if (!current || current.state === 'done') continue;
        if (controller.signal.aborted) throw new DownloadAbortedError();
        const dest = joinUri(dir, file.path);
        const ok = await this.downloadFile(lessonId, file, dest, controller.signal);
        if (!ok) return; // status already recorded
      }
      await this.setStatus(lessonId, 'complete');
      this.deps.onEvent?.({ type: 'completed', lessonId });
    } catch (error) {
      if (error instanceof DownloadAbortedError || controller.signal.aborted) {
        // cancel()/pause() already wrote the final status
        return;
      }
      const code: DownloadFailureCode = error instanceof DownloadHttpError ? 'http' : 'unknown';
      await this.setStatus(lessonId, 'error', code);
      this.deps.onEvent?.({ type: 'failed', lessonId, error: code });
    } finally {
      this.controllers.delete(lessonId);
    }
  }

  /** Download + verify one file; returns false when the lesson's download must stop. */
  private async downloadFile(lessonId: string, file: DownloadPackManifest['files'][number], dest: string, signal: AbortSignal): Promise<boolean> {
    let url = file.url;
    let urlExpiresAt = Date.parse(file.urlExpiresAt);
    let lastProgressWrite = 0;
    for (let attempt = 0; attempt <= MAX_FILE_RETRIES; attempt += 1) {
      if (signal.aborted) throw new DownloadAbortedError();
      // Download pack URLs are short-lived (§4.4): refresh the pack when this one is stale.
      if (Date.now() + 30_000 >= urlExpiresAt) {
        const pack = await this.deps.fetchPack(lessonId);
        const refreshed = pack.files.find((f) => f.assetId === file.assetId);
        if (!refreshed) {
          await this.deps.index.updateFile(lessonId, file.assetId, { state: 'error', error: 'media_unavailable' }, this.deps.now());
          await this.setStatus(lessonId, 'error', 'media_unavailable');
          return false;
        }
        url = refreshed.url;
        urlExpiresAt = Date.parse(refreshed.urlExpiresAt);
      }
      await this.deps.index.updateFile(lessonId, file.assetId, { state: 'downloading', localUri: dest, error: null }, this.deps.now());
      this.notify();
      try {
        await this.deps.fs.download(url, dest, {
          expectedBytes: file.byteLength,
          signal,
          onProgress: (bytesWritten) => {
            const t = Date.now();
            if (t - lastProgressWrite < 750) return;
            lastProgressWrite = t;
            void this.deps.index.updateFile(lessonId, file.assetId, { bytesWritten }, this.deps.now()).then(() => this.notify());
          },
        });
      } catch (error) {
        if (error instanceof DownloadAbortedError || signal.aborted) throw new DownloadAbortedError();
        if (error instanceof DownloadHttpError && (error.status === 403 || error.status === 401)) {
          urlExpiresAt = 0; // force a pack refresh on the next attempt
          continue;
        }
        if (attempt < MAX_FILE_RETRIES) continue;
        const code: DownloadFailureCode = error instanceof DownloadHttpError ? 'http' : 'unknown';
        await this.deps.index.updateFile(lessonId, file.assetId, { state: 'error', error: code }, this.deps.now());
        await this.setStatus(lessonId, 'error', code);
        this.deps.onEvent?.({ type: 'failed', lessonId, error: code });
        return false;
      }
      await this.deps.index.updateFile(lessonId, file.assetId, { state: 'verifying', bytesWritten: file.byteLength }, this.deps.now());
      await this.setStatus(lessonId, 'verifying');
      const verdict = await this.verify(dest, file.byteLength, file.contentHash);
      if (verdict === 'mismatch') {
        await this.deps.fs.delete(dest).catch(() => undefined);
        if (attempt < MAX_FILE_RETRIES) continue;
        await this.deps.index.updateFile(lessonId, file.assetId, { state: 'error', error: 'checksum_mismatch', bytesWritten: 0, localUri: null }, this.deps.now());
        await this.setStatus(lessonId, 'error', 'checksum_mismatch');
        this.deps.onEvent?.({ type: 'failed', lessonId, error: 'checksum_mismatch' });
        return false;
      }
      await this.deps.index.updateFile(lessonId, file.assetId, { state: 'done', bytesWritten: file.byteLength, localUri: dest, verifiedBy: verdict }, this.deps.now());
      await this.setStatus(lessonId, 'downloading');
      return true;
    }
    return false;
  }

  private async verify(uri: string, expectedBytes: number, expectedHash: string): Promise<'sha256' | 'length' | 'mismatch'> {
    const size = await this.deps.fs.size(uri);
    if (size === null || size !== expectedBytes) return 'mismatch';
    const hash = await this.deps.fs.sha256(uri);
    if (hash === null) return 'length';
    return hash.toLowerCase() === expectedHash.toLowerCase() ? 'sha256' : 'mismatch';
  }
}

function classifyPackError(error: unknown): DownloadFailureCode {
  const kind = (error as { kind?: string } | null)?.kind;
  if (kind === 'rights_blocked') return 'rights_blocked';
  if (kind === 'capability_unsupported' || kind === 'not_found') return 'media_unavailable';
  if (kind === 'network' || kind === 'timeout') return 'offline';
  return 'unknown';
}
