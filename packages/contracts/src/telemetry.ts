/**
 * Typed telemetry events (§12.2) with an explicit privacy level. `@langquest/telemetry`
 * redacts according to `privacyLevel` before export; nothing here carries raw speech or prompts.
 */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from './catalog';
import { ApiErrorCodeSchema } from './api/common';
import { AiTaskNameSchema } from './ai/model-profile';
import { AssessmentModeSchema, IntelligibilitySchema, MasteryStateSchema, PlatformSchema, PrivacyLevelSchema } from './enums';
import { BytesSchema, MillisSchema, NonNegativeIntSchema, TimestamptzSchema, UnitIntervalSchema, UuidSchema } from './primitives';

export const TelemetryCategorySchema = z.enum(['learning_outcome', 'ux_funnel', 'performance', 'cost', 'error']);
export type TelemetryCategory = z.infer<typeof TelemetryCategorySchema>;

const base = {
  eventId: UuidSchema,
  occurredAt: TimestamptzSchema,
  platform: PlatformSchema,
  appVersion: z.string(),
  /** Pseudonymous session id (rotates per app launch). */
  sessionId: z.string().nullable(),
  /** Hashed/pseudonymous user id; null for anonymous events. */
  userHash: z.string().nullable(),
  enrollmentId: UuidSchema.nullable(),
  trackId: CourseTrackIdSchema.nullable(),
  targetVarietyId: VarietyIdSchema.nullable(),
  sourceLanguageCode: SourceLanguageCodeSchema.nullable(),
  privacyLevel: PrivacyLevelSchema,
};

const ev = <N extends string, C extends TelemetryCategory, P extends z.ZodRawShape>(name: N, category: C, props: P) =>
  z.object({ ...base, name: z.literal(name), category: z.literal(category), props: z.object(props) });

// Learning outcomes
export const MissionCompletedTelemetry = ev('mission_completed', 'learning_outcome', { missionId: UuidSchema, withoutHints: z.boolean(), durationMs: MillisSchema, objectivesCompleted: NonNegativeIntSchema, objectivesTotal: NonNegativeIntSchema });
export const ReviewRecallTelemetry = ev('review_recall', 'learning_outcome', { cardId: UuidSchema, intervalDays: z.number().min(0), recalled: z.boolean(), hintsUsed: NonNegativeIntSchema });
export const SkillStateChangedTelemetry = ev('skill_state_changed', 'learning_outcome', { skillKey: z.string(), from: MasteryStateSchema, to: MasteryStateSchema });
export const SpeakingTimeTelemetry = ev('speaking_time', 'learning_outcome', { seconds: NonNegativeIntSchema, context: z.enum(['conversation', 'drill', 'anticipation', 'shadowing']) });
export const PronunciationFeedbackTelemetry = ev('pronunciation_feedback', 'learning_outcome', { assessmentMode: AssessmentModeSchema, intelligibility: IntelligibilitySchema, numericScorePresent: z.boolean(), learnerFlaggedFalseCorrection: z.boolean() });
export const TransferSuccessTelemetry = ev('transfer_success', 'learning_outcome', { skillKey: z.string(), unseenScenario: z.boolean(), success: z.boolean() });

// UX funnel
export const OnboardingStepTelemetry = ev('onboarding_step', 'ux_funnel', { step: z.enum(['welcome', 'ui_language', 'source_language', 'track_selected', 'enrolled', 'first_mission_started']), completed: z.boolean() });
export const EnrollmentSourceChangedTelemetry = ev('enrollment_source_changed', 'ux_funnel', { from: SourceLanguageCodeSchema, to: SourceLanguageCodeSchema });
export const ScreenViewTelemetry = ev('screen_view', 'ux_funnel', { screen: z.string(), rtl: z.boolean(), scriptMode: z.string().nullable() });
export const MascotPreferenceTelemetry = ev('mascot_preference', 'ux_funnel', { enabled: z.boolean(), reduceMotion: z.boolean() });
export const AudioPlaybackTelemetry = ev('audio_playback', 'ux_funnel', { lessonId: UuidSchema, action: z.enum(['start', 'seek', 'complete', 'bookmark', 'download', 'offline_play', 'url_renewed']) });
export const ConversationFunnelTelemetry = ev('conversation_funnel', 'ux_funnel', { step: z.enum(['session_created', 'first_turn', 'barge_in', 'command_used', 'ended']), turnCount: NonNegativeIntSchema.nullable() });

// Performance
export const AppStartTelemetry = ev('app_start', 'performance', { coldStartMs: MillisSchema, lowEndDevice: z.boolean() });
export const MediaStartTelemetry = ev('media_start', 'performance', { timeToFirstFrameMs: MillisSchema, cacheHit: z.boolean(), assetBytes: BytesSchema.nullable() });
export const AiLatencyTelemetry = ev('ai_latency', 'performance', { task: AiTaskNameSchema, timeToFirstAudioMs: MillisSchema.nullable(), totalMs: MillisSchema, interruptionLatencyMs: MillisSchema.nullable(), fallbackUsed: z.boolean() });
export const SttQualityTelemetry = ev('stt_quality', 'performance', { confidence: UnitIntervalSchema.nullable(), languageMismatch: z.boolean(), provider: z.string() });
export const ImageLoadTelemetry = ev('image_load', 'performance', { assetId: UuidSchema.nullable(), bytes: BytesSchema.nullable(), loadMs: MillisSchema, failed: z.boolean(), cacheHit: z.boolean() });

// Cost
export const AiCostTelemetry = ev('ai_cost', 'cost', { task: AiTaskNameSchema, provider: z.string(), model: z.string(), inputTokens: NonNegativeIntSchema.nullable(), outputTokens: NonNegativeIntSchema.nullable(), audioSeconds: z.number().min(0).nullable(), estimatedUsd: z.number().min(0) });
export const StorageOpsTelemetry = ev('storage_ops', 'cost', { operation: z.enum(['get', 'put', 'list', 'delete', 'multipart']), count: NonNegativeIntSchema, bytes: BytesSchema.nullable() });
export const JobCostTelemetry = ev('job_cost', 'cost', { jobId: UuidSchema, jobType: z.string(), estimatedUsd: z.number().min(0).nullable(), actualUsd: z.number().min(0).nullable(), cpuMs: MillisSchema.nullable() });

// Errors
export const ApiErrorTelemetry = ev('api_error', 'error', { route: z.string(), code: ApiErrorCodeSchema, status: z.number().int(), traceId: z.string().nullable() });
export const ProviderFailureTelemetry = ev('provider_failure', 'error', { task: AiTaskNameSchema, provider: z.string(), errorCode: z.string(), fallbackAttempted: z.boolean(), fallbackSucceeded: z.boolean().nullable() });
export const MediaFailureTelemetry = ev('media_failure', 'error', { assetId: UuidSchema.nullable(), kind: z.enum(['playback', 'download', 'url_expired', 'checksum_mismatch', 'revoked']), recovered: z.boolean() });
export const ClientCrashTelemetry = ev('client_crash', 'error', { fingerprint: z.string(), fatal: z.boolean(), screen: z.string().nullable() });

export const TelemetryEventSchema = z.discriminatedUnion('name', [
  MissionCompletedTelemetry,
  ReviewRecallTelemetry,
  SkillStateChangedTelemetry,
  SpeakingTimeTelemetry,
  PronunciationFeedbackTelemetry,
  TransferSuccessTelemetry,
  OnboardingStepTelemetry,
  EnrollmentSourceChangedTelemetry,
  ScreenViewTelemetry,
  MascotPreferenceTelemetry,
  AudioPlaybackTelemetry,
  ConversationFunnelTelemetry,
  AppStartTelemetry,
  MediaStartTelemetry,
  AiLatencyTelemetry,
  SttQualityTelemetry,
  ImageLoadTelemetry,
  AiCostTelemetry,
  StorageOpsTelemetry,
  JobCostTelemetry,
  ApiErrorTelemetry,
  ProviderFailureTelemetry,
  MediaFailureTelemetry,
  ClientCrashTelemetry,
]);
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type TelemetryEventName = TelemetryEvent['name'];
export type TelemetryEventOf<N extends TelemetryEventName> = Extract<TelemetryEvent, { name: N }>;

export const TelemetryBatchSchema = z.object({
  batchId: UuidSchema,
  sentAt: TimestamptzSchema,
  events: z.array(TelemetryEventSchema).min(1).max(500),
});
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;

/** Fields that must be stripped when exporting at or below the given privacy level. */
export const PRIVACY_REDACTIONS: Readonly<Record<z.infer<typeof PrivacyLevelSchema>, readonly (keyof typeof base)[]>> = {
  anonymous: ['userHash', 'enrollmentId', 'sessionId'],
  pseudonymous: ['enrollmentId'],
  personal: [],
};
