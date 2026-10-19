/** §10.2C — visual asset tables. */
import { z } from 'zod';
import { CharacterExpressionSchema, ContentOriginSchema, MascotAnimationSchema, MascotStateSchema, ReviewStatusSchema, VisualAssetTypeSchema } from '../enums';
import { BytesSchema, DimensionsSchema, FocalPointSchema, JsonObjectSchema, KeySchema, MillisSchema, Sha256Schema, UuidSchema } from '../primitives';
import { defineTable } from './table';

export const VisualAssetsTable = defineTable('visual_assets', {
  storage_key: z.string(),
  type: VisualAssetTypeSchema,
  style_version: z.string(),
  content_hash: Sha256Schema,
  license_id: UuidSchema.nullable(),
  alt_text_key: KeySchema,
  /** Per-source-language alt text for uploaded assets (migration 120); `alt_text_key` serves catalog-backed art. */
  alt_text_translations: z.record(z.string(), z.string()),
  focal_point: FocalPointSchema.nullable(),
  dimensions: DimensionsSchema,
  locale_neutral: z.boolean(),
  review_status: ReviewStatusSchema,
  origin: ContentOriginSchema,
  mime_type: z.string(),
  byte_length: BytesSchema,
  dominant_colors: z.array(z.string()),
  variants: z.array(z.object({ format: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), storage_key: z.string(), content_hash: Sha256Schema, byte_length: BytesSchema })),
  generation_brief: JsonObjectSchema.nullable(),
  prompt_template_id: z.string().nullable(),
  source_file_asset_id: UuidSchema.nullable(),
  replaced_by_asset_id: UuidSchema.nullable(),
  moderation_status: z.enum(['unchecked', 'passed', 'flagged']),
});

export const MascotAnimationsTable = defineTable('mascot_animations', {
  state: MascotStateSchema.nullable(),
  animation: MascotAnimationSchema.nullable(),
  visual_asset_id: UuidSchema,
  /** Mandatory static fallback. */
  static_visual_asset_id: UuidSchema,
  format: z.enum(['lottie', 'rive', 'svg_css', 'sprite']),
  duration_ms: MillisSchema.nullable(),
  loop: z.boolean(),
  size_variant: z.enum(['icon', 'companion', 'medium', 'large']),
  style_version: z.string(),
  review_status: ReviewStatusSchema,
});

export const CharacterVisualVariantsTable = defineTable('character_visual_variants', {
  character_id: UuidSchema,
  expression: CharacterExpressionSchema.nullable(),
  body: z.enum(['portrait', 'half', 'full']),
  clothing_variant: z.string().nullable(),
  visual_asset_id: UuidSchema,
  style_version: z.string(),
  review_status: ReviewStatusSchema,
  cultural_review_note: z.string().nullable(),
});

export const MissionVisualBindingsTable = defineTable('mission_visual_bindings', {
  mission_id: UuidSchema,
  mission_step_id: UuidSchema.nullable(),
  visual_asset_id: UuidSchema,
  role: z.enum(['scene', 'context_object', 'story_panel', 'celebration', 'map']),
  sort_order: z.number().int().min(0),
  semantic_labels: z.array(z.string()),
  variety_specific: z.boolean(),
});

export const AudioCoverArtTable = defineTable('audio_cover_art', {
  collection_id: UuidSchema.nullable(),
  chapter_id: UuidSchema.nullable(),
  lesson_id: UuidSchema.nullable(),
  visual_asset_id: UuidSchema,
  generated_from_template: z.boolean(),
  template_id: z.string().nullable(),
  review_status: ReviewStatusSchema,
});
