/**
 * `infer_metadata` — AI-assisted organisation (§7.4) for job types `detect_language`, `describe` and
 * `segment_lessons`: likely language(s) and dialect, instruction-voice vs target-speech, lesson/chapter
 * guesses, a concise description in the editor's source language, tags and topics.
 *
 * Evidence = existing transcript text when present, otherwise (optionally) a short STT sample of the first
 * `sampleSeconds`; plus the file's legacy path / tags. Every suggestion carries a confidence and the
 * provenance (task, prompt version, trace id → `ai_requests`). Suggestions are stored on the job output
 * and as an `asset_provenance_events` row plus `lesson_topics(provenance='ai_suggested')`; lesson fields
 * are NEVER changed and nothing is published.
 */
import { join } from 'node:path';
import { z } from 'zod';
import type { AudioEncoding, CourseTrackId, SourceLanguageCode, VarietyId } from '@langquest/contracts';
import { LEARNER_LEVEL_VALUES, LANGUAGE_CODES, VARIETY_IDS, isSourceLanguageCode, isVarietyId } from '@langquest/contracts';
import { providerLocaleFor, resolveVariety, getPromptPack, coachingLanguageInstruction } from '@langquest/ai';
import { buildClipCommand, decideTranscodeProfile } from '@langquest/media';
import { JobFailure, type JobHandler } from '../queue/types';
import { downloadToWorkDir, fileAssetResolver, jobLanguageContext, localized, masterFilename, trackForVarietyOrThrow } from './common';

export const INFER_PROMPT_VERSION = 'metadata_inference:v1';

export const InferMetadataParamsSchema = z.object({
  assetId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  mode: z.enum(['detect_language', 'describe', 'segment_lessons', 'all']).optional(),
  /** Language of the generated description / titles (editor's working language). */
  sourceLanguage: z.string().min(2).optional(),
  /** Expected variety (hint only); the model may disagree. */
  locale: z.string().optional(),
  sampleSeconds: z.number().int().min(15).max(600).default(90),
  /** Transcribe a sample when no transcript exists (costs STT minutes). */
  allowStt: z.boolean().default(true),
  /** Maximum transcript characters sent to the model. */
  maxEvidenceChars: z.number().int().min(500).max(20_000).default(4000),
});
export type InferMetadataParams = z.infer<typeof InferMetadataParamsSchema>;

const confidence = z.number().min(0).max(1);
export const MetadataSuggestionSchema = z.object({
  likelyLanguages: z.array(z.object({ code: z.string(), confidence })).max(5),
  likelyVariety: z.object({ varietyId: z.string().nullable(), confidence, note: z.string().nullable() }),
  instructionLanguage: z.object({ code: z.string().nullable(), confidence }),
  voiceRoles: z.array(z.object({ label: z.enum(['instruction', 'target', 'mixed', 'unknown']), confidence, evidence: z.string() })).max(4),
  lessonGuess: z.object({ title: z.string().nullable(), chapterTitle: z.string().nullable(), lessonOrder: z.number().int().nullable(), episodeNumber: z.number().int().nullable(), confidence }),
  description: z.object({ text: z.string(), languageCode: z.string(), confidence }),
  tags: z.array(z.object({ tag: z.string().min(1).max(64), confidence })).max(12),
  topics: z.array(z.object({ topicKey: z.string().regex(/^[a-z0-9_]{1,64}$/), confidence })).max(6),
  level: z.object({ value: z.enum(LEARNER_LEVEL_VALUES).nullable(), confidence }),
});
export type MetadataSuggestion = z.infer<typeof MetadataSuggestionSchema>;

export interface InferenceEvidence {
  source: 'transcript' | 'stt_sample' | 'metadata_only';
  transcriptId: string | null;
  sampleSeconds: number | null;
  text: string;
  segmentLanguages: string[];
  legacyPath: string | null;
  legacyFilename: string | null;
  durationMs: number | null;
  lesson: { title: string | null; description: string | null; tags: string[]; instructionLanguage: string | null; varietyId: string | null } | null;
}

export function buildInferencePrompt(input: { evidence: InferenceEvidence; sourceLanguage: SourceLanguageCode; expectedVariety: VarietyId | null; mode: string }): { system: string; user: string; templateId: string; templateVersion: string } {
  const packNote = input.expectedVariety ? `The editor expects the target speech to be ${getPromptPack(input.expectedVariety).name} (${input.expectedVariety}); confirm or contradict with evidence.` : 'No expected variety was given.';
  const system = [
    'You organise uploaded language-course audio for a content editor. You only SUGGEST metadata; a human reviews it.',
    'Given transcript evidence and file names, infer: the languages spoken (ISO 639-1 codes) with confidence; the most likely dialect/variety id from this list:',
    VARIETY_IDS.join(', '),
    '(null when unsure — never guess a neighbouring dialect: Moroccan vs Egyptian vs MSA, Cantonese vs Mandarin, Haitian Creole vs French are distinct);',
    'whether the recording contains an instruction voice (teacher explaining in the learner language), target-language speech, or both (mixed);',
    'a lesson/chapter title guess and ordering if the path suggests one; a concise 1–2 sentence description; up to 12 tags; up to 6 snake_case topic keys; a CEFR-like level guess.',
    coachingLanguageInstruction(input.sourceLanguage),
    packNote,
    `Mode requested by the editor: ${input.mode}. Be honest about low confidence. Output JSON only.`,
  ].join('\n');
  const user = JSON.stringify(input.evidence);
  return { system, user, templateId: 'metadata_inference', templateVersion: INFER_PROMPT_VERSION };
}

export const inferMetadataHandler: JobHandler<InferMetadataParams> = {
  name: 'infer_metadata',
  jobTypes: ['detect_language', 'describe', 'segment_lessons'],
  runtime: 'node',
  paramsSchema: InferMetadataParamsSchema,
  async run(ctx) {
    const { db, ffmpeg } = ctx.services;
    const mode = ctx.params.mode ?? (ctx.job.job_type === 'detect_language' || ctx.job.job_type === 'describe' || ctx.job.job_type === 'segment_lessons' ? ctx.job.job_type : 'all');
    const assetId = ctx.params.assetId ?? ctx.job.parent_asset_id;
    const asset = assetId ? await db.getAsset(assetId) : null;
    const lessonId = ctx.params.lessonId ?? (asset ? (await db.findLessonIdsForAsset(asset.id))[0] ?? null : null);
    const lesson = lessonId ? await db.getLesson(lessonId) : null;
    if (!asset && !lesson) throw new JobFailure('target_missing', 'infer_metadata needs an asset or a lesson', { retry: false });
    const masterLink = lesson?.assets.find((a) => a.asset_type === 'master' && a.media) ?? null;
    const masterAsset = asset ?? (masterLink ? await db.getAsset(masterLink.asset_id) : null);

    const sourceLanguageRaw = ctx.params.sourceLanguage ?? lesson?.lesson.instruction_language_code ?? 'en';
    const sourceLanguage: SourceLanguageCode = isSourceLanguageCode(sourceLanguageRaw) ? sourceLanguageRaw : 'en';
    const expectedVariety = ctx.params.locale ? resolveVariety(ctx.params.locale) : lesson?.lesson.target_variety_id && isVarietyId(lesson.lesson.target_variety_id) ? lesson.lesson.target_variety_id : null;

    // --- evidence ---
    const evidence: InferenceEvidence = {
      source: 'metadata_only',
      transcriptId: null,
      sampleSeconds: null,
      text: '',
      segmentLanguages: [],
      legacyPath: masterAsset?.legacy_path ?? null,
      legacyFilename: masterAsset?.legacy_filename ?? null,
      durationMs: masterAsset?.duration_ms ?? lesson?.lesson.listen_length_ms ?? null,
      lesson: lesson ? { title: localized(lesson.lesson.title_translations, sourceLanguage), description: localized(lesson.lesson.description_translations, sourceLanguage), tags: lesson.lesson.tags, instructionLanguage: lesson.lesson.instruction_language_code, varietyId: lesson.lesson.target_variety_id } : null,
    };
    const transcripts = lessonId ? await db.listTranscriptsForLesson(lessonId) : [];
    const transcript = transcripts.filter((t) => t.status !== 'failed' && t.status !== 'none').sort((a, b) => b.revision - a.revision)[0] ?? null;
    if (transcript) {
      const segments = await db.listSegments(transcript.id);
      let text = '';
      const langs = new Set<string>();
      for (const s of segments) {
        if (text.length >= ctx.params.maxEvidenceChars) break;
        text += `[${(s.start_ms / 1000).toFixed(1)}s${s.language_code ? ` ${s.language_code}` : ''}] ${s.text}\n`;
        if (s.language_code) langs.add(s.language_code);
      }
      evidence.source = 'transcript';
      evidence.transcriptId = transcript.id;
      evidence.text = text.slice(0, ctx.params.maxEvidenceChars);
      evidence.segmentLanguages = [...langs];
    }
    await ctx.progress(20, `evidence: ${evidence.source}`);

    const files = new Map<string, { path: string; encoding: AudioEncoding; sampleRateHz: number | null }>();
    const ai = await ctx.services.ai({ sink: ctx.cost, assetResolver: fileAssetResolver(files), varietyId: expectedVariety });

    let sttSample: { skipped: string | null; detectedLanguage: string | null; languageMismatch: boolean } = { skipped: null, detectedLanguage: null, languageMismatch: false };
    if (!transcript && ctx.params.allowStt && masterAsset && masterAsset.kind === 'audio') {
      const sttLocale = expectedVariety ? providerLocaleFor(expectedVariety) : null;
      if (!sttLocale) sttSample.skipped = 'no expected variety: speech recognition needs a locale (set params.locale)';
      else {
        const cap = await ai.recognizer.supports(sttLocale, masterAsset.mime_type);
        if (!cap.supported) sttSample.skipped = `speech recognition unsupported for ${sttLocale}`;
        else {
          const local = await downloadToWorkDir(ctx, masterAsset.storage_key, masterFilename(masterAsset));
          const profile = decideTranscodeProfile({ channels: 1, bitrateKbps: null, codec: null, sampleRateHz: null, durationMs: null, speechOnly: true }).aac;
          const sample = join(ctx.workDir, 'sample.m4a');
          const res = await ffmpeg.run(buildClipCommand({ input: local.path, output: sample, startMs: 0, endMs: ctx.params.sampleSeconds * 1000, mode: 'encode', profile }), { signal: ctx.signal });
          ctx.cost.ffmpeg(res.durationMs);
          ctx.cost.assertBudget();
          const id = crypto.randomUUID();
          files.set(id, { path: sample, encoding: 'm4a', sampleRateHz: profile.sampleRateHz });
          const result = await ai.recognizer.transcribe({ source: 'asset', assetId: id, encoding: 'm4a', sampleRateHz: profile.sampleRateHz }, sttLocale);
          evidence.source = 'stt_sample';
          evidence.sampleSeconds = ctx.params.sampleSeconds;
          evidence.text = result.segments.map((s) => `[${(s.startMs / 1000).toFixed(1)}s] ${s.text}`).join('\n').slice(0, ctx.params.maxEvidenceChars) || result.text.slice(0, ctx.params.maxEvidenceChars);
          evidence.segmentLanguages = result.detectedLanguage ? [result.detectedLanguage.code] : [];
          sttSample = { skipped: null, detectedLanguage: result.detectedLanguage?.code ?? null, languageMismatch: result.languageMismatch };
        }
      }
    } else if (!transcript && !ctx.params.allowStt) sttSample.skipped = 'allowStt=false';
    await ctx.progress(55, 'inferring');

    // --- LLM inference ---
    const track: CourseTrackId = expectedVariety ? trackForVarietyOrThrow(expectedVariety) : 'english';
    const languageContext = jobLanguageContext(ctx, { track, sourceLanguage });
    ctx.cost.assertBudget();
    const prompt = buildInferencePrompt({ evidence, sourceLanguage, expectedVariety, mode });
    const suggestionRaw = await ai.reasoner.generateStructured('scene_planning', languageContext, prompt, MetadataSuggestionSchema, { traceId: ctx.traceId });
    // Sanitise: only known codes / variety ids survive; everything else is reported but dropped.
    const dropped: string[] = [];
    const suggestion: MetadataSuggestion = {
      ...suggestionRaw,
      likelyLanguages: suggestionRaw.likelyLanguages.filter((l) => {
        const ok = (LANGUAGE_CODES as readonly string[]).includes(l.code.split('-')[0] ?? l.code);
        if (!ok) dropped.push(`language:${l.code}`);
        return ok;
      }),
      likelyVariety: { ...suggestionRaw.likelyVariety, varietyId: suggestionRaw.likelyVariety.varietyId && isVarietyId(suggestionRaw.likelyVariety.varietyId) ? suggestionRaw.likelyVariety.varietyId : null },
      instructionLanguage: { ...suggestionRaw.instructionLanguage, code: suggestionRaw.instructionLanguage.code && isSourceLanguageCode(suggestionRaw.instructionLanguage.code) ? suggestionRaw.instructionLanguage.code : null },
    };
    if (suggestionRaw.likelyVariety.varietyId && !suggestion.likelyVariety.varietyId) dropped.push(`variety:${suggestionRaw.likelyVariety.varietyId}`);
    const varietyConflict = expectedVariety !== null && suggestion.likelyVariety.varietyId !== null && suggestion.likelyVariety.varietyId !== expectedVariety;

    const provenance = { task: 'scene_planning', role: 'metadata_inference', promptVersion: INFER_PROMPT_VERSION, traceId: ctx.traceId, jobId: ctx.job.id, evidenceSource: evidence.source, generatedAt: ctx.services.now().toISOString(), reviewStatus: 'review_needed', autoApplied: false };
    await ctx.progress(80, 'storing suggestions');

    if (lessonId && suggestion.topics.length) {
      await db.upsertLessonTopics(suggestion.topics.map((t) => ({ lesson_id: lessonId, topic_key: t.topicKey, confidence: t.confidence, provenance: 'ai_suggested' as const })));
    }
    if (masterAsset) {
      await db.recordProvenance({ asset_id: masterAsset.id, event_type: 'edited', actor_id: ctx.job.requested_by, job_id: ctx.job.id, details: { action: 'ai_metadata_suggested', mode, suggestion, provenance, sttSample, varietyConflict, dropped } as never });
    }
    await ctx.progress(100);
    return {
      output: { assetId: masterAsset?.id ?? null, lessonId, mode, evidence: { source: evidence.source, transcriptId: evidence.transcriptId, sampleSeconds: evidence.sampleSeconds, chars: evidence.text.length }, suggestion, provenance, sttSample, varietyConflict, dropped, applied: false },
      outputAssetIds: masterAsset ? [masterAsset.id] : [],
    };
  },
};
