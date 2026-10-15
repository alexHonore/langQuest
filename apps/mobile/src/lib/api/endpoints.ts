/**
 * Thin, typed wrappers over every learner route the app uses (spec §6.1–6.3).
 * Request bodies are typed by the contract input types; responses are validated
 * by the contract Zod schemas so screens only ever see well-formed data.
 */
import {
  ConversationEndRequestSchema,
  ConversationEndResponseSchema,
  ConversationSessionCreateRequestSchema,
  ConversationSessionCreateResponseSchema,
  ConversationTurnRequestSchema,
  ConversationTurnResponseSchema,
  CoursesResponseSchema,
  CoverageResponseSchema,
  EnrollmentCreateResponseSchema,
  EnrollmentPatchResponseSchema,
  EnrollmentsListResponseSchema,
  LanguagesResponseSchema,
  ManifestResponseSchema,
  MissionAttemptCreateResponseSchema,
  MissionDetailResponseSchema,
  MissionEvaluateResponseSchema,
  ModelCapabilitiesResponseSchema,
  PatchSettingsResponseSchema,
  PlaybackUrlRequestSchema,
  PlaybackUrlResponseSchema,
  ProgressResponseSchema,
  ProgressSyncResponseSchema,
  PronunciationAssessResponseSchema,
  ReviewsDueResponseSchema,
  SkillsResponseSchema,
  SynthesizeResponseSchema,
  TranscribeResponseSchema,
  type ConversationSessionCreateRequest,
  type ConversationTurnRequest,
  type EnrollmentCreateRequest,
  type EnrollmentPatchRequest,
  type MissionEvaluateRequest,
  type PatchSettingsRequest,
  type ProgressSyncRequest,
  type PronunciationAssessRequest,
  type SynthesizeRequest,
  type TranscribeRequest,
} from '@langquest/contracts';
import { z } from 'zod';
import type { ApiClient } from './client';
import { MeResponseSchemaLenient } from './me-schema';

export type ConversationEndRequest = z.infer<typeof ConversationEndRequestSchema>;
export type PlaybackUrlRequest = z.infer<typeof PlaybackUrlRequestSchema>;
export type CoursesResponse = z.infer<typeof CoursesResponseSchema>;
type MissionAttemptCreateRequest = { enrollmentId: string; clientAttemptId: string; missionRevision: number; startedAt: string };

export function createEndpoints(client: ApiClient) {
  return {
    me: () => client.call('me', { schema: MeResponseSchemaLenient }),
    patchSettings: (body: PatchSettingsRequest) => client.call('meSettingsPatch', { body, schema: PatchSettingsResponseSchema }),
    languages: () => client.call('languages', { schema: LanguagesResponseSchema }),
    courses: (query?: { source?: string }) => client.call('courses', { query, schema: CoursesResponseSchema }),
    courseCoverage: (trackId: string, source?: string) => client.call('courseCoverage', { params: { trackId }, query: { source }, schema: CoverageResponseSchema }),
    enrollmentsList: () => client.call('enrollmentsList', { schema: EnrollmentsListResponseSchema }),
    enrollmentCreate: (body: EnrollmentCreateRequest, idempotencyKey: string) =>
      client.call('enrollmentsCreate', { body, idempotencyKey, schema: EnrollmentCreateResponseSchema }),
    enrollmentPatch: (id: string, body: EnrollmentPatchRequest) => client.call('enrollmentPatch', { params: { id }, body, schema: EnrollmentPatchResponseSchema }),
    courseManifest: (trackId: string, source: string) => client.call('courseManifest', { params: { trackId }, query: { source }, schema: ManifestResponseSchema }),
    missionDetail: (id: string, source: string, enrollmentId?: string) =>
      client.call('missionDetail', { params: { id }, query: { source, enrollmentId }, schema: MissionDetailResponseSchema }),
    missionAttemptCreate: (id: string, body: MissionAttemptCreateRequest) =>
      client.call('missionAttemptCreate', { params: { id }, body, idempotencyKey: body.clientAttemptId, schema: MissionAttemptCreateResponseSchema }),
    missionEvaluate: (id: string, body: MissionEvaluateRequest) =>
      client.call('missionEvaluate', { params: { id }, body, idempotencyKey: body.clientEventId, schema: MissionEvaluateResponseSchema, timeoutMs: 60_000 }),
    reviewsDue: (enrollmentId: string, limit = 12) => client.call('reviewsDue', { query: { enrollmentId, limit }, schema: ReviewsDueResponseSchema }),
    progressSync: (body: ProgressSyncRequest) => client.call('progressSync', { body, idempotencyKey: body.events[0]?.clientEventId, schema: ProgressSyncResponseSchema }),
    skills: (enrollmentId: string, cursor?: string) => client.call('meSkills', { query: { enrollmentId, cursor, limit: 100 }, schema: SkillsResponseSchema }),
    progress: () => client.call('meProgress', { schema: ProgressResponseSchema }),
    conversationSessionCreate: (body: ConversationSessionCreateRequest) =>
      client.call('conversationSessionCreate', {
        body: ConversationSessionCreateRequestSchema.parse(body),
        idempotencyKey: body.clientSessionId,
        schema: ConversationSessionCreateResponseSchema,
        timeoutMs: 45_000,
      }),
    conversationTurn: (id: string, body: ConversationTurnRequest, signal?: AbortSignal) =>
      client.call('conversationTurn', {
        params: { id },
        body: ConversationTurnRequestSchema.parse(body),
        idempotencyKey: body.clientTurnId,
        schema: ConversationTurnResponseSchema,
        timeoutMs: 45_000,
        signal,
        maxRetries: 1,
      }),
    conversationEnd: (id: string, body: ConversationEndRequest) =>
      client.call('conversationEnd', { params: { id }, body: ConversationEndRequestSchema.parse(body), idempotencyKey: body.clientEventId, schema: ConversationEndResponseSchema, timeoutMs: 60_000 }),
    transcribe: (body: TranscribeRequest) => client.call('speechTranscribe', { body, idempotencyKey: body.clientRequestId, schema: TranscribeResponseSchema, timeoutMs: 45_000, maxRetries: 1 }),
    pronunciationAssess: (body: PronunciationAssessRequest) =>
      client.call('speechPronunciationAssess', { body, idempotencyKey: body.clientRequestId, schema: PronunciationAssessResponseSchema, timeoutMs: 45_000, maxRetries: 1 }),
    synthesize: (body: SynthesizeRequest) => client.call('speechSynthesize', { body, schema: SynthesizeResponseSchema, timeoutMs: 45_000 }),
    modelCapabilities: (trackId: string, regionalOption?: string) =>
      client.call('modelCapabilities', { query: { trackId, regionalOption }, schema: ModelCapabilitiesResponseSchema }),
    playbackUrl: (assetId: string, body: PlaybackUrlRequest) => client.call('audioPlaybackUrl', { params: { id: assetId }, body, schema: PlaybackUrlResponseSchema }),
  };
}
export type Endpoints = ReturnType<typeof createEndpoints>;

/** Minimal schema used by callers that only need to know a call succeeded. */
export const EmptySchema = z.object({}).passthrough();
