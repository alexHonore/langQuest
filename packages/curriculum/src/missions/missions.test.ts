import { LESSON_TYPE_VALUES, buildLanguageContext } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { ARABIC_MOROCCAN_CHAPTER_1 } from '../content/arabic-moroccan';
import { seedExpressionsToCandidates } from '../content/types';
import { MISSION_TEMPLATES, STANDARD_TEMPLATE, expandTemplate, lessonTypesCoveredByTemplates, templateSeconds, toAudioOnlyTemplate, validateBlueprint } from './blueprint';
import { realise, selectDisplayForms, type ExpressionCandidateInput } from './realise';
import { SITUATIONAL_BLUEPRINTS, getBlueprint } from './scenarios';
import { DEFAULT_STORY_ARC, applyRelationshipUpdate, emptyRelationshipMemory, memoryDigest, sanitizeForMemory, unlockedMilestones } from './story';

const ENROLLMENT = '00000000-0000-4000-8000-000000000001';
const ctxFr = buildLanguageContext({ uiLocale: 'fr-CA', enrollmentId: ENROLLMENT, sourceLanguageCode: 'fr', courseTrackId: 'arabic-moroccan', scriptMode: 'both', learnerLevel: 'beginner' });
const cafeMission = ARABIC_MOROCCAN_CHAPTER_1.missions.find((m) => m.blueprintKey === 'cafe_order_drink')!;
const cafeCandidates = seedExpressionsToCandidates(ARABIC_MOROCCAN_CHAPTER_1, cafeMission);

describe('blueprints and template engine', () => {
  it('ships at least 12 valid situational blueprints', () => {
    expect(SITUATIONAL_BLUEPRINTS.length).toBeGreaterThanOrEqual(12);
    for (const bp of SITUATIONAL_BLUEPRINTS) expect(validateBlueprint(bp), bp.key).toEqual([]);
    expect(new Set(SITUATIONAL_BLUEPRINTS.map((b) => b.key)).size).toBe(SITUATIONAL_BLUEPRINTS.length);
  });

  it('the standard template follows the §3.3 ~8-minute phase budget', () => {
    const total = templateSeconds(STANDARD_TEMPLATE);
    expect(total).toBe(480);
    const byPhase = (phase: string) => STANDARD_TEMPLATE.filter((s) => s.phase === phase).reduce((a, s) => a + s.seconds, 0);
    expect(byPhase('context')).toBe(60);
    expect(byPhase('model')).toBe(90);
    expect(byPhase('anticipate')).toBe(90);
    expect(byPhase('converse')).toBe(180);
    expect(byPhase('feedback')).toBe(60);
    expect(STANDARD_TEMPLATE.map((s) => s.type)).toEqual(['context_listening', 'modeled_expression', 'listen_identify', 'anticipation', 'character_conversation', 'feedback_retry', 'review_recall']);
  });

  it('every §3.2 lesson type is reachable from the templates', () => {
    expect([...lessonTypesCoveredByTemplates()].sort()).toEqual([...LESSON_TYPE_VALUES].sort());
    expect(toAudioOnlyTemplate(STANDARD_TEMPLATE).every((s) => s.lessonType === 'audio_only')).toBe(true);
    expect(Object.keys(MISSION_TEMPLATES).sort()).toEqual(['audio_linked', 'free_conversation', 'pronunciation', 'review', 'situational', 'standard', 'story']);
  });

  it('scales durations by pace and target minutes deterministically', () => {
    const bp = getBlueprint('cafe_order_drink');
    const regular = expandTemplate(bp, { pace: 'regular', level: 'elementary' });
    const relaxed = expandTemplate(bp, { pace: 'relaxed', level: 'elementary' });
    const short = expandTemplate(bp, { pace: 'regular', level: 'elementary', targetMinutes: 4 });
    expect(templateSeconds(regular)).toBe(480);
    expect(templateSeconds(relaxed)).toBeGreaterThan(templateSeconds(regular));
    expect(templateSeconds(short)).toBeLessThan(templateSeconds(regular) / 1.5);
    expect(expandTemplate(bp, { pace: 'regular' })).toEqual(expandTemplate(bp, { pace: 'regular' }));
  });
});

describe('realise()', () => {
  it('binds Darija expressions for a French-source learner and yields a complete mission', () => {
    const mission = realise(getBlueprint('cafe_order_drink'), ctxFr, cafeCandidates);
    expect(mission.complete).toBe(true);
    expect(mission.missingSlots).toEqual([]);
    expect(mission.targetVariety).toBe('ary');
    expect(mission.sourceLanguage).toBe('fr');
    expect(mission.rtl).toBe(true);
    expect(mission.nativeReviewed).toBe(false);
    expect(mission.steps.map((s) => s.type)).toEqual(['context_listening', 'modeled_expression', 'listen_identify', 'anticipation', 'character_conversation', 'feedback_retry', 'review_recall', 'script_support']);
    const order = mission.steps.find((s) => s.type === 'modeled_expression')!.expressions.find((e) => e.slotId === 'order')!;
    expect(order.meaning).toMatch(/café/);
    expect(order.displayForms.map((f) => f.transliterationScheme)).toEqual([null, 'arabizi']);
    expect(mission.scene.codeSwitchNorms).toMatch(/French/);
  });

  it('anticipation steps require an attempt before reveal and carry a 3-level hint scaffold (A16)', () => {
    const mission = realise(getBlueprint('cafe_order_drink'), ctxFr, cafeCandidates);
    const anticipation = mission.steps.find((s) => s.type === 'anticipation')!;
    expect(anticipation.successConditions.requiresAttemptBeforeReveal).toBe(true);
    expect(anticipation.expressions.every((e) => e.speaker === 'learner')).toBe(true);
    const levels = anticipation.hintScaffold.map((h) => h.level);
    expect(levels.slice(0, 3)).toEqual([1, 2, 3]);
    expect(anticipation.hintScaffold.find((h) => h.kind === 'reveal')!.autonomy).toBe('revealed');
    const context = mission.steps.find((s) => s.type === 'context_listening')!;
    expect(context.hintScaffold).toEqual([]);
  });

  it('conversation steps expect objective intents, carry branching and reject insults', () => {
    const mission = realise(getBlueprint('cafe_order_drink'), ctxFr, cafeCandidates);
    const convo = mission.steps.find((s) => s.type === 'character_conversation')!;
    expect(convo.expectedIntentKeys).toContain('request_drink');
    expect(convo.successConditions.requiredObjectiveIds).toEqual(['greet', 'request_drink', 'choose_option', 'pay', 'thank']);
    expect(convo.successConditions.rejectIntentKeys).toEqual(expect.arrayContaining(['bare_command', 'insult']));
    expect(convo.branching?.rules.map((r) => r.when)).toEqual(['all_required_completed', 'partial', 'none', 'learner_asked_repair']);
    expect(convo.offlineCapable).toBe(false);
  });

  it('never uses expressions from another variety (no MSA for Darija) and reports them', () => {
    const msa: ExpressionCandidateInput = { ...cafeCandidates[0]!, id: 'msa-1', targetVarietyId: 'arb', intentKey: 'request_drink', canonicalText: 'أريد قهوة من فضلك' };
    const mission = realise(getBlueprint('cafe_order_drink'), ctxFr, [...cafeCandidates.filter((c) => c.intentKey !== 'request_drink'), msa]);
    expect(mission.complete).toBe(false);
    expect(mission.missingSlots).toEqual(['order']);
    expect(mission.rejectedCandidates).toContainEqual({ expressionId: 'msa-1', reason: 'forbidden_substitution' });
    expect(mission.steps.flatMap((s) => s.expressions).some((e) => e.id === 'msa-1')).toBe(false);
  });

  it('never falls back to another source language for meanings', () => {
    const ctxRu = buildLanguageContext({ uiLocale: 'ru-RU', enrollmentId: ENROLLMENT, sourceLanguageCode: 'ru', courseTrackId: 'arabic-moroccan' });
    const mission = realise(getBlueprint('cafe_order_drink'), ctxRu, cafeCandidates);
    expect(mission.complete).toBe(false);
    expect(mission.rejectedCandidates.every((r) => r.reason === 'missing_source_meaning')).toBe(true);
    expect(mission.steps.flatMap((s) => s.expressions)).toEqual([]);
  });

  it('respects the script mode when selecting forms', () => {
    const forms = cafeCandidates.find((c) => c.intentKey === 'request_drink')!.forms!;
    expect(selectDisplayForms(forms, 'native').map((f) => f.transliterationScheme)).toEqual([null]);
    expect(selectDisplayForms(forms, 'latin').map((f) => f.transliterationScheme)).toEqual(['arabizi']);
    expect(selectDisplayForms(forms, 'both')).toHaveLength(2);
    const ctxLatin = buildLanguageContext({ uiLocale: 'fr-CA', enrollmentId: ENROLLMENT, sourceLanguageCode: 'fr', courseTrackId: 'arabic-moroccan', scriptMode: 'latin' });
    const mission = realise(getBlueprint('cafe_order_drink'), ctxLatin, cafeCandidates);
    expect(mission.steps.some((s) => s.type === 'script_support')).toBe(false);
    expect(mission.steps.flatMap((s) => s.expressions).every((e) => e.displayForms.every((f) => f.transliterationScheme === 'arabizi'))).toBe(true);
  });

  it('varies the scene by seed but is deterministic for the same seed', () => {
    const bp = getBlueprint('greet_and_introduce');
    const greet = ARABIC_MOROCCAN_CHAPTER_1.missions.find((m) => m.blueprintKey === 'greet_and_introduce')!;
    const candidates = seedExpressionsToCandidates(ARABIC_MOROCCAN_CHAPTER_1, greet);
    const a = realise(bp, ctxFr, candidates, { variantSeed: 'attempt-1' });
    const b = realise(bp, ctxFr, candidates, { variantSeed: 'attempt-1' });
    expect(a).toEqual(b);
    const variants = new Set(Array.from({ length: 12 }, (_, i) => realise(bp, ctxFr, candidates, { variantSeed: `attempt-${i}` }).scene.variantId));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe('story arc and relationship memory', () => {
  it('unlocks milestones only when missions and mastery conditions hold', () => {
    const none = unlockedMilestones(DEFAULT_STORY_ARC, new Set(), new Map());
    expect(none).toEqual([]);
    const done = new Set(['greet_and_introduce', 'cafe_order_drink', 'ask_directions']);
    expect(unlockedMilestones(DEFAULT_STORY_ARC, done, new Map([['greet_politely', 1], ['request_item', 2]]))).toEqual([]);
    const unlocked = unlockedMilestones(DEFAULT_STORY_ARC, done, new Map([['greet_politely', 2], ['request_item', 3]]));
    expect(unlocked.map((m) => m.id)).toEqual(['settled_in']);
    expect(DEFAULT_STORY_ARC.chapters.flatMap((c) => c.missionKeys).every((k) => getBlueprint(k))).toBe(true);
  });

  it('sanitises memory text: no contact details, long numbers, links or long quotes; bounded length', () => {
    const dirty = 'Learner said "' + 'x'.repeat(200) + '" and gave +1 514 555 0199, mail me@example.com, see https://example.com/x. ' + 'More text. '.repeat(60);
    const clean = sanitizeForMemory(dirty);
    expect(clean).not.toMatch(/example\.com/);
    expect(clean).not.toMatch(/555/);
    expect(clean).toContain('[quote omitted]');
    expect(clean.length).toBeLessThanOrEqual(400);
  });

  it('applies evaluator updates with bounded rapport and fact count', () => {
    let memory = emptyRelationshipMemory(ENROLLMENT, 'ary_nadia_neighbour');
    for (let i = 0; i < 20; i++) {
      memory = applyRelationshipUpdate(memory, {
        evaluation: { summary: `Encounter ${i}: learner asked for tea.`, relationshipMemoryUpdate: `fact ${i}`, objectivesCompleted: ['a', 'b'], confidence: 0.9 },
        branchNotes: i === 0 ? ['neighbour knows the learner\'s name'] : [],
        requiredObjectiveCount: 2,
        now: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00.000Z`,
      });
    }
    expect(memory.encounters).toBe(20);
    expect(memory.rapport).toBeLessThanOrEqual(1);
    expect(memory.rapport).toBeGreaterThan(0.5);
    expect(memory.facts.length).toBeLessThanOrEqual(12);
    expect(memoryDigest(memory)).toMatch(/rapport: warm/);
    const unsure = applyRelationshipUpdate(memory, { evaluation: { summary: 's', relationshipMemoryUpdate: null, objectivesCompleted: [], confidence: 0.2 }, requiredObjectiveCount: 2, now: '2026-11-01T00:00:00.000Z' });
    expect(unsure.rapport).toBe(memory.rapport);
  });
});
