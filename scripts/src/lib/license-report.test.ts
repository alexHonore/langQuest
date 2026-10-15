import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyLicense } from './drafts';
import { writeJsonl } from './io';
import { buildReport, findJsonlFiles, flagsFor, loadJsonlRights, renderMarkdown, type RightsItem } from './license-report';

const item = (over: Partial<RightsItem>): RightsItem => ({ source: 'db', id: 'r1', licenseId: 'CC-BY', licenseVersion: '4.0', authors: ['a'], originUrl: null, attributionRequired: true, attributionText: 'by a', commercialRedistribution: true, verified: true, expiresAt: null, revokedAt: null, usedBy: { expressions: 1, mediaAssets: 0 }, flags: [], ...over });

describe('classifyLicense', () => {
  it('normalises CC variants and treats unknown licenses as granting nothing', () => {
    expect(classifyLicense('CC BY-NC-ND 3.0')).toMatchObject({ licenseId: 'CC-BY-NC-ND', licenseVersion: '3.0', commercialRedistribution: false, alterationsPermitted: false, attributionRequired: true, known: true });
    expect(classifyLicense('CC BY 2.0 FR')).toMatchObject({ licenseId: 'CC-BY', commercialRedistribution: true, alterationsPermitted: true });
    expect(classifyLicense('CC0 1.0')).toMatchObject({ licenseId: 'CC0', attributionRequired: false, commercialRedistribution: true });
    expect(classifyLicense('')).toMatchObject({ licenseId: 'unknown', known: false, commercialRedistribution: false });
    expect(classifyLicense('Some Research License')).toMatchObject({ known: false, commercialRedistribution: false });
  });
});

describe('license report', () => {
  it('flags unverified, NC, expired, revoked and missing attribution', () => {
    const now = new Date('2026-10-14T00:00:00Z');
    expect(flagsFor({ licenseId: 'CC-BY', verified: true, commercialRedistribution: true, attributionRequired: true, attributionText: 'x', expiresAt: null, revokedAt: null }, now)).toEqual([]);
    expect(flagsFor({ licenseId: 'CC-BY-NC', verified: false, commercialRedistribution: false, attributionRequired: true, attributionText: null, expiresAt: '2020-01-01T00:00:00Z', revokedAt: '2021-01-01T00:00:00Z' }, now)).toEqual(['unverified', 'no_redistribution_right', 'noncommercial_license', 'expired', 'revoked', 'attribution_text_missing']);
    expect(flagsFor({ licenseId: 'mystery', verified: true, commercialRedistribution: true, attributionRequired: false, attributionText: null, expiresAt: null, revokedAt: null }, now)).toEqual(['unknown_license']);
  });

  it('aggregates by license and renders markdown', () => {
    const now = new Date('2026-10-14T00:00:00Z');
    const items = [item({}), item({ id: 'r2', licenseId: 'CC-BY-NC', commercialRedistribution: false, verified: false, flags: ['unverified', 'no_redistribution_right', 'noncommercial_license'] })];
    const report = buildReport(items, now);
    expect(report.totals).toEqual({ items: 2, redistributable: 1, flagged: 1, verified: 1 });
    expect(report.byLicense['CC-BY-NC']).toEqual({ total: 1, redistributable: 0, flagged: 1 });
    expect(report.attributions).toEqual(['by a']);
    const md = renderMarkdown(report);
    expect(md).toContain('| CC-BY-NC | 1 | 0 | 1 |');
    expect(md).toContain('r2 (CC-BY-NC');
  });

  it('reads rights from JSONL drafts including audio refs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lic-'));
    const file = join(dir, 'nested', 'a.jsonl');
    await writeJsonl(file, [
      { kind: 'expression_draft', draftId: 'tatoeba:spa:1', rights: { licenseId: 'CC-BY', licenseVersion: '2.0', licenseSource: 'export_default', authors: [], originUrl: null, attributionRequired: true, attributionText: 'Sentence #1', commercialRedistribution: true, alterationsPermitted: true, aiProcessingPermitted: true, verified: false, notes: [] }, audio: [{ upstreamId: '9', locator: 'x', speaker: null, licenseId: null, attributionUrl: null, redistributionPermitted: false, note: null }] },
      { kind: 'something_else' },
    ]);
    expect(findJsonlFiles(dir)).toEqual([file]);
    const items = await loadJsonlRights([file]);
    expect(items).toHaveLength(1);
    expect(items[0]!.flags).toEqual(['unverified', 'audio_license_missing']);
    expect(items[0]!.usedBy.expressions).toBe(1);
  });
});
