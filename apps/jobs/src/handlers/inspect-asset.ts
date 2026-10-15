/**
 * `inspect_asset` — serves job types `verify` (post-upload) and `extract_metadata` (refresh).
 *
 * verify (§7.2 "commit checksum → verify MIME/size/duration → create draft asset"):
 *   download the blob (staging key from the upload session, or the asset's own key) → SHA-256 while
 *   streaming → sniff + ID3/container metadata with `@langquest/media` → compare against the upload record
 *   and the `media_assets` row → promote the object to its hashed master key (`media/{id}/{sha}.{ext}`),
 *   never a filename → update `media_assets` + `uploads` → provenance → emit `asset.verified`.
 *   Mismatches quarantine the asset (never silently merged, never published).
 */
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { ContentStateSchema } from '@langquest/contracts';
import { ContentTypeMismatchError, buildMasterKey, extractAudioMetadata, parseObjectKey, type AudioMetadata } from '@langquest/media';
import type { MediaAssetRow, UploadRow } from '../db';
import { JobFailure, type JobHandler } from '../queue/types';
import { downloadToWorkDir, hashFile, masterFilename, requireAsset } from './common';

export const InspectAssetParamsSchema = z.object({
  assetId: z.string().uuid().optional(),
  uploadId: z.string().uuid().optional(),
  /** Force the `asset.verified` event even for `extract_metadata` jobs. */
  emitEvent: z.boolean().optional(),
});
export type InspectAssetParams = z.infer<typeof InspectAssetParamsSchema>;

export interface InspectAssetOutput extends Record<string, unknown> {
  assetId: string;
  verified: boolean;
  checksumSha256: string;
  byteLength: number;
  mimeType: string;
  storageKey: string;
  promotedFrom: string | null;
  duplicateOfAssetId: string | null;
  metadata: AudioMetadata | null;
  probe: { durationMs: number | null; codec: string | null; bitrateKbps: number | null } | null;
}

export const inspectAssetHandler: JobHandler<InspectAssetParams> = {
  name: 'inspect_asset',
  jobTypes: ['verify', 'extract_metadata'],
  runtime: 'node',
  paramsSchema: InspectAssetParamsSchema,
  async run(ctx) {
    const { db, store, ffmpeg } = ctx.services;
    const isVerify = ctx.job.job_type === 'verify';
    const asset = await requireAsset(ctx);
    const upload: UploadRow | null = ctx.params.uploadId ? await db.getUpload(ctx.params.uploadId) : await db.findUploadByDraftAsset(asset.id);

    // 1. Locate the bytes: the asset's own (master) key when present, otherwise the upload staging key.
    let sourceKey: string | null = null;
    if (await store.head(asset.storage_key)) sourceKey = asset.storage_key;
    else if (upload && (await store.head(upload.storage_key))) sourceKey = upload.storage_key;
    if (!sourceKey) throw new JobFailure('object_missing', `Neither ${asset.storage_key} nor the upload staging object exists yet`, { retry: true, backoffSeconds: 120 });
    await ctx.progress(5, 'locating object');

    // 2. Download + hash.
    const local = await downloadToWorkDir(ctx, sourceKey, masterFilename(asset));
    const { sha256, byteLength } = await hashFile(local.path);
    await ctx.progress(40, 'hashed');

    // 3. Sniff + metadata (audio only); content-type spoofing is a hard failure.
    let metadata: AudioMetadata | null = null;
    let mimeType = asset.mime_type;
    if (asset.kind === 'audio') {
      try {
        metadata = await extractAudioMetadata(createReadStream(local.path), masterFilename(asset), { declaredMimeType: asset.mime_type, exactDuration: true });
      } catch (error) {
        if (error instanceof ContentTypeMismatchError) {
          await quarantine(ctx, asset, upload, 'content_type_mismatch', error.message);
          throw new JobFailure('content_type_mismatch', error.message, { retry: false });
        }
        throw new JobFailure('metadata_extraction_failed', (error as Error).message, { retry: false, cause: error });
      }
      if (metadata.sniffed?.mimeType) mimeType = metadata.sniffed.mimeType;
    }
    await ctx.progress(60, 'metadata extracted');

    // 4. Verify against the upload session and the draft row.
    const expectedChecksum = upload?.client_checksum_sha256 ?? asset.checksum_sha256;
    if (expectedChecksum && expectedChecksum !== sha256) {
      await quarantine(ctx, asset, upload, 'checksum_mismatch', `expected ${expectedChecksum}, computed ${sha256}`);
      throw new JobFailure('checksum_mismatch', `SHA-256 mismatch for asset ${asset.id}: expected ${expectedChecksum}, computed ${sha256}`, { retry: false });
    }
    if (upload && upload.declared_byte_length !== byteLength) {
      await quarantine(ctx, asset, upload, 'size_mismatch', `declared ${upload.declared_byte_length}, observed ${byteLength}`);
      throw new JobFailure('size_mismatch', `Byte length mismatch for asset ${asset.id}: declared ${upload.declared_byte_length}, observed ${byteLength}`, { retry: false });
    }

    // 5. Optional ffprobe cross-check (duration/bitrate) when ffmpeg is available.
    let probe: InspectAssetOutput['probe'] = null;
    if (asset.kind === 'audio') {
      try {
        const p = await ffmpeg.probe(local.path, { signal: ctx.signal });
        probe = { durationMs: p.durationMs, codec: p.codec, bitrateKbps: p.bitrateKbps };
      } catch (error) {
        ctx.log.warn('inspect.probe_failed', { error });
      }
    }

    // 6. Dedupe awareness: same bytes under another logical asset are reported, never merged (§7.2).
    const twin = await db.findAssetByChecksum(sha256);
    const duplicateOfAssetId = twin && twin.id !== asset.id ? twin.id : null;

    // 7. Promote to the hashed master key when the bytes still live under the staging key.
    let storageKey = asset.storage_key;
    let promotedFrom: string | null = null;
    const masterKey = buildMasterKey({ assetId: asset.id, contentHash: sha256, mimeType });
    const isDerived = asset.source_asset_id !== null || parseObjectKey(asset.storage_key)?.scope === 'derived';
    const shouldPromote = sourceKey !== asset.storage_key || (!isDerived && asset.storage_key !== masterKey);
    if (shouldPromote) {
      if (!(await store.head(masterKey))) {
        await store.copy(sourceKey, masterKey, { contentType: mimeType });
        ctx.cost.storage('copy', byteLength);
      }
      const check = await store.head(masterKey);
      if (!check || check.byteLength !== byteLength) throw new JobFailure('promotion_failed', `Copy to ${masterKey} did not produce the expected object`, { retry: true, backoffSeconds: 60 });
      storageKey = masterKey;
      promotedFrom = sourceKey;
    }
    await ctx.progress(85, 'promoted');

    // 8. Persist.
    const durationMs = metadata?.durationMs ?? probe?.durationMs ?? asset.duration_ms;
    const updated = await db.updateAsset(asset.id, {
      storage_key: storageKey,
      checksum_sha256: sha256,
      byte_length: byteLength,
      mime_type: mimeType,
      duration_ms: durationMs,
      channels: metadata?.channels ?? asset.channels,
      sample_rate_hz: metadata?.sampleRateHz ?? asset.sample_rate_hz,
      bitrate_kbps: metadata?.bitrateKbps ?? probe?.bitrateKbps ?? asset.bitrate_kbps,
      ...(asset.disposition === 'quarantined' ? {} : { disposition: 'active' }),
    });
    if (upload && isVerify) {
      await db.updateUpload(upload.id, { status: 'verified', verified_checksum_sha256: sha256, storage_key: storageKey, failure_code: null });
    }
    if (promotedFrom && promotedFrom !== storageKey && promotedFrom.startsWith('uploads/')) {
      await store.delete(promotedFrom).catch((error: unknown) => ctx.log.warn('inspect.staging_delete_failed', { key: promotedFrom, error }));
      ctx.cost.storage('delete');
    }
    await db.recordProvenance({
      asset_id: asset.id,
      event_type: isVerify ? 'uploaded' : 'edited',
      actor_id: ctx.job.requested_by,
      job_id: ctx.job.id,
      details: {
        action: isVerify ? 'verified' : 'metadata_refreshed',
        checksumSha256: sha256,
        byteLength,
        mimeType,
        durationMs,
        promotedFrom,
        duplicateOfAssetId,
        tags: metadata?.tags ?? null,
        tagTypes: metadata?.tagTypes ?? [],
        embeddedCover: metadata?.embeddedCover ?? null,
      } as never,
    });

    if (isVerify || ctx.params.emitEvent) {
      await ctx.emit('asset.verified', { assetId: asset.id, durationMs: durationMs ?? null, mimeType, checksumSha256: sha256, duplicateOfAssetId, state: ContentStateSchema.parse(updated.state) }, `asset.verified:${asset.id}:${sha256}`);
    }
    await ctx.progress(100);

    const output: InspectAssetOutput = { assetId: asset.id, verified: true, checksumSha256: sha256, byteLength, mimeType, storageKey, promotedFrom, duplicateOfAssetId, metadata, probe };
    return { output, outputAssetIds: [asset.id] };
  },
};

async function quarantine(ctx: Parameters<typeof inspectAssetHandler.run>[0], asset: MediaAssetRow, upload: UploadRow | null, code: string, detail: string): Promise<void> {
  const { db } = ctx.services;
  await db.updateAsset(asset.id, { disposition: 'quarantined' }).catch((error: unknown) => ctx.log.warn('inspect.quarantine_failed', { error }));
  if (upload) await db.updateUpload(upload.id, { status: 'failed', failure_code: code }).catch((error: unknown) => ctx.log.warn('inspect.upload_fail_update_failed', { error }));
  await db.recordProvenance({ asset_id: asset.id, event_type: 'uploaded', actor_id: ctx.job.requested_by, job_id: ctx.job.id, details: { action: 'quarantined', code, detail } as never }).catch(() => {});
}
