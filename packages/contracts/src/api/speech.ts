/** §6.2 — speaking and AI endpoints. */
import { z } from 'zod';
import { CourseTrackIdSchema, VarietyIdSchema } from '../catalog';
import { CapabilitySchema } from '../ai/capability';
import { CharacterTurnSchema, ConversationSessionStateSchema, EvaluatorOutputSchema, LearnerTurnInputSchema, ShortLivedSessionSchema } from '../ai/conversation';
import { AudioEncodingSchema, AudioInputSchema, AudioOutputSchema, SpeechEvaluationResultSchema, TranscriptResultSchema } from '../ai/io';
import { AiTaskNameSchema } from '../ai/model-profile';
import { ConversationModeSchema, ConversationStateSchema, SpeechRetentionSchema } from '../enums';
import { KeySchema, MillisSchema, NonNegativeIntSchema, TimestamptzSchema, UuidSchema } from '../primitives';
import { PronunciationFeatureSchema } from '../ai/capability';

// --- conversation -----------------------------------------------------------

export const ConversationSessionCreateRequestSchema = z.object({
  enrollmentId: UuidSchema,
  missionId: UuidSchema.optional(),
  scenarioId: UuidSchema.optional(),
  characterId: UuidSchema.optional(),
  mode: ConversationModeSchema.default('push_to_talk'),
  /** Client-generated idempotency key for session creation. */
  clientSessionId: UuidSchema,
  inputEncoding: AudioEncodingSchema.default('opus'),
  speechRetention: SpeechRetentionSchema.optional(),
});
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

/** Audio accepted inline on a conversation turn: the generic `AudioInput` (asset/url/inline) or a bare clip. */
export const ConversationTurnAudioSchema = z.union([AudioInputSchema, InlineAudioClipSchema]);
export type ConversationTurnAudio = z.infer<typeof ConversationTurnAudioSchema>;

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
});
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;
export const TranscribeResponseSchema = z.object({
  transcript: TranscriptResultSchema,
  capability: CapabilitySchema,
  /** Stored only under the learner's retention preference. */
  recordingAssetId: UuidSchema.nullable(),
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
  })
  .refine((v) => v.expressionId !== undefined || v.referenceText !== undefined, { message: 'expressionId or referenceText is required', path: ['expressionId'] });
export type PronunciationAssessRequest = z.infer<typeof PronunciationAssessRequestSchema>;

/** §6.5 exact result shape; see `PronunciationAssessmentSchema` for the numericScore refinement. */
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

export const ModelCapabilitiesQuerySchema = z.object({ trackId: CourseTrackIdSchema, regionalOption: z.string().optional() });
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
