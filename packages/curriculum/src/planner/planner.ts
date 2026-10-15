/**
 * Next-mission planner (§3.5, Phase 4): interleaves due reviews, weak-skill practice,
 * new content and learner pace into a deterministic session plan.
 */
import {
  LEARNER_LEVEL_VALUES,
  masteryRank,
  type LearnerLevel,
  type LearningSpeed,
  type MasteryState,
  type MissionType,
  type ReviewCard,
  type SkillMasterySnapshot,
} from '@langquest/contracts';
import { chooseReviewScenario, reviewBudget, selectDueCards, type DueCard, type Scheduler } from '../scheduler/scheduler';
import { Seeded } from './random';

export interface PlannerMission {
  missionId: string;
  blueprintKey: string;
  type: MissionType;
  level: LearnerLevel;
  skillKeys: readonly string[];
  prerequisiteSkillKeys: readonly string[];
  sortOrder: number;
  estimatedMinutes: number;
  completed: boolean;
  completedWithoutHints?: boolean;
  lastCompletedAt?: string | null;
}

export interface PlannerParams {
  /** Max share of the session reviews may take (crowding guard). */
  maxReviewShare: number;
  /** Minutes a single review takes, for budgeting. */
  minutesPerReview: number;
  /** Skills at/below this internal score (and not yet independent) are "weak". */
  weakSkillScoreThreshold: number;
  /** New missions per session by pace. */
  newMissionsByPace: Record<LearningSpeed, number>;
  /** Session minutes by pace when the caller gives none. */
  sessionMinutesByPace: Record<LearningSpeed, number>;
  /** Minimum mastery of each prerequisite skill to unlock a mission. */
  prerequisiteMinState: MasteryState;
  /** Missions may be at most this many levels above the learner level. */
  maxLevelsAbove: number;
}

export const DEFAULT_PLANNER_PARAMS: PlannerParams = {
  maxReviewShare: 0.4,
  minutesPerReview: 2,
  weakSkillScoreThreshold: 0.5,
  newMissionsByPace: { relaxed: 1, regular: 2, intensive: 3 },
  sessionMinutesByPace: { relaxed: 8, regular: 15, intensive: 25 },
  prerequisiteMinState: 'practiced',
  maxLevelsAbove: 1,
};

export type PlanItem =
  | { kind: 'review'; cardId: string; targetKind: ReviewCard['targetKind']; targetId: string; scenarioId: string | null; retrievability: number; estimatedMinutes: number; reason: string }
  | { kind: 'weak_skill_mission'; missionId: string; blueprintKey: string; skillKeys: string[]; estimatedMinutes: number; reason: string }
  | { kind: 'new_mission'; missionId: string; blueprintKey: string; estimatedMinutes: number; reason: string };

export interface SessionPlan {
  enrollmentId: string;
  generatedAt: string;
  items: PlanItem[];
  totalMinutes: number;
  /** Share of planned minutes spent on reviews (always <= maxReviewShare unless nothing else is available). */
  reviewShare: number;
  /** Mission the Home screen should feature first (null when everything is done or locked). */
  nextMissionId: string | null;
  dueCount: number;
  lockedMissionIds: string[];
  notes: string[];
}

export interface PlannerInput {
  now: string;
  enrollmentId: string;
  scheduler: Scheduler;
  cards: readonly ReviewCard[];
  masteries: readonly Pick<SkillMasterySnapshot, 'skillKey' | 'masteryState' | 'internalScore' | 'evidenceCount'>[];
  missions: readonly PlannerMission[];
  pace: LearningSpeed;
  learnerLevel: LearnerLevel;
  sessionMinutes?: number;
  /** Scenario ids available for varied reviews (e.g. blueprint keys). */
  scenarioPool?: readonly string[];
  /** Seed for tie-breaks; defaults to enrollment + date so plans are stable within a day. */
  seed?: string;
  params?: Partial<PlannerParams>;
}

export const learnerLevelRank = (level: LearnerLevel): number => LEARNER_LEVEL_VALUES.indexOf(level);

/** True when every prerequisite skill is at or above the required state. */
export function isMissionUnlocked(mission: Pick<PlannerMission, 'prerequisiteSkillKeys' | 'level'>, masteryBySkill: ReadonlyMap<string, MasteryState>, learnerLevel: LearnerLevel, params: Pick<PlannerParams, 'prerequisiteMinState' | 'maxLevelsAbove'> = DEFAULT_PLANNER_PARAMS): boolean {
  if (learnerLevelRank(mission.level) > learnerLevelRank(learnerLevel) + params.maxLevelsAbove) return false;
  const min = masteryRank(params.prerequisiteMinState);
  return mission.prerequisiteSkillKeys.every((k) => masteryRank(masteryBySkill.get(k) ?? 'not_attempted') >= min);
}

/** Skills that need targeted practice: attempted, below threshold and not yet independent. */
export function weakSkills(masteries: PlannerInput['masteries'], threshold = DEFAULT_PLANNER_PARAMS.weakSkillScoreThreshold): string[] {
  return masteries
    .filter((m) => m.evidenceCount > 0 && masteryRank(m.masteryState) < masteryRank('independent') && m.internalScore <= threshold)
    .sort((a, b) => a.internalScore - b.internalScore || a.skillKey.localeCompare(b.skillKey))
    .map((m) => m.skillKey);
}

/** Build a session plan. Pure and deterministic for identical input. */
export function planSession(input: PlannerInput): SessionPlan {
  const params: PlannerParams = { ...DEFAULT_PLANNER_PARAMS, ...input.params };
  const sessionMinutes = input.sessionMinutes ?? params.sessionMinutesByPace[input.pace];
  const rng = new Seeded(input.seed ?? `${input.enrollmentId}:${input.now.slice(0, 10)}`);
  const notes: string[] = [];
  const masteryBySkill = new Map(input.masteries.map((m) => [m.skillKey, m.masteryState] as const));

  // 1. Reviews under the crowding guard.
  const due = selectDueCards(input.scheduler, input.cards, { now: input.now, limit: Number.MAX_SAFE_INTEGER, interleaveKinds: true });
  const slots = Math.max(1, Math.floor(sessionMinutes / params.minutesPerReview));
  const allowed = reviewBudget({ sessionSlots: slots, dueCount: due.length, maxReviewShare: params.maxReviewShare, params: input.scheduler.params });
  const reviews: PlanItem[] = due.slice(0, allowed).map((d: DueCard) => ({
    kind: 'review',
    cardId: d.card.id,
    targetKind: d.card.targetKind,
    targetId: d.card.targetId,
    scenarioId: chooseReviewScenario(d.card, input.scenarioPool ?? [], `${d.card.id}:${input.now.slice(0, 10)}`),
    retrievability: Math.round(d.retrievability * 1000) / 1000,
    estimatedMinutes: params.minutesPerReview,
    reason: d.retrievability < input.scheduler.params.desiredRetention ? 'retention_below_target' : 'due',
  }));
  if (due.length > allowed) notes.push(`review_crowding_guard:${due.length - allowed}_deferred`);

  // 2. Availability.
  const unlocked = input.missions.filter((m) => isMissionUnlocked(m, masteryBySkill, input.learnerLevel, params));
  const lockedMissionIds = input.missions.filter((m) => !unlocked.includes(m)).map((m) => m.missionId);
  const byOrder = (a: PlannerMission, b: PlannerMission) => a.sortOrder - b.sortOrder || a.missionId.localeCompare(b.missionId);

  // 3. Weak-skill practice: prefer an uncompleted mission (new context) over a replay.
  const weak = weakSkills(input.masteries, params.weakSkillScoreThreshold);
  let weakItem: PlanItem | null = null;
  if (weak.length) {
    const candidates = unlocked.filter((m) => m.skillKeys.some((k) => weak.includes(k)));
    const fresh = candidates.filter((m) => !m.completed).sort(byOrder);
    const replays = candidates.filter((m) => m.completed).sort((a, b) => (a.lastCompletedAt ?? '').localeCompare(b.lastCompletedAt ?? '') || byOrder(a, b));
    const pick = fresh[0] ?? rng.pick(replays.slice(0, 3));
    if (pick) {
      weakItem = { kind: 'weak_skill_mission', missionId: pick.missionId, blueprintKey: pick.blueprintKey, skillKeys: pick.skillKeys.filter((k) => weak.includes(k)), estimatedMinutes: pick.estimatedMinutes, reason: `weak_skills:${weak.slice(0, 3).join(',')}` };
    }
  }

  // 4. New content by pace, within the remaining minutes.
  const reviewMinutes = reviews.reduce((a, r) => a + r.estimatedMinutes, 0);
  let remaining = sessionMinutes - reviewMinutes - (weakItem?.estimatedMinutes ?? 0);
  const newItems: PlanItem[] = [];
  const maxNew = params.newMissionsByPace[input.pace];
  for (const m of unlocked.filter((m) => !m.completed && m.missionId !== weakItem?.missionId).sort(byOrder)) {
    if (newItems.length >= maxNew) break;
    if (newItems.length > 0 && remaining < m.estimatedMinutes) break;
    newItems.push({ kind: 'new_mission', missionId: m.missionId, blueprintKey: m.blueprintKey, estimatedMinutes: m.estimatedMinutes, reason: 'next_in_story_order' });
    remaining -= m.estimatedMinutes;
  }
  if (newItems.length === 0 && unlocked.every((m) => m.completed)) notes.push('all_unlocked_missions_completed');
  if (newItems.length === 0 && lockedMissionIds.length && unlocked.filter((m) => !m.completed).length === 0) notes.push('next_missions_locked_by_prerequisites');

  // 5. Interleave: review, new, review, weak, review, new … (reviews spread out, never a wall).
  const items: PlanItem[] = [];
  const content: PlanItem[] = [...newItems];
  if (weakItem) content.splice(Math.min(1, content.length), 0, weakItem);
  const reviewQueue = [...reviews];
  const perGap = content.length ? Math.ceil(reviewQueue.length / (content.length + 1)) : reviewQueue.length;
  const pushReviews = (n: number) => {
    for (let i = 0; i < n && reviewQueue.length; i++) items.push(reviewQueue.shift()!);
  };
  pushReviews(perGap);
  for (const c of content) {
    items.push(c);
    pushReviews(perGap);
  }
  pushReviews(reviewQueue.length);

  const totalMinutes = items.reduce((a, i) => a + i.estimatedMinutes, 0);
  const plannedReviewMinutes = items.filter((i) => i.kind === 'review').reduce((a, i) => a + i.estimatedMinutes, 0);
  const firstMission = items.find((i) => i.kind !== 'review');
  return {
    enrollmentId: input.enrollmentId,
    generatedAt: input.now,
    items,
    totalMinutes,
    reviewShare: totalMinutes > 0 ? plannedReviewMinutes / totalMinutes : 0,
    nextMissionId: firstMission?.missionId ?? null,
    dueCount: due.length,
    lockedMissionIds,
    notes,
  };
}
