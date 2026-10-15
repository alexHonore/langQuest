import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpusRights, inventoryCorpus, readAcknowledgement } from './corpora';

const FIXTURES = resolve(__dirname, '../fixtures/corpora');

describe('corpora adapters', () => {
  it('parses a valid acknowledgement and rejects incomplete ones', async () => {
    const ack = await readAcknowledgement(resolve(FIXTURES, 'fleurs/LICENSE_ACKNOWLEDGEMENT.md'));
    expect(ack).toMatchObject({ dataset: 'FLEURS', license: 'CC BY 4.0', redistribution_permitted: 'no', locales: ['fr_fr'] });
    const dir = mkdtempSync(join(tmpdir(), 'ack-'));
    const bad = join(dir, 'LICENSE_ACKNOWLEDGEMENT.md');
    writeFileSync(bad, 'dataset: X\nlicense: CC0\n');
    await expect(readAcknowledgement(bad)).rejects.toThrow(/Invalid/);
    await expect(readAcknowledgement(join(dir, 'missing.md'))).rejects.toThrow(/Missing/);
  });

  it('inventories FLEURS without redistribution rights unless acknowledged', async () => {
    const inv = await inventoryCorpus('fleurs', FIXTURES);
    expect(inv.locales).toHaveLength(1);
    expect(inv.locales[0]).toMatchObject({ locale: 'fr_fr', varietyId: 'fr', audioFileCount: 2, transcriptRows: 2, problems: [] });
    expect(inv.locales[0]!.transcriptFiles[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.rights.commercialRedistribution).toBe(false);
    expect(inv.rights.licenseId).toBe('CC-BY');
    expect(inv.internalBenchmarkOnly).toBe(true);
    expect(inv.problems).toEqual([]);
  });

  it('never grants Common Voice redistribution even when the acknowledgement claims it', async () => {
    const inv = await inventoryCorpus('common-voice', FIXTURES);
    expect(inv.locales[0]).toMatchObject({ locale: 'fr', varietyId: 'fr', audioFileCount: 2, transcriptRows: 2 });
    expect(inv.locales[0]!.extra).toMatchObject({ validated: 2, invalidated: 1 });
    expect(inv.rights.commercialRedistribution).toBe(false);
    expect(inv.internalBenchmarkOnly).toBe(true);
    expect(inv.problems.join(' ')).toMatch(/forbid mirroring/);
    expect(inv.rights.notes.join(' ')).toMatch(/no re-posting/);
  });

  it('refuses sources without an acknowledgement file', async () => {
    await expect(inventoryCorpus('openslr', FIXTURES)).rejects.toThrow(/LICENSE_ACKNOWLEDGEMENT/);
  });

  it('derives rights conservatively from the license text', () => {
    const base = { dataset: 'X', version: '1', license: 'CC BY-NC 4.0', license_url: 'https://x', source_url: 'https://x', acquired_at: '2026-10-14', acquired_by: 'me', terms_accepted: 'yes' as const, redistribution_permitted: 'yes' as const, locales: [], notes: '' };
    expect(corpusRights('openslr', base).commercialRedistribution).toBe(false);
    expect(corpusRights('openslr', { ...base, license: 'CC BY 4.0' }).commercialRedistribution).toBe(true);
    expect(corpusRights('openslr', { ...base, license: 'proprietary research license' }).commercialRedistribution).toBe(false);
  });
});
