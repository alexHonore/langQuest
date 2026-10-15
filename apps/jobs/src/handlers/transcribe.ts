/**
 * `transcribe` — speech-to-text for an audio master (§7.5, §8.1 task 11).
 *
 * - Long or large audio is split with ffmpeg into small AAC chunks (OpenRouter caps uploads at 25 MB);
 *   chunk timestamps are offset back onto the master timeline.
 * - The `SpeechRecognizer` from `@langquest/ai` picks the per-variety model chain (admin profiles override
 *   the capability matrix); capability is checked first and unsupported locales fail honestly.
 * - Sentence-level segments become `transcripts` + `transcript_segments` rows (revision-safe: an edited or
 *   reviewed transcript is never overwritten, a new revision is created). Word timestamps are kept in the raw
 *   STT JSON (`derived/{assetId}/transcript/{recipe}.json`) for the `align` job.
 * - Results are reused by content hash + model recipe: identical bytes are never transcribed twice.
 * - Mixed-language recordings (instruction voice + target speech) are flagged (`language_mode: 'mixed'`),
 *   never silently labelled as one language.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AudioEncoding, SourceLanguageCode, TranscriptResult, VarietyId } from '@langquest/contracts';
import { getVariety, isSourceLanguageCode } from '@langquest/contracts';
import { providerLocaleFor } from '@langquest/ai';
import type { Insert } from '@langquest/db';
import { buildDerivedKey, decideTranscodeProfile, detectLanguageMix, normalizeSegments, sha256HexSync, transcriptCoveragePct, type Segment, type SegmentInput } from '@langquest/media';
import type { JobAi } from '../services';
import { buildSegmentCommand } from '../ffmpeg';
import { JobFailure, enqueueSpecFor, type JobContext, type JobHandler } from '../queue/types';
import { downloadToWorkDir, encodingForMime, fileAssetResolver, fileSize, masterFilename, requireAsset, requireVariety } from './common';

export const TRANSCRIBE_VERSION = 'transcribe:v1';

export const TranscribeParamsSchema = z.object({
  assetId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  /** Variety id, course track or BCP-47 locale of the target speech; defaults to the lesson's variety. */
  locale: z.string().min(2).optional(),
  /** Recording mixes an instruction language with target speech (code-switched). */
  mixedLanguage: z.boolean().optional(),
  /** Instruction language spoken in the recording (for the mixed-language hint), e.g. `en`. */
  instructionLanguage: z.string().min(2).optional(),
  chunkSeconds: z.number().int().min(60).max(1800).default(600),
  /** Files above this size are always chunked (OpenRouter upload cap is 25 MB). */
  maxDirectBytes: z.number().int().min(1024).default(20 * 1024 * 1024),
  /** Enqueue follow-up `align` and `translate_transcript` jobs. */
  chain: z.boolean().default(true),
  /** Source languages for `translate_transcript` follow-ups. */
  translateTo: z.array(z.string().min(2)).default([]),
  force: z.boolean().default(false),
});
export type TranscribeParams = z.infer<typeof TranscribeParamsSchema>;

export interface RawTranscriptJson {
  version: 1;
  handlerVersion: string;
  assetId: string;
  contentHash: string;
  recipeHash: string;
  provider: string;
  model: string;
  models: string[];
  requestedLocale: string;
  varietyId: VarietyId;
  detectedLanguage: string | null;
  languageMismatch: boolean;
  confidence: number | null;
  durationMs: number | null;
  mixedLanguageHint: boolean;
  instructionLanguage: string | null;
  chunks: Array<{ index: number; offsetMs: number; durationMs: number | null; byteLength: number }>;
  segments: Segment[];
  wordTimestamps: boolean;
  generatedAt: string;
}

/** Deterministic recipe hash: same bytes + same model chain + same handler version → same key. */
export function transcriptRecipeHash(contentHash: string, models: readonly string[], version = TRANSCRIBE_VERSION): string {
  return sha256HexSync(`${contentHash}|${models.join(',')}|${version}`);
}

export function rawTranscriptKey(assetId: string, recipeHash: string): string {
  return buildDerivedKey({ assetId, variant: 'transcript', hash: recipeHash, ext: 'json' });
}

/** Convert adapter segments (chunk-relative) into normalised master-timeline segments. */
export function mergeChunkResults(results: Array<{ offsetMs: number; result: TranscriptResult }>): Segment[] {
  const inputs: SegmentInput[] = [];
  for (const { offsetMs, result } of results) {
    for (const s of result.segments) {
      const text = s.text.trim();
      if (!text) continue;
      inputs.push({
        index: inputs.length,
        startMs: offsetMs + s.startMs,
        endMs: offsetMs + Math.max(s.endMs, s.startMs),
        text,
        speakerLabel: s.speakerLabel,
        languageCode: s.language ?? result.detectedLanguage?.code ?? null,
        confidence: s.confidence,
        words: s.words.map((w) => ({ word: w.text, startMs: offsetMs + w.startMs, endMs: offsetMs + w.endMs, confidence: w.confidence })),
      });
    }
  }
  return normalizeSegments(inputs);
}

const SUPPORTED_DIRECT = new Set<AudioEncoding>(['mp3', 'wav', 'flac', 'opus', 'm4a', 'aac']);

export const transcribeHandler: JobHandler<TranscribeParams> = {
  name: 'transcribe',
  jobTypes: ['transcribe'],
  runtime: 'node',
  paramsSchema: TranscribeParamsSchema,
  async run(ctx) {
    const { db, store, ffmpeg } = ctx.services;
    const asset = await requireAsset(ctx);
    if (asset.kind !== 'audio') throw new JobFailure('not_audio', `asset ${asset.id} is ${asset.kind}`, { retry: false });

    const lessonId = ctx.params.lessonId ?? (await db.findLessonIdsForAsset(asset.id))[0] ?? null;
    const lesson = lessonId ? await db.getLesson(lessonId) : null;
    const variety = requireVariety(ctx.params.locale ?? lesson?.lesson.target_variety_id ?? null, 'locale');
    const providerLocale = providerLocaleFor(variety);
    const instructionLanguage = ctx.params.instructionLanguage ?? lesson?.lesson.instruction_language_code ?? null;
    const mixedHint = ctx.params.mixedLanguage ?? (instructionLanguage !== null && instructionLanguage !== getVariety(variety).languageCode);

    const files = new Map<string, { path: string; encoding: AudioEncoding; sampleRateHz: number | null }>();
    const ai: JobAi = await ctx.services.ai({ sink: ctx.cost, assetResolver: fileAssetResolver(files), varietyId: variety });
    const capability = await ai.recognizer.supports(providerLocale, asset.mime_type);
    if (!capability.supported) throw new JobFailure('capability_unsupported', `Speech recognition unsupported for ${variety} (${capability.reasons.join(', ')})`, { retry: false, details: { capability } });
    const models = [...ai.sttModelsFor(variety)];
    const recipeHash = transcriptRecipeHash(asset.checksum_sha256, models);
    const rawKey = rawTranscriptKey(asset.id, recipeHash);

    // --- reuse: same lesson already has this recipe, or identical bytes were transcribed before ---
    const existingTranscripts = lessonId ? await db.listTranscriptsForLesson(lessonId) : [];
    if (!ctx.params.force) {
      const same = existingTranscripts.find((t) => t.source_asset_id === asset.id && t.model !== null && models.includes(t.model) && t.status !== 'failed');
      if (same) {
        ctx.log.info('transcribe.reused_transcript', { transcriptId: same.id });
        return { output: { reused: true, transcriptId: same.id, lessonId, revision: same.revision, rawKey, varietyId: variety }, outputAssetIds: [asset.id] };
      }
    }
    let raw: RawTranscriptJson | null = null;
    if (!ctx.params.force) {
      const candidates = [rawKey, ...(await db.listAssetsByChecksum(asset.checksum_sha256)).filter((a) => a.id !== asset.id).map((a) => rawTranscriptKey(a.id, recipeHash))];
      for (const key of candidates) {
        const bytes = await store.getBytes(key);
        if (bytes) {
          ctx.cost.storage('get', bytes.byteLength);
          try {
            raw = JSON.parse(new TextDecoder().decode(bytes)) as RawTranscriptJson;
            ctx.log.info('transcribe.reused_raw', { key });
            break;
          } catch {
            raw = null;
          }
        }
      }
    }

    // --- run STT ---
    if (!raw) {
      const local = await downloadToWorkDir(ctx, asset.storage_key, masterFilename(asset));
      const probe = await ffmpeg.probe(local.path, { signal: ctx.signal }).catch((error: unknown) => {
        throw new JobFailure('probe_failed', (error as Error).message, { retry: false, cause: error });
      });
      const durationMs = probe.durationMs ?? asset.duration_ms ?? null;
      const encoding = encodingForMime(asset.mime_type);
      const needsChunking = local.byteLength > ctx.params.maxDirectBytes || (durationMs !== null && durationMs > ctx.params.chunkSeconds * 1000) || !SUPPORTED_DIRECT.has(encoding);
      await ctx.progress(10, needsChunking ? 'chunking' : 'single chunk');

      const chunks: Array<{ index: number; path: string; offsetMs: number; durationMs: number | null; byteLength: number; encoding: AudioEncoding; sampleRateHz: number | null }> = [];
      if (needsChunking) {
        const profile = decideTranscodeProfile({ ...probe, speechOnly: true }).aac;
        const pattern = join(ctx.workDir, 'chunk-%03d.m4a');
        const res = await ffmpeg.run(buildSegmentCommand({ input: local.path, outputPattern: pattern, segmentSeconds: ctx.params.chunkSeconds, profile }), { signal: ctx.signal });
        ctx.cost.ffmpeg(res.durationMs);
        const names = (await readdir(ctx.workDir)).filter((n) => /^chunk-\d{3}\.m4a$/.test(n)).sort();
        let offset = 0;
        for (const [i, name] of names.entries()) {
          const path = join(ctx.workDir, name);
          const p = await ffmpeg.probe(path, { signal: ctx.signal }).catch(() => null);
          const d = p?.durationMs ?? ctx.params.chunkSeconds * 1000;
          chunks.push({ index: i, path, offsetMs: offset, durationMs: d, byteLength: await fileSize(path), encoding: 'm4a', sampleRateHz: profile.sampleRateHz });
          offset += d;
        }
        if (!chunks.length) throw new JobFailure('chunking_failed', 'ffmpeg produced no chunks', { retry: false });
      } else {
        chunks.push({ index: 0, path: local.path, offsetMs: 0, durationMs, byteLength: local.byteLength, encoding, sampleRateHz: probe.sampleRateHz });
      }

      const results: Array<{ offsetMs: number; result: TranscriptResult }> = [];
      for (const chunk of chunks) {
        if (ctx.signal.aborted) throw new JobFailure('aborted', 'job aborted during transcription', { retry: true, backoffSeconds: 60 });
        ctx.cost.assertBudget();
        const id = crypto.randomUUID();
        files.set(id, { path: chunk.path, encoding: chunk.encoding, sampleRateHz: chunk.sampleRateHz });
        const result = await ai.recognizer.transcribe({ source: 'asset', assetId: id, encoding: chunk.encoding, sampleRateHz: chunk.sampleRateHz }, providerLocale);
        files.delete(id);
        results.push({ offsetMs: chunk.offsetMs, result });
        await ctx.progress(10 + Math.round(((chunk.index + 1) / chunks.length) * 70), `chunk ${chunk.index + 1}/${chunks.length}`);
      }

      const segments = mergeChunkResults(results);
      const first = results[0]?.result;
      const confidences = results.map((r) => r.result.confidence).filter((c): c is number => c !== null);
      raw = {
        version: 1,
        handlerVersion: TRANSCRIBE_VERSION,
        assetId: asset.id,
        contentHash: asset.checksum_sha256,
        recipeHash,
        provider: first?.provider ?? ai.recognizer.provider,
        model: first?.model ?? models[0] ?? 'unknown',
        models,
        requestedLocale: providerLocale,
        varietyId: variety,
        detectedLanguage: first?.detectedLanguage?.code ?? null,
        languageMismatch: results.some((r) => r.result.languageMismatch),
        confidence: confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000 : null,
        durationMs,
        mixedLanguageHint: mixedHint,
        instructionLanguage,
        chunks: chunks.map((c) => ({ index: c.index, offsetMs: c.offsetMs, durationMs: c.durationMs, byteLength: c.byteLength })),
        segments,
        wordTimestamps: segments.some((s) => s.words.length > 0),
        generatedAt: ctx.services.now().toISOString(),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(raw));
      await store.put(rawKey, bytes, { contentType: 'application/json' });
      ctx.cost.storage('put', bytes.byteLength);
    }
    await ctx.progress(85, 'persisting');

    // --- DB rows (require a lesson) ---
    const mix = detectLanguageMix(raw.segments);
    const varietyLanguage = getVariety(variety).languageCode;
    const primaryLanguage = raw.detectedLanguage?.split('-')[0] ?? varietyLanguage;
    const languageMode: 'source' | 'target' | 'mixed' = raw.mixedLanguageHint || mix.mixed ? 'mixed' : primaryLanguage === varietyLanguage ? 'target' : 'source';
    let transcriptId: string | null = null;
    let revision: number | null = null;
    if (lessonId) {
      revision = existingTranscripts.length ? Math.max(...existingTranscripts.map((t) => t.revision)) + 1 : 0;
      const transcript = await db.upsertTranscript({
        lesson_id: lessonId,
        language_mode: languageMode,
        primary_language_code: primaryLanguage,
        revision,
        coverage_pct: raw.durationMs ? transcriptCoveragePct(raw.segments, raw.durationMs) : 0,
        status: 'machine',
        qa_state: 'machine_draft',
        provider: raw.provider,
        model: raw.model,
        access_rights: 'internal_only',
        source_asset_id: asset.id,
        manually_uploaded: false,
      } as Insert<'transcripts'>);
      transcriptId = transcript.id;
      const rows = raw.segments.map((s, i) => ({
        sort_index: i,
        start_ms: s.startMs,
        end_ms: s.endMs,
        text: s.text,
        speaker_label: s.speakerLabel,
        language_code: s.languageCode,
        // A variety is only asserted when the segment is in the variety's language and the job asked for it.
        target_variety_id: s.languageCode && s.languageCode.split('-')[0] === varietyLanguage && languageMode !== 'mixed' ? variety : null,
        confidence: s.confidence,
        reviewed: false,
      }));
      await db.replaceSegments(transcript.id, rows);
      await db.updateLesson(lessonId, { transcript_status: 'machine', ...(lesson?.lesson.listen_length_ms === null && raw.durationMs ? { listen_length_ms: raw.durationMs } : {}) });
      await ctx.emit('transcript.ready', { lessonId, transcriptId: transcript.id, revision, segmentCount: rows.length, primaryLanguageCode: primaryLanguage, wordAligned: false, provider: raw.provider }, `transcript.ready:${transcript.id}`);

      if (ctx.params.chain) {
        await db.enqueueJob({ jobType: 'align', idempotencyKey: `align:${transcript.id}`, params: { transcriptId: transcript.id, rawKey }, parentAssetId: asset.id, parentEntityTable: 'transcripts', parentEntityId: transcript.id, requestedBy: ctx.job.requested_by });
        const targets = ctx.params.translateTo.filter((c): c is SourceLanguageCode => isSourceLanguageCode(c));
        if (targets.length) {
          const spec = enqueueSpecFor('translate_transcript', { transcriptId: transcript.id, sourceLanguages: targets });
          await db.enqueueJob({ jobType: spec.jobType, idempotencyKey: `translate_transcript:${transcript.id}:${targets.join(',')}`, params: spec.params, parentAssetId: asset.id, parentEntityTable: 'transcripts', parentEntityId: transcript.id, requestedBy: ctx.job.requested_by });
        }
      }
    } else {
      ctx.log.warn('transcribe.no_lesson', { message: 'asset is not linked to an audio lesson; raw transcript stored, no DB rows written' });
    }

    await db.recordProvenance({
      asset_id: asset.id,
      event_type: 'transcribed',
      actor_id: ctx.job.requested_by,
      job_id: ctx.job.id,
      details: { transcriptId, lessonId, revision, rawKey, provider: raw.provider, model: raw.model, segments: raw.segments.length, languageMode, detectedLanguage: raw.detectedLanguage, languageMismatch: raw.languageMismatch, mixedLanguageHint: raw.mixedLanguageHint, wordTimestamps: raw.wordTimestamps, reused: raw.generatedAt !== undefined } as never,
    });
    await ctx.progress(100);
    return {
      output: {
        assetId: asset.id,
        lessonId,
        transcriptId,
        revision,
        rawKey,
        varietyId: variety,
        provider: raw.provider,
        model: raw.model,
        segmentCount: raw.segments.length,
        languageMode,
        primaryLanguageCode: primaryLanguage,
        detectedLanguage: raw.detectedLanguage,
        languageMismatch: raw.languageMismatch,
        wordTimestamps: raw.wordTimestamps,
        languageMix: mix,
        confidence: raw.confidence,
        ...(lessonId ? {} : { warning: 'no_lesson_linked' }),
      },
      outputAssetIds: [asset.id],
    };
  },
};

export type TranscribeContext = JobContext<TranscribeParams>;
