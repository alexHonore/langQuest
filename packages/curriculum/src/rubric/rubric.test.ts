import type { EvaluatorOutput } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { getBlueprint } from '../missions/scenarios';
import { acceptUtteranceIntent, branchConditionFor, evaluateMissionObjectives, isInappropriateIntent } from './rubric';
import { InMemoryXpLedger, XP_RULES, earnedAchievements, expectedXp, levelForXp, masteryAdvanceXp, missionCompletionXp, responseFingerprint, validateXpClaim, type XpClaim } from './xp';

const ENROLLMENT = '00000000-0000-4000-8000-000000000001';
const ATTEMPT = '00000000-0000-4000-8000-0000000000aa';

const evaluation = (over: Partial<EvaluatorOutput> = {}): EvaluatorOutput => ({
  objectivesCompleted: [],
  skillsExercised: ['request_drink'],
  observations: [],
  priorityCorrections: [],
  summary: 'The learner ordered a coffee and asked for the bill. Contact: me@example.com',
  reviewTriggers: [],
  relationshipMemoryUpdate: null,
  confidence: 0.8,
  ...over,
});

describe('objective rubric', () => {
  const cafe = getBlueprint('cafe_order_drink');

  it('accepts a semantically valid paraphrase of the expected intent (A11) and rejects inappropriate meanings', () => {
    expect(acceptUtteranceIntent(['request_drink'], ['request_item']).reason).toBe('paraphrase');
    expect(acceptUtteranceIntent(['request_drink'], ['request_drink']).reason).toBe('exact');
    expect(acceptUtteranceIntent(['request_drink'], ['say_goodbye']).reason).toBe('no_match');
    expect(acceptUtteranceIntent(['request_drink'], ['bare_command'], { requirePolite: true })).toMatchObject({ accepted: false, reason: 'rude_in_polite_scene', rejectedIntentKey: 'bare_command' });
    expect(acceptUtteranceIntent(['request_drink'], ['insult', 'request_drink'])).toMatchObject({ accepted: false, reason: 'offensive' });
    expect(acceptUtteranceIntent(['request_drink'], ['ask_price'], { rejectIntentKeys: ['ask_price'] }).reason).toBe('rejected_intent');
    expect(isInappropriateIntent('bare_command')).toBeNull();
    expect(isInappropriateIntent('bare_command', { requirePolite: true })).toBe('rude_in_polite_scene');
  });

  it('completes objectives from evaluator reports and matched intents, computing a pass/partial/fail outcome', () => {
    const full = evaluateMissionObjectives({ objectives: cafe.objectives, rejectIntentKeys: cafe.rejectIntentKeys, requirePolite: true }, evaluation({ objectivesCompleted: ['greet', 'request_drink', 'pay'] }), ['choose_option', 'thank']);
    expect(full.passed).toBe(true);
    expect(full.outcome).toBe('success');
    expect(full.requiredCompleted).toBe(5);
    expect(full.objectives.find((o) => o.id === 'choose_option')!.evidence).toBe('intent_paraphrase');
    expect(full.summary).not.toMatch(/example\.com/);
    expect(branchConditionFor(full)).toBe('all_required_completed');

    const partial = evaluateMissionObjectives({ objectives: cafe.objectives }, evaluation({ objectivesCompleted: ['greet'] }));
    expect(partial.outcome).toBe('partial');
    expect(partial.completionRatio).toBe(0.2);
    expect(branchConditionFor(partial)).toBe('partial');

    const none = evaluateMissionObjectives({ objectives: cafe.objectives }, evaluation());
    expect(none.outcome).toBe('fail');
    expect(branchConditionFor(none)).toBe('none');
  });

  it('never passes a mission on an offensive or scene-rejected turn', () => {
    const r = evaluateMissionObjectives({ objectives: cafe.objectives, rejectIntentKeys: cafe.rejectIntentKeys, requirePolite: true }, evaluation({ objectivesCompleted: ['greet', 'request_drink', 'choose_option', 'pay', 'thank'] }), ['insult']);
    expect(r.passed).toBe(false);
    expect(r.rejectedIntentKeys).toEqual(['insult']);
    expect(r.outcome).toBe('partial');
    const rude = evaluateMissionObjectives({ objectives: cafe.objectives, rejectIntentKeys: cafe.rejectIntentKeys, requirePolite: true }, evaluation(), ['bare_command']);
    expect(rude.rejectedIntentKeys).toEqual(['bare_command']);
    expect(rude.objectives.find((o) => o.id === 'request_drink')!.completed).toBe(false);
  });
});

describe('XP rules', () => {
  it('fixes XP per outcome and validates amounts server-side', () => {
    expect(missionCompletionXp('success')).toBe(XP_RULES.mission_completed);
    expect(missionCompletionXp('partial')).toBe(25);
    expect(missionCompletionXp('fail')).toBe(0);
    expect(masteryAdvanceXp('emerging', 'practiced')).toBe(15);
    expect(masteryAdvanceXp('practiced', 'emerging')).toBe(0);
    expect(expectedXp({ reason: 'conversation_turns', units: 4 })).toBe(8);
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(100)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
  });

  it('awards a mission attempt once (A27) and treats replayed client events as duplicates', () => {
    const ledger = new InMemoryXpLedger();
    const claim: XpClaim = { clientEventId: 'evt-1', enrollmentId: ENROLLMENT, reason: 'mission_completed', referenceId: ATTEMPT, amount: 50, outcome: 'success' };
    expect(ledger.apply(claim)).toMatchObject({ resolution: 'applied', amount: 50 });
    expect(ledger.apply(claim)).toMatchObject({ resolution: 'duplicate', amount: 0, reason: 'duplicate_event' });
    expect(ledger.apply({ ...claim, clientEventId: 'evt-2' })).toMatchObject({ resolution: 'duplicate', amount: 0, reason: 'already_awarded' });
    expect(ledger.totalXp).toBe(50);
    expect(validateXpClaim({ ...claim, clientEventId: 'evt-3', referenceId: 'other-attempt', amount: 60 }, ledger)).toMatchObject({ resolution: 'rejected', reason: 'amount_mismatch' });
    expect(validateXpClaim({ ...claim, clientEventId: 'evt-4', referenceId: null }, ledger)).toMatchObject({ resolution: 'rejected', reason: 'missing_reference' });
    expect(validateXpClaim({ clientEventId: 'evt-5', enrollmentId: ENROLLMENT, reason: 'conversation_turns', referenceId: 'session-1', amount: 40, units: 20 }, ledger)).toMatchObject({ resolution: 'rejected', reason: 'units_exceeded' });
  });

  it('does not re-award identical repeated responses', () => {
    const ledger = new InMemoryXpLedger();
    const fp = responseFingerprint(ATTEMPT, 'step-3', 'Bghit wa7ed l9ahwa, 3afak!');
    expect(fp).toBe(responseFingerprint(ATTEMPT, 'step-3', '  bghit wa7ed  l9ahwa 3afak '));
    expect(fp).not.toBe(responseFingerprint(ATTEMPT, 'step-3', 'ness ness 3afak'));
    const first: XpClaim = { clientEventId: 'r-1', enrollmentId: ENROLLMENT, reason: 'review_completed', referenceId: 'review-1', amount: 8, responseFingerprint: fp };
    expect(ledger.apply(first)).toMatchObject({ resolution: 'applied', amount: 8 });
    expect(ledger.apply({ ...first, clientEventId: 'r-2', referenceId: 'review-2' })).toMatchObject({ resolution: 'rejected', reason: 'identical_response' });
    expect(ledger.apply({ ...first, clientEventId: 'r-3', referenceId: 'review-3', responseFingerprint: responseFingerprint(ATTEMPT, 'step-3', 'different answer') })).toMatchObject({ resolution: 'applied' });
    expect(ledger.totalXp).toBe(16);
  });

  it('derives achievements from can-do mastery, not from XP', () => {
    const keys = earnedAchievements({
      masteryBySkill: new Map([['greet_politely', 'independent'], ['ask_price', 'durable'], ['request_item', 'practiced']]),
      missionsCompleted: 9,
      missionsCompletedWithoutHints: 5,
      distinctMissionsCompleted: 6,
    });
    expect(keys).toEqual(['can_do.ask_price', 'can_do.greet_politely', 'chapter_one_explored', 'first_mission', 'five_missions_unaided']);
  });
});
