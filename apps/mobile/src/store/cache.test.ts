import { describe, expect, it } from 'vitest';
import { COLLECTIONS, createCache, type LocalMissionProgress } from './cache';
import { MemoryDocumentStore } from './document-store';

const local = (enrollmentId: string, missionId: string): LocalMissionProgress => ({
  missionId,
  enrollmentId,
  status: 'in_progress',
  stepIndex: 0,
  attemptId: null,
  clientAttemptId: `${enrollmentId}-${missionId}`,
  startedAt: '2026-10-19T10:00:00.000Z',
  completedAt: null,
  pendingEvaluation: false,
});

describe('createCache.forgetEnrollment', () => {
  it('drops only the deleted enrollment’s review queue and local mission progress', async () => {
    const store = new MemoryDocumentStore();
    const cache = createCache(store, () => '2026-10-19T10:00:00.000Z');
    await cache.putReviews({ enrollmentId: 'gone', dueCount: 0, items: [], generatedAt: '2026-10-19T10:00:00.000Z' });
    await cache.putReviews({ enrollmentId: 'kept', dueCount: 0, items: [], generatedAt: '2026-10-19T10:00:00.000Z' });
    await cache.putLocalMission(local('gone', 'm1'));
    await cache.putLocalMission(local('gone', 'm2'));
    await cache.putLocalMission(local('kept', 'm1'));

    await cache.forgetEnrollment('gone');

    expect(await cache.getReviews('gone')).toBeNull();
    expect(await cache.getReviews('kept')).not.toBeNull();
    expect(await cache.listLocalMissions('gone')).toEqual([]);
    expect((await cache.listLocalMissions('kept')).map((p) => p.missionId)).toEqual(['m1']);
    expect(await store.count(COLLECTIONS.localProgress)).toBe(1);
  });

  it('is a no-op for an enrollment with nothing cached', async () => {
    const store = new MemoryDocumentStore();
    const cache = createCache(store);
    await cache.putLocalMission(local('kept', 'm1'));
    await expect(cache.forgetEnrollment('unknown')).resolves.toBeUndefined();
    expect(await store.count(COLLECTIONS.localProgress)).toBe(1);
  });
});
