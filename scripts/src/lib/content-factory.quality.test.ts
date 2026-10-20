/**
 * Content factory quality stages with fake reasoners only (no network, no spend): the diversity gate
 * before drafts are returned, regeneration with the gate's reasons, and the second-model review.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AiTaskName, LanguageContext, Prompt, TextReasoner, TextReasonerOptions } from '@langquest/contracts';
import { LanguageGuard, isStrictCompatible, toResponseFormat, type AiRequestRecord } from '@langquest/ai';
import { FakeReasoner } from '@langquest/ai/test-support/fakes';
import { ExpressionDraftSchema } from './drafts';
import { FixtureDialoguesLlmSchema, chapterToExpressionDrafts, generateChapter, generateFixtureSuite, resolveTarget, type ChapterDraftRecord, type MissionDraftLlm } from './content-factory';
import { ModelReviewLlmSchema, type ModelReviewLlm } from './content-review';

const target = resolveTarget('arabic-moroccan', 'fr');
const guard = new LanguageGuard({});
const MSA = 'هل تريد أن تشرب القهوة؟ ماذا تفضل؟';

const record = (task: AiTaskName, model: string, n: number, cost: number): AiRequestRecord => ({ occurredAt: 'x', userId: null, enrollmentId: null, task, provider: 'fake', model, profileId: null, fallbackIndex: 0, latencyMs: 1, inputTokens: 10, outputTokens: 10, audioSeconds: null, estimatedCostUsd: cost, success: true, errorCode: null, traceId: `t${n}`, redactedLog: null });

/** Wrap any reasoner so each call leaves an `ai_requests`-shaped record (model per task). */
function recorded(inner: TextReasoner, records: AiRequestRecord[], model: string, cost = 0.01): TextReasoner & { prompts: Array<{ task: AiTaskName; prompt: Prompt }> } {
  const prompts: Array<{ task: AiTaskName; prompt: Prompt }> = [];
  return {
    prompts,
    async generateStructured<T>(task: AiTaskName, ctx: LanguageContext, prompt: Prompt, schema: z.ZodType<T>, options?: TextReasonerOptions): Promise<T> {
      prompts.push({ task, prompt });
      records.push(record(task, model, records.length, cost));
      return inner.generateStructured(task, ctx, prompt, schema, options);
    },
  };
}

/** Generator fake: answers by template id, with a second answer once the prompt carries diversity feedback. */
function generator(responses: Record<string, { first: unknown; retry?: unknown }>): FakeReasoner {
  return new FakeReasoner().on('content_generation', (prompt: Prompt) => {
    const key = Object.keys(responses).find((k) => prompt.templateId.includes(k));
    if (!key) throw new Error(`no fake response for ${prompt.templateId}`);
    const r = responses[key]!;
    return prompt.user.includes('failed the diversity gate') && r.retry !== undefined ? r.retry : r.first;
  });
}

const refsIn = (prompt: Prompt): string[] => prompt.user.split('\n').slice(1).map((line) => (JSON.parse(line) as { ref: string }).ref);

/** Critic fake: accepts everything except the scripted refs. */
function critic(overrides: Record<string, Omit<ModelReviewLlm['reviews'][number], 'ref'>>, extra: ModelReviewLlm['reviews'] = []): FakeReasoner {
  return new FakeReasoner().on('language_quality_check', (prompt: Prompt): ModelReviewLlm => ({
    reviews: [...refsIn(prompt).map((ref) => ({ ref, ...(overrides[ref] ?? { verdict: 'accept' as const, issues: [], suggestedTargetText: null }) })), ...extra],
    notes: ['Orthographe de قهوة à harmoniser.'],
  }));
}

// --- Darija fixtures ---------------------------------------------------------------------------
const form = (arab: string, arabizi: string) => [
  { script: 'Arab' as const, transliterationScheme: null, text: arab },
  { script: 'Latn' as const, transliterationScheme: 'arabizi' as const, text: arabizi },
];
type Act = 'normal' | 'unexpected' | 'misunderstanding' | 'repair' | 'refusal';
const turn = (speaker: 'learner' | 'character', arab: string, arabizi: string, meaning: string, act: Act = 'normal', intentKey: string | null = null) => ({ speaker, targetText: arab, forms: form(arab, arabizi), meaning, act, intentKey });

const fixtureExpressions = {
  expressions: [
    { targetText: 'شكرا بزاف', forms: form('شكرا بزاف', 'chokran bzaf'), meaning: 'Merci beaucoup.', intentKey: 'thank', register: 'polite', pronunciationNote: null },
    { targetText: 'بغيت قهوة عافاك', forms: form('بغيت قهوة عافاك', 'bghit qahwa 3afak'), meaning: 'Je voudrais un café, s’il vous plaît.', intentKey: 'request_drink', register: 'polite', pronunciationNote: null },
  ],
  reviewerNotes: [],
};

const diverseDialogues = {
  dialogues: [
    { title: 'Au café', context: 'Matin', twist: 'Le serveur parle vite', turns: [turn('character', 'سلام، شنو بغيتي؟', 'salam, chno bghiti?', 'Bonjour, vous voulez quoi ?'), turn('learner', 'بغيت قهوة عافاك', 'bghit qahwa 3afak', 'Un café, s’il vous plaît.'), turn('character', 'كحلة ولا نص نص؟', 'k7la wla ness ness?', 'Noir ou moitié-moitié ?'), turn('learner', 'عاود عافاك؟', '3awed 3afak?', 'Vous pouvez répéter ?', 'misunderstanding', 'ask_repeat'), turn('character', 'قهوة كحلة ولا بالحليب؟', 'qahwa k7la wla b l7lib?', 'Café noir ou au lait ?', 'repair'), turn('learner', 'نص نص، شكرا', 'ness ness, chokran', 'Moitié-moitié, merci.')] },
    { title: 'Plus de thé', context: 'Après-midi', twist: 'Il n’y a plus de thé', turns: [turn('learner', 'سلام! واش كاين أتاي؟', 'salam! wach kayn atay?', 'Bonjour ! Il y a du thé ?'), turn('character', 'ما بقاش، سالا', 'ma bqach, sala', 'Il n’y en a plus.', 'unexpected'), turn('learner', 'واخا، عطيني قهوة', 'wakha, 3tini qahwa', 'D’accord, donnez-moi un café.'), turn('character', 'مرحبا', 'mar7ba', 'Avec plaisir.')] },
    { title: 'Le prix', context: 'Au marché', twist: 'Négociation', turns: [turn('character', 'مرحبا بيك', 'mar7ba bik', 'Bienvenue.'), turn('character', 'شنو نجيب ليك؟', 'chno njib lik?', 'Je vous sers quoi ?'), turn('learner', 'بشحال الحليب؟', 'bch7al l7lib?', 'Combien le lait ?'), turn('character', 'خمسة دراهم', 'khamsa drahm', 'Cinq dirhams.'), turn('learner', 'غالي شوية', 'ghali chwiya', 'Un peu cher.', 'refusal'), turn('character', 'ربعة دراهم، صافي؟', 'reb3a drahm, safi?', 'Quatre dirhams, ça va ?'), turn('learner', 'صافي، شكرا', 'safi, chokran', 'D’accord, merci.')] },
    { title: 'Le bus', context: 'Dans la rue', twist: 'Malentendu sur le mot', turns: [turn('learner', 'سمح ليا، فين كاين الطوبيس؟', 'sme7 lia, fin kayn tobis?', 'Pardon, où est le bus ?'), turn('character', 'شنو؟ ما فهمتكش', 'chno? ma fhemtekch', 'Quoi ? Je ne vous ai pas compris.', 'misunderstanding'), turn('learner', 'الطوبيس، الكار', 'tobis, lkar', 'Le bus, le car.', 'repair'), turn('character', 'آه، تما على اليمين', 'ah, temma 3la limin', 'Ah, là-bas à droite.')] },
  ],
  reviewerNotes: [],
};

const quizDialogues = { dialogues: Array.from({ length: 4 }, (_, i) => ({ title: `Q${i}`, context: 'c', twist: 't', turns: [turn('character', 'شنو بغيتي؟', 'chno bghiti?', 'Vous voulez quoi ?'), turn('learner', 'بغيت قهوة عافاك', 'bghit qahwa 3afak', 'Un café.'), turn('character', 'شحال بغيتي؟', 'ch7al bghiti?', 'Combien ?'), turn('learner', 'وحدة', 'wa7da', 'Un.')] })), reviewerNotes: [] };

const confusionTest = { contrastVarietyId: 'arb', pairs: [{ meaning: 'Comment ça va ?', thisVariety: 'لاباس؟', contrastVariety: 'كيف حالك؟', note: 'Darija vs arabe standard.' }] };
const diverseIntents = {
  intents: [
    { intentKey: 'request_drink', acceptablePhrasings: [{ targetText: 'بغيت قهوة عافاك', meaning: 'Un café, s’il vous plaît.', register: 'polite' }, { targetText: 'عطيني واحد القهوة', meaning: 'Donnez-moi un café.', register: 'casual' }, { targetText: 'واش ممكن نشرب أتاي؟', meaning: 'Je peux prendre un thé ?', register: 'polite' }], unacceptable: [{ targetText: 'جيب القهوة دابا', reason: 'Trop sec.' }] },
    { intentKey: 'thank', acceptablePhrasings: [{ targetText: 'شكرا بزاف', meaning: 'Merci beaucoup.', register: 'neutral' }, { targetText: 'الله يخليك', meaning: 'Merci (que Dieu vous garde).', register: 'polite' }, { targetText: 'بارك الله فيك', meaning: 'Merci, que Dieu vous bénisse.', register: 'polite' }], unacceptable: [] },
  ],
  confusionTest,
  reviewerNotes: [],
};
const oneAnswerIntents = { intents: [{ intentKey: 'request_drink', acceptablePhrasings: [{ targetText: 'بغيت قهوة عافاك', meaning: 'Un café.', register: 'polite' }, { targetText: 'بْغِيتْ قَهْوَة عافاك', meaning: 'Un café.', register: 'polite' }], unacceptable: [] }, { intentKey: 'thank', acceptablePhrasings: [{ targetText: 'شكرا بزاف', meaning: 'Merci.', register: 'neutral' }], unacceptable: [] }], confusionTest, reviewerNotes: [] };

const relabelledQuiz = { ...quizDialogues, dialogues: quizDialogues.dialogues.map((d) => ({ ...d, turns: d.turns.map((t, j) => (j === 1 ? { ...t, act: 'misunderstanding' as const, intentKey: 'say_not_understood' } : j === 2 ? { ...t, act: 'repair' as const } : t)) })) };

describe('fixture suite diversity gate (fake reasoner)', () => {
  it('only marks a failing set by default: 3 calls, no paid regeneration unless asked', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(generator({ 'fixture.expressions': { first: fixtureExpressions }, 'fixture.dialogues': { first: quizDialogues, retry: diverseDialogues }, 'fixture.intents': { first: oneAnswerIntents, retry: diverseIntents } }), records, 'fake/generator');
    const { suite, ledger } = await generateFixtureSuite(target, { reasoner, guard, records: () => records }, 'test');
    expect(ledger.calls).toBe(3);
    expect(reasoner.prompts.some((p) => p.prompt.user.includes('failed the diversity gate'))).toBe(false);
    expect(suite!.diversityGate).toMatchObject({ verdict: 'needs_regeneration', regenerated: [], regenerationAttempts: 0, regenerationSkipped: 'not requested (regenerateOnLowDiversity is off)' });
    expect(suite!.gaps).toEqual(expect.arrayContaining([expect.stringMatching(/^diversity gate: needs regeneration/), 'diversity regeneration skipped: not requested (regenerateOnLowDiversity is off)']));
  });

  it('regenerates a quiz-shaped, one-answer set once on request with the gate reasons and keeps the better drafts', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(generator({ 'fixture.expressions': { first: fixtureExpressions }, 'fixture.dialogues': { first: quizDialogues, retry: diverseDialogues }, 'fixture.intents': { first: oneAnswerIntents, retry: diverseIntents } }), records, 'fake/generator');
    const { suite, ledger, aborted } = await generateFixtureSuite(target, { reasoner, guard, records: () => records }, 'test', { regenerateOnLowDiversity: true });
    expect(aborted).toBeNull();
    expect(ledger.calls).toBe(5);
    const retries = reasoner.prompts.filter((p) => p.prompt.user.includes('failed the diversity gate'));
    expect(retries.map((p) => p.prompt.templateId)).toEqual(['content_factory.fixture.dialogues', 'content_factory.fixture.intents']);
    expect(retries[0]!.prompt.user).toMatch(/quiz_shaped_set/);
    expect(retries[0]!.prompt.user).toMatch(/no_repair_turns/);
    expect(retries[0]!.prompt.user).toMatch(/repeated_dialogues/);
    expect(retries[0]!.prompt.user).toMatch(/not only their labels/);
    expect(retries[1]!.prompt.user).toMatch(/single_phrasing \(request_drink\)/);
    expect(suite!.diversityGate).toMatchObject({ verdict: 'diverse', regenerated: ['dialogues', 'intents'], regenerationAttempts: 2, regenerationSkipped: null });
    expect(suite!.gaps.some((g) => g.startsWith('diversity'))).toBe(false);
    expect(suite!.dialogues[0]!.turns[3]).toMatchObject({ act: 'misunderstanding', intentKey: 'ask_repeat' });
    // still an unreviewed draft
    expect(suite).toMatchObject({ status: 'review_needed', nativeReviewed: false, secondModelReview: null, nativeVerdictSheets: [], nativeVerdictSummary: null });
    expect(suite!.intents.flatMap((i) => i.acceptablePhrasings).every((p) => p.reviewed === false && p.verdict === null && p.modelReview === null)).toBe(true);
  });

  it('never keeps a dialogue retry that only relabels the same lines', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(generator({ 'fixture.expressions': { first: fixtureExpressions }, 'fixture.dialogues': { first: quizDialogues, retry: relabelledQuiz }, 'fixture.intents': { first: oneAnswerIntents, retry: diverseIntents } }), records, 'fake/generator');
    const { suite, ledger } = await generateFixtureSuite(target, { reasoner, guard, records: () => records }, 'test', { regenerateOnLowDiversity: true });
    expect(ledger.calls).toBe(5);
    expect(suite!.diversityGate).toMatchObject({ verdict: 'needs_regeneration', regenerated: ['intents'], regenerationAttempts: 2 });
    expect(suite!.diversityGate!.reasons).toEqual(expect.arrayContaining(['repeated_dialogues:0.75', 'high_overlap_dialogues:1', 'uniform_turn_structure:0.25']));
    expect(suite!.dialogues.flatMap((d) => d.turns).every((t) => t.act === 'normal')).toBe(true); // the original, not the relabelled copy
    expect(suite!.gaps).toEqual(expect.arrayContaining([expect.stringMatching(/^diversity gate: needs regeneration/)]));
  });

  it('keeps the original and marks the suite for regeneration when the retry is not better, or the budget is spent', async () => {
    const records: AiRequestRecord[] = [];
    const same = recorded(generator({ 'fixture.expressions': { first: fixtureExpressions }, 'fixture.dialogues': { first: quizDialogues }, 'fixture.intents': { first: oneAnswerIntents } }), records, 'fake/generator');
    const run = await generateFixtureSuite(target, { reasoner: same, guard, records: () => records }, 'test', { regenerateOnLowDiversity: true });
    expect(run.ledger.calls).toBe(5);
    expect(run.suite!.diversityGate).toMatchObject({ verdict: 'needs_regeneration', regenerated: [], regenerationAttempts: 2, regenerationSkipped: null });
    expect(run.suite!.diversityGate!.reasons).toEqual(expect.arrayContaining(['single_phrasing:request_drink', 'single_phrasing:thank', 'uniform_turn_structure:0.25', 'no_repair_turns', 'quiz_shaped_set:1', 'repeated_dialogues:0.75', 'high_overlap_dialogues:1']));
    expect(run.suite!.gaps).toEqual(expect.arrayContaining([expect.stringMatching(/^diversity gate: needs regeneration/)]));
    expect(run.suite!.dialogues).toHaveLength(4); // nothing dropped
    expect(run.suite!.status).toBe('review_needed');

    const spent: AiRequestRecord[] = [];
    const capped = recorded(generator({ 'fixture.expressions': { first: fixtureExpressions }, 'fixture.dialogues': { first: quizDialogues, retry: diverseDialogues }, 'fixture.intents': { first: oneAnswerIntents, retry: diverseIntents } }), spent, 'fake/generator', 0.1);
    const budget = await generateFixtureSuite(target, { reasoner: capped, guard, records: () => spent, budgetCheck: (l) => l.estimatedCostUsd < 0.3 }, 'test', { regenerateOnLowDiversity: true });
    expect(budget.ledger.calls).toBe(3);
    expect(budget.aborted).toBeNull();
    expect(budget.suite!.diversityGate!.regenerationSkipped).toMatch(/budget exhausted/);
    expect(budget.suite!.gaps).toEqual(expect.arrayContaining([expect.stringMatching(/^diversity regeneration skipped: budget exhausted/), expect.stringMatching(/^diversity gate: needs regeneration/)]));
  });

  it('keeps the dialogue schema strict-compatible and older drafts without turn labels parseable', () => {
    expect(isStrictCompatible(toResponseFormat('dialogues', FixtureDialoguesLlmSchema).json_schema.schema)).toBe(true);
    expect(isStrictCompatible(toResponseFormat('review', ModelReviewLlmSchema).json_schema.schema)).toBe(true);
    const legacy = FixtureDialoguesLlmSchema.parse({ dialogues: [{ title: 't', context: 'c', twist: 'w', turns: [{ speaker: 'learner', targetText: 'سلام', forms: [], meaning: 'Salut' }] }], reviewerNotes: [] });
    expect(legacy.dialogues[0]!.turns[0]).toMatchObject({ act: 'normal', intentKey: null });
  });
});

describe('second-model review in the fixture pipeline (fake critic)', () => {
  it('annotates items with Zod-validated advisory verdicts and never touches native review fields', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(generator({ 'fixture.expressions': { first: fixtureExpressions }, 'fixture.dialogues': { first: diverseDialogues }, 'fixture.intents': { first: diverseIntents } }), records, 'fake/generator');
    const criticFake = critic(
      {
        'expressions/0': { verdict: 'revise', issues: [{ kind: 'unnatural', detail: 'Un peu scolaire.' }], suggestedTargetText: 'الله يخليك' },
        'intents/0/acceptablePhrasings/1': { verdict: 'reject', issues: [{ kind: 'wrong_variety', detail: 'Tournure standard.' }], suggestedTargetText: MSA },
        'dialogues/0': { verdict: 'revise', issues: [{ kind: 'too_formal', detail: 'Le serveur est trop formel.' }], suggestedTargetText: 'C: ...' },
      },
      [{ ref: 'expressions/99', verdict: 'accept', issues: [], suggestedTargetText: null }],
    );
    const reviewer = recorded(criticFake, records, 'fake/critic', 0.001);
    const { suite, ledger } = await generateFixtureSuite(target, { reasoner, reviewer, guard, records: () => records }, 'test');
    expect(ledger.calls).toBe(4);
    expect(criticFake.calls.map((c) => c.task)).toEqual(['language_quality_check']);
    const prompt = criticFake.calls[0]!.prompt;
    expect(prompt.templateId).toBe('content_factory.second_model_review');
    expect(prompt.system).toContain('independent second reviewer');
    expect(prompt.system).toMatch(/Darija|Moroccan/);
    expect(refsIn(prompt)).toEqual(['expressions/0', 'expressions/1', 'intents/0/acceptablePhrasings/0', 'intents/0/acceptablePhrasings/1', 'intents/0/acceptablePhrasings/2', 'intents/1/acceptablePhrasings/0', 'intents/1/acceptablePhrasings/1', 'intents/1/acceptablePhrasings/2', 'dialogues/0', 'dialogues/1', 'dialogues/2', 'dialogues/3', 'confusionTest/pairs/0']);

    const s = suite!;
    expect(s.expressions[0]!.modelReview).toMatchObject({ verdict: 'revise', suggestion: 'الله يخليك', reviewerModels: ['fake/critic'] });
    expect(s.intents[0]!.acceptablePhrasings[1]!.modelReview).toMatchObject({ verdict: 'reject', suggestion: null, issues: [{ kind: 'wrong_variety', detail: 'Tournure standard.' }] });
    expect(s.dialogues[0]!.modelReview).toMatchObject({ verdict: 'revise', suggestion: null });
    expect(s.confusionTest.pairs[0]!.modelReview!.verdict).toBe('accept');
    expect(s.secondModelReview).toMatchObject({ stage: 'second_model_review', task: 'language_quality_check', advisoryOnly: true, status: 'complete', reviewerModels: ['fake/critic'], generatorModels: ['fake/generator'], independent: true, warnings: [], counts: { items: 13, reviewed: 13, accept: 10, revise: 2, reject: 1 } });
    expect(s.secondModelReview!.ingestionIssues).toEqual(expect.arrayContaining(['unknown_ref:expressions/99', 'suggestion_rejected_by_guard:intents/0/acceptablePhrasings/1:wrong_variety', 'suggestion_not_allowed:dialogues/0']));
    // advisory only: nothing is removed, approved or marked native-reviewed
    expect(s.intents[0]!.acceptablePhrasings).toHaveLength(3);
    expect(s).toMatchObject({ status: 'review_needed', nativeReviewed: false });
    expect([...s.expressions, ...s.dialogues].every((i) => i.reviewed === false && i.verdict === null && i.nativeReview === null)).toBe(true);
    // run total vs. generator-only provenance: the critic's call is in its own ledger, not in `generation`
    expect(ledger).toMatchObject({ models: ['fake/generator', 'fake/critic'], estimatedCostUsd: 0.031 });
    expect(s.generation).toMatchObject({ models: ['fake/generator'], calls: 3, estimatedCostUsd: 0.03 });
    expect(s.secondModelReview!.ledger).toMatchObject({ models: ['fake/critic'], calls: 1, estimatedCostUsd: 0.001 });
  });
});

// --- chapters ------------------------------------------------------------------------------------
const ex = (slotId: string | null, intentKey: string, arab: string, arabizi: string, meaning: string, speaker: 'learner' | 'character' = 'learner', register = 'polite'): MissionDraftLlm['expressions'][number] => ({ slotId, intentKey, speaker, targetText: arab, forms: form(arab, arabizi), meaning, contextNote: null, literalGloss: null, register: register as MissionDraftLlm['expressions'][number]['register'], codeSwitchNote: null, pronunciationNote: null, difficulty: 0.2 });
const cafeDraft = (variants: MissionDraftLlm['expressions'] = []): MissionDraftLlm => ({
  title: 'Commander au café',
  sceneNote: 'Vous entrez dans un café de Casablanca.',
  character: { name: 'Youssef', personality: 'rapide et souriant', homeRegion: 'Casablanca' },
  expressions: [
    ex('greeting', 'greet_hello', 'سلام، لاباس؟', 'salam, labas?', 'Salut, ça va ?'),
    ex('order', 'request_drink', 'بغيت قهوة عافاك', 'bghit qahwa 3afak', 'Je voudrais un café, s’il vous plaît.'),
    ex('options', 'offer_options', 'كاين قهوة كحلة ولا نص نص؟', 'kayn qahwa k7la wla ness ness?', 'Café noir ou moitié-moitié ?', 'character', 'neutral'),
    ex('choice', 'choose_option', 'نص نص عافاك', 'ness ness 3afak', 'Moitié-moitié, s’il vous plaît.'),
    ex('bill', 'ask_for_bill', 'شحال عافاك؟', 'ch7al 3afak?', 'C’est combien, s’il vous plaît ?'),
    ex('thanks', 'thank', 'شكرا بزاف', 'chokran bzaf', 'Merci beaucoup.'),
    ...variants,
  ],
  reviewerNotes: [],
});
const withVariant = (): MissionDraftLlm => cafeDraft([ex(null, 'request_drink', 'عطيني واحد القهوة عافاك', '3tini wa7d l9ahwa 3afak', 'Donnez-moi un café, s’il vous plaît.', 'learner', 'casual')]);
const chapterRecord = (run: Awaited<ReturnType<typeof generateChapter>>): ChapterDraftRecord => ({ formatVersion: 1, kind: 'chapter_draft', draftId: 'd', status: 'review_needed', nativeReviewed: false, provenance: { dataset: 'content_factory', snapshotId: 's', inputs: [], evidence: [], importedAt: 'now', importer: 'test' }, generation: null, validation: [], chapter: run.chapter!, quality: run.quality });

describe('chapter diversity gate and second-model review (fake reasoners)', () => {
  it('marks a one-answer mission for regeneration without an extra call by default, and regenerates on request', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', (p: Prompt) => (p.user.includes('failed the diversity gate') ? withVariant() : cafeDraft())), records, 'fake/generator');
    const marked = await generateChapter(target, { reasoner, guard, records: () => records }, { blueprintKeys: ['cafe_order_drink'], generatedBy: 'test' });
    expect(marked.ledger.calls).toBe(1);
    expect(marked.quality.diversity).toEqual([{ blueprintKey: 'cafe_order_drink', missionKey: 'arabic_moroccan_cafe_order_drink', verdict: 'needs_regeneration', score: 0, reasons: ['low_alternative_coverage:0'], warnings: expect.arrayContaining(['single_phrasing:request_drink']) }]);
    expect(marked.missions[0]!.validation).toMatchObject({ ok: true });
    expect(marked.missions[0]!.validation.warnings).toContain('diversity_gate:needs_regeneration:low_alternative_coverage:0');
    expect(marked.chapter!.notes.join(' ')).toMatch(/cafe_order_drink: diversity gate marked this mission for regeneration/);
    expect(marked.chapter).toMatchObject({ reviewStatus: 'review_needed', nativeReviewed: false });
    const drafts = chapterToExpressionDrafts(chapterRecord(marked));
    expect(drafts.every((d) => d.curation.flags.includes('diversity_needs_regeneration'))).toBe(true);

    const regen = await generateChapter(target, { reasoner, guard, records: () => records }, { blueprintKeys: ['cafe_order_drink'], generatedBy: 'test', regenerateOnLowDiversity: true });
    expect(records).toHaveLength(3);
    expect(reasoner.prompts[2]!.prompt.user).toMatch(/failed the diversity gate: .*low_alternative_coverage \(0\): only 0\/5 intents/);
    expect(regen.quality.diversity[0]).toMatchObject({ verdict: 'diverse', reasons: [] });
    expect(regen.missions[0]!.diversity!.intents.find((i) => i.intentKey === 'request_drink')!.distinctPhrasings).toBe(2);
    expect(regen.chapter!.missions[0]!.expressions).toHaveLength(7);
  });

  it('runs the critic over assembled expressions, flags its rejects for the native reviewer and keeps the content', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', withVariant()), records, 'fake/generator');
    const reviewer = recorded(critic({ 'missions/cafe_order_drink/expressions/1': { verdict: 'reject', issues: [{ kind: 'wrong_variety', detail: 'Formule standard.' }], suggestedTargetText: null } }), records, 'fake/critic');
    const run = await generateChapter(target, { reasoner, reviewer, guard, records: () => records }, { blueprintKeys: ['cafe_order_drink'], generatedBy: 'test' });
    const review = run.quality.secondModelReview!;
    expect(review).toMatchObject({ status: 'complete', independent: true, counts: { items: 7, reviewed: 7, accept: 6, revise: 0, reject: 1 } });
    expect(review.annotations.find((a) => a.verdict === 'reject')).toMatchObject({ ref: 'missions/cafe_order_drink/expressions/1', draftKey: 'arabic_moroccan_cafe_order_drink:order' });
    expect(review.annotations.find((a) => a.ref.endsWith('/6'))!.draftKey).toBe('arabic_moroccan_cafe_order_drink:request_drink_variant_7');
    expect(run.missions[0]!.validation.warnings).toContain('second_model_reject:expressions/1:wrong_variety');
    expect(run.chapter!.missions[0]!.expressions).toHaveLength(7); // advisory: nothing removed
    expect(run.chapter!.notes.join(' ')).toMatch(/second-model review \(fake\/critic, independent of the generator\): complete; accept 6 \/ revise 0 \/ reject 1 of 7; advisory only/);
    const drafts = chapterToExpressionDrafts(chapterRecord(run));
    const order = drafts.find((d) => d.draftId === 'd:arabic_moroccan_cafe_order_drink:order')!;
    expect(order.curation.flags).toEqual(['second_model_reject', 'second_model_issue:wrong_variety']);
    expect(drafts.find((d) => d.draftId.endsWith(':thanks'))!.curation.flags).toEqual(['second_model_accept']);
    for (const d of drafts) expect(ExpressionDraftSchema.safeParse(d).success).toBe(true);
    expect(drafts.every((d) => d.status === 'review_needed' && d.nativeReviewed === false)).toBe(true);
  });

  it('records a critic that runs on the generator model as a self-review', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', withVariant()), records, 'fake/model');
    const reviewer = recorded(critic({}), records, 'fake/model');
    const run = await generateChapter(target, { reasoner, reviewer, guard, records: () => records }, { blueprintKeys: ['cafe_order_drink'], generatedBy: 'test' });
    expect(run.quality.secondModelReview).toMatchObject({ independent: false, warnings: ['self_review:fake/model'] });
    expect(run.chapter!.notes.join(' ')).toContain('SELF-REVIEW');
  });
});
