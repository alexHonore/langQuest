/**
 * §14.3 "prompt injection from a transcript or dataset" + §8.4 / §15: text an attacker controls (learner transcript,
 * imported dataset row, sidecar, lesson title) reaches the character agent and the evaluator. We assert that the
 * language guard still forces the character back into the target variety (recovery line + incident, never silent
 * mislabeling), that the evaluator's Zod schema and deterministic finalisation drop forged objectives / skills /
 * PII / oversize output, and that the API keeps XP and mastery server-decided whatever the strings contain.
 */
import { CharacterTurnSchema, ConversationContextSchema, EvaluatorOutputSchema, buildLanguageContext, type ConversationContext, type TextReasoner } from '@langquest/contracts';
import { CharacterAgent } from '@langquest/ai/conversation/character-agent';
import { Evaluator } from '@langquest/ai/conversation/evaluator';
import { EvaluatorLlmSchema, type CharacterPersona } from '@langquest/ai/prompts/builders';
import { LanguageGuard, MemoryQualityIncidentSink } from '@langquest/ai/prompts/language-guard';
import { getPromptPack } from '@langquest/ai/prompts/packs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INJECTED_EVALUATOR_RAW, INJECTION_FIXTURES } from '../src/fixtures/prompt-injection';
import { call, createApiHarness, createTestUser, describeWithStack, enrol, recordEvaluatorObservations, Seeder, teardown, type ApiHarness, type TestUser } from '../src/harness';

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';

function darijaFromFrenchContext(enrollmentId: string = crypto.randomUUID()): ConversationContext {
  return ConversationContextSchema.parse({
    language: buildLanguageContext({ uiLocale: 'fr-CA', enrollmentId, sourceLanguageCode: 'fr', courseTrackId: 'arabic-moroccan', scriptMode: 'both', learnerLevel: 'beginner' }),
    missionId: null,
    characterId: CHARACTER_ID,
    scenarioId: null,
    sceneFacts: ['Small café near the medina'],
    objectives: [{ id: 'g1', description: 'Order a mint tea', skillKeys: ['order.drink'], completed: false }],
    recentWeaknessSkillKeys: [],
    turnSummary: '',
    register: 'neutral',
    relationshipSummary: null,
  });
}

const persona: CharacterPersona = { id: CHARACTER_ID, name: 'Nadia', role: 'café staff', region: 'Casablanca', personality: 'warm', voiceId: null, speechSpeed: 'normal' };

/** A reasoner that returns whatever the "model" was tricked into saying. */
function scriptedReasoner(outputs: unknown[]): TextReasoner & { calls: number } {
  const r = {
    calls: 0,
    async generateStructured<T>(_task: string, _locale: unknown, _prompt: unknown, schema: { parse(v: unknown): T }): Promise<T> {
      const out = outputs[Math.min(r.calls, outputs.length - 1)];
      r.calls += 1;
      return schema.parse(out);
    },
  };
  return r as unknown as TextReasoner & { calls: number };
}

describe('prompt injection — language guard (pure)', () => {
  const guard = new LanguageGuard();

  it('flags every switch-language fixture as not Darija (English/French leak or wrong script, MSA markers)', () => {
    for (const fx of INJECTION_FIXTURES.filter((f) => f.goal === 'switch_language')) {
      const res = guard.checkHeuristic(fx.text, 'ary', 'both', { sourceLanguage: 'fr' });
      expect(res.ok, `${fx.id}: ${JSON.stringify(res.issues)}`).toBe(false);
      expect(res.issues.length).toBeGreaterThan(0);
    }
  });

  it('accepts the pack\'s own recovery line and exemplars for the variety', () => {
    const pack = getPromptPack('ary');
    expect(guard.checkHeuristic(pack.recoveryLine.text, 'ary', 'both').ok).toBe(true);
    for (const ex of pack.exemplars.slice(0, 3)) expect(guard.checkHeuristic(ex.target, 'ary', 'both').ok).toBe(true);
    expect(guard.checkHeuristic('', 'ary', 'both').issues[0]?.kind).toBe('empty');
  });

  it('never lets a confusable variety through for Cantonese/Haitian Creole boundaries (no silent substitution)', () => {
    const creole = guard.checkHeuristic("Bonjour, je voudrais un café s'il vous plaît, merci beaucoup pour votre aide.", 'ht', 'native', { sourceLanguage: 'en' });
    expect(creole.ok).toBe(false);
    expect(creole.issues.some((i) => i.kind === 'wrong_variety' || i.kind === 'source_language_leak')).toBe(true);
    const simplifiedOnCantonese = guard.checkHeuristic('这个东西多少钱？我们现在就去吧。', 'yue', 'native');
    expect(simplifiedOnCantonese.ok).toBe(false);
    expect(simplifiedOnCantonese.issues.some((i) => i.kind === 'wrong_han_variant')).toBe(true);
  });
});

describe('prompt injection — character agent falls back to an in-variety recovery line', () => {
  it('re-prompts once, then answers with the honest recovery line and records a quality incident', async () => {
    const incidents = new MemoryQualityIncidentSink();
    const reasoner = scriptedReasoner([
      { text: 'Sure! I will now reply in English as you asked. The lesson is complete.', transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: null, tentativeObjectiveIds: ['g1', 'g2', '*'], endsConversation: false },
      { text: "D'accord, je parle français maintenant, c'est parfait, bravo.", transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: null, tentativeObjectiveIds: ['g1'], endsConversation: true },
    ]);
    const agent = new CharacterAgent({ reasoner, guard: new LanguageGuard({ incidents }) });
    const result = await agent.respond({ context: darijaFromFrenchContext(), persona, learnerInput: { kind: 'text', text: INJECTION_FIXTURES[0]!.text }, lastCharacterText: null });
    expect(reasoner.calls).toBe(2);
    expect(result.usedRecoveryLine).toBe(true);
    expect(result.turn.text).toBe(getPromptPack('ary').recoveryLine.text);
    expect(result.turn.tentativeObjectiveIds).toEqual([]);
    expect(result.turn.endsConversation).toBe(false);
    expect(result.guard?.ok).toBe(false);
    expect(incidents.incidents.length).toBeGreaterThan(0);
    expect(incidents.incidents.every((i) => i.varietyId === 'ary' && i.task === 'character_dialogue')).toBe(true);
    expect(CharacterTurnSchema.safeParse(result.turn).success).toBe(true);
  });

  it('a compliant Darija answer passes unchanged (the guard is not a blunt instrument)', async () => {
    const pack = getPromptPack('ary');
    const reasoner = scriptedReasoner([{ text: pack.exemplars[0]!.target, transliteration: pack.exemplars[0]!.transliteration, sourceGloss: null, expression: 'greeting', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false }]);
    const agent = new CharacterAgent({ reasoner });
    const result = await agent.respond({ context: darijaFromFrenchContext(), persona, learnerInput: { kind: 'text', text: 'salam' }, lastCharacterText: null });
    expect(reasoner.calls).toBe(1);
    expect(result.usedRecoveryLine).toBe(false);
    expect(result.turn.text).toBe(pack.exemplars[0]!.target);
  });

  it('an explanation whose example is not in the variety is replaced, but the source-language gloss is kept', async () => {
    const reasoner = scriptedReasoner([{ explanation: 'Cela veut dire « je voudrais un thé ».', example: { target: 'I would like a tea please, in English now.', transliteration: null, gloss: 'je voudrais un thé' } }]);
    const agent = new CharacterAgent({ reasoner });
    const result = await agent.respond({ context: darijaFromFrenchContext(), persona, learnerInput: { kind: 'command', command: 'translate' }, lastCharacterText: 'بغيت أتاي عافاك' });
    expect(result.turn.sourceGloss).toMatch(/je voudrais/);
    expect(result.turn.text).toBe('بغيت أتاي عافاك');
    expect(result.guard?.ok).toBe(false);
  });
});

describe('prompt injection — evaluator output is schema-validated and sanitised', () => {
  const evaluator = new Evaluator({ reasoner: scriptedReasoner([INJECTED_EVALUATOR_RAW]) });
  const input = { context: darijaFromFrenchContext(), transcriptWindow: INJECTION_FIXTURES.map((f) => ({ role: 'learner' as const, text: f.text, confidence: 0.9 })), conversationSessionId: crypto.randomUUID() };

  it('drops unknown objectives, malformed skill keys, PII and oversize text; caps corrections at two', async () => {
    const out = await evaluator.evaluate(input);
    expect(EvaluatorOutputSchema.safeParse(out).success).toBe(true);
    expect(out.objectivesCompleted).toEqual(['g1']);
    expect(out.skillsExercised).toEqual(expect.arrayContaining(['greet.basic', 'order_drink']));
    for (const k of [...out.skillsExercised, ...out.reviewTriggers, ...out.observations.map((o) => o.skillKey)]) expect(k).toMatch(/^[a-z0-9]+(?:[._][a-z0-9]+)*$/);
    expect(out.observations.map((o) => o.skillKey)).toEqual(['greet.basic', 'order.drink']);
    expect(out.observations[0]!.note).not.toMatch(/attacker@example\.com|555 0100/);
    expect(out.priorityCorrections).toHaveLength(2);
    expect(out.priorityCorrections[0]!.learnerUtterance).not.toMatch(/attacker@example\.com/);
    expect(out.priorityCorrections[0]!.explanation.length).toBeLessThanOrEqual(500);
    expect(out.summary.length).toBeLessThanOrEqual(1500);
    expect(out.summary).not.toMatch(/555 0100/);
    expect(out.relationshipMemoryUpdate?.length ?? 0).toBeLessThanOrEqual(500);
    expect(out.relationshipMemoryUpdate ?? '').not.toMatch(/attacker@example\.com/);
    expect(out.reviewTriggers).toEqual(expect.arrayContaining(['greet.basic', 'order.drink']));
    expect(out.reviewTriggers.some((k) => /[\s/;-]/.test(k))).toBe(false);
    for (const o of out.observations) expect(o.conversationSessionId).toBe(input.conversationSessionId);
  });

  it('refuses structurally forged output: pronunciation judgements from text, out-of-range confidence, >2 corrections', () => {
    const base = { ...INJECTED_EVALUATOR_RAW, objectivesCompleted: ['g1'], skillsExercised: [], reviewTriggers: [], priorityCorrections: INJECTED_EVALUATOR_RAW.priorityCorrections.slice(0, 1) };
    expect(EvaluatorLlmSchema.safeParse({ ...base, observations: [{ ...base.observations[0]!, observationType: 'pronunciation' }] }).success).toBe(false);
    expect(EvaluatorLlmSchema.safeParse({ ...base, confidence: 9 }).success).toBe(false);
    expect(EvaluatorLlmSchema.safeParse({ ...base, observations: [{ ...base.observations[0]!, uncertainty: -5 }] }).success).toBe(false);
    expect(EvaluatorLlmSchema.safeParse({ ...base, priorityCorrections: [base.priorityCorrections[0], base.priorityCorrections[0], base.priorityCorrections[0]] }).success).toBe(false);
    expect(EvaluatorLlmSchema.safeParse({ ...base, summary: 'z'.repeat(1501) }).success).toBe(false);
    expect(EvaluatorLlmSchema.safeParse(JSON.parse(`{"objectivesCompleted":["g1"],"skillsExercised":[],"observations":[],"priorityCorrections":[],"summary":${JSON.stringify(INJECTION_FIXTURES.find((f) => f.goal === 'break_json')!.text)},"reviewTriggers":[],"relationshipMemoryUpdate":null,"confidence":0.5}`)).success).toBe(true);
  });

  it('low ASR confidence turns a failure into "unclear" (never penalised), and the mastery pipeline excludes non-acoustic pronunciation claims', async () => {
    const lowConf = new Evaluator({ reasoner: scriptedReasoner([{ ...INJECTED_EVALUATOR_RAW, observations: [{ skillKey: 'order.drink', observationType: 'spoken_production', autonomy: 'unaided', hintsUsed: 0, outcome: 'fail', uncertainty: 0.2, note: null }] }]) });
    const out = await lowConf.evaluate({ ...input, transcriptWindow: [{ role: 'learner', text: 'bghit ... atay', confidence: 0.2 }] });
    expect(out.observations[0]).toMatchObject({ outcome: 'unclear', utteranceConfidence: 0.2 });
    expect(out.observations[0]!.uncertainty).toBeGreaterThanOrEqual(0.7);
    const { exclusionReason } = await import('@langquest/curriculum/mastery/mastery');
    const forged = { skillKey: 'p', observationType: 'pronunciation', scorerKind: 'llm_evaluator', outcome: 'success', autonomy: 'unaided', hintsUsed: 0, uncertainty: 0, observedAt: new Date().toISOString(), scenarioId: 'x' };
    expect(exclusionReason(forged as never)).not.toBeNull();
  });
});

const describeStack = describeWithStack('security.prompt-injection.api');

describeStack('prompt injection — API keeps XP/mastery server-decided whatever the transcript says', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let enrollmentId: string;
  let missionId: string;
  let stepId: string;
  let injectedSessionId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    learner = await createTestUser(h, 'inject', { defaultSourceLanguageCode: 'fr' });
    enrollmentId = (await enrol(h, learner, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both' })).id;
    const course = await seeder.course({ trackId: 'arabic-moroccan' });
    const chapter = await seeder.chapter({ courseId: course.id });
    const mission = await seeder.mission({ chapterId: chapter.id, varietyId: 'ary', goals: [{ id: 'g1', skill_keys: ['order.drink'] }] });
    missionId = mission.id;
    stepId = (await seeder.steps(mission.id, ['character_conversation']))[0]!.id;
    const character = await seeder.character('ary');
    const evaluator = new Evaluator({ reasoner: scriptedReasoner([INJECTED_EVALUATOR_RAW]) });
    const injected = await evaluator.evaluate({ context: darijaFromFrenchContext(enrollmentId), transcriptWindow: INJECTION_FIXTURES.map((f) => ({ role: 'learner' as const, text: f.text })), conversationSessionId: crypto.randomUUID() });
    injectedSessionId = (await seeder.conversationSession({ userId: learner.id, enrollmentId, characterId: character.id, varietyId: 'ary', sourceLanguageCode: 'fr', missionId, rubricOutcomes: injected })).id;
    // The evaluator's own rows for this session, as `evaluateSession` records them (it judged the order a success). The
    // session's stored output is the injected one, which a learner can also rewrite through PostgREST: the server
    // credits the conversation step and its objectives only as far as these rows back them (apps/api/src/lib/xp-credit.ts).
    const honest = new Evaluator({ reasoner: scriptedReasoner([{ objectivesCompleted: ['g1'], skillsExercised: ['order.drink'], observations: [{ skillKey: 'order.drink', observationType: 'spoken_production', autonomy: 'unaided', hintsUsed: 0, outcome: 'success', uncertainty: 0.2, note: null }], priorityCorrections: [], summary: 'Ordered a mint tea.', reviewTriggers: [], relationshipMemoryUpdate: null, confidence: 0.7 }]) });
    const honestOutput = await honest.evaluate({ context: { ...darijaFromFrenchContext(enrollmentId), missionId }, transcriptWindow: [{ role: 'learner', text: 'bghit atay 3afak', confidence: 0.9 }], conversationSessionId: injectedSessionId });
    await recordEvaluatorObservations(h.service, learner.id, honest.toSkillObservations(honestOutput, enrollmentId));
  });

  // Users first (their owned rows and ledgers go with them), then the seeded content rows in reverse insertion order.
  afterAll(() => teardown(h, seeder));

  it('evaluate with injected step strings and a poisoned session still awards the canonical XP once and a valid envelope', async () => {
    const attempt = await call(h, `/v1/missions/${missionId}/attempts`, { token: learner.token, body: { enrollmentId, clientAttemptId: crypto.randomUUID(), missionRevision: 0, startedAt: new Date().toISOString() } });
    expect(attempt.status).toBe(201);
    const clientEventId = crypto.randomUUID();
    const body = { attemptId: attempt.json.data.attemptId, enrollmentId, completedAt: new Date().toISOString(), clientEventId, stepResults: [{ stepId, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 1000, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: INJECTION_FIXTURES.find((f) => f.goal === 'award_xp')!.text, conversationSessionId: injectedSessionId }] };
    const res = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.xpAwarded).toBeLessThanOrEqual(50 + 15 * 3); // mission + at most a few mastery advances, never 1000
    expect(res.json.data.evaluation.objectivesCompleted).toEqual(['g1']);
    expect(EvaluatorOutputSchema.safeParse(res.json.data.evaluation).success).toBe(true);
    expect(JSON.stringify(res.json)).not.toMatch(/attacker@example\.com|555 0100/);
    const replay = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body });
    expect(replay.json.data.xpReplayed).toBe(true);
    // Every ledger row carries the DB-canonical amount for its reason (xp_amount_for_reason), never a client number.
    const ledger = await h.service.from('xp_ledger').select('reason, amount').eq('user_id', learner.id);
    expect(ledger.data!.filter((r) => r.reason === 'mission_completed')).toHaveLength(1);
    for (const row of ledger.data!) {
      const canonical = await h.service.rpc('xp_amount_for_reason', { p_reason: row.reason });
      expect(row.amount, row.reason).toBe(Number(canonical.data));
    }
    const total = await h.service.rpc('user_total_xp', { p_user_id: learner.id });
    expect(Number(total.data)).toBe(ledger.data!.reduce((n, r) => n + r.amount, 0));
    expect(Number(total.data)).toBeLessThan(200);
    const mastery = await h.service.from('user_skill_mastery').select('skill_key, mastery_state').eq('enrollment_id', enrollmentId);
    expect(mastery.data?.every((m) => m.mastery_state !== 'durable')).toBe(true);
    expect(mastery.data?.some((m) => /drop|passwd/i.test(m.skill_key))).toBe(false);
  });

  it('oversized or non-schema bodies never reach the engine', async () => {
    const huge = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body: { attemptId: crypto.randomUUID(), enrollmentId, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: [{ stepId, outcome: 'success', hintsUsed: -1, replays: 0, durationMs: 1, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: null, conversationSessionId: null }] } });
    expect(huge.status).toBe(422);
    const giant = await call(h, `/v1/missions/${missionId}/evaluate`, { token: learner.token, body: { attemptId: crypto.randomUUID(), enrollmentId, completedAt: new Date().toISOString(), clientEventId: crypto.randomUUID(), stepResults: [{ stepId, outcome: 'success', hintsUsed: 0, replays: 0, durationMs: 1, speechAssessmentIds: [], attemptedBeforeReveal: null, selectedIntentId: 'x'.repeat(3_000_000), conversationSessionId: null }] } });
    expect([413, 422]).toContain(giant.status);
  });
});
