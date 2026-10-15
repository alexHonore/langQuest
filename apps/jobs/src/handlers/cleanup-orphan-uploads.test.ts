import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildUploadStagingKey } from '@langquest/media';
import { createTestServices, runHandler, type TestServices } from '../test-support/fakes';
import { cleanupOrphanUploadsHandler } from './cleanup-orphan-uploads';

describe('cleanup_orphan_uploads', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  it('expires stale sessions, aborts multipart, deletes old failed objects, requeues unverified completes and leaves verified alone', async () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const hash = (c: string) => c.repeat(64);
    const stale = t.db.seedUpload({ status: 'uploading', storage_key: buildUploadStagingKey({ uploadId: crypto.randomUUID(), clientChecksumSha256: hash('1'), ext: 'mp3' }), client_checksum_sha256: hash('1'), declared_byte_length: 10, declared_mime_type: 'audio/mpeg', expires_at: old, updated_at: old, multipart_upload_id: 'mp-1' });
    const failedKey = buildUploadStagingKey({ uploadId: crypto.randomUUID(), clientChecksumSha256: hash('2'), ext: 'mp3' });
    await t.store.put(failedKey, 'junk');
    const failed = t.db.seedUpload({ status: 'failed', storage_key: failedKey, client_checksum_sha256: hash('2'), declared_byte_length: 10, declared_mime_type: 'audio/mpeg', updated_at: old });
    const assetId = crypto.randomUUID();
    const completed = t.db.seedUpload({ status: 'completed', draft_asset_id: assetId, storage_key: buildUploadStagingKey({ uploadId: crypto.randomUUID(), clientChecksumSha256: hash('3'), ext: 'mp3' }), client_checksum_sha256: hash('3'), declared_byte_length: 10, declared_mime_type: 'audio/mpeg' });
    const verified = t.db.seedUpload({ status: 'verified', verified_checksum_sha256: hash('4'), storage_key: buildUploadStagingKey({ uploadId: crypto.randomUUID(), clientChecksumSha256: hash('4'), ext: 'mp3' }), client_checksum_sha256: hash('4'), declared_byte_length: 10, declared_mime_type: 'audio/mpeg', updated_at: old });

    const dry = await runHandler(cleanupOrphanUploadsHandler, t, { dryRun: true }, { job_type: 'describe' });
    expect((dry.result.output as Record<string, unknown>).counts).toEqual({ expire_session: 1, abort_multipart: 1, delete_object: 1, requeue_verify: 1, fail_unverified: 0 });
    expect((await t.db.getUpload(stale.id))!.status).toBe('uploading');

    const { result } = await runHandler(cleanupOrphanUploadsHandler, t, {}, { job_type: 'describe' });
    expect((result.output as Record<string, unknown>).failures).toEqual([]);
    expect((await t.db.getUpload(stale.id))!.status).toBe('expired');
    expect((await t.db.getUpload(stale.id))!.multipart_upload_id).toBeNull();
    expect(await t.store.head(failedKey)).toBeNull();
    expect((await t.db.getUpload(failed.id))!.status).toBe('failed');
    expect((await t.db.getUpload(verified.id))!.status).toBe('verified');
    const jobs = [...t.db.tables.processing_jobs.values()];
    expect(jobs.length).toBe(1);
    expect(jobs[0]).toMatchObject({ job_type: 'verify', parent_asset_id: assetId, params: { uploadId: completed.id, assetId } });
  });
});
