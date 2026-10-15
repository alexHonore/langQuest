/**
 * Pure state machine for one upload item plus queue-level selectors. The engine applies
 * events through `reduceUpload`; the UI renders from the resulting items. Keeping the
 * transitions here (no I/O) makes resume/pause/cancel semantics unit-testable.
 */
import type { UploadCompleteResponse } from '@langquest/contracts';
import { UPLOAD_ITEM_STATES, type CompletedPartRecord, type QueueSummary, type UploadItem, type UploadItemState } from './types';

export type UploadEvent =
  | { type: 'hash_progress'; hashedBytes: number }
  | { type: 'hashed'; checksumSha256: string; partHashes: Record<number, string> }
  | { type: 'initiating' }
  | { type: 'initiated'; uploadId: string; storageKey: string; partSizeBytes: number; partCount: number; resumed: boolean; completedPartNumbers: number[] }
  | { type: 'duplicate'; assetId: string | null; localId: string | null }
  | { type: 'part_progress'; partNumber: number; bytes: number }
  | { type: 'part_done'; partNumber: number; etag: string; byteLength: number }
  | { type: 'completing' }
  | { type: 'verifying' }
  | { type: 'completed'; result: UploadCompleteResponse }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'fail'; message: string }
  | { type: 'retry' }
  | { type: 'unsupported'; message: string };

export const TERMINAL_ITEM_STATES: readonly UploadItemState[] = ['done', 'duplicate', 'cancelled', 'unsupported'];
export const ACTIVE_ITEM_STATES: readonly UploadItemState[] = ['hashing', 'initiating', 'uploading', 'completing', 'verifying'];

export const isTerminal = (state: UploadItemState) => TERMINAL_ITEM_STATES.includes(state);
export const isActive = (state: UploadItemState) => ACTIVE_ITEM_STATES.includes(state);
/** Items the scheduler may pick up. */
export const isSchedulable = (item: UploadItem) => item.state === 'queued' && item.file !== null;

const touch = (item: UploadItem, patch: Partial<UploadItem>): UploadItem => ({ ...item, ...patch, updatedAt: Date.now() });

/** Apply one event; invalid transitions return the item unchanged (never throw mid-upload). */
export function reduceUpload(item: UploadItem, event: UploadEvent): UploadItem {
  switch (event.type) {
    case 'hash_progress':
      return item.state === 'hashing' ? touch(item, { hashedBytes: Math.min(event.hashedBytes, item.size) }) : item;
    case 'hashed':
      return item.state === 'hashing' || item.state === 'queued'
        ? touch(item, { checksumSha256: event.checksumSha256, partHashes: event.partHashes, hashedBytes: item.size, state: 'initiating' })
        : item;
    case 'initiating':
      return item.state === 'queued' || item.state === 'hashing' ? touch(item, { state: 'initiating' }) : item;
    case 'initiated': {
      if (item.state !== 'initiating' && item.state !== 'queued') return item;
      const completedParts: Record<number, CompletedPartRecord> = { ...item.completedParts };
      for (const n of event.completedPartNumbers) {
        if (!completedParts[n]) completedParts[n] = { etag: 'server', byteLength: partLength(event.partSizeBytes, event.partCount, item.size, n) };
      }
      return touch(item, {
        uploadId: event.uploadId,
        storageKey: event.storageKey,
        partSizeBytes: event.partSizeBytes,
        partCount: event.partCount,
        resumed: event.resumed || item.resumed,
        completedParts,
        inFlight: {},
        state: 'uploading',
        error: null,
      });
    }
    case 'duplicate':
      return touch(item, { state: 'duplicate', duplicateOfAssetId: event.assetId, duplicateOfLocalId: event.localId, inFlight: {} });
    case 'part_progress':
      return item.state === 'uploading' ? touch(item, { inFlight: { ...item.inFlight, [event.partNumber]: event.bytes } }) : item;
    case 'part_done': {
      if (item.state !== 'uploading') return item;
      const inFlight = { ...item.inFlight };
      delete inFlight[event.partNumber];
      return touch(item, {
        completedParts: { ...item.completedParts, [event.partNumber]: { etag: event.etag, byteLength: event.byteLength } },
        inFlight,
      });
    }
    case 'completing':
      return item.state === 'uploading' ? touch(item, { state: 'completing', inFlight: {} }) : item;
    case 'verifying':
      return item.state === 'completing' ? touch(item, { state: 'verifying' }) : item;
    case 'completed':
      return item.state === 'completing' || item.state === 'verifying' || item.state === 'uploading'
        ? touch(item, { state: event.result.status === 'failed' ? 'failed' : 'done', result: event.result, error: event.result.failureCode, inFlight: {} })
        : item;
    case 'pause':
      return isActive(item.state) || item.state === 'queued' ? touch(item, { state: 'paused', inFlight: {} }) : item;
    case 'resume':
      return item.state === 'paused' || item.state === 'failed' ? touch(item, { state: 'queued', error: null, inFlight: {} }) : item;
    case 'retry':
      return item.state === 'failed' || item.state === 'cancelled' ? touch(item, { state: 'queued', error: null, inFlight: {}, hashedBytes: item.checksumSha256 ? item.size : 0 }) : item;
    case 'cancel':
      return isTerminal(item.state) && item.state !== 'cancelled' ? item : touch(item, { state: 'cancelled', inFlight: {} });
    case 'fail':
      return isTerminal(item.state) ? item : touch(item, { state: 'failed', error: event.message, inFlight: {} });
    case 'unsupported':
      return touch(item, { state: 'unsupported', error: event.message });
    default:
      return item;
  }
}

/** Length of part `n` (1-based) given the plan. */
export function partLength(partSizeBytes: number, partCount: number, size: number, n: number): number {
  if (n < partCount) return partSizeBytes;
  return size - partSizeBytes * (partCount - 1);
}

/** Part numbers not yet completed, ascending. */
export function remainingParts(item: UploadItem): number[] {
  const out: number[] = [];
  for (let n = 1; n <= item.partCount; n++) if (!item.completedParts[n]) out.push(n);
  return out;
}

/** Bytes uploaded = completed parts + in-flight progress. */
export function bytesUploaded(item: UploadItem): number {
  if (item.state === 'done' || item.state === 'duplicate') return item.size;
  let total = 0;
  for (const part of Object.values(item.completedParts)) total += part.byteLength;
  for (const bytes of Object.values(item.inFlight)) total += bytes;
  return Math.min(total, item.size);
}

/** 0..1 progress combining hashing (weight 0.1) and upload (0.9). */
export function itemProgress(item: UploadItem): number {
  if (item.size === 0) return item.state === 'done' ? 1 : 0;
  if (item.state === 'done' || item.state === 'duplicate') return 1;
  const hashPart = (item.checksumSha256 ? item.size : item.hashedBytes) / item.size;
  const uploadPart = bytesUploaded(item) / item.size;
  return Math.min(1, hashPart * 0.1 + uploadPart * 0.9);
}

export function summarizeQueue(items: readonly UploadItem[]): QueueSummary {
  const byState = Object.fromEntries(UPLOAD_ITEM_STATES.map((s) => [s, 0])) as Record<UploadItemState, number>;
  let bytesTotal = 0;
  let bytesDone = 0;
  let weighted = 0;
  for (const item of items) {
    byState[item.state] += 1;
    bytesTotal += item.size;
    bytesDone += bytesUploaded(item);
    weighted += itemProgress(item) * item.size;
  }
  const progress = bytesTotal === 0 ? (items.length === 0 ? 0 : 1) : weighted / bytesTotal;
  const active = items.some((i) => isActive(i.state) || i.state === 'queued');
  return { total: items.length, byState, bytesTotal, bytesDone, progress, active };
}

/** Find an earlier queue item with the same checksum (local duplicate detection). */
export function findLocalDuplicate(items: readonly UploadItem[], item: UploadItem): UploadItem | null {
  if (!item.checksumSha256) return null;
  return items.find((other) => other.localId !== item.localId && other.checksumSha256 === item.checksumSha256 && other.createdAt <= item.createdAt && other.state !== 'cancelled' && other.state !== 'failed') ?? null;
}
