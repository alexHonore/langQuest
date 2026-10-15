import { describe, expect, it } from 'vitest';
import type { AiTaskName, LanguageContext, Prompt, TextReasoner } from '@langquest/contracts';
import { LanguageGuard, type AiRequestRecord } from '@langquest/ai';
import { getBlueprint } from '@langquest/curriculum';
import { ExpressionDraftSchema } from './drafts';
import { MissionDraftLlmSchema, assembleSeedChapter, buildFixturePrompts, buildMissionPrompt, chapterToExpressionDrafts, generateChapter, generateFixtureSuite, resolveTarget, validateMissionDraft, type MissionDraftLlm } from './content-factory';

const target = resolveTarget('arabic-moroccan', 'fr');
const guard = new LanguageGuard({});

const ex = (slotId: string | null, intentKey: string, arab: string, arabizi: string, meaning: string, speaker: 'learner' | 'character' = 'learner', register = 'polite'): MissionDraftLlm['expressions'][number] => ({
  slotId,
  intentKey,
  speaker,
  targetText: arab,
  forms: [
    { script: 'Arab', transliterationScheme: null, text: arab },
    { script: 'Latn', transliterationScheme: 'arabizi', text: arabizi },
  ],
  meaning,
  contextNote: null,
  literalGloss: null,
  register: register as MissionDraftLlm['expressions'][number]['register'],
  codeSwitchNote: null,
  pronunciationNote: null,
  difficulty: 0.2,
});

const cafeDraft = (): MissionDraftLlm => ({
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
    // rejected: MSA instead of Darija (wrong variety)
    ex(null, 'request_drink', 'هل أريد قهوة من فضلك، ماذا لديك؟', 'hal ureed qahwa', 'Je voudrais un café (MSA).'),
    // rejected: French leak (wrong script)
    ex(null, 'thank', 'Merci beaucoup monsieur', 'merci', 'Merci beaucoup.'),
    // rejected: unknown intent
    ex(null, 'not_an_intent', 'واخا', 'wakha', 'D’accord.'),
  ],
  reviewerNotes: ['Vérifier l’orthographe de نص نص.'],
});

function fakeReasoner(responses: Record<string, unknown>, records: AiRequestRecord[], costPerCall = 0.01): TextReasoner {
  return {
    async generateStructured<T>(task: AiTaskName, ctx: LanguageContext, prompt: Prompt, schema: { parse(v: unknown): T }): Promise<T> {
      records.push({ occurredAt: new Date().toISOString(), userId: null, enrollmentId: ctx.enrollmentId, task, provider: 'fake', model: 'fake/model', profileId: null, fallbackIndex: 0, latencyMs: 1, inputTokens: 100, outputTokens: 200, audioSeconds: null, estimatedCostUsd: costPerCall, success: true, errorCode: null, traceId: `t${records.length}`, redactedLog: null });
      const key = Object.keys(responses).find((k) => prompt.templateId.includes(k));
      if (!key) throw new Error(`no fake response for ${prompt.templateId}`);
      return schema.parse(responses[key]);
    },
  };
}

describe('content factory prompts', () => {
  it('builds a mission prompt that carries the variety guard, script forms and slot list in the source language', () => {
    const bp = getBlueprint('cafe_order_drink');
    const p = buildMissionPrompt(target, bp, { chapterTitleKey: 'x' });
    expect(p.templateId).toBe('content_factory.mission.cafe_order_drink');
    expect(p.system).toMatch(/Darija|Moroccan/);
    expect(p.system).toContain('arabizi');
    expect(p.system).toContain('"Arab"');
    expect(p.user).toContain('slot "order": intent request_drink');
    expect(p.user).toContain('title in fr');
    const fx = buildFixturePrompts(target);
    expect(fx.intents.user).toContain('"contrastVarietyId": "arb"');
    expect(fx.expressions.user).toContain('exactly 25');
  });

  it('expects furigana + romaji forms for Japanese and no transliteration for Latin tracks', () => {
    const ja = resolveTarget('japanese', 'en');
    expect(ja.primaryScript).toBe('Jpan');
    expect(ja.transliterations).toEqual(expect.arrayContaining(['romaji', 'furigana']));
    const es = resolveTarget('spanish-spain', 'en');
    expect(es.transliterations).toEqual([]);
    expect(buildMissionPrompt(es, getBlueprint('greet_and_introduce'), { chapterTitleKey: '' }).system).toContain('no transliteration forms');
  });
});

describe('content factory validators', () => {
  it('accepts Darija slot expressions and rejects MSA, source-language leaks and unknown intents', () => {
    const bp = getBlueprint('cafe_order_drink');
    const v = validateMissionDraft(cafeDraft(), bp, target, guard);
    expect(v.ok).toBe(true);
    expect(v.missingSlots).toEqual([]);
    const accepted = v.expressions.filter((e) => e.accepted).map((e) => e.index);
    expect(accepted).toEqual([0, 1, 2, 3, 4, 5]);
    expect(v.expressions[6]!.reasons.some((r) => r.startsWith('guard_wrong_variety'))).toBe(true);
    expect(v.expressions[7]!.reasons.some((r) => r.startsWith('guard_wrong_script') || r.startsWith('guard_source_language_leak'))).toBe(true);
    expect(v.expressions[8]!.reasons).toContain('unknown_intent:not_an_intent');
  });

  it('fails a mission whose required slots are missing or mismatched', () => {
    const bp = getBlueprint('cafe_order_drink');
    const d = cafeDraft();
    d.expressions = d.expressions.filter((e) => e.slotId !== 'order');
    const v = validateMissionDraft(d, bp, target, guard);
    expect(v.ok).toBe(false);
    expect(v.missingSlots).toEqual(['order']);
    const d2 = cafeDraft();
    d2.expressions[0]!.intentKey = 'thank';
    const v2 = validateMissionDraft(d2, bp, target, guard);
    expect(v2.expressions[0]!.reasons).toContain('slot_intent_mismatch:greeting');
  });

  it('flags missing transliteration forms', () => {
    const bp = getBlueprint('cafe_order_drink');
    const d = cafeDraft();
    d.expressions[1]!.forms = d.expressions[1]!.forms.filter((f) => f.transliterationScheme !== 'arabizi');
    const v = validateMissionDraft(d, bp, target, guard);
    expect(v.expressions[1]!.reasons).toContain('missing_transliteration:arabizi');
  });
});

describe('generateChapter (fake reasoner)', () => {
  it('generates, validates, assembles an honest seed chapter and converts it to expression drafts', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = fakeReasoner({ 'mission.cafe_order_drink': cafeDraft() }, records);
    const run = await generateChapter(target, { reasoner, guard, records: () => records, budgetCheck: (l) => l.estimatedCostUsd < 0.3 }, { blueprintKeys: ['cafe_order_drink'], generatedBy: 'test' });
    expect(run.aborted).toBeNull();
    expect(run.ledger).toMatchObject({ calls: 1, estimatedCostUsd: 0.01, models: ['fake/model'] });
    expect(run.chapter).not.toBeNull();
    const c = run.chapter!;
    expect(c).toMatchObject({ courseTrackId: 'arabic-moroccan', targetVarietyId: 'ary', sourceLanguages: ['fr'], provenance: 'ai_draft', nativeReviewed: false, reviewStatus: 'review_needed' });
    expect(c.missions).toHaveLength(1);
    expect(c.missions[0]!.expressions).toHaveLength(6);
    expect(c.missions[0]!.expressions.every((e) => e.nativeReviewed === false && e.reviewStatus === 'review_needed' && e.targetText)).toBe(true);
    expect(c.characters[0]!.name).toBe('Youssef');
    expect(c.notes.join(' ')).toContain('native review required');

    const drafts = chapterToExpressionDrafts({ formatVersion: 1, kind: 'chapter_draft', draftId: 'd', status: 'review_needed', nativeReviewed: false, provenance: { dataset: 'content_factory', snapshotId: 's', inputs: [], evidence: [], importedAt: 'now', importer: 'test' }, generation: null, validation: [], chapter: c });
    expect(drafts).toHaveLength(6);
    for (const d of drafts) {
      expect(ExpressionDraftSchema.safeParse(d).success).toBe(true);
      expect(d.rights.verified).toBe(false);
      expect(d.forms.map((f) => f.transliterationScheme)).toEqual([null, 'arabizi']);
      expect(d.translations[0]!.sourceLanguageCode).toBe('fr');
    }
    expect(drafts.find((d) => d.curation.flags.includes('character_line'))).toBeTruthy();
  });

  it('retries once with validator feedback and stops when the budget is exhausted', async () => {
    const records: AiRequestRecord[] = [];
    const broken = cafeDraft();
    broken.expressions = broken.expressions.filter((e) => e.slotId !== 'order');
    let calls = 0;
    const reasoner: TextReasoner = {
      async generateStructured<T>(_task: AiTaskName, _ctx: LanguageContext, prompt: Prompt, schema: { parse(v: unknown): T }): Promise<T> {
        calls += 1;
        records.push({ occurredAt: 'x', userId: null, enrollmentId: null, task: 'content_generation', provider: 'fake', model: 'fake/model', profileId: null, fallbackIndex: 0, latencyMs: 1, inputTokens: 1, outputTokens: 1, audioSeconds: null, estimatedCostUsd: 0.05, success: true, errorCode: null, traceId: `t${calls}`, redactedLog: null });
        const retry = prompt.user.includes('rejected by the validator');
        return schema.parse(retry ? cafeDraft() : broken);
      },
    };
    const run = await generateChapter(target, { reasoner, guard, records: () => records, budgetCheck: (l) => l.estimatedCostUsd < 0.3 }, { blueprintKeys: ['cafe_order_drink'], generatedBy: 'test' });
    expect(calls).toBe(2);
    expect(run.missions[0]!.validation.ok).toBe(true);

    const exhausted = await generateChapter(target, { reasoner, guard, records: () => records, budgetCheck: () => false }, { blueprintKeys: ['cafe_order_drink'], generatedBy: 'test' });
    expect(exhausted.aborted).toMatch(/budget exhausted/);
    expect(exhausted.chapter).toBeNull();
    expect(calls).toBe(2);
  });

  it('parses the LLM mission schema strictly enough to reject malformed output', () => {
    expect(MissionDraftLlmSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(MissionDraftLlmSchema.safeParse(cafeDraft()).success).toBe(true);
    expect(() => assembleSeedChapter(target, [], 'test', [])).toThrow();
  });
});

describe('generateFixtureSuite (fake reasoner)', () => {
  it('assembles the §14.2 suite, validates expressions and reports gaps honestly', async () => {
    const records: AiRequestRecord[] = [];
    const expressions = { expressions: Array.from({ length: 25 }, (_, i) => ({ targetText: i % 5 === 0 ? 'Merci beaucoup' : 'شكرا بزاف', forms: [{ script: 'Arab', transliterationScheme: null, text: 'شكرا بزاف' }, { script: 'Latn', transliterationScheme: 'arabizi', text: 'chokran bzaf' }], meaning: 'Merci beaucoup.', intentKey: 'thank', register: 'polite', pronunciationNote: null })), reviewerNotes: ['n1'] };
    const dialogues = { dialogues: Array.from({ length: 3 }, (_, i) => ({ title: `D${i}`, context: 'c', twist: 't', turns: [{ speaker: 'character', targetText: 'سلام', forms: [{ script: 'Arab', transliterationScheme: null, text: 'سلام' }, { script: 'Latn', transliterationScheme: 'arabizi', text: 'salam' }], meaning: 'Salut' }] })), reviewerNotes: [] };
    const intents = { intents: [{ intentKey: 'thank', acceptablePhrasings: [{ targetText: 'شكرا', meaning: 'Merci', register: 'neutral' }], unacceptable: [{ targetText: 'x', reason: 'r' }] }, { intentKey: 'bogus', acceptablePhrasings: [], unacceptable: [] }], confusionTest: { contrastVarietyId: 'arb', pairs: [{ meaning: 'Comment ça va ?', thisVariety: 'لاباس؟', contrastVariety: 'كيف حالك؟', note: 'n' }] }, reviewerNotes: [] };
    const reasoner = fakeReasoner({ 'fixture.expressions': expressions, 'fixture.dialogues': dialogues, 'fixture.intents': intents }, records);
    const { suite, ledger, aborted } = await generateFixtureSuite(target, { reasoner, guard, records: () => records }, 'test');
    expect(aborted).toBeNull();
    expect(ledger.calls).toBe(3);
    expect(suite).not.toBeNull();
    expect(suite!.counts).toEqual({ expressions: 20, dialogues: 3, intents: 1, confusionPairs: 1 });
    expect(suite!.expressions.filter((e) => !e.validation.accepted)).toHaveLength(5);
    expect(suite!.gaps).toEqual(expect.arrayContaining([expect.stringMatching(/20\/25/), expect.stringMatching(/3\/10/), expect.stringMatching(/1\/5/), 'unknown intent bogus dropped']));
    expect(suite!.nativeReviewed).toBe(false);
    expect(suite!.expressions.every((e) => e.reviewed === false && e.verdict === null)).toBe(true);
  });
});
