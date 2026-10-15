/**
 * Versioned manifests (§4.4): course manifests, audio collection manifests and
 * offline download packs. Asset URLs are obtained lazily (never embedded in the
 * cacheable manifest) so manifests can be edge-cached and shared across learners.
 */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from './catalog';
import { AssetKindSchema, LearnerLevelSchema, LessonTypeSchema, MissionStepTypeSchema, MissionTypeSchema, VisualAssetTypeSchema } from './enums';
import { BytesSchema, KeySchema, MillisSchema, NonNegativeIntSchema, Sha256Schema, TimestamptzSchema, UrlSchema, UuidSchema } from './primitives';

export const MANIFEST_FORMAT_VERSION = 1 as const;

/** Lazy reference to a media/visual asset. The client resolves `assetId` to a URL via the playback-url endpoint. */
export const AssetRefSchema = z.object({
  assetId: UuidSchema,
  kind: AssetKindSchema,
  contentHash: Sha256Schema,
  byteLength: BytesSchema.nullable(),
  mimeType: z.string(),
  durationMs: MillisSchema.nullable(),
  /** Present only for explicitly public assets (icons, approved art); private media is always resolved lazily. */
  publicUrl: UrlSchema.nullable(),
  /** i18n key for the accessible description. */
  altTextKey: KeySchema.nullable(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const VisualRefSchema = AssetRefSchema.extend({ visualType: VisualAssetTypeSchema });
export type VisualRef = z.infer<typeof VisualRefSchema>;

export const ManifestStepSchema = z.object({
  id: UuidSchema,
  order: NonNegativeIntSchema,
  type: MissionStepTypeSchema,
  lessonType: LessonTypeSchema.nullable(),
  estimatedSeconds: NonNegativeIntSchema,
  /** Expressions exercised by the step (ids only; text is fetched with mission detail). */
  expressionIds: z.array(UuidSchema),
  assets: z.array(AssetRefSchema),
  visuals: z.array(VisualRefSchema),
  /** Whether the step can run fully offline with downloaded assets. */
  offlineCapable: z.boolean(),
});
export type ManifestStep = z.infer<typeof ManifestStepSchema>;

export const ManifestMissionSchema = z.object({
  id: UuidSchema,
  order: NonNegativeIntSchema,
  type: MissionTypeSchema,
  /** i18n key; the title text for the source language is in `title`. */
  titleKey: KeySchema.nullable(),
  title: z.string(),
  level: LearnerLevelSchema,
  difficulty: z.number().min(0).max(1),
  recommendedMinutes: z.number().min(1),
  prerequisiteSkillKeys: z.array(KeySchema),
  skillKeys: z.array(KeySchema),
  characterIds: z.array(UuidSchema),
  sceneArt: VisualRefSchema.nullable(),
  publishedRevision: NonNegativeIntSchema,
  steps: z.array(ManifestStepSchema),
  /** Whether source-language localization is complete for this mission (honest coverage, §2.1). */
  localizationComplete: z.boolean(),
  /**
   * Language `title` is actually in: the requested source language, the fallback the coverage row
   * explicitly declares, or `null` when no usable title exists (then `title` is `''`). Never a
   * silent substitution (§2.1). Optional for manifests produced before this field existed.
   */
  titleLanguageCode: z.string().nullable().optional(),
});
export type ManifestMission = z.infer<typeof ManifestMissionSchema>;

export const ManifestChapterSchema = z.object({
  id: UuidSchema,
  order: NonNegativeIntSchema,
  title: z.string(),
  /** Language `title` is in (see `ManifestMissionSchema.titleLanguageCode`); `null` when `title` is empty. */
  titleLanguageCode: z.string().nullable().optional(),
  /** True only when `title` is in the requested source language. */
  localizationComplete: z.boolean().optional(),
  description: z.string().nullable(),
  scene: z.string().nullable(),
  region: z.string().nullable(),
  coverArt: VisualRefSchema.nullable(),
  mapArt: VisualRefSchema.nullable(),
  missions: z.array(ManifestMissionSchema),
});
export type ManifestChapter = z.infer<typeof ManifestChapterSchema>;

export const ManifestCharacterSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  role: z.string(),
  varietyId: VarietyIdSchema,
  portrait: VisualRefSchema.nullable(),
  /** Whether the character's voice is synthetic (must be reflected in UI, §8.6). */
  syntheticVoice: z.boolean(),
});
export type ManifestCharacter = z.infer<typeof ManifestCharacterSchema>;

/** Non-personal, edge-cacheable course manifest keyed by (track, source, version). */
export const CourseManifestSchema = z.object({
  formatVersion: z.literal(MANIFEST_FORMAT_VERSION),
  courseTrackId: CourseTrackIdSchema,
  sourceLanguageCode: SourceLanguageCodeSchema,
  targetVarietyId: VarietyIdSchema,
  /** Monotonic content version; bump invalidates caches (`manifest.invalidated`). */
  version: NonNegativeIntSchema,
  /** SHA-256 of the canonical JSON body (excluding this field). */
  checksum: Sha256Schema,
  generatedAt: TimestamptzSchema,
  coverArt: VisualRefSchema.nullable(),
  chapters: z.array(ManifestChapterSchema),
  characters: z.array(ManifestCharacterSchema),
  /** Suggested cache TTL in seconds. */
  cacheTtlSeconds: NonNegativeIntSchema,
});
export type CourseManifest = z.infer<typeof CourseManifestSchema>;

export const AudioManifestLessonSchema = z.object({
  id: UuidSchema,
  order: NonNegativeIntSchema,
  title: z.string(),
  description: z.string().nullable(),
  durationMs: MillisSchema.nullable(),
  level: LearnerLevelSchema.nullable(),
  speakerNames: z.array(z.string()),
  assets: z.array(AssetRefSchema),
  transcriptAvailable: z.boolean(),
  transcriptLanguages: z.array(z.string()),
  offlineEligible: z.boolean(),
});
export type AudioManifestLesson = z.infer<typeof AudioManifestLessonSchema>;

export const AudioManifestChapterSchema = z.object({
  id: UuidSchema,
  order: NonNegativeIntSchema,
  title: z.string(),
  summary: z.string().nullable(),
  coverArt: VisualRefSchema.nullable(),
  lessons: z.array(AudioManifestLessonSchema),
});
export type AudioManifestChapter = z.infer<typeof AudioManifestChapterSchema>;

export const AudioCollectionManifestSchema = z.object({
  formatVersion: z.literal(MANIFEST_FORMAT_VERSION),
  collectionId: UuidSchema,
  title: z.string(),
  targetVarietyId: VarietyIdSchema.nullable(),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
  version: NonNegativeIntSchema,
  checksum: Sha256Schema,
  generatedAt: TimestamptzSchema,
  coverArt: VisualRefSchema.nullable(),
  attributionText: z.string().nullable(),
  chapters: z.array(AudioManifestChapterSchema),
});
export type AudioCollectionManifest = z.infer<typeof AudioCollectionManifestSchema>;

/** One file inside a download pack; the URL is short-lived and must be refreshed if expired. */
export const DownloadPackFileSchema = z.object({
  assetId: UuidSchema,
  kind: AssetKindSchema,
  /** Relative path inside the local pack directory. */
  path: z.string().min(1),
  contentHash: Sha256Schema,
  byteLength: BytesSchema,
  mimeType: z.string(),
  url: UrlSchema,
  urlExpiresAt: TimestamptzSchema,
});
export type DownloadPackFile = z.infer<typeof DownloadPackFileSchema>;

export const DownloadPackManifestSchema = z.object({
  formatVersion: z.literal(MANIFEST_FORMAT_VERSION),
  packId: UuidSchema,
  lessonId: UuidSchema,
  collectionId: UuidSchema,
  version: NonNegativeIntSchema,
  checksum: Sha256Schema,
  generatedAt: TimestamptzSchema,
  totalBytes: BytesSchema,
  files: z.array(DownloadPackFileSchema).min(1),
  includesTranscript: z.boolean(),
  /** Rights state at generation time; a revoked lesson must be purged on next sync. */
  distributionAllowed: z.boolean(),
  attributionText: z.string().nullable(),
});
export type DownloadPackManifest = z.infer<typeof DownloadPackManifestSchema>;
