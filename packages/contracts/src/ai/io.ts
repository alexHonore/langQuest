/**
 * Audio / transcript / pronunciation input-output shapes shared by adapters and the API.
 */
import { z } from 'zod';
import { VarietyIdSchema } from '../catalog';
import { AssessmentModeSchema, IntelligibilitySchema, PronunciationConfidenceSchema, isAcousticAssessmentMode } from '../enums';
import { MillisSchema, PercentSchema, UnitIntervalSchema, UuidSchema, UrlSchema } from '../primitives';
import { PronunciationFeatureSchema } from './capability';

export const AudioEncodingSchema = z.enum(['pcm16', 'opus', 'aac', 'mp3', 'wav', 'flac', 'webm_opus', 'm4a']);
export type AudioEncoding = z.infer<typeof AudioEncodingSchema>;

/** Audio handed to an adapter: either an R2 asset, a short-lived URL, or inline base64 (small clips only). */
export const AudioInputSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('asset'), assetId: UuidSchema, encoding: AudioEncodingSchema, sampleRateHz: z.number().int().positive().nullable() }),
  z.object({ source: z.literal('url'), url: UrlSchema, encoding: AudioEncodingSchema, sampleRateHz: z.number().int().positive().nullable() }),
  z.object({ source: z.literal('inline'), base64: z.string().min(1).max(8_000_000), encoding: AudioEncodingSchema, sampleRateHz: z.number().int().positive().nullable() }),
]);
export type AudioInput = z.infer<typeof AudioInputSchema>;

export const AudioOutputSchema = z.object({
  encoding: AudioEncodingSchema,
  sampleRateHz: z.number().int().positive(),
  durationMs: MillisSchema,
  /** Persisted asset id when the output was cached (approved static content). */
  assetId: UuidSchema.nullable(),
  /** Short-lived URL for playback (null when inline). */
  url: UrlSchema.nullable(),
  base64: z.string().nullable(),
  provider: z.string(),
  voiceId: z.string(),
  /** Always true for TTS; surfaced to the learner. */
  synthetic: z.literal(true),
  cached: z.boolean(),
});
export type AudioOutput = z.infer<typeof AudioOutputSchema>;

export const TranscriptWordSchema = z.object({
  text: z.string(),
  startMs: MillisSchema,
  endMs: MillisSchema,
  confidence: UnitIntervalSchema.nullable(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const TranscriptSegmentSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  startMs: MillisSchema,
  endMs: MillisSchema,
  confidence: UnitIntervalSchema.nullable(),
  speakerLabel: z.string().nullable(),
  /** Language detected for this segment (code-switch aware). */
  language: z.string().nullable(),
  words: z.array(TranscriptWordSchema),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptResultSchema = z.object({
  text: z.string(),
  segments: z.array(TranscriptSegmentSchema),
  confidence: UnitIntervalSchema.nullable(),
  /** BCP-47/ISO code the recognizer believes it heard, with confidence. */
  detectedLanguage: z.object({ code: z.string(), confidence: UnitIntervalSchema.nullable() }).nullable(),
  /** Locale the recognizer was configured with. */
  requestedLocale: z.string(),
  provider: z.string(),
  model: z.string(),
  durationMs: MillisSchema.nullable(),
  /** Set when the recognizer reports the audio is not in the requested variety. */
  languageMismatch: z.boolean(),
});
export type TranscriptResult = z.infer<typeof TranscriptResultSchema>;

export const PronunciationInputSchema = z.object({
  audio: AudioInputSchema,
  targetVarietyId: VarietyIdSchema,
  /** Provider locale (e.g. `ar-EG`) — must map to the variety, never a neighbour. */
  locale: z.string(),
  referenceText: z.string().min(1),
  /** Optional romanized/phonemic reference when the scorer needs it. */
  referencePhonemes: z.string().nullable(),
  expressionId: UuidSchema.nullable(),
  requestedFeatures: z.array(PronunciationFeatureSchema),
});
export type PronunciationInput = z.infer<typeof PronunciationInputSchema>;

export const WordScoreSchema = z.object({
  word: z.string(),
  startMs: MillisSchema.nullable(),
  endMs: MillisSchema.nullable(),
  accuracy: PercentSchema.nullable(),
  errorType: z.enum(['none', 'mispronunciation', 'omission', 'insertion', 'unexpected_break', 'missing_break', 'monotone']).nullable(),
});
export type WordScore = z.infer<typeof WordScoreSchema>;

export const PhonemeHintSchema = z.object({
  phoneme: z.string(),
  word: z.string().nullable(),
  accuracy: PercentSchema.nullable(),
  /** Localized guidance key (mouth/stress/tone tip). */
  guidanceKey: z.string().nullable(),
});
export type PhonemeHint = z.infer<typeof PhonemeHintSchema>;

export const ToneHintSchema = z.object({
  syllable: z.string(),
  expectedTone: z.string(),
  heardTone: z.string().nullable(),
  confidence: UnitIntervalSchema.nullable(),
});
export type ToneHint = z.infer<typeof ToneHintSchema>;

/**
 * Pronunciation sub-result (§6.5). Invariant: `numericScore` is non-null ONLY when
 * `assessmentMode` is an acoustic-assessor mode. Reference comparison, semantic-only
 * and unavailable modes must report `null`.
 */
export const PronunciationAssessmentSchema = z
  .object({
    assessmentMode: AssessmentModeSchema,
    numericScore: PercentSchema.nullable(),
    confidence: PronunciationConfidenceSchema,
    feedback: z.array(z.string()).max(5),
    /** Which features the scorer genuinely evaluated. */
    featuresAssessed: z.array(PronunciationFeatureSchema),
    wordScores: z.array(WordScoreSchema),
    phonemeHints: z.array(PhonemeHintSchema),
    toneHints: z.array(ToneHintSchema),
    /** Segment to highlight for retry, if any. */
    highlightedSegment: z.object({ startMs: MillisSchema, endMs: MillisSchema, text: z.string() }).nullable(),
    provider: z.string().nullable(),
    scorerVersion: z.string().nullable(),
  })
  .superRefine((value, issues) => {
    if (value.numericScore !== null && !isAcousticAssessmentMode(value.assessmentMode)) {
      issues.addIssue({
        code: 'custom',
        path: ['numericScore'],
        message: `numericScore must be null unless assessmentMode is an acoustic assessor mode (got ${value.assessmentMode})`,
      });
    }
    if (!isAcousticAssessmentMode(value.assessmentMode) && (value.wordScores.some((w) => w.accuracy !== null) || value.phonemeHints.some((p) => p.accuracy !== null))) {
      issues.addIssue({ code: 'custom', path: ['wordScores'], message: 'Word/phoneme accuracy values require an acoustic assessor mode' });
    }
    if (value.assessmentMode === 'acoustic-assessor' && value.confidence === 'none') {
      issues.addIssue({ code: 'custom', path: ['confidence'], message: 'An acoustic assessment cannot have confidence "none"' });
    }
  });
export type PronunciationAssessment = z.infer<typeof PronunciationAssessmentSchema>;

/** Adapter-level result returned by `PronunciationAssessor.assess`. */
export const PronunciationResultSchema = z.object({
  targetVarietyId: VarietyIdSchema,
  locale: z.string(),
  transcript: TranscriptResultSchema.nullable(),
  pronunciation: PronunciationAssessmentSchema,
  latencyMs: MillisSchema.nullable(),
});
export type PronunciationResult = z.infer<typeof PronunciationResultSchema>;

/** §6.5 — learner-facing speech evaluation result. */
export const SpeechEvaluationResultSchema = z.object({
  assessmentId: UuidSchema,
  targetVarietyId: VarietyIdSchema,
  semanticIntentMatched: z.boolean(),
  meaningConfidence: UnitIntervalSchema,
  intelligibility: IntelligibilitySchema,
  pronunciation: PronunciationAssessmentSchema,
  shouldAdvanceConversation: z.boolean(),
  /** Transcript the meaning judgement was based on (learner may hide it). */
  transcript: z.string().nullable(),
  /** Matched intent / skill keys, for observations. */
  matchedIntentIds: z.array(z.string()),
});
export type SpeechEvaluationResult = z.infer<typeof SpeechEvaluationResultSchema>;

/** Build an honest "no acoustic scorer" pronunciation block. */
export const referenceComparisonAssessment = (feedback: string[], humanCalibrated = false): PronunciationAssessment =>
  PronunciationAssessmentSchema.parse({
    assessmentMode: humanCalibrated ? 'human-calibrated-reference-comparison' : 'reference-comparison',
    numericScore: null,
    confidence: 'limited',
    feedback,
    featuresAssessed: [],
    wordScores: [],
    phonemeHints: [],
    toneHints: [],
    highlightedSegment: null,
    provider: null,
    scorerVersion: null,
  });
