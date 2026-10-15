/** §5.1 — identity and configuration tables. */
import { z } from 'zod';
import { CourseTrackIdSchema, LanguageCodeSchema, ScriptIdSchema, SourceLanguageCodeSchema, TransliterationSchemeIdSchema, VarietyIdSchema } from '../catalog';
import { ContentStateSchema, ConversationModeSchema, CoverageStatusSchema, EnrollmentStatusSchema, LearnerLevelSchema, LearningSpeedSchema, RoleSchema, ScoringSupportSchema, ScriptModeSchema, SpeechRetentionSchema } from '../enums';
import { Bcp47Schema, JsonObjectSchema, NonNegativeIntSchema, PercentSchema, TimestamptzSchema, UuidSchema } from '../primitives';
import { defineKeyedTable, defineTable } from './table';

export const PrivacyOptionsSchema = z.object({
  store_speech_recordings: SpeechRetentionSchema.default('none'),
  store_raw_transcripts: z.boolean().default(false),
  personalize_from_interests: z.boolean().default(false),
  analytics_opt_out: z.boolean().default(false),
  leaderboard_opt_in: z.boolean().default(false),
});
export type PrivacyOptions = z.infer<typeof PrivacyOptionsSchema>;

export const AccessibilityOptionsSchema = z.object({
  reduce_motion: z.boolean().default(false),
  mascot_enabled: z.boolean().default(true),
  mascot_voice_enabled: z.boolean().default(true),
  high_contrast: z.boolean().default(false),
  text_scale: z.number().min(0.8).max(2).default(1),
  haptics_enabled: z.boolean().default(true),
  captions_default_on: z.boolean().default(false),
});
export type AccessibilityOptions = z.infer<typeof AccessibilityOptionsSchema>;

export const ProfilesTable = defineKeyedTable('profiles', {
  user_id: UuidSchema,
  display_name: z.string().max(80).nullable(),
  ui_locale: Bcp47Schema,
  /**
   * Prefills new enrollments only; never rewrites existing ones. `null` until onboarding sets it
   * (OAuth / magic-link signups carry no instruction language; the DB has no catalog default).
   */
  default_source_language_code: SourceLanguageCodeSchema.nullable(),
  time_zone: z.string(),
  privacy_options: PrivacyOptionsSchema,
  accessibility_options: AccessibilityOptionsSchema,
  deleted_at: TimestamptzSchema.nullable(),
});

export const NotificationPreferencesSchema = z.object({
  daily_reminder: z.boolean().default(false),
  reminder_time_local: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  review_due: z.boolean().default(true),
  story_updates: z.boolean().default(true),
  streak_gentle: z.boolean().default(false),
});

export const AccountSettingsTable = defineKeyedTable('account_settings', {
  user_id: UuidSchema,
  notification_preferences: NotificationPreferencesSchema,
  audio_speed: z.number().min(0.5).max(1.5),
  preferred_input_device: z.string().nullable(),
  preferred_output_device: z.string().nullable(),
  default_hint_behavior: z.enum(['on_request', 'after_pause', 'always']),
  script_preferences: z.record(CourseTrackIdSchema, ScriptModeSchema),
  transliteration_preferences: z.record(CourseTrackIdSchema, TransliterationSchemeIdSchema),
  offline_download_settings: z.object({ auto_download: z.boolean(), wifi_only: z.boolean(), max_storage_mb: NonNegativeIntSchema }),
  retention_settings: z.object({ speech: SpeechRetentionSchema, transcripts_days: NonNegativeIntSchema.nullable() }),
  conversation_mode: ConversationModeSchema,
});

export const LanguagesTable = defineKeyedTable('languages', {
  id: LanguageCodeSchema,
  code: LanguageCodeSchema,
  english_name: z.string(),
  native_name: z.string(),
  default_script: ScriptIdSchema,
  rtl: z.boolean(),
  plural_categories: z.array(z.string()),
});

export const LanguageVarietiesTable = defineKeyedTable('language_varieties', {
  id: VarietyIdSchema,
  language_id: LanguageCodeSchema,
  dialect_name: z.string(),
  bcp47_locale: z.string().nullable(),
  tonal: z.boolean(),
  regional_notes: z.string(),
  code_switch_norms: z.string(),
  alternative_names: z.array(z.string()),
  localized_voice_settings: JsonObjectSchema,
  must_not_substitute: z.array(VarietyIdSchema),
});

export const WritingSystemsTable = defineKeyedTable('writing_systems', {
  id: z.string(),
  kind: z.enum(['script', 'transliteration', 'annotation']),
  name: z.string(),
  direction: z.enum(['ltr', 'rtl']),
  renders_script: ScriptIdSchema.nullable(),
  renderer_rules: JsonObjectSchema,
});

export const CourseTracksTable = defineKeyedTable('course_tracks', {
  id: CourseTrackIdSchema,
  sort_order: z.number().int().min(1).max(30),
  display_name: z.string(),
  language_id: LanguageCodeSchema,
  primary_target_variety_id: VarietyIdSchema,
  default_locale: z.string(),
  regional_options: z.array(z.object({ id: z.string(), label: z.string(), locale: z.string().nullable() })),
  scripts: z.object({ primary: ScriptIdSchema, alternatives: z.array(ScriptIdSchema), transliterations: z.array(TransliterationSchemeIdSchema) }),
  script_mode_options: z.array(ScriptModeSchema),
  default_script_mode: ScriptModeSchema,
  script_focus: ScriptIdSchema.nullable(),
  default_voices: JsonObjectSchema,
  teaching_focus: z.string(),
  shares_assets_with_track_id: CourseTrackIdSchema.nullable(),
  tonal: z.boolean(),
  assumptions: z.array(z.string()),
  automated_scoring_support: ScoringSupportSchema,
  publication_state: ContentStateSchema,
});

export const UserCourseEnrollmentsTable = defineTable('user_course_enrollments', {
  user_id: UuidSchema,
  course_track_id: CourseTrackIdSchema,
  /** NOT NULL — per-enrollment instruction language. */
  source_language_code: SourceLanguageCodeSchema,
  preferred_target_variant_id: VarietyIdSchema.nullable(),
  regional_preference: z.string().nullable(),
  script_mode: ScriptModeSchema,
  learner_level: LearnerLevelSchema,
  added_at: TimestamptzSchema,
  last_opened_at: TimestamptzSchema.nullable(),
  status: EnrollmentStatusSchema,
  active_mission_id: UuidSchema.nullable(),
  preferred_learning_speed: LearningSpeedSchema,
  /** Optional third language for temporary translations without changing the enrollment. */
  translation_peek_language_code: SourceLanguageCodeSchema.nullable(),
});

export const CoverageMetricsSchema = z.object({
  mission_instructions_pct: PercentSchema,
  explanations_pct: PercentSchema,
  ui_pct: PercentSchema,
  subtitles_pct: PercentSchema,
  audio_overlays_pct: PercentSchema,
});
export type CoverageMetrics = z.infer<typeof CoverageMetricsSchema>;

export const CourseSourceLocalizationsTable = defineTable('course_source_localizations', {
  course_track_id: CourseTrackIdSchema,
  source_language_code: SourceLanguageCodeSchema,
  status: CoverageStatusSchema,
  metrics: CoverageMetricsSchema,
  native_reviewed: z.boolean(),
  reviewer_id: UuidSchema.nullable(),
  reviewed_at: TimestamptzSchema.nullable(),
  /** Learner-facing editorial note key (i18n). */
  editorial_note_key: z.string().nullable(),
  /** Source language the learner may opt into when coverage is partial (never applied silently). */
  fallback_source_language_code: SourceLanguageCodeSchema.nullable(),
});

export const UserRolesTable = defineTable('user_roles', {
  user_id: UuidSchema,
  role: RoleSchema,
  granted_by: UuidSchema.nullable(),
  expires_at: TimestamptzSchema.nullable(),
});
