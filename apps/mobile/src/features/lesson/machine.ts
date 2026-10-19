/**
 * Lesson player state machine (§3.1, §10.2B screen 4, §14.1 A16).
 *
 * Each mission step moves through phases:
 *   listen → (translate / transcript optional) → anticipate → recording → processing → compare → next
 *
 * Invariants:
 * - Anticipation steps never reveal the model answer before the learner either attempted
 *   (recorded or typed) or chose an explicit reveal (`attemptedBeforeReveal` is recorded).
 * - Hints, replays, slow replays and reveal are counted per step for the evaluator.
 * - Listen/identify steps are answered by choosing an option (no recording).
 * - Typed answers carry a `TextAnswerResult` (meaning check only). They NEVER
 *   produce a `SpeechEvaluationResult`: nothing was heard, so no intelligibility
 *   or pronunciation verdict exists to show (§3.6, ADR-006).
 * - Nothing here touches audio or the network; the screen executes `effects`.
 */
import type { MissionStepType, ObservationOutcome, SpeechEvaluationResult, StepResult } from '@langquest/contracts';

export type LessonPhase = 'listen' | 'anticipate' | 'recording' | 'processing' | 'compare' | 'summary';

/** Outcome of a typed answer: an exact-form meaning check, no speech assessment of any kind. */
export interface TextAnswerResult {
  /** True when the normalised text equals the canonical form or one of its transliterations. */
  semanticIntentMatched: boolean;
  /** The expression form that matched (null when none did). */
  matchedForm: string | null;
  /** What the learner typed. */
  text: string;
}

export interface LessonStepSpec {
  id: string;
  type: MissionStepType;
  /** Steps that need a spoken/typed answer before the reveal. */
  requiresAttemptBeforeReveal: boolean;
  /** Options for listen/identify steps; the correct option id, if any. */
  options: { id: string; label: string }[];
  correctOptionId: string | null;
  hintCount: number;
  /** Whether the step can run without connectivity (deterministic pack). */
  offlineCapable: boolean;
}

export interface LessonStepState {
  stepId: string;
  phase: LessonPhase;
  hintsUsed: number;
  replays: number;
  slowReplays: number;
  translationShown: boolean;
  transcriptShown: boolean;
  /** `true` once the learner recorded or typed before any reveal; `false` when reveal was chosen first. */
  attemptedBeforeReveal: boolean | null;
  revealed: boolean;
  attempts: number;
  typedAnswer: string | null;
  selectedOptionId: string | null;
  lastEvaluation: SpeechEvaluationResult | null;
  /** Last typed-answer check (mutually exclusive with `lastEvaluation` for the latest attempt). */
  lastTextAnswer: TextAnswerResult | null;
  outcome: ObservationOutcome | null;
  startedAt: number;
  speechAssessmentIds: string[];
  error: string | null;
}

export interface LessonState {
  steps: LessonStepSpec[];
  index: number;
  current: LessonStepState;
  completed: StepResult[];
  finished: boolean;
  abandonedAtIndex: number | null;
}

export type LessonEvent =
  | { type: 'replay'; slow: boolean }
  | { type: 'toggle_translation' }
  | { type: 'toggle_transcript' }
  | { type: 'hint' }
  | { type: 'start_anticipate' }
  | { type: 'record_start' }
  | { type: 'record_cancel' }
  | { type: 'record_stop'; durationMs: number }
  | { type: 'type_answer'; text: string }
  | { type: 'evaluated'; result: SpeechEvaluationResult }
  | { type: 'text_evaluated'; result: TextAnswerResult }
  | { type: 'evaluation_failed'; message: string }
  | { type: 'reveal' }
  | { type: 'choose_option'; optionId: string }
  | { type: 'accept' }
  | { type: 'retry' }
  | { type: 'next'; now: number }
  | { type: 'abandon' };

export type LessonEffect =
  | { type: 'play_reference'; slow: boolean }
  | { type: 'stop_audio' }
  | { type: 'start_recording' }
  | { type: 'stop_recording' }
  | { type: 'cancel_recording' }
  | { type: 'evaluate_recording'; stepId: string; durationMs: number }
  | { type: 'evaluate_text'; stepId: string; text: string }
  | { type: 'step_completed'; result: StepResult }
  | { type: 'finished' };

const SPEAKING_STEP_TYPES: readonly MissionStepType[] = ['modeled_expression', 'anticipation', 'shadowing', 'pronunciation_drill', 'feedback_retry', 'review_recall'];

export const isSpeakingStep = (type: MissionStepType): boolean => SPEAKING_STEP_TYPES.includes(type);

function freshStep(step: LessonStepSpec, now: number): LessonStepState {
  return {
    stepId: step.id,
    phase: 'listen',
    hintsUsed: 0,
    replays: 0,
    slowReplays: 0,
    translationShown: false,
    transcriptShown: false,
    attemptedBeforeReveal: null,
    revealed: false,
    attempts: 0,
    typedAnswer: null,
    selectedOptionId: null,
    lastEvaluation: null,
    lastTextAnswer: null,
    outcome: null,
    startedAt: now,
    speechAssessmentIds: [],
    error: null,
  };
}

export function createLesson(steps: LessonStepSpec[], now = 0): LessonState {
  const first = steps[0];
  if (!first) throw new Error('A lesson needs at least one step');
  return { steps, index: 0, current: freshStep(first, now), completed: [], finished: false, abandonedAtIndex: null };
}

function outcomeFromEvaluation(r: SpeechEvaluationResult): ObservationOutcome {
  if (r.intelligibility === 'no_speech_detected') return 'unclear';
  if (r.semanticIntentMatched && r.intelligibility === 'understood') return 'success';
  if (r.semanticIntentMatched || r.intelligibility === 'partially_understood') return 'partial';
  return 'fail';
}

/**
 * A typed answer gives evidence about meaning only. An exact match is a success; anything else is
 * `unclear` because the exact-form check cannot judge a paraphrase and no evaluator was consulted.
 */
function outcomeFromTextAnswer(r: TextAnswerResult): ObservationOutcome {
  return r.semanticIntentMatched ? 'success' : 'unclear';
}

function toResult(state: LessonState, now: number): StepResult {
  const c = state.current;
  const step = state.steps[state.index]!;
  return {
    stepId: c.stepId,
    outcome: c.outcome ?? (c.revealed && c.attempts === 0 ? 'unclear' : 'partial'),
    hintsUsed: c.hintsUsed,
    replays: c.replays + c.slowReplays,
    durationMs: Math.max(0, now - c.startedAt),
    speechAssessmentIds: c.speechAssessmentIds,
    attemptedBeforeReveal: step.requiresAttemptBeforeReveal ? c.attemptedBeforeReveal : null,
    selectedIntentId: c.selectedOptionId,
    conversationSessionId: null,
  };
}

export function reduceLesson(state: LessonState, event: LessonEvent): { state: LessonState; effects: LessonEffect[] } {
  const effects: LessonEffect[] = [];
  if (state.finished) return { state, effects };
  const step = state.steps[state.index]!;
  const c = state.current;
  const set = (patch: Partial<LessonStepState>): LessonState => ({ ...state, current: { ...c, ...patch } });

  switch (event.type) {
    case 'replay':
      effects.push({ type: 'play_reference', slow: event.slow });
      return { state: set(event.slow ? { slowReplays: c.slowReplays + 1 } : { replays: c.replays + 1 }), effects };

    case 'toggle_translation':
      return { state: set({ translationShown: !c.translationShown }), effects };

    case 'toggle_transcript':
      return { state: set({ transcriptShown: !c.transcriptShown }), effects };

    case 'hint':
      if (c.hintsUsed >= step.hintCount) return { state, effects };
      return { state: set({ hintsUsed: c.hintsUsed + 1 }), effects };

    case 'start_anticipate':
      if (c.phase !== 'listen') return { state, effects };
      effects.push({ type: 'stop_audio' });
      return { state: set({ phase: 'anticipate' }), effects };

    case 'record_start':
      if (c.phase !== 'listen' && c.phase !== 'anticipate' && c.phase !== 'compare') return { state, effects };
      effects.push({ type: 'stop_audio' }, { type: 'start_recording' });
      return { state: set({ phase: 'recording', error: null }), effects };

    case 'record_cancel':
      if (c.phase !== 'recording') return { state, effects };
      effects.push({ type: 'cancel_recording' });
      return { state: set({ phase: c.revealed ? 'compare' : 'anticipate' }), effects };

    case 'record_stop':
      if (c.phase !== 'recording') return { state, effects };
      effects.push({ type: 'stop_recording' }, { type: 'evaluate_recording', stepId: step.id, durationMs: event.durationMs });
      return { state: set({ phase: 'processing', attempts: c.attempts + 1, attemptedBeforeReveal: c.attemptedBeforeReveal ?? !c.revealed }), effects };

    case 'type_answer': {
      const text = event.text.trim();
      if (text.length === 0 || c.phase === 'processing') return { state, effects };
      effects.push({ type: 'evaluate_text', stepId: step.id, text });
      return { state: set({ phase: 'processing', typedAnswer: text, attempts: c.attempts + 1, attemptedBeforeReveal: c.attemptedBeforeReveal ?? !c.revealed }), effects };
    }

    case 'evaluated':
      if (c.phase !== 'processing') return { state, effects };
      return {
        state: set({
          phase: 'compare',
          revealed: true,
          lastEvaluation: event.result,
          lastTextAnswer: null,
          outcome: outcomeFromEvaluation(event.result),
          speechAssessmentIds: [...c.speechAssessmentIds, event.result.assessmentId],
          error: null,
        }),
        effects,
      };

    case 'text_evaluated':
      if (c.phase !== 'processing') return { state, effects };
      // No assessment id is recorded: no speech assessment happened.
      return { state: set({ phase: 'compare', revealed: true, lastEvaluation: null, lastTextAnswer: event.result, outcome: outcomeFromTextAnswer(event.result), error: null }), effects };

    case 'evaluation_failed':
      if (c.phase !== 'processing') return { state, effects };
      // Honest state: the attempt counts, but no result is invented.
      return { state: set({ phase: c.revealed ? 'compare' : 'anticipate', error: event.message }), effects };

    case 'reveal':
      if (c.phase === 'recording' || c.phase === 'processing') return { state, effects };
      return { state: set({ phase: 'compare', revealed: true, attemptedBeforeReveal: c.attemptedBeforeReveal ?? c.attempts > 0 }), effects };

    case 'choose_option': {
      if (step.options.length === 0 || c.phase === 'compare') return { state, effects };
      const correct = step.correctOptionId === null ? null : step.correctOptionId === event.optionId;
      return {
        state: set({ phase: 'compare', revealed: true, selectedOptionId: event.optionId, attempts: c.attempts + 1, attemptedBeforeReveal: true, outcome: correct === null ? 'unclear' : correct ? 'success' : 'fail' }),
        effects,
      };
    }

    case 'accept':
      if (c.phase !== 'compare') return { state, effects };
      return { state: set({ outcome: c.outcome ?? 'partial' }), effects };

    case 'retry':
      if (c.phase !== 'compare') return { state, effects };
      return { state: set({ phase: 'anticipate', error: null }), effects };

    case 'next': {
      if (c.phase === 'recording' || c.phase === 'processing') return { state, effects };
      if (step.requiresAttemptBeforeReveal && !c.revealed && c.attempts === 0) return { state, effects };
      const result = toResult(state, event.now);
      effects.push({ type: 'step_completed', result });
      const completed = [...state.completed, result];
      const nextIndex = state.index + 1;
      const nextStep = state.steps[nextIndex];
      if (!nextStep) {
        effects.push({ type: 'finished' });
        return { state: { ...state, completed, finished: true, current: { ...c, phase: 'summary' } }, effects };
      }
      return { state: { ...state, completed, index: nextIndex, current: freshStep(nextStep, event.now) }, effects };
    }

    case 'abandon':
      effects.push({ type: 'stop_audio' });
      if (c.phase === 'recording') effects.push({ type: 'cancel_recording' });
      return { state: { ...state, finished: true, abandonedAtIndex: state.index }, effects };
  }
}

/** UI phase label mapping for `LessonProgress` from `@langquest/ui`. */
export function uiPhase(phase: LessonPhase): 'listen' | 'anticipate' | 'speak' | 'compare' | 'review' | 'summary' {
  switch (phase) {
    case 'recording':
    case 'processing':
      return 'speak';
    case 'summary':
      return 'summary';
    default:
      return phase;
  }
}
