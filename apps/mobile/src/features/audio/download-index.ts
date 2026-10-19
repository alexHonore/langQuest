/**
 * Durable offline index (§4.4, §4.5): one record per downloaded lesson with
 * every file's checksum, local path and transfer state. Lives in the local
 * document store (SQLite on device) so it survives restarts and is readable
 * in airplane mode. Pure data helpers are exported for unit tests.
 */
import type { DownloadPackManifest } from '@langquest/contracts';
import type { DocumentStore } from '@/store/document-store';

export const DOWNLOADS_COLLECTION = 'audio_downloads';

export type DownloadStatus = 'queued' | 'waiting_wifi' | 'downloading' | 'paused' | 'verifying' | 'complete' | 'error' | 'cancelled';

export interface DownloadFileRecord {
  assetId: string;
  kind: DownloadPackManifest['files'][number]['kind'];
  /** Relative path from the pack manifest. */
  path: string;
  /** Absolute local URI once the file is on disk. */
  localUri: string | null;
  contentHash: string;
  byteLength: number;
  mimeType: string;
  bytesWritten: number;
  state: 'pending' | 'downloading' | 'verifying' | 'done' | 'error';
  /** `sha256` when the hash was computed and matched; `length` when only the byte length could be checked. */
  verifiedBy: 'sha256' | 'length' | null;
  error: string | null;
}

export interface DownloadRecord {
  lessonId: string;
  collectionId: string;
  packId: string;
  version: number;
  /** Manifest checksum (detects server-side pack changes). */
  checksum: string;
  status: DownloadStatus;
  files: DownloadFileRecord[];
  totalBytes: number;
  bytesDownloaded: number;
  error: string | null;
  attributionText: string | null;
  /** From the pack manifest: a revoked lesson must be purged on next sync (§7.6). */
  distributionAllowed: boolean;
  includesTranscript: boolean;
  title: string;
  subtitle: string | null;
  durationMs: number | null;
  artworkUri: string | null;
  courseTrackId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadMeta {
  title: string;
  subtitle: string | null;
  durationMs: number | null;
  artworkUri: string | null;
  courseTrackId: string | null;
}

/** Build a fresh record from a pack manifest (nothing downloaded yet). */
export function recordFromManifest(manifest: DownloadPackManifest, meta: DownloadMeta, now: string, status: DownloadStatus = 'queued'): DownloadRecord {
  return {
    lessonId: manifest.lessonId,
    collectionId: manifest.collectionId,
    packId: manifest.packId,
    version: manifest.version,
    checksum: manifest.checksum,
    status,
    files: manifest.files.map((f) => ({ assetId: f.assetId, kind: f.kind, path: f.path, localUri: null, contentHash: f.contentHash, byteLength: f.byteLength, mimeType: f.mimeType, bytesWritten: 0, state: 'pending', verifiedBy: null, error: null })),
    totalBytes: manifest.totalBytes,
    bytesDownloaded: 0,
    error: null,
    attributionText: manifest.attributionText,
    distributionAllowed: manifest.distributionAllowed,
    includesTranscript: manifest.includesTranscript,
    title: meta.title,
    subtitle: meta.subtitle,
    durationMs: meta.durationMs,
    artworkUri: meta.artworkUri,
    courseTrackId: meta.courseTrackId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Sum of bytes written across files (progress bar source of truth). */
export function bytesDownloaded(record: Pick<DownloadRecord, 'files'>): number {
  return record.files.reduce((n, f) => n + (f.state === 'done' ? f.byteLength : f.bytesWritten), 0);
}

export function downloadFraction(record: Pick<DownloadRecord, 'files' | 'totalBytes'>): number {
  if (record.totalBytes <= 0) return 0;
  return Math.min(1, bytesDownloaded(record) / record.totalBytes);
}

/** A record is playable offline only when every audio file is verified on disk. */
export function isPlayableOffline(record: DownloadRecord | null | undefined): record is DownloadRecord {
  return Boolean(record && record.status === 'complete' && record.distributionAllowed && record.files.filter((f) => f.kind === 'audio').every((f) => f.state === 'done' && f.localUri));
}

/** Preferred local audio file for playback (first audio file in manifest order). */
export function localAudioFile(record: DownloadRecord, assetId?: string | null): DownloadFileRecord | null {
  const audio = record.files.filter((f) => f.kind === 'audio' && f.state === 'done' && f.localUri);
  if (assetId) {
    const exact = audio.find((f) => f.assetId === assetId);
    if (exact) return exact;
  }
  return audio[0] ?? null;
}

export interface StorageSummary {
  lessons: number;
  completeLessons: number;
  bytesOnDisk: number;
  bytesPending: number;
}

/** Bytes of verified files only: a stopped transfer leaves nothing reusable on disk (no resume). */
export function bytesVerified(record: Pick<DownloadRecord, 'files'>): number {
  return record.files.reduce((n, f) => n + (f.state === 'done' ? f.byteLength : 0), 0);
}

export function summarizeStorage(records: readonly DownloadRecord[]): StorageSummary {
  let bytesOnDisk = 0;
  let bytesPending = 0;
  let completeLessons = 0;
  for (const r of records) {
    const done = bytesVerified(r);
    bytesOnDisk += done;
    if (r.status === 'complete') completeLessons += 1;
    else if (r.status !== 'cancelled' && r.status !== 'error') bytesPending += Math.max(0, r.totalBytes - done);
  }
  return { lessons: records.length, completeLessons, bytesOnDisk, bytesPending };
}

export const formatMegabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

export class DownloadIndex {
  constructor(private readonly store: DocumentStore) {}

  get(lessonId: string): Promise<DownloadRecord | null> {
    return this.store.get<DownloadRecord>(DOWNLOADS_COLLECTION, lessonId);
  }

  async list(): Promise<DownloadRecord[]> {
    return (await this.store.list<DownloadRecord>(DOWNLOADS_COLLECTION, { order: 'desc' })).map((d) => d.doc);
  }

  put(record: DownloadRecord): Promise<void> {
    return this.store.put(DOWNLOADS_COLLECTION, record.lessonId, record, Date.parse(record.createdAt));
  }

  /** Apply a partial update (recomputes `bytesDownloaded` and `updatedAt`). */
  async update(lessonId: string, patch: Partial<DownloadRecord> | ((r: DownloadRecord) => Partial<DownloadRecord>), now: string): Promise<DownloadRecord | null> {
    const current = await this.get(lessonId);
    if (!current) return null;
    const p = typeof patch === 'function' ? patch(current) : patch;
    const next: DownloadRecord = { ...current, ...p, updatedAt: now };
    next.bytesDownloaded = bytesDownloaded(next);
    await this.put(next);
    return next;
  }

  async updateFile(lessonId: string, assetId: string, patch: Partial<DownloadFileRecord>, now: string): Promise<DownloadRecord | null> {
    return this.update(lessonId, (r) => ({ files: r.files.map((f) => (f.assetId === assetId ? { ...f, ...patch } : f)) }), now);
  }

  remove(lessonId: string): Promise<void> {
    return this.store.remove(DOWNLOADS_COLLECTION, lessonId);
  }

  async summary(): Promise<StorageSummary> {
    return summarizeStorage(await this.list());
  }
}
