import { buildLanguageContext, type ReviewCard } from '@langquest/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARABIC_MOROCCAN_CHAPTER_1 } from '../content/arabic-moroccan';
import { seedExpressionsToCandidates } from '../content/types';
import type { ExpressionCandidateInput } from '../missions/realise';
import { createScheduler, newCard } from '../scheduler/scheduler';
import { buildOfflinePack } from './offline-pack';
import { isMissionUnlocked, planSession, weakSkills, type PlannerMission } from './planner';
import { Seeded, fnv1a32 } from './random';

const ENROLLMENT = '00000000-0000-4000-8000-000000000001';
const T0 = '2026-10-10T09:00:00.000Z';
const scheduler = createScheduler({ fuzzFactor: 0 });

const mission = (id: string, over: Partial<PlannerMission> = {}): PlannerMission => ({
  missionId: id,
  blueprintKey: id,
  type: 'standard',
  level: 'beginner',
  skillKeys: ['greet_politely'],
  prerequisiteSkillKeys: [],
  sortOrder: Number(id.replace(/\D/g, '')) || 0,
  estimatedMinutes: 8,
  completed: false,
  ...over,
});

const dueCards = (n: number): ReviewCard[] =>
  Array.from({ length: n }, (_, i) => ({ ...newCard({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, enrollmentId: ENROLLMENT, targetKind: i % 2 ? 'skill' : 'expression', targetId: `t${i}`, now: T0 }), due: '2026-10-01T00:00:00.000Z' }));

describe('seeded randomness', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is reproducible and never touches Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    const a = new Seeded('abc');
    const b = new Seeded('abc');
    expect([a.next(), a.int(10), a.range(1, 2)]).toEqual([b.next(), b.int(10), b.range(1, 2)]);
    expect(new Seeded('x').shuffle([1, 2, 3, 4, 5])).toEqual(new Seeded('x').shuffle([1, 2, 3, 4, 5]));
    expect(new Seeded('x').sample([1, 2, 3, 4, 5], 2)).toHaveLength(2);
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
    expect(fnv1a32('hello')).not.toBe(fnv1a32('hellp'));
  });
});

describe('planSession', () => {
  it('interleaves reviews with new content and honours the crowding guard', () => {
    const plan = planSession({
      now: T0,
      enrollmentId: ENROLLMENT,
      scheduler,
      cards: dueCards(30),
      masteries: [],
      missions: [mission('m1'), mission('m2'), mission('m3')],
      pace: 'regular',
      learnerLevel: 'beginner',
      sessionMinutes: 25,
      scenarioPool: ['cafe', 'market'],
    });
    expect(plan.dueCount).toBe(30);
    expect(plan.reviewShare).toBeLessThanOrEqual(0.41);
    expect(plan.items.filter((i) => i.kind === 'new_mission').map((i) => i.kind === 'new_mission' && i.missionId)).toEqual(['m1', 'm2']);
    expect(plan.nextMissionId).toBe('m1');
    expect(plan.notes.some((n) => n.startsWith('review_crowding_guard'))).toBe(true);
    const kinds = plan.items.map((i) => i.kind);
    expect(kinds[0]).toBe('review');
    expect(kinds.lastIndexOf('review')).toBeGreaterThan(kinds.indexOf('new_mission'));
    expect(plan.items.filter((i) => i.kind === 'review').every((i) => i.kind === 'review' && ['cafe', 'market'].includes(i.scenarioId!))).toBe(true);
  });

  it('respects pace, prerequisites and level gating', () => {
    const missions = [mission('m1', { completed: true }), mission('m2'), mission('m3', { prerequisiteSkillKeys: ['request_item'] }), mission('m4', { level: 'advanced' }), mission('m5')];
    const relaxed = planSession({ now: T0, enrollmentId: ENROLLMENT, scheduler, cards: [], masteries: [], missions, pace: 'relaxed', learnerLevel: 'beginner' });
    expect(relaxed.items.map((i) => i.kind === 'new_mission' && i.missionId)).toEqual(['m2']);
    expect(relaxed.lockedMissionIds).toEqual(['m3', 'm4']);
    const intensive = planSession({ now: T0, enrollmentId: ENROLLMENT, scheduler, cards: [], masteries: [{ skillKey: 'request_item', masteryState: 'practiced', internalScore: 0.6, evidenceCount: 3 }], missions, pace: 'intensive', learnerLevel: 'beginner' });
    expect(intensive.items.map((i) => i.kind === 'new_mission' && i.missionId)).toEqual(['m2', 'm3', 'm5']);
    expect(isMissionUnlocked(missions[3]!, new Map(), 'upper_intermediate')).toBe(true);
  });

  it('inserts a weak-skill mission and prefers a fresh scenario for it', () => {
    const masteries = [
      { skillKey: 'ask_price', masteryState: 'emerging' as const, internalScore: 0.3, evidenceCount: 2 },
      { skillKey: 'greet_politely', masteryState: 'independent' as const, internalScore: 0.4, evidenceCount: 5 },
    ];
    expect(weakSkills(masteries)).toEqual(['ask_price']);
    const missions = [mission('m1', { completed: true, skillKeys: ['ask_price'] }), mission('m2'), mission('m3', { skillKeys: ['ask_price', 'negotiate_price'] })];
    const plan = planSession({ now: T0, enrollmentId: ENROLLMENT, scheduler, cards: [], masteries, missions, pace: 'regular', learnerLevel: 'beginner' });
    const weak = plan.items.find((i) => i.kind === 'weak_skill_mission');
    expect(weak && weak.kind === 'weak_skill_mission' ? weak.missionId : null).toBe('m3');
    expect(plan.items.filter((i) => i.kind === 'new_mission').map((i) => i.kind === 'new_mission' && i.missionId)).toEqual(['m2']);
    const replayOnly = planSession({ now: T0, enrollmentId: ENROLLMENT, scheduler, cards: [], masteries, missions: [missions[0]!], pace: 'regular', learnerLevel: 'beginner' });
    expect(replayOnly.items.map((i) => i.kind)).toEqual(['weak_skill_mission']);
    expect(replayOnly.notes).toContain('all_unlocked_missions_completed');
  });

  it('is deterministic for the same input', () => {
    const input = { now: T0, enrollmentId: ENROLLMENT, scheduler, cards: dueCards(5), masteries: [], missions: [mission('m1'), mission('m2')], pace: 'regular' as const, learnerLevel: 'beginner' as const };
    expect(planSession(input)).toEqual(planSession(input));
  });
});

describe('buildOfflinePack', () => {
  const ctx = buildLanguageContext({ uiLocale: 'fr-CA', enrollmentId: ENROLLMENT, sourceLanguageCode: 'fr', courseTrackId: 'arabic-moroccan', scriptMode: 'both' });
  const withAudio = (c: ExpressionCandidateInput, i: number): ExpressionCandidateInput => ({
    ...c,
    audio: [
      { assetId: `asset-${i}-normal`, speechRate: 'normal', synthetic: false, regionalOption: null },
      ...(i % 2 === 0 ? [{ assetId: `asset-${i}-slow`, speechRate: 'slow' as const, synthetic: false, regionalOption: null }] : []),
    ],
  });
  const candidates = ARABIC_MOROCCAN_CHAPTER_1.missions.flatMap((m) => seedExpressionsToCandidates(ARABIC_MOROCCAN_CHAPTER_1, m)).map(withAudio);

  afterEach(() => vi.restoreAllMocks());

  it('builds the same pack for the same seed and a different one for another seed, without Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    const a = buildOfflinePack({ seed: 'device-1', ctx, expressions: candidates, size: 12 });
    const b = buildOfflinePack({ seed: 'device-1', ctx, expressions: [...candidates].reverse(), size: 12 });
    const c = buildOfflinePack({ seed: 'device-2', ctx, expressions: candidates, size: 12 });
    expect(a).toEqual(b);
    expect(a.packId).toBe(b.packId);
    expect(a.exercises).toHaveLength(12);
    expect(c.exercises.map((e) => e.expressionId)).not.toEqual(a.exercises.map((e) => e.expressionId));
  });

  it('produces valid exercises of every kind using only pre-generated assets', () => {
    const pack = buildOfflinePack({ seed: 's', ctx, expressions: candidates, size: 9 });
    expect(new Set(pack.exercises.map((e) => e.kind))).toEqual(new Set(['listen_identify', 'anticipate', 'repeat']));
    for (const ex of pack.exercises) {
      if (ex.kind === 'listen_identify') {
        expect(ex.options).toHaveLength(3);
        expect(ex.options[ex.correctIndex]!.expressionId).toBe(ex.expressionId);
        expect(new Set(ex.options.map((o) => o.expressionId)).size).toBe(3);
        expect(pack.requiredAssetIds).toContain(ex.promptAudio.assetId);
      } else if (ex.kind === 'anticipate') {
        expect(ex.requiresAttemptBeforeReveal).toBe(true);
        expect(ex.reveal.forms.length).toBeGreaterThan(0);
        expect(ex.meaning.length).toBeGreaterThan(0);
      } else {
        expect(ex.assessmentMode).toBe('reference-comparison');
        expect(ex.audio.normal.assetId).toMatch(/normal$/);
      }
    }
    expect(pack.requiredAssetIds).toEqual([...pack.requiredAssetIds].sort());
    expect(pack.estimatedSeconds).toBeGreaterThan(0);
  });

  it('skips expressions without audio, without a source meaning or from another variety, with reasons', () => {
    const noAudio = { ...candidates[0]!, id: 'no-audio', audio: [] };
    const wrongVariety = { ...candidates[1]!, id: 'msa', targetVarietyId: 'arb' as const };
    const ruOnly = { ...candidates[2]!, id: 'ru-only', meanings: { ru: { meaning: 'x', contextNote: null, literalGloss: null } } };
    const pack = buildOfflinePack({ seed: 's', ctx, expressions: [noAudio, wrongVariety, ruOnly, ...candidates.slice(3, 6)], size: 6 });
    expect(pack.skipped).toEqual(expect.arrayContaining([
      { expressionId: 'no-audio', reason: 'no_audio' },
      { expressionId: 'msa', reason: 'wrong_variety' },
      { expressionId: 'ru-only', reason: 'missing_source_meaning' },
    ]));
    expect(pack.exercises.every((e) => !['no-audio', 'msa', 'ru-only'].includes(e.expressionId))).toBe(true);
    expect(buildOfflinePack({ seed: 's', ctx, expressions: [], size: 6 }).exercises).toEqual([]);
  });
});
