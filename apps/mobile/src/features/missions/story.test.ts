import type { CourseManifest } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { buildPathway, sceneForMission } from './story';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const manifest: CourseManifest = {
  formatVersion: 1,
  courseTrackId: 'spanish-spain',
  sourceLanguageCode: 'en',
  targetVarietyId: 'es-ES',
  version: 1,
  checksum: 'a'.repeat(64),
  generatedAt: '2026-10-14T00:00:00.000Z',
  coverArt: null,
  chapters: [
    {
      id: uuid(1),
      order: 1,
      title: 'Arrival',
      description: null,
      scene: 'cafe',
      region: null,
      coverArt: null,
      mapArt: null,
      missions: [
        { id: uuid(11), order: 2, type: 'situational', titleKey: null, title: 'Ask for directions', level: 'beginner', difficulty: 0.2, recommendedMinutes: 8, prerequisiteSkillKeys: [], skillKeys: ['ask_directions'], characterIds: [], sceneArt: null, publishedRevision: 1, steps: [], localizationComplete: true },
        { id: uuid(10), order: 1, type: 'standard', titleKey: null, title: 'Order a coffee', level: 'beginner', difficulty: 0.1, recommendedMinutes: 7.4, prerequisiteSkillKeys: [], skillKeys: ['request_item'], characterIds: [], sceneArt: null, publishedRevision: 1, steps: [], localizationComplete: true },
      ],
    },
  ],
  characters: [],
  cacheTtlSeconds: 300,
};

describe('buildPathway', () => {
  it('orders missions by chapter/order, derives status from local progress and recommends the next one', () => {
    const p = buildPathway(manifest, [{ missionId: uuid(10), enrollmentId: uuid(9), status: 'completed', stepIndex: 5, attemptId: null, clientAttemptId: uuid(99), startedAt: '2026-10-14T00:00:00.000Z', completedAt: '2026-10-14T00:10:00.000Z', pendingEvaluation: false }], null, false);
    expect(p.missions.map((m) => m.mission.title)).toEqual(['Order a coffee', 'Ask for directions']);
    expect(p.missions.map((m) => m.status)).toEqual(['completed', 'available']);
    expect(p.next?.mission.id).toBe(uuid(11));
    expect(p.nodes[0]?.next).toEqual([uuid(11)]);
    expect(p.completedCount).toBe(1);
    expect(p.missions[0]?.minutes).toBe(7);
  });

  it('never locks missions and marks the active one in progress', () => {
    const p = buildPathway(manifest, [], uuid(11), true);
    expect(p.missions.every((m) => m.status !== 'locked')).toBe(true);
    expect(p.next?.mission.id).toBe(uuid(11));
    expect(p.missions[1]?.status).toBe('in_progress');
  });

  it('picks a scene from the chapter or the mission title', () => {
    const m = manifest.chapters[0]!.missions[0]!;
    expect(sceneForMission(m, 'market')).toBe('market');
    expect(sceneForMission(m, null)).toBe('street');
    expect(sceneForMission({ ...m, title: 'Something else', skillKeys: [] }, null)).toBeUndefined();
  });
});
