/**
 * CLI smoke tests: every script answers --help, validates flags, and runs its --dry-run path on
 * the small fixtures without touching the network or a database.
 */
import { CHAPTER_1_BLUEPRINT_KEYS } from '@langquest/curriculum';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as attachTatoebaExamples from './attach-tatoeba-examples';
import * as bulkAudioScan from './bulk-audio-scan';
import * as contentFactory from './content-factory';
import * as exportFlutterContent from './export-flutter-content';
import * as importCorpora from './import-corpora';
import * as importFactoryChapters from './import-factory-chapters';
import * as importTaskmaster from './import-taskmaster';
import * as importTatoeba from './import-tatoeba';
import * as licenseReport from './license-report';
import { memoryIo, runCli } from './lib/cli';
import * as seedLanguages from './seed-languages';
import * as synthesizeBundleAudio from './synthesize-bundle-audio';
import * as publishContent from './publish-content';
import * as validateCoverage from './validate-course-coverage';

const FIX = resolve(__dirname, 'fixtures');
const ALL = [importTatoeba, importTaskmaster, importCorpora, bulkAudioScan, licenseReport, seedLanguages, validateCoverage, contentFactory, exportFlutterContent, attachTatoebaExamples, synthesizeBundleAudio, publishContent, importFactoryChapters];

describe('every CLI', () => {
  it('prints --help with usage, flags and --dry-run', async () => {
    for (const cli of ALL) {
      const io = memoryIo();
      expect(await runCli(cli.spec, ['--help'], cli.main, io)).toBe(0);
      const text = io.lines.join('\n');
      expect(text).toContain(`${cli.spec.name} —`);
      expect(text).toContain('--dry-run');
      expect(text).toContain('Usage:');
    }
  });

  it('rejects unknown flags with exit code 2', async () => {
    for (const cli of ALL) {
      const io = memoryIo();
      expect(await runCli(cli.spec, ['--definitely-unknown-flag'], cli.main, io)).toBe(2);
    }
  });
});

describe('dry runs on fixtures', () => {
  it('import-tatoeba --dry-run reports the plan without writing', async () => {
    const io = memoryIo();
    const code = await runCli(importTatoeba.spec, ['--target', 'spa', '--variety', 'es-ES', '--dir', resolve(FIX, 'tatoeba'), '--dry-run', '--limit', '3'], importTatoeba.main, io);
    expect(code).toBe(0);
    expect(io.lines.join('\n')).toMatch(/dry-run: would write 3 drafts/);
    expect(io.lines.join('\n')).toContain('variety=es-ES (operator_declared)');
  });

  it('import-tatoeba refuses dialect crossing', async () => {
    const io = memoryIo();
    const code = await runCli(importTatoeba.spec, ['--target', 'spa', '--variety', 'arb', '--dir', resolve(FIX, 'tatoeba'), '--dry-run'], importTatoeba.main, io);
    expect(code).toBe(1);
    expect(io.errors.join('\n')).toMatch(/never crossed/);
  });

  it('import-taskmaster --dry-run summarises domains', async () => {
    const io = memoryIo();
    const code = await runCli(importTaskmaster.spec, ['--dir', resolve(FIX, 'taskmaster'), '--dry-run'], importTaskmaster.main, io);
    expect(code).toBe(0);
    expect(io.lines.join('\n')).toMatch(/6 domain skeletons/);
  });

  it('import-corpora --dry-run validates the fixture drops', async () => {
    const io = memoryIo();
    expect(await runCli(importCorpora.spec, ['--source', 'fleurs', '--raw-dir', resolve(FIX, 'corpora'), '--dry-run'], importCorpora.main, io)).toBe(0);
    expect(io.lines.join('\n')).toContain('NOT permitted');
    const io2 = memoryIo();
    expect(await runCli(importCorpora.spec, ['--source', 'common-voice', '--raw-dir', resolve(FIX, 'corpora'), '--dry-run'], importCorpora.main, io2)).toBe(1); // claimed redistribution is a problem
    const io3 = memoryIo();
    expect(await runCli(importCorpora.spec, ['--source', 'openslr', '--raw-dir', resolve(FIX, 'corpora'), '--dry-run'], importCorpora.main, io3)).toBe(1);
    expect(io3.errors.join('\n')).toMatch(/LICENSE_ACKNOWLEDGEMENT/);
  });

  it('bulk-audio-scan --dry-run lists files without hashing; a real run writes the CSV', async () => {
    const io = memoryIo();
    expect(await runCli(bulkAudioScan.spec, ['--root', resolve(FIX, 'audio'), '--dry-run'], bulkAudioScan.main, io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/5 audio files/);
    const out = join(mkdtempSync(join(tmpdir(), 'scan-')), 'm.csv');
    const io2 = memoryIo();
    const code = await runCli(bulkAudioScan.spec, ['--root', resolve(FIX, 'audio'), '--out', out, '--prefix', 'uploads/x'], bulkAudioScan.main, io2);
    expect(code).toBe(1); // one unreadable fixture file is reported
    expect(io2.lines.join('\n')).toContain(`wrote ${out}`);
    expect(io2.warnings.join('\n')).toMatch(/duplicate contents/);
  });

  it('license-report --source jsonl --dry-run works on an empty directory', async () => {
    const io = memoryIo();
    const empty = mkdtempSync(join(tmpdir(), 'lr-'));
    expect(await runCli(licenseReport.spec, ['--source', 'jsonl', '--jsonl-dir', empty, '--dry-run'], licenseReport.main, io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/items=0/);
  });

  it('seed-languages --dry-run writes reviewable SQL', async () => {
    const io = memoryIo();
    const out = join(mkdtempSync(join(tmpdir(), 'seed-')), 'seed.sql');
    expect(await runCli(seedLanguages.spec, ['--dry-run', '--sql-out', out, '--sources', 'en'], seedLanguages.main, io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/communicative_intents/);
    expect(io.lines.join('\n')).toContain('dry-run: nothing applied');
  });

  it('validate-course-coverage --dry-run passes without a database (env forced off)', async () => {
    const prev = process.env.LANGQUEST_SKIP_LOCAL_STACK;
    const prevUrl = process.env.SUPABASE_URL;
    process.env.LANGQUEST_SKIP_LOCAL_STACK = '1';
    delete process.env.SUPABASE_URL;
    try {
      const io = memoryIo();
      const empty = mkdtempSync(join(tmpdir(), 'cov-'));
      expect(await runCli(validateCoverage.spec, ['--dry-run', '--sources', 'en,fr', '--drafts-dir', empty], validateCoverage.main, io)).toBe(0);
      expect(io.lines.join('\n')).toMatch(/pairs=60 complete=0/);
      expect(io.warnings.join('\n')).toMatch(/database not reachable/);
      const io2 = memoryIo();
      expect(await runCli(validateCoverage.spec, ['--dry-run', '--require-db', '--drafts-dir', empty], validateCoverage.main, io2)).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.LANGQUEST_SKIP_LOCAL_STACK;
      else process.env.LANGQUEST_SKIP_LOCAL_STACK = prev;
      if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
    }
  });

  it('content-factory never calls a model without --live and exports the seed chapter with --from-seed', async () => {
    const io = memoryIo();
    expect(await runCli(contentFactory.spec, ['--track', 'arabic-moroccan', '--source', 'fr', '--dry-run'], contentFactory.main, io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(new RegExp(`chapter plan: ${CHAPTER_1_BLUEPRINT_KEYS.length} model calls`));
    const io2 = memoryIo();
    const prevLive = process.env.LANGQUEST_LIVE_TESTS;
    delete process.env.LANGQUEST_LIVE_TESTS;
    try {
      expect(await runCli(contentFactory.spec, ['--track', 'arabic-moroccan', '--source', 'fr'], contentFactory.main, io2)).toBe(0);
      expect(io2.warnings.join('\n')).toMatch(/No live generation/);
    } finally {
      if (prevLive !== undefined) process.env.LANGQUEST_LIVE_TESTS = prevLive;
    }
    const outDir = mkdtempSync(join(tmpdir(), 'cf-'));
    const io3 = memoryIo();
    expect(await runCli(contentFactory.spec, ['--track', 'arabic-moroccan', '--source', 'fr', '--from-seed', '--out-dir', outDir], contentFactory.main, io3)).toBe(0);
    expect(io3.lines.join('\n')).toMatch(/chapter ary_ch1_arrival_casablanca: 7 missions/);
    const io4 = memoryIo();
    expect(await runCli(contentFactory.spec, ['--track', 'lingala', '--source', 'ru', '--from-seed', '--out-dir', outDir], contentFactory.main, io4)).toBe(1);
    const io5 = memoryIo();
    expect(await runCli(contentFactory.spec, ['--track', 'japanese', '--source', 'en', '--fixture-suite', '--dry-run'], contentFactory.main, io5)).toBe(0);
    expect(io5.lines.join('\n')).toMatch(/fixture suite plan/);
  });
});
