import type { MissionEvaluateRequest } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '@/store/document-store';
import { createCache, type LocalMissionProgress } from '@/store/cache';
import { evaluateRequestFor, resumePendingEvaluations } from './pending-evaluation';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const completion = (over: Partial<LocalMissionProgress> = {}): LocalMissionProgress => ({
  missionId: uuid(1),
  enrollmentId: uuid(2),
  status: 'completed',
  stepIndex: 1,
  attemptId: null,
  clientAttemptId: uuid(3),
  startedAt: '2026-10-19T10:00:00.000Z',
  completedAt: '2026-10-19T10:08:00.000Z',
  pendingEvaluation: true,
  missionRevision: 4,
  stepResults: [{ stepId: uuid(9), outcome: 'success', hintsUsed: 0, replays: 1, durationMs: 4000, speechAssessmentIds: [], attemptedBeforeReveal: true, selectedIntentId: null, conversationSessionId: null }],
  ...over,
});

describe('pending mission evaluations', () => {
  it('replays a byte-identical request: frozen completedAt and the attempt id as clientEventId', () => {
    const p = completion();
    const a = evaluateRequestFor(p, uuid(7));
    const b = evaluateRequestFor(p, uuid(7));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a?.completedAt).toBe('2026-10-19T10:08:00.000Z');
    expect(a?.clientEventId).toBe(uuid(3));
  });

  it('creates the attempt when needed, evaluates, and clears the pending flag', async () => {
    const cache = createCache(new MemoryDocumentStore());
    await cache.putLocalMission(completion());
    const api = { missionAttemptCreate: vi.fn(async () => ({ attemptId: uuid(7) })), missionEvaluate: vi.fn(async (_id: string, _body: MissionEvaluateRequest) => ({}) as never) };
    const res = await resumePendingEvaluations(api, cache, () => false);
    expect(res.sent).toEqual([uuid(1)]);
    expect(api.missionEvaluate.mock.calls[0]?.[1]).toMatchObject({ attemptId: uuid(7), clientEventId: uuid(3) });
    expect(await cache.listPendingEvaluations()).toEqual([]);
    expect((await cache.getLocalMission(uuid(2), uuid(1)))?.attemptId).toBe(uuid(7));
  });

  it('keeps the record pending on connectivity failure and stops the pass', async () => {
    const cache = createCache(new MemoryDocumentStore());
    await cache.putLocalMission(completion({ attemptId: uuid(7) }));
    await cache.putLocalMission(completion({ missionId: uuid(11), attemptId: uuid(8), clientAttemptId: uuid(12) }));
    const api = { missionAttemptCreate: vi.fn(), missionEvaluate: vi.fn(async () => { throw new Error('offline'); }) };
    const res = await resumePendingEvaluations(api, cache, () => true);
    expect(res.remaining).toHaveLength(1);
    expect(api.missionEvaluate).toHaveBeenCalledTimes(1);
    expect(await cache.listPendingEvaluations()).toHaveLength(2);
  });

  it('drops legacy records without stored step results instead of pretending they were sent', async () => {
    const cache = createCache(new MemoryDocumentStore());
    await cache.putLocalMission(completion({ stepResults: undefined, missionRevision: undefined }));
    const api = { missionAttemptCreate: vi.fn(), missionEvaluate: vi.fn() };
    const res = await resumePendingEvaluations(api, cache, () => false);
    expect(res.dropped).toEqual([uuid(1)]);
    expect(api.missionEvaluate).not.toHaveBeenCalled();
  });
});
