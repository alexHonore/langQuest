import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMasterKey, buildUploadStagingKey, sha256HexSync } from '@langquest/media';
import { JobFailure } from '../queue/types';
import { createTestServices, makeToneFixture, runHandler, type TestServices } from '../test-support/fakes';
import { inspectAssetHandler } from './inspect-asset';

describe('inspect_asset', () => {
  let t: TestServices;
  beforeEach(async () => {
    t = await createTestServices();
  });
  afterEach(() => t.cleanup());

  async function stageUpload(format: 'wav' | 'mp3' = 'mp3') {
    const path = await makeToneFixture(t.ffmpeg, t.root, { seconds: 2, format });
    const bytes = new Uint8Array(await readFile(path));
    const checksum = sha256HexSync(bytes);
    const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const uploadId = crypto.randomUUID();
    const stagingKey = buildUploadStagingKey({ uploadId, clientChecksumSha256: checksum, mimeType: mime });
    await t.store.put(stagingKey, bytes, { contentType: mime });
    const assetId = crypto.randomUUID();
    const asset = t.db.seedAsset({ id: assetId, storage_key: buildMasterKey({ assetId, contentHash: checksum, mimeType: mime }), checksum_sha256: checksum, mime_type: mime, byte_length: bytes.byteLength });
    const upload = t.db.seedUpload({ id: uploadId, draft_asset_id: assetId, storage_key: stagingKey, client_checksum_sha256: checksum, declared_byte_length: bytes.byteLength, declared_mime_type: mime });
    return { asset, upload, checksum, stagingKey, bytes };
  }

  it('verifies, extracts metadata, promotes the object to its master key and emits asset.verified', async () => {
    const { asset, upload, checksum, stagingKey } = await stageUpload('mp3');
    const { result, events } = await runHandler(inspectAssetHandler, t, {}, { job_type: 'verify', parent_asset_id: asset.id });
    const out = result.output as Record<string, unknown>;
    expect(out.verified).toBe(true);
    expect(out.checksumSha256).toBe(checksum);
    expect(out.promotedFrom).toBe(stagingKey);
    const updated = (await t.db.getAsset(asset.id))!;
    expect(updated.storage_key).toBe(asset.storage_key);
    expect(updated.duration_ms).toBeGreaterThan(1500);
    expect(updated.duration_ms).toBeLessThan(2600);
    expect(updated.channels).toBe(1);
    expect(await t.store.head(updated.storage_key)).not.toBeNull();
    expect(await t.store.head(stagingKey)).toBeNull();
    const up = (await t.db.getUpload(upload.id))!;
    expect(up.status).toBe('verified');
    expect(up.verified_checksum_sha256).toBe(checksum);
    expect(up.storage_key).toBe(updated.storage_key);
    expect(events.map((e) => e.type)).toContain('asset.verified');
    const prov = [...t.db.tables.asset_provenance_events.values()];
    expect(prov[0]?.event_type).toBe('uploaded');
    expect(result.outputAssetIds).toEqual([asset.id]);
  });

  it('quarantines the asset and fails the upload on checksum mismatch (no retry)', async () => {
    const { asset, upload } = await stageUpload('wav');
    await t.db.updateUpload(upload.id, { client_checksum_sha256: 'a'.repeat(64) });
    await expect(runHandler(inspectAssetHandler, t, {}, { job_type: 'verify', parent_asset_id: asset.id })).rejects.toMatchObject({ code: 'checksum_mismatch', retry: false });
    expect((await t.db.getAsset(asset.id))!.disposition).toBe('quarantined');
    expect((await t.db.getUpload(upload.id))!.status).toBe('failed');
  });

  it('rejects content-type spoofing', async () => {
    const { asset, upload } = await stageUpload('wav');
    await t.db.updateAsset(asset.id, { mime_type: 'audio/mpeg' });
    await t.db.updateUpload(upload.id, { declared_mime_type: 'audio/mpeg' });
    await expect(runHandler(inspectAssetHandler, t, {}, { job_type: 'verify', parent_asset_id: asset.id })).rejects.toBeInstanceOf(JobFailure);
    expect((await t.db.getAsset(asset.id))!.disposition).toBe('quarantined');
  });

  it('retries later when the object does not exist yet, and refreshes metadata for extract_metadata without an event', async () => {
    const { asset, stagingKey } = await stageUpload('mp3');
    await t.store.delete(stagingKey);
    await expect(runHandler(inspectAssetHandler, t, {}, { job_type: 'verify', parent_asset_id: asset.id })).rejects.toMatchObject({ code: 'object_missing', retry: true });
    // Put the object at its master key directly and run a metadata refresh.
    const bytes = await readFile(await makeToneFixture(t.ffmpeg, t.root, { seconds: 2, format: 'mp3', name: 'again.mp3' }));
    const checksum = sha256HexSync(new Uint8Array(bytes));
    const id = crypto.randomUUID();
    const key = buildMasterKey({ assetId: id, contentHash: checksum, mimeType: 'audio/mpeg' });
    await t.store.put(key, new Uint8Array(bytes), { contentType: 'audio/mpeg' });
    t.db.seedAsset({ id, storage_key: key, checksum_sha256: checksum, mime_type: 'audio/mpeg', byte_length: bytes.byteLength });
    const before = t.services.events.emitted.length;
    const { result } = await runHandler(inspectAssetHandler, t, {}, { job_type: 'extract_metadata', parent_asset_id: id });
    expect((result.output as Record<string, unknown>).promotedFrom).toBeNull();
    expect(t.services.events.emitted.length).toBe(before);
    expect((await t.db.getAsset(id))!.sample_rate_hz).toBe(44100);
  });
});
