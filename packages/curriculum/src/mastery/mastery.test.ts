import { describe, expect, it } from 'vitest';
import { deriveMastery, deriveMasteryForAll, exclusionReason, masteryCounts, reconcileMastery, type MasteryObservation } from './mastery';

const day = (d: number, h = 9) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

const obs = (over: Partial<MasteryObservation> & { observedAt: string }): MasteryObservation => ({
  skillKey: 'request_drink',
  observationType: 'semantic_success',
  scenarioId: 'cafe',
  autonomy: 'unaided',
  hintsUsed: 0,
  outcome: 'success',
  utteranceConfidence: 0.9,
  scorerKind: 'llm_evaluator',
  uncertainty: 0.2,
  ...over,
});

describe('mastery state machine', () => {
  it('not_attempted without observations, emerging after the first attempt', () => {
    expect(deriveMastery('request_drink', [], { now: day(10) }).snapshot.masteryState).toBe('not_attempted');
    const one = deriveMastery('request_drink', [obs({ observedAt: day(1), outcome: 'fail' })], { now: day(2) });
    expect(one.snapshot.masteryState).toBe('emerging');
    expect(one.summary.failures).toBe(1);
    expect(one.summary.nextStepKey).toBe('mastery.next.practice_more');
  });

  it('hinted successes reach practiced but not independent', () => {
    const hinted = [obs({ observedAt: day(1), autonomy: 'hinted', hintsUsed: 1 }), obs({ observedAt: day(2), autonomy: 'hinted', hintsUsed: 1, scenarioId: 'market' }), obs({ observedAt: day(3), autonomy: 'heavily_hinted', hintsUsed: 2 })];
    const d = deriveMastery('request_drink', hinted, { now: day(4) });
    expect(d.snapshot.masteryState).toBe('practiced');
    expect(d.summary.unaidedSuccesses).toBe(0);
    expect(d.summary.hintedSuccesses).toBe(3);
    expect(d.summary.nextStepKey).toBe('mastery.next.succeed_without_hints');
  });

  it('independent requires unaided successes across different scenarios (transfer)', () => {
    const sameScene = [obs({ observedAt: day(1) }), obs({ observedAt: day(2) }), obs({ observedAt: day(3) })];
    const same = deriveMastery('request_drink', sameScene, { now: day(4) });
    expect(same.snapshot.masteryState).toBe('practiced');
    expect(same.summary.distinctSuccessScenarios).toBe(1);
    expect(same.summary.nextStepKey).toBe('mastery.next.use_in_new_scenario');
    const transferred = [...sameScene, obs({ observedAt: day(4), scenarioId: 'restaurant', observationType: 'transfer' })];
    const t = deriveMastery('request_drink', transferred, { now: day(5) });
    expect(t.snapshot.masteryState).toBe('independent');
    expect(t.summary.transferSuccesses).toBe(1);
    expect(t.summary.uncertainty).toBeLessThanOrEqual(0.5);
  });

  it('durable requires a successful recall at least 7 days after a prior success', () => {
    const base = [obs({ observedAt: day(1) }), obs({ observedAt: day(2), scenarioId: 'market' }), obs({ observedAt: day(3), scenarioId: 'taxi' })];
    const soon = deriveMastery('request_drink', [...base, obs({ observedAt: day(5), scenarioId: 'restaurant', observationType: 'retention' })], { now: day(6) });
    expect(soon.snapshot.masteryState).toBe('independent');
    const later = deriveMastery('request_drink', [...base, obs({ observedAt: day(12), scenarioId: 'restaurant', observationType: 'retention' })], { now: day(13) });
    expect(later.snapshot.masteryState).toBe('durable');
    expect(later.summary.longestRetentionGapDays).toBeGreaterThanOrEqual(7);
    const broken = deriveMastery('request_drink', [...base, obs({ observedAt: day(12), scenarioId: 'restaurant', observationType: 'retention', outcome: 'fail' })], { now: day(13) });
    expect(broken.snapshot.masteryState).not.toBe('durable');
    expect(broken.summary.retentionFailures).toBe(1);
  });

  it('never derives pronunciation evidence from a transcript-based scorer', () => {
    const fromLlm = obs({ observedAt: day(1), observationType: 'pronunciation', scorerKind: 'llm_evaluator' });
    const fromDeterministic = obs({ observedAt: day(1), observationType: 'pronunciation', scorerKind: 'deterministic' });
    const fromAcoustic = obs({ observedAt: day(2), observationType: 'pronunciation', scorerKind: 'acoustic_assessor' });
    expect(exclusionReason(fromLlm)).toBe('pronunciation_requires_acoustic_or_human');
    expect(exclusionReason(fromDeterministic)).toBe('pronunciation_requires_acoustic_or_human');
    expect(exclusionReason(fromAcoustic)).toBeNull();
    const d = deriveMastery('request_drink', [fromLlm, fromDeterministic, fromAcoustic], { now: day(3) });
    expect(d.summary.excluded.count).toBe(2);
    expect(d.summary.excluded.reasons.pronunciation_requires_acoustic_or_human).toBe(2);
    expect(d.summary.pronunciationEvidence).toBe('acoustic');
    expect(d.snapshot.evidenceCount).toBe(1);
    const human = deriveMastery('request_drink', [fromAcoustic, obs({ observedAt: day(3), observationType: 'pronunciation', scorerKind: 'human' })], { now: day(4) });
    expect(human.summary.pronunciationEvidence).toBe('human');
  });

  it('excludes unclear outcomes and very uncertain scorers, and weights uncertainty into the snapshot', () => {
    const unclear = obs({ observedAt: day(1), outcome: 'unclear' });
    const vague = obs({ observedAt: day(2), uncertainty: 0.95 });
    const d = deriveMastery('request_drink', [unclear, vague], { now: day(3) });
    expect(d.snapshot.masteryState).toBe('emerging');
    expect(d.snapshot.evidenceCount).toBe(0);
    expect(d.summary.excluded.reasons).toEqual({ unclear_outcome: 1, too_uncertain: 1 });
    const confident = deriveMastery('request_drink', [obs({ observedAt: day(1), uncertainty: 0.05 }), obs({ observedAt: day(2), uncertainty: 0.05, scenarioId: 'market' })], { now: day(3) });
    const shaky = deriveMastery('request_drink', [obs({ observedAt: day(1), uncertainty: 0.6 }), obs({ observedAt: day(2), uncertainty: 0.6, scenarioId: 'market' })], { now: day(3) });
    expect(confident.snapshot.uncertainty).toBeLessThan(shaky.snapshot.uncertainty);
    expect(confident.snapshot.internalScore).toBeGreaterThan(shaky.snapshot.internalScore);
  });

  it('limits regression to one rank per recompute', () => {
    expect(reconcileMastery('durable', 'emerging')).toBe('independent');
    expect(reconcileMastery('practiced', 'not_attempted')).toBe('emerging');
    expect(reconcileMastery('emerging', 'durable')).toBe('durable');
    expect(reconcileMastery('independent', 'independent')).toBe('independent');
    const d = deriveMastery('request_drink', [obs({ observedAt: day(1), outcome: 'fail' })], { now: day(2), previousState: 'durable' });
    expect(d.snapshot.masteryState).toBe('independent');
  });

  it('exposes per-dimension evidence for the Progress screen and derives all skills at once', () => {
    const observations = [
      obs({ observedAt: day(1), observationType: 'listening_comprehension' }),
      obs({ observedAt: day(2), observationType: 'spoken_production', outcome: 'partial' }),
      obs({ observedAt: day(2), skillKey: 'greet_politely', scenarioId: 'street' }),
    ];
    const all = deriveMasteryForAll(observations, { now: day(3), previousStates: new Map([['greet_politely', 'practiced']]) });
    expect([...all.keys()]).toEqual(['greet_politely', 'request_drink']);
    const rd = all.get('request_drink')!.summary;
    expect(rd.dimensions.find((x) => x.observationType === 'listening_comprehension')!.count).toBe(1);
    expect(rd.dimensions.find((x) => x.observationType === 'spoken_production')!.successRate).toBe(0.5);
    expect(rd.dimensions.find((x) => x.observationType === 'pronunciation')!.successRate).toBeNull();
    // Previous `practiced` with only one recomputed success regresses by at most one rank.
    expect(all.get('greet_politely')!.snapshot.masteryState).toBe('emerging');
    expect(all.get('request_drink')!.snapshot.masteryState).toBe('practiced');
    expect(masteryCounts([...all.values()].map((v) => v.snapshot.masteryState))).toEqual({ not_attempted: 0, emerging: 1, practiced: 1, independent: 0, durable: 0 });
  });
});
