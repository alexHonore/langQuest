/**
 * Content factory review stages (spec §9.8 "→ syntactic + semantic + rubric validator → optional
 * second-model review → native speaker editorial review", §14.2 native evaluation sets).
 *
 * 1. **Second-model review** (`runSecondModelReview`): an independent critic reads the drafted items
 *    through the same `TextReasoner` interface (task `language_quality_check`, whose profile routes
 *    to a different model than `content_generation`) and returns accept / revise / reject with typed
 *    issues. Its output is Zod-validated and ingested (`ingestModelReview`) as annotations on the
 *    draft records. The critic is advisory: it never approves, publishes, marks anything
 *    native-reviewed or removes content (the deterministic validators stay the only automatic
 *    filter), a critic suggestion must itself pass the language guard, and a critic that runs on a
 *    generator model is recorded as a self-review.
 *    Output budget: a batch of 20 reviews needs a few thousand output tokens, and `TextReasonerOptions`
 *    carries no output budget. Pass a reasoner with a batch budget (`ScriptsTextReasoner`, which
 *    overrides `maxOutputTokens`, or a reasoner over a dedicated batch-latency profile). The
 *    package-default `language_quality_check` profile (200 output tokens, 8 s, interactive) truncates
 *    every batch, and each truncated reply costs paid repair calls, so the standard
 *    `OpenRouterTextReasoner` (as used by `apps/jobs`) is not a suitable critic until such a profile exists.
 * 2. **Native verdict ingestion** (`ingestNativeVerdicts`): a native reviewer's verdict sheet (or the
 *    reviewed fixture-suite file itself, `nativeVerdictsFromReviewedSuite`) is validated with Zod —
 *    reviewer identity is an `auth.users` id, the reviewer's native variety must be the suite's
 *    variety (no boundary crossing) — and merged into the suite record. The suite stays
 *    `review_needed` / `nativeReviewed: false`: the coverage editor's `native_reviewed` flag remains
 *    the sign-off. The summary maps onto an `ai_model_benchmarks` row for the generating model
 *    (`nativeVerdictBenchmarkRow`, `recordNativeVerdictBenchmark`): model and cost come from the suite's
 *    `generation` ledger, which holds the `content_generation` calls only (never the critic's).
 */
import { z } from 'zod';
import { UuidSchema, VarietyIdSchema, getVariety, type AiTaskName, type Prompt, type TextReasoner } from '@langquest/contracts';
import { coachingLanguageInstruction, getPromptPack, varietyGuardInstruction, type AiRequestRecord, type LanguageGuard } from '@langquest/ai';
import type { AiProfilesRepository, Insert, Row } from '@langquest/db';
import type { FactoryTarget, FixtureSuiteRecord } from './content-factory';
import { ledgerFromRecords, type GenerationLedger } from './content-ledger';
import { normalizeText } from './text';

// ---------------------------------------------------------------------------
// Second-model review
// ---------------------------------------------------------------------------

export const SECOND_MODEL_REVIEW_TEMPLATE_VERSION = '2026-10-20.1';
export const SECOND_MODEL_REVIEW_TASK = 'language_quality_check' as const satisfies AiTaskName;

export const REVIEW_ISSUE_KINDS = ['wrong_variety', 'source_language_leak', 'unnatural', 'too_formal', 'grammar_or_spelling', 'meaning_mismatch', 'script_or_transliteration', 'insensitive', 'not_useful', 'other'] as const;
export type ReviewIssueKind = (typeof REVIEW_ISSUE_KINDS)[number];
/** Issue kinds that contradict an `accept` verdict. */
export const BLOCKING_REVIEW_ISSUE_KINDS: readonly ReviewIssueKind[] = ['wrong_variety', 'source_language_leak', 'meaning_mismatch', 'insensitive'];
export const MODEL_VERDICTS = ['accept', 'revise', 'reject'] as const;
export type ModelVerdict = (typeof MODEL_VERDICTS)[number];

/** Critic output (strict-compatible: every key required, nullable instead of optional). */
export const ModelReviewLlmSchema = z.object({
  reviews: z.array(
    z.object({
      ref: z.string(),
      verdict: z.enum(MODEL_VERDICTS),
      issues: z.array(z.object({ kind: z.enum(REVIEW_ISSUE_KINDS), detail: z.string() })),
      suggestedTargetText: z.string().nullable(),
    }),
  ),
  notes: z.array(z.string()),
});
export type ModelReviewLlm = z.infer<typeof ModelReviewLlmSchema>;

export type ReviewItemKind = 'expression' | 'phrasing' | 'dialogue' | 'confusion_pair';

/** One drafted item sent to the critic. `ref` is the item's path in the draft record. */
export interface ReviewItem {
  ref: string;
  kind: ReviewItemKind;
  speaker: 'learner' | 'character' | null;
  /** Target-language text (a dialogue is rendered one `L:`/`C:` turn per line). */
  targetText: string;
  /** Meaning in the learner's source language. */
  meaning: string;
  context: string | null;
}

export interface ModelReviewAnnotation {
  ref: string;
  verdict: ModelVerdict;
  issues: Array<{ kind: ReviewIssueKind; detail: string }>;
  /** Critic's alternative wording for single-line items, guard-checked; never applied automatically. */
  suggestion: string | null;
  reviewerModels: string[];
}

export interface SecondModelReviewSummary {
  stage: 'second_model_review';
  task: typeof SECOND_MODEL_REVIEW_TASK;
  templateVersion: string;
  /** Advisory only: a model verdict never approves, publishes or replaces native review. */
  advisoryOnly: true;
  status: 'complete' | 'partial' | 'failed';
  reviewerModels: string[];
  generatorModels: string[];
  /** False when the critic ran on a model that also generated the drafts; null when unknown. */
  independent: boolean | null;
  counts: { items: number; reviewed: number; accept: number; revise: number; reject: number };
  unreviewedRefs: string[];
  ingestionIssues: string[];
  warnings: string[];
  notes: string[];
  ledger: GenerationLedger;
  aborted: string | null;
}

export interface SecondModelReviewResult {
  summary: SecondModelReviewSummary;
  annotations: ModelReviewAnnotation[];
}

export interface ReviewDeps {
  reviewer: TextReasoner;
  guard: LanguageGuard;
  records: () => readonly AiRequestRecord[];
  budgetCheck?: (ledger: GenerationLedger) => boolean;
  log?: (line: string) => void;
}

const BLOCKING_GUARD_KINDS = new Set(['wrong_script', 'wrong_variety', 'source_language_leak', 'wrong_han_variant']);
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Critic prompt for one batch of items. */
export function buildSecondModelReviewPrompt(t: FactoryTarget, items: readonly ReviewItem[]): Prompt {
  const pack = getPromptPack(t.varietyId);
  const variety = getVariety(t.varietyId);
  const confusable = variety.mustNotSubstitute.map((v) => getVariety(v).name).join(', ');
  const system = [
    `You are an independent second reviewer for ${pack.name} (${variety.name}; ${variety.regionalNotes}). Another model drafted the items below for a conversation-first beginner course; you did not write them and you must not defend them.`,
    varietyGuardInstruction(pack, t.sourceLanguage),
    `For each item choose a verdict: "accept" when a local would naturally say this in ${variety.name} today, it means what "meaning" says and the register fits; "revise" when the idea is usable but the wording, register, spelling, script/transliteration or meaning needs a fix; "reject" when it is the wrong variety${confusable ? ` (${confusable})` : ''}, leaks the source language, means something else, is insensitive, or is useless in a real conversation.`,
    `List every problem in "issues" with a kind from: ${REVIEW_ISSUE_KINDS.join(', ')}; "detail" is one short sentence in the learner's source language "${t.sourceLanguage}". A "reject" needs at least one issue.`,
    `"suggestedTargetText": a corrected ${variety.name} wording (script ${t.primaryScript}) for an expression, phrasing or confusion pair you did not accept, otherwise null; always null for a dialogue.`,
    'You cannot approve anything for publishing: a native speaker reviews after you, so flag doubts instead of guessing.',
    coachingLanguageInstruction(t.sourceLanguage),
    'Return only JSON {"reviews": [{"ref", "verdict", "issues": [{"kind", "detail"}], "suggestedTargetText"}] with exactly one review per item and the same ref, "notes": [at most 3 short caveats]}.',
  ].join('\n\n');
  const user = `Items to review (${items.length}, one JSON object per line):\n${items.map((i) => JSON.stringify({ ref: i.ref, kind: i.kind, speaker: i.speaker, target: i.targetText, meaning: i.meaning, context: i.context })).join('\n')}`;
  return { templateId: 'content_factory.second_model_review', templateVersion: SECOND_MODEL_REVIEW_TEMPLATE_VERSION, system, user };
}

/**
 * Validate critic outputs (raw JSON or parsed) against the items that were sent and turn them into
 * annotations. Unknown and duplicate refs are reported, never applied; contradictory verdicts are
 * downgraded to `revise`; suggestions that fail the language guard are dropped.
 */
export function ingestModelReview(items: readonly ReviewItem[], outputs: readonly unknown[], ctx: { t: FactoryTarget; guard: LanguageGuard; batchModels?: ReadonlyArray<readonly string[]> }): { annotations: ModelReviewAnnotation[]; unreviewedRefs: string[]; ingestionIssues: string[]; notes: string[] } {
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const seen = new Map<string, ModelReviewAnnotation>();
  const ingestionIssues: string[] = [];
  const notes: string[] = [];
  outputs.forEach((raw, b) => {
    const parsed = ModelReviewLlmSchema.safeParse(raw);
    if (!parsed.success) {
      ingestionIssues.push(`output_${b}_schema_invalid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '$'} ${i.message}`).join('; ')}`);
      return;
    }
    notes.push(...parsed.data.notes.map(normalizeText).filter(Boolean));
    for (const r of parsed.data.reviews) {
      const item = byRef.get(r.ref);
      if (!item) {
        ingestionIssues.push(`unknown_ref:${r.ref}`);
        continue;
      }
      if (seen.has(r.ref)) {
        ingestionIssues.push(`duplicate_ref:${r.ref}`);
        continue;
      }
      const issues = r.issues.map((i) => ({ kind: i.kind, detail: normalizeText(i.detail) }));
      let verdict: ModelVerdict = r.verdict;
      if (verdict === 'reject' && issues.length === 0) {
        verdict = 'revise';
        ingestionIssues.push(`reject_without_issue:${r.ref}`);
      }
      if (verdict === 'accept' && issues.some((i) => BLOCKING_REVIEW_ISSUE_KINDS.includes(i.kind))) {
        verdict = 'revise';
        ingestionIssues.push(`accept_with_blocking_issue:${r.ref}`);
      }
      let suggestion = r.suggestedTargetText ? normalizeText(r.suggestedTargetText) || null : null;
      if (suggestion && item.kind === 'dialogue') {
        ingestionIssues.push(`suggestion_not_allowed:${r.ref}`);
        suggestion = null;
      }
      if (suggestion && suggestion === normalizeText(item.targetText)) suggestion = null;
      if (suggestion) {
        const g = ctx.guard.checkHeuristic(suggestion, ctx.t.varietyId, 'native', { sourceLanguage: ctx.t.sourceLanguage, track: ctx.t.courseTrackId });
        const bad = g.issues.filter((i) => BLOCKING_GUARD_KINDS.has(i.kind));
        if (bad.length) {
          ingestionIssues.push(`suggestion_rejected_by_guard:${r.ref}:${unique(bad.map((i) => i.kind)).join('+')}`);
          suggestion = null;
        }
      }
      seen.set(r.ref, { ref: r.ref, verdict, issues, suggestion, reviewerModels: [...(ctx.batchModels?.[b] ?? [])] });
    }
  });
  return {
    annotations: items.filter((i) => seen.has(i.ref)).map((i) => seen.get(i.ref)!),
    unreviewedRefs: items.filter((i) => !seen.has(i.ref)).map((i) => i.ref),
    ingestionIssues,
    notes,
  };
}

/** Run the critic over the items in batches (budget-checked before each call) and ingest its verdicts. */
export async function runSecondModelReview(t: FactoryTarget, items: readonly ReviewItem[], deps: ReviewDeps, options: { batchSize?: number; generatorModels?: readonly string[] } = {}): Promise<SecondModelReviewResult> {
  const batchSize = Math.max(1, options.batchSize ?? 20);
  const start = deps.records().length;
  const outputs: unknown[] = [];
  const batchModels: string[][] = [];
  const callIssues: string[] = [];
  let aborted: string | null = null;
  for (let i = 0; i < items.length && !aborted; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const n = i / batchSize;
    if (deps.budgetCheck && !deps.budgetCheck(ledgerFromRecords(deps.records()))) {
      aborted = `budget exhausted before second-model review batch ${n}`;
      break;
    }
    const before = deps.records().length;
    try {
      outputs.push(await deps.reviewer.generateStructured(SECOND_MODEL_REVIEW_TASK, t.context, buildSecondModelReviewPrompt(t, batch), ModelReviewLlmSchema));
      batchModels.push(unique(deps.records().slice(before).map((r) => r.model)));
    } catch (err) {
      callIssues.push(`batch_${n}_failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      deps.log?.(`second-model review batch ${n} failed`);
    }
  }
  const ingested = ingestModelReview(items, outputs, { t, guard: deps.guard, batchModels });
  const all = deps.records();
  const reviewRecords = all.slice(start);
  const reviewerModels = unique(reviewRecords.filter((r) => r.task === SECOND_MODEL_REVIEW_TASK).map((r) => r.model));
  const generatorModels = unique(options.generatorModels ?? all.slice(0, start).filter((r) => r.task === 'content_generation' && r.success).map((r) => r.model));
  const independent = reviewerModels.length && generatorModels.length ? !reviewerModels.some((m) => generatorModels.includes(m)) : null;
  const warnings = independent === false ? reviewerModels.filter((m) => generatorModels.includes(m)).map((m) => `self_review:${m}`) : [];
  const count = (v: ModelVerdict): number => ingested.annotations.filter((a) => a.verdict === v).length;
  const reviewed = ingested.annotations.length;
  return {
    annotations: ingested.annotations,
    summary: {
      stage: 'second_model_review',
      task: SECOND_MODEL_REVIEW_TASK,
      templateVersion: SECOND_MODEL_REVIEW_TEMPLATE_VERSION,
      advisoryOnly: true,
      status: items.length === 0 ? 'complete' : reviewed === 0 ? 'failed' : reviewed < items.length || aborted ? 'partial' : 'complete',
      reviewerModels,
      generatorModels,
      independent,
      counts: { items: items.length, reviewed, accept: count('accept'), revise: count('revise'), reject: count('reject') },
      unreviewedRefs: ingested.unreviewedRefs,
      ingestionIssues: [...callIssues, ...ingested.ingestionIssues],
      warnings,
      notes: ingested.notes.slice(0, 10),
      ledger: ledgerFromRecords(reviewRecords),
      aborted,
    },
  };
}

/** Curation flags for an expression draft (`expressions.script_annotations.curation.flags` on apply). */
export function modelReviewFlags(a: ModelReviewAnnotation | null | undefined): string[] {
  if (!a) return [];
  return [`second_model_${a.verdict}`, ...unique(a.issues.map((i) => `second_model_issue:${i.kind}`))];
}

/** One-line reviewer note for chapter notes and logs. */
export function describeSecondModelReview(s: SecondModelReviewSummary): string {
  return `second-model review (${s.reviewerModels.join(', ') || 'no model'}${s.independent === false ? ', SELF-REVIEW' : s.independent ? ', independent of the generator' : ''}): ${s.status}; accept ${s.counts.accept} / revise ${s.counts.revise} / reject ${s.counts.reject} of ${s.counts.items}${s.unreviewedRefs.length ? `, ${s.unreviewedRefs.length} unreviewed` : ''}; advisory only, the native reviewer decides.`;
}

// ---------------------------------------------------------------------------
// Native verdicts (fixture suites, §14.2)
// ---------------------------------------------------------------------------

export const NATIVE_VERDICTS = ['correct', 'correct_with_edit', 'incorrect', 'wrong_variety', 'unnatural', 'inappropriate'] as const;
export type NativeVerdict = (typeof NATIVE_VERDICTS)[number];
export const NATIVE_VERDICT_FORMAT_VERSION = 1 as const;
export const NATIVE_VERDICT_EVALUATOR_VERSION = `native-fixture-verdicts@${NATIVE_VERDICT_FORMAT_VERSION}`;
const ACCEPTED_VERDICTS = new Set<NativeVerdict>(['correct', 'correct_with_edit']);
const REVIEWER_ROLES = ['language_reviewer', 'content_editor', 'admin', 'super_admin'] as const;

export interface NativeReviewEntry {
  reviewerId: string;
  reviewedAt: string;
  correction: string | null;
  note: string | null;
}

/** Review state carried by every reviewable fixture item. */
export interface ItemReviewState {
  reviewed: boolean;
  verdict: NativeVerdict | null;
  nativeReview: NativeReviewEntry | null;
  modelReview: ModelReviewAnnotation | null;
}

export const unreviewedState = (): ItemReviewState => ({ reviewed: false, verdict: null, nativeReview: null, modelReview: null });

export const NativeVerdictSheetSchema = z.strictObject({
  formatVersion: z.literal(NATIVE_VERDICT_FORMAT_VERSION),
  kind: z.literal('fixture_verdicts'),
  suiteDraftId: z.string().min(1),
  reviewer: z.strictObject({
    /** `auth.users` id of the reviewer (identity is never free text). */
    reviewerId: UuidSchema,
    role: z.enum(REVIEWER_ROLES),
    /** The variety the reviewer is a native speaker of; must equal the suite's variety. */
    nativeVarietyId: VarietyIdSchema,
  }),
  reviewedAt: z.iso.datetime({ offset: true }),
  verdicts: z
    .array(
      z.strictObject({
        ref: z.string().min(1),
        verdict: z.enum(NATIVE_VERDICTS),
        correction: z.string().nullable().default(null),
        note: z.string().nullable().default(null),
      }),
    )
    .min(1),
});
export type NativeVerdictSheet = z.infer<typeof NativeVerdictSheetSchema>;

export interface NativeVerdictSummary {
  items: number;
  reviewed: number;
  complete: boolean;
  byVerdict: Record<NativeVerdict, number>;
  /** (correct + correct_with_edit) / reviewed. */
  acceptedShare: number | null;
  /** 1 − unnatural / reviewed. */
  naturalness: number | null;
  /** 1 − wrong_variety / reviewed. */
  dialectAdherence: number | null;
  unreviewedRefs: string[];
}

export interface NativeVerdictSheetRef {
  reviewerId: string;
  role: (typeof REVIEWER_ROLES)[number];
  nativeVarietyId: string;
  reviewedAt: string;
  applied: number;
}

export type NativeVerdictIngestion = { ok: true; suite: FixtureSuiteRecord; summary: NativeVerdictSummary; issues: string[] } | { ok: false; errors: string[] };

/** Every reviewable item of a suite, by ref (`expressions/3`, `intents/0/acceptablePhrasings/2`, `confusionTest/pairs/1`…). */
export function fixtureItemRefs(suite: FixtureSuiteRecord): Map<string, ItemReviewState> {
  const out = new Map<string, ItemReviewState>();
  suite.expressions.forEach((e, i) => out.set(`expressions/${i}`, e));
  suite.dialogues.forEach((d, i) => out.set(`dialogues/${i}`, d));
  suite.intents.forEach((intent, i) => {
    intent.acceptablePhrasings.forEach((p, j) => out.set(`intents/${i}/acceptablePhrasings/${j}`, p));
    intent.unacceptable.forEach((u, j) => out.set(`intents/${i}/unacceptable/${j}`, u));
  });
  suite.confusionTest.pairs.forEach((p, k) => out.set(`confusionTest/pairs/${k}`, p));
  return out;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Summarise the native verdicts currently on a suite. */
export function summarizeNativeVerdicts(suite: FixtureSuiteRecord): NativeVerdictSummary {
  const items = [...fixtureItemRefs(suite).entries()];
  const byVerdict = Object.fromEntries(NATIVE_VERDICTS.map((v) => [v, 0])) as Record<NativeVerdict, number>;
  let reviewed = 0;
  for (const [, s] of items) {
    if (!s.reviewed || !s.verdict) continue;
    reviewed += 1;
    byVerdict[s.verdict] += 1;
  }
  const share = (n: number): number | null => (reviewed ? round3(n / reviewed) : null);
  return {
    items: items.length,
    reviewed,
    complete: items.length > 0 && reviewed === items.length,
    byVerdict,
    acceptedShare: share(byVerdict.correct + byVerdict.correct_with_edit),
    naturalness: reviewed ? round3(1 - byVerdict.unnatural / reviewed) : null,
    dialectAdherence: reviewed ? round3(1 - byVerdict.wrong_variety / reviewed) : null,
    unreviewedRefs: items.filter(([, s]) => !s.reviewed).map(([ref]) => ref),
  };
}

/**
 * Validate a native reviewer's verdict sheet and merge it into a copy of the suite. Rejects the
 * whole sheet when it targets another suite or the reviewer is not native in the suite's variety;
 * reports unknown/duplicate refs and edits without a correction. The suite stays `review_needed`
 * and `nativeReviewed: false` (sign-off happens in the coverage editor).
 */
export function ingestNativeVerdicts(suite: FixtureSuiteRecord, rawSheet: unknown): NativeVerdictIngestion {
  const parsed = NativeVerdictSheetSchema.safeParse(rawSheet);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`) };
  const sheet = parsed.data;
  const errors: string[] = [];
  if (sheet.suiteDraftId !== suite.draftId) errors.push(`suite_mismatch: sheet is for ${sheet.suiteDraftId}, suite is ${suite.draftId}`);
  if (sheet.reviewer.nativeVarietyId !== suite.targetVarietyId) errors.push(`variety_mismatch: reviewer is native in ${sheet.reviewer.nativeVarietyId}, suite targets ${suite.targetVarietyId}`);
  if (errors.length) return { ok: false, errors };
  const next = structuredClone(suite);
  next.nativeVerdictSheets ??= []; // suites written before 2026-10-20 have no ingestion fields
  const refs = fixtureItemRefs(next);
  const issues: string[] = [];
  const seen = new Set<string>();
  let applied = 0;
  for (const v of sheet.verdicts) {
    const item = refs.get(v.ref);
    if (!item) {
      issues.push(`unknown_ref:${v.ref}`);
      continue;
    }
    if (seen.has(v.ref)) {
      issues.push(`duplicate_ref:${v.ref}`);
      continue;
    }
    seen.add(v.ref);
    const correction = v.correction ? normalizeText(v.correction) || null : null;
    if (v.verdict === 'correct_with_edit' && !correction) {
      issues.push(`correction_required:${v.ref}`);
      continue;
    }
    if (item.reviewed && item.nativeReview && item.nativeReview.reviewerId !== sheet.reviewer.reviewerId) issues.push(`overrides_other_reviewer:${v.ref}`);
    item.reviewed = true;
    item.verdict = v.verdict;
    item.nativeReview = { reviewerId: sheet.reviewer.reviewerId, reviewedAt: sheet.reviewedAt, correction, note: v.note ? normalizeText(v.note) || null : null };
    applied += 1;
  }
  // The confusion test as a whole is reviewed once every pair is, and correct only if every pair is.
  const pairs = next.confusionTest.pairs;
  if (pairs.length && pairs.every((p) => p.reviewed && p.verdict)) {
    next.confusionTest.reviewed = true;
    next.confusionTest.verdict = pairs.find((p) => !ACCEPTED_VERDICTS.has(p.verdict!))?.verdict ?? 'correct';
  }
  next.nativeVerdictSheets = [...next.nativeVerdictSheets, { reviewerId: sheet.reviewer.reviewerId, role: sheet.reviewer.role, nativeVarietyId: sheet.reviewer.nativeVarietyId, reviewedAt: sheet.reviewedAt, applied }];
  const summary = summarizeNativeVerdicts(next);
  next.nativeVerdictSummary = summary;
  return { ok: true, suite: next, summary, issues };
}

const InPlaceItemSchema = z.looseObject({ reviewed: z.boolean().optional(), verdict: z.enum(NATIVE_VERDICTS).nullable().optional(), correction: z.string().nullable().optional(), reviewNote: z.string().nullable().optional() });
const ReviewedSuiteFileSchema = z.looseObject({
  kind: z.literal('fixture_suite'),
  draftId: z.string().min(1),
  expressions: z.array(InPlaceItemSchema),
  dialogues: z.array(InPlaceItemSchema),
  intents: z.array(z.looseObject({ acceptablePhrasings: z.array(InPlaceItemSchema), unacceptable: z.array(InPlaceItemSchema) })),
  confusionTest: z.looseObject({ pairs: z.array(InPlaceItemSchema) }),
});

/**
 * Build a verdict sheet from a fixture-suite file the reviewer edited in place (§4 workflow:
 * `verdict`, optional `correction` / `reviewNote`, `reviewed: true` per item). Identity and time
 * come from the caller, never from the file.
 */
export function nativeVerdictsFromReviewedSuite(file: unknown, reviewer: NativeVerdictSheet['reviewer'], reviewedAt: string): { ok: true; sheet: NativeVerdictSheet } | { ok: false; errors: string[] } {
  const parsed = ReviewedSuiteFileSchema.safeParse(file);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`) };
  const f = parsed.data;
  const errors: string[] = [];
  const verdicts: Array<{ ref: string; verdict: NativeVerdict; correction: string | null; note: string | null }> = [];
  const take = (ref: string, item: z.infer<typeof InPlaceItemSchema>): void => {
    if (item.verdict) verdicts.push({ ref, verdict: item.verdict, correction: item.correction ?? null, note: item.reviewNote ?? null });
    else if (item.reviewed === true) errors.push(`reviewed_without_verdict:${ref}`);
  };
  f.expressions.forEach((e, i) => take(`expressions/${i}`, e));
  f.dialogues.forEach((d, i) => take(`dialogues/${i}`, d));
  f.intents.forEach((intent, i) => {
    intent.acceptablePhrasings.forEach((p, j) => take(`intents/${i}/acceptablePhrasings/${j}`, p));
    intent.unacceptable.forEach((u, j) => take(`intents/${i}/unacceptable/${j}`, u));
  });
  f.confusionTest.pairs.forEach((p, k) => take(`confusionTest/pairs/${k}`, p));
  if (!verdicts.length) errors.push('no_verdicts: the file carries no verdict');
  if (errors.length) return { ok: false, errors };
  const sheet = NativeVerdictSheetSchema.safeParse({ formatVersion: NATIVE_VERDICT_FORMAT_VERSION, kind: 'fixture_verdicts', suiteDraftId: f.draftId, reviewer, reviewedAt, verdicts });
  return sheet.success ? { ok: true, sheet: sheet.data } : { ok: false, errors: sheet.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`) };
}

/**
 * `ai_model_benchmarks` row for the model that generated a reviewed suite (the existing evaluation
 * table). `passed` needs every item reviewed, ≥ `passAcceptedShare` accepted and no wrong-variety item.
 * `model` and `cost_per_call_usd` come from `suite.generation` (generator calls only; the critic's
 * spend stays in `secondModelReview.ledger`).
 */
export function nativeVerdictBenchmarkRow(suite: FixtureSuiteRecord, profileId: string, options: { passAcceptedShare?: number } = {}): Insert<'ai_model_benchmarks'> {
  const summary = suite.nativeVerdictSummary;
  const sheet = suite.nativeVerdictSheets?.at(-1);
  if (!summary || !sheet || summary.reviewed === 0) throw new Error(`suite ${suite.draftId} has no native verdicts to record`);
  const threshold = options.passAcceptedShare ?? 0.9;
  const passed = summary.complete && (summary.acceptedShare ?? 0) >= threshold && summary.byVerdict.wrong_variety === 0;
  const counts = NATIVE_VERDICTS.filter((v) => summary.byVerdict[v] > 0).map((v) => `${v} ${summary.byVerdict[v]}`).join(', ');
  return {
    profile_id: profileId,
    model: suite.generation?.models.join('+') || 'unknown',
    target_variety_id: suite.targetVarietyId,
    source_language_code: suite.sourceLanguage,
    sample_set_id: suite.draftId,
    evaluator_version: NATIVE_VERDICT_EVALUATOR_VERSION,
    naturalness: summary.naturalness,
    intelligibility: null,
    dialect_adherence: summary.dialectAdherence,
    false_correction_rate: null,
    wer: null,
    latency_p50_ms: null,
    latency_p95_ms: null,
    cost_per_call_usd: suite.generation && suite.generation.calls ? Math.round((suite.generation.estimatedCostUsd / suite.generation.calls) * 1e6) / 1e6 : null,
    passed,
    reviewer_id: sheet.reviewerId,
    notes: `Native fixture verdicts (§14.2): reviewed ${summary.reviewed}/${summary.items}${summary.complete ? '' : ' (incomplete)'}; ${counts}; accepted share ${summary.acceptedShare ?? 'n/a'} (pass ≥ ${threshold}, no wrong-variety item).`,
  };
}

/** Record the suite's native verdicts against the enabled `content_generation` profile for its scope. */
export async function recordNativeVerdictBenchmark(repo: Pick<AiProfilesRepository, 'resolve' | 'recordBenchmark'>, suite: FixtureSuiteRecord, options: { passAcceptedShare?: number } = {}): Promise<Row<'ai_model_benchmarks'>> {
  const profile = await repo.resolve('content_generation', suite.targetVarietyId, suite.sourceLanguage);
  if (!profile) throw new Error(`no enabled content_generation profile for ${suite.targetVarietyId} × ${suite.sourceLanguage}`);
  return repo.recordBenchmark(nativeVerdictBenchmarkRow(suite, profile.id, options));
}
