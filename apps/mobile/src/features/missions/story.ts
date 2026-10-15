/**
 * Mission pathway derived from a course manifest plus local completion state
 * (§10.2B screen 3). Nothing is locked behind payment or artificial gates:
 * every published mission is reachable; the pathway only recommends the
 * next one (§3.8 "learner can still reach all free content").
 */
import type { CourseManifest, ManifestMission, MissionType } from '@langquest/contracts';
import type { MissionFocus, SceneId, StoryMapNode } from '@langquest/ui';
import type { LocalMissionProgress } from '@/store/cache';

export interface PathwayMission {
  mission: ManifestMission;
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
  status: StoryMapNode['status'];
  sceneId: SceneId | undefined;
  focus: MissionFocus;
  minutes: number;
}

export interface Pathway {
  missions: PathwayMission[];
  nodes: StoryMapNode[];
  /** Recommended next mission (first in-progress, else first not completed). */
  next: PathwayMission | null;
  completedCount: number;
}

const SCENE_BY_HINT: readonly [RegExp, SceneId][] = [
  [/caf[eé]|coffee|breakfast/i, 'cafe'],
  [/market|price|shop|cloth/i, 'market'],
  [/direction|street|lost/i, 'street'],
  [/airport|flight/i, 'airport'],
  [/train|ticket|station/i, 'station'],
  [/taxi|bus|transit|metro/i, 'transit'],
  [/restaurant|meal|dinner|lunch/i, 'restaurant'],
  [/work|office|job|colleague/i, 'office'],
  [/home|family|neighbou?r/i, 'home'],
  [/friend|party|gathering|plan|weekend/i, 'gathering'],
  [/park|walk|day/i, 'park'],
  [/doctor|clinic|emergency|help/i, 'clinic'],
];

export function sceneForMission(mission: ManifestMission, chapterScene: string | null): SceneId | undefined {
  const known = ['cafe', 'street', 'airport', 'market', 'home', 'office', 'transit', 'restaurant', 'gathering', 'station', 'park', 'clinic'] as const;
  if (chapterScene && (known as readonly string[]).includes(chapterScene)) return chapterScene as SceneId;
  const text = `${mission.title} ${mission.titleKey ?? ''} ${mission.skillKeys.join(' ')}`;
  for (const [re, scene] of SCENE_BY_HINT) if (re.test(text)) return scene;
  return undefined;
}

export function focusForMission(type: MissionType, tonal: boolean): MissionFocus {
  switch (type) {
    case 'pronunciation':
      return tonal ? 'tone' : 'pronunciation';
    case 'audio_linked':
      return 'listening';
    default:
      return 'conversation';
  }
}

export function buildPathway(manifest: CourseManifest, local: readonly LocalMissionProgress[], activeMissionId: string | null, tonal: boolean): Pathway {
  const byId = new Map(local.map((p) => [p.missionId, p] as const));
  const chapters = [...manifest.chapters].sort((a, b) => a.order - b.order);
  const missions: PathwayMission[] = [];
  for (const chapter of chapters) {
    for (const mission of [...chapter.missions].sort((a, b) => a.order - b.order)) {
      const progress = byId.get(mission.id);
      const status: StoryMapNode['status'] = progress?.status === 'completed' ? 'completed' : progress?.status === 'in_progress' || mission.id === activeMissionId ? 'in_progress' : 'available';
      missions.push({
        mission,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: chapter.order,
        status,
        sceneId: sceneForMission(mission, chapter.scene),
        focus: focusForMission(mission.type, tonal),
        minutes: Math.max(1, Math.round(mission.recommendedMinutes)),
      });
    }
  }
  const nodes: StoryMapNode[] = missions.map((m, i) => ({
    id: m.mission.id,
    title: m.mission.title,
    chapterId: m.chapterId,
    chapterTitle: m.chapterTitle,
    status: m.status,
    next: missions[i + 1] ? [missions[i + 1]!.mission.id] : [],
    sceneId: m.sceneId,
    minutes: m.minutes,
  }));
  const next = missions.find((m) => m.status === 'in_progress') ?? missions.find((m) => m.status !== 'completed') ?? null;
  return { missions, nodes, next, completedCount: missions.filter((m) => m.status === 'completed').length };
}
