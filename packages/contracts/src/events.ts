/**
 * Domain events (§6.4). At-least-once delivery; every event carries an
 * `idempotencyKey` so handlers can dedupe replays.
 */
import { z } from 'zod';
import { CourseTrackIdSchema, SourceLanguageCodeSchema, VarietyIdSchema } from './catalog';
import { ContentStateSchema, MasteryStateSchema, ObservationTypeSchema, type ProcessingJobType } from './enums';
import { BytesSchema, KeySchema, MillisSchema, NonNegativeIntSchema, Sha256Schema, TimestamptzSchema, UuidSchema } from './primitives';

export const DOMAIN_EVENT_TYPES = [
  'upload.finalized',
  'asset.verified',
  'transcode.requested',
  'transcript.ready',
  'translation.review_requested',
  'lesson.published',
  'manifest.invalidated',
  'conversation.finished',
  'skill.observed',
  'review.due',
] as const;
export const DomainEventTypeSchema = z.enum(DOMAIN_EVENT_TYPES);
export type DomainEventType = z.infer<typeof DomainEventTypeSchema>;

export const EVENT_SCHEMA_VERSION = 1 as const;

const envelope = {
  eventId: UuidSchema,
  /** Stable key for dedupe (e.g. `upload.finalized:<uploadId>`); unique per logical occurrence. */
  idempotencyKey: z.string().min(1).max(256),
  occurredAt: TimestamptzSchema,
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  producer: z.enum(['api', 'jobs', 'admin', 'db']),
  traceId: z.string().nullable(),
};

export const UploadFinalizedEventSchema = z.object({
  ...envelope,
  type: z.literal('upload.finalized'),
  payload: z.object({ uploadId: UuidSchema, assetId: UuidSchema, storageKey: z.string(), checksumSha256: Sha256Schema, byteLength: BytesSchema, mimeType: z.string(), uploaderId: UuidSchema }),
});
export const AssetVerifiedEventSchema = z.object({
  ...envelope,
  type: z.literal('asset.verified'),
  payload: z.object({ assetId: UuidSchema, durationMs: MillisSchema.nullable(), mimeType: z.string(), checksumSha256: Sha256Schema, duplicateOfAssetId: UuidSchema.nullable(), state: ContentStateSchema }),
});
export const TranscodeRequestedEventSchema = z.object({
  ...envelope,
  type: z.literal('transcode.requested'),
  payload: z.object({ assetId: UuidSchema, jobId: UuidSchema, targetFormats: z.array(z.enum(['aac', 'opus'])), priority: z.number().int().min(0).max(10) }),
});
export const TranscriptReadyEventSchema = z.object({
  ...envelope,
  type: z.literal('transcript.ready'),
  payload: z.object({ lessonId: UuidSchema, transcriptId: UuidSchema, revision: NonNegativeIntSchema, segmentCount: NonNegativeIntSchema, primaryLanguageCode: z.string(), wordAligned: z.boolean(), provider: z.string().nullable() }),
});
export const TranslationReviewRequestedEventSchema = z.object({
  ...envelope,
  type: z.literal('translation.review_requested'),
  payload: z.object({ entityTable: z.string(), entityId: UuidSchema, sourceLanguageCode: SourceLanguageCodeSchema, targetVarietyId: VarietyIdSchema, requestedBy: UuidSchema.nullable(), reviewerId: UuidSchema.nullable() }),
});
export const LessonPublishedEventSchema = z.object({
  ...envelope,
  type: z.literal('lesson.published'),
  payload: z.object({ entityTable: z.enum(['audio_lessons', 'missions', 'lesson_courses', 'audio_course_collections']), entityId: UuidSchema, revision: NonNegativeIntSchema, courseTrackId: CourseTrackIdSchema.nullable(), publishedBy: UuidSchema, state: ContentStateSchema }),
});
export const ManifestInvalidatedEventSchema = z.object({
  ...envelope,
  type: z.literal('manifest.invalidated'),
  payload: z.object({
    kind: z.enum(['course', 'audio_collection']),
    courseTrackId: CourseTrackIdSchema.nullable(),
    collectionId: UuidSchema.nullable(),
    /** Null = every source language. */
    sourceLanguageCode: SourceLanguageCodeSchema.nullable(),
    newVersion: NonNegativeIntSchema,
    reason: z.enum(['published', 'unpublished', 'rights_revoked', 'localization_updated', 'asset_replaced']),
  }),
});
export const ConversationFinishedEventSchema = z.object({
  ...envelope,
  type: z.literal('conversation.finished'),
  payload: z.object({ sessionId: UuidSchema, userId: UuidSchema, enrollmentId: UuidSchema, missionId: UuidSchema.nullable(), turnCount: NonNegativeIntSchema, durationMs: MillisSchema, objectivesCompleted: z.array(z.string()), evaluationPending: z.boolean() }),
});
export const SkillObservedEventSchema = z.object({
  ...envelope,
  type: z.literal('skill.observed'),
  payload: z.object({ observationId: UuidSchema, userId: UuidSchema, enrollmentId: UuidSchema, skillKey: KeySchema, observationType: ObservationTypeSchema, masteryBefore: MasteryStateSchema.nullable(), masteryAfter: MasteryStateSchema.nullable() }),
});
export const ReviewDueEventSchema = z.object({
  ...envelope,
  type: z.literal('review.due'),
  payload: z.object({ userId: UuidSchema, enrollmentId: UuidSchema, cardIds: z.array(UuidSchema).min(1), dueAt: TimestamptzSchema, notify: z.boolean() }),
});

export const DomainEventSchema = z.discriminatedUnion('type', [
  UploadFinalizedEventSchema,
  AssetVerifiedEventSchema,
  TranscodeRequestedEventSchema,
  TranscriptReadyEventSchema,
  TranslationReviewRequestedEventSchema,
  LessonPublishedEventSchema,
  ManifestInvalidatedEventSchema,
  ConversationFinishedEventSchema,
  SkillObservedEventSchema,
  ReviewDueEventSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
export type DomainEventPayload<T extends DomainEventType> = DomainEventOf<T>['payload'];

/** Build a well-formed event; the caller supplies ids/time so tests stay deterministic. */
export function createDomainEvent<T extends DomainEventType>(
  type: T,
  payload: DomainEventPayload<T>,
  meta: { eventId: string; idempotencyKey: string; occurredAt: string; producer: DomainEvent['producer']; traceId?: string | null },
): DomainEventOf<T> {
  return DomainEventSchema.parse({
    eventId: meta.eventId,
    idempotencyKey: meta.idempotencyKey,
    occurredAt: meta.occurredAt,
    schemaVersion: EVENT_SCHEMA_VERSION,
    producer: meta.producer,
    traceId: meta.traceId ?? null,
    type,
    payload,
  }) as DomainEventOf<T>;
}

/** Optional job-type hint per event for queue routing (jobs app). */
export const EVENT_JOB_HINTS: Readonly<Partial<Record<DomainEventType, ProcessingJobType>>> = {
  'upload.finalized': 'verify',
  'asset.verified': 'extract_metadata',
  'transcode.requested': 'transcode',
};
