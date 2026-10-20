#!/usr/bin/env tsx
/**
 * content-factory — draft a chapter (or a §14.2 native-review fixture suite) for one
 * `--track × --source` through `@langquest/ai` (OpenRouter `content_generation`), run the
 * validators (schema, blueprint slots, intents, script forms, language guard) and the diversity gate,
 * and write JSONL drafts under `data/drafts/content-factory/` marked `review_needed` / unreviewed.
 *
 * Live model calls only happen with `--live` or `LANGQUEST_LIVE_TESTS=1`, capped by `--max-usd`
 * (default $0.30). `--from-seed` exports the hand-authored curriculum draft chapter instead
 * (no model call). The database is a dry run by default: the run reports what `--apply` would
 * upsert, and only `--apply` writes expression drafts (origin ai_generated, state review_needed).
 * Nothing is ever approved or published here.
 *
 * The chapter record is written the way the fixture path writes its suite (`chapterDraftRecord`): the
 * diversity gate and the optional second-model review travel as `quality`, and what the reviewer must
 * act on as `gaps`; with `--apply`, a mission the gate marked gives its expressions the
 * `diversity_needs_regeneration` curation flag, which the API publish gate refuses until it is cleared.
 * `--regenerate-low-diversity` re-runs a low-diversity mission (or fixture call) once with the gate's
 * reasons (extra paid calls); `--review-model` adds the advisory critic (`language_quality_check`).
 *
 * Usage:
 *   pnpm --filter @langquest/scripts content-factory -- --track arabic-moroccan --source fr --live
 *   pnpm --filter @langquest/scripts content-factory -- --track arabic-moroccan --source fr --fixture-suite --live
 */
import { resolve } from 'node:path';
import { COURSE_TRACK_IDS, DIVERSITY_REVIEW_FLAG, LANGUAGE_CODES, type CourseTrackId, type SourceLanguageCode, type TextReasoner } from '@langquest/contracts';
import { CHAPTER_1_BLUEPRINT_KEYS, DRAFT_CHAPTERS } from '@langquest/curriculum';
import { LanguageGuard, MemoryAiRequestSink, ModelProfileRegistry, OpenRouterClient, type AiRequestRecord } from '@langquest/ai';
import { flagBool, flagList, flagNumber, flagString, isDirectRun, runCli, CliUsageError, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { CONTENT_FACTORY_VERSION, buildFixturePrompts, buildMissionPrompt, chapterDraftRecord, chapterToExpressionDrafts, generateChapter, generateFixtureSuite, resolveTarget, type ChapterDraftRecord, type FactoryDeps } from './lib/content-factory';
import { probeDb, resolveServiceDb } from './lib/db';
import type { ExpressionDraft } from './lib/drafts';
import { applyExpressionDrafts, type ApplyResult } from './lib/expression-apply';
import { ScriptsTextReasoner } from './lib/reasoner';
import { loadRootEnv, nowStamp, repoRoot, writeJsonFileSync, writeJsonl } from './lib/io';
import { getBlueprint } from '@langquest/curriculum';

export const spec: CliSpec = {
  name: 'content-factory',
  summary: 'Draft a chapter or a §14.2 fixture suite for --track × --source via @langquest/ai with validators; writes review_needed JSONL drafts.',
  description: `
Pipeline (§9.8): mission brief + communicative intents → constrained LLM generation in the target variety →
source-language meanings → syntactic/semantic/rubric validators (blueprint slots, intents, script forms, language
guard) → diversity gate (low-diversity drafts are marked diversity_needs_regeneration, never dropped) → optional
second-model review (advisory) → JSONL drafts (status review_needed, nativeReviewed false) → database dry run, or
an upsert with --apply. Nothing is approved or published.`,
  flags: [
    { name: 'track', type: 'string', description: 'Course track id.', required: true, choices: COURSE_TRACK_IDS },
    { name: 'source', type: 'string', description: 'Source (instruction) language code.', required: true, choices: LANGUAGE_CODES },
    { name: 'fixture-suite', type: 'boolean', description: 'Draft the §14.2 fixture suite (25 expressions, 10 dialogues, 5 intents, 1 confusion test) instead of a chapter.', default: false },
    { name: 'live', type: 'boolean', description: 'Allow paid model calls (also enabled by LANGQUEST_LIVE_TESTS=1).', default: false },
    { name: 'max-usd', type: 'number', description: 'Hard spend cap for this run (estimated from OpenRouter pricing).', default: 0.3 },
    { name: 'blueprints', type: 'list', description: 'Blueprint keys to draft (default: chapter-1 blueprints).' },
    { name: 'from-seed', type: 'boolean', description: 'Export the hand-authored curriculum draft chapter (no model call).', default: false },
    { name: 'model', type: 'string', description: 'Override the primary model id (e.g. anthropic/claude-haiku-5.5, live-verified for Darija structured output).' },
    { name: 'max-output-tokens', type: 'number', description: 'Output token budget per model call (reasoning tokens count against it).', default: 12000 },
    { name: 'regenerate-low-diversity', type: 'boolean', description: 'Re-run a draft that fails the diversity gate once with its reasons (extra paid calls; still capped by --max-usd).', default: false },
    { name: 'review-model', type: 'string', description: 'Run the advisory second-model review (language_quality_check) on this model id; it never approves anything.' },
    { name: 'out-dir', type: 'string', description: 'Output directory.', default: 'data/drafts/content-factory' },
    { name: 'apply', type: 'boolean', description: 'Upsert accepted expressions into the database (origin ai_generated, state review_needed). Without it the database step is a dry run.', default: false },
  ],
  examples: ['content-factory -- --track arabic-moroccan --source fr --dry-run', 'content-factory -- --track arabic-moroccan --source fr --live --max-usd 0.3', 'content-factory -- --track arabic-moroccan --source fr --live --regenerate-low-diversity --review-model <critic model id>', 'content-factory -- --track japanese --source en --fixture-suite --live', 'content-factory -- --track arabic-moroccan --source en --from-seed'],
};

/**
 * Seams for tests (fake reasoners, no network, no database). Production runs inject nothing: the reasoners are
 * `ScriptsTextReasoner`s over OpenRouter sharing one in-memory ledger, and `--apply` writes through the service client.
 */
export interface ContentFactoryInject {
  reasoner?: TextReasoner;
  reviewer?: TextReasoner;
  /** The run's `ai_requests`-shaped records (required with an injected reasoner, for budget and ledger). */
  records?: () => readonly AiRequestRecord[];
  applyDrafts?: (drafts: readonly ExpressionDraft[]) => Promise<ApplyResult>;
  stamp?: string;
}

function loadKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export async function main(args: ParsedArgs, io: CliIo, inject: ContentFactoryInject = {}): Promise<number> {
  loadRootEnv();
  const root = repoRoot();
  const track = flagString(args, 'track') as CourseTrackId;
  const source = flagString(args, 'source') as SourceLanguageCode;
  const live = flagBool(args, 'live') || process.env.LANGQUEST_LIVE_TESTS === '1';
  const maxUsd = flagNumber(args, 'max-usd') ?? 0.3;
  const regenerate = flagBool(args, 'regenerate-low-diversity');
  const reviewModel = flagString(args, 'review-model') ?? null;
  const outDir = resolve(root, flagString(args, 'out-dir') ?? 'data/drafts/content-factory');
  const target = resolveTarget(track, source);
  const blueprintKeys = flagList(args, 'blueprints').length ? flagList(args, 'blueprints') : [...CHAPTER_1_BLUEPRINT_KEYS];
  for (const k of blueprintKeys) getBlueprint(k); // throws on unknown keys
  const stamp = inject.stamp ?? nowStamp(true);
  io.log(`target: ${track} (${target.varietyId}) from ${source}; scripts: ${target.primaryScript}${target.transliterations.length ? ` + ${target.transliterations.join(', ')}` : ''}`);

  // --- from-seed: export the curriculum's hand-authored draft (no model) -------------------
  if (flagBool(args, 'from-seed')) {
    const chapter = DRAFT_CHAPTERS.find((c) => c.courseTrackId === track && c.sourceLanguages.includes(source));
    if (!chapter) {
      io.error(`No hand-authored draft chapter in @langquest/curriculum for ${track} from ${source} (available: ${DRAFT_CHAPTERS.map((c) => `${c.courseTrackId}[${c.sourceLanguages.join(',')}]`).join(', ')}).`);
      return 1;
    }
    const record: ChapterDraftRecord = {
      formatVersion: 1,
      kind: 'chapter_draft',
      draftId: `seed:${chapter.key}:${source}`,
      status: 'review_needed',
      nativeReviewed: false,
      provenance: { dataset: 'curriculum_seed', snapshotId: chapter.generatedBy, inputs: [], evidence: ['packages/curriculum/src/content'], importedAt: nowStamp(), importer: `scripts/content-factory@${CONTENT_FACTORY_VERSION}` },
      generation: null,
      validation: chapter.missions.map((m) => ({ blueprintKey: m.blueprintKey, ok: true, errors: [], warnings: [], accepted: m.expressions.filter((e) => e.targetText !== null).length, rejected: [] })),
      chapter,
    };
    return finishChapter(record, args, io, outDir, `${track}-${source}-seed-${stamp}`, inject);
  }

  // --- plan / dry-run ----------------------------------------------------------------------
  const fixture = flagBool(args, 'fixture-suite');
  const critic = reviewModel ? `; + second-model review on ${reviewModel} (advisory, batches of 20 items)` : '';
  if (fixture) {
    const prompts = buildFixturePrompts(target);
    io.log(`fixture suite plan (§14.2): ${regenerate ? 'up to 5 model calls (3 + one diversity regeneration of dialogues and/or intents)' : '3 model calls'} — expressions (${prompts.expressions.user.length} chars), dialogues (${prompts.dialogues.user.length} chars), intents+confusion (${prompts.intents.user.length} chars); system prompt ${prompts.expressions.system.length} chars${critic}`);
  } else {
    let chars = 0;
    for (const k of blueprintKeys) chars += buildMissionPrompt(target, getBlueprint(k), { chapterTitleKey: '' }).user.length;
    io.log(`chapter plan: ${blueprintKeys.length} model calls (${blueprintKeys.join(', ')})${regenerate ? `, up to ${blueprintKeys.length} more to regenerate low-diversity missions` : ''}, ≈${Math.round(chars / 4)} prompt tokens + ≈${Math.round(buildMissionPrompt(target, getBlueprint(blueprintKeys[0]!), { chapterTitleKey: '' }).system.length / 4)} system tokens per call, cap $${maxUsd}${critic}`);
  }
  if (args.dryRun) {
    io.log('dry-run: no model call, nothing written');
    return 0;
  }
  if (!live) {
    io.warn('No live generation: pass --live (or LANGQUEST_LIVE_TESTS=1) to call the model, or --from-seed to export the hand-authored draft. Nothing written.');
    return 0;
  }

  // --- reasoners (real: OpenRouter through ScriptsTextReasoner; tests inject fakes) ----------
  let reasoner = inject.reasoner;
  let reviewer = inject.reviewer;
  let records = inject.records;
  if (!reasoner) {
    const apiKey = loadKey();
    if (!apiKey) {
      io.error('OPENROUTER_API_KEY missing (set it in the environment or the repo-root .env).');
      return 1;
    }
    const sink = new MemoryAiRequestSink();
    const client = new OpenRouterClient({ apiKey, appName: 'LangQuest content-factory', defaultTimeoutMs: 180_000 });
    const profiles = new ModelProfileRegistry();
    const maxOutputTokens = flagNumber(args, 'max-output-tokens') ?? 12000;
    // Batch adapter (see lib/reasoner.ts): same client/profiles/ledger as @langquest/ai, larger output budget.
    reasoner = new ScriptsTextReasoner({ client, profiles, sink, maxOutputTokens, modelOverride: flagString(args, 'model') ?? null });
    // The critic needs a batch output budget too (the package `language_quality_check` profile allows 200 tokens).
    if (reviewModel) reviewer = new ScriptsTextReasoner({ client, profiles, sink, maxOutputTokens, modelOverride: reviewModel });
    records = () => sink.records;
  } else if (reviewModel && !reviewer) {
    io.error('--review-model needs a reviewer reasoner (none injected).');
    return 1;
  }
  if (!records) throw new Error('content-factory: an injected reasoner needs injected records');
  const readRecords = records;
  const guard = new LanguageGuard({});
  const generatedBy = `content-factory@${CONTENT_FACTORY_VERSION}`;
  const deps: FactoryDeps = { reasoner, ...(reviewer ? { reviewer } : {}), guard, records: readRecords, budgetCheck: (l: { estimatedCostUsd: number }) => l.estimatedCostUsd < maxUsd, log: (line: string) => io.log(`  ${line}`) };

  if (fixture) {
    const { suite, ledger, aborted } = await generateFixtureSuite(target, deps, generatedBy, { regenerateOnLowDiversity: regenerate });
    io.log(`model calls: ${ledger.calls} (${ledger.failures} failed) models=${ledger.models.join(',')} tokens in/out=${ledger.inputTokens}/${ledger.outputTokens} est. cost $${ledger.estimatedCostUsd.toFixed(4)}`);
    if (aborted) io.warn(`aborted: ${aborted}`);
    if (!suite) return 1;
    io.log(`fixture counts: expressions ${suite.counts.expressions}/25 dialogues ${suite.counts.dialogues}/10 intents ${suite.counts.intents}/5 confusion pairs ${suite.counts.confusionPairs}`);
    for (const g of suite.gaps) io.warn(`gap: ${g}`);
    const base = resolve(outDir, 'fixtures', `${track}-${source}-${stamp}`);
    writeJsonFileSync(`${base}.json`, suite);
    await writeJsonl(`${base}.jsonl`, [suite]);
    io.log(`wrote ${base}.json (+ .jsonl) — unreviewed; a native reviewer fills verdict per item`);
    return aborted ? 1 : 0;
  }

  const result = await generateChapter(target, deps, { blueprintKeys, generatedBy, regenerateOnLowDiversity: regenerate });
  io.log(`model calls: ${result.ledger.calls} (${result.ledger.failures} failed) models=${result.ledger.models.join(',')} tokens in/out=${result.ledger.inputTokens}/${result.ledger.outputTokens} est. cost $${result.ledger.estimatedCostUsd.toFixed(4)}`);
  if (result.aborted) io.warn(`aborted: ${result.aborted}`);
  if (!result.chapter) {
    io.error('No valid mission draft produced; nothing written.');
    return 1;
  }
  const record = chapterDraftRecord({ missions: result.missions, quality: result.quality, chapter: result.chapter }, { draftId: `factory:${result.chapter.key}:${stamp}`, generatedBy, records: readRecords(), regenerateOnLowDiversity: regenerate, importedAt: nowStamp(), live: true });
  for (const g of record.gaps ?? []) io.warn(`gap: ${g}`);
  const code = await finishChapter(record, args, io, outDir, `${track}-${source}-chapter-${stamp}`, inject);
  return result.aborted ? Math.max(code, 1) : code;
}

async function finishChapter(record: ChapterDraftRecord, args: ParsedArgs, io: CliIo, outDir: string, baseName: string, inject: ContentFactoryInject): Promise<number> {
  const accepted = record.chapter.missions.reduce((s, m) => s + m.expressions.filter((e) => e.targetText !== null).length, 0);
  io.log(`chapter ${record.chapter.key}: ${record.chapter.missions.length} missions, ${accepted} expressions, ${record.chapter.characters.length} characters (status review_needed, nativeReviewed=false)`);
  for (const v of record.validation) if (!v.ok || v.rejected.length) io.warn(`  ${v.blueprintKey}: ${v.ok ? 'ok' : 'INVALID'}; rejected ${v.rejected.length}${v.errors.length ? `; ${v.errors.join('; ')}` : ''}`);
  if (args.dryRun) {
    io.log(`dry-run: would write ${resolve(outDir, baseName)}.jsonl`);
    return 0;
  }
  const base = resolve(outDir, baseName);
  await writeJsonl(`${base}.jsonl`, [record]);
  writeJsonFileSync(`${base}.json`, record);
  io.log(`wrote ${base}.jsonl (+ .json)`);
  const drafts = chapterToExpressionDrafts(record);
  const flagged = drafts.filter((d) => d.curation.flags.includes(DIVERSITY_REVIEW_FLAG)).length;
  const describeDrafts = `${drafts.length} expression drafts (state review_needed, never published)${flagged ? `, ${flagged} flagged ${DIVERSITY_REVIEW_FLAG} (the publish gate refuses them until regenerated or explicitly overridden)` : ''}`;
  if (!flagBool(args, 'apply')) {
    io.log(`database: dry run (default) — --apply would upsert ${describeDrafts}; nothing written to the database`);
    return 0;
  }
  if (inject.applyDrafts) {
    const applied = await inject.applyDrafts(drafts);
    return reportApplied(io, 'the injected database', applied, describeDrafts);
  }
  const db = resolveServiceDb();
  const probe = db ? await probeDb(db.client) : null;
  if (!db || !probe?.ok) {
    io.error(`--apply: database unreachable (${probe && !probe.ok ? probe.reason : 'no config / local stack down'}); drafts written, nothing applied.`);
    return 1;
  }
  return reportApplied(io, db.url, await applyExpressionDrafts(db.client, drafts, { origin: 'ai_generated' }), describeDrafts);
}

function reportApplied(io: CliIo, where: string, applied: ApplyResult, describeDrafts: string): number {
  io.log(`applied ${describeDrafts} to ${where}: inserted=${applied.inserted} rights=${applied.rightsCreated} translations=${applied.translationsUpserted} skippedExisting=${applied.skippedExisting} errors=${applied.errors.length}`);
  for (const e of applied.errors.slice(0, 10)) io.error(`  ${e.draftId}: ${e.message}`);
  return applied.errors.length ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}

export { CliUsageError };
