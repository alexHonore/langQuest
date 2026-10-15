/**
 * Typed wrappers for the §6.3 audio-library routes. The shared
 * `src/lib/api/endpoints.ts` only exposes `playbackUrl`, so the library builds
 * its own client over the same `createApiClient` (same auth, retries and
 * envelope validation). Cross-package gap noted in the build report.
 */
import {
  AudioBookmarkCreateRequestSchema,
  AudioBookmarkResponseSchema,
  AudioChaptersResponseSchema,
  AudioCollectionsResponseSchema,
  AudioLessonResponseSchema,
  AudioProgressPutResponseSchema,
  DownloadPackResponseSchema,
  PlaybackUrlResponseSchema,
  TranscriptResponseSchema,
  type AudioAssetType,
  type AudioCollectionsQuery,
} from '@langquest/contracts';
import { ENV } from '@/config/env';
import { ApiClientError, createApiClient, createUnconfiguredClient, type ApiClient } from '@/lib/api/client';
import { getAccessToken } from '@/lib/supabase';
import { track } from '@/lib/telemetry';
import type { AudioBookmarkCreateRequest } from './bookmarks';
import type { AudioProgressPutRequest } from './listening-progress';

export function createAudioEndpoints(client: ApiClient) {
  return {
    collections: (query: Partial<AudioCollectionsQuery>) =>
      client.call('audioCollections', { query: { language: query.language, trackId: query.trackId, instructionLanguage: query.instructionLanguage, q: query.q, cursor: query.cursor, limit: query.limit ?? 50 }, schema: AudioCollectionsResponseSchema }),
    chapters: (collectionId: string) => client.call('audioCollectionChapters', { params: { id: collectionId }, schema: AudioChaptersResponseSchema }),
    lesson: (lessonId: string) => client.call('audioLesson', { params: { id: lessonId }, schema: AudioLessonResponseSchema }),
    playbackUrl: (assetId: string, options: { preferredType?: AudioAssetType; renewal: boolean }) =>
      client.call('audioPlaybackUrl', { params: { id: assetId }, body: { preferredType: options.preferredType, renewal: options.renewal }, schema: PlaybackUrlResponseSchema, maxRetries: 1 }),
    transcript: (lessonId: string, query: { language?: string; enrollmentId?: string }) =>
      client.call('audioLessonTranscript', { params: { id: lessonId }, query: { language: query.language, enrollmentId: query.enrollmentId }, schema: TranscriptResponseSchema }),
    putProgress: (lessonId: string, body: AudioProgressPutRequest) => client.call('audioProgressPut', { params: { lessonId }, body, idempotencyKey: body.clientEventId, schema: AudioProgressPutResponseSchema }),
    createBookmark: (body: AudioBookmarkCreateRequest) =>
      client.call('audioBookmarkCreate', { body: AudioBookmarkCreateRequestSchema.parse(body), idempotencyKey: body.clientEventId, schema: AudioBookmarkResponseSchema }),
    downloadPack: (lessonId: string, deviceId: string) => client.call('audioDownloadPack', { params: { lessonId }, query: { includeTranscript: true, deviceId }, schema: DownloadPackResponseSchema, timeoutMs: 30_000 }),
  };
}
export type AudioEndpoints = ReturnType<typeof createAudioEndpoints>;

let endpoints: AudioEndpoints | null = null;

/** Process-wide audio endpoints (same wiring as `ServicesProvider`). */
export function getAudioEndpoints(): AudioEndpoints {
  if (!endpoints) {
    const client = ENV.apiBaseUrl
      ? createApiClient({
          baseUrl: ENV.apiBaseUrl,
          getAccessToken,
          onError: (info) => {
            if (info.status !== null && info.code !== 'network' && info.code !== 'timeout' && info.code !== 'invalid_response') track.apiError(info.route, info.code, info.status, info.traceId);
          },
        })
      : createUnconfiguredClient();
    endpoints = createAudioEndpoints(client);
  }
  return endpoints;
}

export const isConnectivityError = (error: unknown): boolean => error instanceof ApiClientError && (error.isConnectivity || error.kind === 'not_configured');

/** Server-side reasons media cannot be served; the UI explains instead of showing a broken player. */
export type MediaUnavailableReason = 'not_configured' | 'storage_not_enabled' | 'rights_blocked' | 'not_found' | 'offline' | 'unknown';

export function mediaUnavailableReason(error: unknown): MediaUnavailableReason {
  if (!(error instanceof ApiClientError)) return 'unknown';
  switch (error.kind) {
    case 'not_configured':
      return 'not_configured';
    case 'capability_unsupported':
      return 'storage_not_enabled';
    case 'rights_blocked':
      return 'rights_blocked';
    case 'not_found':
      return 'not_found';
    case 'network':
    case 'timeout':
      return 'offline';
    default:
      return 'unknown';
  }
}
