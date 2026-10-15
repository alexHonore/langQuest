/**
 * `translate_transcript` — synchronized source-language overlays for transcript segments (§7.5).
 * One LLM call per batch of segments through the `translation_overlay` role (`source_explanation` task),
 * written in the enrollment-independent **source language requested by the editor** (never defaulted to
 * English). Rows land in `transcript_translations` as `needs_review` with explicit quality flags and a
 * `translation.review_requested` event; nothing is published automatically.
 *
 * Runs under the carrier job type `describe` with `params.handler = 'translate_transcript'`.
 */
import { z } from 'zod';
import type { SourceLanguageCode, VarietyId } from '@langquest/contracts';
import { findLanguage, getVariety } from '@langquest/contracts';
import { coachingLanguageInstruction, getPromptPack } from '@langquest/ai';
import type { Insert } from '@langquest/db';
import { JobFailure, type JobHandler } from '../queue/types';
import { jobLanguageContext, requireSourceLanguage, requireVariety, trackForVarietyOrThrow } from './common';

export const TRANSLATE_PROMPT_VERSION = 'transcript_translation:v1';

export const TranslateTranscriptParamsSchema = z.object({
  transcriptId: z.string().uuid(),
  sourceLanguages: z.array(z.string().min(2)).min(1),
  /** Variety override when the lesson has none recorded. */
  locale: z.string().optional(),
  batchSize: z.number().int().min(1).max(80).default(40),
  force: z.boolean().default(false),
});
export type TranslateTranscriptParams = z.infer<typeof TranslateTranscriptParamsSchema>;

export const TranslationBatchSchema = z.object({
  translations: z.array(z.object({ index: z.number().int().min(0), text: z.string(), uncertain: z.boolean().default(false) })),
});
export type TranslationBatch = z.infer<typeof TranslationBatchSchema>;

export function buildTranslationPrompt(input: { source: SourceLanguageCode; variety: VarietyId; languageMode: string; segments: Array<{ index: number; text: string; languageCode: string | null }> }): { system: string; user: string; templateId: string; templateVersion: string } {
  const pack = getPromptPack(input.variety);
  const lang = findLanguage(input.source);
  const system = [
    'You translate transcript segments of a language-learning audio recording into the learner\'s instruction language.',
    coachingLanguageInstruction(input.source),
    `Target variety of the recording: ${pack.name} (${input.variety}). Transcript language mode: ${input.languageMode}.`,
    'Rules: translate meaning naturally and concisely; keep the segment order and indices; never merge or split segments;',
    `if a segment is already in ${lang?.englishName ?? input.source}, copy it unchanged; if a segment is unintelligible or a non-speech marker, return it unchanged and mark uncertain=true.`,
    'Do not add commentary. Output JSON only.',
  ].join('\n');
  const user = JSON.stringify({ segments: input.segments });
  return { system, user, templateId: 'transcript_translation', templateVersion: TRANSLATE_PROMPT_VERSION };
}

export const translateTranscriptHandler: JobHandler<TranslateTranscriptParams> = {
  name: 'translate_transcript',
  jobTypes: [],
  runtime: 'any',
  paramsSchema: TranslateTranscriptParamsSchema,
  async run(ctx) {
    const { db } = ctx.services;
    const transcript = await db.getTranscript(ctx.params.transcriptId);
    if (!transcript) throw new JobFailure('transcript_not_found', `transcript ${ctx.params.transcriptId} not found`, { retry: false });
    const lesson = await db.getLesson(transcript.lesson_id);
    const segments = await db.listSegments(transcript.id);
    if (!segments.length) throw new JobFailure('no_segments', 'transcript has no segments', { retry: false });
    const variety = requireVariety(ctx.params.locale ?? lesson?.lesson.target_variety_id ?? segments.find((s) => s.target_variety_id)?.target_variety_id ?? null, 'locale');
    const track = trackForVarietyOrThrow(variety);
    const sources = ctx.params.sourceLanguages.map((c) => requireSourceLanguage(c, 'sourceLanguages'));
    const varietyLanguage = getVariety(variety).languageCode;

    const ai = await ctx.services.ai({ sink: ctx.cost, varietyId: variety });
    const summary: Record<string, { translated: number; skipped: number; uncertain: number; batches: number }> = {};
    let done = 0;
    const total = sources.length * segments.length;

    for (const source of sources) {
      const languageContext = jobLanguageContext(ctx, { track, sourceLanguage: source });
      // Reviewed/approved overlays are never overwritten; machine drafts are skipped unless `force`.
      const existing = await db.listTranslations(segments.map((s) => s.id), source);
      const have = new Set(existing.filter((t) => t.qa_state === 'reviewed' || t.qa_state === 'approved' || !ctx.params.force).map((t) => t.segment_id));
      const todo = segments.filter((s) => !have.has(s.id));
      const stat = { translated: 0, skipped: segments.length - todo.length, uncertain: 0, batches: 0 };
      summary[source] = stat;
      for (let i = 0; i < todo.length; i += ctx.params.batchSize) {
        if (ctx.signal.aborted) throw new JobFailure('aborted', 'job aborted', { retry: true, backoffSeconds: 60 });
        ctx.cost.assertBudget();
        const batch = todo.slice(i, i + ctx.params.batchSize);
        const prompt = buildTranslationPrompt({ source, variety, languageMode: transcript.language_mode, segments: batch.map((s) => ({ index: s.sort_index, text: s.text, languageCode: s.language_code })) });
        const result = await ai.reasoner.generateStructured('source_explanation', languageContext, prompt, TranslationBatchSchema, { traceId: ctx.traceId });
        const byIndex = new Map(result.translations.map((t) => [t.index, t]));
        const rows: Insert<'transcript_translations'>[] = [];
        for (const seg of batch) {
          const t = byIndex.get(seg.sort_index);
          if (!t || !t.text.trim()) continue;
          const flags = ['machine', 'review_needed'];
          if (t.uncertain) flags.push('uncertain');
          if (seg.confidence !== null && seg.confidence < 0.5) flags.push('low_stt_confidence');
          if (seg.language_code && seg.language_code.split('-')[0] === source && varietyLanguage !== source) flags.push('segment_already_in_source_language');
          rows.push({ segment_id: seg.id, language_code: source, text: t.text.trim(), qa_state: 'needs_review', quality_flags: flags });
          if (t.uncertain) stat.uncertain += 1;
        }
        stat.translated += await db.upsertTranslations(rows);
        stat.batches += 1;
        done += batch.length;
        await ctx.progress(Math.round((done / Math.max(1, total)) * 95), `${source}: ${stat.translated} segments`);
      }
      await ctx.emit('translation.review_requested', { entityTable: 'transcripts', entityId: transcript.id, sourceLanguageCode: source, targetVarietyId: variety, requestedBy: ctx.job.requested_by, reviewerId: null }, `translation.review_requested:transcripts:${transcript.id}:${source}`);
    }
    if (transcript.source_asset_id) {
      await db.recordProvenance({ asset_id: transcript.source_asset_id, event_type: 'edited', actor_id: ctx.job.requested_by, job_id: ctx.job.id, details: { action: 'transcript_translated', transcriptId: transcript.id, summary, promptVersion: TRANSLATE_PROMPT_VERSION } as never });
    }
    await ctx.progress(100);
    return { output: { transcriptId: transcript.id, varietyId: variety, summary, reviewState: 'needs_review' }, outputAssetIds: transcript.source_asset_id ? [transcript.source_asset_id] : [] };
  },
};
