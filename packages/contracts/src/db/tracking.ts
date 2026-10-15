/** §5.4 — AI, evaluations, personalization and tracking tables. */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { AutonomyLevelSchema, ConversationModeSchema, ConversationPipelineSchema, ConversationStateSchema, IntelligibilitySchema, LatencyClassSchema, MasteryStateSchema, ObservationOutcomeSchema, ObservationTypeSchema, PlatformSchema, PronunciationConfidenceSchema, AssessmentModeSchema, ScorerKindSchema, SpeechRetentionSchema, XpReasonSchema } from '../enums';
import { AiTaskNameSchema, AiProviderSchema, ModelParamsSchema } from '../ai/model-profile';
import { IsoDateSchema, JsonObjectSchema, KeySchema, MillisSchema, NonNegativeIntSchema, PercentSchema, TimestamptzSchema, UnitIntervalSchema, UuidSchema } from '../primitives';
import { defineLedgerTable, defineTable } from './table';

export const AiModelProfilesTable = defineTable('ai_model_profiles', {
  task: AiTaskNameSchema,
  target_variety_id: VarietyIdSchema.nullable(),
  source_language_code: SourceLanguageCodeSchema.nullable(),
  provider: AiProviderSchema,
  primary_model: z.string(),
  fallback_models: z.array(z.string()),
  /** Voice/STT language hints and sampling params. Never secrets. */
  params: ModelParamsSchema,
  capabilities: JsonObjectSchema,
  latency_class: LatencyClassSchema,
  daily_budget_usd: z.number().min(0).nullable(),
  enabled: z.boolean(),
  version: NonNegativeIntSchema,
  benchmark_status: z.enum(['unbenchmarked', 'passing', 'failing', 'stale']),
  updated_by: UuidSchema.nullable(),
});

export const AiModelBenchmarksTable = defineTable('ai_model_benchmarks', {
  profile_id: UuidSchema,
  model: z.string(),
  target_variety_id: VarietyIdSchema.nullable(),
  source_language_code: SourceLanguageCodeSchema.nullable(),
  sample_set_id: z.string(),
  evaluator_version: z.string(),
  naturalness: UnitIntervalSchema.nullable(),
  intelligibility: UnitIntervalSchema.nullable(),
  dialect_adherence: UnitIntervalSchema.nullable(),
  false_correction_rate: UnitIntervalSchema.nullable(),
  wer: UnitIntervalSchema.nullable(),
  latency_p50_ms: MillisSchema.nullable(),
  latency_p95_ms: MillisSchema.nullable(),
  cost_per_call_usd: z.number().min(0).nullable(),
  passed: z.boolean(),
  reviewer_id: UuidSchema.nullable(),
  notes: z.string().nullable(),
});

export const AiRequestsTable = defineLedgerTable('ai_requests', {
  /** Null when the request is not attributable or privacy settings forbid it. */
  user_id: UuidSchema.nullable(),
  enrollment_id: UuidSchema.nullable(),
  task: AiTaskNameSchema,
  provider: z.string(),
  model: z.string(),
  profile_id: UuidSchema.nullable(),
  fallback_index: NonNegativeIntSchema,
  latency_ms: MillisSchema.nullable(),
  input_tokens: NonNegativeIntSchema.nullable(),
  output_tokens: NonNegativeIntSchema.nullable(),
  audio_seconds: z.number().min(0).nullable(),
  estimated_cost_usd: z.number().min(0).nullable(),
  success: z.boolean(),
  error_code: z.string().nullable(),
  trace_id: z.string(),
  /** Redacted request metadata only — never raw prompts with learner data. */
  redacted_log: JsonObjectSchema.nullable(),
});

export const ConversationSessionsTable = defineTable('conversation_sessions', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema,
  mission_id: UuidSchema.nullable(),
  scenario_id: UuidSchema.nullable(),
  character_id: UuidSchema,
  target_variety_id: VarietyIdSchema,
  source_language_code: SourceLanguageCodeSchema,
  mode: ConversationModeSchema,
  state: ConversationStateSchema,
  pipeline: ConversationPipelineSchema,
  turn_count: NonNegativeIntSchema,
  started_at: TimestamptzSchema,
  ended_at: TimestamptzSchema.nullable(),
  summary: z.string().nullable(),
  speech_retention: SpeechRetentionSchema,
  rubric_outcomes: JsonObjectSchema.nullable(),
  objectives_completed: z.array(z.string()),
  revision: NonNegativeIntSchema,
  last_seq: NonNegativeIntSchema,
});

export const ConversationTurnsTable = defineLedgerTable('conversation_turns', {
  session_id: UuidSchema,
  turn_index: NonNegativeIntSchema,
  speaker: z.enum(['learner', 'character']),
  client_turn_id: UuidSchema.nullable(),
  /** Sanitized text or null when retention disallows; never raw audio by default. */
  text: z.string().nullable(),
  text_hash: z.string().nullable(),
  audio_asset_id: UuidSchema.nullable(),
  goals: z.array(z.string()),
  hints_used: NonNegativeIntSchema,
  command: z.string().nullable(),
  confidence: UnitIntervalSchema.nullable(),
  latency_ms: MillisSchema.nullable(),
  occurred_at: TimestamptzSchema,
  expires_at: TimestamptzSchema.nullable(),
});

export const CharacterRelationshipMemoryTable = defineTable('character_relationship_memory', {
  user_id: UuidSchema,
  character_id: UuidSchema,
  enrollment_id: UuidSchema,
  story_summary: z.string().max(2000),
  durable_preferences: JsonObjectSchema,
  consented: z.boolean(),
  missions_completed_together: NonNegativeIntSchema,
  last_interaction_at: TimestamptzSchema.nullable(),
});

export const UserSkillMasteryTable = defineTable('user_skill_mastery', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema,
  skill_key: KeySchema,
  mastery_state: MasteryStateSchema,
  internal_score: UnitIntervalSchema,
  last_practiced_at: TimestamptzSchema.nullable(),
  due_at: TimestamptzSchema.nullable(),
  evidence_count: NonNegativeIntSchema,
  uncertainty: UnitIntervalSchema,
});

export const UserExpressionReviewsTable = defineTable('user_expression_reviews', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema,
  expression_id: UuidSchema.nullable(),
  skill_key: KeySchema.nullable(),
  card_state: z.enum(['new', 'learning', 'review', 'relearning']),
  stability: z.number().min(0),
  difficulty: z.number().min(1).max(10),
  retrievability: UnitIntervalSchema,
  reps: NonNegativeIntSchema,
  lapses: NonNegativeIntSchema,
  scheduled_days: z.number().min(0),
  elapsed_days: z.number().min(0),
  last_rating: z.enum(['again', 'hard', 'good', 'easy']).nullable(),
  last_hint_count: NonNegativeIntSchema,
  last_reviewed_at: TimestamptzSchema.nullable(),
  next_due_at: TimestamptzSchema,
  recent_scenario_ids: z.array(z.string()),
  scheduler_version: z.string(),
});

export const LearningObservationsTable = defineLedgerTable('learning_observations', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema,
  skill_key: KeySchema,
  observation_type: ObservationTypeSchema,
  scenario_id: z.string(),
  mission_id: UuidSchema.nullable(),
  mission_attempt_id: UuidSchema.nullable(),
  conversation_session_id: UuidSchema.nullable(),
  expression_id: UuidSchema.nullable(),
  autonomy: AutonomyLevelSchema,
  hints_used: NonNegativeIntSchema,
  outcome: ObservationOutcomeSchema,
  utterance_confidence: UnitIntervalSchema.nullable(),
  intelligibility: IntelligibilitySchema.nullable(),
  pronunciation_mode: AssessmentModeSchema.nullable(),
  pronunciation_confidence: PronunciationConfidenceSchema.nullable(),
  scorer_kind: ScorerKindSchema,
  scorer_version: z.string(),
  asr_version: z.string().nullable(),
  uncertainty: UnitIntervalSchema,
  feedback_evidence: JsonObjectSchema.nullable(),
  observed_at: TimestamptzSchema,
});

export const MissionAttemptsTable = defineTable('mission_attempts', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema,
  mission_id: UuidSchema,
  mission_revision: NonNegativeIntSchema,
  client_attempt_id: UuidSchema,
  started_at: TimestamptzSchema,
  completed_at: TimestamptzSchema.nullable(),
  abandoned_at: TimestamptzSchema.nullable(),
  current_step_index: NonNegativeIntSchema,
  step_results: z.array(z.object({ step_id: UuidSchema, outcome: ObservationOutcomeSchema, hints_used: NonNegativeIntSchema, duration_ms: MillisSchema })),
  objectives_completed: z.array(z.string()),
  evaluation: JsonObjectSchema.nullable(),
  xp_awarded: NonNegativeIntSchema,
});

export const MissionProgressTable = defineTable('mission_progress', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema,
  mission_id: UuidSchema,
  status: z.enum(['locked', 'available', 'in_progress', 'completed']),
  best_attempt_id: UuidSchema.nullable(),
  completions: NonNegativeIntSchema,
  completed_without_hints: z.boolean(),
  first_completed_at: TimestamptzSchema.nullable(),
  last_completed_at: TimestamptzSchema.nullable(),
  revision: NonNegativeIntSchema,
});

export const UserAchievementsTable = defineTable('user_achievements', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema.nullable(),
  achievement_key: KeySchema,
  unlocked_at: TimestamptzSchema,
  evidence: JsonObjectSchema.nullable(),
  client_event_id: UuidSchema,
});

export const StreakActivityTable = defineTable('streak_activity', {
  user_id: UuidSchema,
  activity_date: IsoDateSchema,
  time_zone: z.string(),
  minutes_active: NonNegativeIntSchema,
  speaking_seconds: NonNegativeIntSchema,
  missions_completed: NonNegativeIntSchema,
  reviews_completed: NonNegativeIntSchema,
});

export const XpLedgerTable = defineLedgerTable('xp_ledger', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema.nullable(),
  /** Mirrors `award_xp()`: 1..1000 per event (DB CHECK: `amount <> 0`). */
  amount: z.number().int().min(1).max(1000),
  reason: XpReasonSchema,
  reference_table: z.string().nullable(),
  reference_id: UuidSchema.nullable(),
  /** Unique: client event UUID; replay returns the original row. */
  idempotency_key: UuidSchema,
  occurred_at: TimestamptzSchema,
});

export const DailyLearningMetricsTable = defineTable('daily_learning_metrics', {
  user_id: UuidSchema,
  enrollment_id: UuidSchema,
  metric_date: IsoDateSchema,
  minutes_active: NonNegativeIntSchema,
  speaking_seconds: NonNegativeIntSchema,
  missions_completed: NonNegativeIntSchema,
  missions_completed_without_hints: NonNegativeIntSchema,
  reviews_due: NonNegativeIntSchema,
  reviews_completed: NonNegativeIntSchema,
  review_recall_pct: PercentSchema.nullable(),
  conversation_turns: NonNegativeIntSchema,
  xp_earned: NonNegativeIntSchema,
});

export const DeviceSyncEventsTable = defineLedgerTable('device_sync_events', {
  user_id: UuidSchema,
  device_id: z.string(),
  /** Unique idempotency key: the client event UUID. */
  client_event_id: UuidSchema,
  payload_type: z.string(),
  payload: JsonObjectSchema,
  revision: NonNegativeIntSchema,
  client_occurred_at: TimestamptzSchema,
  /** Server-estimated clock skew at ingestion. */
  clock_skew_ms: z.number().int().nullable(),
  applied_at: TimestamptzSchema.nullable(),
  resolution: z.enum(['applied', 'duplicate', 'superseded', 'rejected']),
  rejection_reason: z.string().nullable(),
});

export const NotificationSettingsTable = defineTable('notification_settings', {
  user_id: UuidSchema,
  channel: z.enum(['push', 'email']),
  enabled: z.boolean(),
  quiet_hours: z.object({ start_local: z.string(), end_local: z.string() }).nullable(),
  reminder_time_local: z.string().nullable(),
  categories: z.record(z.string(), z.boolean()),
  push_token: z.string().nullable(),
  platform: PlatformSchema.nullable(),
});

/** Append-only: one immutable row per delivery attempt with its outcome recorded at insert (`attach_append_only` in 040). */
export const NotificationDeliveriesTable = defineLedgerTable('notification_deliveries', {
  user_id: UuidSchema,
  channel: z.enum(['push', 'email']),
  category: z.string(),
  template_key: z.string(),
  locale: z.string(),
  status: z.enum(['queued', 'sent', 'failed', 'suppressed']),
  provider_message_id: z.string().nullable(),
  error: z.string().nullable(),
  sent_at: TimestamptzSchema.nullable(),
});

export const FeedbackReportsTable = defineTable('feedback_reports', {
  user_id: UuidSchema.nullable(),
  enrollment_id: UuidSchema.nullable(),
  course_track_id: CourseTrackIdSchema.nullable(),
  category: z.enum(['wrong_translation', 'wrong_dialect', 'bad_audio', 'false_correction', 'offensive', 'bug', 'other']),
  entity_table: z.string().nullable(),
  entity_id: UuidSchema.nullable(),
  message: z.string().max(2000),
  status: z.enum(['open', 'triaged', 'resolved', 'dismissed']),
  resolved_by: UuidSchema.nullable(),
});

export const ModerationIncidentsTable = defineTable('moderation_incidents', {
  user_id: UuidSchema.nullable(),
  session_id: UuidSchema.nullable(),
  kind: z.enum(['abuse', 'prompt_injection', 'unsafe_content', 'rate_abuse', 'other']),
  severity: z.enum(['low', 'medium', 'high']),
  details: JsonObjectSchema,
  action_taken: z.string().nullable(),
  reviewed_by: UuidSchema.nullable(),
  status: z.enum(['open', 'reviewed', 'closed']),
});

export const AuditLogsTable = defineLedgerTable('audit_logs', {
  actor_id: UuidSchema.nullable(),
  actor_role: z.string().nullable(),
  action: z.string(),
  entity_table: z.string().nullable(),
  entity_id: z.string().nullable(),
  before: JsonObjectSchema.nullable(),
  after: JsonObjectSchema.nullable(),
  ip_hash: z.string().nullable(),
  request_id: z.string().nullable(),
});
