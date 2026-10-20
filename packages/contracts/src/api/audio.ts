/** §6.3 — audio library endpoints. */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from '../catalog';
import { AudioAssetTypeSchema, LearnerLevelSchema, TranscriptStatusSchema } from '../enums';
import { AssetRefSchema, AudioCollectionManifestSchema, DownloadPackManifestSchema, VisualRefSchema } from '../manifest';
import { BytesSchema, MillisSchema, NonNegativeIntSchema, TimestamptzSchema, UnitIntervalSchema, UrlSchema, UuidSchema } from '../primitives';
import { pageOf, PaginationQuerySchema, QueryBooleanSchema } from './common';

export const AudioCollectionsQuerySchema = z
  .object({
    language: VarietyIdSchema.optional(),
    trackId: CourseTrackIdSchema.optional(),
    instructionLanguage: SourceLanguageCodeSchema.optional(),
    q: z.string().max(100).optional(),
  })
  .extend(PaginationQuerySchema.shape);
export type AudioCollectionsQuery = z.infer<typeof AudioCollectionsQuerySchema>;

export const AudioCollectionSummarySchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  courseTrackId: CourseTrackIdSchema.nullable(),
  targetVarietyId: VarietyIdSchema.nullable(),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
  region: z.string().nullable(),
  instructorName: z.string().nullable(),
  coverArt: VisualRefSchema.nullable(),
  chapterCount: NonNegativeIntSchema,
  lessonCount: NonNegativeIntSchema,
  totalDurationMs: MillisSchema.nullable(),
  attributionText: z.string().nullable(),
  offlineEligible: z.boolean(),
  version: NonNegativeIntSchema,
});
export const AudioCollectionsResponseSchema = pageOf(AudioCollectionSummarySchema);

export const AudioChaptersResponseSchema = z.object({ manifest: AudioCollectionManifestSchema });

export const AudioLessonResponseSchema = z.object({
  id: UuidSchema,
  collectionId: UuidSchema,
  chapterId: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  order: NonNegativeIntSchema,
  level: LearnerLevelSchema.nullable(),
  targetVarietyId: VarietyIdSchema.nullable(),
  instructionLanguageCode: SourceLanguageCodeSchema.nullable(),
  spokenLanguageCodes: z.array(z.string()),
  speakers: z.array(z.object({ id: UuidSchema, displayName: z.string(), role: z.string(), synthetic: z.boolean() })),
  tags: z.array(z.string()),
  durationMs: MillisSchema.nullable(),
  assets: z.array(z.object({ ref: AssetRefSchema, type: AudioAssetTypeSchema })),
  coverArt: VisualRefSchema.nullable(),
  transcriptStatus: TranscriptStatusSchema,
  transcriptLanguages: z.array(z.string()),
  attributionText: z.string().nullable(),
  offlineEligible: z.boolean(),
  progress: z.object({ positionMs: MillisSchema, completed: z.boolean(), revision: NonNegativeIntSchema }).nullable(),
  bookmarks: z.array(z.object({ id: UuidSchema, positionMs: MillisSchema, note: z.string().nullable() })),
  /** Linked missions generated from this chapter (audio-course-linked lessons, §3.2). */
  linkedMissionIds: z.array(UuidSchema),
});
export type AudioLessonResponse = z.infer<typeof AudioLessonResponseSchema>;

export const PlaybackUrlRequestSchema = z.object({
  /** Optional preferred rendition; the server picks the best allowed one. */
  preferredType: AudioAssetTypeSchema.optional(),
  /** Set when renewing mid-playback so the server can log expiry handling (§14.1 A22). */
  renewal: z.boolean().default(false),
});
export const PlaybackUrlResponseSchema = z.object({
  assetId: UuidSchema,
  url: UrlSchema,
  expiresAt: TimestamptzSchema,
  method: z.enum(['signed_get', 'worker_proxy']),
  contentType: z.string(),
  byteLength: BytesSchema,
  etag: z.string().nullable(),
  supportsRange: z.literal(true),
  contentHash: z.string(),
});
export type PlaybackUrlResponse = z.infer<typeof PlaybackUrlResponseSchema>;

export const TranscriptQuerySchema = z.object({
  /** Translation language to include (source language of the enrollment, typically). */
  language: SourceLanguageCodeSchema.optional(),
  enrollmentId: UuidSchema.optional(),
});
export const TranscriptSegmentDtoSchema = z.object({
  id: UuidSchema,
  index: NonNegativeIntSchema,
  startMs: MillisSchema,
  endMs: MillisSchema,
  text: z.string(),
  transliteration: z.string().nullable(),
  speakerLabel: z.string().nullable(),
  languageCode: z.string().nullable(),
  confidence: UnitIntervalSchema.nullable(),
  translation: z.object({ languageCode: SourceLanguageCodeSchema, text: z.string(), qaState: z.string() }).nullable(),
  words: z.array(z.object({ word: z.string(), startMs: MillisSchema, endMs: MillisSchema, expressionId: UuidSchema.nullable() })),
  /** Expression ids learners can save/practise from this segment. */
  linkedExpressionIds: z.array(UuidSchema),
});
export const TranscriptResponseSchema = z.object({
  lessonId: UuidSchema,
  transcriptId: UuidSchema,
  revision: NonNegativeIntSchema,
  status: TranscriptStatusSchema,
  primaryLanguageCode: z.string(),
  languageMode: z.enum(['source', 'target', 'mixed']),
  reviewed: z.boolean(),
  coveragePct: z.number().min(0).max(100),
  segments: z.array(TranscriptSegmentDtoSchema),
  /** Requested translation language that is not available (honest signal). */
  translationUnavailableFor: SourceLanguageCodeSchema.nullable(),
});
export type TranscriptResponse = z.infer<typeof TranscriptResponseSchema>;

export const AudioProgressPutRequestSchema = z.object({
  clientEventId: UuidSchema,
  deviceId: z.string().min(1).max(128),
  revision: NonNegativeIntSchema,
  positionMs: MillisSchema,
  durationMs: MillisSchema.nullable(),
  completed: z.boolean(),
  occurredAt: TimestamptzSchema,
  /** Client wall-clock at send time; lets the server correct `occurredAt` for clock skew (migration 110). */
  clientSentAt: TimestamptzSchema.optional(),
});
export const AudioProgressPutResponseSchema = z.object({
  lessonId: UuidSchema,
  positionMs: MillisSchema,
  completed: z.boolean(),
  revision: NonNegativeIntSchema,
  resolution: z.enum(['applied', 'duplicate', 'superseded']),
  /** Machine-readable reason from `apply_audio_progress` (`older_revision`, `older_event`, `same_client_event`); optional for older servers. */
  reason: z.string().nullable().optional(),
});

export const AudioBookmarkCreateRequestSchema = z.object({
  clientEventId: UuidSchema,
  lessonId: UuidSchema,
  positionMs: MillisSchema,
  note: z.string().max(500).nullable().default(null),
  segmentId: UuidSchema.nullable().default(null),
});
export const AudioBookmarkResponseSchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  positionMs: MillisSchema,
  note: z.string().nullable(),
  segmentId: UuidSchema.nullable(),
  createdAt: TimestamptzSchema,
  replayed: z.boolean(),
});

/** `includeTranscript` is a strict query flag (`QueryBooleanSchema`): `?includeTranscript=false` leaves the transcript out. */
export const DownloadPackQuerySchema = z.object({ includeTranscript: QueryBooleanSchema.default(true), deviceId: z.string().min(1).max(128) });
export const DownloadPackResponseSchema = z.object({ manifest: DownloadPackManifestSchema });

/**
 * Query for `GET /v1/media/stream/:assetId` (`ROUTES.mediaStream`): `t` is the short-lived HMAC token minted by
 * `audioPlaybackUrl` for exactly this asset and learner. The route has no JWT; an invalid, expired or mismatched
 * token answers `unauthorized` and the client must request a fresh playback URL.
 */
export const MediaStreamQuerySchema = z.object({ t: z.string().min(1) });
export type MediaStreamQuery = z.infer<typeof MediaStreamQuerySchema>;

// --- inferred types (additive; every request/response schema has a matching type) ---

export type AudioCollectionSummary = z.infer<typeof AudioCollectionSummarySchema>;
export type AudioCollectionsResponse = z.infer<typeof AudioCollectionsResponseSchema>;
export type AudioChaptersResponse = z.infer<typeof AudioChaptersResponseSchema>;
export type PlaybackUrlRequest = z.infer<typeof PlaybackUrlRequestSchema>;
export type TranscriptQuery = z.infer<typeof TranscriptQuerySchema>;
export type TranscriptSegmentDto = z.infer<typeof TranscriptSegmentDtoSchema>;
export type AudioProgressPutRequest = z.infer<typeof AudioProgressPutRequestSchema>;
export type AudioProgressPutResponse = z.infer<typeof AudioProgressPutResponseSchema>;
export type AudioBookmarkCreateRequest = z.infer<typeof AudioBookmarkCreateRequestSchema>;
export type AudioBookmarkResponse = z.infer<typeof AudioBookmarkResponseSchema>;
export type DownloadPackQuery = z.infer<typeof DownloadPackQuerySchema>;
export type DownloadPackResponse = z.infer<typeof DownloadPackResponseSchema>;
