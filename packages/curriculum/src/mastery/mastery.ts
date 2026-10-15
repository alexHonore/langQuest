/**
 * Observation → mastery state machine (§3.4).
 *
 * `not_attempted → emerging → practiced → independent → durable`, derived from
 * *observations* (never invented scores) and weighted by autonomy (hints), transfer to
 * unseen scenarios, retention after a delay and scorer uncertainty.
 *
 * Hard rule: pronunciation evidence is only counted when it comes from a capable acoustic
 * assessor or a human. A transcript matching the reference is never pronunciation evidence.
 */
import {
  MASTERY_ORDER,
  masteryRank,
  OBSERVATION_TYPE_VALUES,
  type AutonomyLevel,
  type MasteryState,
  type ObservationOutcome,
  type ObservationType,
  type ScorerKind,
  type SkillMasterySnapshot,
  type SkillObservation,
  type SkillObservationInput,
} from '@langquest/contracts';

const MS_PER_DAY = 86_400_000;

/** An observation as the mastery engine consumes it (persisted or not yet persisted). */
export type MasteryObservation = Pick<SkillObservationInput, 'skillKey' | 'observationType' | 'scenarioId' | 'autonomy' | 'hintsUsed' | 'outcome' | 'utteranceConfidence' | 'scorerKind' | 'uncertainty'> & {
  observedAt: string;
};

export const toMasteryObservation = (o: SkillObservation): MasteryObservation => ({
  skillKey: o.skillKey,
  observationType: o.observationType,
  scenarioId: o.scenarioId,
  autonomy: o.autonomy,
  hintsUsed: o.hintsUsed,
  outcome: o.outcome,
  utteranceConfidence: o.utteranceConfidence,
  scorerKind: o.scorerKind,
  uncertainty: o.uncertainty,
  observedAt: o.observedAt,
});

export interface MasteryWeights {
  autonomy: Record<AutonomyLevel, number>;
  /** Value of each outcome in [0,1]; `null` excludes the observation. */
  outcome: Record<ObservationOutcome, number | null>;
  scorer: Record<ScorerKind, number>;
  /** Weight multiplier per observation type (transfer/retention evidence counts more). */
  observationType: Record<ObservationType, number>;
}

export const DEFAULT_MASTERY_WEIGHTS: MasteryWeights = {
  autonomy: { unaided: 1, hinted: 0.7, heavily_hinted: 0.4, revealed: 0.1 },
  outcome: { success: 1, partial: 0.5, fail: 0, unclear: null },
  scorer: { human: 1, acoustic_assessor: 0.9, deterministic: 0.85, llm_evaluator: 0.7 },
  observationType: {
    listening_comprehension: 0.8,
    spoken_production: 1,
    semantic_success: 1,
    register_appropriateness: 0.6,
    intelligibility: 0.8,
    pronunciation: 0.6,
    fluency: 0.5,
    retention: 1.2,
    transfer: 1.2,
  },
};

export interface MasteryThresholds {
  /** Weighted evidence mass needed for `practiced`. */
  practicedMinEvidence: number;
  practicedMinScore: number;
  independentMinUnaidedSuccesses: number;
  independentMinScenarios: number;
  independentMinScore: number;
  independentMaxUncertainty: number;
  /** Days between a success and a later success for the later one to count as retention. */
  durableRetentionGapDays: number;
  durableMinScore: number;
  /** Observations with scorer uncertainty at or above this are excluded entirely. */
  excludeUncertaintyAtOrAbove: number;
}

export const DEFAULT_MASTERY_THRESHOLDS: MasteryThresholds = {
  practicedMinEvidence: 1,
  practicedMinScore: 0.45,
  independentMinUnaidedSuccesses: 2,
  independentMinScenarios: 2,
  independentMinScore: 0.65,
  independentMaxUncertainty: 0.5,
  durableRetentionGapDays: 7,
  durableMinScore: 0.75,
  excludeUncertaintyAtOrAbove: 0.9,
};

export type ExclusionReason = 'unclear_outcome' | 'pronunciation_requires_acoustic_or_human' | 'too_uncertain';

export interface EvidenceDimension {
  observationType: ObservationType;
  count: number;
  /** Weighted success mass / weighted total; null without evidence. */
  successRate: number | null;
  lastObservedAt: string | null;
}

/** Evidence summary exposed to the Progress screen (§3.4 transparency). */
export interface EvidenceSummary {
  skillKey: string;
  masteryState: MasteryState;
  /** Internal weighted score [0,1]; never displayed as a grade. */
  internalScore: number;
  evidenceCount: number;
  uncertainty: number;
  lastPracticedAt: string | null;
  dimensions: EvidenceDimension[];
  unaidedSuccesses: number;
  hintedSuccesses: number;
  failures: number;
  /** Distinct scenarios with at least one success (transfer breadth). */
  distinctSuccessScenarios: number;
  /** Successes in a scenario different from the first success's scenario, or explicit `transfer` observations. */
  transferSuccesses: number;
  /** Longest gap (days) between a success and a later success. */
  longestRetentionGapDays: number;
  /** Fails that happened >= retention gap after a prior success (retention broke). */
  retentionFailures: number;
  /** Where pronunciation evidence came from, if any. */
  pronunciationEvidence: 'acoustic' | 'human' | 'none';
  excluded: { count: number; reasons: Partial<Record<ExclusionReason, number>> };
  /** i18n key describing what would move the learner to the next state. */
  nextStepKey: string;
}

export interface DeriveMasteryOptions {
  now: string;
  weights?: Partial<MasteryWeights>;
  thresholds?: Partial<MasteryThresholds>;
  /** Previous persisted state (regression is limited to one rank per recompute). */
  previousState?: MasteryState;
}

export interface MasteryDerivation {
  snapshot: Omit<SkillMasterySnapshot, 'enrollmentId'>;
  summary: EvidenceSummary;
}

/** Reason an observation does not count; `null` when it counts. */
export function exclusionReason(o: MasteryObservation, thresholds: MasteryThresholds = DEFAULT_MASTERY_THRESHOLDS): ExclusionReason | null {
  if (o.outcome === 'unclear') return 'unclear_outcome';
  if (o.observationType === 'pronunciation' && o.scorerKind !== 'acoustic_assessor' && o.scorerKind !== 'human') return 'pronunciation_requires_acoustic_or_human';
  if (o.uncertainty >= thresholds.excludeUncertaintyAtOrAbove) return 'too_uncertain';
  return null;
}

const isProductionType = (t: ObservationType): boolean => t === 'spoken_production' || t === 'semantic_success' || t === 'intelligibility' || t === 'fluency' || t === 'pronunciation' || t === 'transfer' || t === 'retention';

/** Weight of a counted observation inside the internal score. */
export function observationWeight(o: MasteryObservation, weights: MasteryWeights = DEFAULT_MASTERY_WEIGHTS): number {
  const confidence = isProductionType(o.observationType) ? (o.utteranceConfidence ?? 0.8) : 1;
  return weights.autonomy[o.autonomy] * weights.scorer[o.scorerKind] * weights.observationType[o.observationType] * (1 - o.uncertainty) * confidence;
}

/**
 * Evidence *mass* of an observation (how much it counts toward "has practised"):
 * autonomy × scorer certainty, independent of outcome and of scorer kind.
 */
export const observationMass = (o: MasteryObservation, weights: MasteryWeights = DEFAULT_MASTERY_WEIGHTS): number => weights.autonomy[o.autonomy] * (1 - o.uncertainty);

const isSuccess = (o: MasteryObservation): boolean => o.outcome === 'success';

/**
 * Derive the mastery state and evidence summary for one skill from its observations.
 * Pure and order-independent (observations are sorted by `observedAt`).
 */
export function deriveMastery(skillKey: string, observations: readonly MasteryObservation[], options: DeriveMasteryOptions): MasteryDerivation {
  const weights: MasteryWeights = { ...DEFAULT_MASTERY_WEIGHTS, ...options.weights };
  const thresholds: MasteryThresholds = { ...DEFAULT_MASTERY_THRESHOLDS, ...options.thresholds };
  const all = observations.filter((o) => o.skillKey === skillKey).sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  const excluded: Partial<Record<ExclusionReason, number>> = {};
  const counted: MasteryObservation[] = [];
  for (const o of all) {
    const reason = exclusionReason(o, thresholds);
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    else counted.push(o);
  }

  let weightedTotal = 0;
  let weightedSuccess = 0;
  let evidenceMass = 0;
  let uncertaintySum = 0;
  const dims = new Map<ObservationType, { count: number; wt: number; ws: number; last: string | null }>();
  for (const t of OBSERVATION_TYPE_VALUES) dims.set(t, { count: 0, wt: 0, ws: 0, last: null });
  let unaidedSuccesses = 0;
  let hintedSuccesses = 0;
  let failures = 0;
  const successScenarios = new Set<string>();
  let firstSuccessScenario: string | null = null;
  let transferSuccesses = 0;
  let longestGap = 0;
  let retentionFailures = 0;
  let lastSuccessAt: string | null = null;
  let pronunciationEvidence: 'acoustic' | 'human' | 'none' = 'none';

  for (const o of counted) {
    const w = observationWeight(o, weights);
    const v = weights.outcome[o.outcome] ?? 0;
    weightedTotal += w;
    weightedSuccess += w * v;
    evidenceMass += observationMass(o, weights);
    uncertaintySum += o.uncertainty;
    const d = dims.get(o.observationType)!;
    d.count += 1;
    d.wt += w;
    d.ws += w * v;
    d.last = o.observedAt;
    if (o.observationType === 'pronunciation') pronunciationEvidence = o.scorerKind === 'human' ? 'human' : pronunciationEvidence === 'human' ? 'human' : 'acoustic';

    const gapDays = lastSuccessAt ? (new Date(o.observedAt).getTime() - new Date(lastSuccessAt).getTime()) / MS_PER_DAY : 0;
    if (isSuccess(o)) {
      if (o.autonomy === 'unaided') unaidedSuccesses += 1;
      else if (o.autonomy !== 'revealed') hintedSuccesses += 1;
      if (o.autonomy !== 'revealed') {
        successScenarios.add(o.scenarioId);
        if (firstSuccessScenario === null) firstSuccessScenario = o.scenarioId;
        else if (o.scenarioId !== firstSuccessScenario || o.observationType === 'transfer') transferSuccesses += 1;
        if (lastSuccessAt) longestGap = Math.max(longestGap, gapDays);
        lastSuccessAt = o.observedAt;
      }
    } else if (o.outcome === 'fail') {
      failures += 1;
      if (lastSuccessAt && gapDays >= thresholds.durableRetentionGapDays && o.autonomy !== 'revealed') retentionFailures += 1;
    }
  }

  // Shrink toward a low prior while evidence is thin.
  const priorMass = 0.5;
  const priorScore = 0.25;
  const internalScore = weightedTotal > 0 ? (weightedSuccess + priorMass * priorScore) / (weightedTotal + priorMass) : 0;
  const meanUncertainty = counted.length ? uncertaintySum / counted.length : 1;
  const uncertainty = Math.min(1, 0.5 * (1 - Math.min(1, evidenceMass / 5)) + 0.5 * meanUncertainty);

  // Retention: the latest delayed check must have succeeded.
  const lastDelayedCheck = [...counted].reverse().find((o) => {
    if (!lastSuccessAt || o.autonomy === 'revealed') return false;
    const prior = counted.filter((p) => p.observedAt < o.observedAt && isSuccess(p) && p.autonomy !== 'revealed').at(-1);
    return prior !== undefined && (new Date(o.observedAt).getTime() - new Date(prior.observedAt).getTime()) / MS_PER_DAY >= thresholds.durableRetentionGapDays;
  });
  const retentionHeld = longestGap >= thresholds.durableRetentionGapDays && lastDelayedCheck !== undefined && isSuccess(lastDelayedCheck);

  let state: MasteryState = all.length === 0 ? 'not_attempted' : 'emerging';
  if (state === 'emerging' && evidenceMass >= thresholds.practicedMinEvidence && internalScore >= thresholds.practicedMinScore) state = 'practiced';
  if (
    state === 'practiced' &&
    unaidedSuccesses >= thresholds.independentMinUnaidedSuccesses &&
    successScenarios.size >= thresholds.independentMinScenarios &&
    internalScore >= thresholds.independentMinScore &&
    uncertainty <= thresholds.independentMaxUncertainty
  )
    state = 'independent';
  if (state === 'independent' && retentionHeld && internalScore >= thresholds.durableMinScore) state = 'durable';

  if (options.previousState) state = reconcileMastery(options.previousState, state);

  const nextStepKey =
    state === 'not_attempted'
      ? 'mastery.next.try_in_a_mission'
      : state === 'emerging'
        ? 'mastery.next.practice_more'
        : state === 'practiced'
          ? successScenarios.size < thresholds.independentMinScenarios
            ? 'mastery.next.use_in_new_scenario'
            : 'mastery.next.succeed_without_hints'
          : state === 'independent'
            ? 'mastery.next.recall_after_days'
            : 'mastery.next.keep_it_alive';

  const lastPracticedAt = all.at(-1)?.observedAt ?? null;
  const dimensions: EvidenceDimension[] = OBSERVATION_TYPE_VALUES.map((t) => {
    const d = dims.get(t)!;
    return { observationType: t, count: d.count, successRate: d.wt > 0 ? d.ws / d.wt : null, lastObservedAt: d.last };
  });

  return {
    snapshot: {
      skillKey,
      masteryState: state,
      internalScore: Math.max(0, Math.min(1, internalScore)),
      evidenceCount: counted.length,
      uncertainty,
      lastPracticedAt,
      dueAt: null,
    },
    summary: {
      skillKey,
      masteryState: state,
      internalScore: Math.max(0, Math.min(1, internalScore)),
      evidenceCount: counted.length,
      uncertainty,
      lastPracticedAt,
      dimensions,
      unaidedSuccesses,
      hintedSuccesses,
      failures,
      distinctSuccessScenarios: successScenarios.size,
      transferSuccesses,
      longestRetentionGapDays: Math.round(longestGap * 10) / 10,
      retentionFailures,
      pronunciationEvidence,
      excluded: { count: Object.values(excluded).reduce((a, b) => a + (b ?? 0), 0), reasons: excluded },
      nextStepKey,
    },
  };
}

/**
 * Limit regression: a recompute may drop mastery by at most one rank (evidence of a
 * broken retention check), never more, and never below `emerging` once attempted.
 */
export function reconcileMastery(previous: MasteryState, derived: MasteryState): MasteryState {
  const prev = masteryRank(previous);
  const next = masteryRank(derived);
  if (next >= prev) return derived;
  const floor = previous === 'not_attempted' ? 0 : 1;
  return MASTERY_ORDER[Math.max(floor, prev - 1)]!;
}

/** Derive mastery for every skill present in a set of observations. */
export function deriveMasteryForAll(observations: readonly MasteryObservation[], options: DeriveMasteryOptions & { previousStates?: ReadonlyMap<string, MasteryState> }): Map<string, MasteryDerivation> {
  const out = new Map<string, MasteryDerivation>();
  const keys = [...new Set(observations.map((o) => o.skillKey))].sort();
  for (const key of keys) {
    const prev = options.previousStates?.get(key);
    out.set(key, deriveMastery(key, observations, { ...options, ...(prev ? { previousState: prev } : {}) }));
  }
  return out;
}

/** Count of skills per mastery state (Progress screen). */
export function masteryCounts(states: Iterable<MasteryState>): Record<MasteryState, number> {
  const counts: Record<MasteryState, number> = { not_attempted: 0, emerging: 0, practiced: 0, independent: 0, durable: 0 };
  for (const s of states) counts[s] += 1;
  return counts;
}
