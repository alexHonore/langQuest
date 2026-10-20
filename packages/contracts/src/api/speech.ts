/** §6.2 — speaking and AI endpoints. */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { CapabilitySchema } from '../ai/capability';
import { CharacterTurnSchema, ConversationSessionStateSchema, EvaluatorOutputSchema, LearnerTurnInputSchema, ShortLivedSessionSchema } from '../ai/conversation';
import { AudioEncodingSchema, AudioInputSchema, AudioOutputSchema, SpeechEvaluationResultSchema, TranscriptResultSchema } from '../ai/io';
import { AiTaskNameSchema } from '../ai/model-profile';
import { ConversationModeSchema, ConversationStateSchema, SpeechRetentionSchema } from '../enums';
import { KeySchema, MillisSchema, NonNegativeIntSchema, TimestamptzSchema, UuidSchema } from '../primitives';
import { PronunciationFeatureSchema } from '../ai/capability';

// --- speech detection (non-speech / recognizer-hallucination gate) ----------

/**
 * Why a learner recording was NOT credited as speech: the honest "I didn't hear you, try again" outcome. The server's
 * gate (`@langquest/ai/speech/speech-detection`) decides this before any meaning judgement, score, skill or XP credit:
 * - `empty_transcript`: the recognizer returned nothing (or punctuation only);
 * - `silent_audio`: the server measured the decoded PCM/WAV clip as silent (peak below the silence floor);
 * - `client_silence`: the recorder's own metering never rose above the silence floor during the take;
 * - `no_speech_probability`: every segment is silence by the recognizer's own no-speech / log-probability signals;
 * - `known_hallucination`: the transcript is only a known recognizer silence hallucination (YouTube outros,
 *   subtitle credits such as "Sous-titres réalisés par la communauté d'Amara.org", "ご視聴ありがとうございました");
 * - `non_speech_annotation`: only annotations such as "[Music]" / "♪";
 * - `repetition_loop`: a repetitive decoding loop: the recognizer's own `compression_ratio` above Whisper's threshold (2.4)
 *   on every segment, or a repetitive text with weak acoustic evidence.
 */
export const NO_SPEECH_REASON_VALUES = ['empty_transcript', 'silent_audio', 'client_silence', 'no_speech_probability', 'known_hallucination', 'non_speech_annotation', 'repetition_loop'] as const;
export const NoSpeechReasonSchema = z.enum(NO_SPEECH_REASON_VALUES);
export type NoSpeechReason = z.infer<typeof NoSpeechReasonSchema>;

/** Server verdict on a learner recording: `reason` is set exactly when no speech was detected. */
export const SpeechDetectionSchema = z
  .object({ speechDetected: z.boolean(), reason: NoSpeechReasonSchema.nullable() })
  .refine((v) => v.speechDetected === (v.reason === null), { message: 'reason is set exactly when speechDetected is false', path: ['reason'] });
export type SpeechDetection = z.infer<typeof SpeechDetectionSchema>;

/**
 * Optional recorder metadata sent with a learner recording. It can only make the outcome more conservative: a take whose
 * metering never rose above the silence floor is answered "no speech" without a recognizer call; it never earns credit.
 */
export const RecordingSignalsSchema = z.object({
  /** Loudest recorder metering sample of the take in dBFS (expo-audio `metering`); null when metering was unavailable. */
  peakLevelDb: z.number().min(-200).max(20).nullable(),
});
export type RecordingSignals = z.infer<typeof RecordingSignalsSchema>;

// --- conversation -----------------------------------------------------------

/**
 * What the session practises. `mission` scopes the character to a mission's objectives; `audio_lesson`
 * grounds it in a library lesson (optionally specific transcript segments the learner picked); `free`
 * is open conversation in the enrollment's variety. Persisted as sent (`conversation_sessions.scope`).
 */
export const ConversationSessionScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mission'), missionId: UuidSchema }),
  z.object({ kind: z.literal('audio_lesson'), audioLessonId: UuidSchema, transcriptSegmentIds: z.array(UuidSchema).max(200).optional() }),
  z.object({ kind: z.literal('free') }),
]);
export type ConversationSessionScope = z.infer<typeof ConversationSessionScopeSchema>;

export const ConversationSessionCreateRequestSchema = z
  .object({
    enrollmentId: UuidSchema,
    missionId: UuidSchema.optional(),
    scenarioId: UuidSchema.optional(),
    characterId: UuidSchema.optional(),
    mode: ConversationModeSchema.default('push_to_talk'),
    /** Client-generated idempotency key for session creation. */
    clientSessionId: UuidSchema,
    inputEncoding: AudioEncodingSchema.default('opus'),
    speechRetention: SpeechRetentionSchema.optional(),
    /** Optional; when omitted the server derives `mission` from `missionId` or `free`. */
    scope: ConversationSessionScopeSchema.optional(),
  })
  .refine((v) => !v.scope || v.scope.kind !== 'mission' || !v.missionId || v.scope.missionId === v.missionId, { message: 'scope.missionId must match missionId', path: ['scope', 'missionId'] });
export type ConversationSessionCreateRequest = z.infer<typeof ConversationSessionCreateRequestSchema>;

export const ConversationSessionCreateResponseSchema = z.object({
  session: ConversationSessionStateSchema,
  provider: ShortLivedSessionSchema,
  character: z.object({ id: UuidSchema, name: z.string(), role: z.string(), targetVarietyId: VarietyIdSchema, syntheticVoice: z.boolean(), portraitAssetId: UuidSchema.nullable() }),
  /** Honest capability snapshot so the UI never shows an unavailable waveform/score. */
  capabilities: z.object({ realtime: CapabilitySchema, recognition: CapabilitySchema, synthesis: CapabilitySchema, pronunciation: CapabilitySchema }),
  objectives: z.array(z.object({ id: z.string(), description: z.string(), skillKeys: z.array(KeySchema) })),
  /** Opening character turn (may be null when the learner should start). */
  openingTurn: CharacterTurnSchema.nullable(),
});
export type ConversationSessionCreateResponse = z.infer<typeof ConversationSessionCreateResponseSchema>;

/**
 * Short inline audio clip sent with a turn (no prior upload). `mime` is the container type
 * (e.g. `audio/webm;codecs=opus`, `audio/mp4`); `durationMs` is the client-measured length.
 */
export const InlineAudioClipSchema = z.object({
  base64: z.string().min(1).max(8_000_000),
  mime: z.string().min(1).max(120),
  durationMs: MillisSchema,
});
export type InlineAudioClip = z.infer<typeof InlineAudioClipSchema>;

/**
 * Audio accepted inline on a conversation turn: the generic `AudioInput` or a bare clip. The API serves learner audio
 * only inline or as the learner's own stored recording (`asset`): a caller-supplied `url` is refused with 422
 * `validation_failed` before anything is fetched (the Worker would otherwise fetch any host, internal ones included,
 * and forward the bytes to the paid recognizer). The shape stays in the union so the refusal names the field.
 */
export const ConversationTurnAudioSchema = z.union([AudioInputSchema, InlineAudioClipSchema]);
export type ConversationTurnAudio = z.infer<typeof ConversationTurnAudioSchema>;

/**
 * Replay semantics (`ROUTES.conversationTurn`): `clientTurnId` is the idempotency key. A completed turn replays
 * the original character turn (`replayed: true`); a turn still in flight answers `turn_in_progress` (409) with
 * `Retry-After` seconds and `details.retryAfterSeconds` — the client retries the SAME id, never a new one.
 */
export const ConversationTurnRequestSchema = z.object({
  /** Client-generated; a replay returns the original character turn (never a duplicate LLM response). */
  clientTurnId: UuidSchema,
  input: LearnerTurnInputSchema,
  /**
   * Optional inline audio for an `input.kind === 'audio'` turn whose clip was not uploaded first
   * (`input.assetId` may then be a client placeholder). The server stores it under the session's
   * retention preference and transcribes it; omitted when the clip is referenced by `assetId` only.
   */
  audio: ConversationTurnAudioSchema.optional(),
  /** Recorder metering for an audio turn (optional; see `RecordingSignalsSchema`). */
  recording: RecordingSignalsSchema.optional(),
  /** Short client state so the server can recover after a disconnect. */
  clientState: z.object({ state: ConversationStateSchema, lastSeq: NonNegativeIntSchema, lastCharacterTurnId: UuidSchema.nullable() }),
  /** True when the learner interrupted the character mid-utterance (barge-in). */
  bargeIn: z.boolean().default(false),
});
export type ConversationTurnRequest = z.infer<typeof ConversationTurnRequestSchema>;

export const ConversationTurnResponseSchema = z.object({
  session: ConversationSessionStateSchema,
  learnerTranscript: z.object({ text: z.string(), confidence: z.number().min(0).max(1).nullable() }).nullable(),
  characterTurn: CharacterTurnSchema.nullable(),
  replayed: z.boolean(),
  /** Evaluation runs async; the client polls/receives it on `end` or via events. */
  evaluationPending: z.boolean(),
  objectivesCompleted: z.array(z.string()),
  /**
   * Set on audio turns. `speechDetected: false` is the honest "I didn't hear you" outcome: no learner turn is recorded,
   * the character does not answer (`characterTurn: null`, `learnerTranscript: null`) and nothing is credited.
   */
  speech: SpeechDetectionSchema.optional(),
});
export type ConversationTurnResponse = z.infer<typeof ConversationTurnResponseSchema>;

export const ConversationEndRequestSchema = z.object({
  reason: z.enum(['completed', 'learner_ended', 'timeout', 'error', 'abandoned']),
  clientState: z.object({ lastSeq: NonNegativeIntSchema, turnCount: NonNegativeIntSchema }),
  /** Client event id for the XP award. */
  clientEventId: UuidSchema,
});
export type ConversationEndRequest = z.infer<typeof ConversationEndRequestSchema>;
export const ConversationEndResponseSchema = z.object({
  session: ConversationSessionStateSchema,
  evaluation: EvaluatorOutputSchema,
  xpAwarded: NonNegativeIntSchema,
  scheduledReviews: z.array(z.object({ cardId: UuidSchema, targetKind: z.enum(['expression', 'skill']), targetId: z.string(), due: TimestamptzSchema })),
  /** Safe concise summary persisted (raw transcript only with opt-in retention). */
  summary: z.string(),
  transcriptRetained: z.boolean(),
});
export type ConversationEndResponse = z.infer<typeof ConversationEndResponseSchema>;

// --- transcribe -------------------------------------------------------------

export const TranscribeRequestSchema = z.object({
  enrollmentId: UuidSchema,
  targetVarietyId: VarietyIdSchema,
  audio: AudioInputSchema,
  /** Reference text when the recording is a repeat/anticipation step (improves alignment, never fabricates scores). */
  expectedText: z.string().max(1000).optional(),
  clientRequestId: UuidSchema,
  /** Recorder metering for the take (optional; see `RecordingSignalsSchema`). */
  recording: RecordingSignalsSchema.optional(),
});
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;
export const TranscribeResponseSchema = z.object({
  /** `text` is '' (no segments) when no speech was detected; `speech.reason` says why. */
  transcript: TranscriptResultSchema,
  capability: CapabilitySchema,
  /** Stored only under the learner's retention preference (never for a take without speech). */
  recordingAssetId: UuidSchema.nullable(),
  /** Non-speech gate verdict (optional for older servers). */
  speech: SpeechDetectionSchema.optional(),
});
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;

// --- pronunciation ----------------------------------------------------------

export const PronunciationAssessRequestSchema = z
  .object({
    enrollmentId: UuidSchema,
    targetVarietyId: VarietyIdSchema,
    expressionId: UuidSchema.optional(),
    /** Required when no `expressionId`; must be approved content, not free text from the client. */
    referenceText: z.string().min(1).max(500).optional(),
    audio: AudioInputSchema,
    requestedFeatures: z.array(PronunciationFeatureSchema).default(['word']),
    clientRequestId: UuidSchema,
    scenarioId: z.string().optional(),
    /** Recorder metering for the take (optional; see `RecordingSignalsSchema`). */
    recording: RecordingSignalsSchema.optional(),
  })
  .refine((v) => v.expressionId !== undefined || v.referenceText !== undefined, { message: 'expressionId or referenceText is required', path: ['expressionId'] });
export type PronunciationAssessRequest = z.infer<typeof PronunciationAssessRequestSchema>;

/**
 * §6.5 exact result shape; see `PronunciationAssessmentSchema` for the numericScore refinement. A take without speech
 * answers `intelligibility: 'no_speech_detected'` with `semanticIntentMatched: false`, `meaningConfidence: 0`,
 * `transcript: null`, `shouldAdvanceConversation: false` and an `unavailable` pronunciation block (no score).
 */
export const PronunciationAssessResponseSchema = SpeechEvaluationResultSchema;
export type PronunciationAssessResponse = z.infer<typeof PronunciationAssessResponseSchema>;

// --- synthesize -------------------------------------------------------------

export const SynthesizeRequestSchema = z.object({
  enrollmentId: UuidSchema,
  targetVarietyId: VarietyIdSchema,
  /** Approved content reference preferred; free text only for character turns generated server-side. */
  expressionId: UuidSchema.optional(),
  text: z.string().min(1).max(1200).optional(),
  voiceId: z.string().optional(),
  regionalOption: z.string().optional(),
  speed: z.enum(['slow', 'normal']).default('normal'),
  outputEncoding: AudioEncodingSchema.default('aac'),
}).refine((v) => v.expressionId !== undefined || v.text !== undefined, { message: 'expressionId or text is required', path: ['text'] });
export type SynthesizeRequest = z.infer<typeof SynthesizeRequestSchema>;
export const SynthesizeResponseSchema = z.object({ audio: AudioOutputSchema, capability: CapabilitySchema });
export type SynthesizeResponse = z.infer<typeof SynthesizeResponseSchema>;

// --- capabilities -----------------------------------------------------------

export const ModelCapabilitiesQuerySchema = z.object({
  trackId: CourseTrackIdSchema,
  regionalOption: z.string().optional(),
  /** Resolve capabilities for a specific enrollment (its variety, source language and regional preference). */
  enrollmentId: UuidSchema.optional(),
  /** Source (instruction) language to report coaching/explanation capability for; never silently substituted. */
  source: SourceLanguageCodeSchema.optional(),
});
export type ModelCapabilitiesQuery = z.infer<typeof ModelCapabilitiesQuerySchema>;
export const TaskCapabilitySchema = z.object({
  task: AiTaskNameSchema,
  capability: CapabilitySchema,
  /** Profile version (never model ids leaked beyond what admin exposes as public). */
  profileVersion: NonNegativeIntSchema.nullable(),
});
export type TaskCapability = z.infer<typeof TaskCapabilitySchema>;
export const ModelCapabilitiesResponseSchema = z.object({
  trackId: CourseTrackIdSchema,
  targetVarietyId: VarietyIdSchema,
  tasks: z.array(TaskCapabilitySchema),
  /** Learner-facing summary used by UI to explain honest limits (e.g. no phoneme scoring for `ary`). */
  pronunciationScoring: z.enum(['full', 'partial', 'limited', 'none']),
  realtimeLatencyEstimateMs: MillisSchema.nullable(),
  checkedAt: TimestamptzSchema,
});
export type ModelCapabilitiesResponse = z.infer<typeof ModelCapabilitiesResponseSchema>;
