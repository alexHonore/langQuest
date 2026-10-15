/**
 * `align` — timing refinement for a machine transcript (§7.5: "sentence level as baseline; optional
 * word-level where tools/language support is reliable").
 *
 * Sentence level: segment boundaries from the STT are normalised (monotonic, non-overlapping, clamped to
 * the audio duration) and written back — unless an editor already reviewed the segment.
 * Word level: ONLY when the recogniser returned word timestamps (kept in the raw STT JSON). Otherwise the
 * job succeeds with `wordAlignment: 'unavailable'` and says why — no forced alignment is faked.
 */
import { z } from 'zod';
import { normalizeSegments, parseObjectKey } from '@langquest/media';
import type { SegmentRow } from '../db';
import { JobFailure, type JobHandler } from '../queue/types';
import type { RawTranscriptJson } from './transcribe';

export const AlignParamsSchema = z.object({
  transcriptId: z.string().uuid(),
  /** Raw STT JSON key (`derived/{assetId}/transcript/{recipe}.json`); discovered when omitted. */
  rawKey: z.string().optional(),
  force: z.boolean().default(false),
});
export type AlignParams = z.infer<typeof AlignParamsSchema>;

async function findRawKey(ctx: Parameters<typeof alignHandler.run>[0], assetId: string): Promise<string | null> {
  const jobs = await ctx.services.db.listJobsForAsset(assetId);
  for (const j of jobs) {
    if (j.job_type === 'transcribe' && j.state === 'succeeded' && j.output && typeof (j.output as Record<string, unknown>).rawKey === 'string') return (j.output as Record<string, string>).rawKey!;
  }
  const listed = await ctx.services.store.listAll(`derived/${assetId}/transcript/`, { maxObjects: 50 });
  ctx.cost.storage('list');
  const newest = listed.filter((o) => parseObjectKey(o.key)?.scope === 'derived').sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''))[0];
  return newest?.key ?? null;
}

export const alignHandler: JobHandler<AlignParams> = {
  name: 'align',
  jobTypes: ['align'],
  runtime: 'any',
  paramsSchema: AlignParamsSchema,
  async run(ctx) {
    const { db, store } = ctx.services;
    const transcript = await db.getTranscript(ctx.params.transcriptId);
    if (!transcript) throw new JobFailure('transcript_not_found', `transcript ${ctx.params.transcriptId} not found`, { retry: false });
    if (!transcript.source_asset_id) throw new JobFailure('transcript_without_asset', 'transcript has no source asset; nothing to align against', { retry: false });
    const asset = await db.getAsset(transcript.source_asset_id);
    const durationMs = asset?.duration_ms ?? null;

    const rawKey = ctx.params.rawKey ?? (await findRawKey(ctx, transcript.source_asset_id));
    let raw: RawTranscriptJson | null = null;
    if (rawKey) {
      const bytes = await store.getBytes(rawKey);
      if (bytes) {
        ctx.cost.storage('get', bytes.byteLength);
        raw = JSON.parse(new TextDecoder().decode(bytes)) as RawTranscriptJson;
      }
    }
    await ctx.progress(20, raw ? 'raw loaded' : 'no raw stt json');

    const rows = await db.listSegments(transcript.id);
    if (!rows.length) throw new JobFailure('no_segments', 'transcript has no segments', { retry: false });

    // --- sentence level ---
    const normalised = normalizeSegments(
      rows.map((r, i) => ({ id: r.id, index: i, startMs: r.start_ms, endMs: durationMs ? Math.min(r.end_ms, durationMs) : r.end_ms, text: r.text, speakerLabel: r.speaker_label, languageCode: r.language_code, confidence: r.confidence, reviewed: r.reviewed })),
    );
    let retimed = 0;
    const byId = new Map<string, SegmentRow>(rows.map((r) => [r.id, r]));
    for (const seg of normalised) {
      const row = seg.id ? byId.get(seg.id) : undefined;
      if (!row || (row.reviewed && !ctx.params.force)) continue;
      if (row.start_ms !== seg.startMs || row.end_ms !== seg.endMs) {
        await db.updateSegment(row.id, { start_ms: seg.startMs, end_ms: seg.endMs });
        retimed += 1;
      }
    }
    await ctx.progress(55, `sentence alignment: ${retimed} retimed`);

    // --- word level (only from real STT word timestamps) ---
    let wordAlignment: 'stored' | 'unavailable' = 'unavailable';
    let reason: string | null = null;
    let wordRows = 0;
    let segmentsWithWords = 0;
    if (!raw) reason = rawKey ? 'raw STT output could not be loaded' : 'no raw STT output for this transcript';
    else if (!raw.wordTimestamps) reason = `recogniser ${raw.provider}/${raw.model} returned no word timestamps`;
    else {
      const rawSegs = raw.segments;
      for (const row of rows) {
        if (row.reviewed && !ctx.params.force) continue;
        // Match by sort index when the row set still mirrors the STT output, else by overlap.
        let match = rawSegs[row.sort_index];
        if (!match || match.text !== row.text) match = rawSegs.find((s) => s.text === row.text && Math.abs(s.startMs - row.start_ms) < 2000) ?? rawSegs.find((s) => s.startMs < row.end_ms && s.endMs > row.start_ms);
        if (!match || !match.words.length) continue;
        const words = match.words
          .filter((w) => w.endMs >= row.start_ms && w.startMs <= row.end_ms)
          .map((w, i) => ({ word_index: i, word: w.word, start_ms: Math.max(row.start_ms, w.startMs), end_ms: Math.max(Math.max(row.start_ms, w.startMs), Math.min(row.end_ms, w.endMs)), confidence: w.confidence ?? null }));
        if (!words.length) continue;
        wordRows += await db.replaceWordAlignments(row.id, words);
        segmentsWithWords += 1;
      }
      if (segmentsWithWords > 0) wordAlignment = 'stored';
      else reason = 'word timestamps did not overlap any segment';
    }
    await ctx.progress(90, `word alignment: ${wordAlignment}`);

    if (asset) {
      await db.recordProvenance({ asset_id: asset.id, event_type: 'aligned', actor_id: ctx.job.requested_by, job_id: ctx.job.id, details: { transcriptId: transcript.id, retimed, wordAlignment, reason, wordRows, segmentsWithWords, rawKey } as never });
    }
    await ctx.emit('transcript.ready', { lessonId: transcript.lesson_id, transcriptId: transcript.id, revision: transcript.revision, segmentCount: rows.length, primaryLanguageCode: transcript.primary_language_code, wordAligned: wordAlignment === 'stored', provider: transcript.provider }, `transcript.ready:${transcript.id}:aligned`);
    await ctx.progress(100);
    return { output: { transcriptId: transcript.id, sentenceAlignment: 'normalised', retimed, wordAlignment, reason, wordRows, segmentsWithWords, rawKey }, outputAssetIds: asset ? [asset.id] : [] };
  },
};
