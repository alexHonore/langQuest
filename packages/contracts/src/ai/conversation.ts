/**
 * Conversation orchestration (§8.3): session configuration, state machine
 * transitions, runtime events, character turns and evaluator output.
 */
import { z } from 'zod';
import { VarietyIdSchema } from '../catalog';
import {
  ConversationCommandSchema,
  ConversationModeSchema,
  ConversationPipelineSchema,
  ConversationStateSchema,
  RegisterSchema,
  SpeechRetentionSchema,
  type ConversationState,
} from '../enums';
import { LanguageContextSchema } from '../language-context';
import { KeySchema, MillisSchema, NonNegativeIntSchema, TimestamptzSchema, UnitIntervalSchema, UuidSchema, UrlSchema } from '../primitives';
import { AudioEncodingSchema } from './io';
import { SkillObservationInputSchema } from '../srs';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/** Allowed transitions. `finished` is terminal. */
export const CONVERSATION_TRANSITIONS: Readonly<Record<ConversationState, readonly ConversationState[]>> = {
  preparing: ['connecting', 'recoverable_error', 'finished'],
  connecting: ['listening', 'recoverable_error', 'finished'],
  listening: ['speech_detected', 'paused', 'recoverable_error', 'finished'],
  speech_detected: ['interpreting', 'listening', 'paused', 'recoverable_error', 'finished'],
  interpreting: ['responding', 'listening', 'recoverable_error', 'finished'],
  responding: ['listening', 'interrupted', 'paused', 'recoverable_error', 'finished'],
  interrupted: ['speech_detected', 'listening', 'recoverable_error', 'finished'],
  paused: ['listening', 'connecting', 'finished'],
  recoverable_error: ['connecting', 'listening', 'finished'],
  finished: [],
};

export const canTransition = (from: ConversationState, to: ConversationState): boolean =>
  (CONVERSATION_TRANSITIONS[from] as readonly ConversationState[]).includes(to);

export const isTerminalConversationState = (state: ConversationState): boolean => state === 'finished';

// ---------------------------------------------------------------------------
// Session configuration
// ---------------------------------------------------------------------------

/** Compact, safe context handed to the character agent (§8.3): no full transcripts. */
export const ConversationContextSchema = z.object({
  language: LanguageContextSchema,
  missionId: UuidSchema.nullable(),
  characterId: UuidSchema,
  scenarioId: UuidSchema.nullable(),
  sceneFacts: z.array(z.string().max(300)).max(20),
  objectives: z.array(z.object({ id: z.string(), description: z.string(), skillKeys: z.array(KeySchema), completed: z.boolean() })),
  recentWeaknessSkillKeys: z.array(KeySchema).max(10),
  /** Rolling summary of the conversation so far (replaces full history). */
  turnSummary: z.string().max(2000),
  register: RegisterSchema,
  /** Character relationship memory snippet (consented). */
  relationshipSummary: z.string().max(1000).nullable(),
});
export type ConversationContext = z.infer<typeof ConversationContextSchema>;

export const VoiceSessionConfigSchema = z.object({
  sessionId: UuidSchema,
  context: ConversationContextSchema,
  mode: ConversationModeSchema,
  interruptible: z.boolean(),
  /** Provider locale resolved from the target variety; never a neighbouring variety. */
  locale: z.string(),
  voiceId: z.string(),
  inputEncoding: AudioEncodingSchema,
  outputEncoding: AudioEncodingSchema,
  /** Technical ceilings for backend calls (not learner quotas). */
  maxSessionMs: MillisSchema,
  maxTurnMs: MillisSchema,
  speechRetention: SpeechRetentionSchema,
});
export type VoiceSessionConfig = z.infer<typeof VoiceSessionConfigSchema>;

/** Short-lived provider session handed to the client (token scoped to one conversation). */
export const ShortLivedSessionSchema = z.object({
  sessionId: UuidSchema,
  provider: z.string(),
  /** Opaque, short-lived client token. Never the server API key. */
  clientToken: z.string().min(1),
  connectUrl: UrlSchema.nullable(),
  expiresAt: TimestamptzSchema,
  /** Pipeline used: `duplex` provider or `stt_llm_tts` chain. */
  pipeline: ConversationPipelineSchema,
  /** Client-side VAD parameters when hands-free. */
  vad: z.object({ silenceMs: MillisSchema, minSpeechMs: MillisSchema }).nullable(),
});
export type ShortLivedSession = z.infer<typeof ShortLivedSessionSchema>;

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export const LearnerTurnInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal('audio'), assetId: UuidSchema, durationMs: MillisSchema, transcriptHint: z.string().nullable() }),
  z.object({ kind: z.literal('transcript'), text: z.string().min(1), confidence: UnitIntervalSchema.nullable(), provider: z.string() }),
  z.object({ kind: z.literal('command'), command: ConversationCommandSchema }),
]);
export type LearnerTurnInput = z.infer<typeof LearnerTurnInputSchema>;

/** Output of the character agent for one turn. */
export const CharacterTurnSchema = z.object({
  turnId: UuidSchema,
  characterId: UuidSchema,
  /** Target-variety text as spoken; script per enrollment script mode is applied downstream. */
  text: z.string().min(1).max(1200),
  /** Transliteration when the track has one and the learner's script mode asks for it. */
  transliteration: z.string().nullable(),
  /** Source-language gloss (shown only on request / per settings). */
  sourceGloss: z.string().nullable(),
  /** Short in-character stage direction for the UI (expression). */
  expression: z.enum(['neutral', 'greeting', 'listening', 'talking', 'surprise', 'confusion', 'friendly_success', 'follow_up_question']),
  /** Whether this turn responds to a learner command (slower/repeat/...). */
  respondsToCommand: ConversationCommandSchema.nullable(),
  /** Objective ids the character believes were just completed (evaluator confirms). */
  tentativeObjectiveIds: z.array(z.string()),
  audio: z.object({ assetId: UuidSchema.nullable(), url: UrlSchema.nullable(), durationMs: MillisSchema.nullable(), synthetic: z.boolean() }).nullable(),
  endsConversation: z.boolean(),
  model: z.string().nullable(),
  latencyMs: MillisSchema.nullable(),
});
export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;

/** Structured character-agent generation schema (what the LLM must emit; audio is added later). */
export const CharacterTurnGenerationSchema = CharacterTurnSchema.pick({
  text: true,
  transliteration: true,
  sourceGloss: true,
  expression: true,
  respondsToCommand: true,
  tentativeObjectiveIds: true,
  endsConversation: true,
});
export type CharacterTurnGeneration = z.infer<typeof CharacterTurnGenerationSchema>;

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export const PriorityCorrectionSchema = z.object({
  skillKey: KeySchema.nullable(),
  /** What the learner said (sanitized, short). */
  learnerUtterance: z.string().max(300),
  /** A natural alternative in the target variety. */
  suggestedUtterance: z.string().max(300),
  /** Source-language explanation (in the enrollment's source language). */
  explanation: z.string().max(500),
  category: z.enum(['meaning', 'register', 'pronunciation', 'fluency', 'vocabulary', 'grammar', 'code_switch']),
});
export type PriorityCorrection = z.infer<typeof PriorityCorrectionSchema>;

/** §3.7 / §8.3 — evaluator output after a turn or checkpoint. At most 2 corrections (§3.6). */
export const EvaluatorOutputSchema = z.object({
  objectivesCompleted: z.array(z.string()),
  skillsExercised: z.array(KeySchema),
  observations: z.array(SkillObservationInputSchema.omit({ enrollmentId: true, scorerVersion: true, scorerKind: true })),
  priorityCorrections: z.array(PriorityCorrectionSchema).max(2),
  /** Concise, safe learning/story summary persisted after the chat. */
  summary: z.string().max(1500),
  /** Skills to push into the review path (§3.5 targeted review). */
  reviewTriggers: z.array(KeySchema),
  /** Suggested relationship-memory delta (consented, concise). */
  relationshipMemoryUpdate: z.string().max(500).nullable(),
  confidence: UnitIntervalSchema,
});
export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;

// ---------------------------------------------------------------------------
// Runtime events (client ↔ orchestrator)
// ---------------------------------------------------------------------------

const base = { sessionId: UuidSchema, at: TimestamptzSchema, seq: NonNegativeIntSchema };

export const ConversationEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('session_created'), mode: ConversationModeSchema }),
  z.object({ ...base, type: z.literal('connected'), provider: z.string() }),
  z.object({ ...base, type: z.literal('state_changed'), from: ConversationStateSchema, to: ConversationStateSchema }),
  z.object({ ...base, type: z.literal('speech_started') }),
  z.object({ ...base, type: z.literal('speech_ended'), durationMs: MillisSchema }),
  z.object({ ...base, type: z.literal('transcript_partial'), text: z.string() }),
  z.object({ ...base, type: z.literal('transcript_final'), text: z.string(), confidence: UnitIntervalSchema.nullable() }),
  z.object({ ...base, type: z.literal('character_turn_started'), turnId: UuidSchema }),
  z.object({ ...base, type: z.literal('character_turn_audio'), turnId: UuidSchema, chunkIndex: NonNegativeIntSchema, final: z.boolean() }),
  z.object({ ...base, type: z.literal('character_turn_completed'), turn: CharacterTurnSchema }),
  z.object({ ...base, type: z.literal('barge_in'), interruptedTurnId: UuidSchema }),
  z.object({ ...base, type: z.literal('paused') }),
  z.object({ ...base, type: z.literal('resumed') }),
  z.object({ ...base, type: z.literal('command'), command: ConversationCommandSchema }),
  z.object({ ...base, type: z.literal('error'), code: z.string(), recoverable: z.boolean(), message: z.string() }),
  z.object({ ...base, type: z.literal('recovered'), resumedFromSeq: NonNegativeIntSchema }),
  z.object({ ...base, type: z.literal('evaluation_ready'), evaluation: EvaluatorOutputSchema }),
  z.object({ ...base, type: z.literal('finished'), reason: z.enum(['completed', 'learner_ended', 'timeout', 'error', 'abandoned']) }),
]);
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;

/** Snapshot of a live session as held by the orchestrator / returned by the API. */
export const ConversationSessionStateSchema = z.object({
  sessionId: UuidSchema,
  state: ConversationStateSchema,
  mode: ConversationModeSchema,
  targetVarietyId: VarietyIdSchema,
  turnCount: NonNegativeIntSchema,
  /** Last processed learner turn (client id) so a reconnect never loses it. */
  lastLearnerTurnId: UuidSchema.nullable(),
  lastCharacterTurnId: UuidSchema.nullable(),
  lastSeq: NonNegativeIntSchema,
  objectivesCompleted: z.array(z.string()),
  startedAt: TimestamptzSchema,
  updatedAt: TimestamptzSchema,
  endedAt: TimestamptzSchema.nullable(),
});
export type ConversationSessionState = z.infer<typeof ConversationSessionStateSchema>;
