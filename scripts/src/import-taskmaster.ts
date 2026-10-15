#!/usr/bin/env tsx
/**
 * import-taskmaster — extract intent/turn-structure patterns from Taskmaster-1 (CC BY 4.0)
 * into curriculum-usable scenario skeletons with an attribution record.
 *
 * Nothing textual from the dataset is published: the output holds turn-count statistics,
 * slot-fill order, abstract dialogue-act sequences, clarification/revision rates and a
 * language-neutral writing brief per domain (spec §9.3).
 *
 * Usage: pnpm --filter @langquest/scripts import-taskmaster -- [--dir data/raw/taskmaster] [--limit 0]
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import type { InputFileHash } from './lib/drafts';
import { fileExists, nowStamp, readJsonFile, repoRoot, sha256File, writeJsonFileSync, writeTextFileSync } from './lib/io';
import { TASKMASTER_ATTRIBUTION, TmDialogSchema, buildSkeletons, extractPattern, type DialogPattern, type Ontology, type ScenarioSkeleton, type TmDialog } from './lib/taskmaster';

export const spec: CliSpec = {
  name: 'import-taskmaster',
  summary: 'Extract dialogue structure patterns (not text) from Taskmaster-1 into scenario skeletons + CC BY attribution.',
  flags: [
    { name: 'dir', type: 'string', description: 'Taskmaster git clone directory.', default: 'data/raw/taskmaster' },
    { name: 'out-dir', type: 'string', description: 'Output directory.', default: 'data/derived/taskmaster' },
    { name: 'files', type: 'list', description: 'Dialogue files (relative to TM-1-2019) to read.', default: ['self-dialogs.json', 'woz-dialogs.json'] },
    { name: 'limit', type: 'number', description: 'Max dialogues per file (0 = all).', default: 0 },
    { name: 'top', type: 'number', description: 'How many top patterns to keep per domain.', default: 8 },
  ],
  examples: ['import-taskmaster -- --dry-run', 'import-taskmaster -- --limit 500'],
};

export interface TaskmasterRun {
  skeletons: ScenarioSkeleton[];
  attribution: typeof TASKMASTER_ATTRIBUTION & { snapshotId: string; inputs: InputFileHash[]; extractedAt: string; dialogsRead: number; dialogsUnmappedDomain: number };
}

/** Pure-ish pipeline over the given files. Exported for tests (works on small fixtures). */
export async function runTaskmaster(options: { dir: string; files: readonly string[]; limit: number; top: number; now?: Date }): Promise<TaskmasterRun> {
  const tmDir = resolve(options.dir, 'TM-1-2019');
  const ontologyPath = resolve(tmDir, 'ontology.json');
  const ontology = fileExists(ontologyPath) ? readJsonFile<Ontology>(ontologyPath) : null;
  const patterns: DialogPattern[] = [];
  const inputs: InputFileHash[] = [];
  let dialogsRead = 0;
  let unmapped = 0;
  for (const file of options.files) {
    const path = resolve(tmDir, file);
    if (!fileExists(path)) throw new Error(`Missing ${path}. Clone https://github.com/google-research-datasets/Taskmaster into ${options.dir} first (not done automatically).`);
    const h = await sha256File(path);
    inputs.push({ file: `TM-1-2019/${file}`, sha256: h.sha256, byteLength: h.byteLength });
    const raw = readJsonFile<unknown[]>(path);
    const rows = options.limit > 0 ? raw.slice(0, options.limit) : raw;
    for (const r of rows) {
      const parsed = TmDialogSchema.safeParse(r);
      if (!parsed.success) continue;
      dialogsRead += 1;
      const pattern = extractPattern(parsed.data as TmDialog);
      if (pattern) patterns.push(pattern);
      else unmapped += 1;
    }
  }
  let snapshotId = 'unknown';
  try {
    snapshotId = execFileSync('git', ['-C', options.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // not a git clone; keep 'unknown'
  }
  const skeletons = buildSkeletons(patterns, ontology, options.top);
  return { skeletons, attribution: { ...TASKMASTER_ATTRIBUTION, snapshotId, inputs, extractedAt: nowStamp(false, options.now), dialogsRead, dialogsUnmappedDomain: unmapped } };
}

export function renderSkeletonsMarkdown(run: TaskmasterRun): string {
  const lines: string[] = [];
  lines.push('# Taskmaster-1 scenario skeletons (structure only)');
  lines.push('');
  lines.push(`Generated ${run.attribution.extractedAt} from ${run.attribution.dialogsRead} dialogues (snapshot ${run.attribution.snapshotId}). ${run.attribution.attributionText}`);
  lines.push('');
  for (const s of run.skeletons) {
    lines.push(`## ${s.domain} → ${s.blueprintKey ?? 'no blueprint'} (${s.situation})`);
    lines.push('');
    lines.push(`- sample: ${s.sampleSize} dialogues; turns min ${s.turnCount.min} / p50 ${s.turnCount.p50} / mean ${s.turnCount.mean} / p90 ${s.turnCount.p90} / max ${s.turnCount.max}`);
    lines.push(`- required slots: ${s.slots.required.join(', ') || '—'}; optional: ${s.slots.optional.join(', ') || '—'}`);
    lines.push(`- rates: revision ${s.rates.revisionPct}% · unavailable ${s.rates.unavailablePct}% · clarification ${s.rates.clarificationPct}% · user questions ${s.rates.userQuestionPct}% of user turns`);
    lines.push(`- intents: ${s.intentKeys.join(', ')}`);
    lines.push('- top slot orders:');
    for (const o of s.slotOrderPatterns.slice(0, 5)) lines.push(`  - ${o.order.join(' → ')} (${o.count})`);
    lines.push('- top act sequences:');
    for (const a of s.actSequencePatterns.slice(0, 5)) lines.push(`  - ${a.sequence} (${a.count})`);
    lines.push('- brief:');
    for (const b of s.brief) lines.push(`  - ${b}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const dir = resolve(root, flagString(args, 'dir') ?? 'data/raw/taskmaster');
  const outDir = resolve(root, flagString(args, 'out-dir') ?? 'data/derived/taskmaster');
  const files = (args.flags.files as string[] | undefined) ?? ['self-dialogs.json', 'woz-dialogs.json'];
  const run = await runTaskmaster({ dir, files, limit: flagNumber(args, 'limit') ?? 0, top: flagNumber(args, 'top') ?? 8 });
  io.log(`read ${run.attribution.dialogsRead} dialogues (${run.attribution.dialogsUnmappedDomain} with unmapped domain) → ${run.skeletons.length} domain skeletons`);
  for (const s of run.skeletons) io.log(`  ${s.domain.padEnd(18)} n=${s.sampleSize} p50 turns=${s.turnCount.p50} unavailable=${s.rates.unavailablePct}% revision=${s.rates.revisionPct}% → ${s.blueprintKey ?? '-'}`);
  if (args.dryRun) {
    io.log(`dry-run: would write ${outDir}/scenario-skeletons.json, attribution.json, scenario-skeletons.md`);
    return 0;
  }
  writeJsonFileSync(resolve(outDir, 'scenario-skeletons.json'), { formatVersion: 1, attribution: run.attribution, skeletons: run.skeletons });
  writeJsonFileSync(resolve(outDir, 'attribution.json'), run.attribution);
  writeTextFileSync(resolve(outDir, 'scenario-skeletons.md'), renderSkeletonsMarkdown(run));
  io.log(`wrote ${outDir}/scenario-skeletons.{json,md} and attribution.json`);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
