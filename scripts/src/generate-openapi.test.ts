/**
 * generate-openapi: every ROUTES entry is one operation with the right method, path and auth class; the
 * route → schema table agrees with what the handlers in apps/api actually parse; the output is deterministic
 * and the checked-in docs/api/openapi.json is current. Offline: reads source files only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as contracts from '@langquest/contracts';
import { ROUTES, type RouteDef, type RouteKey } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OUT,
  PATH_PARAM_SCHEMAS,
  ROUTE_SCHEMAS,
  buildOpenApi,
  callArguments,
  main,
  parseDefaultRoleSet,
  parseRoleSets,
  readApiSources,
  renderOpenApi,
  scanRouteSource,
  spec,
  stableStringify,
  successStatusesOf,
  toOpenApiPath,
} from './generate-openapi';
import { memoryIo, runCli } from './lib/cli';
import { repoRoot } from './lib/io';

type Op = Record<string, unknown> & { operationId: string; security: unknown[]; parameters?: { name?: string; in?: string; $ref?: string }[]; responses: Record<string, unknown>; requestBody?: unknown };
type Doc = { openapi: string; paths: Record<string, Record<string, Op>>; components: { schemas: Record<string, unknown> } };

const root = repoRoot();
const sources = readApiSources(root);
const doc = buildOpenApi({ sources, version: 'test' }) as unknown as Doc;
const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })));
const byKey = new Map(ops.map((o) => [o.op.operationId, o]));
const scanned = new Map(sources.routes.map((r) => [r.key, r]));
const isContractSchema = (name: string): boolean => (contracts as Record<string, unknown>)[name] !== undefined && name.endsWith('Schema');
const sameSchema = (a: string, b: string): boolean => (contracts as Record<string, unknown>)[a] === (contracts as Record<string, unknown>)[b];

describe('generate-openapi: ROUTES coverage', () => {
  it('emits an OpenAPI 3.1 document with one operation per ROUTES entry plus GET / and GET /healthz', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(ops).toHaveLength(Object.keys(ROUTES).length + 2);
    expect(byKey.get('healthz')?.path).toBe('/healthz');
    expect(byKey.get('root')?.path).toBe('/');
    const routeOps = ops.filter((o) => o.op['x-langquest-route-key'] !== null);
    expect(new Set(routeOps.map((o) => o.op.operationId))).toEqual(new Set(Object.keys(ROUTES)));
  });

  it('gives every route its method, path, contract auth class and security requirement', () => {
    for (const [key, def] of Object.entries(ROUTES) as [RouteKey, RouteDef][]) {
      const found = byKey.get(key);
      expect(found, key).toBeDefined();
      expect(found!.method, key).toBe(def.method.toLowerCase());
      expect(found!.path, key).toBe(toOpenApiPath(def.path));
      expect(found!.op['x-langquest-route-key'], key).toBe(key);
      expect(found!.op['x-langquest-auth'], key).toBe(def.auth);
      const effective = (found!.op['x-langquest-effective-auth'] as string | undefined) ?? def.auth;
      expect(found!.op.security, key).toEqual(effective === 'public' ? [] : [{ bearerAuth: [] }]);
      if (effective !== 'public') expect(found!.op.responses['401'], key).toBeDefined();
      if (effective === 'admin') {
        expect(found!.op.responses['403'], key).toBeDefined();
        const gate = sources.roleSets[found!.op['x-langquest-role-set'] as string];
        const narrowed = ROUTE_SCHEMAS[key]?.requiredRoles;
        if (narrowed?.length) {
          // The handler narrows the gate: the documented roles are the handler's, the gate's set is kept alongside.
          expect(found!.op['x-langquest-roles'], key).toEqual([...narrowed]);
          expect(found!.op['x-langquest-gate-roles'], key).toEqual(gate);
          for (const role of narrowed) expect(gate, `${key}: ${role}`).toContain(role);
        } else {
          expect(found!.op['x-langquest-roles'], key).toEqual(gate);
          expect(found!.op['x-langquest-gate-roles'], key).toBeUndefined();
        }
      } else expect(found!.op['x-langquest-role-set'], key).toBeUndefined();
      const declared = (found!.op.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name);
      expect(declared, key).toEqual([...def.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    }
  });

  it('documents the handler overrides and role sets read from apps/api', () => {
    expect(byKey.get('authSessionRefresh')!.op['x-langquest-auth']).toBe('learner');
    expect(byKey.get('authSessionRefresh')!.op['x-langquest-effective-auth']).toBe('public');
    expect(byKey.get('authSessionRefresh')!.op['x-langquest-rate-class']).toBe('auth');
    expect(byKey.get('adminModelConfigPut')!.op['x-langquest-roles']).toEqual(['super_admin', 'admin']);
    expect(byKey.get('adminContentRequestReview')!.op['x-langquest-role-set']).toBe('languageReviewer');
    expect(byKey.get('adminSpeakersList')!.op['x-langquest-role-set']).toBe('staff');
    expect(byKey.get('conversationTurn')!.op['x-langquest-rate-class']).toBe('ai');
    expect(byKey.get('mediaStream')!.op.security).toEqual([]);
    expect(Object.keys(byKey.get('mediaStream')!.op.responses)).toEqual(expect.arrayContaining(['200', '206', '401']));
    // Idempotency-Key layer: on mutating routes unless the handler opts out.
    const hasIdem = (key: string) => (byKey.get(key)!.op.parameters ?? []).some((p) => p.$ref === '#/components/parameters/IdempotencyKey');
    expect(hasIdem('enrollmentsCreate')).toBe(true);
    expect(hasIdem('progressSync')).toBe(false);
    expect(hasIdem('me')).toBe(false);
  });

  it('marks a route missing from the table and the handlers as unmapped instead of dropping it', () => {
    const routes = { ...ROUTES, futureAdminThing: { method: 'GET', path: '/v1/admin/future/:id', auth: 'admin' } } as Record<string, RouteDef>;
    const d = buildOpenApi({ routes, sources, version: 'test' }) as unknown as Doc;
    const op = d.paths['/v1/admin/future/{id}']!.get!;
    expect(op['x-langquest-schema-source']).toBe('none');
    expect(op['x-langquest-role-set']).toBe('staff');
  });
});

describe('generate-openapi: ROUTE_SCHEMAS agrees with the apps/api handlers', () => {
  it('has an entry for every ROUTES key, so no operation falls back to the handler scan', () => {
    const missing = Object.keys(ROUTES).filter((key) => !(key in ROUTE_SCHEMAS));
    expect(missing, 'add these routes to ROUTE_SCHEMAS in scripts/src/generate-openapi.ts').toEqual([]);
    for (const key of Object.keys(ROUTES)) expect(byKey.get(key)!.op['x-langquest-schema-source'], key).toBe('table');
  });

  it('types every path parameter (a validator for each :param in ROUTES, never a bare string)', () => {
    for (const [key, def] of Object.entries(ROUTES) as [RouteKey, RouteDef][]) {
      for (const [, name] of def.path.matchAll(/:([A-Za-z0-9_]+)/g)) {
        expect(Object.keys(PATH_PARAM_SCHEMAS), `${key}: :${name}`).toContain(name);
        const param = (byKey.get(key)!.op.parameters ?? []).find((p) => p.in === 'path' && p.name === name) as { schema?: unknown } | undefined;
        expect(param?.schema, `${key}: :${name}`).not.toEqual({ type: 'string' });
      }
    }
    const revoke = byKey.get('adminUserRoleRevoke')!.op.parameters!.filter((p) => p.in === 'path') as { name: string; schema: { format?: string; enum?: string[] } }[];
    expect(revoke.find((p) => p.name === 'userId')!.schema.format).toBe('uuid');
    expect(revoke.find((p) => p.name === 'role')!.schema.enum).toEqual(expect.arrayContaining(['super_admin', 'admin', 'content_editor', 'language_reviewer', 'support_readonly']));
  });

  it('documents exactly the 2xx statuses each handler answers with (respondOk / new Response literals)', () => {
    let checked = 0;
    for (const [key, entry] of Object.entries(ROUTE_SCHEMAS)) {
      const scan = scanned.get(key);
      if (!scan || (scan.successStatuses.length === 0 && !scan.dynamicStatus)) continue;
      checked += 1;
      const documented = [...(entry!.success ?? [200])].sort((a, b) => a - b);
      if (scan.dynamicStatus) {
        // A status computed elsewhere (e.g. `initiateUploadSession`): the table must list it explicitly.
        expect(entry!.success, `${key}: handler status is computed; list it in ROUTE_SCHEMAS.success`).toBeDefined();
        for (const status of scan.successStatuses) expect(documented, `${key}: ${status}`).toContain(status);
      } else expect(documented, `${key}: ROUTE_SCHEMAS.success vs ${scan.file}`).toEqual(scan.successStatuses);
      const op = byKey.get(key)!.op;
      for (const status of documented) expect(op.responses[String(status)], `${key}: ${status}`).toBeDefined();
    }
    expect(checked).toBeGreaterThanOrEqual(Object.keys(ROUTE_SCHEMAS).length - 1);
    expect(Object.keys(byKey.get('adminProcessingJobRetry')!.op.responses)).toContain('202');
    expect(Object.keys(byKey.get('adminTranscriptSave')!.op.responses)).toContain('201');
    expect(Object.keys(byKey.get('adminUserRoleGrant')!.op.responses)).toEqual(expect.arrayContaining(['200', '201']));
  });

  it('documents every role guard a handler adds on top of its route gate (requiredRoles)', () => {
    for (const r of sources.routes) {
      const documented = [...(ROUTE_SCHEMAS[r.key as RouteKey]?.requiredRoles ?? [])].sort();
      expect(documented, `${r.file}: ${r.key}`).toEqual(r.requiredRoles);
    }
    for (const key of ['adminUserRoleGrant', 'adminUserRoleRevoke']) {
      expect(byKey.get(key)!.op['x-langquest-roles'], key).toEqual(['super_admin']);
      expect(byKey.get(key)!.op['x-langquest-role-set'], key).toBe('admin');
      expect(byKey.get(key)!.op.description, key).toContain('Requires one of: super_admin.');
    }
  });

  it('maps only ROUTES keys, and every name is a Zod schema exported by contracts', () => {
    for (const [key, entry] of Object.entries(ROUTE_SCHEMAS)) {
      expect(Object.keys(ROUTES), key).toContain(key);
      for (const name of [entry!.query, entry!.body, entry!.response]) if (name && name !== 'binary') expect(isContractSchema(name), `${key}: ${name}`).toBe(true);
    }
  });

  it('uses the body/query schema the handler parses (or documents a contract schema where the handler extends it locally)', () => {
    let checked = 0;
    for (const [key, entry] of Object.entries(ROUTE_SCHEMAS)) {
      const scan = scanned.get(key);
      if (!scan) continue; // enrollmentDelete is registered in app.ts with a handler function
      checked += 1;
      for (const [kind, names, mapped] of [
        ['body', scan.bodySchemas, entry!.body],
        ['query', scan.querySchemas, entry!.query],
      ] as const) {
        if (names.length === 0) {
          if (kind === 'query' && scan.rawQueryParams.length) {
            // The handler reads `c.req.query('<name>')` directly: the mapped contract schema must declare those params.
            const shape = ((contracts as Record<string, unknown>)[mapped!] as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
            for (const param of scan.rawQueryParams) expect(Object.keys(shape), `${key}: query param ${param}`).toContain(param);
            continue;
          }
          expect(mapped, `${key}: handler parses no ${kind}`).toBeUndefined();
          continue;
        }
        expect(mapped, `${key}: handler parses a ${kind} (${names.join(', ')})`).toBeDefined();
        const contractNames = names.filter(isContractSchema);
        if (contractNames.length) expect(contractNames.some((n) => sameSchema(n, mapped!)), `${key}: ${kind} ${mapped} vs handler ${contractNames.join(', ')}`).toBe(true);
      }
      const responseNames = scan.responseSchemas.filter(isContractSchema);
      if (responseNames.length && entry!.response && entry!.response !== 'binary') {
        expect(responseNames.some((n) => sameSchema(n, entry!.response as string)), `${key}: response ${entry!.response} vs handler ${responseNames.join(', ')}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(Object.keys(ROUTE_SCHEMAS).length - 1);
  });

  it('every handler in apps/api/src/routes registers a ROUTES key', () => {
    for (const r of sources.routes) expect(Object.keys(ROUTES), `${r.file}: ${r.key}`).toContain(r.key);
  });
});

describe('generate-openapi: source parsers', () => {
  it('scans define() blocks for options and parsed schemas', () => {
    const src = [
      "define('alpha', { role: 'contentEditor', idempotent: false, rate: 'ai' }, async (c) => {",
      '  const body = await parseBody(c, AlphaRequestSchema);',
      '  const q = parseQuery(c, AlphaQuerySchema);',
      '  return respondOk(c, AlphaResponseSchema.parse({}), 201);',
      '});',
      "define('beta', {}, async (c) => respondOk(c, await helper()));",
    ].join('\n');
    const [alpha, beta] = scanRouteSource(src, 'x.ts');
    expect(alpha).toMatchObject({ key: 'alpha', role: 'contentEditor', rate: 'ai', idempotent: false, bodySchemas: ['AlphaRequestSchema'], querySchemas: ['AlphaQuerySchema'], responseSchemas: ['AlphaResponseSchema'] });
    expect(beta).toMatchObject({ key: 'beta', idempotent: true, bodySchemas: [], querySchemas: [], rawQueryParams: [], responseSchemas: [] });
    expect(scanRouteSource("define('gamma', {}, async (c) => { const t = c.req.query('t'); });")[0]!.rawQueryParams).toEqual(['t']);
    const withHelper = ['function readQ(c: Ctx): Q {', '  return parseQuery(c, DeltaQuerySchema);', '}', '', 'export function register(define) {', "  define('delta', {}, async (c) => respondOk(c, readQ(c)));", '}'].join('\n');
    expect(scanRouteSource(withHelper)[0]!.querySchemas).toEqual(['DeltaQuerySchema']);
    expect(beta!.role).toBeUndefined();
    expect(alpha!.successStatuses).toEqual([201]);
    expect(beta!.successStatuses).toEqual([200]);
  });

  it('reads success statuses from respondOk and raw Response calls', () => {
    expect(callArguments("respondOk(c, X.parse({ a: f(1, 2), b: 'x, )' }), before ? 200 : 202, )", 9)).toEqual(['c', "X.parse({ a: f(1, 2), b: 'x, )' })", 'before ? 200 : 202']);
    expect(successStatusesOf('return respondOk(c, a);')).toEqual({ statuses: [200], dynamic: false });
    expect(successStatusesOf('return respondOk(\n  c,\n  A.parse({ x: `t(${y})` }),\n  replay ? 200 : 201,\n);')).toEqual({ statuses: [200, 201], dynamic: false });
    expect(successStatusesOf('return respondOk(c, response, status);')).toEqual({ statuses: [], dynamic: true });
    expect(successStatusesOf("if (m) return new Response(null, { status: 304 }); return new Response(body, { status: 200, headers: { a: 'b' } });")).toEqual({ statuses: [200], dynamic: false });
    expect(successStatusesOf('return new Response(o.body, { status: h.status, headers: h.headers });')).toEqual({ statuses: [], dynamic: true });
  });

  it('reads role guards from the handler block and from module helpers it calls', () => {
    const src = [
      'function requireOwner(s: S): P {',
      '  const { principal } = s.requireUser();',
      "  if (!principal.roles.includes('super_admin')) throw problem.forbidden('no');",
      '  return principal;',
      '}',
      '',
      'export function register(define) {',
      "  define('guarded', { role: 'admin' }, async (c) => { requireOwner(c.get('services')); return respondOk(c, 1); });",
      "  define('open', { role: 'admin' }, async (c) => respondOk(c, 2));",
      '}',
    ].join('\n');
    const [guarded, open] = scanRouteSource(src);
    expect(guarded!.requiredRoles).toEqual(['super_admin']);
    expect(open!.requiredRoles).toEqual([]);
    expect(sources.routes.find((r) => r.key === 'adminUserRoleGrant')!.requiredRoles).toEqual(['super_admin']);
  });

  it('reads ROLE_SETS and the default admin role set from apps/api', () => {
    expect(parseRoleSets("export const ROLE_SETS = {\n  staff: ['a', 'b'],\n  admin: ['a'],\n} as const")).toEqual({ staff: ['a', 'b'], admin: ['a'] });
    expect(sources.roleSets.contentEditor).toEqual(['super_admin', 'admin', 'content_editor']);
    expect(parseDefaultRoleSet("chain.push(requireRoles(opts.role ?? 'staff'));")).toBe('staff');
    expect(sources.defaultRoleSet).toBe('staff');
    expect(sources.ratePolicies.ingress).toEqual({ perMinute: 1200, burst: 400 });
  });
});

describe('generate-openapi: output', () => {
  it('resolves every $ref to a component and leaves no nested $defs', () => {
    const text = JSON.stringify(doc);
    const refs = new Set([...text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!));
    for (const ref of refs) expect(doc.components.schemas, ref).toHaveProperty([ref]);
    expect(text).not.toContain('"$defs"');
    expect(text).not.toContain('__shared');
    expect(doc.components.schemas).toHaveProperty(['ApiFailure']);
  });

  it('is deterministic: sorted keys, no timestamps, identical across runs', () => {
    const a = renderOpenApi(root);
    expect(renderOpenApi(root)).toBe(a);
    expect(a).not.toMatch(/"20\d\d-\d\d-\d\dT\d\d:/);
    expect(stableStringify({ b: 1, a: { d: [3, 1], c: null } })).toBe('{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      1\n    ]\n  },\n  "b": 1\n}\n');
  });

  it('docs/api/openapi.json is current (regenerate: pnpm --filter @langquest/scripts exec tsx src/generate-openapi.ts)', () => {
    const onDisk = readFileSync(resolve(root, DEFAULT_OUT), 'utf8');
    const parsed = JSON.parse(onDisk) as Doc;
    for (const def of Object.values(ROUTES)) expect(parsed.paths[toOpenApiPath(def.path)]?.[def.method.toLowerCase()], `${def.method} ${def.path}`).toBeDefined();
    expect(onDisk === renderOpenApi(root), 'docs/api/openapi.json is stale').toBe(true);
  });

  it('CLI: --help, --dry-run and --check run without writing', async () => {
    const help = memoryIo();
    expect(await runCli(spec, ['--help'], main, help)).toBe(0);
    expect(help.lines.join('\n')).toContain('generate-openapi —');
    const dry = memoryIo();
    expect(await runCli(spec, ['--dry-run'], main, dry)).toBe(0);
    expect(dry.lines.join('\n')).toContain('dry-run: would write docs/api/openapi.json');
    const check = memoryIo();
    expect(await runCli(spec, ['--check'], main, check)).toBe(0);
  });
});
