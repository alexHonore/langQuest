#!/usr/bin/env tsx
/**
 * import-tatoeba — curate Tatoeba sentence exports into `review_needed` expression drafts.
 *
 * Reads the exports already downloaded under `data/raw/tatoeba/` (never downloads), joins
 * translation links for the requested source languages, keeps per-row license/author/source,
 * the export snapshot id and the SHA-256 of every input, and writes JSON Lines drafts under
 * `data/drafts/tatoeba/`. With `--apply` (and a reachable Supabase stack) the drafts are also
 * upserted into `expressions` / `expression_forms` / `expression_translations` / `content_rights`.
 *
 * Usage: pnpm --filter @langquest/scripts import-tatoeba -- --target spa --variety es-ES --sources eng,fra --limit 500
 */
import { resolve } from 'node:path';
import type { VarietyId } from '@langquest/contracts';
import { flagBool, flagList, flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { probeDb, resolveServiceDb } from './lib/db';
import { ExpressionDraftSchema } from './lib/drafts';
import { loadRootEnv, nowStamp, repoRoot, writeJsonFileSync, writeJsonl } from './lib/io';
import { TATOEBA_LANGUAGES, importTatoeba } from './lib/tatoeba';
import { applyExpressionDrafts } from './lib/expression-apply';

export const spec: CliSpec = {
  name: 'import-tatoeba',
  summary: 'Curate Tatoeba exports into intent-tagged expression drafts (status review_needed, provenance tatoeba).',
  description: `
Pipeline (spec §9.2): stream-decompress TSVs → join links → keep license/author/source + snapshot id +
sha256 of inputs → NFC-normalise without touching diacritics → script/language sanity → toxic/irrelevant
filter → intent heuristics (target text + English translation) → JSONL drafts → optional DB upsert.
Ambiguous corpus languages (spa, por, ara) require --variety; the dialect is recorded as operator-declared.`,
  flags: [
    { name: 'target', type: 'string', description: 'Tatoeba ISO-639-3 code of the target language export.', required: true, choices: Object.keys(TATOEBA_LANGUAGES) },
    { name: 'variety', type: 'string', description: 'LangQuest variety id to assign (required when the corpus language is ambiguous).' },
    { name: 'sources', type: 'list', description: 'Source (instruction) languages to join, Tatoeba codes.', default: ['eng', 'fra'] },
    { name: 'dir', type: 'string', description: 'Directory holding the exports.', default: 'data/raw/tatoeba' },
    { name: 'out', type: 'string', description: 'Output JSONL path (default data/drafts/tatoeba/<target>-<variety>-<stamp>.jsonl).' },
    { name: 'limit', type: 'number', description: 'Maximum drafts to emit.', default: 2000 },
    { name: 'scan-limit', type: 'number', description: 'Maximum target sentences to scan (0 = all).', default: 0 },
    { name: 'max-candidates', type: 'number', description: 'Cap on filtered candidates held in memory.', default: 50000 },
    { name: 'min-confidence', type: 'number', description: 'Minimum intent confidence to tag a draft with an intent.', default: 0.6 },
    { name: 'keep-unmatched', type: 'boolean', description: 'Also emit drafts without a confident intent (flag intent_unmatched).', default: false },
    { name: 'max-words', type: 'number', description: 'Longest sentence (words) considered a beginner expression.', default: 12 },
    { name: 'require-translation', type: 'boolean', description: 'Drop sentences without a translation in a requested source language.', default: true },
    { name: 'apply', type: 'boolean', description: 'Upsert drafts into the database (needs SUPABASE_URL+SUPABASE_SERVICE_ROLE_KEY or the local stack).', default: false },
  ],
  examples: [
    'import-tatoeba -- --target fra --sources eng --limit 300 --dry-run',
    'import-tatoeba -- --target spa --variety es-ES --sources eng,fra --limit 1000',
    'import-tatoeba -- --target ara --variety arb --sources eng,fra --apply',
  ],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  loadRootEnv();
  const root = repoRoot();
  const target = flagString(args, 'target')!;
  const variety = (flagString(args, 'variety') ?? null) as VarietyId | null;
  const sources = flagList(args, 'sources');
  const dir = resolve(root, flagString(args, 'dir') ?? 'data/raw/tatoeba');
  const result = await importTatoeba(
    {
      dir,
      target,
      sources,
      variety,
      maxCandidates: flagNumber(args, 'max-candidates') ?? 50000,
      scanLimit: flagNumber(args, 'scan-limit') ?? 0,
      limit: flagNumber(args, 'limit') ?? 2000,
      minIntentConfidence: flagNumber(args, 'min-confidence') ?? 0.6,
      keepUnmatched: flagBool(args, 'keep-unmatched'),
      maxWords: flagNumber(args, 'max-words') ?? 12,
      requireTranslation: flagBool(args, 'require-translation'),
    },
    io,
  );
  for (const d of result.drafts) ExpressionDraftSchema.parse(d);
  const s = result.summary;
  io.log(`target=${s.target} variety=${s.varietyId ?? 'UNRESOLVED'} (${s.varietyAssignment}) snapshot=${s.snapshotId}`);
  io.log(`candidates=${s.candidates} linked=${s.linked} intentMatched=${s.intentMatched} withAudio=${s.withAudio} audioRedistributable=${s.audioRedistributable} emitted=${s.emitted}`);
  io.log(`rejected: ${Object.entries(s.rejected).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`);
  io.log(`top intents: ${Object.entries(s.byIntent).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  for (const n of s.notes) io.warn(`note: ${n}`);
  if (s.varietyAssignment === 'unresolved') io.warn('Variety unresolved: drafts carry varietyId=null and cannot be applied to the database until --variety is declared.');

  const stamp = nowStamp(true);
  const out = resolve(root, flagString(args, 'out') ?? `data/drafts/tatoeba/${target}-${s.varietyId ?? 'unresolved'}-${stamp}.jsonl`);
  if (args.dryRun) {
    io.log(`dry-run: would write ${result.drafts.length} drafts to ${out}`);
    for (const d of result.drafts.slice(0, 5)) io.log(`  ${d.draftId} [${d.curation.intentKey ?? '-'} ${d.curation.intentConfidence.toFixed(2)}] ${d.target.text} ⇄ ${d.translations.map((t) => `${t.sourceLanguageCode}:${t.text}`).join(' | ')}`);
    return 0;
  }
  await writeJsonl(out, result.drafts);
  writeJsonFileSync(out.replace(/\.jsonl$/, '.summary.json'), s);
  io.log(`wrote ${result.drafts.length} drafts → ${out}`);

  if (flagBool(args, 'apply')) {
    const db = resolveServiceDb();
    if (!db) {
      io.error('--apply requested but no database is configured or the local stack is down (pnpm supabase start). Drafts were written; nothing applied.');
      return 1;
    }
    const probe = await probeDb(db.client);
    if (!probe.ok) {
      io.error(`--apply: database unreachable (${probe.reason}). Drafts were written; nothing applied.`);
      return 1;
    }
    const applied = await applyExpressionDrafts(db.client, result.drafts, { origin: 'public_dataset' });
    io.log(`applied to ${db.url} (${db.source}): inserted=${applied.inserted} rights=${applied.rightsCreated} translations=${applied.translationsUpserted} skippedExisting=${applied.skippedExisting} skippedNoVariety=${applied.skippedNoVariety} skippedNoIntent=${applied.skippedNoIntent} errors=${applied.errors.length}`);
    for (const e of applied.errors.slice(0, 10)) io.error(`  ${e.draftId}: ${e.message}`);
    return applied.errors.length ? 1 : 0;
  }
  return 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
