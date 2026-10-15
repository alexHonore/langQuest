/**
 * Mission objective evaluation from evaluator outputs (§3.7, §14.1 A11/A26).
 *
 * Objectives complete when the evaluator reports them or when an observed intent is an
 * acceptable semantic paraphrase of an objective intent. Inappropriate meanings
 * (`insult`, scene-specific rejects, rude register in polite scenes) are rejected and
 * surfaced — a mission never passes on an offensive turn.
 */
import type { EvaluatorOutput, ObservationOutcome } from '@langquest/contracts';
import { findIntent, isAcceptableParaphrase } from '../intents';
import { sanitizeForMemory } from '../missions/story';

export interface RubricObjective {
  id: string;
  intentKeys: readonly string[];
  skillKeys: readonly string[];
  required: boolean;
}

export interface RubricInput {
  objectives: readonly RubricObjective[];
  /** Scene-specific rejected intents (in addition to globally offensive ones). */
  rejectIntentKeys?: readonly string[];
  /** When true, `rude` intents (e.g. bare commands to staff) are rejected too. */
  requirePolite?: boolean;
}

export interface ObjectiveEvaluation {
  id: string;
  required: boolean;
  completed: boolean;
  /** Intent keys that satisfied it (empty when reported directly by the evaluator). */
  matchedIntentKeys: string[];
  evidence: 'evaluator_reported' | 'intent_paraphrase' | 'none';
}

export interface MissionEvaluation {
  objectives: ObjectiveEvaluation[];
  requiredCompleted: number;
  requiredTotal: number;
  completionRatio: number;
  /** True when all required objectives completed and nothing was rejected. */
  passed: boolean;
  outcome: ObservationOutcome;
  rejectedIntentKeys: string[];
  /** Learner-safe summary (sanitised evaluator summary). */
  summary: string;
  skillsExercised: string[];
  reviewTriggers: string[];
  confidence: number;
}

export interface IntentAcceptance {
  accepted: boolean;
  matchedIntentKey: string | null;
  rejectedIntentKey: string | null;
  reason: 'exact' | 'paraphrase' | 'rejected_intent' | 'offensive' | 'rude_in_polite_scene' | 'no_match';
}

/** Whether an intent is inappropriate in the given scene. */
export function isInappropriateIntent(intentKey: string, options: Pick<RubricInput, 'rejectIntentKeys' | 'requirePolite'> = {}): IntentAcceptance['reason'] | null {
  if (options.rejectIntentKeys?.includes(intentKey)) return 'rejected_intent';
  const intent = findIntent(intentKey);
  if (!intent) return null;
  if (intent.socialRisk === 'offensive') return 'offensive';
  if (options.requirePolite && intent.socialRisk === 'rude') return 'rude_in_polite_scene';
  return null;
}

/**
 * Accept or reject a learner utterance (as matched intent ids) against the intents a step
 * expects. Paraphrases of the same concept with the same polarity are accepted (A11).
 */
export function acceptUtteranceIntent(expectedIntentKeys: readonly string[], matchedIntentKeys: readonly string[], options: Pick<RubricInput, 'rejectIntentKeys' | 'requirePolite'> = {}): IntentAcceptance {
  for (const m of matchedIntentKeys) {
    const bad = isInappropriateIntent(m, options);
    if (bad) return { accepted: false, matchedIntentKey: null, rejectedIntentKey: m, reason: bad };
  }
  for (const m of matchedIntentKeys) {
    if (expectedIntentKeys.includes(m)) return { accepted: true, matchedIntentKey: m, rejectedIntentKey: null, reason: 'exact' };
  }
  for (const m of matchedIntentKeys) {
    const expected = expectedIntentKeys.find((e) => isAcceptableParaphrase(e, m));
    if (expected) return { accepted: true, matchedIntentKey: m, rejectedIntentKey: null, reason: 'paraphrase' };
  }
  return { accepted: false, matchedIntentKey: null, rejectedIntentKey: null, reason: 'no_match' };
}

/**
 * Evaluate mission objectives from an evaluator output plus any intents matched by
 * speech evaluations during the mission.
 */
export function evaluateMissionObjectives(input: RubricInput, evaluation: EvaluatorOutput, matchedIntentKeys: readonly string[] = []): MissionEvaluation {
  const rejectOptions = { rejectIntentKeys: input.rejectIntentKeys ?? [], requirePolite: input.requirePolite ?? false };
  const rejected = [...new Set(matchedIntentKeys.filter((k) => isInappropriateIntent(k, rejectOptions) !== null))];
  const reported = new Set(evaluation.objectivesCompleted);

  const objectives: ObjectiveEvaluation[] = input.objectives.map((o) => {
    if (reported.has(o.id)) return { id: o.id, required: o.required, completed: true, matchedIntentKeys: [], evidence: 'evaluator_reported' };
    const matches = matchedIntentKeys.filter((m) => !rejected.includes(m) && o.intentKeys.some((e) => isAcceptableParaphrase(e, m)));
    if (matches.length) return { id: o.id, required: o.required, completed: true, matchedIntentKeys: [...new Set(matches)], evidence: 'intent_paraphrase' };
    return { id: o.id, required: o.required, completed: false, matchedIntentKeys: [], evidence: 'none' };
  });

  const required = objectives.filter((o) => o.required);
  const requiredCompleted = required.filter((o) => o.completed).length;
  const completionRatio = required.length ? requiredCompleted / required.length : objectives.length ? objectives.filter((o) => o.completed).length / objectives.length : 0;
  const passed = rejected.length === 0 && requiredCompleted === required.length;
  const outcome: ObservationOutcome = passed ? 'success' : requiredCompleted > 0 || objectives.some((o) => o.completed) ? 'partial' : 'fail';

  return {
    objectives,
    requiredCompleted,
    requiredTotal: required.length,
    completionRatio,
    passed,
    outcome,
    rejectedIntentKeys: rejected,
    summary: sanitizeForMemory(evaluation.summary),
    skillsExercised: [...new Set(evaluation.skillsExercised)],
    reviewTriggers: [...new Set(evaluation.reviewTriggers)],
    confidence: evaluation.confidence,
  };
}

/** Objective ids completed, for branching rules (`all_required_completed` | `partial` | `none`). */
export function branchConditionFor(evaluation: Pick<MissionEvaluation, 'passed' | 'requiredCompleted' | 'objectives'>): 'all_required_completed' | 'partial' | 'none' {
  if (evaluation.passed) return 'all_required_completed';
  return evaluation.requiredCompleted > 0 || evaluation.objectives.some((o) => o.completed) ? 'partial' : 'none';
}
