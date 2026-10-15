import { describe, expect, it } from 'vitest';
import type { UploadInitiateRequest } from '@langquest/contracts';
import { abortUpload, canTransitionUpload, completeUpload, decideDedupe, expireUpload, fromUploadRow, initiateUpload, planOrphanCleanup, planParts, recordCompletedPart, signParts, toUploadRow, UPLOAD_LIMITS, validateInitiateRequest, verifyUpload, type UploadSession } from './uploads';

const MiB = 1024 * 1024;
const UPLOAD_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const HASH = 'c'.repeat(64);
const NOW = new Date('2026-10-14T10:00:00Z');

const baseRequest: UploadInitiateRequest = {
  filename: '03 - Lesson 3.mp3',
  relativePath: 'Pimsleur FR/Unit 2/03 - Lesson 3.mp3',
  contentType: 'audio/mpeg',
  byteLength: 40 * MiB + 123,
  clientChecksumSha256: HASH,
  idempotencyKey: 'client-key-0001',
  partSizeBytes: 16 * MiB,
  kind: 'audio',
};

function created(req: UploadInitiateRequest = baseRequest): UploadSession {
  const r = initiateUpload(req, { uploadId: UPLOAD_ID, assetId: ASSET_ID, userId: USER_ID, now: NOW });
  if (r.outcome !== 'created') throw new Error(`expected created, got ${r.outcome}`);
  return r.session;
}

function partsFor(session: UploadSession) {
  return Array.from({ length: session.partCount }, (_, i) => {
    const n = i + 1;
    const byteLength = n === session.partCount ? session.declaredByteLength - session.partSizeBytes * (session.partCount - 1) : session.partSizeBytes;
    return { partNumber: n, etag: `"etag-${n}"`, byteLength };
  });
}

describe('planParts', () => {
  it('splits by requested part size and allows a single small part', () => {
    expect(planParts(40 * MiB + 123, 16 * MiB)).toEqual({ partSizeBytes: 16 * MiB, partCount: 3 });
    expect(planParts(1000)).toEqual({ partSizeBytes: UPLOAD_LIMITS.defaultPartBytes, partCount: 1 });
    expect(() => planParts(1000, 1024)).toThrow(/between/);
  });
  it('grows the part size when the count would exceed the limit', () => {
    const plan = planParts(60 * 1024 * MiB, 5 * MiB);
    expect(plan.partCount).toBeLessThanOrEqual(UPLOAD_LIMITS.maxParts);
    expect(plan.partSizeBytes).toBeGreaterThan(5 * MiB);
  });
});

describe('initiate', () => {
  it('creates a session with a content-addressed key and legacy path kept separately', () => {
    const s = created();
    expect(s.status).toBe('initiated');
    expect(s.storageKey).toBe(`media/${ASSET_ID}/${HASH}.mp3`);
    expect(s.storageKey).not.toContain('Lesson');
    expect(s.originalFilename).toBe('03 - Lesson 3.mp3');
    expect(s.originalPath).toBe('Pimsleur FR/Unit 2/03 - Lesson 3.mp3');
    expect(s.partCount).toBe(3);
    expect(Date.parse(s.expiresAt) - NOW.getTime()).toBe(UPLOAD_LIMITS.sessionTtlMs);
  });

  it('enforces MIME allow-list, size caps and path safety', () => {
    expect(validateInitiateRequest({ ...baseRequest, contentType: 'application/x-msdownload' as never })).toMatchObject({ ok: false, failureCode: 'mime_not_allowed' });
    expect(validateInitiateRequest({ ...baseRequest, contentType: 'image/png', kind: 'image', byteLength: 100 * MiB })).toMatchObject({ ok: false, failureCode: 'file_too_large' });
    expect(validateInitiateRequest({ ...baseRequest, contentType: 'image/png', kind: 'audio' })).toMatchObject({ ok: false, failureCode: 'mime_not_allowed' });
    expect(validateInitiateRequest({ ...baseRequest, byteLength: 0 })).toMatchObject({ ok: false, failureCode: 'file_empty' });
    expect(validateInitiateRequest({ ...baseRequest, relativePath: '../../x.mp3' })).toMatchObject({ ok: false, failureCode: 'invalid_path' });
    expect(validateInitiateRequest({ ...baseRequest, byteLength: 9 * 1024 * MiB })).toMatchObject({ ok: false, failureCode: 'file_too_large' });
    expect(validateInitiateRequest(baseRequest)).toEqual({ ok: true });
  });

  it('resumes idempotently and rejects key reuse with a different payload (A18)', () => {
    const s = created();
    const uploading = signParts(s, [1, 2], NOW);
    expect(uploading.ok).toBe(true);
    const withPart = recordCompletedPart(uploading.session, { partNumber: 1, etag: '"e1"', byteLength: 16 * MiB }, NOW);
    expect(withPart.ok).toBe(true);
    const resumed = initiateUpload(baseRequest, { uploadId: 'ignored', assetId: 'ignored', userId: USER_ID, now: new Date(NOW.getTime() + 60_000), existing: withPart.session });
    expect(resumed.outcome).toBe('resumed');
    if (resumed.outcome === 'resumed') {
      expect(resumed.completedPartNumbers).toEqual([1]);
      expect(resumed.session.uploadId).toBe(UPLOAD_ID);
    }
    const conflict = initiateUpload({ ...baseRequest, byteLength: baseRequest.byteLength + 1 }, { uploadId: 'x', assetId: 'y', userId: USER_ID, now: NOW, existing: withPart.session });
    expect(conflict).toMatchObject({ outcome: 'rejected', failureCode: 'idempotency_conflict' });
    const expiredExisting = { ...withPart.session, expiresAt: new Date(NOW.getTime() - 1).toISOString() };
    const fresh = initiateUpload(baseRequest, { uploadId: '44444444-4444-4444-8444-444444444444', assetId: '55555555-5555-4555-8555-555555555555', userId: USER_ID, now: NOW, existing: expiredExisting });
    expect(fresh.outcome).toBe('created');
  });
});

describe('state machine', () => {
  it('follows initiated → uploading → completed → verified', () => {
    const s = created();
    const signed = signParts(s, [1, 2, 3], NOW);
    expect(signed.ok && signed.session.status).toBe('uploading');
    let session = signed.session;
    for (const p of partsFor(session)) {
      const r = recordCompletedPart(session, p, NOW);
      expect(r.ok).toBe(true);
      session = r.session;
    }
    const complete = completeUpload(session, { parts: partsFor(session), clientChecksumSha256: HASH }, { byteLength: session.declaredByteLength, head: new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }, NOW);
    expect(complete.ok).toBe(true);
    expect(complete.session.status).toBe('completed');
    const verified = verifyUpload(complete.session, { serverChecksumSha256: HASH.toUpperCase(), sniffedMimeType: 'audio/mpeg' }, NOW);
    expect(verified.ok).toBe(true);
    expect(verified.session.status).toBe('verified');
    expect(verified.session.verifiedChecksumSha256).toBe(HASH);
    if (verified.ok) expect(verified.contentState).toBe('imported_draft');
    expect(abortUpload(verified.session, NOW).status).toBe('verified');
  });

  it('rejects bad completions with structured failure codes', () => {
    const s = created();
    const parts = partsFor(s);
    expect(completeUpload(s, { parts: parts.slice(0, 2), clientChecksumSha256: HASH }, { byteLength: s.declaredByteLength }, NOW)).toMatchObject({ ok: false, failureCode: 'part_count_mismatch', session: { status: 'failed' } });
    expect(completeUpload(s, { parts, clientChecksumSha256: 'd'.repeat(64) }, { byteLength: s.declaredByteLength }, NOW)).toMatchObject({ ok: false, failureCode: 'checksum_mismatch' });
    expect(completeUpload(s, { parts: parts.map((p) => (p.partNumber === 2 ? { ...p, byteLength: 1 } : p)), clientChecksumSha256: HASH }, { byteLength: s.declaredByteLength }, NOW)).toMatchObject({ ok: false, failureCode: 'part_size_mismatch' });
    expect(completeUpload(s, { parts, clientChecksumSha256: HASH }, { byteLength: s.declaredByteLength + 5 }, NOW)).toMatchObject({ ok: false, failureCode: 'byte_length_mismatch' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(completeUpload(s, { parts, clientChecksumSha256: HASH }, { byteLength: s.declaredByteLength, head: png }, NOW)).toMatchObject({ ok: false, failureCode: 'content_type_mismatch' });
    const recorded = recordCompletedPart(s, { partNumber: 1, etag: '"real"', byteLength: 16 * MiB }, NOW).session;
    expect(completeUpload(recorded, { parts: parts.map((p) => (p.partNumber === 1 ? { ...p, etag: '"forged"' } : p)), clientChecksumSha256: HASH }, { byteLength: s.declaredByteLength }, NOW)).toMatchObject({ ok: false, failureCode: 'etag_mismatch' });
  });

  it('fails verification on server checksum or container mismatch', () => {
    const s = created();
    const completed = completeUpload(s, { parts: partsFor(s), clientChecksumSha256: HASH }, { byteLength: s.declaredByteLength }, NOW).session;
    expect(verifyUpload(completed, { serverChecksumSha256: 'e'.repeat(64), sniffedMimeType: 'audio/mpeg' }, NOW)).toMatchObject({ ok: false, failureCode: 'checksum_mismatch', session: { status: 'failed' } });
    expect(verifyUpload(completed, { serverChecksumSha256: HASH, sniffedMimeType: 'image/png' }, NOW)).toMatchObject({ ok: false, failureCode: 'content_type_mismatch' });
    expect(verifyUpload(s, { serverChecksumSha256: HASH, sniffedMimeType: null }, NOW)).toMatchObject({ ok: false, failureCode: 'invalid_state' });
  });

  it('handles expiry, abort and illegal transitions', () => {
    const s = created();
    const later = new Date(NOW.getTime() + UPLOAD_LIMITS.sessionTtlMs + 1);
    expect(signParts(s, [1], later)).toMatchObject({ ok: false, failureCode: 'expired', session: { status: 'expired' } });
    expect(signParts(s, [0], NOW)).toMatchObject({ ok: false, failureCode: 'unknown_part' });
    expect(signParts(s, [4], NOW)).toMatchObject({ ok: false, failureCode: 'unknown_part' });
    expect(abortUpload(s, NOW).status).toBe('aborted');
    expect(expireUpload(abortUpload(s, NOW), NOW).status).toBe('aborted');
    expect(canTransitionUpload('verified', 'failed')).toBe(false);
    expect(canTransitionUpload('completed', 'verified')).toBe(true);
    expect(canTransitionUpload('initiated', 'verified')).toBe(false);
  });

  it('round-trips through the uploads row shape', () => {
    const s = recordCompletedPart(created(), { partNumber: 1, etag: '"e1"', byteLength: 16 * MiB }, NOW).session;
    const row = toUploadRow(s);
    expect(row.completed_parts).toEqual([{ part_number: 1, etag: '"e1"', byte_length: 16 * MiB }]);
    const back = fromUploadRow({ ...row, created_at: s.createdAt, updated_at: s.updatedAt }, { kind: 'audio', fingerprint: s.fingerprint });
    expect(back).toEqual(s);
  });
});

describe('orphan cleanup', () => {
  it('plans expiry/abort/delete actions and never touches verified uploads', () => {
    const s = created();
    const uploading = { ...signParts(s, [1], NOW).session, multipartUploadId: 'r2-mpu-1' };
    const late = new Date(NOW.getTime() + UPLOAD_LIMITS.sessionTtlMs + 1000);
    const failed = { ...s, status: 'failed' as const, updatedAt: new Date(NOW.getTime() - 7 * 3600_000).toISOString() };
    const completedStale = { ...s, status: 'completed' as const, updatedAt: new Date(NOW.getTime() - 13 * 3600_000).toISOString() };
    const completedFresh = { ...s, status: 'completed' as const, uploadId: 'fresh', updatedAt: new Date(NOW.getTime() + UPLOAD_LIMITS.sessionTtlMs - 3600_000).toISOString() };
    const verified = { ...s, status: 'verified' as const, uploadId: 'v' };
    const actions = planOrphanCleanup([uploading, failed, completedStale, completedFresh, verified], late);
    expect(actions).toEqual(expect.arrayContaining([
      { uploadId: UPLOAD_ID, action: 'expire_session' },
      { uploadId: UPLOAD_ID, action: 'abort_multipart', multipartUploadId: 'r2-mpu-1', storageKey: s.storageKey },
      { uploadId: UPLOAD_ID, action: 'delete_object', storageKey: s.storageKey },
      { uploadId: UPLOAD_ID, action: 'fail_unverified' },
      { uploadId: 'fresh', action: 'requeue_verify' },
    ]));
    expect(actions.some((a) => a.uploadId === 'v')).toBe(false);
  });
});

describe('dedupe', () => {
  const existing = { assetId: ASSET_ID, checksumSha256: HASH, storageKey: `media/${ASSET_ID}/${HASH}.mp3`, contentRightsId: 'rights-1', ownerId: USER_ID, disposition: 'active' as const, state: 'published' as const };
  it('creates a new blob when nothing matches', () => {
    expect(decideDedupe({ incomingChecksumSha256: 'f'.repeat(64), incomingContentRightsId: null, incomingOwnerId: USER_ID, existing: [existing] }).decision).toBe('new_blob');
  });
  it('links the physical blob but keeps logical assets separate when rights differ', () => {
    const d = decideDedupe({ incomingChecksumSha256: HASH, incomingContentRightsId: 'rights-2', incomingOwnerId: USER_ID, existing: [existing], allowReuse: true });
    expect(d).toMatchObject({ decision: 'link_existing_blob', duplicateOfAssetId: ASSET_ID, storageKey: existing.storageKey });
    expect(d.reason).toMatch(/distinct rights/);
  });
  it('reuses the logical asset only with identical rights/owner and explicit opt-in', () => {
    expect(decideDedupe({ incomingChecksumSha256: HASH, incomingContentRightsId: 'rights-1', incomingOwnerId: USER_ID, existing: [existing] }).decision).toBe('link_existing_blob');
    expect(decideDedupe({ incomingChecksumSha256: HASH, incomingContentRightsId: 'rights-1', incomingOwnerId: USER_ID, existing: [existing], allowReuse: true }).decision).toBe('reuse_asset');
    expect(decideDedupe({ incomingChecksumSha256: HASH, incomingContentRightsId: 'rights-1', incomingOwnerId: 'other-user', existing: [existing], allowReuse: true }).decision).toBe('link_existing_blob');
  });
  it('blocks re-uploads of revoked content', () => {
    expect(decideDedupe({ incomingChecksumSha256: HASH, incomingContentRightsId: null, incomingOwnerId: USER_ID, existing: [{ ...existing, disposition: 'revoked' }] })).toMatchObject({ decision: 'blocked', duplicateOfAssetId: ASSET_ID });
    expect(decideDedupe({ incomingChecksumSha256: HASH, incomingContentRightsId: null, incomingOwnerId: USER_ID, existing: [{ ...existing, disposition: 'deleted' }] }).decision).toBe('new_blob');
  });
});
