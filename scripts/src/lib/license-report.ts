/**
 * Attributions / rights summary (spec §7.6, §9.9, §12.2 "content rights coverage").
 *
 * Sources: `content_rights` rows from the database (with usage counts from `expressions` and
 * `media_assets`) and/or JSONL draft files under `data/drafts` / `data/derived`. Flags every
 * item that cannot be redistributed in the app: unverified, no commercial redistribution,
 * NC/ND/unknown licenses, expired or revoked, attribution required but no attribution text,
 * audio references without a usable license.
 */
import type { DbClient } from '@langquest/db';
import { rightsAllowPublishing } from '@langquest/db';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RightsBearingRecordSchema, type RightsRecord } from './drafts';
import { fileExists, readJsonl } from './io';

export type RightsFlag = 'unverified' | 'no_redistribution_right' | 'noncommercial_license' | 'no_derivatives_license' | 'unknown_license' | 'expired' | 'revoked' | 'attribution_text_missing' | 'audio_license_missing' | 'audio_not_redistributable';

export interface RightsItem {
  source: 'db' | 'jsonl';
  id: string;
  licenseId: string;
  licenseVersion: string | null;
  authors: string[];
  originUrl: string | null;
  attributionRequired: boolean;
  attributionText: string | null;
  commercialRedistribution: boolean;
  verified: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  usedBy: { expressions: number; mediaAssets: number };
  flags: RightsFlag[];
  file?: string;
}

export interface LicenseReport {
  generatedAt: string;
  items: RightsItem[];
  byLicense: Record<string, { total: number; redistributable: number; flagged: number }>;
  totals: { items: number; redistributable: number; flagged: number; verified: number };
  flagCounts: Record<RightsFlag, number>;
  attributions: string[];
}

const EMPTY_FLAGS: Record<RightsFlag, number> = { unverified: 0, no_redistribution_right: 0, noncommercial_license: 0, no_derivatives_license: 0, unknown_license: 0, expired: 0, revoked: 0, attribution_text_missing: 0, audio_license_missing: 0, audio_not_redistributable: 0 };

/** Flags for one rights record (pure). */
export function flagsFor(r: { licenseId: string; verified: boolean; commercialRedistribution: boolean; attributionRequired: boolean; attributionText: string | null; expiresAt: string | null; revokedAt: string | null }, now = new Date()): RightsFlag[] {
  const flags: RightsFlag[] = [];
  if (!r.verified) flags.push('unverified');
  if (!r.commercialRedistribution) flags.push('no_redistribution_right');
  if (/-NC\b|NON-?COMMERCIAL/i.test(r.licenseId)) flags.push('noncommercial_license');
  if (/-ND\b|NO-?DERIV/i.test(r.licenseId)) flags.push('no_derivatives_license');
  if (/^unknown$/i.test(r.licenseId) || !/^(CC0|CC-BY|MIT|Apache|owner-|original|licensed|public-domain|contract)/i.test(r.licenseId)) flags.push('unknown_license');
  if (r.expiresAt && new Date(r.expiresAt).getTime() <= now.getTime()) flags.push('expired');
  if (r.revokedAt) flags.push('revoked');
  if (r.attributionRequired && !r.attributionText) flags.push('attribution_text_missing');
  return flags;
}

/** Build the report from items (pure). */
export function buildReport(items: RightsItem[], now = new Date()): LicenseReport {
  const byLicense: LicenseReport['byLicense'] = {};
  const flagCounts = { ...EMPTY_FLAGS };
  let redistributable = 0;
  let flagged = 0;
  let verified = 0;
  const attributions = new Set<string>();
  for (const it of items) {
    const ok = rightsAllowPublishing({ verified: it.verified, revoked_at: it.revokedAt, expires_at: it.expiresAt, commercial_redistribution: it.commercialRedistribution }, now);
    if (ok) redistributable += 1;
    if (it.flags.length) flagged += 1;
    if (it.verified) verified += 1;
    for (const f of it.flags) flagCounts[f] += 1;
    const b = (byLicense[it.licenseId] ??= { total: 0, redistributable: 0, flagged: 0 });
    b.total += 1;
    if (ok) b.redistributable += 1;
    if (it.flags.length) b.flagged += 1;
    if (it.attributionRequired && it.attributionText) attributions.add(it.attributionText);
  }
  return { generatedAt: now.toISOString(), items, byLicense, totals: { items: items.length, redistributable, flagged, verified }, flagCounts, attributions: [...attributions].sort() };
}

/** Load `content_rights` + usage counts from the database. */
export async function loadDbRights(db: DbClient, now = new Date()): Promise<RightsItem[]> {
  const { data, error } = await db.from('content_rights').select('id, license_id, license_version, authors, origin_url, attribution_required, attribution_text, commercial_redistribution, verified, expires_at, revoked_at');
  if (error) throw new Error(`content_rights read failed: ${error.message}`);
  const rows = data ?? [];
  const expr = await db.from('expressions').select('content_rights_id').not('content_rights_id', 'is', null);
  if (expr.error) throw new Error(`expressions read failed: ${expr.error.message}`);
  const media = await db.from('media_assets').select('content_rights_id').not('content_rights_id', 'is', null);
  if (media.error) throw new Error(`media_assets read failed: ${media.error.message}`);
  const count = (rowsIn: Array<{ content_rights_id: string | null }>): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rowsIn) if (r.content_rights_id) m.set(r.content_rights_id, (m.get(r.content_rights_id) ?? 0) + 1);
    return m;
  };
  const exprCounts = count(expr.data ?? []);
  const mediaCounts = count(media.data ?? []);
  return rows.map((r) => {
    const base = { licenseId: r.license_id, verified: r.verified, commercialRedistribution: r.commercial_redistribution, attributionRequired: r.attribution_required, attributionText: r.attribution_text, expiresAt: r.expires_at, revokedAt: r.revoked_at };
    return { source: 'db', id: r.id, licenseId: r.license_id, licenseVersion: r.license_version, authors: r.authors, originUrl: r.origin_url, attributionRequired: r.attribution_required, attributionText: r.attribution_text, commercialRedistribution: r.commercial_redistribution, verified: r.verified, expiresAt: r.expires_at, revokedAt: r.revoked_at, usedBy: { expressions: exprCounts.get(r.id) ?? 0, mediaAssets: mediaCounts.get(r.id) ?? 0 }, flags: flagsFor(base, now) };
  });
}

/** Recursively find JSONL files. */
export function findJsonlFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (!fileExists(dir) || depth > 6) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findJsonlFiles(p, out, depth + 1);
    else if (p.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

/** Load rights from JSONL drafts (expression drafts, corpus rights drafts, factory drafts). */
export async function loadJsonlRights(files: readonly string[], now = new Date()): Promise<RightsItem[]> {
  const items: RightsItem[] = [];
  for (const file of files) {
    for await (const rec of readJsonl<unknown>(file)) {
      const parsed = RightsBearingRecordSchema.safeParse(rec);
      if (!parsed.success) continue;
      const r = parsed.data.rights as RightsRecord | undefined;
      const id = parsed.data.draftId ?? `${file}#?`;
      if (r) {
        const base = { licenseId: r.licenseId, verified: false, commercialRedistribution: r.commercialRedistribution, attributionRequired: r.attributionRequired, attributionText: r.attributionText, expiresAt: null, revokedAt: null };
        const flags = flagsFor(base, now);
        for (const a of parsed.data.audio ?? []) {
          if (!a.licenseId) {
            if (!flags.includes('audio_license_missing')) flags.push('audio_license_missing');
          } else if (!a.redistributionPermitted && !flags.includes('audio_not_redistributable')) flags.push('audio_not_redistributable');
        }
        items.push({ source: 'jsonl', id, licenseId: r.licenseId, licenseVersion: r.licenseVersion, authors: r.authors, originUrl: r.originUrl, attributionRequired: r.attributionRequired, attributionText: r.attributionText, commercialRedistribution: r.commercialRedistribution, verified: false, expiresAt: null, revokedAt: null, usedBy: { expressions: parsed.data.kind === 'expression_draft' ? 1 : 0, mediaAssets: 0 }, flags, file });
      }
    }
  }
  return items;
}

export function renderMarkdown(report: LicenseReport): string {
  const l: string[] = [];
  l.push('# License and attribution report');
  l.push('');
  l.push(`Generated ${report.generatedAt}. Items: ${report.totals.items} · verified: ${report.totals.verified} · redistributable now: ${report.totals.redistributable} · flagged: ${report.totals.flagged}.`);
  l.push('');
  l.push('## By license');
  l.push('');
  l.push('| License | Items | Redistributable | Flagged |');
  l.push('|---|---:|---:|---:|');
  for (const [lic, b] of Object.entries(report.byLicense).sort((a, b) => b[1].total - a[1].total)) l.push(`| ${lic} | ${b.total} | ${b.redistributable} | ${b.flagged} |`);
  l.push('');
  l.push('## Flags');
  l.push('');
  for (const [f, n] of Object.entries(report.flagCounts)) if (n > 0) l.push(`- ${f}: ${n}`);
  if (Object.values(report.flagCounts).every((n) => n === 0)) l.push('- none');
  l.push('');
  l.push('## Items missing redistribution rights (first 50)');
  l.push('');
  const blocked = report.items.filter((i) => i.flags.includes('no_redistribution_right') || i.flags.includes('revoked') || i.flags.includes('expired'));
  if (!blocked.length) l.push('- none');
  for (const i of blocked.slice(0, 50)) l.push(`- ${i.id} (${i.licenseId}; used by ${i.usedBy.expressions} expressions, ${i.usedBy.mediaAssets} assets): ${i.flags.join(', ')}`);
  l.push('');
  l.push(`## Attribution texts (${report.attributions.length})`);
  l.push('');
  for (const a of report.attributions.slice(0, 200)) l.push(`- ${a}`);
  if (report.attributions.length > 200) l.push(`- … ${report.attributions.length - 200} more`);
  return l.join('\n') + '\n';
}
