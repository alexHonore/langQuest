/**
 * Boolean query-string flags. Query values always arrive as strings, and `z.coerce.boolean()` reads every non-empty
 * string (including `"false"` and `"0"`) as `true`, so `?includeTranscript=false` used to include the transcript and
 * `?rightsVerified=false` listed only VERIFIED assets. Every flag now goes through the shared `QueryBooleanSchema`
 * (`common.ts`): `true|1` → true, `false|0` → false, absent → the schema default (or `undefined` = no filter), and
 * any other non-empty value (`yes`, `on`, `2`, `null`, ...) → a validation error. That parser is lenient in two
 * ways, pinned by the last-but-one test so a change to it is noticed here: case and surrounding spaces are ignored
 * (`" TRUE "` → true), and an EMPTY value reads as false (`?rightsVerified=` asks for unverified rights; it is not
 * "no filter" and not a 422). The sweep at the end guards every exported `*QuerySchema` against the coercion coming
 * back.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from '../index';
import { AssetsListQuerySchema, BulkLabelRequestSchema, LicensesAttributionsQuerySchema } from './admin';
import { DownloadPackQuerySchema } from './audio';
import { EnrollmentsListQuerySchema } from './learner';

const TRUE_VALUES = ['true', '1'];
const FALSE_VALUES = ['false', '0'];
const INVALID_VALUES = ['yes', 'no', 'on', 'off', '2', '-1', 'truthy', 'null', 'undefined'];

describe('strict boolean query flags', () => {
  it('download pack: includeTranscript defaults to true, "false" / "0" leave the transcript out, junk is rejected', () => {
    expect(DownloadPackQuerySchema.parse({ deviceId: 'device-1' })).toEqual({ includeTranscript: true, deviceId: 'device-1' });
    for (const v of TRUE_VALUES) expect(DownloadPackQuerySchema.parse({ deviceId: 'device-1', includeTranscript: v }).includeTranscript, v).toBe(true);
    for (const v of FALSE_VALUES) expect(DownloadPackQuerySchema.parse({ deviceId: 'device-1', includeTranscript: v }).includeTranscript, v).toBe(false);
    for (const v of INVALID_VALUES) expect(DownloadPackQuerySchema.safeParse({ deviceId: 'device-1', includeTranscript: v }).success, v).toBe(false);
  });

  it('admin assets list: rightsVerified absent = no filter, "false" asks for UNVERIFIED rights, junk is rejected', () => {
    expect(AssetsListQuerySchema.parse({}).rightsVerified).toBeUndefined();
    for (const v of TRUE_VALUES) expect(AssetsListQuerySchema.parse({ rightsVerified: v }).rightsVerified, v).toBe(true);
    for (const v of FALSE_VALUES) expect(AssetsListQuerySchema.parse({ rightsVerified: v }).rightsVerified, v).toBe(false);
    for (const v of INVALID_VALUES) expect(AssetsListQuerySchema.safeParse({ rightsVerified: v }).success, v).toBe(false);
  });

  it('the bulk-label JSON filter (built from the assets list query) still takes real booleans', () => {
    const filter = (rightsVerified: unknown) => BulkLabelRequestSchema.shape.filter.unwrap().safeParse({ rightsVerified });
    expect(filter(false)).toMatchObject({ success: true, data: { rightsVerified: false } });
    expect(filter(true)).toMatchObject({ success: true, data: { rightsVerified: true } });
    expect(filter('false')).toMatchObject({ success: true, data: { rightsVerified: false } });
    expect(filter('maybe').success).toBe(false);
  });

  it('licence attributions: onlyUnverified absent = every licence, "false" / "0" do not narrow, junk is rejected', () => {
    expect(LicensesAttributionsQuerySchema.parse({}).onlyUnverified).toBeUndefined();
    for (const v of TRUE_VALUES) expect(LicensesAttributionsQuerySchema.parse({ onlyUnverified: v }).onlyUnverified, v).toBe(true);
    for (const v of FALSE_VALUES) expect(LicensesAttributionsQuerySchema.parse({ onlyUnverified: v }).onlyUnverified, v).toBe(false);
    for (const v of INVALID_VALUES) expect(LicensesAttributionsQuerySchema.safeParse({ onlyUnverified: v }).success, v).toBe(false);
  });

  it('enrollments list: includeArchived defaults to false and reads "false" as false', () => {
    expect(EnrollmentsListQuerySchema.parse({}).includeArchived).toBe(false);
    expect(EnrollmentsListQuerySchema.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(EnrollmentsListQuerySchema.parse({ includeArchived: '1' }).includeArchived).toBe(true);
    expect(EnrollmentsListQuerySchema.safeParse({ includeArchived: 'yes' }).success).toBe(false);
  });

  it('the shared parser ignores case and surrounding spaces, and reads an empty value as false (not "no filter")', () => {
    for (const v of ['TRUE', 'True', ' true ', ' 1']) expect(AssetsListQuerySchema.parse({ rightsVerified: v }).rightsVerified, JSON.stringify(v)).toBe(true);
    for (const v of ['FALSE', ' false', '0 ']) expect(AssetsListQuerySchema.parse({ rightsVerified: v }).rightsVerified, JSON.stringify(v)).toBe(false);
    expect(AssetsListQuerySchema.parse({ rightsVerified: '' }).rightsVerified).toBe(false);
    expect(LicensesAttributionsQuerySchema.parse({ onlyUnverified: '' }).onlyUnverified).toBe(false);
    expect(DownloadPackQuerySchema.parse({ deviceId: 'device-1', includeTranscript: '' }).includeTranscript).toBe(false);
  });

  it('sweep: no exported *QuerySchema reads "false" or "0" as true, and every boolean flag rejects junk', () => {
    const querySchemas = Object.entries(contracts as Record<string, unknown>).filter((entry): entry is [string, z.ZodObject] => entry[0].endsWith('QuerySchema') && entry[1] instanceof z.ZodObject);
    expect(querySchemas.length).toBeGreaterThan(10);
    const flags: string[] = [];
    const offenders: string[] = [];
    for (const [name, schema] of querySchemas) {
      for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
        const asTrue = field.safeParse('true');
        if (!asTrue.success || asTrue.data !== true) continue; // not a boolean flag
        flags.push(`${name}.${key}`);
        for (const v of FALSE_VALUES) {
          const r = field.safeParse(v);
          if (!r.success || r.data !== false) offenders.push(`${name}.${key}=${v}`);
        }
        for (const v of INVALID_VALUES) if (field.safeParse(v).success) offenders.push(`${name}.${key}=${v} accepted`);
      }
    }
    expect(flags).toEqual(expect.arrayContaining(['DownloadPackQuerySchema.includeTranscript', 'AssetsListQuerySchema.rightsVerified', 'LicensesAttributionsQuerySchema.onlyUnverified', 'EnrollmentsListQuerySchema.includeArchived']));
    expect(offenders).toEqual([]);
  });
});
