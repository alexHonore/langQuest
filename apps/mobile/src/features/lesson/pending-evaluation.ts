/**
 * Resume mission evaluations that never reached the server (§4.6 "retry short
 * operations safely"). `finish()` in the lesson player stores the completed
 * attempt locally with a FROZEN `completedAt` and its step results; this pass
 * re-sends the byte-identical evaluate request (same `clientEventId` →
 * idempotent replay) for every local mission still flagged `pendingEvaluation`.
 */
import type { MissionEvaluateRequest, MissionEvaluateResponse } from '@langquest/contracts';
import type { LocalCache, LocalMissionProgress } from '@/store/cache';

export interface PendingEvaluationApi {
  missionAttemptCreate: (id: string, body: { enrollmentId: string; clientAttemptId: string; missionRevision: number; startedAt: string }) => Promise<{ attemptId: string }>;
  missionEvaluate: (id: string, body: MissionEvaluateRequest) => Promise<MissionEvaluateResponse>;
}

/** Build the evaluate request for a stored completion; null when the record predates step-result storage. */
export function evaluateRequestFor(p: LocalMissionProgress, attemptId: string): MissionEvaluateRequest | null {
  if (!p.stepResults || !p.completedAt) return null;
  return { attemptId, enrollmentId: p.enrollmentId, completedAt: p.completedAt, stepResults: p.stepResults, clientEventId: p.clientAttemptId };
}

export interface ResumeResult {
  sent: string[];
  /** Records that cannot be replayed (no stored step results); cleared so they stop lingering. */
  dropped: string[];
  /** Still pending after this pass (connectivity or server failure). */
  remaining: string[];
}

/** Re-send every pending evaluation; stops at the first connectivity failure. */
export async function resumePendingEvaluations(api: PendingEvaluationApi, cache: Pick<LocalCache, 'listPendingEvaluations' | 'putLocalMission'>, isConnectivityError: (error: unknown) => boolean): Promise<ResumeResult> {
  const result: ResumeResult = { sent: [], dropped: [], remaining: [] };
  const pending = await cache.listPendingEvaluations();
  for (const p of pending) {
    if (!p.stepResults || !p.completedAt || p.missionRevision === undefined) {
      await cache.putLocalMission({ ...p, pendingEvaluation: false });
      result.dropped.push(p.missionId);
      continue;
    }
    try {
      let attemptId = p.attemptId;
      if (!attemptId) {
        attemptId = (await api.missionAttemptCreate(p.missionId, { enrollmentId: p.enrollmentId, clientAttemptId: p.clientAttemptId, missionRevision: p.missionRevision, startedAt: p.startedAt })).attemptId;
      }
      const body = evaluateRequestFor(p, attemptId);
      if (!body) {
        result.dropped.push(p.missionId);
        continue;
      }
      await api.missionEvaluate(p.missionId, body);
      await cache.putLocalMission({ ...p, attemptId, pendingEvaluation: false });
      result.sent.push(p.missionId);
    } catch (error) {
      result.remaining.push(p.missionId);
      if (isConnectivityError(error)) break;
    }
  }
  return result;
}
