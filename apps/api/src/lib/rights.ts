/**
 * Content-rights helpers shared by audio and admin routes (§7.6, §9.9): `content_rights` rows are never
 * readable by learners, so the API reads them with the service client, decides server-side and only ever
 * returns the attribution text and the boolean outcome.
 */
import type { Row } from '@langquest/db/types';
import { buildAttributionText, isRightsActive, type RightsRecord } from '@langquest/media/rights';
import type { RequestServices } from '../services/context';

export type RightsRow = Row<'content_rights'>;

export function rightsRecord(row: RightsRow | null): RightsRecord | null {
  if (!row) return null;
  return {
    licenseId: row.license_id,
    licenseVersion: row.license_version,
    verified: row.verified,
    commercialRedistribution: row.commercial_redistribution,
    attributionRequired: row.attribution_required,
    attributionText: row.attribution_text,
    authors: row.authors,
    originUrl: row.origin_url,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    permissionGrant: row.permission_grant,
  };
}

const cache = new WeakMap<RequestServices, Map<string, RightsRow | null>>();

/** Load rights rows by id (service client), memoised per request. */
export async function loadRights(s: RequestServices, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, RightsRow>> {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === 'string'))];
  let memo = cache.get(s);
  if (!memo) {
    memo = new Map();
    cache.set(s, memo);
  }
  const missing = wanted.filter((id) => !memo!.has(id));
  if (missing.length) {
    const res = await s.service.from('content_rights').select('*').in('id', missing);
    for (const id of missing) memo.set(id, null);
    for (const row of res.data ?? []) memo.set(row.id, row);
  }
  const out = new Map<string, RightsRow>();
  for (const id of wanted) {
    const row = memo.get(id);
    if (row) out.set(id, row);
  }
  return out;
}

export async function rightsFor(s: RequestServices, id: string | null | undefined): Promise<RightsRow | null> {
  if (!id) return null;
  return (await loadRights(s, [id])).get(id) ?? null;
}

export const attributionFor = (row: RightsRow | null, title?: string | null, speakers?: readonly string[]): string | null => {
  const rec = rightsRecord(row);
  return rec ? buildAttributionText({ ...rec, title: title ?? null, speakers: speakers ?? [] }) : null;
};

export const rightsActive = (row: RightsRow | null, now = new Date()): boolean => isRightsActive(rightsRecord(row), now);
export const redistributable = (row: RightsRow | null, now = new Date()): boolean => rightsActive(row, now) && Boolean(row?.commercial_redistribution);
