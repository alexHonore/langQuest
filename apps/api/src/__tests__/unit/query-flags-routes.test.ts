/**
 * Boolean query flags at the route level (R-0.3-02, R-6.1-08). Query values always arrive as strings, and
 * `z.coerce.boolean()` reads every non-empty string as `true`, so `GET /v1/me/enrollments?includeArchived=false`
 * used to RETURN archived enrollments. Every handler now parses its flags with the contract schemas built on
 * `QueryBooleanSchema` (`packages/contracts/src/api/common.ts`): `true|1` → true, `false|0` → false (case and
 * surrounding spaces ignored), absent → the schema default (or no filter).
 *
 * Empty value (decided 2026-10-20): `?flag=` and a bare `?flag` are a 422 `validation_failed`, never `false` and never
 * "no filter". No client sends one: the mobile client and the Studio build URLs with `buildPath`, which skips
 * `undefined`, and the Studio filter bars drop empty values (`apps/admin/src/components/filters.tsx`,
 * `visual-assets-screen.tsx` `toQuery`), so an empty flag is a malformed request and guessing would silently flip a
 * filter. Leaving the parameter out gives the default.
 *
 * The sweep checks every boolean flag of every exported `*QuerySchema` against its route through the real app, and
 * fails when a new flag appears without a row here; a source scan keeps `z.coerce.boolean()` out of the API.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as contracts from '@langquest/contracts';
import { EnrollmentsListResponseSchema, apiEnvelope } from '@langquest/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { REPO_ROOT } from '../harness';
import { enrollmentRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const LEARNER_2 = '77777777-7777-4777-8777-777777777777';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const ROLES = { [ADMIN]: ['admin' as const] };
const MISSING_LESSON = '99999999-9999-4999-8999-999999999999';

/** Values that are not a boolean flag: each one is a 422 on every route. `''` is `?flag=`; `null` stands for a bare `?flag`. */
const REJECTED: (string | null)[] = ['', ' ', null, 'yes', 'no', 'on', 'off', '2', '-1', 'null', 'undefined', 'truthy'];
const ACCEPTED = ['true', 'false', '1', '0', 'TRUE', 'False', ' 0 '];

/** `?a=b&flag=value` (or a bare `&flag`), appended to a path that may already carry a query. */
function withFlag(path: string, flag: string, value: string | null): string {
  const sep = path.includes('?') ? '&' : '?';
  return value === null ? `${path}${sep}${flag}` : `${path}${sep}${flag}=${encodeURIComponent(value)}`;
}

/**
 * Every boolean query flag the API reads, by contract schema, with the route that parses it. `path` may carry the
 * other parameters the route requires, so the only invalid input in a request is the flag itself.
 */
const FLAG_ROUTES: { flag: string; schema: string; path: string; user: string }[] = [
  { schema: 'EnrollmentsListQuerySchema', flag: 'includeArchived', path: '/v1/me/enrollments', user: LEARNER },
  { schema: 'DownloadPackQuerySchema', flag: 'includeTranscript', path: `/v1/me/audio-download-pack/${MISSING_LESSON}?deviceId=device-1`, user: LEARNER },
  { schema: 'AssetsListQuerySchema', flag: 'rightsVerified', path: '/v1/admin/assets', user: ADMIN },
  { schema: 'LicensesAttributionsQuerySchema', flag: 'onlyUnverified', path: '/v1/admin/licenses/attributions', user: ADMIN },
  { schema: 'SpeakersListQuerySchema', flag: 'synthetic', path: '/v1/admin/speakers', user: ADMIN },
  { schema: 'ContentRightsListQuerySchema', flag: 'verified', path: '/v1/admin/content-rights', user: ADMIN },
  { schema: 'ContentRightsListQuerySchema', flag: 'revoked', path: '/v1/admin/content-rights', user: ADMIN },
  { schema: 'VisualAssetsListQuerySchema', flag: 'unassigned', path: '/v1/admin/visual-assets', user: ADMIN },
];

/** `Schema.flag` for every field of an exported `*QuerySchema` that parses the string `"true"` to `true`. */
function contractBooleanFlags(): string[] {
  const flags: string[] = [];
  for (const [name, schema] of Object.entries(contracts as Record<string, unknown>)) {
    if (!name.endsWith('QuerySchema') || !(schema instanceof z.ZodObject)) continue;
    for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      const asTrue = field.safeParse('true');
      if (asTrue.success && asTrue.data === true) flags.push(`${name}.${key}`);
    }
  }
  return flags.sort();
}

/** Non-test TypeScript sources under `dir`. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') out.push(...sources(path));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('boolean query flags through the routes', () => {
  let h: RouteHarness;
  beforeEach(() => {
    h = routeHarness({ roles: ROLES });
  });
  afterEach(() => h.restore());

  describe('GET /v1/me/enrollments?includeArchived', () => {
    let active: DbRow;
    let archived: DbRow;
    let learner: string;
    beforeEach(async () => {
      learner = await h.token(LEARNER);
      [active, archived] = h.db.seed('user_course_enrollments', [
        enrollmentRow(LEARNER, 'french', { source_language_code: 'en', added_at: '2026-10-02T10:00:00.000Z' }),
        enrollmentRow(LEARNER, 'german', { source_language_code: 'en', status: 'archived', added_at: '2026-10-01T10:00:00.000Z' }),
        enrollmentRow(LEARNER_2, 'italian', { source_language_code: 'en', status: 'archived', added_at: '2026-10-01T09:00:00.000Z' }),
      ]) as [DbRow, DbRow];
    });
    const list = async (qs: string) => {
      const res = await h.call(`/v1/me/enrollments${qs}`, { token: learner });
      expect(res.status, qs).toBe(200);
      const parsed = apiEnvelope(EnrollmentsListResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      return parsed.data.enrollments.map((e) => e.id);
    };

    it('hides archived courses by default and for false / 0 (the old coercion read "false" as true)', async () => {
      expect(await list('')).toEqual([active.id]);
      for (const v of ['false', '0', 'FALSE', ' false ']) expect(await list(`?includeArchived=${encodeURIComponent(v)}`), v).toEqual([active.id]);
    });

    it('includes archived courses for true / 1, and only the caller’s own', async () => {
      for (const v of ['true', '1', 'True']) expect(await list(`?includeArchived=${v}`), v).toEqual([active.id, archived.id]);
    });

    it('rejects an empty, bare or unknown value with 422 before reading any enrollment', async () => {
      for (const v of REJECTED) {
        const res = await h.call(withFlag('/v1/me/enrollments', 'includeArchived', v), { token: learner });
        expect(res.status, JSON.stringify(v)).toBe(422);
        expect(res.json).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
        expect(JSON.stringify(res.json.error.details), JSON.stringify(v)).toContain('includeArchived');
      }
      expect(h.db.requests.filter((r) => r.target === 'user_course_enrollments')).toEqual([]);
    });
  });

  it('the route table covers every boolean flag the contracts define (a new flag needs a row here)', () => {
    expect(contractBooleanFlags()).toEqual(FLAG_ROUTES.map((r) => `${r.schema}.${r.flag}`).sort());
  });

  // One harness (and one abuse-guard bucket) per route: the sweep sends 19 requests to each.
  it.each(FLAG_ROUTES)('$path rejects an empty, bare or unknown $flag (422) and accepts true / false / 1 / 0', async (route) => {
    const token = await h.token(route.user);
    for (const v of REJECTED) {
      const res = await h.call(withFlag(route.path, route.flag, v), { token });
      const label = `${route.flag}=${JSON.stringify(v)} on ${route.path}`;
      expect(res.status, label).toBe(422);
      expect(res.json.error.code, label).toBe('validation_failed');
      expect(JSON.stringify(res.json.error.details), label).toContain(route.flag);
    }
    for (const v of ACCEPTED) {
      const res = await h.call(withFlag(route.path, route.flag, v), { token });
      // Accepted: the route goes on to answer (200, or 404 for the missing download-pack lesson), never a query 422.
      expect([200, 404], `${route.flag}=${JSON.stringify(v)} on ${route.path}: ${res.status}`).toContain(res.status);
    }
    expect(h.blocked).toEqual([]);
  });

  it('no API or contract source parses a query flag with z.coerce.boolean()', () => {
    const roots = [resolve(REPO_ROOT, 'apps/api/src'), resolve(REPO_ROOT, 'packages/contracts/src')];
    const offenders = roots.flatMap(sources).filter((file) => /coerce\s*\.\s*boolean\s*\(/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(offenders).toEqual([]);
  });
});
