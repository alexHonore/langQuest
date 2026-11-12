/**
 * AI task names (§8.1) and model profiles (§8.2 / `ai_model_profiles`).
 */
import { z } from 'zod';
import { SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { LatencyClassSchema } from '../enums';
import { JsonObjectSchema, NonNegativeIntSchema, TimestamptzSchema, UuidSchema } from '../primitives';

/** §8.1 — the twelve required AI tasks. */
export const AI_TASK_NAME_VALUES = [
  'content_generation',
  'scene_planning',
  'character_dialogue',
  'meaning_assessment',
  'source_explanation',
  'learner_evaluation',
  'speech_recognition',
  'speech_synthesis',
  'realtime_conversation',
  'pronunciation_assessment',
  'transcription_alignment',
  'language_quality_check',
  /** AI pronunciation feedback: a listening model's estimate of how a take sounds (never an acoustic score, ADR-006). */
  'pronunciation_feedback',
] as const;
export const AiTaskNameSchema = z.enum(AI_TASK_NAME_VALUES);
export type AiTaskName = z.infer<typeof AiTaskNameSchema>;

export const AiProviderSchema = z.enum(['openrouter', 'openai', 'azure_speech', 'deepgram', 'elevenlabs', 'google', 'local', 'other']);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const ModelParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxOutputTokens: NonNegativeIntSchema.optional(),
  /** Context budget in tokens for backend technical calls (not a learner quota). */
  contextBudgetTokens: NonNegativeIntSchema.optional(),
  timeoutMs: NonNegativeIntSchema.optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  /** STT language hint / TTS voice id / other provider-specific knobs. */
  sttLanguage: z.string().optional(),
  voiceId: z.string().optional(),
  extra: JsonObjectSchema.optional(),
});
export type ModelParams = z.infer<typeof ModelParamsSchema>;

/** One routing configuration: task × target variety × source language. `null` means "any". */
export const ModelProfileSchema = z.object({
  id: UuidSchema,
  task: AiTaskNameSchema,
  targetVariety: VarietyIdSchema.nullable(),
  sourceLanguage: SourceLanguageCodeSchema.nullable(),
  provider: AiProviderSchema,
  primaryModel: z.string().min(1),
  /** Ordered fallbacks; each must pass the same capability checks (no variety crossing). */
  fallbackModels: z.array(z.string().min(1)),
  params: ModelParamsSchema,
  latencyClass: LatencyClassSchema,
  enabled: z.boolean(),
  version: NonNegativeIntSchema,
  benchmarkStatus: z.enum(['unbenchmarked', 'passing', 'failing', 'stale']),
  /** Soft per-day spend ceiling for operator alerts (never a learner-facing limit). */
  dailyBudgetUsd: z.number().min(0).nullable(),
  updatedAt: TimestamptzSchema,
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const ModelProfileInputSchema = ModelProfileSchema.omit({ id: true, version: true, updatedAt: true, benchmarkStatus: true });
export type ModelProfileInput = z.infer<typeof ModelProfileInputSchema>;

/** Resolution order: exact (task, variety, source) → (task, variety, any) → (task, any, source) → (task, any, any). */
export const modelProfileSpecificity = (p: Pick<ModelProfile, 'targetVariety' | 'sourceLanguage'>): number =>
  (p.targetVariety ? 2 : 0) + (p.sourceLanguage ? 1 : 0);
