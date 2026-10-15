#!/usr/bin/env tsx
/**
 * bulk-audio-scan — scan a local folder tree (what rclone will upload) and write the CSV
 * manifest for the admin `import-manifest` endpoint: SHA-256, byte length, container/duration/
 * ID3 metadata via @langquest/media, and collection/chapter/lesson hierarchy inferred from the
 * path (folder-level inheritance). Filenames/paths are preserved only as `legacyPath`.
 *
 * Usage: pnpm --filter @langquest/scripts bulk-audio-scan -- --root /Volumes/Archive/pimsleur --prefix uploads/legacy/pimsleur --out data/derived/manifests/pimsleur.csv
 */
import { resolve } from 'node:path';
import type { ImportDefaults } from '@langquest/media';
import { findDuplicates, scanTree, toManifestCsv } from './lib/audio-scan';
import { flagBool, flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { fileExists, nowStamp, repoRoot, writeJsonl, writeTextFileSync } from './lib/io';

export const spec: CliSpec = {
  name: 'bulk-audio-scan',
  summary: 'Scan an audio folder tree → CSV manifest (sha256, metadata, inferred hierarchy) for admin import-manifest.',
  flags: [
    { name: 'root', type: 'string', description: 'Folder to scan.', required: true },
    { name: 'out', type: 'string', description: 'CSV output path (default data/derived/manifests/<folder>-<stamp>.csv).' },
    { name: 'prefix', type: 'string', description: 'R2 key prefix rclone will upload under; fills storageKey = <prefix>/<legacyPath>.' },
    { name: 'jsonl', type: 'boolean', description: 'Also write a .jsonl sidecar with the full scan records.', default: false },
    { name: 'default-variety', type: 'string', description: 'Default targetVarietyId for every row (reviewable later).' },
    { name: 'default-instruction-language', type: 'string', description: 'Default instructionLanguage (source language code) for every row.' },
    { name: 'license-id', type: 'string', description: 'Default licenseId column (e.g. owner-private).' },
    { name: 'rights-owner', type: 'string', description: 'Default rightsOwner column.' },
    { name: 'exact-duration', type: 'boolean', description: 'Scan whole files for exact durations (slower).', default: false },
    { name: 'max-files', type: 'number', description: 'Stop after N files (0 = all).', default: 0 },
  ],
  examples: ['bulk-audio-scan -- --root ~/Audio/course --dry-run', 'bulk-audio-scan -- --root ~/Audio/course --prefix uploads/legacy/course --default-variety ary --license-id owner-private --rights-owner "Alex"'],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = resolve(flagString(args, 'root')!);
  if (!fileExists(root)) {
    io.error(`Folder not found: ${root}`);
    return 2;
  }
  const defaults: ImportDefaults = {};
  const dv = flagString(args, 'default-variety');
  const dl = flagString(args, 'default-instruction-language');
  const lic = flagString(args, 'license-id');
  const owner = flagString(args, 'rights-owner');
  if (dv) defaults.targetVarietyId = dv as ImportDefaults['targetVarietyId'];
  if (dl) defaults.instructionLanguage = dl as ImportDefaults['instructionLanguage'];
  if (lic) defaults.licenseId = lic;
  if (owner) defaults.rightsOwner = owner;
  const files = await scanTree({
    root,
    prefix: flagString(args, 'prefix') ?? null,
    defaults,
    listOnly: args.dryRun,
    exactDuration: flagBool(args, 'exact-duration'),
    maxFiles: flagNumber(args, 'max-files') ?? 0,
    onProgress: (done, total, file) => {
      if (done % 50 === 0 || done === total) io.log(`  ${done}/${total} ${file}`);
    },
  });
  const totalBytes = files.reduce((s, f) => s + f.byteLength, 0);
  const errors = files.filter((f) => f.error);
  io.log(`${files.length} audio files, ${(totalBytes / 1e9).toFixed(2)} GB${args.dryRun ? ' (dry-run: not hashed)' : ''}; ${errors.length} unreadable`);
  const collections = new Map<string, number>();
  for (const f of files) collections.set(String(f.manifestRow.collectionTitle ?? '(none)'), (collections.get(String(f.manifestRow.collectionTitle ?? '(none)')) ?? 0) + 1);
  for (const [c, n] of [...collections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) io.log(`  collection "${c}": ${n} files`);
  const dups = findDuplicates(files);
  if (dups.length) io.warn(`${dups.length} duplicate contents (same sha256, different paths) — flagged, not merged: e.g. ${dups[0]!.paths.join(' = ')}`);
  for (const e of errors.slice(0, 10)) io.warn(`  unreadable ${e.legacyPath}: ${e.error}`);
  const base = root.split('/').filter(Boolean).pop() ?? 'scan';
  const out = resolve(repoRoot(), flagString(args, 'out') ?? `data/derived/manifests/${base}-${nowStamp(true)}.csv`);
  if (args.dryRun) {
    io.log(`dry-run: would write ${out}`);
    return 0;
  }
  writeTextFileSync(out, toManifestCsv(files));
  io.log(`wrote ${out}`);
  if (flagBool(args, 'jsonl')) {
    const sidecar = out.replace(/\.csv$/, '.jsonl');
    await writeJsonl(sidecar, files);
    io.log(`wrote ${sidecar}`);
  }
  return errors.length ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
