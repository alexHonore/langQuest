import { describe, expect, it } from 'vitest';
import { bytesUploaded, findLocalDuplicate, itemProgress, reduceUpload, remainingParts, summarizeQueue } from './machine';
import type { UploadItem } from './types';

const base = (patch: Partial<UploadItem> = {}): UploadItem => ({
  localId: 'a',
  file: null,
  name: 'a.mp3',
  relativePath: 'a.mp3',
  size: 1000,
  mimeType: 'audio/mpeg',
  kind: 'audio',
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
  idempotencyKey: 'up-a',
  error: null,
  duplicateOfAssetId: null,
  duplicateOfLocalId: null,
  resumed: false,
  result: null,
  tags: null,
  suggestion: null,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe('reduceUpload', () => {
  it('walks the happy path and tracks part progress', () => {
    let item = base({ state: 'hashing' });
    item = reduceUpload(item, { type: 'hash_progress', hashedBytes: 500 });
    expect(item.hashedBytes).toBe(500);
    item = reduceUpload(item, { type: 'hashed', checksumSha256: 'x'.repeat(64), partHashes: { 1: 'p' } });
    expect(item.state).toBe('initiating');
    item = reduceUpload(item, { type: 'initiated', uploadId: 'u', storageKey: 'uploads/u/x.mp3', partSizeBytes: 400, partCount: 3, resumed: false, completedPartNumbers: [] });
    expect(item.state).toBe('uploading');
    expect(remainingParts(item)).toEqual([1, 2, 3]);
    item = reduceUpload(item, { type: 'part_progress', partNumber: 1, bytes: 100 });
    expect(bytesUploaded(item)).toBe(100);
    item = reduceUpload(item, { type: 'part_done', partNumber: 1, etag: 'e1', byteLength: 400 });
    expect(bytesUploaded(item)).toBe(400);
    expect(remainingParts(item)).toEqual([2, 3]);
    item = reduceUpload(item, { type: 'completing' });
    item = reduceUpload(item, { type: 'completed', result: { uploadId: 'u', status: 'verified', assetId: null, verifiedChecksumSha256: null, byteLength: 1000, durationMs: null, contentState: 'imported_draft', queuedJobIds: [], failureCode: null } });
    expect(item.state).toBe('done');
    expect(itemProgress(item)).toBe(1);
  });

  it('resume keeps server-completed parts and skips re-hashing', () => {
    let item = base({ state: 'initiating', checksumSha256: 'h'.repeat(64) });
    item = reduceUpload(item, { type: 'initiated', uploadId: 'u', storageKey: 'k', partSizeBytes: 400, partCount: 3, resumed: true, completedPartNumbers: [1, 2] });
    expect(remainingParts(item)).toEqual([3]);
    expect(item.completedParts[3]).toBeUndefined();
    expect(item.completedParts[2]?.byteLength).toBe(400);
    expect(bytesUploaded(item)).toBe(800);
  });

  it('pause/resume/cancel/fail/retry transitions', () => {
    let item = base({ state: 'uploading', inFlight: { 1: 50 } });
    item = reduceUpload(item, { type: 'pause' });
    expect(item.state).toBe('paused');
    expect(item.inFlight).toEqual({});
    item = reduceUpload(item, { type: 'resume' });
    expect(item.state).toBe('queued');
    item = reduceUpload(item, { type: 'fail', message: 'boom' });
    expect(item.state).toBe('failed');
    item = reduceUpload(item, { type: 'retry' });
    expect(item.state).toBe('queued');
    expect(item.error).toBeNull();
    item = reduceUpload(item, { type: 'cancel' });
    expect(item.state).toBe('cancelled');
    expect(reduceUpload(item, { type: 'fail', message: 'late' }).state).toBe('cancelled');
    const done = base({ state: 'done' });
    expect(reduceUpload(done, { type: 'cancel' })).toBe(done);
  });

  it('summarizes the queue and finds local duplicates', () => {
    const a = base({ localId: 'a', checksumSha256: 'same', state: 'done', createdAt: 1 });
    const b = base({ localId: 'b', checksumSha256: 'same', state: 'initiating', createdAt: 2 });
    const c = base({ localId: 'c', checksumSha256: 'other', state: 'queued', createdAt: 3 });
    expect(findLocalDuplicate([a, b, c], b)?.localId).toBe('a');
    expect(findLocalDuplicate([a, b, c], a)).toBeNull();
    const summary = summarizeQueue([a, b, c]);
    expect(summary.total).toBe(3);
    expect(summary.byState.done).toBe(1);
    expect(summary.bytesTotal).toBe(3000);
    expect(summary.active).toBe(true);
  });
});
