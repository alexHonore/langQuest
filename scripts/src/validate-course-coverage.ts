#!/usr/bin/env tsx
/**
 * validate-course-coverage — per (track × source) coverage report (missions, expressions, audio,
 * native review, localization) combining `@langquest/curriculum` coverage, `@langquest/locales`
 * coverage, JSONL drafts on disk and database counts. Exits non-zero on catalog drift and
 * writes `docs/provider-matrix/coverage-report.md`.
 *
 * Usage: pnpm --filter @langquest/scripts validate-course-coverage -- [--sources en,fr] [--out docs/provider-matrix/coverage-report.md] [--json data/derived/coverage-report.json]
 */
import { resolve } from 'node:path';
import type { SourceLanguageCode } from '@langquest/contracts';
import { flagBool, flagList, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { DEFAULT_SOURCES, buildCoverageReport, loadDbFacts, loadDraftFacts, renderCoverageMarkdown } from './lib/coverage-report';
import { probeDb, resolveServiceDb } from './lib/db';
import { loadRootEnv, repoRoot, writeJsonFileSync, writeTextFileSync } from './lib/io';

export const spec: CliSpec = {
  name: 'validate-course-coverage',
  summary: 'Per track × source coverage report; exits non-zero on catalog drift; writes docs/provider-matrix/coverage-report.md.',
  flags: [
    { name: 'sources', type: 'list', description: 'Source languages to report (default: all 23, priority first).' },
    { name: 'out', type: 'string', description: 'Markdown report path.', default: 'docs/provider-matrix/coverage-report.md' },
    { name: 'json', type: 'string', description: 'Also write the JSON report here.' },
    { name: 'drafts-dir', type: 'list', description: 'Directories scanned for JSONL drafts.', default: ['data/drafts'] },
    { name: 'require-db', type: 'boolean', description: 'Fail when the database is unreachable (CI with a stack).', default: false },
  ],
  examples: ['validate-course-coverage', 'validate-course-coverage -- --sources en,fr --dry-run', 'validate-course-coverage -- --require-db --json data/derived/coverage-report.json'],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  loadRootEnv();
  const root = repoRoot();
  const sources = (flagList(args, 'sources') as SourceLanguageCode[]);
  const db = resolveServiceDb();
  const probe = db ? await probeDb(db.client) : null;
  let dbFacts = null;
  if (db && probe?.ok) {
    dbFacts = await loadDbFacts(db.client, db.url);
    io.log(`db: ${db.url} (${db.source}) — ${dbFacts.trackIds.length} tracks, ${Object.values(dbFacts.expressionsByVariety).reduce((s, b) => s + b.total, 0)} expressions`);
  } else {
    const msg = probe && !probe.ok ? probe.reason : 'no database configured / local stack down';
    if (flagBool(args, 'require-db')) {
      io.error(`--require-db: ${msg}`);
      return 1;
    }
    io.warn(`database not reachable (${msg}); DB counts will be 0`);
  }
  const draftDirs = ((args.flags.draftsDir as string[] | undefined) ?? ['data/drafts']).map((d) => resolve(root, d));
  const drafts = await loadDraftFacts(draftDirs);
  io.log(`drafts: ${drafts.files} JSONL files; expression drafts by variety: ${Object.entries(drafts.expressionDraftsByVariety).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}; chapter drafts: ${Object.keys(drafts.chapterDraftsByTrackSource).join(' ') || 'none'}`);
  const report = buildCoverageReport({ sources: sources.length ? sources : DEFAULT_SOURCES, db: dbFacts, drafts });
  io.log(`pairs=${report.rows.length} complete=${report.totals.complete} partial=${report.totals.partial} planned=${report.totals.planned} unavailable=${report.totals.unavailable}`);
  for (const [loc, c] of Object.entries(report.locales)) io.log(`  locale ${loc}: ${c.status} ${c.pct}%`);
  for (const d of report.drift) io.error(`DRIFT: ${d}`);
  for (const w of report.warnings.slice(0, 10)) io.warn(`warn: ${w}`);
  if (report.warnings.length > 10) io.warn(`warn: … ${report.warnings.length - 10} more`);
  const out = resolve(root, flagString(args, 'out') ?? 'docs/provider-matrix/coverage-report.md');
  if (args.dryRun) {
    io.log(`dry-run: would write ${out}`);
  } else {
    writeTextFileSync(out, renderCoverageMarkdown(report));
    io.log(`wrote ${out}`);
    const json = flagString(args, 'json');
    if (json) {
      writeJsonFileSync(resolve(root, json), report);
      io.log(`wrote ${resolve(root, json)}`);
    }
  }
  return report.drift.length ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
