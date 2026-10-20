import { describe, expect, it } from 'vitest';
import { DB_TABLES } from '@langquest/contracts';
import { LanguageGuard, type AiRequestRecord } from '@langquest/ai';
import { FakeReasoner } from '@langquest/ai/test-support/fakes';
import type { Row } from '@langquest/db';
import { generateFixtureSuite, resolveTarget, type FixtureSuiteRecord } from './content-factory';
import { fixtureItemRefs, ingestModelReview, ingestNativeVerdicts, nativeVerdictBenchmarkRow, nativeVerdictsFromReviewedSuite, recordNativeVerdictBenchmark, runSecondModelReview, summarizeNativeVerdicts, type ReviewItem } from './content-review';

const target = resolveTarget('arabic-moroccan', 'fr');
const guard = new LanguageGuard({});
const MSA = 'هل تريد أن تشرب القهوة؟ ماذا تفضل؟';
const REVIEWER = { reviewerId: '44444444-4444-4444-8444-444444444444', role: 'language_reviewer' as const, nativeVarietyId: 'ary' as const };
const OTHER_REVIEWER = { ...REVIEWER, reviewerId: '55555555-5555-4555-8555-555555555555' };

const form = (arab: string, arabizi: string) => [
  { script: 'Arab', transliterationScheme: null, text: arab },
  { script: 'Latn', transliterationScheme: 'arabizi', text: arabizi },
];

const fakeRecord = (task: AiRequestRecord['task'], model: string, cost: number, n: number): AiRequestRecord => ({ occurredAt: 'x', userId: null, enrollmentId: null, task, provider: 'fake', model, profileId: null, fallbackIndex: 0, latencyMs: 1, inputTokens: 1, outputTokens: 1, audioSeconds: null, estimatedCostUsd: cost, success: true, errorCode: null, traceId: `t${n}`, redactedLog: null });

/** The small Darija suite; with `critic`, a second model (its own model id and cost) reviews it. */
async function smallSuite(opts: { generatorCost?: number; critic?: { model: string; cost: number } } = {}): Promise<FixtureSuiteRecord> {
  const records: AiRequestRecord[] = [];
  const responses: Record<string, unknown> = {
    'fixture.expressions': { expressions: [{ targetText: 'شكرا بزاف', forms: form('شكرا بزاف', 'chokran bzaf'), meaning: 'Merci beaucoup.', intentKey: 'thank', register: 'polite', pronunciationNote: null }, { targetText: 'بغيت قهوة عافاك', forms: form('بغيت قهوة عافاك', 'bghit qahwa 3afak'), meaning: 'Un café, s’il vous plaît.', intentKey: 'request_drink', register: 'polite', pronunciationNote: null }], reviewerNotes: [] },
    'fixture.dialogues': { dialogues: [{ title: 'Café', context: 'c', twist: 't', turns: [{ speaker: 'character', targetText: 'سلام', forms: form('سلام', 'salam'), meaning: 'Salut' }, { speaker: 'learner', targetText: 'عاود عافاك؟', forms: form('عاود عافاك؟', '3awed 3afak?'), meaning: 'Pardon ?', act: 'misunderstanding', intentKey: 'ask_repeat' }] }], reviewerNotes: [] },
    'fixture.intents': { intents: [{ intentKey: 'thank', acceptablePhrasings: [{ targetText: 'شكرا بزاف', meaning: 'Merci beaucoup.', register: 'neutral' }, { targetText: 'الله يخليك', meaning: 'Merci.', register: 'polite' }], unacceptable: [{ targetText: 'سير فحالك', reason: 'Impoli.' }] }], confusionTest: { contrastVarietyId: 'arb', pairs: [{ meaning: 'Ça va ?', thisVariety: 'لاباس؟', contrastVariety: 'كيف حالك؟', note: 'n1' }, { meaning: 'Je veux', thisVariety: 'بغيت', contrastVariety: 'أريد', note: 'n2' }] }, reviewerNotes: [] },
  };
  const reasoner = new FakeReasoner().on('content_generation', (p: { templateId: string }) => {
    records.push(fakeRecord('content_generation', 'fake/generator', opts.generatorCost ?? 0.01, records.length));
    return responses[Object.keys(responses).find((k) => p.templateId.includes(k))!];
  });
  const critic = opts.critic;
  const reviewer = critic
    ? new FakeReasoner().on('language_quality_check', (p: { user: string }) => {
        records.push(fakeRecord('language_quality_check', critic.model, critic.cost, records.length));
        return { reviews: p.user.split('\n').slice(1).map((l) => ({ ref: (JSON.parse(l) as { ref: string }).ref, verdict: 'accept', issues: [], suggestedTargetText: null })), notes: [] };
      })
    : undefined;
  const { suite } = await generateFixtureSuite(target, { reasoner, reviewer, guard, records: () => records }, 'test');
  return suite!;
}

const ALL_REFS = ['expressions/0', 'expressions/1', 'dialogues/0', 'intents/0/acceptablePhrasings/0', 'intents/0/acceptablePhrasings/1', 'intents/0/unacceptable/0', 'confusionTest/pairs/0', 'confusionTest/pairs/1'];
const sheet = (suite: FixtureSuiteRecord, verdicts: Array<{ ref: string; verdict: string; correction?: string | null; note?: string | null }>, reviewer: object = REVIEWER) => ({ formatVersion: 1, kind: 'fixture_verdicts', suiteDraftId: suite.draftId, reviewer, reviewedAt: '2026-10-20T10:00:00Z', verdicts });

describe('ingestModelReview (pure)', () => {
  const items: ReviewItem[] = [
    { ref: 'a', kind: 'expression', speaker: 'learner', targetText: 'شكرا بزاف', meaning: 'Merci beaucoup.', context: null },
    { ref: 'b', kind: 'phrasing', speaker: 'learner', targetText: 'بغيت قهوة عافاك', meaning: 'Un café.', context: null },
    { ref: 'c', kind: 'dialogue', speaker: null, targetText: 'C: سلام\nL: سلام', meaning: 'Salut\nSalut', context: null },
    { ref: 'd', kind: 'phrasing', speaker: 'learner', targetText: 'الله يخليك', meaning: 'Merci.', context: null },
    { ref: 'e', kind: 'confusion_pair', speaker: null, targetText: 'لاباس؟', meaning: 'Ça va ?', context: null },
  ];

  it('validates critic output with Zod, reports bad refs and downgrades contradictory verdicts', () => {
    const out = ingestModelReview(
      items,
      [
        { reviews: [{ ref: 'a', verdict: 'reject', issues: [], suggestedTargetText: null }, { ref: 'b', verdict: 'accept', issues: [{ kind: 'wrong_variety', detail: ' Standard. ' }], suggestedTargetText: 'عطيني قهوة عافاك' }, { ref: 'a', verdict: 'accept', issues: [], suggestedTargetText: null }, { ref: 'zz', verdict: 'accept', issues: [], suggestedTargetText: null }], notes: ['  n1 '] },
        { reviews: 'not an array', notes: [] },
        { reviews: [{ ref: 'c', verdict: 'revise', issues: [{ kind: 'too_formal', detail: 'x' }], suggestedTargetText: 'C: ...' }, { ref: 'e', verdict: 'revise', issues: [{ kind: 'grammar_or_spelling', detail: 'y' }], suggestedTargetText: MSA }, { ref: 'd', verdict: 'maybe', issues: [], suggestedTargetText: null }], notes: [] },
        { reviews: [{ ref: 'd', verdict: 'accept', issues: [], suggestedTargetText: 'الله يخليك' }], notes: [] },
      ],
      { t: target, guard, batchModels: [['m/critic-1'], [], ['m/critic-2'], ['m/critic-3']] },
    );
    expect(out.annotations.map((a) => [a.ref, a.verdict])).toEqual([['a', 'revise'], ['b', 'revise'], ['d', 'accept']]);
    expect(out.annotations[0]!.reviewerModels).toEqual(['m/critic-1']);
    expect(out.annotations[1]).toMatchObject({ suggestion: 'عطيني قهوة عافاك', issues: [{ kind: 'wrong_variety', detail: 'Standard.' }] });
    expect(out.annotations[2]!.suggestion).toBeNull(); // identical to the target
    expect(out.unreviewedRefs).toEqual(['c', 'e']); // output 2 failed validation as a whole ('maybe' verdict)
    expect(out.ingestionIssues).toEqual(expect.arrayContaining(['reject_without_issue:a', 'accept_with_blocking_issue:b', 'duplicate_ref:a', 'unknown_ref:zz', expect.stringMatching(/^output_1_schema_invalid/), expect.stringMatching(/^output_2_schema_invalid: reviews\.2\.verdict/)]));
    expect(out.notes).toEqual(['n1']);
  });

  it('drops dialogue suggestions and suggestions that fail the language guard', () => {
    const out = ingestModelReview(items, [{ reviews: [{ ref: 'c', verdict: 'revise', issues: [{ kind: 'too_formal', detail: 'x' }], suggestedTargetText: 'C: ...' }, { ref: 'e', verdict: 'revise', issues: [{ kind: 'unnatural', detail: 'y' }], suggestedTargetText: MSA }, { ref: 'b', verdict: 'revise', issues: [{ kind: 'unnatural', detail: 'z' }], suggestedTargetText: 'Je voudrais un café' }], notes: [] }], { t: target, guard });
    expect(out.annotations.every((a) => a.suggestion === null)).toBe(true);
    expect(out.ingestionIssues).toEqual(['suggestion_not_allowed:c', 'suggestion_rejected_by_guard:e:wrong_variety', expect.stringMatching(/^suggestion_rejected_by_guard:b:/)]);
  });
});

describe('runSecondModelReview (fake critic)', () => {
  const items: ReviewItem[] = ['p0', 'p1', 'p2', 'p3', 'p4'].map((ref) => ({ ref, kind: 'phrasing', speaker: 'learner', targetText: 'شكرا بزاف', meaning: 'Merci.', context: null }));
  const accept = (prompt: { user: string }) => ({ reviews: prompt.user.split('\n').slice(1).map((l) => ({ ref: (JSON.parse(l) as { ref: string }).ref, verdict: 'accept', issues: [], suggestedTargetText: null })), notes: [] });

  it('batches items, stops at the budget and reports what was not reviewed', async () => {
    const records: AiRequestRecord[] = [];
    const fake = new FakeReasoner().on('language_quality_check', (p: { user: string }) => {
      records.push({ occurredAt: 'x', userId: null, enrollmentId: null, task: 'language_quality_check', provider: 'fake', model: 'fake/critic', profileId: null, fallbackIndex: 0, latencyMs: 1, inputTokens: 1, outputTokens: 1, audioSeconds: null, estimatedCostUsd: 0.1, success: true, errorCode: null, traceId: `r${records.length}`, redactedLog: null });
      return accept(p);
    });
    const res = await runSecondModelReview(target, items, { reviewer: fake, guard, records: () => records, budgetCheck: (l) => l.estimatedCostUsd < 0.15 }, { batchSize: 2, generatorModels: ['fake/generator'] });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.every((c) => c.task === 'language_quality_check')).toBe(true);
    expect(res.summary).toMatchObject({ status: 'partial', aborted: 'budget exhausted before second-model review batch 2', unreviewedRefs: ['p4'], counts: { items: 5, reviewed: 4, accept: 4, revise: 0, reject: 0 }, independent: true, reviewerModels: ['fake/critic'] });
    expect(res.summary.ledger).toMatchObject({ calls: 2, estimatedCostUsd: 0.2 });
  });

  it('records a failed stage when the critic call fails, without throwing', async () => {
    const res = await runSecondModelReview(target, items, { reviewer: new FakeReasoner(), guard, records: () => [] });
    expect(res.summary).toMatchObject({ status: 'failed', independent: null, counts: { reviewed: 0 } });
    expect(res.summary.ingestionIssues[0]).toMatch(/^batch_0_failed: Error: FakeReasoner: no response scripted/);
    expect(res.annotations).toEqual([]);
  });
});

describe('native verdict ingestion (§14.2 fixture suites)', () => {
  it('merges a valid sheet into a copy of the suite and summarises it, leaving the suite review_needed', async () => {
    const suite = await smallSuite();
    const res = ingestNativeVerdicts(
      suite,
      sheet(suite, [
        { ref: 'expressions/0', verdict: 'correct' },
        { ref: 'expressions/1', verdict: 'correct_with_edit', correction: 'بغيت واحد القهوة عافاك', note: 'Plus naturel avec واحد.' },
        { ref: 'dialogues/0', verdict: 'unnatural', note: 'Trop court.' },
        { ref: 'intents/0/acceptablePhrasings/0', verdict: 'correct' },
        { ref: 'intents/0/acceptablePhrasings/1', verdict: 'correct' },
        { ref: 'intents/0/unacceptable/0', verdict: 'correct' },
        { ref: 'confusionTest/pairs/0', verdict: 'correct' },
        { ref: 'confusionTest/pairs/1', verdict: 'wrong_variety' },
      ]),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.issues).toEqual([]);
    expect(res.summary).toEqual({ items: 8, reviewed: 8, complete: true, byVerdict: { correct: 5, correct_with_edit: 1, incorrect: 0, wrong_variety: 1, unnatural: 1, inappropriate: 0 }, acceptedShare: 0.75, naturalness: 0.875, dialectAdherence: 0.875, unreviewedRefs: [] });
    const s = res.suite;
    expect(s.expressions[1]).toMatchObject({ reviewed: true, verdict: 'correct_with_edit', nativeReview: { reviewerId: REVIEWER.reviewerId, reviewedAt: '2026-10-20T10:00:00Z', correction: 'بغيت واحد القهوة عافاك', note: 'Plus naturel avec واحد.' } });
    expect(s.confusionTest).toMatchObject({ reviewed: true, verdict: 'wrong_variety' });
    expect(s.nativeVerdictSheets).toEqual([{ ...REVIEWER, reviewedAt: '2026-10-20T10:00:00Z', applied: 8 }]);
    expect(s).toMatchObject({ status: 'review_needed', nativeReviewed: false });
    // the input suite is untouched
    expect(suite.expressions[0]).toMatchObject({ reviewed: false, verdict: null });
    expect(summarizeNativeVerdicts(suite).reviewed).toBe(0);
  });

  it('reports unknown, duplicate and incomplete entries, and records overrides by a second reviewer', async () => {
    const suite = await smallSuite();
    const first = ingestNativeVerdicts(suite, sheet(suite, [{ ref: 'expressions/0', verdict: 'correct' }, { ref: 'expressions/0', verdict: 'incorrect' }, { ref: 'expressions/7', verdict: 'correct' }, { ref: 'expressions/1', verdict: 'correct_with_edit' }]));
    expect(first.ok && first.issues).toEqual(['duplicate_ref:expressions/0', 'unknown_ref:expressions/7', 'correction_required:expressions/1']);
    if (!first.ok) return;
    expect(first.summary).toMatchObject({ reviewed: 1, complete: false, unreviewedRefs: ALL_REFS.filter((r) => r !== 'expressions/0') });
    const second = ingestNativeVerdicts(first.suite, sheet(suite, [{ ref: 'expressions/0', verdict: 'incorrect' }], OTHER_REVIEWER));
    expect(second.ok && second.issues).toEqual(['overrides_other_reviewer:expressions/0']);
    if (!second.ok) return;
    expect(second.suite.expressions[0]).toMatchObject({ verdict: 'incorrect', nativeReview: { reviewerId: OTHER_REVIEWER.reviewerId } });
    expect(second.suite.nativeVerdictSheets).toHaveLength(2);
  });

  it('rejects sheets for another suite, from a reviewer of another variety, or with invalid fields', async () => {
    const suite = await smallSuite();
    const ok = [{ ref: 'expressions/0', verdict: 'correct' }];
    expect(ingestNativeVerdicts(suite, { ...sheet(suite, ok), suiteDraftId: 'fixture:other' })).toEqual({ ok: false, errors: [expect.stringMatching(/^suite_mismatch/)] });
    expect(ingestNativeVerdicts(suite, sheet(suite, ok, { ...REVIEWER, nativeVarietyId: 'arb' }))).toEqual({ ok: false, errors: ['variety_mismatch: reviewer is native in arb, suite targets ary'] });
    const invalid = ingestNativeVerdicts(suite, sheet(suite, [{ ref: 'expressions/0', verdict: 'looks fine' }], { reviewerId: 'Fatima', role: 'support_readonly', nativeVarietyId: 'ary' }));
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.errors.join(' | ')).toMatch(/reviewer\.reviewerId/);
    expect(invalid.errors.join(' | ')).toMatch(/reviewer\.role/);
    expect(invalid.errors.join(' | ')).toMatch(/verdicts\.0\.verdict/);
    expect(ingestNativeVerdicts(suite, { ...sheet(suite, ok), nativeReviewed: true }).ok).toBe(false); // strict: no extra keys
    expect(ingestNativeVerdicts(suite, sheet(suite, [])).ok).toBe(false);
  });

  it('builds a sheet from a suite file the reviewer edited in place', async () => {
    const suite = await smallSuite();
    type Editable = { reviewed?: boolean; verdict?: string | null; correction?: string | null; reviewNote?: string | null };
    const file = JSON.parse(JSON.stringify(suite)) as { expressions: Editable[]; dialogues: Editable[]; intents: Array<{ acceptablePhrasings: Editable[] }> };
    file.expressions[0]!.verdict = 'correct';
    file.expressions[0]!.reviewed = true;
    file.intents[0]!.acceptablePhrasings[1]!.verdict = 'correct_with_edit';
    file.intents[0]!.acceptablePhrasings[1]!.correction = 'الله يخليك أخويا';
    file.intents[0]!.acceptablePhrasings[1]!.reviewNote = 'Ajouter أخويا.';
    file.dialogues[0]!.reviewed = true; // forgot the verdict
    expect(nativeVerdictsFromReviewedSuite(file, REVIEWER, '2026-10-20T11:00:00Z')).toEqual({ ok: false, errors: ['reviewed_without_verdict:dialogues/0'] });
    file.dialogues[0]!.verdict = 'maybe';
    const bad = nativeVerdictsFromReviewedSuite(file, REVIEWER, '2026-10-20T11:00:00Z');
    expect(bad.ok === false && bad.errors[0]).toMatch(/^dialogues\.0\.verdict/);
    file.dialogues[0]!.verdict = 'incorrect';
    const built = nativeVerdictsFromReviewedSuite(file, REVIEWER, '2026-10-20T11:00:00Z');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.sheet.verdicts.map((v) => [v.ref, v.verdict])).toEqual([['expressions/0', 'correct'], ['dialogues/0', 'incorrect'], ['intents/0/acceptablePhrasings/1', 'correct_with_edit']]);
    const merged = ingestNativeVerdicts(suite, built.sheet);
    expect(merged.ok && merged.suite.intents[0]!.acceptablePhrasings[1]!.nativeReview).toEqual({ reviewerId: REVIEWER.reviewerId, reviewedAt: '2026-10-20T11:00:00Z', correction: 'الله يخليك أخويا', note: 'Ajouter أخويا.' });
  });
});

describe('native verdicts → ai_model_benchmarks', () => {
  const PROFILE_ID = '66666666-6666-4666-8666-666666666666';

  it('maps the summary onto a valid benchmark row and only passes a complete, accurate, on-variety review', async () => {
    const suite = await smallSuite();
    expect(() => nativeVerdictBenchmarkRow(suite, PROFILE_ID)).toThrow(/no native verdicts/);
    const allCorrect = ingestNativeVerdicts(suite, sheet(suite, ALL_REFS.map((ref) => ({ ref, verdict: 'correct' }))));
    if (!allCorrect.ok) throw new Error('expected ok');
    const row = nativeVerdictBenchmarkRow(allCorrect.suite, PROFILE_ID);
    expect(DB_TABLES.ai_model_benchmarks.insert.safeParse(row).success).toBe(true);
    expect(row).toMatchObject({ profile_id: PROFILE_ID, model: 'fake/generator', target_variety_id: 'ary', source_language_code: 'fr', sample_set_id: suite.draftId, evaluator_version: 'native-fixture-verdicts@1', naturalness: 1, dialect_adherence: 1, wer: null, cost_per_call_usd: 0.01, passed: true, reviewer_id: REVIEWER.reviewerId });
    expect(row.notes).toMatch(/reviewed 8\/8; correct 8/);

    const oneWrongVariety = ingestNativeVerdicts(suite, sheet(suite, ALL_REFS.map((ref, i) => ({ ref, verdict: i === 7 ? 'wrong_variety' : 'correct' }))));
    if (!oneWrongVariety.ok) throw new Error('expected ok');
    expect(nativeVerdictBenchmarkRow(oneWrongVariety.suite, PROFILE_ID)).toMatchObject({ passed: false, dialect_adherence: 0.875 });
    const partial = ingestNativeVerdicts(suite, sheet(suite, [{ ref: 'expressions/0', verdict: 'correct' }]));
    if (!partial.ok) throw new Error('expected ok');
    expect(nativeVerdictBenchmarkRow(partial.suite, PROFILE_ID)).toMatchObject({ passed: false });
    expect(nativeVerdictBenchmarkRow(partial.suite, PROFILE_ID).notes).toMatch(/\(incomplete\)/);
  });

  it('attributes the row to the generating model and its cost only, when a critic reviewed the suite', async () => {
    const suite = await smallSuite({ generatorCost: 0.05, critic: { model: 'fake/critic', cost: 0.001 } });
    expect(suite.secondModelReview).toMatchObject({ status: 'complete', reviewerModels: ['fake/critic'], ledger: { models: ['fake/critic'], calls: 1, estimatedCostUsd: 0.001 } });
    const reviewed = ingestNativeVerdicts(suite, sheet(suite, [...fixtureItemRefs(suite).keys()].map((ref) => ({ ref, verdict: 'correct' }))));
    if (!reviewed.ok) throw new Error('expected ok');
    const row = nativeVerdictBenchmarkRow(reviewed.suite, PROFILE_ID);
    expect(DB_TABLES.ai_model_benchmarks.insert.safeParse(row).success).toBe(true);
    expect(row).toMatchObject({ model: 'fake/generator', cost_per_call_usd: 0.05, passed: true });
  });

  it('records the row against the resolved content_generation profile through the repository (in-memory fake)', async () => {
    const suite = await smallSuite();
    const reviewed = ingestNativeVerdicts(suite, sheet(suite, ALL_REFS.map((ref) => ({ ref, verdict: 'correct' }))));
    if (!reviewed.ok) throw new Error('expected ok');
    const resolveCalls: unknown[][] = [];
    const inserted: unknown[] = [];
    const repo = {
      async resolve(...args: unknown[]) {
        resolveCalls.push(args);
        return { id: PROFILE_ID } as Row<'ai_model_profiles'>;
      },
      async recordBenchmark(row: unknown) {
        inserted.push(row);
        return { ...(row as object), id: 'b1' } as Row<'ai_model_benchmarks'>;
      },
    };
    const row = await recordNativeVerdictBenchmark(repo, reviewed.suite);
    expect(resolveCalls).toEqual([['content_generation', 'ary', 'fr']]);
    expect(inserted).toHaveLength(1);
    expect(row).toMatchObject({ id: 'b1', profile_id: PROFILE_ID, passed: true });
    await expect(recordNativeVerdictBenchmark({ ...repo, resolve: async () => null }, reviewed.suite)).rejects.toThrow(/no enabled content_generation profile for ary × fr/);
  });
});
