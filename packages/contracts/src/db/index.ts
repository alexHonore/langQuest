/**
 * Database contract (§5, §10.2C): one Row/Insert/Update Zod schema per table,
 * `TABLE_NAMES` and a `DB_TABLES` registry. Migrations must honour these shapes.
 */
import type { z } from 'zod';
import * as audio from './audio-library';
import * as curriculum from './curriculum';
import * as identity from './identity';
import * as tracking from './tracking';
import * as visual from './visual';
import type { AnyTable } from './table';

export * from './table';
export * from './identity';
export * from './curriculum';
export * from './audio-library';
export * from './tracking';
export * from './visual';

export const DB_TABLES = {
  // §5.1
  profiles: identity.ProfilesTable,
  account_settings: identity.AccountSettingsTable,
  languages: identity.LanguagesTable,
  language_varieties: identity.LanguageVarietiesTable,
  writing_systems: identity.WritingSystemsTable,
  course_tracks: identity.CourseTracksTable,
  user_course_enrollments: identity.UserCourseEnrollmentsTable,
  course_source_localizations: identity.CourseSourceLocalizationsTable,
  user_roles: identity.UserRolesTable,
  // §5.2
  skills: curriculum.SkillsTable,
  skill_variants: curriculum.SkillVariantsTable,
  communicative_intents: curriculum.CommunicativeIntentsTable,
  expressions: curriculum.ExpressionsTable,
  expression_forms: curriculum.ExpressionFormsTable,
  expression_translations: curriculum.ExpressionTranslationsTable,
  expression_audio: curriculum.ExpressionAudioTable,
  lesson_courses: curriculum.LessonCoursesTable,
  chapters: curriculum.ChaptersTable,
  missions: curriculum.MissionsTable,
  mission_localizations: curriculum.MissionLocalizationsTable,
  mission_steps: curriculum.MissionStepsTable,
  mission_graph_edges: curriculum.MissionGraphEdgesTable,
  dialogue_scenarios: curriculum.DialogueScenariosTable,
  dialogue_variants: curriculum.DialogueVariantsTable,
  characters: curriculum.CharactersTable,
  story_arcs: curriculum.StoryArcsTable,
  media_assets: curriculum.MediaAssetsTable,
  content_rights: curriculum.ContentRightsTable,
  content_revisions: curriculum.ContentRevisionsTable,
  publication_events: curriculum.PublicationEventsTable,
  // §5.3
  audio_course_collections: audio.AudioCourseCollectionsTable,
  audio_chapters: audio.AudioChaptersTable,
  audio_lessons: audio.AudioLessonsTable,
  audio_lesson_assets: audio.AudioLessonAssetsTable,
  speakers: audio.SpeakersTable,
  lesson_speakers: audio.LessonSpeakersTable,
  transcripts: audio.TranscriptsTable,
  transcript_segments: audio.TranscriptSegmentsTable,
  transcript_translations: audio.TranscriptTranslationsTable,
  transcript_word_alignments: audio.TranscriptWordAlignmentsTable,
  lesson_tags: audio.LessonTagsTable,
  lesson_topics: audio.LessonTopicsTable,
  bookmarks: audio.BookmarksTable,
  user_audio_progress: audio.UserAudioProgressTable,
  user_download_manifests: audio.UserDownloadManifestsTable,
  uploads: audio.UploadsTable,
  processing_jobs: audio.ProcessingJobsTable,
  asset_provenance_events: audio.AssetProvenanceEventsTable,
  // ADR-004 stored manifests + §7.4 AI suggestions (migration 100, 2026-10-15)
  course_manifests: audio.CourseManifestsTable,
  audio_collection_manifests: audio.AudioCollectionManifestsTable,
  asset_suggestions: audio.AssetSuggestionsTable,
  // §5.4
  ai_model_profiles: tracking.AiModelProfilesTable,
  ai_model_benchmarks: tracking.AiModelBenchmarksTable,
  ai_requests: tracking.AiRequestsTable,
  conversation_sessions: tracking.ConversationSessionsTable,
  conversation_turns: tracking.ConversationTurnsTable,
  character_relationship_memory: tracking.CharacterRelationshipMemoryTable,
  user_skill_mastery: tracking.UserSkillMasteryTable,
  user_expression_reviews: tracking.UserExpressionReviewsTable,
  learning_observations: tracking.LearningObservationsTable,
  mission_attempts: tracking.MissionAttemptsTable,
  mission_progress: tracking.MissionProgressTable,
  user_achievements: tracking.UserAchievementsTable,
  streak_activity: tracking.StreakActivityTable,
  xp_ledger: tracking.XpLedgerTable,
  daily_learning_metrics: tracking.DailyLearningMetricsTable,
  device_sync_events: tracking.DeviceSyncEventsTable,
  notification_settings: tracking.NotificationSettingsTable,
  notification_deliveries: tracking.NotificationDeliveriesTable,
  feedback_reports: tracking.FeedbackReportsTable,
  moderation_incidents: tracking.ModerationIncidentsTable,
  audit_logs: tracking.AuditLogsTable,
  // §10.2C
  visual_assets: visual.VisualAssetsTable,
  mascot_animations: visual.MascotAnimationsTable,
  character_visual_variants: visual.CharacterVisualVariantsTable,
  mission_visual_bindings: visual.MissionVisualBindingsTable,
  audio_cover_art: visual.AudioCoverArtTable,
} as const satisfies Record<string, AnyTable>;

export type DbTables = typeof DB_TABLES;
export type TableName = keyof DbTables;
/** Every table name, in migration-friendly dependency order. */
export const TABLE_NAMES = Object.keys(DB_TABLES) as readonly TableName[];

export type Row<N extends TableName> = z.infer<DbTables[N]['row']>;
export type Insert<N extends TableName> = z.infer<DbTables[N]['insert']>;

/** Tables that are user-owned (RLS owner policies on `user_id`; negative RLS tests mandatory). */
export const USER_OWNED_TABLES = [
  'profiles', 'account_settings', 'user_course_enrollments', 'user_roles', 'bookmarks', 'user_audio_progress', 'user_download_manifests',
  'conversation_sessions', 'character_relationship_memory', 'user_skill_mastery', 'user_expression_reviews', 'learning_observations',
  'mission_attempts', 'mission_progress', 'user_achievements', 'streak_activity', 'xp_ledger', 'daily_learning_metrics', 'device_sync_events',
  'notification_settings', 'notification_deliveries', 'feedback_reports',
] as const satisfies readonly TableName[];

/** Append-only ledgers with unique idempotency keys (CONVENTIONS §4). */
export const APPEND_ONLY_TABLES = ['xp_ledger', 'device_sync_events', 'ai_requests', 'audit_logs', 'publication_events', 'content_revisions', 'asset_provenance_events', 'learning_observations', 'conversation_turns', 'notification_deliveries'] as const satisfies readonly TableName[];

// Type-level exports for the most used rows.
export type ProfileRow = Row<'profiles'>;
export type EnrollmentRow = Row<'user_course_enrollments'>;
export type EnrollmentInsert = Insert<'user_course_enrollments'>;
export type CourseSourceLocalizationRow = Row<'course_source_localizations'>;
export type MissionRow = Row<'missions'>;
export type MissionStepRow = Row<'mission_steps'>;
export type ExpressionRow = Row<'expressions'>;
export type CharacterRow = Row<'characters'>;
export type MediaAssetRow = Row<'media_assets'>;
export type ContentRightsRow = Row<'content_rights'>;
export type AudioLessonRow = Row<'audio_lessons'>;
export type UploadRow = Row<'uploads'>;
export type ProcessingJobRow = Row<'processing_jobs'>;
export type AiModelProfileRow = Row<'ai_model_profiles'>;
export type ConversationSessionRow = Row<'conversation_sessions'>;
export type UserSkillMasteryRow = Row<'user_skill_mastery'>;
export type UserExpressionReviewRow = Row<'user_expression_reviews'>;
export type LearningObservationRow = Row<'learning_observations'>;
export type XpLedgerRow = Row<'xp_ledger'>;
export type DeviceSyncEventRow = Row<'device_sync_events'>;
export type VisualAssetRow = Row<'visual_assets'>;
export type CourseManifestRow = Row<'course_manifests'>;
export type AudioCollectionManifestRow = Row<'audio_collection_manifests'>;
export type AssetSuggestionRow = Row<'asset_suggestions'>;
export type AssetSuggestionInsert = Insert<'asset_suggestions'>;
