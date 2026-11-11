/**
 * AI pronunciation feedback: an audio-capable model on OpenRouter listens to a learner's take of an approved phrase
 * and gives a score, word by word statuses and tips, in the learner's instruction language.
 *
 * Honesty (ADR-006 still holds for acoustic scores): this is a model *listening*, not an acoustic measurement. It is
 * returned as its own result (`method: 'ai_listening'`), never as a `PronunciationAssessment.numericScore`, and it is
 * never recorded as mastery evidence. The prompt makes the model transcribe what it hears in IPA before comparing it
 * with the expected IPA, because a model told the target phrase otherwise tends to "hear" the target (probe of
 * 2026-11-11: a silent-h error went unnoticed until the IPA-first step; afterwards a native take scored 100, an
 * English-accented take 62, the silent-h error 75 with the right tip, another language 0).
 */
import { z } from 'zod';
import type { SourceLanguageCode, VarietyId } from '@langquest/contracts';
import type { ChatCompletionResult, OpenRouterClient } from '../openrouter/client';
import type { ModelProfileRegistry } from '../profiles';
import type { AiAttribution, AiAttributionSource, AiRequestSink } from '../reasoner';
import { resolveAttribution } from '../reasoner';
import { bytesToBase64, newId, nowIso } from '../util';

/** Listening models, first choice first (Gemini Flash hears audio parts on OpenRouter). */
export const PRONUNCIATION_JUDGE_MODELS = ['google/gemini-3.8-flash', 'google/gemini-3.5-flash-lite'] as const;
export const PRONUNCIATION_JUDGE_VERSION = 'ai-listening@2026-11-11.1';

/** Formats the listening models accept as `input_audio`. */
export type JudgeAudioFormat = 'wav' | 'mp3';

const SOURCE_NAMES: Record<string, string> = { en: 'English', fr: 'French', es: 'Spanish', ru: 'Russian', ar: 'Arabic', pt: 'Portuguese', de: 'German', it: 'Italian' };

export interface PronunciationJudgeInput {
  audio: { bytes: Uint8Array; format: JudgeAudioFormat };
  /** The approved phrase the learner was asked to say, in its native script. */
  targetText: string;
  /** Its romanization, when the course shows one (helps the model with non-Latin scripts). */
  transliteration?: string | null;
  /** The variety in words, e.g. "Spanish (Spain, Castilian)", "Moroccan Arabic (Darija)". */
  varietyName: string;
  /** The learner's instruction language (ISO 639-1): tips are written in it. */
  sourceLanguage: string;
  /** The course's variety: the `pronunciation_feedback` model profile is resolved for it (an admin may override it). */
  targetVariety?: VarietyId;
}

export const JudgedWordSchema = z.object({
  word: z.string().min(1),
  status: z.enum(['good', 'unclear', 'mispronounced', 'missing']),
  tip: z.string().nullable().optional(),
});

/** What the model must answer (validated; anything else is a failed judgement). */
export const JudgementOutputSchema = z.object({
  targetIpa: z.string().default(''),
  heardIpa: z.string().default(''),
  heard: z.string().default(''),
  matchesTarget: z.boolean(),
  score: z.number(),
  words: z.array(JudgedWordSchema).max(40),
  summary: z.string().default(''),
  tip: z.string().default(''),
});

export type PronunciationBand = 'native_like' | 'clear_accent' | 'hard_to_understand' | 'off_target';

export interface PronunciationJudgement {
  score: number;
  band: PronunciationBand;
  matchesTarget: boolean;
  heard: string;
  heardIpa: string;
  targetIpa: string;
  words: { word: string; status: z.infer<typeof JudgedWordSchema>['status']; tip: string | null }[];
  summary: string;
  tip: string;
  model: string;
  version: string;
  latencyMs: number;
  costUsd: number | null;
}

/** The band a score falls in; a take that does not say the phrase is off target whatever its sound. */
export function bandFor(score: number, matchesTarget: boolean): PronunciationBand {
  if (!matchesTarget || score < 30) return 'off_target';
  if (score >= 90) return 'native_like';
  if (score >= 55) return 'clear_accent';
  return 'hard_to_understand';
}

/** The instructions given to the listening model. Pure, so tests can read it. */
export function judgePrompt(input: Omit<PronunciationJudgeInput, 'audio'>): string {
  const learner = SOURCE_NAMES[input.sourceLanguage] ?? input.sourceLanguage;
  const roman = input.transliteration ? ` (romanized: "${input.transliteration}")` : '';
  return [
    `You are a strict, encouraging pronunciation coach for learners whose first language is ${learner}, learning ${input.varietyName}.`,
    `The learner was asked to say: "${input.targetText}"${roman}.`,
    `Do NOT assume the learner said it correctly. First recall the pronunciation errors ${learner} speakers typically make in ${input.varietyName} (vowels, consonants, stress, tones or length where they matter), then listen for them.`,
    'Step 1 ("targetIpa"): the expected native pronunciation of the phrase in this variety, in IPA.',
    'Step 2 ("heardIpa"): exactly what you hear, sound by sound, in IPA, as if you did not know the target.',
    'Step 3: compare heardIpa with targetIpa word by word. A word with any wrong sound is "mispronounced"; a word you cannot make out is "unclear"; a word not said is "missing".',
    'Step 4 ("score", an integer 0-100): native-like 90-100; understandable with a clear foreign accent 55-80; hard to understand 30-55; wrong words, another language or no speech below 30 (and "matchesTarget": false).',
    `Write "summary" (one sentence), "tip" (the single most useful thing to practise) and every word "tip" in ${learner}, simply, for a beginner. List "words" in the order of the target phrase, spelled exactly as in it.`,
    'Answer with JSON only: {"targetIpa": string, "heardIpa": string, "heard": string (what you heard, in the target script), "matchesTarget": boolean, "score": integer, "words": [{"word": string, "status": "good"|"unclear"|"mispronounced"|"missing", "tip": string|null}], "summary": string, "tip": string}',
  ].join('\n');
}

/** Pull the JSON object out of a model answer (tolerates code fences or a sentence around it). */
export function parseJudgement(content: string): z.infer<typeof JudgementOutputSchema> | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JudgementOutputSchema.safeParse(JSON.parse(content.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class PronunciationJudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PronunciationJudgeError';
  }
}

export interface LlmPronunciationJudgeOptions {
  client: Pick<OpenRouterClient, 'chatCompletions'>;
  sink?: AiRequestSink | null;
  attribution?: AiAttributionSource | null;
  models?: readonly string[];
  /** Model profiles: the `pronunciation_feedback` profile (an admin's override, else the package default) picks the models. */
  profiles?: Pick<ModelProfileRegistry, 'find'> | null;
}

export class LlmPronunciationJudge {
  private readonly client: Pick<OpenRouterClient, 'chatCompletions'>;
  private readonly sink: AiRequestSink | null;
  private readonly attribution: AiAttributionSource | null;
  private readonly profiles: Pick<ModelProfileRegistry, 'find'> | null;
  readonly models: readonly string[];

  constructor(options: LlmPronunciationJudgeOptions) {
    this.client = options.client;
    this.sink = options.sink ?? null;
    this.attribution = options.attribution ?? null;
    this.models = options.models ?? PRONUNCIATION_JUDGE_MODELS;
    this.profiles = options.profiles ?? null;
  }

  /** The listening models for [input]: its profile's primary and fallbacks, else the built-in list. */
  modelsFor(input: Pick<PronunciationJudgeInput, 'targetVariety' | 'sourceLanguage'>): readonly string[] {
    if (!this.profiles || !input.targetVariety) return this.models;
    const profile = this.profiles.find({ task: 'pronunciation_feedback', targetVariety: input.targetVariety, sourceLanguage: input.sourceLanguage as SourceLanguageCode });
    return profile ? [profile.primaryModel, ...profile.fallbackModels] : this.models;
  }

  async judge(input: PronunciationJudgeInput, options: { traceId?: string; enrollmentId?: string | null; signal?: AbortSignal } = {}): Promise<PronunciationJudgement> {
    const traceId = options.traceId ?? newId();
    const attribution = resolveAttribution(this.attribution, options.enrollmentId !== undefined ? { enrollmentId: options.enrollmentId } : null);
    const started = Date.now();
    const models = this.modelsFor(input);
    let result: ChatCompletionResult;
    try {
      result = await this.client.chatCompletions(
        {
          models,
          temperature: 0,
          responseFormat: { type: 'json_object' },
          maxTokens: 1200,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: judgePrompt(input) },
                { type: 'input_audio', input_audio: { data: bytesToBase64(input.audio.bytes), format: input.audio.format } },
              ],
            },
          ],
        },
        { timeoutMs: 25_000, maxRetries: 1, signal: options.signal, requestId: traceId, tags: { task: 'pronunciation_feedback', traceId } },
      );
    } catch (error) {
      await this.record({ traceId, attribution, model: models[0] ?? 'unknown', latencyMs: Date.now() - started, success: false, errorCode: (error as { kind?: string }).kind ?? 'unknown', cost: null, usage: null });
      throw error;
    }
    const output = parseJudgement(result.content);
    await this.record({ traceId, attribution, model: result.model, latencyMs: result.latencyMs, success: output !== null, errorCode: output ? null : 'invalid_output', cost: result.estimatedCostUsd, usage: result.usage });
    if (!output) throw new PronunciationJudgeError('The listening model did not return a usable judgement');
    const score = Math.max(0, Math.min(100, Math.round(output.score)));
    return {
      score,
      band: bandFor(score, output.matchesTarget),
      matchesTarget: output.matchesTarget,
      heard: output.heard,
      heardIpa: output.heardIpa,
      targetIpa: output.targetIpa,
      words: output.words.map((w) => ({ word: w.word, status: w.status, tip: w.tip?.trim() ? w.tip.trim() : null })),
      summary: output.summary,
      tip: output.tip,
      model: result.model,
      version: PRONUNCIATION_JUDGE_VERSION,
      latencyMs: Date.now() - started,
      costUsd: result.estimatedCostUsd,
    };
  }

  private async record(input: {
    traceId: string;
    attribution: Required<AiAttribution>;
    model: string;
    latencyMs: number;
    success: boolean;
    errorCode: string | null;
    cost: number | null;
    usage: { inputTokens: number | null; outputTokens: number | null } | null;
  }): Promise<void> {
    if (!this.sink) return;
    await this.sink.record({
      occurredAt: nowIso(),
      userId: input.attribution.userId,
      enrollmentId: input.attribution.enrollmentId,
      task: 'pronunciation_feedback',
      provider: 'openrouter',
      model: input.model,
      profileId: null,
      fallbackIndex: 0,
      latencyMs: input.latencyMs,
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
      audioSeconds: null,
      estimatedCostUsd: input.cost,
      success: input.success,
      errorCode: input.errorCode,
      traceId: input.traceId,
      redactedLog: { method: 'ai_listening', version: PRONUNCIATION_JUDGE_VERSION },
    });
  }
}
