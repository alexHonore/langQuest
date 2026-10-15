/**
 * `transcode` — mobile renditions from a master (§4.4, §7.2): AAC (m4a) + Opus (ogg) at the audited
 * bitrate ladder, pitch-preserving slow renditions (§3.6), waveform peaks JSON and the embedded cover.
 * The master is only ever read; renditions are skipped when they bring no benefit (`shouldTranscode`).
 * Every output is keyed by its own SHA-256 (`derived/{assetId}/{variant}/{sha}.{ext}`), so re-running
 * the job on identical bytes is a no-op.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DerivedVariant, RenditionProfile, SlowFactor } from '@langquest/media';
import { SLOW_FACTORS, buildCoverExtractCommand, buildPcmPeaksCommand, buildSlowCommand, buildTranscodeCommand, decideTranscodeProfile, peaksFromPcm, shouldTranscode, sniffContainer, PEAK_PCM_SAMPLE_RATE } from '@langquest/media';
import type { MediaAssetRow } from '../db';
import { FfmpegError } from '../ffmpeg';
import { JobFailure, type JobContext, type JobHandler } from '../queue/types';
import { downloadToWorkDir, ensureDerivedAssetRow, masterFilename, requireAsset, uploadDerivedBytes, uploadDerivedFile } from './common';

export const TranscodeParamsSchema = z.object({
  assetId: z.string().uuid().optional(),
  formats: z.array(z.enum(['aac', 'opus'])).min(1).default(['aac', 'opus']),
  slow: z.boolean().default(true),
  slowFactors: z.array(z.union([z.literal(0.75), z.literal(0.85)])).default([...SLOW_FACTORS]),
  waveform: z.boolean().default(true),
  cover: z.boolean().default(true),
  /** Off by default: instructional dynamics (e.g. Pimsleur pauses) are preserved. */
  loudnessNormalize: z.boolean().default(false),
  /** Editor hint: narrated speech → mono renditions. */
  speechOnly: z.boolean().optional(),
  /** Re-encode even when derivatives already exist. */
  force: z.boolean().default(false),
});
export type TranscodeParams = z.infer<typeof TranscodeParamsSchema>;

export interface RenditionRecord {
  variant: DerivedVariant;
  assetId: string | null;
  key: string | null;
  byteLength: number | null;
  mimeType: string | null;
  bitrateKbps: number | null;
  status: 'created' | 'reused' | 'skipped';
  reason: string | null;
}

const VARIANT_FOR_FACTOR: Record<SlowFactor, DerivedVariant> = { 0.75: 'slow_075', 0.85: 'slow_085' };

export const transcodeHandler: JobHandler<TranscodeParams> = {
  name: 'transcode',
  jobTypes: ['transcode'],
  runtime: 'node',
  paramsSchema: TranscodeParamsSchema,
  async run(ctx) {
    const { db, ffmpeg } = ctx.services;
    const asset = await requireAsset(ctx);
    if (asset.kind !== 'audio') throw new JobFailure('not_audio', `asset ${asset.id} is ${asset.kind}, not audio`, { retry: false });

    const local = await downloadToWorkDir(ctx, asset.storage_key, masterFilename(asset));
    const probe = await ffmpeg.probe(local.path, { signal: ctx.signal }).catch((error: unknown) => {
      throw new JobFailure('probe_failed', `ffprobe failed for ${asset.id}: ${(error as Error).message}`, { retry: false, cause: error });
    });
    await ctx.progress(10, 'probed');

    const source = { channels: probe.channels, bitrateKbps: probe.bitrateKbps, codec: probe.codec, sampleRateHz: probe.sampleRateHz, durationMs: probe.durationMs, speechOnly: ctx.params.speechOnly };
    const profiles = decideTranscodeProfile(source);
    const existing = ctx.params.force ? [] : await db.listDerivedAssets(asset.id);
    const lessonIds = await db.findLessonIdsForAsset(asset.id);
    const renditions: RenditionRecord[] = [];
    const outputAssetIds: string[] = [];

    const run = async (cmd: Parameters<typeof ffmpeg.run>[0]): Promise<void> => {
      const res = await ffmpeg.run(cmd, { signal: ctx.signal });
      ctx.cost.ffmpeg(res.durationMs);
    };

    const attach = async (row: MediaAssetRow, assetType: 'mobile_encoded' | 'slow' | 'cover'): Promise<void> => {
      for (const lessonId of lessonIds) await db.attachLessonAsset({ lesson_id: lessonId, asset_id: row.id, asset_type: assetType, sort_order: assetType === 'mobile_encoded' ? 0 : 1 });
    };

    const encode = async (variant: DerivedVariant, profile: RenditionProfile, derivation: string, build: (output: string) => Parameters<typeof ffmpeg.run>[0], assetType: 'mobile_encoded' | 'slow'): Promise<void> => {
      const reused = existing.find((d) => d.derivation === derivation);
      if (reused) {
        renditions.push({ variant, assetId: reused.id, key: reused.storage_key, byteLength: Number(reused.byte_length), mimeType: reused.mime_type, bitrateKbps: reused.bitrate_kbps, status: 'reused', reason: 'derivative already exists' });
        outputAssetIds.push(reused.id);
        return;
      }
      const output = join(ctx.workDir, `${variant}.${profile.ext}`);
      await run(build(output));
      const uploaded = await uploadDerivedFile(ctx, { assetId: asset.id, variant, path: output, mimeType: profile.mimeType, ext: profile.ext });
      const row = await ensureDerivedAssetRow(ctx, asset, uploaded, { kind: 'audio', derivation, durationMs: probe.durationMs, channels: profile.channels, sampleRateHz: profile.sampleRateHz, bitrateKbps: profile.bitrateKbps });
      await attach(row, assetType);
      renditions.push({ variant, assetId: row.id, key: uploaded.key, byteLength: uploaded.byteLength, mimeType: profile.mimeType, bitrateKbps: profile.bitrateKbps, status: 'created', reason: null });
      outputAssetIds.push(row.id);
    };

    // Mobile renditions.
    let step = 0;
    const steps = ctx.params.formats.length + (ctx.params.slow ? ctx.params.slowFactors.length : 0) + (ctx.params.waveform ? 1 : 0) + (ctx.params.cover ? 1 : 0);
    const tick = async (note: string) => {
      step += 1;
      await ctx.progress(10 + Math.round((step / Math.max(1, steps)) * 85), note);
    };

    for (const format of ctx.params.formats) {
      const profile = profiles[format];
      const decision = shouldTranscode(source, profile);
      if (!decision.transcode) {
        renditions.push({ variant: format, assetId: null, key: null, byteLength: null, mimeType: null, bitrateKbps: null, status: 'skipped', reason: decision.reason });
      } else {
        await encode(format, profile, `transcode:${format}:${profile.bitrateKbps}k:${profile.channels}ch${ctx.params.loudnessNormalize ? ':loudnorm' : ''}`, (output) => buildTranscodeCommand({ input: local.path, output, profile, loudnessNormalize: ctx.params.loudnessNormalize }), 'mobile_encoded');
      }
      await tick(`rendition ${format}`);
    }

    // Slow renditions (atempo keeps pitch; AAC profile for broad mobile support).
    if (ctx.params.slow) {
      for (const factor of ctx.params.slowFactors) {
        const variant = VARIANT_FOR_FACTOR[factor];
        await encode(variant, profiles.aac, `slow:${factor}`, (output) => buildSlowCommand({ input: local.path, output, factor, profile: profiles.aac }), 'slow');
        await tick(`slow ${factor}`);
      }
    }

    // Waveform peaks.
    let waveform: { key: string; peaks: number; durationMs: number } | null = null;
    if (ctx.params.waveform) {
      const reused = existing.find((d) => d.derivation === 'waveform:v1');
      if (reused) waveform = { key: reused.storage_key, peaks: -1, durationMs: reused.duration_ms ?? 0 };
      else {
        const res = await ffmpeg.run(buildPcmPeaksCommand({ input: local.path }), { signal: ctx.signal });
        ctx.cost.ffmpeg(res.durationMs);
        const peaks = peaksFromPcm(new Uint8Array(res.stdout), PEAK_PCM_SAMPLE_RATE, 10);
        const uploaded = await uploadDerivedBytes(ctx, { assetId: asset.id, variant: 'waveform', bytes: JSON.stringify(peaks), mimeType: 'application/json', ext: 'json' });
        const row = await ensureDerivedAssetRow(ctx, asset, uploaded, { kind: 'document', derivation: 'waveform:v1', durationMs: peaks.durationMs });
        outputAssetIds.push(row.id);
        waveform = { key: uploaded.key, peaks: peaks.peaks.length, durationMs: peaks.durationMs };
      }
      await tick('waveform');
    }

    // Embedded cover (copied, not re-encoded).
    let cover: { key: string; mimeType: string; assetId: string } | null = null;
    if (ctx.params.cover && probe.hasCover) {
      const reused = existing.find((d) => d.derivation === 'cover:embedded');
      if (reused) cover = { key: reused.storage_key, mimeType: reused.mime_type, assetId: reused.id };
      else {
        const output = join(ctx.workDir, 'cover.jpg');
        try {
          await run(buildCoverExtractCommand({ input: local.path, output }));
          const bytes = await readFile(output);
          const sniffed = sniffContainer(new Uint8Array(bytes.subarray(0, 16)));
          if (sniffed && sniffed.kind === 'image') {
            const uploaded = await uploadDerivedFile(ctx, { assetId: asset.id, variant: 'cover', path: output, mimeType: sniffed.mimeType });
            const row = await ensureDerivedAssetRow(ctx, asset, uploaded, { kind: 'image', derivation: 'cover:embedded' });
            await attach(row, 'cover');
            outputAssetIds.push(row.id);
            cover = { key: uploaded.key, mimeType: sniffed.mimeType, assetId: row.id };
          } else ctx.log.warn('transcode.cover_unrecognised');
        } catch (error) {
          if (!(error instanceof FfmpegError)) throw error;
          ctx.log.warn('transcode.cover_extract_failed', { error });
        }
      }
      await tick('cover');
    }

    await db.recordProvenance({
      asset_id: asset.id,
      event_type: 'transcoded',
      actor_id: ctx.job.requested_by,
      job_id: ctx.job.id,
      details: { renditions, waveform, cover, source: { codec: probe.codec, bitrateKbps: probe.bitrateKbps, channels: probe.channels, sampleRateHz: probe.sampleRateHz, durationMs: probe.durationMs }, masterUntouched: true } as never,
    });
    await ctx.progress(100);
    return { output: { assetId: asset.id, renditions, waveform, cover, lessonIds, masterUntouched: true }, outputAssetIds: [...new Set(outputAssetIds)] };
  },
};

export type TranscodeContext = JobContext<TranscodeParams>;
