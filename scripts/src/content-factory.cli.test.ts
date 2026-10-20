/**
 * The content-factory CLI end to end with fake reasoners (no network, no database, no spend): the chapter record is
 * written the way the fixture path writes its suite (diversity gate and critic as `quality`, `gaps`, generator-only
 * `generation` ledger), always `review_needed` / unreviewed, the database step is a dry run unless `--apply`, and a
 * mission the diversity gate marked reaches `--apply` with the `diversity_needs_regeneration` flag on its expressions.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { AiTaskName, LanguageContext, Prompt, TextReasoner, TextReasonerOptions } from '@langquest/contracts';
import type { AiRequestRecord } from '@langquest/ai';
import { FakeReasoner } from '@langquest/ai/test-support/fakes';
import { main, spec, type ContentFactoryInject } from './content-factory';
import { memoryIo, runCli } from './lib/cli';
import { chapterToExpressionDrafts, type ChapterDraftRecord, type MissionDraftLlm } from './lib/content-factory';
import type { ModelReviewLlm } from './lib/content-review';
import type { ExpressionDraft } from './lib/drafts';
import type { ApplyResult } from './lib/expression-apply';

const record = (task: AiTaskName, model: string, n: number, cost: number): AiRequestRecord => ({ occurredAt: 'x', userId: null, enrollmentId: null, task, provider: 'fake', model, profileId: null, fallbackIndex: 0, latencyMs: 1, inputTokens: 10, outputTokens: 10, audioSeconds: null, estimatedCostUsd: cost, success: true, errorCode: null, traceId: `t${n}`, redactedLog: null });

/** Wrap a fake so each call leaves an `ai_requests`-shaped record, as the real sink does. */
function recorded(inner: TextReasoner, records: AiRequestRecord[], model: string, cost = 0.01): TextReasoner & { prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  return {
    prompts,
    async generateStructured<T>(task: AiTaskName, ctx: LanguageContext, prompt: Prompt, schema: z.ZodType<T>, options?: TextReasonerOptions): Promise<T> {
      prompts.push(prompt);
      records.push(record(task, model, records.length, cost));
      return inner.generateStructured(task, ctx, prompt, schema, options);
    },
  };
}

// --- a Darija café mission: one phrasing per learner intent fails the gate; a variant passes -----------------------
const form = (arab: string, arabizi: string) => [
  { script: 'Arab' as const, transliterationScheme: null, text: arab },
  { script: 'Latn' as const, transliterationScheme: 'arabizi' as const, text: arabizi },
];
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

const refsIn = (prompt: Prompt): string[] => prompt.user.split('\n').slice(1).map((line) => (JSON.parse(line) as { ref: string }).ref);
const acceptingCritic = (): FakeReasoner => new FakeReasoner().on('language_quality_check', (prompt: Prompt): ModelReviewLlm => ({ reviews: refsIn(prompt).map((ref) => ({ ref, verdict: 'accept' as const, issues: [], suggestedTargetText: null })), notes: [] }));

const BASE = ['--track', 'arabic-moroccan', '--source', 'fr', '--blueprints', 'cafe_order_drink'];

async function runFactory(argv: string[], inject: ContentFactoryInject) {
  const outDir = mkdtempSync(join(tmpdir(), 'cf-cli-'));
  const io = memoryIo();
  const code = await runCli(spec, [...BASE, '--out-dir', outDir, ...argv], (args, cliIo) => main(args, cliIo, { stamp: 'test', ...inject }), io);
  const read = (): ChapterDraftRecord => JSON.parse(readFileSync(join(outDir, 'arabic-moroccan-fr-chapter-test.json'), 'utf8')) as ChapterDraftRecord;
  return { code, io, read, outDir };
}

describe('content-factory CLI chapter record (fake reasoners)', () => {
  it('writes the chapter record with the diversity gate, gaps and a generator-only ledger; the database is a dry run by default', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', (p: Prompt) => (p.user.includes('failed the diversity gate') ? withVariant() : cafeDraft())), records, 'fake/generator');
    const applyDrafts = vi.fn<(drafts: readonly ExpressionDraft[]) => Promise<ApplyResult>>();
    const { code, io, read } = await runFactory(['--live'], { reasoner, records: () => records, applyDrafts });
    expect(code, io.errors.join('\n')).toBe(0);
    expect(reasoner.prompts).toHaveLength(1); // no paid regeneration unless asked
    const rec = read();
    expect(rec).toMatchObject({ kind: 'chapter_draft', draftId: 'factory:arabic_moroccan_ch1_factory_fr:test', status: 'review_needed', nativeReviewed: false, provenance: { dataset: 'content_factory', snapshotId: 'content-factory@1.1.0/fake/generator' } });
    expect(rec.chapter).toMatchObject({ reviewStatus: 'review_needed', nativeReviewed: false });
    expect(rec.generation).toMatchObject({ calls: 1, models: ['fake/generator'], live: true });
    expect(rec.quality!.diversity).toEqual([expect.objectContaining({ blueprintKey: 'cafe_order_drink', verdict: 'needs_regeneration', reasons: ['low_alternative_coverage:0'] })]);
    expect(rec.quality!.secondModelReview).toBeNull();
    expect(rec.gaps).toEqual(['diversity gate: cafe_order_drink needs regeneration (low_alternative_coverage:0)', 'diversity regeneration skipped: not requested (regenerateOnLowDiversity is off)']);
    expect(io.warnings).toEqual(expect.arrayContaining(['gap: diversity gate: cafe_order_drink needs regeneration (low_alternative_coverage:0)']));
    // The record carries the gate into --apply: every expression of the marked mission is flagged.
    const drafts = chapterToExpressionDrafts(rec);
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.status === 'review_needed' && d.nativeReviewed === false && d.curation.flags.includes('diversity_needs_regeneration'))).toBe(true);
    expect(io.lines.join('\n')).toContain(`database: dry run (default) — --apply would upsert ${drafts.length} expression drafts (state review_needed, never published), ${drafts.length} flagged diversity_needs_regeneration`);
    expect(applyDrafts).not.toHaveBeenCalled();
  });

  it('--apply hands the review_needed, flagged drafts to the database step', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', cafeDraft()), records, 'fake/generator');
    const applyDrafts = vi.fn(async (drafts: readonly ExpressionDraft[]): Promise<ApplyResult> => ({ inserted: drafts.length, skippedExisting: 0, skippedNoVariety: 0, skippedNoIntent: 0, rightsCreated: 1, translationsUpserted: drafts.length, errors: [] }));
    const { code, io } = await runFactory(['--live', '--apply'], { reasoner, records: () => records, applyDrafts });
    expect(code, io.errors.join('\n')).toBe(0);
    expect(applyDrafts).toHaveBeenCalledTimes(1);
    const drafts = applyDrafts.mock.calls[0]![0];
    expect(drafts.every((d) => d.status === 'review_needed' && d.nativeReviewed === false && d.rights.verified === false && d.curation.flags.includes('diversity_needs_regeneration'))).toBe(true);
    expect(io.lines.join('\n')).toMatch(/applied \d+ expression drafts \(state review_needed, never published\), \d+ flagged diversity_needs_regeneration .* inserted=\d+/);
  });

  it('--regenerate-low-diversity re-runs the mission once with the gate reasons; the passing draft carries no flag', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', (p: Prompt) => (p.user.includes('failed the diversity gate') ? withVariant() : cafeDraft())), records, 'fake/generator');
    const { code, io, read } = await runFactory(['--live', '--regenerate-low-diversity'], { reasoner, records: () => records });
    expect(code, io.errors.join('\n')).toBe(0);
    expect(io.lines.join('\n')).toContain('chapter plan: 1 model calls (cafe_order_drink), up to 1 more to regenerate low-diversity missions');
    expect(reasoner.prompts).toHaveLength(2);
    expect(reasoner.prompts[1]!.user).toMatch(/failed the diversity gate/);
    const rec = read();
    expect(rec.quality!.diversity[0]).toMatchObject({ verdict: 'diverse', reasons: [] });
    expect(rec.gaps).toEqual([]);
    expect(rec.generation).toMatchObject({ calls: 2 });
    expect(chapterToExpressionDrafts(rec).some((d) => d.curation.flags.includes('diversity_needs_regeneration'))).toBe(false);
    expect(io.lines.join('\n')).toMatch(/database: dry run \(default\) — --apply would upsert \d+ expression drafts \(state review_needed, never published\); nothing written/);
  });

  it('--review-model adds the advisory critic: its verdicts are in quality, its calls stay out of the generation ledger', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', withVariant()), records, 'fake/generator', 0.05);
    const reviewer = recorded(acceptingCritic(), records, 'fake/critic', 0.001);
    const { code, io, read } = await runFactory(['--live', '--review-model', 'fake/critic'], { reasoner, reviewer, records: () => records });
    expect(code, io.errors.join('\n')).toBe(0);
    expect(io.lines.join('\n')).toContain('+ second-model review on fake/critic (advisory');
    const rec = read();
    expect(rec.quality!.secondModelReview).toMatchObject({ status: 'complete', independent: true, reviewerModels: ['fake/critic'], counts: { accept: 7, reject: 0 } });
    expect(rec.generation).toMatchObject({ calls: 1, models: ['fake/generator'], estimatedCostUsd: 0.05 });
    expect(rec.gaps).toEqual([]);
    expect(rec).toMatchObject({ status: 'review_needed', nativeReviewed: false });
    expect(chapterToExpressionDrafts(rec).every((d) => d.curation.flags.includes('second_model_accept'))).toBe(true);
  });

  it('never calls a model without --live (dry-run default), even with a reasoner at hand', async () => {
    const records: AiRequestRecord[] = [];
    const reasoner = recorded(new FakeReasoner().on('content_generation', cafeDraft()), records, 'fake/generator');
    const prevLive = process.env.LANGQUEST_LIVE_TESTS;
    delete process.env.LANGQUEST_LIVE_TESTS;
    try {
      const plain = await runFactory([], { reasoner, records: () => records });
      expect(plain.code).toBe(0);
      expect(plain.io.warnings.join('\n')).toMatch(/No live generation/);
      const dry = await runFactory(['--live', '--dry-run', '--regenerate-low-diversity'], { reasoner, records: () => records });
      expect(dry.code).toBe(0);
      expect(dry.io.lines.join('\n')).toContain('dry-run: no model call, nothing written');
      const fixturePlan = memoryIo();
      expect(await runCli(spec, ['--track', 'japanese', '--source', 'en', '--fixture-suite', '--regenerate-low-diversity', '--dry-run'], (args, cliIo) => main(args, cliIo, { reasoner, records: () => records }), fixturePlan)).toBe(0);
      expect(fixturePlan.lines.join('\n')).toMatch(/fixture suite plan \(§14\.2\): up to 5 model calls/);
    } finally {
      if (prevLive !== undefined) process.env.LANGQUEST_LIVE_TESTS = prevLive;
    }
    expect(reasoner.prompts).toHaveLength(0);
    expect(records).toHaveLength(0);
  });
});
