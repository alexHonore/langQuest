#!/usr/bin/env tsx
/**
 * license-report — attributions and rights summary from the database (`content_rights` +
 * usage) and/or JSONL drafts; flags everything that lacks redistribution rights.
 *
 * Usage: pnpm --filter @langquest/scripts license-report -- [--source db|jsonl|both] [--jsonl-dir data/drafts] [--out docs/content-rights/license-report.md]
 */
import { resolve } from 'node:path';
import { flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { probeDb, resolveServiceDb } from './lib/db';
import { loadRootEnv, repoRoot, writeJsonFileSync, writeTextFileSync } from './lib/io';
import { buildReport, findJsonlFiles, loadDbRights, loadJsonlRights, renderMarkdown, type RightsItem } from './lib/license-report';

export const spec: CliSpec = {
  name: 'license-report',
  summary: 'Attribution/rights summary from content_rights (DB) and/or JSONL drafts; flags missing redistribution rights.',
  flags: [
    { name: 'source', type: 'string', description: 'Where to read rights from.', default: 'both', choices: ['db', 'jsonl', 'both'] },
    { name: 'jsonl-dir', type: 'list', description: 'Directories scanned recursively for *.jsonl drafts.', default: ['data/drafts', 'data/derived'] },
    { name: 'out', type: 'string', description: 'Markdown output path.', default: 'data/derived/license-report.md' },
    { name: 'json', type: 'string', description: 'JSON output path (optional).' },
  ],
  examples: ['license-report -- --source jsonl --dry-run', 'license-report -- --out docs/content-rights/license-report.md'],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  loadRootEnv();
  const root = repoRoot();
  const source = flagString(args, 'source') ?? 'both';
  const items: RightsItem[] = [];
  if (source === 'db' || source === 'both') {
    const db = resolveServiceDb();
    const probe = db ? await probeDb(db.client) : null;
    if (!db || !probe || !probe.ok) {
      const msg = `database not reachable (${probe && !probe.ok ? probe.reason : 'no SUPABASE_URL/service key and local stack down'})`;
      if (source === 'db') {
        io.error(msg);
        return 1;
      }
      io.warn(`${msg}; reporting JSONL drafts only`);
    } else {
      const rows = await loadDbRights(db.client);
      io.log(`db: ${rows.length} content_rights rows from ${db.url}`);
      items.push(...rows);
    }
  }
  if (source === 'jsonl' || source === 'both') {
    const dirs = (args.flags.jsonlDir as string[] | undefined) ?? ['data/drafts', 'data/derived'];
    const files = dirs.flatMap((d) => findJsonlFiles(resolve(root, d)));
    const rows = await loadJsonlRights(files);
    io.log(`jsonl: ${rows.length} rights-bearing records in ${files.length} files`);
    items.push(...rows);
  }
  const report = buildReport(items);
  io.log(`items=${report.totals.items} verified=${report.totals.verified} redistributable=${report.totals.redistributable} flagged=${report.totals.flagged}`);
  for (const [f, n] of Object.entries(report.flagCounts)) if (n > 0) io.log(`  ${f}: ${n}`);
  const out = resolve(root, flagString(args, 'out') ?? 'data/derived/license-report.md');
  if (args.dryRun) {
    io.log(`dry-run: would write ${out}`);
    return 0;
  }
  writeTextFileSync(out, renderMarkdown(report));
  io.log(`wrote ${out}`);
  const json = flagString(args, 'json');
  if (json) {
    writeJsonFileSync(resolve(root, json), report);
    io.log(`wrote ${resolve(root, json)}`);
  }
  return 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
