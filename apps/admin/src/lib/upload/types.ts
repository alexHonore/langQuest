/**
 * Upload queue types. `UploadItem` is the in-memory record; `PersistedUpload` is the subset
 * written to IndexedDB so an interrupted multipart upload can resume after a reload (the
 * `File` handle itself cannot be persisted — the user re-selects the file and the engine
 * matches it by name + size + checksum).
 */
import type { AssetKind, UploadCompleteResponse } from '@langquest/contracts';

export const UPLOAD_ITEM_STATES = [
  'queued',
  'hashing',
  'initiating',
  'uploading',
  'completing',
  'verifying',
  'done',
  'duplicate',
  'paused',
  'failed',
  'cancelled',
  'unsupported',
] as const;
export type UploadItemState = (typeof UPLOAD_ITEM_STATES)[number];

export interface CompletedPartRecord {
  etag: string;
  byteLength: number;
}

export interface Id3Preview {
  title: string | null;
  artist: string | null;
  album: string | null;
  track: number | null;
  year: number | null;
  genre: string[];
  durationMs: number | null;
  codec: string | null;
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  hasCover: boolean;
}

export interface PathSuggestion {
  collectionTitle: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
  lessonTitle: string | null;
  lessonOrder: number | null;
  episodeNumber: number | null;
  folders: string[];
}

export interface UploadItem {
  localId: string;
  file: File | null;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  kind: AssetKind;
  state: UploadItemState;
  /** Bytes hashed so far (0..size). */
  hashedBytes: number;
  checksumSha256: string | null;
  /** Per-part SHA-256 (1-based index → hex) once hashed. */
  partHashes: Record<number, string>;
  partSizeBytes: number | null;
  partCount: number;
  uploadId: string | null;
  storageKey: string | null;
  completedParts: Record<number, CompletedPartRecord>;
  /** Bytes sent for parts still in flight (partNumber → bytes). */
  inFlight: Record<number, number>;
  idempotencyKey: string;
  error: string | null;
  duplicateOfAssetId: string | null;
  duplicateOfLocalId: string | null;
  resumed: boolean;
  result: UploadCompleteResponse | null;
  tags: Id3Preview | null;
  suggestion: PathSuggestion | null;
  createdAt: number;
  updatedAt: number;
}

/** Subset persisted between sessions. */
export interface PersistedUpload {
  localId: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  kind: AssetKind;
  checksumSha256: string | null;
  partSizeBytes: number | null;
  partCount: number;
  uploadId: string | null;
  storageKey: string | null;
  completedParts: Record<number, CompletedPartRecord>;
  idempotencyKey: string;
  state: UploadItemState;
  createdAt: number;
  updatedAt: number;
}

export interface QueueSummary {
  total: number;
  byState: Record<UploadItemState, number>;
  bytesTotal: number;
  bytesDone: number;
  /** 0..1 */
  progress: number;
  active: boolean;
}
