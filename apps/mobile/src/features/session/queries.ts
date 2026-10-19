/**
 * Data hooks for learner screens: react-query on top of the typed API with
 * the offline cache as a fallback (§4.5). Every hook returns `fromCache` so a
 * screen can say "last updated …" instead of pretending data is live.
 */
import type { CourseManifest, EnrollmentDto, LanguageContext, MissionDetailResponse, ModelCapabilitiesResponse, ProgressResponse, ReviewsDueResponse } from '@langquest/contracts';
import { buildLanguageContext } from '@langquest/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { ApiClientError } from '@/lib/api/client';
import type { CoursesResponse } from '@/lib/api/endpoints';
import type { MeProfile } from '@/lib/api/me-schema';
import { useI18n } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { bindTelemetryEnrollment } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';
import type { CachedEnvelope } from '@/store/cache';
import { getLocalStore } from '@/store';

export interface CachedResult<T> {
  data: T;
  fromCache: boolean;
  fetchedAt: string | null;
}

interface CachedQueryInput<T> {
  key: readonly unknown[];
  enabled?: boolean;
  fetch: () => Promise<T>;
  read: () => Promise<CachedEnvelope<T> | null>;
  write: (data: T) => Promise<void>;
  staleTime?: number;
}

/** Network first; on connectivity failure serve the cached copy (flagged); otherwise rethrow. */
function useCachedQuery<T>(input: CachedQueryInput<T>): UseQueryResult<CachedResult<T>, Error> {
  const { online } = useServices();
  return useQuery<CachedResult<T>, Error>({
    queryKey: input.key,
    enabled: input.enabled ?? true,
    networkMode: 'always',
    staleTime: input.staleTime ?? 30_000,
    retry: false,
    queryFn: async () => {
      if (online) {
        try {
          const data = await input.fetch();
          await input.write(data).catch(() => undefined);
          return { data, fromCache: false, fetchedAt: new Date().toISOString() };
        } catch (error) {
          const connectivity = error instanceof ApiClientError && (error.isConnectivity || error.kind === 'not_configured');
          if (!connectivity) throw error;
          const cached = await input.read();
          if (cached) return { data: cached.data, fromCache: true, fetchedAt: cached.fetchedAt };
          throw error;
        }
      }
      const cached = await input.read();
      if (cached) return { data: cached.data, fromCache: true, fetchedAt: cached.fetchedAt };
      throw new ApiClientError('me', 'network', 'Offline and nothing cached yet');
    },
  });
}

export function useMe(enabled = true): UseQueryResult<CachedResult<MeProfile>, Error> {
  const { api } = useServices();
  const applyServerSettings = usePrefs((s) => s.applyServerSettings);
  const query = useCachedQuery<MeProfile>({
    key: ['me'],
    enabled,
    fetch: () => api.me(),
    read: async () => (await getLocalStore()).cache.getMe(),
    write: async (me) => (await getLocalStore()).cache.putMe(me),
  });
  const me = query.data?.data;
  useEffect(() => {
    if (me && !query.data?.fromCache) applyServerSettings(me.accessibilityOptions, me.uiLocale);
  }, [me, query.data?.fromCache, applyServerSettings]);
  return query;
}

/** The enrollment the learner is working in (from prefs, else the first active one). */
export function useActiveEnrollment(): { enrollment: EnrollmentDto | null; enrollments: EnrollmentDto[]; setActive: (id: string) => void; me: MeProfile | null; query: UseQueryResult<CachedResult<MeProfile>, Error> } {
  const query = useMe();
  const activeId = usePrefs((s) => s.activeEnrollmentId);
  const set = usePrefs((s) => s.set);
  const me = query.data?.data ?? null;
  const enrollments = useMemo(() => (me?.enrollments ?? []).filter((e) => e.status !== 'archived'), [me]);
  const enrollment = useMemo(() => enrollments.find((e) => e.id === activeId) ?? enrollments.find((e) => e.status === 'active') ?? enrollments[0] ?? null, [enrollments, activeId]);
  useEffect(() => {
    if (enrollment && enrollment.id !== activeId) set({ activeEnrollmentId: enrollment.id });
  }, [enrollment, activeId, set]);
  const setActive = useCallback((id: string) => set({ activeEnrollmentId: id }), [set]);
  return { enrollment, enrollments, setActive, me, query };
}

/** `LanguageContext` for an enrollment (CONVENTIONS §2.3); null when none is active. */
export function useLanguageContext(enrollment: EnrollmentDto | null): LanguageContext | null {
  const { locale } = useI18n();
  const ctx = useMemo(() => {
    if (!enrollment) return null;
    try {
      return buildLanguageContext({
        uiLocale: locale,
        enrollmentId: enrollment.id,
        sourceLanguageCode: enrollment.sourceLanguageCode,
        courseTrackId: enrollment.courseTrackId,
        scriptMode: enrollment.scriptMode,
        regionalPreference: enrollment.regionalPreference,
        learnerLevel: enrollment.learnerLevel,
      });
    } catch {
      return null;
    }
  }, [enrollment, locale]);
  useEffect(() => bindTelemetryEnrollment(ctx), [ctx]);
  return ctx;
}

export function useManifest(enrollment: EnrollmentDto | null): UseQueryResult<CachedResult<CourseManifest>, Error> {
  const { api } = useServices();
  return useCachedQuery<CourseManifest>({
    key: ['manifest', enrollment?.courseTrackId, enrollment?.sourceLanguageCode],
    enabled: Boolean(enrollment),
    staleTime: 5 * 60_000,
    fetch: () => api.courseManifest(enrollment!.courseTrackId, enrollment!.sourceLanguageCode),
    read: async () => (await getLocalStore()).cache.getManifest(enrollment!.courseTrackId, enrollment!.sourceLanguageCode),
    write: async (m) => (await getLocalStore()).cache.putManifest(m),
  });
}

export function useMissionDetail(missionId: string | null, enrollment: EnrollmentDto | null): UseQueryResult<CachedResult<MissionDetailResponse>, Error> {
  const { api } = useServices();
  return useCachedQuery<MissionDetailResponse>({
    key: ['mission', missionId, enrollment?.sourceLanguageCode, enrollment?.id],
    enabled: Boolean(missionId && enrollment),
    staleTime: 5 * 60_000,
    fetch: () => api.missionDetail(missionId!, enrollment!.sourceLanguageCode, enrollment!.id),
    read: async () => (await getLocalStore()).cache.getMission(missionId!, enrollment!.sourceLanguageCode),
    write: async (m) => (await getLocalStore()).cache.putMission(m),
  });
}

export function useReviewsDue(enrollment: EnrollmentDto | null, limit = 12): UseQueryResult<CachedResult<ReviewsDueResponse>, Error> {
  const { api } = useServices();
  return useCachedQuery<ReviewsDueResponse>({
    key: ['reviews', enrollment?.id, limit],
    enabled: Boolean(enrollment),
    fetch: () => api.reviewsDue(enrollment!.id, limit),
    read: async () => (await getLocalStore()).cache.getReviews(enrollment!.id),
    write: async (r) => (await getLocalStore()).cache.putReviews(r),
  });
}

export function useProgress(enabled = true): UseQueryResult<CachedResult<ProgressResponse>, Error> {
  const { api } = useServices();
  return useCachedQuery<ProgressResponse>({
    key: ['progress'],
    enabled,
    fetch: () => api.progress(),
    read: async () => (await getLocalStore()).cache.getProgress(),
    write: async (p) => (await getLocalStore()).cache.putProgress(p),
  });
}

export function useCourses(source: string | null): UseQueryResult<CachedResult<CoursesResponse>, Error> {
  const { api } = useServices();
  return useCachedQuery<CoursesResponse>({
    key: ['courses', source],
    staleTime: 10 * 60_000,
    fetch: () => api.courses(source ? { source } : undefined),
    read: async () => (await getLocalStore()).cache.getCourses(source),
    write: async (c) => (await getLocalStore()).cache.putCourses(source, c),
  });
}

/**
 * Live capability answer for the active track (`/v1/ai/model-capabilities`). The static catalog's
 * `automatedScoringSupport` is never used as a fallback: capability claims come from the registry
 * (CONVENTIONS §5, ADR-006). The last server answer is cached per track for offline reuse; when
 * there is none, `data` is undefined and screens must say so rather than assume.
 */
export function useCapabilities(enrollment: EnrollmentDto | null): UseQueryResult<CachedResult<ModelCapabilitiesResponse>, Error> {
  const { api } = useServices();
  const key = enrollment ? `capabilities:${enrollment.courseTrackId}:${enrollment.regionalPreference ?? ''}` : 'capabilities:none';
  return useCachedQuery<ModelCapabilitiesResponse>({
    key: ['capabilities', enrollment?.courseTrackId, enrollment?.regionalPreference],
    enabled: Boolean(enrollment),
    staleTime: 10 * 60_000,
    fetch: () => api.modelCapabilities(enrollment!.courseTrackId, enrollment!.regionalPreference ?? undefined),
    read: async () => (await getLocalStore()).cache.getMeta<CachedEnvelope<ModelCapabilitiesResponse>>(key),
    write: async (c) => (await getLocalStore()).cache.putMeta<CachedEnvelope<ModelCapabilitiesResponse>>(key, { fetchedAt: new Date().toISOString(), data: c }),
  });
}

/** Invalidate learner data after a mutation (enrollment change, mission finished…). */
export function useInvalidateLearner(): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['progress'] }), qc.invalidateQueries({ queryKey: ['reviews'] }), qc.invalidateQueries({ queryKey: ['manifest'] })]);
  }, [qc]);
}
