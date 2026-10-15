import type { SpeechEvaluationResult } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { createLesson, reduceLesson, type LessonState, type LessonStepSpec } from './machine';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const anticipation: LessonStepSpec = { id: uuid(1), type: 'anticipation', requiresAttemptBeforeReveal: true, options: [], correctOptionId: null, hintCount: 2, offlineCapable: false };
const listenIdentify: LessonStepSpec = { id: uuid(2), type: 'listen_identify', requiresAttemptBeforeReveal: false, options: [{ id: 'a', label: 'A coffee' }, { id: 'b', label: 'The bill' }], correctOptionId: 'a', hintCount: 0, offlineCapable: true };

const evaluation = (over: Partial<SpeechEvaluationResult> = {}): SpeechEvaluationResult => ({
  assessmentId: uuid(50),
  targetVarietyId: 'es-ES',
  semanticIntentMatched: true,
  meaningConfidence: 0.9,
  intelligibility: 'understood',
  pronunciation: { assessmentMode: 'reference-comparison', numericScore: null, confidence: 'limited', feedback: [], featuresAssessed: [], wordScores: [], phonemeHints: [], toneHints: [], highlightedSegment: null, provider: null, scorerVersion: null },
  shouldAdvanceConversation: true,
  transcript: 'un café por favor',
  matchedIntentIds: ['request_a_drink'],
  ...over,
});

function run(state: LessonState, ...events: Parameters<typeof reduceLesson>[1][]) {
  let s = state;
  const effects: ReturnType<typeof reduceLesson>['effects'] = [];
  for (const e of events) {
    const r = reduceLesson(s, e);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

describe('lesson machine', () => {
  it('requires an attempt (or explicit reveal) before the model answer on anticipation steps (A16)', () => {
    const start = createLesson([anticipation, listenIdentify]);
    // "next" without attempting or revealing is ignored
    expect(run(start, { type: 'next', now: 10 }).state.index).toBe(0);
    // explicit reveal records attemptedBeforeReveal = false
    const revealed = run(start, { type: 'start_anticipate' }, { type: 'reveal' });
    expect(revealed.state.current.phase).toBe('compare');
    expect(revealed.state.current.attemptedBeforeReveal).toBe(false);
    const advanced = run(revealed.state, { type: 'next', now: 5000 });
    expect(advanced.effects.find((e) => e.type === 'step_completed')).toMatchObject({ result: { stepId: anticipation.id, attemptedBeforeReveal: false, outcome: 'unclear' } });
  });

  it('records → processes → compares and counts hints, replays and assessment ids', () => {
    const start = createLesson([anticipation]);
    const r = run(start, { type: 'replay', slow: false }, { type: 'replay', slow: true }, { type: 'hint' }, { type: 'hint' }, { type: 'hint' }, { type: 'start_anticipate' }, { type: 'record_start' }, { type: 'record_stop', durationMs: 1800 });
    expect(r.state.current.phase).toBe('processing');
    expect(r.state.current.hintsUsed).toBe(2);
    expect(r.state.current.attemptedBeforeReveal).toBe(true);
    expect(r.effects.map((e) => e.type)).toContain('evaluate_recording');
    const done = run(r.state, { type: 'evaluated', result: evaluation() }, { type: 'next', now: 9000 });
    const completed = done.effects.find((e) => e.type === 'step_completed');
    expect(completed).toMatchObject({ result: { outcome: 'success', hintsUsed: 2, replays: 2, speechAssessmentIds: [uuid(50)], attemptedBeforeReveal: true } });
    expect(done.state.finished).toBe(true);
    expect(done.effects.at(-1)?.type).toBe('finished');
  });

  it('never fabricates a result when evaluation fails and allows retry', () => {
    const start = createLesson([anticipation]);
    const r = run(start, { type: 'record_start' }, { type: 'record_stop', durationMs: 900 }, { type: 'evaluation_failed', message: 'offline' });
    expect(r.state.current.phase).toBe('anticipate');
    expect(r.state.current.lastEvaluation).toBeNull();
    expect(r.state.current.error).toBe('offline');
    expect(r.state.current.attempts).toBe(1);
    const again = run(r.state, { type: 'record_start' }, { type: 'record_stop', durationMs: 1200 }, { type: 'evaluated', result: evaluation({ semanticIntentMatched: false, intelligibility: 'partially_understood' }) });
    expect(again.state.current.outcome).toBe('partial');
  });

  it('answers listen/identify steps by choosing an option', () => {
    const start = createLesson([listenIdentify]);
    const wrong = run(start, { type: 'choose_option', optionId: 'b' });
    expect(wrong.state.current.outcome).toBe('fail');
    expect(wrong.state.current.selectedOptionId).toBe('b');
    const right = run(createLesson([listenIdentify]), { type: 'choose_option', optionId: 'a' }, { type: 'next', now: 100 });
    expect(right.effects.find((e) => e.type === 'step_completed')).toMatchObject({ result: { outcome: 'success', selectedIntentId: 'a', attemptedBeforeReveal: null } });
  });

  it('typed answers count as attempts (text alternative never required to speak)', () => {
    const r = run(createLesson([anticipation]), { type: 'type_answer', text: '  un café  ' });
    expect(r.effects).toContainEqual({ type: 'evaluate_text', stepId: anticipation.id, text: 'un café' });
    expect(r.state.current.attemptedBeforeReveal).toBe(true);
  });

  it('abandon stops audio/recording and marks the index', () => {
    const r = run(createLesson([anticipation, listenIdentify]), { type: 'record_start' }, { type: 'abandon' });
    expect(r.state.finished).toBe(true);
    expect(r.state.abandonedAtIndex).toBe(0);
    expect(r.effects.map((e) => e.type)).toEqual(['stop_audio', 'start_recording', 'stop_audio', 'cancel_recording']);
  });
});
