/** §5.2 — curriculum core tables. */
import { z } from 'zod';
import { CourseTrackIdSchema, LanguageCodeSchema, ScriptIdSchema, SourceLanguageCodeSchema, TransliterationSchemeIdSchema, VarietyIdSchema } from '../catalog';
import { AssetKindSchema, AssetVisibilitySchema, CefrLevelSchema, ContentOriginSchema, ContentStateSchema, IntentPolaritySchema, IntentPolitenessSchema, LearnerLevelSchema, LessonTypeSchema, MissionStepTypeSchema, MissionTypeSchema, RegisterSchema, ReviewStatusSchema, TranslationQaStateSchema } from '../enums';
import { BytesSchema, JsonObjectSchema, KeySchema, LocalizedTextSchema, MillisSchema, NonNegativeIntSchema, Sha256Schema, TimestamptzSchema, UnitIntervalSchema, UrlSchema, UuidSchema } from '../primitives';
import { defineLedgerTable, defineTable } from './table';

export const SkillsTable = defineTable('skills', {
  skill_key: KeySchema,
  descriptor: z.string(),
  difficulty: UnitIntervalSchema,
  /** Language family/track scope; null = universal communicative skill. */
  target_language_id: LanguageCodeSchema.nullable(),
  cefr_can_do: CefrLevelSchema.nullable(),
  can_do_statement: z.string().nullable(),
  prerequisite_skill_keys: z.array(KeySchema),
});

export const SkillVariantsTable = defineTable('skill_variants', {
  skill_id: UuidSchema,
  target_variety_id: VarietyIdSchema,
  realization_notes: z.string(),
  example_expression_ids: z.array(UuidSchema),
  review_status: ReviewStatusSchema,
  reviewer_id: UuidSchema.nullable(),
  reviewer_region: z.string().nullable(),
});

export const CommunicativeIntentsTable = defineTable('communicative_intents', {
  intent_key: KeySchema,
  description: z.string(),
  response_constraints: JsonObjectSchema,
  social_meaning: z.string().nullable(),
  polarity: IntentPolaritySchema,
  politeness: IntentPolitenessSchema,
  skill_keys: z.array(KeySchema),
});

export const ExpressionsTable = defineTable('expressions', {
  intent_id: UuidSchema,
  target_variety_id: VarietyIdSchema,
  canonical_text: z.string(),
  register: RegisterSchema,
  difficulty: UnitIntervalSchema,
  scenario_tags: z.array(z.string()),
  script_annotations: JsonObjectSchema,
  phonetic_annotations: JsonObjectSchema,
  reviewed: z.boolean(),
  reviewer_id: UuidSchema.nullable(),
  content_rights_id: UuidSchema.nullable(),
  origin: ContentOriginSchema,
  state: ContentStateSchema,
});

export const ExpressionFormsTable = defineTable('expression_forms', {
  expression_id: UuidSchema,
  script: ScriptIdSchema.nullable(),
  transliteration_scheme: TransliterationSchemeIdSchema.nullable(),
  text: z.string(),
  word_alignment: z.array(z.object({ canonical_index: NonNegativeIntSchema, form_index: NonNegativeIntSchema })),
  tone_markers: z.array(z.string()).nullable(),
  ipa: z.string().nullable(),
});

export const ExpressionTranslationsTable = defineTable('expression_translations', {
  expression_id: UuidSchema,
  source_language_code: SourceLanguageCodeSchema,
  natural_meaning: z.string(),
  context_note: z.string().nullable(),
  literal_gloss: z.string().nullable(),
  qa_state: TranslationQaStateSchema,
  reviewer_id: UuidSchema.nullable(),
});

export const ExpressionAudioTable = defineTable('expression_audio', {
  expression_id: UuidSchema,
  voice_id: z.string(),
  speaker_id: UuidSchema.nullable(),
  asset_id: UuidSchema,
  speech_rate: z.enum(['slow', 'normal', 'fast']),
  regional_option: z.string().nullable(),
  synthetic: z.boolean(),
  quality_flag: z.enum(['unreviewed', 'ok', 'poor', 'wrong_variety']),
  reviewed: z.boolean(),
});

export const LessonCoursesTable = defineTable('lesson_courses', {
  course_track_id: CourseTrackIdSchema,
  title_translations: LocalizedTextSchema,
  description_translations: LocalizedTextSchema,
  cover_visual_asset_id: UuidSchema.nullable(),
  sort_order: NonNegativeIntSchema,
  state: ContentStateSchema,
  content_rights_id: UuidSchema.nullable(),
  published_revision: NonNegativeIntSchema.nullable(),
});

export const ChaptersTable = defineTable('chapters', {
  lesson_course_id: UuidSchema,
  title_translations: LocalizedTextSchema,
  description_translations: LocalizedTextSchema,
  sort_index: NonNegativeIntSchema,
  scene: z.string().nullable(),
  region: z.string().nullable(),
  cover_visual_asset_id: UuidSchema.nullable(),
  map_visual_asset_id: UuidSchema.nullable(),
  state: ContentStateSchema,
});

export const MissionsTable = defineTable('missions', {
  chapter_id: UuidSchema.nullable(),
  /** Cross-course reusable template key when `chapter_id` is null. */
  template_key: KeySchema.nullable(),
  mission_type: MissionTypeSchema,
  title_translations: LocalizedTextSchema,
  goals: z.array(z.object({ id: z.string(), skill_keys: z.array(KeySchema), description_key: z.string() })),
  target_variety_id: VarietyIdSchema,
  level: LearnerLevelSchema,
  recommended_minutes: z.number().min(1),
  published_revision: NonNegativeIntSchema.nullable(),
  prerequisite_skill_keys: z.array(KeySchema),
  difficulty: UnitIntervalSchema,
  narrative_segment: JsonObjectSchema.nullable(),
  scoring_rubric: JsonObjectSchema,
  sort_order: NonNegativeIntSchema,
  state: ContentStateSchema,
});

export const MissionLocalizationsTable = defineTable('mission_localizations', {
  mission_id: UuidSchema,
  source_language_code: SourceLanguageCodeSchema,
  title: z.string(),
  instructions: z.string(),
  hints: z.array(z.string()),
  help_text: z.string().nullable(),
  qa_state: TranslationQaStateSchema,
  reviewer_id: UuidSchema.nullable(),
});

export const MissionStepsTable = defineTable('mission_steps', {
  mission_id: UuidSchema,
  sort_order: NonNegativeIntSchema,
  step_type: MissionStepTypeSchema,
  lesson_type: LessonTypeSchema.nullable(),
  prompt_asset_ids: z.array(UuidSchema),
  visual_asset_ids: z.array(UuidSchema),
  target_expression_ids: z.array(UuidSchema),
  success_conditions: JsonObjectSchema,
  hint_scaffold: z.array(z.string()),
  valid_intent_ids: z.array(UuidSchema),
  branching: JsonObjectSchema.nullable(),
  estimated_seconds: NonNegativeIntSchema,
  offline_capable: z.boolean(),
});

export const MissionGraphEdgesTable = defineTable('mission_graph_edges', {
  from_mission_id: UuidSchema,
  to_mission_id: UuidSchema,
  edge_type: z.enum(['prerequisite', 'next', 'branch']),
  branch_condition: JsonObjectSchema.nullable(),
  reward: JsonObjectSchema.nullable(),
  character_memory_change: JsonObjectSchema.nullable(),
});

export const DialogueScenariosTable = defineTable('dialogue_scenarios', {
  mission_id: UuidSchema.nullable(),
  scene: z.string(),
  learner_role: z.string(),
  character_id: UuidSchema,
  min_level: LearnerLevelSchema,
  max_level: LearnerLevelSchema,
  expected_intent_ids: z.array(UuidSchema),
  interruption_policy: z.enum(['allow_barge_in', 'finish_sentence', 'no_interruptions']),
  safety_rules: z.array(z.string()),
  topic_rules: z.array(z.string()),
  scene_facts: z.array(z.string()),
  state: ContentStateSchema,
});

export const DialogueVariantsTable = defineTable('dialogue_variants', {
  scenario_id: UuidSchema,
  target_variety_id: VarietyIdSchema,
  regional_option: z.string().nullable(),
  turns: z.array(z.object({ speaker: z.enum(['learner', 'character']), text: z.string(), alternatives: z.array(z.string()) })),
  source_language_code: SourceLanguageCodeSchema.nullable(),
  source_support: JsonObjectSchema.nullable(),
  review_status: ReviewStatusSchema,
  reviewer_id: UuidSchema.nullable(),
});

export const CharactersTable = defineTable('characters', {
  character_key: KeySchema,
  name: z.string(),
  role: z.string(),
  personality: z.string(),
  home_region: z.string(),
  target_variety_id: VarietyIdSchema,
  regional_option: z.string().nullable(),
  voice_profile: JsonObjectSchema,
  storyline_facts: z.array(z.string()),
  portrait_visual_asset_id: UuidSchema.nullable(),
  safety_rules: z.array(z.string()),
  relationships: z.array(z.object({ character_id: UuidSchema, relation: z.string() })),
  state: ContentStateSchema,
});

export const StoryArcsTable = defineTable('story_arcs', {
  course_track_id: CourseTrackIdSchema,
  character_ids: z.array(UuidSchema),
  region: z.string(),
  title_translations: LocalizedTextSchema,
  milestones: z.array(z.object({ id: z.string(), condition: JsonObjectSchema, unlock_key: z.string() })),
  learner_memory_schema: JsonObjectSchema,
  state: ContentStateSchema,
});

export const MediaAssetsTable = defineTable('media_assets', {
  /** R2 object key: generated id + content hash, never a user filename. */
  storage_key: z.string(),
  bucket: z.string(),
  owner_id: UuidSchema.nullable(),
  kind: AssetKindSchema,
  checksum_sha256: Sha256Schema,
  mime_type: z.string(),
  byte_length: BytesSchema,
  duration_ms: MillisSchema.nullable(),
  channels: z.number().int().min(1).nullable(),
  sample_rate_hz: z.number().int().positive().nullable(),
  bitrate_kbps: z.number().int().positive().nullable(),
  source_asset_id: UuidSchema.nullable(),
  derivation: z.string().nullable(),
  visibility: AssetVisibilitySchema,
  content_rights_id: UuidSchema.nullable(),
  disposition: z.enum(['active', 'quarantined', 'revoked', 'deleted']),
  legacy_filename: z.string().nullable(),
  legacy_path: z.string().nullable(),
  state: ContentStateSchema,
  etag: z.string().nullable(),
});

export const ContentRightsTable = defineTable('content_rights', {
  origin_url: UrlSchema.nullable(),
  authors: z.array(z.string()),
  speakers: z.array(z.string()),
  permission_grant: z.string(),
  license_id: z.string(),
  license_version: z.string().nullable(),
  commercial_redistribution: z.boolean(),
  attribution_required: z.boolean(),
  attribution_text: z.string().nullable(),
  alterations_permitted: z.boolean(),
  ai_processing_permitted: z.boolean(),
  voice_rights: z.enum(['none', 'playback_only', 'synthesis_permitted']),
  expires_at: TimestamptzSchema.nullable(),
  revoked_at: TimestamptzSchema.nullable(),
  evidence_asset_id: UuidSchema.nullable(),
  reviewer_id: UuidSchema.nullable(),
  reviewed_at: TimestamptzSchema.nullable(),
  verified: z.boolean(),
});

export const ContentRevisionsTable = defineLedgerTable('content_revisions', {
  entity_table: z.string(),
  entity_id: UuidSchema,
  revision: NonNegativeIntSchema,
  diff: JsonObjectSchema,
  snapshot: JsonObjectSchema.nullable(),
  editor_id: UuidSchema,
  note: z.string().nullable(),
});

export const PublicationEventsTable = defineLedgerTable('publication_events', {
  entity_table: z.string(),
  entity_id: UuidSchema,
  revision: NonNegativeIntSchema,
  from_state: ContentStateSchema.nullable(),
  to_state: ContentStateSchema,
  actor_id: UuidSchema,
  reason: z.string().nullable(),
  rollback_of_event_id: UuidSchema.nullable(),
});
