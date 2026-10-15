import { describe, expect, it } from 'vitest';
import { CONVERSATION_STATE_VALUES } from '../enums';
import { unsupportedCapability } from './capability';
import { CONVERSATION_TRANSITIONS, ConversationEventSchema, EvaluatorOutputSchema, canTransition } from './conversation';
import { ModelProfileSchema, modelProfileSpecificity } from './model-profile';

const uuid = '8f4b6c1e-1f3a-4c0b-9a7d-5e6f7a8b9c0d';
const at = '2026-10-14T10:00:00.000Z';

describe('conversation state machine (§8.3)', () => {
  it('covers every state and keeps finished terminal', () => {
    for (const state of CONVERSATION_STATE_VALUES) expect(CONVERSATION_TRANSITIONS[state]).toBeDefined();
    expect(CONVERSATION_TRANSITIONS.finished).toEqual([]);
  });

  it('allows the happy path and barge-in, forbids nonsense', () => {
    expect(canTransition('preparing', 'connecting')).toBe(true);
    expect(canTransition('connecting', 'listening')).toBe(true);
    expect(canTransition('listening', 'speech_detected')).toBe(true);
    expect(canTransition('speech_detected', 'interpreting')).toBe(true);
    expect(canTransition('interpreting', 'responding')).toBe(true);
    expect(canTransition('responding', 'listening')).toBe(true);
    expect(canTransition('responding', 'interrupted')).toBe(true);
    expect(canTransition('interrupted', 'speech_detected')).toBe(true);
    expect(canTransition('recoverable_error', 'connecting')).toBe(true);
    expect(canTransition('finished', 'listening')).toBe(false);
    expect(canTransition('preparing', 'responding')).toBe(false);
  });

  it('runtime events discriminate on type', () => {
    const ev = ConversationEventSchema.parse({ sessionId: uuid, at, seq: 1, type: 'barge_in', interruptedTurnId: uuid });
    expect(ev.type).toBe('barge_in');
    expect(ConversationEventSchema.safeParse({ sessionId: uuid, at, seq: 1, type: 'barge_in' }).success).toBe(false);
  });
});

describe('evaluator output', () => {
  const correction = { skillKey: 'ask_price', learnerUtterance: 'bshhal hada', suggestedUtterance: 'bshhal hada?', explanation: 'Intonation montante.', category: 'fluency' };
  const base = { objectivesCompleted: ['greet'], skillsExercised: ['greet_politely'], observations: [], priorityCorrections: [correction, correction], summary: 'Commande au café réussie.', reviewTriggers: [], relationshipMemoryUpdate: null, confidence: 0.8 };

  it('allows at most two priority corrections (§3.6)', () => {
    expect(EvaluatorOutputSchema.safeParse(base).success).toBe(true);
    expect(EvaluatorOutputSchema.safeParse({ ...base, priorityCorrections: [correction, correction, correction] }).success).toBe(false);
  });
});

describe('model profiles and capabilities', () => {
  it('resolves specificity for task × variety × source', () => {
    expect(modelProfileSpecificity({ targetVariety: 'ary', sourceLanguage: 'fr' })).toBe(3);
    expect(modelProfileSpecificity({ targetVariety: 'ary', sourceLanguage: null })).toBe(2);
    expect(modelProfileSpecificity({ targetVariety: null, sourceLanguage: 'fr' })).toBe(1);
    expect(modelProfileSpecificity({ targetVariety: null, sourceLanguage: null })).toBe(0);
  });

  it('validates a profile without secrets', () => {
    const profile = ModelProfileSchema.safeParse({
      id: uuid, task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr', provider: 'openrouter', primaryModel: 'vendor/model-a', fallbackModels: ['vendor/model-b'],
      params: { temperature: 0.7, timeoutMs: 8000 }, latencyClass: 'interactive', enabled: true, version: 3, benchmarkStatus: 'passing', dailyBudgetUsd: 50, updatedAt: at,
    });
    expect(profile.success).toBe(true);
  });

  it('unsupportedCapability has no features and carries reasons', () => {
    const cap = unsupportedCapability('azure_speech', ['locale_unsupported']);
    expect(cap.supported).toBe(false);
    expect(cap.features.phoneme).toBe(false);
    expect(cap.reasons).toEqual(['locale_unsupported']);
  });
});
