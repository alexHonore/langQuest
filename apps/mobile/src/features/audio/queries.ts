/**
 * Data hooks for the audio library: react-query over the §6.3 routes with the
 * local document store as the offline fallback (collections, manifests,
 * lesson detail, transcripts). Every result says whether it came from cache so
 * screens can label it instead of pretending it is live.
 */
import type { AudioCollectionManifest, AudioLessonResponse, EnrollmentDto, TranscriptResponse } from '@langquest/contracts';
import { getCourseTrack } from '@langquest/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiClientError } from '@/lib/api/client';
import { useServices } from '@/lib/services';
import type { CachedEnvelope } from '@/store/cache';
import { getLocalStore } from '@/store';
import { getAudioEndpoints } from './api';
import type { AudioCollectionsResponse } from './library-search';

export const AUDIO_CACHE = {
  collections: 'audio_collections',
  manifests: 'audio_manifests',
  lessons: 'audio_lessons',
  transcripts: 'audio_transcripts',
} as const;

export interface AudioCachedResult<T> {
  data: T;
  fromCache: boolean;
  fetchedAt: string | null;
}

interface Input<T> {
  key: readonly unknown[];
  enabled?: boolean;
  fetch: () => Promise<T>;
  collection: string;
  id: string;
  staleTime?: number;
}

function useAudioCachedQuery<T>(input: Input<T>): UseQueryResult<AudioCachedResult<T>, Error> {
  const { online } = useServices();
  const read = async (): Promise<CachedEnvelope<T> | null> => (await getLocalStore()).store.get<CachedEnvelope<T>>(input.collection, input.id);
  const write = async (data: T): Promise<void> => (await getLocalStore()).store.put(input.collection, input.id, { fetchedAt: new Date().toISOString(), data } satisfies CachedEnvelope<T>);
  return useQuery<AudioCachedResult<T>, Error>({
    queryKey: input.key,
    enabled: input.enabled ?? true,
    networkMode: 'always',
    staleTime: input.staleTime ?? 60_000,
    retry: false,
    queryFn: async () => {
      if (online) {
        try {
          const data = await input.fetch();
          await write(data).catch(() => undefined);
          return { data, fromCache: false, fetchedAt: new Date().toISOString() };
        } catch (error) {
          const connectivity = error instanceof ApiClientError && (error.isConnectivity || error.kind === 'not_configured');
          if (!connectivity) throw error;
          const cached = await read();
          if (cached) return { data: cached.data, fromCache: true, fetchedAt: cached.fetchedAt };
          throw error;
        }
      }
      const cached = await read();
      if (cached) return { data: cached.data, fromCache: true, fetchedAt: cached.fetchedAt };
      throw new ApiClientError('audioCollections', 'network', 'Offline and nothing cached yet');
    },
  });
}

export interface CollectionsScope {
  /** Target variety of the active course (null = every language). */
  targetVarietyId: string | null;
  courseTrackId: string | null;
  instructionLanguageCode: string | null;
}

/** Scope derived from the active enrollment: its target variety + its own instruction language (§2.1). */
export function useCollectionsScope(enrollment: EnrollmentDto | null, allLanguages: boolean): CollectionsScope {
  return useMemo(() => {
    if (!enrollment || allLanguages) return { targetVarietyId: null, courseTrackId: null, instructionLanguageCode: enrollment?.sourceLanguageCode ?? null };
    const track = getCourseTrack(enrollment.courseTrackId);
    return { targetVarietyId: track.targetVarietyId, courseTrackId: enrollment.courseTrackId, instructionLanguageCode: enrollment.sourceLanguageCode };
  }, [enrollment, allLanguages]);
}

export function useAudioCollections(scope: CollectionsScope): UseQueryResult<AudioCachedResult<AudioCollectionsResponse>, Error> {
  const id = `${scope.targetVarietyId ?? '*'}:${scope.instructionLanguageCode ?? '*'}`;
  return useAudioCachedQuery<AudioCollectionsResponse>({
    key: ['audio', 'collections', id],
    collection: AUDIO_CACHE.collections,
    id,
    staleTime: 5 * 60_000,
    fetch: async () => {
      const api = getAudioEndpoints();
      // The API filters by variety OR track; ask by variety (shared Mandarin assets etc. come back too) and
      // let the instruction language narrow server-side. Collections without an instruction language are kept.
      const page = await api.collections({ language: (scope.targetVarietyId as never) ?? undefined, instructionLanguage: (scope.instructionLanguageCode as never) ?? undefined, limit: 100 });
      if (scope.instructionLanguageCode) {
        // Second pass: collections that are language-agnostic for instruction (null) are not returned by the
        // server-side equality filter; fetch them too so honest coverage shows everything available.
        const general = await api.collections({ language: (scope.targetVarietyId as never) ?? undefined, limit: 100 }).catch(() => null);
        if (general) {
          const seen = new Set(page.items.map((c) => c.id));
          for (const c of general.items) if (!seen.has(c.id) && c.instructionLanguageCode === null) page.items.push(c);
        }
      }
      return page;
    },
  });
}

export function useCollectionManifest(collectionId: string | null): UseQueryResult<AudioCachedResult<AudioCollectionManifest>, Error> {
  return useAudioCachedQuery<AudioCollectionManifest>({
    key: ['audio', 'manifest', collectionId],
    enabled: Boolean(collectionId),
    collection: AUDIO_CACHE.manifests,
    id: collectionId ?? '',
    staleTime: 5 * 60_000,
    fetch: async () => (await getAudioEndpoints().chapters(collectionId!)).manifest,
  });
}

export function useAudioLesson(lessonId: string | null): UseQueryResult<AudioCachedResult<AudioLessonResponse>, Error> {
  return useAudioCachedQuery<AudioLessonResponse>({
    key: ['audio', 'lesson', lessonId],
    enabled: Boolean(lessonId),
    collection: AUDIO_CACHE.lessons,
    id: lessonId ?? '',
    fetch: () => getAudioEndpoints().lesson(lessonId!),
  });
}

/** Transcript with translations in the enrollment's instruction language (never silently another, §2.1). */
export function useTranscript(lessonId: string | null, language: string | null, enrollmentId: string | null, enabled: boolean): UseQueryResult<AudioCachedResult<TranscriptResponse>, Error> {
  const id = `${lessonId ?? ''}:${language ?? '*'}`;
  return useAudioCachedQuery<TranscriptResponse>({
    key: ['audio', 'transcript', lessonId, language],
    enabled: enabled && Boolean(lessonId),
    collection: AUDIO_CACHE.transcripts,
    id,
    staleTime: 10 * 60_000,
    fetch: () => getAudioEndpoints().transcript(lessonId!, { language: language ?? undefined, enrollmentId: enrollmentId ?? undefined }),
  });
}

/** Read a cached manifest without a query (used when building queues from a lesson screen). */
export async function readCachedManifest(collectionId: string): Promise<AudioCollectionManifest | null> {
  const store = (await getLocalStore()).store;
  return (await store.get<CachedEnvelope<AudioCollectionManifest>>(AUDIO_CACHE.manifests, collectionId))?.data ?? null;
}
