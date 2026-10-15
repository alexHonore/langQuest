import { describe, expect, it } from 'vitest';
import { EvaluatorOutputSchema } from '@langquest/contracts';
import { MemoryQualityIncidentSink, LanguageGuard } from '../prompts/language-guard';
import { FakeReasoner, SESSION_ID, conversationContext, persona } from '../test-support/fakes';
import { CharacterAgent } from './character-agent';
import { Evaluator, toSkillKey } from './evaluator';
import { SessionSummariser, fallbackTurnSummary } from './summariser';

const gen = (text: string, extra: Record<string, unknown> = {}) => ({ text, transliteration: null, sourceGloss: 'Bonjour, ça va ?', expression: 'greeting', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false, ...extra });

describe('CharacterAgent', () => {
  it('generates an in-dialect turn with compact context and source-language coaching instruction', async () => {
    const reasoner = new FakeReasoner().on('character_dialogue', gen('صباح الخير! واش بغيتي قهوة؟'));
    const agent = new CharacterAgent({ reasoner, guard: new LanguageGuard() });
    const res = await agent.respond({ context: conversationContext('arabic-moroccan', 'fr'), persona, learnerInput: { kind: 'text', text: 'سلام' }, lastCharacterText: null });
    expect(res.turn.text).toBe('صباح الخير! واش بغيتي قهوة؟');
    expect(res.turn.characterId).toBe(persona.id);
    expect(res.usedRecoveryLine).toBe(false);
    expect(res.guard?.ok).toBe(true);
    const call = reasoner.calls[0]!;
    expect(call.task).toBe('character_dialogue');
    expect(call.prompt.system).toMatch(/NEVER answer in Modern Standard Arabic/);
    expect(call.prompt.system).toMatch(/French \(Français, code fr\)/);
    expect(call.prompt.user).toContain('numbers.prices');
    expect(call.prompt.user).toContain('Learner just said: """سلام"""');
    expect(call.prompt.user.length).toBeLessThan(2500);
  });

  it('re-prompts once when the guard rejects MSA for a Darija course, then falls back to the recovery line + incident', async () => {
    const incidents = new MemoryQualityIncidentSink();
    const msa = 'هل تريد أن تشرب القهوة؟ ماذا تفضل؟ لماذا لا؟';
    const reasoner = new FakeReasoner().on('character_dialogue', gen(msa)).on('character_dialogue', gen(msa));
    const agent = new CharacterAgent({ reasoner, guard: new LanguageGuard({ incidents }) });
    const res = await agent.respond({ context: conversationContext('arabic-moroccan'), persona, learnerInput: { kind: 'text', text: 'سلام' }, lastCharacterText: null });
    expect(reasoner.calls).toHaveLength(2);
    expect(reasoner.calls[1]?.prompt.user).toMatch(/rejected by the language guard/);
    expect(res.usedRecoveryLine).toBe(true);
    expect(res.turn.text).toBe('سمح ليا، ماسمعتكش مزيان. عاود عافاك؟');
    expect(res.turn.expression).toBe('confusion');
    expect(incidents.incidents.length).toBeGreaterThanOrEqual(2);
    expect(incidents.incidents[0]).toMatchObject({ kind: 'wrong_variety', varietyId: 'ary', task: 'character_dialogue' });
  });

  it('accepts the repaired second attempt', async () => {
    const reasoner = new FakeReasoner().on('character_dialogue', gen('Je voudrais un café, s’il vous plaît.')).on('character_dialogue', gen('Bonjou! Kijan ou ye jodi a? Ou vle yon kafe?'));
    const agent = new CharacterAgent({ reasoner });
    const res = await agent.respond({ context: conversationContext('haitian-creole', 'fr'), persona: { ...persona, name: 'Mari', region: 'Port-au-Prince' }, learnerInput: null, lastCharacterText: null });
    expect(res.turn.text).toMatch(/^Bonjou/);
    expect(res.usedRecoveryLine).toBe(false);
  });

  it('handles slower/repeat without an LLM call and marks the playback rate', async () => {
    const reasoner = new FakeReasoner();
    const agent = new CharacterAgent({ reasoner });
    const slower = await agent.respond({ context: conversationContext('french'), persona, learnerInput: { kind: 'command', command: 'slower' }, lastCharacterText: 'Bonjour, vous désirez ?' });
    expect(slower.turn.text).toBe('Bonjour, vous désirez ?');
    expect(slower.turn.respondsToCommand).toBe('slower');
    expect(slower.playbackRate).toBe(0.75);
    const repeat = await agent.respond({ context: conversationContext('french'), persona, learnerInput: { kind: 'command', command: 'repeat' }, lastCharacterText: null });
    expect(repeat.usedRecoveryLine).toBe(true);
    expect(reasoner.calls).toHaveLength(0);
  });

  it('answers translate / meaning / example / hint through source_explanation in the source language', async () => {
    const reasoner = new FakeReasoner()
      .on('source_explanation', { explanation: 'Elle demande si tu veux un café.', example: null })
      .on('source_explanation', { explanation: 'Tu pourrais dire :', example: { target: 'بغيت واحد القهوة عافاك', transliteration: 'bghit wa7ed l9ahwa 3afak', gloss: 'Je voudrais un café, s’il te plaît' } });
    const agent = new CharacterAgent({ reasoner });
    const ctx = conversationContext('arabic-moroccan', 'fr');
    const tr = await agent.respond({ context: ctx, persona, learnerInput: { kind: 'command', command: 'translate' }, lastCharacterText: 'واش بغيتي قهوة؟' });
    expect(tr.turn.text).toBe('واش بغيتي قهوة؟');
    expect(tr.turn.sourceGloss).toBe('Elle demande si tu veux un café.');
    expect(tr.turn.respondsToCommand).toBe('translate');
    expect(reasoner.calls[0]?.prompt.system).toMatch(/MUST be written in French/);
    const hint = await agent.respond({ context: ctx, persona, learnerInput: { kind: 'command', command: 'hint' }, lastCharacterText: 'واش بغيتي قهوة؟' });
    expect(hint.turn.text).toBe('بغيت واحد القهوة عافاك');
    expect(hint.turn.transliteration).toBe('bghit wa7ed l9ahwa 3afak');
    expect(hint.turn.respondsToCommand).toBe('hint');
  });

  it('skip moves the scene forward and audio turns without transcripts are rejected', async () => {
    const reasoner = new FakeReasoner().on('character_dialogue', gen('Vale, pasemos a otra cosa. ¿Qué tomas?', { respondsToCommand: null }));
    const agent = new CharacterAgent({ reasoner });
    const skip = await agent.respond({ context: conversationContext('spanish-spain', 'en'), persona, learnerInput: { kind: 'command', command: 'skip' }, lastCharacterText: '¿Cuánto es?' });
    expect(skip.turn.respondsToCommand).toBe('skip');
    expect(reasoner.calls[0]?.prompt.user).toMatch(/skip the current objective/);
    await expect(agent.respond({ context: conversationContext('french'), persona, learnerInput: { kind: 'audio', assetId: '55555555-5555-4555-8555-555555555555', durationMs: 1000, transcriptHint: null }, lastCharacterText: null })).rejects.toThrow(/transcribed/);
  });
});

describe('Evaluator', () => {
  const raw = {
    objectivesCompleted: ['greet', 'nonexistent'],
    skillsExercised: ['Greetings Basic', 'ordering.cafe', '???'],
    observations: [
      { skillKey: 'greetings.basic', observationType: 'semantic_success', autonomy: 'unaided', hintsUsed: 0, outcome: 'success', uncertainty: 0.1, note: 'Greeted naturally; mail me at a@b.co' },
      { skillKey: 'ordering.cafe', observationType: 'spoken_production', autonomy: 'hinted', hintsUsed: 1, outcome: 'fail', uncertainty: 0.3, note: null },
    ],
    priorityCorrections: [
      { skillKey: 'ordering.cafe', learnerUtterance: 'أريد قهوة', suggestedUtterance: 'بغيت قهوة', explanation: 'En Darija on dit « bghit », pas « ouridou ».', category: 'vocabulary' },
      { skillKey: null, learnerUtterance: 'x', suggestedUtterance: 'y', explanation: 'z', category: 'register' },
    ],
    summary: 'Commande réussie. Appelle-moi au 06 12 34 56 78.',
    reviewTriggers: ['ordering.cafe'],
    relationshipMemoryUpdate: 'Likes cardamom coffee.',
    confidence: 0.8,
  };

  it('produces a valid EvaluatorOutput with provenance, sanitised keys, PII redaction and ≤2 corrections', async () => {
    const reasoner = new FakeReasoner().on('learner_evaluation', raw);
    const evaluator = new Evaluator({ reasoner });
    const ctx = conversationContext('arabic-moroccan', 'fr');
    const out = await evaluator.evaluate({ context: ctx, transcriptWindow: [{ role: 'character', text: 'واش بغيتي قهوة؟' }, { role: 'learner', text: 'أريد قهوة', confidence: 0.9 }], conversationSessionId: SESSION_ID });
    expect(() => EvaluatorOutputSchema.parse(out)).not.toThrow();
    expect(out.objectivesCompleted).toEqual(['greet']);
    expect(out.skillsExercised).toEqual(['greetings_basic', 'ordering.cafe']);
    expect(out.observations[0]).toMatchObject({ skillKey: 'greetings.basic', conversationSessionId: SESSION_ID, scenarioId: SESSION_ID, utteranceConfidence: 0.9, note: 'Greeted naturally; mail me at [email]' });
    expect(out.priorityCorrections).toHaveLength(2);
    expect(out.summary).toContain('[number]');
    expect(reasoner.calls[0]?.prompt.system).toMatch(/at most TWO priority corrections/i);
    const rows = evaluator.toSkillObservations(out, ctx.language.enrollmentId);
    expect(rows[0]).toMatchObject({ enrollmentId: ctx.language.enrollmentId, scorerKind: 'llm_evaluator', scorerVersion: evaluator.scorerVersion });
  });

  it('never penalises a low-confidence transcript (§15)', () => {
    const evaluator = new Evaluator({ reasoner: new FakeReasoner() });
    const out = evaluator.finalize(raw as never, { context: conversationContext('french'), transcriptWindow: [{ role: 'learner', text: 'mumble', confidence: 0.2 }], conversationSessionId: SESSION_ID });
    expect(out.observations[1]).toMatchObject({ outcome: 'unclear', uncertainty: 0.7 });
  });

  it('normalises skill keys', () => {
    expect(toSkillKey('Greetings Basic')).toBe('greetings_basic');
    expect(toSkillKey('ordering.cafe')).toBe('ordering.cafe');
    expect(toSkillKey('--')).toBeNull();
  });
});

describe('SessionSummariser', () => {
  it('returns sanitised, length-capped summaries and a deterministic fallback', async () => {
    const reasoner = new FakeReasoner().on('learner_evaluation', { turnSummary: 'Au café. '.repeat(200), persistedSummary: 'Bonne commande. Contact: a@b.co', relationshipMemoryUpdate: 'Call 0612345678' });
    const s = await new SessionSummariser(reasoner).summarise({ context: conversationContext('french'), previousTurnSummary: null, turns: [{ role: 'learner', text: 'bonjour' }] });
    expect(s.turnSummary.length).toBeLessThanOrEqual(2000);
    expect(s.persistedSummary).toBe('Bonne commande. Contact: [email]');
    expect(s.relationshipMemoryUpdate).toBe('Call [number]');
    expect(fallbackTurnSummary(null, [{ role: 'learner', text: 'bonjour' }, { role: 'character', text: 'salut 0612345678' }])).toBe('L: bonjour | C: salut [number]');
    const empty = await new SessionSummariser(reasoner).summarise({ context: conversationContext('french'), previousTurnSummary: 'x', turns: [] });
    expect(empty.turnSummary).toBe('x');
  });
});
