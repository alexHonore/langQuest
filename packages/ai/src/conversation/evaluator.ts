/**
 * Evaluator / learning planner (§3.7, §8.3): asynchronous structured observations after a turn or checkpoint.
 * Caps priority corrections at two, attaches provenance ids, and converts to `SkillObservationInput`s.
 */
import { EvaluatorOutputSchema, type ConversationContext, type EvaluatorOutput, type SkillObservationInput, type TextReasoner } from '@langquest/contracts';
import { EvaluatorLlmSchema, PROMPT_VERSIONS, buildEvaluatorPrompt, type TurnRecord } from '../prompts/builders';
import { redactPii } from '../util';

export interface EvaluateInput {
  context: ConversationContext;
  transcriptWindow: readonly TurnRecord[];
  conversationSessionId: string;
  /** Known skill keys for this mission (helps the model stay on catalog). */
  skillCatalog?: readonly string[];
  traceId?: string;
}

export interface EvaluatorOptions {
  reasoner: TextReasoner;
  /** Version string stored on observations (`evaluator@<date>/openrouter`). */
  scorerVersion?: string;
}

/** Follows the evaluator prompt version, so a stored observation names the prompt that produced it. */
export const EVALUATOR_SCORER_VERSION = `evaluator@${PROMPT_VERSIONS.evaluator}/openrouter`;

/** Normalise a free-form key into the contract `KeySchema` format. */
export const toSkillKey = (raw: string): string | null => {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/[._]{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  return /^[a-z0-9]+(?:[._][a-z0-9]+)*$/.test(key) ? key : null;
};

export class Evaluator {
  private readonly reasoner: TextReasoner;
  readonly scorerVersion: string;

  constructor(options: EvaluatorOptions) {
    this.reasoner = options.reasoner;
    this.scorerVersion = options.scorerVersion ?? EVALUATOR_SCORER_VERSION;
  }

  async evaluate(input: EvaluateInput): Promise<EvaluatorOutput> {
    const prompt = buildEvaluatorPrompt({ context: input.context, transcriptWindow: input.transcriptWindow, skillCatalog: input.skillCatalog });
    const raw = await this.reasoner.generateStructured('learner_evaluation', input.context.language, prompt, EvaluatorLlmSchema, { traceId: input.traceId });
    return this.finalize(raw, input);
  }

  /** Deterministic post-processing (exported for tests): caps, key sanitising, provenance. */
  finalize(raw: typeof EvaluatorLlmSchema._output, input: EvaluateInput): EvaluatorOutput {
    const knownObjectives = new Set(input.context.objectives.map((o) => o.id));
    const learnerConfidences = input.transcriptWindow.filter((t) => t.role === 'learner').map((t) => t.confidence ?? null);
    const lastConfidence = learnerConfidences.length ? (learnerConfidences[learnerConfidences.length - 1] ?? null) : null;
    const scenarioId = input.context.scenarioId ?? input.context.missionId ?? input.conversationSessionId;
    const skillsExercised = [...new Set(raw.skillsExercised.map(toSkillKey).filter((k): k is string => k !== null))];
    const observations = raw.observations
      .map((o) => {
        const skillKey = toSkillKey(o.skillKey);
        if (!skillKey) return null;
        const lowConfidence = lastConfidence !== null && lastConfidence < 0.35;
        return {
          skillKey,
          observationType: o.observationType,
          scenarioId,
          missionId: input.context.missionId,
          missionAttemptId: null,
          conversationSessionId: input.conversationSessionId,
          expressionId: null,
          autonomy: o.autonomy,
          hintsUsed: o.hintsUsed,
          outcome: lowConfidence && o.outcome === 'fail' ? ('unclear' as const) : o.outcome,
          utteranceConfidence: lastConfidence,
          uncertainty: lowConfidence ? Math.max(o.uncertainty, 0.7) : o.uncertainty,
          note: o.note ? redactPii(o.note).slice(0, 500) : null,
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
    return EvaluatorOutputSchema.parse({
      objectivesCompleted: raw.objectivesCompleted.filter((id) => knownObjectives.size === 0 || knownObjectives.has(id)),
      skillsExercised,
      observations,
      priorityCorrections: raw.priorityCorrections.slice(0, 2).map((c) => ({ ...c, skillKey: c.skillKey ? toSkillKey(c.skillKey) : null, learnerUtterance: redactPii(c.learnerUtterance).slice(0, 300), explanation: c.explanation.slice(0, 500) })),
      summary: redactPii(raw.summary).slice(0, 1500),
      reviewTriggers: [...new Set(raw.reviewTriggers.map(toSkillKey).filter((k): k is string => k !== null))],
      relationshipMemoryUpdate: raw.relationshipMemoryUpdate ? redactPii(raw.relationshipMemoryUpdate).slice(0, 500) : null,
      confidence: raw.confidence,
    });
  }

  /** Convert evaluator observations into `SkillObservationInput` rows for the curriculum/mastery pipeline. */
  toSkillObservations(output: EvaluatorOutput, enrollmentId: string, observedAt: string = new Date().toISOString()): SkillObservationInput[] {
    return output.observations.map((o) => ({ ...o, enrollmentId, scorerKind: 'llm_evaluator' as const, scorerVersion: this.scorerVersion, observedAt }));
  }
}
