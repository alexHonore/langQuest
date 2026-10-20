/**
 * Offline tests of the Studio write routes that replaced the admin's local Next route handlers (R-4.3-01):
 * coverage, transcript revisions, approve / reject decisions, rollback, job retry, role grants and the model test
 * harness. A small in-memory PostgREST double stands in for Supabase (global `fetch` is stubbed; any request to
 * another host fails the test), roles come from the offline role resolver, and AI probes run on the scripted
 * `FakeReasoner` — nothing here touches a network, a database or a paid provider.
 *
 * Each route is checked for its role gate (answered before any database call), body / param validation, the happy
 * path (rows written, revision + audit recorded) and the honesty rules carried over from the local handlers.
 */
import { ModelProfileRegistry } from '@langquest/ai/profiles';
import { FakeReasoner } from '@langquest/ai/test-support/fakes';
import type { AiServices } from '@langquest/ai';
import { NO_FEATURES, ROUTES, buildPath, planDecision, type Capability, type Role, type RouteKey } from '@langquest/contracts';
import { canTransitionContent } from '@langquest/media/rights';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, AppOptions } from '../../app';
import { call, fakeAiServices, offlineApp as baseOfflineApp, offlineEnv, signTestToken } from '../harness';

const SUPER = '10000000-0000-4000-8000-000000000001';
const ADMIN = '10000000-0000-4000-8000-000000000002';
const EDITOR = '10000000-0000-4000-8000-000000000003';
const REVIEWER = '10000000-0000-4000-8000-000000000004';
const SUPPORT = '10000000-0000-4000-8000-000000000005';
const LEARNER = '10000000-0000-4000-8000-000000000006';
const ROLES: Record<string, Role[]> = { [SUPER]: ['super_admin'], [ADMIN]: ['admin'], [EDITOR]: ['content_editor'], [REVIEWER]: ['language_reviewer'], [SUPPORT]: ['support_readonly'] };
const ID = '20000000-0000-4000-8000-000000000001';
const ID2 = '20000000-0000-4000-8000-000000000002';

type Row = Record<string, unknown>;
interface DbFailure {
  code: string;
  message: string;
}

/**
 * Minimal PostgREST double for the requests supabase-js builds in these routes: filters (`eq`, `neq`, `in`, `is`,
 * `lt`, `gt`), `order`, `limit`, object vs array responses (`Accept`), `Prefer: return=representation | count=exact`,
 * upserts on `on_conflict`, unique keys, a foreign-key check on `user_roles.user_id`, and the
 * `enqueue_processing_job` RPC. `failOn` injects a Postgres error for one (method, table) pair.
 */
class FakePostgrest {
  readonly tables = new Map<string, Row[]>();
  readonly requests: { method: string; table: string }[] = [];
  readonly authUsers = new Set<string>([SUPER, ADMIN, EDITOR, REVIEWER, SUPPORT, LEARNER, ID, ID2]);
  private failures: { method: string; table: string; error: DbFailure }[] = [];
  private seq = 0;
  private static readonly UNIQUE: Record<string, string[][]> = {
    transcripts: [['lesson_id', 'revision']],
    transcript_segments: [['transcript_id', 'sort_index']],
    transcript_translations: [['segment_id', 'language_code']],
    content_revisions: [['entity_table', 'entity_id', 'revision']],
    user_roles: [['user_id', 'role']],
    processing_jobs: [['idempotency_key']],
    course_source_localizations: [['course_track_id', 'source_language_code']],
  };

  seed(table: string, ...rows: Row[]): Row[] {
    const list = this.rows(table);
    for (const r of rows) list.push({ id: r.id ?? this.uuid(), ...r });
    return list;
  }
  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  failOn(method: string, table: string, error: DbFailure): void {
    this.failures.push({ method, table, error });
  }
  uuid(): string {
    this.seq += 1;
    return `30000000-0000-4000-8000-${this.seq.toString(16).padStart(12, '0')}`;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (url.origin !== new URL(offlineEnv.SUPABASE_URL).origin) throw new Error(`unexpected network call to ${url.origin}`);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body: unknown = typeof init?.body === 'string' && init.body !== '' ? JSON.parse(init.body) : undefined;
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    if (path.startsWith('rpc/')) return this.rpc(path.slice(4), (body ?? {}) as Row, headers);
    const table = path;
    this.requests.push({ method, table });
    const failure = this.failures.findIndex((f) => f.method === method && f.table === table);
    if (failure >= 0) {
      const [injected] = this.failures.splice(failure, 1);
      return json({ ...injected!.error, details: null, hint: null }, 400);
    }
    const prefer = headers.get('prefer') ?? '';
    const list = this.rows(table);
    const matches = (r: Row) => matchFilters(r, url.searchParams);
    if (method === 'GET' || method === 'HEAD') return this.respond(applyOrderLimit(list.filter(matches), url.searchParams), headers, 200);
    if (method === 'POST') {
      const incoming = (Array.isArray(body) ? body : [body]) as Row[];
      const onConflict = url.searchParams.get('on_conflict')?.split(',');
      const out: Row[] = [];
      for (const raw of incoming) {
        if (table === 'user_roles' && !this.authUsers.has(String(raw.user_id))) return json({ code: '23503', message: 'insert or update on table "user_roles" violates foreign key constraint', details: null, hint: null }, 409);
        const existing = onConflict ? list.find((r) => onConflict.every((k) => r[k] === raw[k])) : undefined;
        if (existing && prefer.includes('resolution=merge-duplicates')) {
          Object.assign(existing, raw, { updated_at: new Date().toISOString() });
          out.push(existing);
          continue;
        }
        const row: Row = { id: this.uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...raw };
        if (this.violatesUnique(table, row)) return json({ code: '23505', message: `duplicate key value violates unique constraint on ${table}`, details: null, hint: null }, 409);
        list.push(row);
        out.push(row);
      }
      return prefer.includes('return=representation') ? this.respond(out, headers, 201) : new Response(null, { status: 201 });
    }
    if (method === 'PATCH') {
      const hit = list.filter(matches);
      for (const r of hit) Object.assign(r, body as Row, { updated_at: new Date().toISOString() });
      return prefer.includes('return=representation') ? this.respond(hit, headers, 200) : new Response(null, { status: 204 });
    }
    if (method === 'DELETE') {
      const hit = list.filter(matches);
      this.tables.set(table, list.filter((r) => !hit.includes(r)));
      if (table === 'transcripts') {
        const ids = new Set(hit.map((r) => r.id));
        const segments = this.rows('transcript_segments').filter((s) => ids.has(s.transcript_id));
        this.tables.set('transcript_segments', this.rows('transcript_segments').filter((s) => !segments.includes(s)));
        const segIds = new Set(segments.map((s) => s.id));
        this.tables.set('transcript_translations', this.rows('transcript_translations').filter((t) => !segIds.has(t.segment_id)));
      }
      const res = prefer.includes('return=representation') ? this.respond(hit, headers, 200) : new Response(null, { status: 204 });
      if (prefer.includes('count=exact')) res.headers.set('content-range', `*/${hit.length}`);
      return res;
    }
    return json({ code: 'PGRST000', message: `unsupported method ${method}` }, 400);
  };

  private violatesUnique(table: string, row: Row): boolean {
    return (FakePostgrest.UNIQUE[table] ?? []).some((cols) => this.rows(table).some((r) => cols.every((k) => r[k] === row[k])));
  }

  private respond(rows: Row[], headers: Headers, status: number): Response {
    if ((headers.get('accept') ?? '').includes('vnd.pgrst.object+json')) {
      if (rows.length !== 1) return json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null }, 406);
      return json(rows[0], status);
    }
    return json(rows, status);
  }

  private rpc(fn: string, args: Row, headers: Headers): Response {
    this.requests.push({ method: 'RPC', table: fn });
    if (fn !== 'enqueue_processing_job') return json({ code: 'PGRST202', message: `unknown function ${fn}` }, 404);
    const jobs = this.rows('processing_jobs');
    const existing = jobs.find((j) => j.idempotency_key === args.p_idempotency_key);
    const row: Row = existing ?? {
      id: this.uuid(),
      job_type: args.p_job_type,
      idempotency_key: args.p_idempotency_key,
      params: args.p_params ?? {},
      parent_asset_id: args.p_parent_asset_id ?? null,
      parent_entity_table: args.p_parent_entity_table ?? null,
      parent_entity_id: args.p_parent_entity_id ?? null,
      priority: args.p_priority ?? 5,
      requested_by: args.p_requested_by ?? null,
      provider: args.p_provider ?? null,
      max_attempts: args.p_max_attempts ?? 3,
      state: 'pending',
      attempts: 0,
      created_at: new Date().toISOString(),
    };
    if (!existing) jobs.push(row);
    return this.respond([row], headers, 200);
  }
}

const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function matchFilters(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    const cell = row[key];
    const str = cell === null || cell === undefined ? null : String(cell);
    if (op === 'eq' && str !== value) return false;
    if (op === 'neq' && str === value) return false;
    if (op === 'is' && value === 'null' && cell !== null && cell !== undefined) return false;
    if (op === 'in' && !value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).includes(str ?? '')) return false;
    if (op === 'lt' && !(str !== null && str < value)) return false;
    if (op === 'gt' && !(str !== null && str > value)) return false;
  }
  return true;
}

function applyOrderLimit(rows: Row[], params: URLSearchParams): Row[] {
  const out = [...rows];
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split('.') as [string, string | undefined];
    out.sort((a, b) => {
      const av = a[col] as number | string;
      const bv = b[col] as number | string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'desc' ? -cmp : cmp;
    });
  }
  const limit = params.get('limit');
  return limit ? out.slice(0, Number(limit)) : out;
}

let db: FakePostgrest;
/** Apps built by a test; their background work (audit inserts) is flushed while the PostgREST double is still installed. */
const apps: AppContext[] = [];
function offlineApp(roles: Record<string, Role[]>, overrides: Partial<AppOptions> = {}): AppContext {
  const ctx = baseOfflineApp(roles, overrides);
  apps.push(ctx);
  return ctx;
}
beforeEach(() => {
  db = new FakePostgrest();
  vi.stubGlobal('fetch', vi.fn(db.fetch));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.flush()));
  vi.unstubAllGlobals();
});

const tokens = async () => ({
  superAdmin: await signTestToken(SUPER),
  admin: await signTestToken(ADMIN),
  editor: await signTestToken(EDITOR),
  reviewer: await signTestToken(REVIEWER),
  support: await signTestToken(SUPPORT),
  learner: await signTestToken(LEARNER),
});

const metrics = (v: number) => ({ mission_instructions_pct: v, explanations_pct: v, ui_pct: v, subtitles_pct: v, audio_overlays_pct: v });
const STUDIO_ROUTES = ['adminCoveragePut', 'adminTranscriptSave', 'adminContentDecision', 'adminContentRollback', 'adminProcessingJobRetry', 'adminUserRoleGrant', 'adminUserRoleRevoke', 'adminModelTest'] as const satisfies readonly RouteKey[];
const pathOf = (key: RouteKey): string => ROUTES[key].path.replace(':role', 'content_editor').replace(/:([A-Za-z]+)/g, ID);
const send = (ctx: AppContext, key: RouteKey, token: string | undefined, body: unknown, path = pathOf(key)) => call(ctx, path, { method: ROUTES[key].method, token, body });

describe('Studio routes: role gates are answered before any database call', () => {
  it('declares every Studio route as an admin route of the contracts and registers it', () => {
    const ctx = offlineApp(ROLES);
    for (const key of STUDIO_ROUTES) {
      expect(ROUTES[key].auth, key).toBe('admin');
      expect(ctx.registered.has(key), key).toBe(true);
    }
  });

  it('anonymous 401, learner 403 and read-only support 403 on every Studio route; no query runs', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const wrong: string[] = [];
    for (const key of STUDIO_ROUTES) {
      const anon = await send(ctx, key, undefined, {});
      if (anon.status !== 401) wrong.push(`${key} anonymous → ${anon.status}`);
      for (const [who, token] of [['learner', t.learner], ['support_readonly', t.support]] as const) {
        const res = await send(ctx, key, token, {});
        if (res.status !== 403 || res.json?.error?.code !== 'forbidden') wrong.push(`${key} ${who} → ${res.status} ${res.json?.error?.code}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(db.requests).toEqual([]);
  });

  it('applies the per-route role sets (reviewers review, editors retry / roll back, admins probe models, super_admin grants)', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const denied: [RouteKey, string, string][] = [
      ['adminContentRollback', 'reviewer', t.reviewer],
      ['adminProcessingJobRetry', 'reviewer', t.reviewer],
      ['adminModelTest', 'editor', t.editor],
      ['adminModelTest', 'reviewer', t.reviewer],
      ['adminUserRoleGrant', 'editor', t.editor],
      ['adminUserRoleRevoke', 'editor', t.editor],
      ['adminUserRoleGrant', 'admin', t.admin],
      ['adminUserRoleRevoke', 'admin', t.admin],
    ];
    for (const [key, who, token] of denied) {
      const res = await send(ctx, key, token, {});
      expect(res.status, `${key} as ${who}`).toBe(403);
    }
    // An admin is refused by the in-handler super_admin check, not by validation (403 before 422).
    const asAdmin = await send(ctx, 'adminUserRoleGrant', t.admin, { role: 'nope' });
    expect(asAdmin.json.error.message).toContain('super admin');
    expect(db.requests).toEqual([]);
    // Reviewers pass the gate of the review routes (they then fail validation on the empty body, never 403).
    for (const key of ['adminCoveragePut', 'adminTranscriptSave', 'adminContentDecision'] as const) {
      const res = await send(ctx, key, t.reviewer, {});
      expect(res.status, key).toBe(422);
    }
  });
});

describe('Studio routes: validation', () => {
  it('rejects malformed bodies and params with validation_failed before touching the database', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const cases: [RouteKey, string, unknown, string?][] = [
      ['adminCoveragePut', t.reviewer, { courseTrackId: 'klingon', sourceLanguageCode: 'en', status: 'partial', metrics: metrics(10), nativeReviewed: false }],
      ['adminCoveragePut', t.reviewer, { courseTrackId: 'french', sourceLanguageCode: 'en', status: 'partial', metrics: metrics(120), nativeReviewed: false }],
      ['adminTranscriptSave', t.editor, { primaryLanguageCode: 'es', segments: [] }, '/v1/admin/transcripts/not-a-uuid'],
      ['adminTranscriptSave', t.editor, { primaryLanguageCode: 'es', segments: [{ sortIndex: 0, startMs: 0, endMs: 10, text: 'x', translations: [{ languageCode: 'xx', text: 'y' }] }] }],
      ['adminContentDecision', t.editor, { entityTable: 'missions', decision: 'publish' }],
      ['adminContentDecision', t.editor, { entityTable: 'visual_assets', decision: 'approve' }],
      ['adminContentRollback', t.editor, { entityTable: 'speakers', revision: 1 }],
      ['adminContentRollback', t.editor, { entityTable: 'audio_lessons', revision: -1 }],
      ['adminProcessingJobRetry', t.editor, { priority: 11 }],
      ['adminUserRoleGrant', t.superAdmin, { role: 'owner' }],
      ['adminUserRoleGrant', t.superAdmin, { role: 'admin', expiresAt: 'tomorrow' }],
      ['adminUserRoleRevoke', t.superAdmin, undefined, `/v1/admin/users/${ID}/roles/owner`],
      ['adminModelTest', t.admin, { mode: 'chat', prompt: 'hi' }],
      ['adminModelTest', t.admin, { mode: 'prompt', task: 'speech_synthesis', targetVariety: 'es-ES', model: 'x/y', prompt: 'hi' }],
      ['adminModelTest', t.admin, { mode: 'prompt', targetVariety: 'es-ES', model: '   ', prompt: 'hi' }],
      ['adminModelTest', t.admin, { mode: 'transcribe', targetVariety: 'es-ES', audioBase64: 'AAAA', encoding: 'mp4' }],
    ];
    for (const [key, token, body, path] of cases) {
      const res = await send(ctx, key, token, body, path);
      expect(res.status, `${key} ${JSON.stringify(body)}`).toBe(422);
      expect(res.json.error.code).toBe('validation_failed');
    }
    expect(db.requests).toEqual([]);
  });

  it('keeps the coverage honesty rules: complete needs a native review at 100%, no fallback on complete, fallback ≠ source', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const base = { courseTrackId: 'french', sourceLanguageCode: 'en', metrics: metrics(100), nativeReviewed: true, editorialNoteKey: null, fallbackSourceLanguageCode: null };
    const rules: [unknown, string][] = [
      [{ ...base, status: 'complete', nativeReviewed: false }, '"complete" requires nativeReviewed and every metric at 100%.'],
      [{ ...base, status: 'complete', metrics: { ...metrics(100), ui_pct: 99 } }, '"complete" requires nativeReviewed and every metric at 100%.'],
      [{ ...base, status: 'complete', fallbackSourceLanguageCode: 'fr' }, 'A complete pair must not advertise a fallback language.'],
      [{ ...base, status: 'partial', fallbackSourceLanguageCode: 'en' }, 'Fallback must differ from the source language.'],
    ];
    for (const [body, message] of rules) {
      const res = await send(ctx, 'adminCoveragePut', t.reviewer, body);
      expect(res.status).toBe(422);
      expect(res.json.error.message).toBe(message);
    }
    expect(db.requests).toEqual([]);
  });

  it('refuses transcript segments that end before they start, repeat a sort index or repeat a translation language', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const seg = (sortIndex: number, startMs: number, endMs: number, translations: unknown[] = []) => ({ sortIndex, startMs, endMs, text: 'hola', translations });
    const bad: [unknown[], string][] = [
      [[seg(0, 500, 100)], 'Segment 0: end before start'],
      [[seg(0, 0, 100), seg(0, 100, 200)], 'Segment 0: duplicate sort index'],
      [[seg(0, 0, 100, [{ languageCode: 'en', text: 'hi' }, { languageCode: 'en', text: 'hello' }])], 'Segment 0: more than one en translation'],
    ];
    for (const [segments, message] of bad) {
      const res = await send(ctx, 'adminTranscriptSave', t.editor, { primaryLanguageCode: 'es', segments });
      expect(res.status).toBe(422);
      expect(res.json.error.message).toBe(message);
    }
    expect(db.requests).toEqual([]);
  });
});

describe('adminCoveragePut', () => {
  it('updates the seeded row, records the reviewer only when native-reviewed, and audit-logs the change', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const [row] = db.seed('course_source_localizations', { course_track_id: 'french', source_language_code: 'en', status: 'planned', metrics: metrics(0), native_reviewed: false, reviewer_id: null, reviewed_at: null, editorial_note_key: null, fallback_source_language_code: null });
    const partial = await send(ctx, 'adminCoveragePut', t.reviewer, { courseTrackId: 'french', sourceLanguageCode: 'en', status: 'partial', metrics: metrics(40), nativeReviewed: false, fallbackSourceLanguageCode: 'fr', editorialNoteKey: 'enrollment.coverage.draftAvailable' });
    expect(partial.status, JSON.stringify(partial.json)).toBe(200);
    expect(partial.json.data).toEqual({ id: row!.id, status: 'partial' });
    expect(row).toMatchObject({ status: 'partial', native_reviewed: false, reviewer_id: null, reviewed_at: null, fallback_source_language_code: 'fr', editorial_note_key: 'enrollment.coverage.draftAvailable' });

    const complete = await send(ctx, 'adminCoveragePut', t.reviewer, { courseTrackId: 'french', sourceLanguageCode: 'en', status: 'complete', metrics: metrics(100), nativeReviewed: true });
    expect(complete.status).toBe(200);
    expect(row).toMatchObject({ status: 'complete', native_reviewed: true, reviewer_id: REVIEWER, fallback_source_language_code: null });
    expect(typeof row!.reviewed_at).toBe('string');
    await ctx.flush();
    const audits = db.rows('audit_logs').filter((a) => a.action === 'coverage.update');
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ actor_id: REVIEWER, entity_table: 'course_source_localizations', entity_id: row!.id });
  });

  it('answers not_found when the catalog seed has not created the pair', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const res = await send(ctx, 'adminCoveragePut', t.editor, { courseTrackId: 'swahili', sourceLanguageCode: 'fr', status: 'planned', metrics: metrics(0), nativeReviewed: false });
    expect(res.status).toBe(404);
    expect(res.json.error.message).toBe('Coverage row missing; run the catalog seed.');
  });
});

describe('adminTranscriptSave', () => {
  const body = {
    primaryLanguageCode: 'es',
    languageMode: 'target',
    status: 'reviewed',
    qaState: 'reviewed',
    accessRights: 'learners',
    durationMs: 2000,
    note: 'fixed timings',
    segments: [
      { sortIndex: 0, startMs: 0, endMs: 600, text: 'Hola', speakerLabel: 'A', translations: [{ languageCode: 'en', text: 'Hello', qaState: 'reviewed' }, { languageCode: 'fr', text: 'Bonjour' }] },
      { sortIndex: 1, startMs: 600, endMs: 1000, text: '¿Qué tal?', reviewed: true },
    ],
  };

  it('writes a NEW revision (earlier ones kept), segments + translations, the lesson status, a revision record and an audit row', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('audio_lessons', { id: ID, transcript_status: 'machine', state: 'review_needed' });
    db.seed('transcripts', { id: ID2, lesson_id: ID, revision: 0, source_asset_id: '40000000-0000-4000-8000-000000000001', status: 'machine' });
    const res = await send(ctx, 'adminTranscriptSave', t.editor, body, `/v1/admin/transcripts/${ID}`);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.data).toMatchObject({ revision: 1, coveragePct: 50, segments: 2 });
    const transcripts = db.rows('transcripts');
    expect(transcripts).toHaveLength(2);
    const saved = transcripts.find((r) => r.id === res.json.data.transcriptId)!;
    expect(saved).toMatchObject({ lesson_id: ID, revision: 1, status: 'reviewed', qa_state: 'reviewed', access_rights: 'learners', language_mode: 'target', coverage_pct: 50, manually_uploaded: true, source_asset_id: '40000000-0000-4000-8000-000000000001' });
    const segments = db.rows('transcript_segments');
    expect(segments.map((s) => [s.sort_index, s.text, s.transcript_id])).toEqual([[0, 'Hola', saved.id], [1, '¿Qué tal?', saved.id]]);
    const translations = db.rows('transcript_translations');
    expect(translations.map((tr) => [tr.language_code, tr.qa_state, tr.reviewer_id])).toEqual([['en', 'reviewed', EDITOR], ['fr', 'needs_review', null]]);
    expect(translations.every((tr) => tr.segment_id === segments[0]!.id)).toBe(true);
    expect(db.rows('audio_lessons')[0]).toMatchObject({ transcript_status: 'reviewed' });
    expect(db.rows('content_revisions')).toEqual([expect.objectContaining({ entity_table: 'transcripts', entity_id: saved.id, revision: 1, editor_id: EDITOR, note: 'fixed timings', diff: { revision: 1, segments: 2 } })]);
    await ctx.flush();
    expect(db.rows('audit_logs').map((a) => a.action)).toEqual(['transcript.save']);
  });

  it('a language reviewer saves a reviewed revision that keeps the previous access rights and leaves the lesson row alone', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('audio_lessons', { id: ID, transcript_status: 'machine', state: 'published' });
    db.seed('transcripts', { id: ID2, lesson_id: ID, revision: 0, status: 'machine', access_rights: 'learners' });
    const res = await send(ctx, 'adminTranscriptSave', t.reviewer, body, `/v1/admin/transcripts/${ID}`);
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const saved = db.rows('transcripts').find((r) => r.id === res.json.data.transcriptId)!;
    expect(saved).toMatchObject({ revision: 1, status: 'reviewed', qa_state: 'reviewed', access_rights: 'learners' });
    expect(db.rows('transcript_translations').map((tr) => [tr.language_code, tr.reviewer_id])).toEqual([['en', REVIEWER], ['fr', null]]);
    expect(db.rows('audio_lessons')[0]).toMatchObject({ transcript_status: 'machine' });
    expect(db.requests.filter((r) => r.table === 'audio_lessons' && r.method === 'PATCH')).toEqual([]);
    await ctx.flush();
    expect(db.rows('audit_logs')[0]).toMatchObject({ action: 'transcript.save', after: expect.objectContaining({ accessRights: 'learners', lessonStatusUpdated: false }) });
  });

  it('a language reviewer cannot change who can read a transcript (internal → learners, or a first transcript made public); nothing is written', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('audio_lessons', { id: ID, transcript_status: 'machine', state: 'published' });
    db.seed('transcripts', { id: ID2, lesson_id: ID, revision: 0, status: 'machine', access_rights: 'internal_only' });
    const widen = await send(ctx, 'adminTranscriptSave', t.reviewer, body, `/v1/admin/transcripts/${ID}`);
    expect(widen.status).toBe(403);
    expect(widen.json.error).toMatchObject({ code: 'forbidden', details: { accessRights: 'internal_only' } });
    expect(db.rows('transcripts').map((r) => r.id)).toEqual([ID2]);
    expect(db.rows('transcript_segments')).toEqual([]);
    expect(db.rows('audio_lessons')[0]).toMatchObject({ transcript_status: 'machine' });
    // No earlier revision: a reviewer's first transcript stays internal; making it public is an editor decision.
    db.seed('audio_lessons', { id: ID2, transcript_status: 'none' });
    const first = await send(ctx, 'adminTranscriptSave', t.reviewer, { ...body, accessRights: 'public' }, `/v1/admin/transcripts/${ID2}`);
    expect(first.status).toBe(403);
    expect(db.rows('transcripts').filter((r) => r.lesson_id === ID2)).toEqual([]);
    // An editor may change access rights.
    const editor = await send(ctx, 'adminTranscriptSave', t.editor, body, `/v1/admin/transcripts/${ID}`);
    expect(editor.status).toBe(201);
    expect(db.rows('transcripts').find((r) => r.id === editor.json.data.transcriptId)).toMatchObject({ access_rights: 'learners' });
  });

  it('starts at revision 0 for a first transcript and reports 0% coverage when the duration is unknown', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('audio_lessons', { id: ID, transcript_status: 'none' });
    const res = await send(ctx, 'adminTranscriptSave', t.editor, { primaryLanguageCode: 'es', segments: [{ sortIndex: 0, startMs: 0, endMs: 500, text: 'Hola' }] }, `/v1/admin/transcripts/${ID}`);
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ revision: 0, coveragePct: 0, segments: 1 });
    expect(db.rows('transcripts')[0]).toMatchObject({ status: 'edited', qa_state: 'needs_review', access_rights: 'internal_only', language_mode: 'mixed', source_asset_id: null });
  });

  it('never leaves a half-written revision: a failing translation insert removes the new transcript and its segments', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('audio_lessons', { id: ID, transcript_status: 'machine' });
    db.failOn('POST', 'transcript_translations', { code: '23503', message: 'insert or update on table "transcript_translations" violates foreign key constraint' });
    const res = await send(ctx, 'adminTranscriptSave', t.editor, body, `/v1/admin/transcripts/${ID}`);
    expect(res.status).toBe(422);
    expect(res.json.error.message).not.toContain('transcript_translations');
    expect(db.rows('transcripts')).toEqual([]);
    expect(db.rows('transcript_segments')).toEqual([]);
    expect(db.rows('audio_lessons')[0]).toMatchObject({ transcript_status: 'machine' });
  });

  it('answers not_found for an unknown lesson', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const res = await send(ctx, 'adminTranscriptSave', t.editor, body, `/v1/admin/transcripts/${ID}`);
    expect(res.status).toBe(404);
    expect(db.rows('transcripts')).toEqual([]);
  });
});

describe('adminContentDecision', () => {
  it('plans decisions with the real §7.6 transition table (published untouched, illegal moves refused, repeats are no-ops)', () => {
    expect(planDecision('review_needed', 'approve', canTransitionContent)).toEqual({ ok: true, from: 'review_needed', to: 'approved', noop: false });
    expect(planDecision('review_needed', 'reject', canTransitionContent)).toEqual({ ok: true, from: 'review_needed', to: 'rejected', noop: false });
    expect(planDecision('published', 'reject', canTransitionContent)).toMatchObject({ ok: false, code: 'precondition_failed' });
    expect(planDecision('imported_draft', 'approve', canTransitionContent)).toMatchObject({ ok: false, code: 'precondition_failed' });
    expect(planDecision('rejected', 'approve', canTransitionContent)).toMatchObject({ ok: false });
    expect(planDecision('approved', 'approve', canTransitionContent)).toEqual({ ok: true, from: 'approved', to: 'approved', noop: true });
    expect(planDecision('mystery', 'approve', canTransitionContent)).toMatchObject({ ok: false, code: 'validation_failed' });
  });

  it('approves a mission in review: state, revision, publication event and audit row; never publishes', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('missions', { id: ID, state: 'review_needed', target_variety_id: 'es-ES' });
    const res = await send(ctx, 'adminContentDecision', t.reviewer, { entityTable: 'missions', decision: 'approve', note: 'native check ok' }, `/v1/admin/content/${ID}/decision`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toEqual({ contentId: ID, state: 'approved', revision: 1, noop: false, publicationEventRecorded: true });
    expect(db.rows('missions')[0]).toMatchObject({ state: 'approved' });
    expect(db.rows('content_revisions')).toEqual([expect.objectContaining({ entity_table: 'missions', entity_id: ID, revision: 1, editor_id: REVIEWER, note: 'native check ok', diff: { state: { from: 'review_needed', to: 'approved' } } })]);
    expect(db.rows('publication_events')).toEqual([expect.objectContaining({ entity_table: 'missions', entity_id: ID, revision: 1, from_state: 'review_needed', to_state: 'approved', actor_id: REVIEWER })]);
    await ctx.flush();
    expect(db.rows('audit_logs').map((a) => a.action)).toEqual(['content.decision']);

    // Repeating the decision is a no-op: a revision note, no state write, no publication event.
    const again = await send(ctx, 'adminContentDecision', t.editor, { entityTable: 'missions', decision: 'approve' }, `/v1/admin/content/${ID}/decision`);
    expect(again.json.data).toMatchObject({ state: 'approved', noop: true, publicationEventRecorded: false, revision: 2 });
    expect(db.rows('publication_events')).toHaveLength(1);
  });

  it('approving an expression is its native review (reviewed + reviewer); rejecting clears it', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('expressions', { id: ID, state: 'review_needed', reviewed: false, reviewer_id: null });
    db.seed('expressions', { id: ID2, state: 'review_needed', reviewed: true, reviewer_id: EDITOR });
    expect((await send(ctx, 'adminContentDecision', t.reviewer, { entityTable: 'expressions', decision: 'approve' }, `/v1/admin/content/${ID}/decision`)).status).toBe(200);
    expect((await send(ctx, 'adminContentDecision', t.reviewer, { entityTable: 'expressions', decision: 'reject' }, `/v1/admin/content/${ID2}/decision`)).status).toBe(200);
    expect(db.rows('expressions')).toEqual([expect.objectContaining({ id: ID, state: 'approved', reviewed: true, reviewer_id: REVIEWER }), expect.objectContaining({ id: ID2, state: 'rejected', reviewed: false, reviewer_id: REVIEWER })]);
  });

  it('refuses published content, illegal transitions and unknown ids without writing anything', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('audio_lessons', { id: ID, state: 'published' });
    db.seed('audio_course_collections', { id: ID2, state: 'imported_draft' });
    const published = await send(ctx, 'adminContentDecision', t.editor, { entityTable: 'audio_lessons', decision: 'reject' }, `/v1/admin/content/${ID}/decision`);
    expect(published.status).toBe(412);
    expect(published.json.error.message).toBe('Unpublish before changing the editorial decision.');
    const illegal = await send(ctx, 'adminContentDecision', t.editor, { entityTable: 'audio_course_collections', decision: 'approve' }, `/v1/admin/content/${ID2}/decision`);
    expect(illegal.status).toBe(412);
    expect(illegal.json.error.details).toEqual({ from: 'imported_draft', to: 'approved' });
    const missing = await send(ctx, 'adminContentDecision', t.editor, { entityTable: 'characters', decision: 'approve' }, `/v1/admin/content/${ID}/decision`);
    expect(missing.status).toBe(404);
    expect(db.rows('audio_lessons')[0]).toMatchObject({ state: 'published' });
    expect(db.rows('content_revisions')).toEqual([]);
    expect(db.rows('publication_events')).toEqual([]);
  });
});

describe('adminContentRollback', () => {
  it('restores only the restorable columns of the snapshot as a NEW revision (state untouched, nothing deleted)', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('audio_lessons', { id: ID, state: 'approved', title_translations: { en: 'New title' }, sort_order: 9 });
    db.seed('content_revisions', { entity_table: 'audio_lessons', entity_id: ID, revision: 1, diff: {}, snapshot: { title_translations: { en: 'Old title' }, sort_order: 3, state: 'published', published_revision: 7 }, editor_id: EDITOR });
    db.seed('content_revisions', { entity_table: 'audio_lessons', entity_id: ID, revision: 2, diff: { title: true }, snapshot: null, editor_id: EDITOR });
    const res = await send(ctx, 'adminContentRollback', t.editor, { entityTable: 'audio_lessons', revision: 1 }, `/v1/admin/content/${ID}/rollback`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toEqual({ entityId: ID, revision: 3, restoredColumns: ['title_translations', 'sort_order'] });
    expect(db.rows('audio_lessons')[0]).toMatchObject({ state: 'approved', title_translations: { en: 'Old title' }, sort_order: 3 });
    expect(db.rows('audio_lessons')[0]!.published_revision).toBeUndefined();
    const revisions = db.rows('content_revisions');
    expect(revisions).toHaveLength(3);
    expect(revisions[2]).toMatchObject({ revision: 3, editor_id: EDITOR, note: 'rollback to revision 1', diff: { title_translations: { en: 'Old title' }, sort_order: 3 } });
    await ctx.flush();
    expect(db.rows('audit_logs').map((a) => a.action)).toEqual(['content.rollback']);
  });

  it('refuses diff-only revisions, snapshots without restorable columns, unknown revisions and unknown content', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('characters', { id: ID, state: 'approved', name: 'Samira' });
    db.seed('content_revisions', { entity_table: 'characters', entity_id: ID, revision: 1, diff: {}, snapshot: null, editor_id: EDITOR });
    db.seed('content_revisions', { entity_table: 'characters', entity_id: ID, revision: 2, diff: {}, snapshot: { state: 'published' }, editor_id: EDITOR });
    db.seed('content_revisions', { entity_table: 'missions', entity_id: ID2, revision: 1, diff: {}, snapshot: { title_key: 'm.title' }, editor_id: EDITOR });
    const diffOnly = await send(ctx, 'adminContentRollback', t.editor, { entityTable: 'characters', revision: 1 }, `/v1/admin/content/${ID}/rollback`);
    expect(diffOnly.status).toBe(412);
    expect(diffOnly.json.error.message).toBe('This revision has no snapshot to restore.');
    const nothing = await send(ctx, 'adminContentRollback', t.editor, { entityTable: 'characters', revision: 2 }, `/v1/admin/content/${ID}/rollback`);
    expect(nothing.status).toBe(412);
    expect(nothing.json.error.message).toBe('Snapshot holds no restorable columns.');
    const unknown = await send(ctx, 'adminContentRollback', t.editor, { entityTable: 'characters', revision: 5 }, `/v1/admin/content/${ID}/rollback`);
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.message).toBe('Revision not found');
    const gone = await send(ctx, 'adminContentRollback', t.editor, { entityTable: 'missions', revision: 1 }, `/v1/admin/content/${ID2}/rollback`);
    expect(gone.status).toBe(404);
    expect(db.rows('characters')[0]).toMatchObject({ state: 'approved', name: 'Samira' });
    expect(db.rows('content_revisions')).toHaveLength(3);
  });
});

describe('adminProcessingJobRetry', () => {
  const job = (over: Row = {}): Row => ({ id: ID, job_type: 'transcode', state: 'failed', params: { preset: 'mobile' }, parent_asset_id: ID2, parent_entity_table: null, parent_entity_id: null, priority: 5, provider: null, max_attempts: 3, idempotency_key: `transcode:${ID2}:abc`, attempts: 3, ...over });

  it('re-runs an asset-parented job like adminAssetProcess with force (fresh row, original kept, audited)', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('processing_jobs', job());
    db.seed('media_assets', { id: ID2, checksum_sha256: 'c'.repeat(64), disposition: 'active' });
    const res = await send(ctx, 'adminProcessingJobRetry', t.editor, { priority: 2 }, `/v1/admin/processing-jobs/${ID}/retry`);
    expect(res.status, JSON.stringify(res.json)).toBe(202);
    expect(res.json.data).toMatchObject({ state: 'pending', retriedJobId: ID, via: 'asset_process' });
    const jobs = db.rows('processing_jobs');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ id: ID, state: 'failed' });
    expect(jobs[1]).toMatchObject({ id: res.json.data.jobId, job_type: 'transcode', parent_asset_id: ID2, priority: 2, requested_by: EDITOR, params: { preset: 'mobile' } });
    expect(String(jobs[1]!.idempotency_key)).toMatch(new RegExp(`^transcode:${ID2}:c{64}:\\d+$`));
    expect(db.requests).toContainEqual({ method: 'RPC', table: 'enqueue_processing_job' });
    await ctx.flush();
    expect(db.rows('audit_logs')).toEqual([expect.objectContaining({ action: 'jobs.retry', actor_id: EDITOR, entity_id: res.json.data.jobId })]);
  });

  it('re-enqueues jobs without a parent asset with a retry-unique key and the original routing fields', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('processing_jobs', job({ job_type: 'import_manifest', parent_asset_id: null, parent_entity_table: 'audio_course_collections', parent_entity_id: ID2, idempotency_key: 'import_manifest:x', attempts: 1, params: null, provider: 'local', max_attempts: 5 }));
    const res = await send(ctx, 'adminProcessingJobRetry', t.editor, {}, `/v1/admin/processing-jobs/${ID}/retry`);
    expect(res.status).toBe(202);
    expect(res.json.data.via).toBe('enqueue');
    const created = db.rows('processing_jobs')[1]!;
    expect(created).toMatchObject({ job_type: 'import_manifest', parent_asset_id: null, parent_entity_table: 'audio_course_collections', parent_entity_id: ID2, priority: 5, provider: 'local', max_attempts: 5, params: {}, requested_by: EDITOR });
    expect(String(created.idempotency_key)).toMatch(/^import_manifest:x:retry:2:[0-9a-z]+$/);
  });

  it('refuses pending / running jobs, job types no runner serves, revoked assets and unknown jobs (no row created)', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('processing_jobs', job({ id: ID, state: 'running' }));
    db.seed('processing_jobs', job({ id: ID2, job_type: 'benchmark_model', parent_asset_id: null, idempotency_key: 'bench:1' }));
    const running = await send(ctx, 'adminProcessingJobRetry', t.editor, {}, `/v1/admin/processing-jobs/${ID}/retry`);
    expect(running.status).toBe(412);
    expect(running.json.error.message).toContain('Job is running');
    const unserved = await send(ctx, 'adminProcessingJobRetry', t.editor, {}, `/v1/admin/processing-jobs/${ID2}/retry`);
    expect(unserved.status).toBe(412);
    expect(unserved.json.error.message).toContain('AI models screen');
    expect(unserved.json.error.details).toEqual({ jobType: 'benchmark_model', state: 'failed' });
    db.rows('processing_jobs')[0]!.state = 'failed';
    db.seed('media_assets', { id: ID2, checksum_sha256: 'c'.repeat(64), disposition: 'revoked' });
    const revoked = await send(ctx, 'adminProcessingJobRetry', t.editor, {}, `/v1/admin/processing-jobs/${ID}/retry`);
    expect(revoked.status).toBe(451);
    const unknown = await send(ctx, 'adminProcessingJobRetry', t.editor, {}, `/v1/admin/processing-jobs/40000000-0000-4000-8000-000000000009/retry`);
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.message).toBe('Job not found');
    expect(db.rows('processing_jobs')).toHaveLength(2);
    expect(db.requests.some((r) => r.method === 'RPC')).toBe(false);
  });
});

describe('adminUserRoleGrant / adminUserRoleRevoke', () => {
  it('lets a super_admin grant, re-grant with a new expiry and revoke a role; every change is audited', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    const grant = await send(ctx, 'adminUserRoleGrant', t.superAdmin, { role: 'content_editor' }, `/v1/admin/users/${LEARNER}/roles`);
    expect(grant.status, JSON.stringify(grant.json)).toBe(201);
    expect(grant.json.data).toMatchObject({ userId: LEARNER, role: 'content_editor', expiresAt: null });
    expect(db.rows('user_roles')).toEqual([expect.objectContaining({ user_id: LEARNER, role: 'content_editor', granted_by: SUPER, expires_at: null })]);
    const expiresAt = '2027-01-01T00:00:00.000Z';
    const regrant = await send(ctx, 'adminUserRoleGrant', t.superAdmin, { role: 'content_editor', expiresAt }, `/v1/admin/users/${LEARNER}/roles`);
    expect(regrant.status).toBe(200);
    expect(db.rows('user_roles')).toHaveLength(1);
    expect(db.rows('user_roles')[0]).toMatchObject({ expires_at: expiresAt });
    const revoke = await send(ctx, 'adminUserRoleRevoke', t.superAdmin, undefined, `/v1/admin/users/${LEARNER}/roles/content_editor`);
    expect(revoke.status).toBe(200);
    expect(revoke.json.data).toEqual({ userId: LEARNER, role: 'content_editor', revoked: 1 });
    expect(db.rows('user_roles')).toEqual([]);
    await ctx.flush();
    expect(db.rows('audit_logs').map((a) => a.action)).toEqual(['users.role_grant', 'users.role_grant', 'users.role_revoke']);
  });

  it('never revokes your own super_admin and explains an unknown user id instead of leaking the constraint', async () => {
    const ctx = offlineApp(ROLES);
    const t = await tokens();
    db.seed('user_roles', { user_id: SUPER, role: 'super_admin' });
    const self = await send(ctx, 'adminUserRoleRevoke', t.superAdmin, undefined, `/v1/admin/users/${SUPER}/roles/super_admin`);
    expect(self.status).toBe(412);
    expect(self.json.error.message).toBe('You cannot revoke your own super_admin role.');
    expect(db.rows('user_roles')).toHaveLength(1);
    const unknown = await send(ctx, 'adminUserRoleGrant', t.superAdmin, { role: 'admin' }, `/v1/admin/users/40000000-0000-4000-8000-000000000009/roles`);
    expect(unknown.status).toBe(422);
    expect(unknown.json.error.message).toContain('No Supabase Auth user');
    expect(unknown.json.error.message).not.toContain('foreign key');
  });
});

describe('adminModelTest', () => {
  const supported = (provider: string, notes: string[]): Capability => ({ supported: true, reasons: [], features: NO_FEATURES, latencyClass: 'interactive', effectiveLocale: 'es-ES', qualityEstimate: null, provider, notes });
  const appWith = (reasoner: FakeReasoner, extra: Partial<AiServices> = {}) =>
    offlineApp(ROLES, { aiFactory: async () => ({ ...fakeAiServices(reasoner), profiles: new ModelProfileRegistry(), ...extra }) as AiServices });

  it('runs a prompt probe through the task structured-output path with the requested model first (fake reasoner, no network)', async () => {
    const reasoner = new FakeReasoner().on('character_dialogue', { reply: '¡Hola! ¿Qué tal?' });
    const ctx = appWith(reasoner);
    const t = await tokens();
    const res = await send(ctx, 'adminModelTest', t.admin, { mode: 'prompt', targetVariety: 'es-ES', sourceLanguage: 'fr', model: 'test/model-a', prompt: 'Saluda', system: 'Be brief.' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ mode: 'prompt', task: 'character_dialogue', targetVariety: 'es-ES', sourceLanguage: 'fr', requestedModel: 'test/model-a', content: '¡Hola! ¿Qué tal?' });
    expect(res.json.data.modelChain[0]).toBe('test/model-a');
    expect(res.json.data.modelChain.length).toBeGreaterThan(1);
    expect(reasoner.calls).toHaveLength(1);
    const [probe] = reasoner.calls;
    expect(probe!.task).toBe('character_dialogue');
    expect(probe!.locale).toMatchObject({ targetVariety: 'es-ES', sourceLanguage: 'fr' });
    expect(probe!.options).toMatchObject({ modelOverride: 'test/model-a', traceId: res.json.data.traceId });
    expect(probe!.prompt.system).toContain('Be brief.');
    expect(probe!.prompt.user).toBe('Saluda');
    expect(db.requests).toEqual([]);
  });

  it('runs a synthesis probe through the voice registry and wraps raw PCM so the Studio can play it', async () => {
    const pcm = new Uint8Array(480);
    const synthesizer = {
      provider: 'fake-tts',
      supports: vi.fn(async () => supported('fake-tts', ['voice=es-f-1', 'model=fake/tts-1', 'synthetic=true'])),
      synthesize: vi.fn(async () => ({ encoding: 'pcm16' as const, sampleRateHz: 24000, durationMs: 10, assetId: null, url: null, base64: btoa(String.fromCharCode(...pcm)), provider: 'fake-tts', voiceId: 'es-f-1', synthetic: true as const, cached: false })),
    };
    const ctx = appWith(new FakeReasoner(), { synthesizer } as unknown as Partial<AiServices>);
    const t = await tokens();
    const res = await send(ctx, 'adminModelTest', t.admin, { mode: 'synthesize', targetVariety: 'es-ES', text: 'Hola', voiceId: 'es-f-1' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ mode: 'synthesize', voiceId: 'es-f-1', model: 'fake/tts-1', mimeType: 'audio/wav', synthetic: true, cached: false });
    const bytes = Uint8Array.from(atob(res.json.data.audioBase64), (ch) => ch.charCodeAt(0));
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
    expect(bytes.byteLength).toBe(44 + pcm.byteLength);
    expect(synthesizer.synthesize).toHaveBeenCalledWith('Hola', 'es-ES', 'es-f-1', expect.objectContaining({ traceId: res.json.data.traceId }));
  });

  it('runs a transcription probe through the per-variety STT route', async () => {
    const recognizer = {
      provider: 'fake-stt',
      supports: vi.fn(async () => supported('fake-stt', [])),
      transcribe: vi.fn(async () => ({ text: 'hola', segments: [{ index: 0, text: 'hola', startMs: 0, endMs: 400, words: [], speaker: null, confidence: 0.9 }], confidence: 0.9, detectedLanguage: { code: 'es', confidence: 0.95 }, requestedLocale: 'es-ES', provider: 'fake-stt', model: 'fake/stt-1', durationMs: 400, languageMismatch: false })),
    };
    const ctx = appWith(new FakeReasoner(), { recognizer } as unknown as Partial<AiServices>);
    const t = await tokens();
    const res = await send(ctx, 'adminModelTest', t.superAdmin, { mode: 'transcribe', targetVariety: 'es-ES', audioBase64: 'AAAA', encoding: 'mp3' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({ mode: 'transcribe', text: 'hola', detectedLanguage: 'es', confidence: 0.9, model: 'fake/stt-1', languageMismatch: false, segments: [{ index: 0, text: 'hola', startMs: 0, endMs: 400 }] });
    expect(recognizer.transcribe).toHaveBeenCalledWith({ source: 'inline', base64: 'AAAA', encoding: 'mp3', sampleRateHz: null }, 'es-ES', expect.objectContaining({ traceId: res.json.data.traceId }));
  });

  it('answers capability_unsupported honestly (no substitution) when a variety has no route or AI is not configured', async () => {
    const t = await tokens();
    // fakeAiServices: no STT / TTS route for any locale.
    const noSpeech = appWith(new FakeReasoner());
    const synth = await send(noSpeech, 'adminModelTest', t.admin, { mode: 'synthesize', targetVariety: 'ary', text: 'salam' });
    expect(synth.status).toBe(501);
    expect(synth.json.error.code).toBe('capability_unsupported');
    expect(synth.json.error.message).toContain('ary');
    // No OPENROUTER_API_KEY on the Worker and no test factory: the real wiring refuses before any provider call.
    const unconfigured = offlineApp(ROLES);
    const res = await send(unconfigured, 'adminModelTest', t.admin, { mode: 'prompt', targetVariety: 'es-ES', model: 'test/model-a', prompt: 'hola' });
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe('capability_unsupported');
    expect(res.json.error.message).toContain('OPENROUTER_API_KEY');
  });
});

describe('Studio route paths', () => {
  it('build from the contracts without ambiguity next to the existing admin routes', () => {
    expect(buildPath('adminTranscriptSave', { lessonId: ID })).toBe(`/v1/admin/transcripts/${ID}`);
    expect(buildPath('adminUserRoleRevoke', { userId: ID, role: 'admin' })).toBe(`/v1/admin/users/${ID}/roles/admin`);
    expect(buildPath('adminProcessingJobRetry', { id: ID })).toBe(`/v1/admin/processing-jobs/${ID}/retry`);
  });
});
