/**
 * Typed offline cache on top of the document store (§4.5): the learner's
 * profile + enrollments, course manifests, mission details (lesson packs),
 * due-review queues and progress snapshots. Readers get the cached copy
 * immediately; network fetches refresh it. Nothing here fabricates data —
 * a missing cache entry is `null` and screens show honest offline states.
 */
import type { ConversationEndRequest, CourseManifest, MissionDetailResponse, ProgressResponse, ReviewsDueResponse, StepResult } from '@langquest/contracts';
import type { CoursesResponse } from '@/lib/api/endpoints';
import type { MeProfile } from '@/lib/api/me-schema';
import type { DocumentStore } from './document-store';

export const COLLECTIONS = {
  me: 'me',
  manifests: 'manifests',
  missions: 'missions',
  reviews: 'reviews',
  progress: 'progress',
  courses: 'courses',
  localProgress: 'local_progress',
  pendingConversationEnds: 'pending_conversation_ends',
  meta: 'meta',
} as const;

export interface CachedEnvelope<T> {
  fetchedAt: string;
  data: T;
}

/** Per-mission local completion state so Missions/Home work offline. */
export interface LocalMissionProgress {
  missionId: string;
  enrollmentId: string;
  status: 'in_progress' | 'completed';
  stepIndex: number;
  attemptId: string | null;
  clientAttemptId: string;
  startedAt: string;
  /** Frozen once per attempt so an evaluate retry is byte-identical (idempotency fingerprint, §4.6). */
  completedAt: string | null;
  /** True when the completion is recorded locally but the evaluate call has not succeeded yet. */
  pendingEvaluation: boolean;
  /** Step results captured at completion so a pending evaluation can be re-sent after a restart. */
  stepResults?: StepResult[];
  /** Server revision the attempt was created against (needed to re-create the attempt). */
  missionRevision?: number;
}

/** A `POST /conversations/:id/end` that could not be delivered (offline); replayed by the services layer. */
export interface PendingConversationEnd {
  sessionId: string;
  enrollmentId: string;
  body: ConversationEndRequest;
  queuedAt: string;
  attempts: number;
}

export function createCache(store: DocumentStore, now: () => string = () => new Date().toISOString()) {
  const wrap = <T>(data: T): CachedEnvelope<T> => ({ fetchedAt: now(), data });
  const manifestKey = (trackId: string, source: string): string => `${trackId}:${source}`;
  const missionKey = (missionId: string, source: string): string => `${missionId}:${source}`;
  return {
    getMe: () => store.get<CachedEnvelope<MeProfile>>(COLLECTIONS.me, 'me'),
    putMe: (me: MeProfile) => store.put(COLLECTIONS.me, 'me', wrap(me)),
    getManifest: (trackId: string, source: string) => store.get<CachedEnvelope<CourseManifest>>(COLLECTIONS.manifests, manifestKey(trackId, source)),
    putManifest: (m: CourseManifest) => store.put(COLLECTIONS.manifests, manifestKey(m.courseTrackId, m.sourceLanguageCode), wrap(m)),
    getMission: (missionId: string, source: string) => store.get<CachedEnvelope<MissionDetailResponse>>(COLLECTIONS.missions, missionKey(missionId, source)),
    putMission: (m: MissionDetailResponse) => store.put(COLLECTIONS.missions, missionKey(m.id, m.sourceLanguageCode), wrap(m)),
    getReviews: (enrollmentId: string) => store.get<CachedEnvelope<ReviewsDueResponse>>(COLLECTIONS.reviews, enrollmentId),
    putReviews: (r: ReviewsDueResponse) => store.put(COLLECTIONS.reviews, r.enrollmentId, wrap(r)),
    getProgress: () => store.get<CachedEnvelope<ProgressResponse>>(COLLECTIONS.progress, 'me'),
    putProgress: (p: ProgressResponse) => store.put(COLLECTIONS.progress, 'me', wrap(p)),
    getCourses: (source: string | null) => store.get<CachedEnvelope<CoursesResponse>>(COLLECTIONS.courses, source ?? 'all'),
    putCourses: (source: string | null, c: CoursesResponse) => store.put(COLLECTIONS.courses, source ?? 'all', wrap(c)),
    getLocalMission: (enrollmentId: string, missionId: string) => store.get<LocalMissionProgress>(COLLECTIONS.localProgress, `${enrollmentId}:${missionId}`),
    putLocalMission: (p: LocalMissionProgress) => store.put(COLLECTIONS.localProgress, `${p.enrollmentId}:${p.missionId}`, p, Date.parse(p.startedAt)),
    listLocalMissions: async (enrollmentId: string) => (await store.list<LocalMissionProgress>(COLLECTIONS.localProgress)).map((d) => d.doc).filter((p) => p.enrollmentId === enrollmentId),
    /** Finished missions whose evaluate call has not succeeded yet (any enrollment). */
    listPendingEvaluations: async () => (await store.list<LocalMissionProgress>(COLLECTIONS.localProgress)).map((d) => d.doc).filter((p) => p.status === 'completed' && p.pendingEvaluation),
    putPendingConversationEnd: (p: PendingConversationEnd) => store.put(COLLECTIONS.pendingConversationEnds, p.sessionId, p, Date.parse(p.queuedAt)),
    listPendingConversationEnds: async () => (await store.list<PendingConversationEnd>(COLLECTIONS.pendingConversationEnds, { order: 'asc' })).map((d) => d.doc),
    removePendingConversationEnd: (sessionId: string) => store.remove(COLLECTIONS.pendingConversationEnds, sessionId),
    getMeta: <T>(key: string) => store.get<T>(COLLECTIONS.meta, key),
    putMeta: <T>(key: string, value: T) => store.put(COLLECTIONS.meta, key, value),
    /** Forget every cached manifest/mission for one enrollment's old source language (§2.1 cache invalidation). */
    invalidateSource: async (trackId: string, source: string) => {
      await store.remove(COLLECTIONS.manifests, manifestKey(trackId, source));
      const missions = await store.list<CachedEnvelope<MissionDetailResponse>>(COLLECTIONS.missions);
      for (const m of missions) if (m.doc.data.sourceLanguageCode === source) await store.remove(COLLECTIONS.missions, m.id);
    },
    /**
     * Forget everything cached for ONE enrollment after the learner deleted it server-side (§15): its due-review
     * queue and local mission progress. Manifests/missions are keyed by track+source and may serve another
     * enrollment, so they stay; the profile/progress snapshots are refreshed by the next fetch.
     */
    forgetEnrollment: async (enrollmentId: string) => {
      await store.remove(COLLECTIONS.reviews, enrollmentId);
      const local = await store.list<LocalMissionProgress>(COLLECTIONS.localProgress);
      for (const p of local) if (p.doc.enrollmentId === enrollmentId) await store.remove(COLLECTIONS.localProgress, p.id);
    },
    reset: () => store.reset(),
  };
}
export type LocalCache = ReturnType<typeof createCache>;
