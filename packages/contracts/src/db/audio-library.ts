/** §5.3 — audio library and CMS tables. */
import { z } from 'zod';
import { CourseTrackIdSchema, ScriptIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { AudioAssetTypeSchema, ContentStateSchema, JobStateSchema, LearnerLevelSchema, ProcessingJobTypeAllSchema, ReviewStatusSchema, SpeakerConsentStateSchema, TranscriptStatusSchema, TranslationQaStateSchema, UploadStatusSchema } from '../enums';
import { BytesSchema, JsonObjectSchema, LocalizedTextSchema, MillisSchema, NonNegativeIntSchema, PercentSchema, Sha256Schema, TimestamptzSchema, UnitIntervalSchema, UuidSchema } from '../primitives';
import { defineLedgerTable, defineTable } from './table';

export const AudioCourseCollectionsTable = defineTable('audio_course_collections', {
  title_translations: LocalizedTextSchema,
  description_translations: LocalizedTextSchema,
  course_track_id: CourseTrackIdSchema.nullable(),
  target_variety_id: VarietyIdSchema.nullable(),
  instruction_language_code: SourceLanguageCodeSchema.nullable(),
  region: z.string().nullable(),
  instructor_speaker_id: UuidSchema.nullable(),
  cover_visual_asset_id: UuidSchema.nullable(),
  content_rights_id: UuidSchema.nullable(),
  state: ContentStateSchema,
  sort_order: NonNegativeIntSchema,
  published_version: NonNegativeIntSchema.nullable(),
});

export const AudioChaptersTable = defineTable('audio_chapters', {
  collection_id: UuidSchema,
  title_translations: LocalizedTextSchema,
  summary_translations: LocalizedTextSchema,
  sort_order: NonNegativeIntSchema,
  cover_visual_asset_id: UuidSchema.nullable(),
  state: ContentStateSchema,
});

export const AudioLessonsTable = defineTable('audio_lessons', {
  chapter_id: UuidSchema,
  title_translations: LocalizedTextSchema,
  description_translations: LocalizedTextSchema,
  sort_order: NonNegativeIntSchema,
  episode_number: NonNegativeIntSchema.nullable(),
  level: LearnerLevelSchema.nullable(),
  target_variety_id: VarietyIdSchema.nullable(),
  instruction_language_code: SourceLanguageCodeSchema.nullable(),
  /** Languages actually spoken in the file (code-switch aware). */
  spoken_language_codes: z.array(z.string()),
  regional_dialect: z.string().nullable(),
  topic: z.string().nullable(),
  tags: z.array(z.string()),
  scene: z.string().nullable(),
  state: ContentStateSchema,
  transcript_status: TranscriptStatusSchema,
  listen_length_ms: MillisSchema.nullable(),
  quality_review_status: z.enum(['unreviewed', 'approved', 'rejected']),
  visibility: z.enum(['private', 'authenticated']),
  content_rights_id: UuidSchema.nullable(),
  cover_visual_asset_id: UuidSchema.nullable(),
  published_revision: NonNegativeIntSchema.nullable(),
});

export const AudioLessonAssetsTable = defineTable('audio_lesson_assets', {
  lesson_id: UuidSchema,
  asset_id: UuidSchema,
  asset_type: AudioAssetTypeSchema,
  sort_order: NonNegativeIntSchema,
});

export const SpeakersTable = defineTable('speakers', {
  display_name: z.string(),
  pseudonymous: z.boolean(),
  target_variety_id: VarietyIdSchema.nullable(),
  region: z.string().nullable(),
  consent_state: SpeakerConsentStateSchema,
  content_rights_id: UuidSchema.nullable(),
  voice_description: z.string().nullable(),
  synthetic: z.boolean(),
});

export const LessonSpeakersTable = defineTable('lesson_speakers', {
  lesson_id: UuidSchema,
  speaker_id: UuidSchema,
  role: z.enum(['instructor', 'native_speaker', 'narrator', 'learner_model', 'other']),
  voice_segments: z.array(z.object({ start_ms: MillisSchema, end_ms: MillisSchema })).nullable(),
});

export const TranscriptsTable = defineTable('transcripts', {
  lesson_id: UuidSchema,
  language_mode: z.enum(['source', 'target', 'mixed']),
  primary_language_code: z.string(),
  revision: NonNegativeIntSchema,
  coverage_pct: PercentSchema,
  status: TranscriptStatusSchema,
  qa_state: TranslationQaStateSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  access_rights: z.enum(['internal_only', 'learners', 'public']),
  source_asset_id: UuidSchema.nullable(),
  manually_uploaded: z.boolean(),
});

export const TranscriptSegmentsTable = defineTable('transcript_segments', {
  transcript_id: UuidSchema,
  sort_index: NonNegativeIntSchema,
  start_ms: MillisSchema,
  end_ms: MillisSchema,
  text: z.string(),
  speaker_label: z.string().nullable(),
  speaker_id: UuidSchema.nullable(),
  language_code: z.string().nullable(),
  target_variety_id: VarietyIdSchema.nullable(),
  script: ScriptIdSchema.nullable(),
  confidence: UnitIntervalSchema.nullable(),
  reviewed: z.boolean(),
});

export const TranscriptTranslationsTable = defineTable('transcript_translations', {
  segment_id: UuidSchema,
  language_code: SourceLanguageCodeSchema,
  text: z.string(),
  qa_state: TranslationQaStateSchema,
  quality_flags: z.array(z.string()),
  reviewer_id: UuidSchema.nullable(),
});

export const TranscriptWordAlignmentsTable = defineTable('transcript_word_alignments', {
  segment_id: UuidSchema,
  word_index: NonNegativeIntSchema,
  word: z.string(),
  start_ms: MillisSchema,
  end_ms: MillisSchema,
  confidence: UnitIntervalSchema.nullable(),
  expression_id: UuidSchema.nullable(),
});

export const LessonTagsTable = defineTable('lesson_tags', {
  lesson_id: UuidSchema,
  tag: z.string().min(1).max(64),
});

export const LessonTopicsTable = defineTable('lesson_topics', {
  lesson_id: UuidSchema,
  topic_key: z.string().min(1).max(64),
  confidence: UnitIntervalSchema.nullable(),
  provenance: z.enum(['editor', 'ai_suggested', 'import']),
});

export const BookmarksTable = defineTable('bookmarks', {
  user_id: UuidSchema,
  lesson_id: UuidSchema,
  position_ms: MillisSchema,
  note: z.string().max(500).nullable(),
  segment_id: UuidSchema.nullable(),
  client_event_id: UuidSchema,
});

export const UserAudioProgressTable = defineTable('user_audio_progress', {
  user_id: UuidSchema,
  lesson_id: UuidSchema,
  position_ms: MillisSchema,
  duration_ms: MillisSchema.nullable(),
  completed: z.boolean(),
  completed_at: TimestamptzSchema.nullable(),
  play_count: NonNegativeIntSchema,
  revision: NonNegativeIntSchema,
  last_client_event_id: UuidSchema.nullable(),
});

export const UserDownloadManifestsTable = defineTable('user_download_manifests', {
  user_id: UuidSchema,
  lesson_id: UuidSchema,
  pack_id: UuidSchema,
  version: NonNegativeIntSchema,
  checksum: Sha256Schema,
  total_bytes: BytesSchema,
  device_id: z.string().nullable(),
  downloaded_at: TimestamptzSchema.nullable(),
  revoked_at: TimestamptzSchema.nullable(),
});

export const UploadsTable = defineTable('uploads', {
  user_id: UuidSchema,
  draft_asset_id: UuidSchema.nullable(),
  storage_key: z.string(),
  multipart_upload_id: z.string().nullable(),
  /** DB CHECK: `part_size_bytes > 0`. */
  part_size_bytes: z.number().int().positive(),
  part_count: NonNegativeIntSchema,
  completed_parts: z.array(z.object({ part_number: z.number().int().min(1), etag: z.string(), byte_length: BytesSchema })),
  original_filename: z.string(),
  original_path: z.string().nullable(),
  declared_mime_type: z.string(),
  declared_byte_length: BytesSchema,
  client_checksum_sha256: Sha256Schema,
  verified_checksum_sha256: Sha256Schema.nullable(),
  status: UploadStatusSchema,
  failure_code: z.string().nullable(),
  idempotency_key: z.string(),
  expires_at: TimestamptzSchema,
});

export const ProcessingJobsTable = defineTable('processing_jobs', {
  job_type: ProcessingJobTypeAllSchema,
  parent_asset_id: UuidSchema.nullable(),
  parent_entity_table: z.string().nullable(),
  parent_entity_id: UuidSchema.nullable(),
  state: JobStateSchema,
  priority: z.number().int().min(0).max(10),
  attempts: NonNegativeIntSchema,
  /** DB CHECK: `max_attempts >= 1`. */
  max_attempts: z.number().int().min(1),
  progress_pct: PercentSchema,
  provider: z.string().nullable(),
  params: JsonObjectSchema,
  cost_estimate_usd: z.number().min(0).nullable(),
  cost_actual_usd: z.number().min(0).nullable(),
  failure_code: z.string().nullable(),
  failure_message: z.string().nullable(),
  output_asset_ids: z.array(UuidSchema),
  output: JsonObjectSchema.nullable(),
  idempotency_key: z.string(),
  requested_by: UuidSchema.nullable(),
  started_at: TimestamptzSchema.nullable(),
  finished_at: TimestamptzSchema.nullable(),
  locked_by: z.string().nullable(),
  locked_until: TimestamptzSchema.nullable(),
});

export const AssetProvenanceEventsTable = defineLedgerTable('asset_provenance_events', {
  asset_id: UuidSchema,
  event_type: z.enum(['uploaded', 'imported', 'rights_attached', 'rights_revoked', 'transcoded', 'transcribed', 'aligned', 'edited', 'replaced', 'removed']),
  actor_id: UuidSchema.nullable(),
  job_id: UuidSchema.nullable(),
  details: JsonObjectSchema,
});

/**
 * Stored course manifests (ADR-004, migration 100): one row per (track, source, version). `manifest`
 * is the exact `CourseManifest` JSON the API serves and `checksum` its content hash; learners read
 * rows with `published_at` set, editors/jobs write. Validate `manifest` with `CourseManifestSchema`
 * at the boundary that needs the typed shape.
 */
export const CourseManifestsTable = defineTable('course_manifests', {
  course_track_id: CourseTrackIdSchema,
  source_language_code: SourceLanguageCodeSchema,
  version: NonNegativeIntSchema,
  checksum: Sha256Schema,
  manifest: JsonObjectSchema,
  published_at: TimestamptzSchema.nullable(),
  generated_by_job_id: UuidSchema.nullable(),
});

/** Instruction language a stored audio manifest was built for, or `'any'` (collection-wide). */
export const AudioManifestInstructionLanguageSchema = z.union([z.literal('any'), SourceLanguageCodeSchema]);

/** Stored audio-collection manifests (ADR-004, migration 100): one row per (collection, instruction language, version). */
export const AudioCollectionManifestsTable = defineTable('audio_collection_manifests', {
  collection_id: UuidSchema,
  instruction_language_code: AudioManifestInstructionLanguageSchema,
  version: NonNegativeIntSchema,
  checksum: Sha256Schema,
  manifest: JsonObjectSchema,
  published_at: TimestamptzSchema.nullable(),
  generated_by_job_id: UuidSchema.nullable(),
});

/** §7.4 — what an AI suggestion is about. */
export const ASSET_SUGGESTION_KIND_VALUES = ['metadata', 'language', 'variety', 'lesson_structure', 'description', 'tags', 'topics', 'level', 'cover', 'transcript_quality', 'other'] as const;
export const AssetSuggestionKindSchema = z.enum(ASSET_SUGGESTION_KIND_VALUES);
export type AssetSuggestionKind = z.infer<typeof AssetSuggestionKindSchema>;

/** Provenance recorded with every AI suggestion (never prompts with learner data). */
export const AssetSuggestionProvenanceSchema = z.object({
  task: z.string(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  promptVersion: z.string().nullish(),
  traceId: z.string().nullish(),
  jobId: UuidSchema.nullish(),
  evidenceSource: z.string().nullish(),
  generatedAt: TimestamptzSchema.nullish(),
}).loose();
export type AssetSuggestionProvenance = z.infer<typeof AssetSuggestionProvenanceSchema>;

/**
 * §7.4 — AI metadata / organisation suggestions (migration 100). Never auto-applied: an editor approves
 * or rejects each row (`review_status`); `reviewer_id` / `decided_at` are stamped by a trigger.
 * Staff-only (RLS); learners never see suggestions.
 */
export const AssetSuggestionsTable = defineTable('asset_suggestions', {
  media_asset_id: UuidSchema,
  lesson_id: UuidSchema.nullable(),
  job_id: UuidSchema.nullable(),
  kind: AssetSuggestionKindSchema,
  suggestion: JsonObjectSchema,
  confidence: UnitIntervalSchema.nullable(),
  provenance: JsonObjectSchema,
  review_status: ReviewStatusSchema,
  reviewer_id: UuidSchema.nullable(),
  decided_at: TimestamptzSchema.nullable(),
  decision_note: z.string().max(2000).nullable(),
});
