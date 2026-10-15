/**
 * Visual identity contracts (§10.2A–C): visual assets, character visual/voice
 * profiles, scene-art metadata, mascot state assets and art-direction prompt
 * templates stored as project assets for reproducibility.
 */
import { z } from 'zod';
import { VarietyIdSchema } from './catalog';
import {
  CharacterExpressionSchema,
  ContentOriginSchema,
  MascotAnimationSchema,
  MascotStateSchema,
  ReviewStatusSchema,
  VisualAssetTypeSchema,
} from './enums';
import { DimensionsSchema, FocalPointSchema, JsonObjectSchema, KeySchema, Sha256Schema, TimestamptzSchema, UrlSchema, UuidSchema } from './primitives';

export const ImageFormatSchema = z.enum(['svg', 'webp', 'avif', 'png', 'jpeg', 'lottie', 'rive']);
export type ImageFormat = z.infer<typeof ImageFormatSchema>;

/** Responsive variant of a visual asset. */
export const VisualVariantSchema = z.object({
  format: ImageFormatSchema,
  dimensions: DimensionsSchema,
  storageKey: z.string(),
  contentHash: Sha256Schema,
  byteLength: z.number().int().min(0),
  /** Only for explicitly public assets. */
  publicUrl: UrlSchema.nullable(),
});
export type VisualVariant = z.infer<typeof VisualVariantSchema>;

/** API/UI-facing visual asset (mirrors the `visual_assets` row plus derived variants). */
export const VisualAssetSchema = z.object({
  id: UuidSchema,
  type: VisualAssetTypeSchema,
  storageKey: z.string(),
  styleVersion: z.string(),
  contentHash: Sha256Schema,
  licenseId: UuidSchema.nullable(),
  altTextKey: KeySchema,
  focalPoint: FocalPointSchema.nullable(),
  dimensions: DimensionsSchema,
  localeNeutral: z.boolean(),
  reviewStatus: ReviewStatusSchema,
  origin: ContentOriginSchema,
  dominantColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  variants: z.array(VisualVariantSchema),
  /** Generation parameters/brief when AI-generated (never prompts with personal data). */
  generationBrief: JsonObjectSchema.nullable(),
  createdAt: TimestamptzSchema,
});
export type VisualAsset = z.infer<typeof VisualAssetSchema>;

/** §10.2A — consistent look of a recurring character. */
export const CharacterVisualProfileSchema = z.object({
  characterId: UuidSchema,
  styleVersion: z.string(),
  /** Short written description of silhouette/anatomy to keep generations consistent. */
  silhouetteNotes: z.string(),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  /** Required expression set → visual asset ids (missing entries mean "not yet produced"). */
  expressions: z.record(CharacterExpressionSchema, UuidSchema.nullable()),
  halfBodyAssetId: UuidSchema.nullable(),
  fullBodyAssetId: UuidSchema.nullable(),
  clothingVariants: z.array(z.object({ id: z.string(), label: z.string(), assetId: UuidSchema.nullable() })),
  /** True when every required expression has a reviewed asset. */
  complete: z.boolean(),
  reviewStatus: ReviewStatusSchema,
  culturalReviewNote: z.string().nullable(),
});
export type CharacterVisualProfile = z.infer<typeof CharacterVisualProfileSchema>;

/** §10.2A — consistent voice identity of a character; must match the character's dialect. */
export const CharacterVoiceProfileSchema = z.object({
  characterId: UuidSchema,
  varietyId: VarietyIdSchema,
  provider: z.string(),
  voiceId: z.string(),
  /** Regional accent/option id within the variety (e.g. `SY`, `south`). */
  regionalOption: z.string().nullable(),
  /** Speech rate multiplier (1 = natural). */
  speechRate: z.number().min(0.5).max(1.5),
  pitchSemitones: z.number().min(-12).max(12),
  /** Must be surfaced to the learner (§8.6). */
  synthetic: z.boolean(),
  nativeReviewed: z.boolean(),
  reviewStatus: ReviewStatusSchema,
});
export type CharacterVoiceProfile = z.infer<typeof CharacterVoiceProfileSchema>;

/** §10.2A — scene art metadata for mission/location artwork. */
export const SceneArtMetadataSchema = z.object({
  assetId: UuidSchema,
  place: z.string(),
  action: z.string().nullable(),
  varietyId: VarietyIdSchema.nullable(),
  /** Reviewed locale/cultural context string used in the prompt. */
  culturalContext: z.string(),
  /** Which conversational objective the art supports. */
  objectiveSkillKeys: z.array(KeySchema),
  composition: z.enum(['16:9', '4:3', '1:1', '9:16']),
  colorVariants: z.array(z.object({ id: z.string(), assetId: UuidSchema })),
  altTextKey: KeySchema,
  focalPoint: FocalPointSchema.nullable(),
  rightsId: UuidSchema.nullable(),
  promptTemplateId: z.string().nullable(),
  reviewStatus: ReviewStatusSchema,
});
export type SceneArtMetadata = z.infer<typeof SceneArtMetadataSchema>;

/** Mascot asset pack: static state → asset, animation → clip (static alternatives mandatory). */
export const MascotAssetPackSchema = z.object({
  styleVersion: z.string(),
  states: z.record(MascotStateSchema, UuidSchema.nullable()),
  animations: z.record(MascotAnimationSchema, UuidSchema.nullable()),
  /** Sizes produced: 24–40 dp icon, 64–96 dp companion, medium, large. */
  sizeVariants: z.array(z.enum(['icon', 'companion', 'medium', 'large'])),
  masterSourceAssetId: UuidSchema.nullable(),
  complete: z.boolean(),
});
export type MascotAssetPack = z.infer<typeof MascotAssetPackSchema>;

export const ArtPromptKindSchema = z.enum(['mission_environment', 'conversation_character', 'mascot_pack', 'context_image']);
export type ArtPromptKind = z.infer<typeof ArtPromptKindSchema>;

/** §10.2A — normalized art-direction prompt template stored as a project asset. */
export const ArtDirectionPromptTemplateSchema = z.object({
  id: z.string().min(1),
  kind: ArtPromptKindSchema,
  version: z.string(),
  /** Template with `[bracketed]` placeholders substituted from reviewed content only. */
  template: z.string().min(1),
  placeholders: z.array(z.string()),
  styleReferenceAssetIds: z.array(UuidSchema),
  /** Rights constraints: style references may only be reused when rights allow. */
  styleReferenceRightsVerified: z.boolean(),
  negativeConstraints: z.array(z.string()),
  outputComposition: z.enum(['16:9', '4:3', '1:1', '9:16', 'transparent']),
  requiresAltDescription: z.boolean(),
});
export type ArtDirectionPromptTemplate = z.infer<typeof ArtDirectionPromptTemplateSchema>;

/** The spec's four normalized templates, verbatim (§10.2A). */
export const ART_DIRECTION_PROMPT_TEMPLATES: readonly ArtDirectionPromptTemplate[] = [
  {
    id: 'mission-environment',
    kind: 'mission_environment',
    version: '1',
    template:
      'Original stylized premium editorial illustration for an interactive spoken language-learning game. Scene: [reviewed place and action]. Geographic/cultural context: [reviewed locale]. Clear visual cues to [conversational learning objective], comfortable perspective, expressive warm light, visually uncluttered center for readable overlays, friendly cohesive palette, no baked-in words, no logos, no imitation of existing language-app brand, 16:9 composition. Create an alt description.',
    placeholders: ['reviewed place and action', 'reviewed locale', 'conversational learning objective'],
    styleReferenceAssetIds: [],
    styleReferenceRightsVerified: false,
    negativeConstraints: ['no baked-in words', 'no logos', 'no imitation of existing language-app brand', 'no cultural stereotypes'],
    outputComposition: '16:9',
    requiresAltDescription: true,
  },
  {
    id: 'conversation-character',
    kind: 'conversation_character',
    version: '1',
    template:
      "Original fictional [reviewed age/role/region] character portrait for a playful premium language-learning adventure, warm expressive readable face, coherent approved global character style, culturally authentic contemporary clothing, distinct recognizable silhouette, clean background for UI avatar, variations: neutral, greeting, listening, speaking, questioning, encouraging. Never based on a specific real person's likeness. No writing/logos.",
    placeholders: ['reviewed age/role/region'],
    styleReferenceAssetIds: [],
    styleReferenceRightsVerified: false,
    negativeConstraints: ['never based on a real person', 'no writing/logos', 'no stereotyped costumes'],
    outputComposition: '1:1',
    requiresAltDescription: true,
  },
  {
    id: 'mascot-pack',
    kind: 'mascot_pack',
    version: '1',
    template:
      'Original floating orbit-creature mascot with friendly rounded body, expressive eyes, tiny limbs and asymmetrical ribbon-like tail, original unique silhouette, consistent model sheet and palette, front/3-quarter/side views, expressions neutral/happy/listening/thinking/encouraging/celebrating/quiet/offline, adaptable to small UI scale, no owl/bird resemblance, no franchise or brand imitation, vector-friendly shapes, transparent background.',
    placeholders: [],
    styleReferenceAssetIds: [],
    styleReferenceRightsVerified: false,
    negativeConstraints: ['no owl/bird resemblance', 'no franchise or brand imitation'],
    outputComposition: 'transparent',
    requiresAltDescription: true,
  },
  {
    id: 'context-image',
    kind: 'context_image',
    version: '1',
    template:
      'Clear single focal [object/action] illustrating the intended meaning of [expression/intent], contextual realistic visual clues, background simple enough to avoid answer ambiguity, consistent app style, no embedded text, square or 4:3.',
    placeholders: ['object/action', 'expression/intent'],
    styleReferenceAssetIds: [],
    styleReferenceRightsVerified: false,
    negativeConstraints: ['no embedded text', 'no contradictory distracting elements'],
    outputComposition: '4:3',
    requiresAltDescription: true,
  },
];
