#!/usr/bin/env tsx
/**
 * import-corpora — validate and inventory speech corpora the operator already downloaded under
 * `data/raw/<source>/` (FLEURS, Common Voice, OpenSLR). Requires a LICENSE_ACKNOWLEDGEMENT.md
 * per source; never downloads, mirrors or copies audio (Common Voice is benchmark-only, §9.4).
 *
 * Writes `data/derived/<source>/inventory.json` and `rights.jsonl` (unverified rights drafts).
 * With `--apply` the rights draft is inserted into `content_rights` (verified = false).
 *
 * Usage: pnpm --filter @langquest/scripts import-corpora -- --source fleurs [--apply]
 */
import { resolve } from 'node:path';
import { createRepositories } from '@langquest/db';
import { flagBool, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { CORPUS_SOURCES, inventoryCorpus, type CorpusSource } from './lib/corpora';
import { probeDb, resolveServiceDb } from './lib/db';
import { loadRootEnv, nowStamp, repoRoot, writeJsonFileSync, writeJsonl } from './lib/io';

export const spec: CliSpec = {
  name: 'import-corpora',
  summary: 'Validate/inventory already-downloaded FLEURS, Common Voice or OpenSLR files with a required license acknowledgement; never mirrors.',
  description: `
Each adapter reads data/raw/<source>/LICENSE_ACKNOWLEDGEMENT.md (dataset, version, license, license_url, source_url,
acquired_at, acquired_by, terms_accepted: yes, redistribution_permitted: yes|no, locales, notes), checks the expected
layout, hashes transcript files and counts audio. Common Voice is always internal-benchmark-only.`,
  flags: [
    { name: 'source', type: 'string', description: 'Corpus adapter.', required: true, choices: CORPUS_SOURCES },
    { name: 'raw-dir', type: 'string', description: 'Root holding data/raw/<source>.', default: 'data/raw' },
    { name: 'out-dir', type: 'string', description: 'Root for data/derived/<source>.', default: 'data/derived' },
    { name: 'hash-audio', type: 'boolean', description: 'Also hash every audio file (slow).', default: false },
    { name: 'apply', type: 'boolean', description: 'Insert the unverified rights record into content_rights.', default: false },
  ],
  examples: ['import-corpora -- --source common-voice --dry-run', 'import-corpora -- --source fleurs --apply'],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  loadRootEnv();
  const root = repoRoot();
  const source = flagString(args, 'source') as CorpusSource;
  const rawDir = resolve(root, flagString(args, 'raw-dir') ?? 'data/raw');
  const outDir = resolve(root, flagString(args, 'out-dir') ?? 'data/derived', source);
  const inv = await inventoryCorpus(source, rawDir, { hashAudio: flagBool(args, 'hash-audio') });
  io.log(`${source}: ${inv.acknowledgement.dataset} ${inv.acknowledgement.version} (${inv.acknowledgement.license}) acknowledged by ${inv.acknowledgement.acquired_by} on ${inv.acknowledgement.acquired_at}`);
  io.log(`redistribution: ${inv.rights.commercialRedistribution ? 'permitted per acknowledgement (still unverified)' : 'NOT permitted'}; internalBenchmarkOnly=${inv.internalBenchmarkOnly}`);
  for (const l of inv.locales) io.log(`  ${l.locale.padEnd(16)} variety=${l.varietyId ?? '-'} audio=${l.audioFileCount} (${Math.round(l.audioBytes / 1e6)} MB) transcriptRows=${l.transcriptRows}${l.problems.length ? ` problems: ${l.problems.join('; ')}` : ''}${l.mappingNote ? ` note: ${l.mappingNote}` : ''}`);
  for (const p of inv.problems) io.warn(`problem: ${p}`);
  const hasProblems = inv.problems.length > 0 || inv.locales.some((l) => l.problems.length > 0);
  if (args.dryRun) {
    io.log(`dry-run: would write ${outDir}/inventory.json and rights.jsonl`);
    return hasProblems ? 1 : 0;
  }
  writeJsonFileSync(resolve(outDir, 'inventory.json'), { formatVersion: 1, generatedAt: nowStamp(), ...inv });
  await writeJsonl(resolve(outDir, 'rights.jsonl'), [{ formatVersion: 1, kind: 'corpus_rights_draft', draftId: `${source}:${inv.acknowledgement.version}`, status: 'review_needed', rights: inv.rights, provenance: { dataset: source === 'common-voice' ? 'common_voice' : source, snapshotId: inv.acknowledgement.version, inputs: inv.locales.flatMap((l) => l.transcriptFiles), evidence: [inv.acknowledgement.license_url], importedAt: nowStamp(), importer: 'scripts/import-corpora@1' } }]);
  io.log(`wrote ${outDir}/inventory.json, rights.jsonl`);
  if (flagBool(args, 'apply')) {
    const db = resolveServiceDb();
    if (!db) {
      io.error('--apply requested but no database is reachable; inventory written, nothing applied.');
      return 1;
    }
    const probe = await probeDb(db.client);
    if (!probe.ok) {
      io.error(`--apply: database unreachable (${probe.reason}).`);
      return 1;
    }
    const r = inv.rights;
    const created = await createRepositories(db.client).rights.create({
      origin_url: r.originUrl,
      authors: r.authors,
      speakers: [],
      permission_grant: `${inv.acknowledgement.dataset} ${inv.acknowledgement.version}: ${inv.acknowledgement.license}; acknowledged by ${inv.acknowledgement.acquired_by} ${inv.acknowledgement.acquired_at}`,
      license_id: r.licenseId,
      license_version: r.licenseVersion,
      commercial_redistribution: r.commercialRedistribution,
      attribution_required: r.attributionRequired,
      attribution_text: r.attributionText,
      alterations_permitted: r.alterationsPermitted,
      ai_processing_permitted: r.aiProcessingPermitted,
      voice_rights: 'none',
      verified: false,
    });
    io.log(`content_rights row ${created.id} created (verified=false) on ${db.url}`);
  }
  return hasProblems ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
