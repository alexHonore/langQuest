/**
 * Offline route-test fixtures: the REAL app (`createApp`) wired to in-process fakes instead of the network.
 *
 * - `FakePostgrest` answers the supabase-js REST calls of both the service client and the learner (RLS) client with
 *   an in-memory table store: filters (`eq`, `in`, `is`, `like`, `or`, embedded `rel.col` filters, `not.*`), ordering,
 *   limits, `count=exact` / HEAD, `.single()` (PGRST116 on 0 or many rows), inserts, upserts (`on_conflict`), updates,
 *   deletes and RPCs (`enqueue_processing_job` with its idempotent-on-key semantics). Learner-client reads and writes
 *   are restricted to the caller's own rows on owner tables (a minimal RLS stand-in).
 * - `FakeOpenRouter` answers the OpenRouter endpoints the adapters call (`/audio/transcriptions`, `/audio/speech`,
 *   `/chat/completions`, `/models`) with scripted payloads and records every call. It is reached only through a fake
 *   base URL; nothing in these tests can leave the process.
 * - `FakeBucket` is an in-memory R2 binding (`MEDIA`).
 *
 * `routeHarness()` stubs the global `fetch` with a router that serves those fakes and THROWS for every other host,
 * so a route that tried to reach a paid provider fails the test instead of spending anything. Call `restore()` after
 * each test. Route handlers, middleware, repositories, AI adapters and the capability registry all run for real.
 */
import type { Role } from '@langquest/contracts';
import { vi } from 'vitest';
import { createApp, type AppContext } from '../../app';
import type { Env, R2BucketLike, R2ObjectLike } from '../../env';
import { call, offlineEnv, signTestToken, type CallOptions } from '../harness';

export type DbRow = Record<string, unknown>;
export type DbClientKind = 'service' | 'user' | 'anon';

export interface RecordedDbRequest {
  method: string;
  /** Table name, or `rpc:<function>` for RPC calls. */
  target: string;
  client: DbClientKind;
  /** Token subject for learner-client calls. */
  sub: string | null;
  query: string;
  body: unknown;
}

export interface DbFailure {
  status: number;
  code: string;
  message: string;
}

const NOW = () => new Date().toISOString();

/** Tables keyed by something other than `id` (no synthetic id on insert). */
const NO_ID_TABLES = new Set(['profiles', 'account_settings', 'lesson_speakers', 'user_roles', 'audio_lesson_assets', 'course_source_localizations', 'mission_localizations']);

/** Owner column per table for learner-client (RLS) emulation. */
const OWNER_COLUMNS: Record<string, string> = {
  profiles: 'user_id',
  account_settings: 'user_id',
  user_course_enrollments: 'user_id',
  conversation_sessions: 'user_id',
  user_audio_progress: 'user_id',
};

/** Rows the learner client may read on catalog tables (published content only). */
const LEARNER_READABLE: Record<string, (row: DbRow) => boolean> = {
  expressions: (row) => row.state === 'published',
};

/** Unique constraints enforced on insert (23505), mirroring the migrations the routes rely on. */
const UNIQUE_KEYS: Record<string, string[][]> = {
  content_revisions: [['entity_table', 'entity_id', 'revision']],
  processing_jobs: [['idempotency_key']],
};

const decodeSub = (authorization: string | null): string | null => {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
};

/** Split on `sep` at depth 0 (outside parentheses and double quotes). */
function splitTopLevel(input: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '(') depth += 1;
    else if (!quoted && ch === ')') depth -= 1;
    if (ch === sep && depth === 0 && !quoted) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '') out.push(current);
  return out;
}

const unquote = (v: string): string => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
const looksLikeTimestamp = (v: string): boolean => /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v);

/** Read `a.b.c` from a row, mapping over embedded arrays (any element may satisfy a filter). */
function readPath(row: DbRow, column: string): unknown {
  if (column in row) return row[column];
  let values: unknown[] = [row];
  for (const part of column.split('.')) {
    values = values.flatMap((v) => (Array.isArray(v) ? v : [v])).map((v) => (v && typeof v === 'object' ? (v as DbRow)[part] : undefined));
  }
  const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
  return flat.length === 1 ? flat[0] : flat;
}

function compareScalar(a: unknown, raw: string): number | null {
  if (a === null || a === undefined) return null;
  if (typeof a === 'number') return a - Number(raw);
  if (typeof a === 'boolean') return Number(a) - Number(raw === 'true');
  const s = String(a);
  if (looksLikeTimestamp(s) && looksLikeTimestamp(raw)) return Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s) - Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  return s < raw ? -1 : s > raw ? 1 : 0;
}

const likeRegex = (pattern: string, flags: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.')}$`, flags);

function matchesOp(value: unknown, op: string, raw: string): boolean {
  if (Array.isArray(value)) {
    if (op === 'is' && raw === 'null') return value.length === 0;
    return value.some((v) => matchesOp(v, op, raw));
  }
  switch (op) {
    case 'eq':
      return compareScalar(value, raw) === 0;
    case 'neq':
      return value !== null && value !== undefined && compareScalar(value, raw) !== 0;
    case 'gt':
      return (compareScalar(value, raw) ?? -1) > 0;
    case 'gte':
      return (compareScalar(value, raw) ?? -1) >= 0;
    case 'lt':
      return (compareScalar(value, raw) ?? 1) < 0;
    case 'lte':
      return (compareScalar(value, raw) ?? 1) <= 0;
    case 'like':
      return typeof value === 'string' && likeRegex(raw, '').test(value);
    case 'ilike':
      return typeof value === 'string' && likeRegex(raw, 'i').test(value);
    case 'is':
      if (raw === 'null') return value === null || value === undefined;
      return value === (raw === 'true');
    case 'in': {
      const list = splitTopLevel(raw.replace(/^\(/, '').replace(/\)$/, '')).map(unquote);
      return list.some((item) => compareScalar(value, item) === 0);
    }
    default:
      throw new Error(`FakePostgrest: unsupported filter operator "${op}"`);
  }
}

/** `eq.x`, `not.is.null`, `in.(a,b)` → evaluator. */
function evalCondition(row: DbRow, column: string, expr: string): boolean {
  let negate = false;
  let rest = expr;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  const op = rest.slice(0, dot);
  const raw = rest.slice(dot + 1);
  const result = matchesOp(readPath(row, column), op, raw);
  return negate ? !result : result;
}

/** `(a.eq.1,b.like.x%)` → any condition holds. */
function evalOr(row: DbRow, expr: string): boolean {
  const inner = expr.replace(/^\(/, '').replace(/\)$/, '');
  return splitTopLevel(inner).some((cond) => {
    const parts = cond.split('.');
    // column may itself be dotted only for embedded filters; operators are single words.
    const opIndex = parts.findIndex((p, i) => i > 0 && /^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|not)$/.test(p));
    const column = parts.slice(0, opIndex).join('.');
    return evalCondition(row, column, parts.slice(opIndex).join('.'));
  });
}

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function applyFilters(rows: DbRow[], params: URLSearchParams): DbRow[] {
  let out = rows;
  for (const [key, value] of params) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (key === 'or') out = out.filter((r) => evalOr(r, value));
    else out = out.filter((r) => evalCondition(r, key, value));
  }
  return out;
}

function applyOrder(rows: DbRow[], order: string | null): DbRow[] {
  if (!order) return rows;
  const keys = splitTopLevel(order).map((term) => {
    const parts = term.split('.');
    let ascending = true;
    let nullsFirst: boolean | null = null;
    while (parts.length > 1 && /^(asc|desc|nullsfirst|nullslast)$/.test(parts[parts.length - 1]!)) {
      const t = parts.pop()!;
      if (t === 'desc') ascending = false;
      if (t === 'nullsfirst') nullsFirst = true;
      if (t === 'nullslast') nullsFirst = false;
    }
    return { column: parts.join('.'), ascending, nullsFirst: nullsFirst ?? !ascending };
  });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const av = readPath(a, k.column);
      const bv = readPath(b, k.column);
      if (av === bv) continue;
      if (av === null || av === undefined) return k.nullsFirst ? -1 : 1;
      if (bv === null || bv === undefined) return k.nullsFirst ? 1 : -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av) < String(bv) ? -1 : 1;
      if (cmp !== 0) return k.ascending ? cmp : -cmp;
    }
    return 0;
  });
}

/** Keep the selected columns; embedded resources (`rel!inner(...)`) are returned as stored on the row. */
function project(row: DbRow, select: string | null): DbRow {
  if (!select || select === '*') return { ...row };
  const out: DbRow = {};
  for (const item of splitTopLevel(select)) {
    if (item === '*') {
      Object.assign(out, row);
      continue;
    }
    const aliasMatch = /^([a-zA-Z0-9_]+):(.+)$/.exec(item);
    const alias = aliasMatch?.[1] ?? null;
    const body = aliasMatch?.[2] ?? item;
    const name = (body.split('(')[0] ?? body).split('!')[0]!.split('::')[0]!;
    if (name in row) out[alias ?? name] = row[name];
  }
  return out;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const pgError = (status: number, code: string, message: string, details: string | null = null) => json(status, { code, message, details, hint: null });

export type RpcHandler = (args: Record<string, unknown>, ctx: { db: FakePostgrest; client: DbClientKind; sub: string | null }) => unknown;

export class FakePostgrest {
  private readonly tables = new Map<string, DbRow[]>();
  private readonly failures = new Map<string, DbFailure>();
  readonly requests: RecordedDbRequest[] = [];
  readonly rpcs: Record<string, RpcHandler> = {
    enqueue_processing_job: (args, ctx) => {
      const key = String(args.p_idempotency_key);
      const existing = ctx.db.rows('processing_jobs').find((j) => j.idempotency_key === key);
      if (existing) return existing;
      const now = NOW();
      const row: DbRow = {
        id: crypto.randomUUID(),
        job_type: args.p_job_type,
        idempotency_key: key,
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
        progress_pct: 0,
        cost_estimate_usd: null,
        cost_actual_usd: null,
        failure_code: null,
        failure_message: null,
        output: null,
        output_asset_ids: [],
        locked_by: null,
        locked_until: null,
        started_at: null,
        finished_at: null,
        created_at: now,
        updated_at: now,
      };
      ctx.db.rows('processing_jobs').push(row);
      return row;
    },
  };

  /** Live array for a table (created on first use). */
  rows(table: string): DbRow[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  seed(table: string, rows: DbRow[]): DbRow[] {
    const target = this.rows(table);
    const now = NOW();
    const seeded = rows.map((r) => ({ ...(NO_ID_TABLES.has(table) ? {} : { id: crypto.randomUUID() }), created_at: now, updated_at: now, ...r }));
    target.push(...seeded);
    return seeded;
  }

  /** Make every request touching `target` (table or `rpc:<fn>`) fail with a PostgREST error. */
  fail(target: string, failure: DbFailure): void {
    this.failures.set(target, failure);
  }

  /** Requests that wrote to `target` (POST/PATCH/DELETE, or the RPC). */
  writes(target: string): RecordedDbRequest[] {
    return this.requests.filter((r) => r.target === target && (r.method !== 'GET' && r.method !== 'HEAD'));
  }

  private visible(table: string, rows: DbRow[], client: DbClientKind, sub: string | null): DbRow[] {
    if (client !== 'user') return rows;
    const owner = OWNER_COLUMNS[table];
    if (owner) return rows.filter((r) => r[owner] === sub);
    const readable = LEARNER_READABLE[table];
    return readable ? rows.filter(readable) : rows;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const method = request.method.toUpperCase();
    const client = (request.headers.get('x-langquest-client') as DbClientKind | null) ?? 'anon';
    const sub = client === 'user' ? decodeSub(request.headers.get('authorization')) : null;
    const text = method === 'GET' || method === 'HEAD' ? '' : await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    const isRpc = path.startsWith('rpc/');
    const target = isRpc ? `rpc:${path.slice(4)}` : path;
    this.requests.push({ method, target, client, sub, query: url.search, body });

    const failure = this.failures.get(target);
    if (failure) return pgError(failure.status, failure.code, failure.message);

    const accept = request.headers.get('accept') ?? '';
    const prefer = request.headers.get('prefer') ?? '';
    const single = accept.startsWith('application/vnd.pgrst.object+json');
    const params = url.searchParams;

    if (isRpc) {
      const handler = this.rpcs[path.slice(4)];
      if (!handler) return pgError(404, 'PGRST202', `Could not find the function public.${path.slice(4)} in the schema cache (FakePostgrest)`);
      try {
        const result = await handler((body ?? {}) as Record<string, unknown>, { db: this, client, sub });
        return json(200, result);
      } catch (error) {
        const e = error as { status?: number; code?: string; message?: string };
        return pgError(e.status ?? 400, e.code ?? 'P0001', e.message ?? 'rpc failed');
      }
    }

    const table = path;
    const all = this.rows(table);
    const respondRows = (rows: DbRow[], status: number, withBody: boolean) => {
      const select = params.get('select');
      const projected = rows.map((r) => project(r, select));
      const headers: Record<string, string> = {};
      const countMatch = /count=(exact|planned|estimated)/.exec(prefer);
      if (countMatch) headers['content-range'] = rows.length ? `0-${rows.length - 1}/${rows.length}` : `*/0`;
      if (method === 'HEAD') return new Response(null, { status: 200, headers });
      if (!withBody) return new Response(null, { status, headers });
      if (single) {
        if (projected.length !== 1) return pgError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${projected.length} rows`);
        return json(status, projected[0], headers);
      }
      return json(status, projected, headers);
    };

    if (method === 'GET' || method === 'HEAD') {
      let rows = applyFilters(this.visible(table, all, client, sub), params);
      rows = applyOrder(rows, params.get('order'));
      const offset = Number(params.get('offset') ?? '0');
      const limit = params.get('limit');
      const total = rows.length;
      const page = rows.slice(offset, limit !== null ? offset + Number(limit) : undefined);
      const res = respondRows(page, 200, true);
      if (/count=/.test(prefer)) res.headers.set('content-range', page.length ? `${offset}-${offset + page.length - 1}/${total}` : `*/${total}`);
      return res;
    }

    const returnRepresentation = /return=representation/.test(prefer);
    const ownerCol = client === 'user' ? OWNER_COLUMNS[table] : undefined;

    if (method === 'POST') {
      const input = (Array.isArray(body) ? body : [body]) as DbRow[];
      const conflictCols = params.get('on_conflict')?.split(',').map((c) => c.trim()) ?? null;
      const merge = /resolution=merge-duplicates/.test(prefer);
      const ignore = /resolution=ignore-duplicates/.test(prefer);
      const written: DbRow[] = [];
      for (const raw of input) {
        if (ownerCol && raw[ownerCol] !== sub) return pgError(403, '42501', `new row violates row-level security policy for table "${table}"`);
        const keyCols = conflictCols ?? (NO_ID_TABLES.has(table) ? null : ['id']);
        const existing = (merge || ignore) && keyCols ? all.find((r) => keyCols.every((c) => r[c] === raw[c])) : undefined;
        if (existing) {
          if (ignore) continue;
          Object.assign(existing, raw, { updated_at: NOW() });
          written.push(existing);
          continue;
        }
        const now = NOW();
        const row: DbRow = { ...(NO_ID_TABLES.has(table) ? {} : { id: crypto.randomUUID() }), created_at: now, updated_at: now, ...raw };
        for (const cols of UNIQUE_KEYS[table] ?? []) {
          if (all.some((r) => cols.every((c) => r[c] === row[c]))) return pgError(409, '23505', `duplicate key value violates unique constraint on ${table} (${cols.join(', ')})`);
        }
        all.push(row);
        written.push(row);
      }
      return respondRows(written, 201, returnRepresentation);
    }

    if (method === 'PATCH') {
      const patch = (body ?? {}) as DbRow;
      const rows = applyFilters(this.visible(table, all, client, sub), params);
      for (const r of rows) Object.assign(r, patch, { updated_at: NOW() });
      return respondRows(rows, 200, returnRepresentation);
    }

    if (method === 'DELETE') {
      const rows = applyFilters(this.visible(table, all, client, sub), params);
      for (const r of rows) all.splice(all.indexOf(r), 1);
      return respondRows(rows, 200, returnRepresentation);
    }

    return pgError(405, 'PGRST000', `FakePostgrest: method ${method} not emulated`);
  }
}

// --- OpenRouter -----------------------------------------------------------------------

export const FAKE_OPENROUTER_BASE = 'https://openrouter.fake.test/api/v1';

export interface OpenRouterCall {
  method: string;
  path: string;
  /** JSON body (chat, speech) or multipart fields (transcriptions; the file is reduced to its byte length). */
  body: Record<string, unknown> | null;
}

export type ScriptedResponse = { status: number; body: unknown } | { bytes: Uint8Array; contentType: string };

export class FakeOpenRouter {
  readonly calls: OpenRouterCall[] = [];
  /** Model ids returned by `GET /models`. */
  catalog: string[] = [];
  transcription: (req: Record<string, unknown>) => ScriptedResponse = (req) => ({
    status: 200,
    body: {
      text: 'Bonjour',
      language: typeof req.language === 'string' ? req.language : null,
      duration: 1.2,
      segments: [{ id: 0, start: 0, end: 1.2, text: 'Bonjour', avg_logprob: -0.05, no_speech_prob: 0.01 }],
      words: [{ word: 'Bonjour', start: 0, end: 1.2 }],
      usage: { seconds: 1.2, cost: 0.0001 },
    },
  });
  speech: (req: Record<string, unknown>) => ScriptedResponse = (req) =>
    req.response_format === 'pcm' ? { bytes: new Uint8Array(48_000), contentType: 'audio/pcm;rate=24000;channels=1' } : { bytes: new Uint8Array(4_000), contentType: 'audio/mpeg' };
  /** Returns the assistant message content (a JSON string for structured calls). */
  chat: (req: Record<string, unknown>) => ScriptedResponse | string = () => JSON.stringify({ reply: 'Bonjour ! Comment allez-vous aujourd’hui ?', transliteration: null });

  callsTo(path: string): OpenRouterCall[] {
    return this.calls.filter((c) => c.path === path);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1/, '');
    let body: Record<string, unknown> | null = null;
    const contentType = request.headers.get('content-type') ?? '';
    if (request.method === 'POST' && contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      body = {};
      for (const [k, v] of form.entries()) {
        const value = typeof v === 'string' ? v : { bytes: (v as Blob).size, type: (v as Blob).type };
        const prev = body[k];
        body[k] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
      }
    } else if (request.method === 'POST') {
      body = JSON.parse(await request.text()) as Record<string, unknown>;
    }
    this.calls.push({ method: request.method, path: `${path}${url.search}`, body });
    const scripted = (r: ScriptedResponse) => ('bytes' in r ? new Response(r.bytes as BodyInit, { status: 200, headers: { 'content-type': r.contentType } }) : json(r.status, r.body));
    if (request.method === 'GET' && path === '/models') return json(200, { data: this.catalog.map((id) => ({ id, name: id, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, context_length: 8192, pricing: { prompt: '0', completion: '0' } })) });
    if (path === '/audio/transcriptions') return scripted(this.transcription(body ?? {}));
    if (path === '/audio/speech') return scripted(this.speech(body ?? {}));
    if (path === '/chat/completions') {
      const out = this.chat(body ?? {});
      if (typeof out !== 'string') return scripted(out);
      const model = (body?.model as string | undefined) ?? (body?.models as string[] | undefined)?.[0] ?? 'unknown';
      return json(200, { id: `gen-${crypto.randomUUID()}`, model, choices: [{ message: { content: out }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9, cost: 0 } });
    }
    return json(404, { error: { message: `FakeOpenRouter: ${request.method} ${path} not scripted`, code: 404 } });
  }
}

// --- R2 -------------------------------------------------------------------------------

export class FakeBucket implements R2BucketLike {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined; uploaded: Date }>();

  putText(key: string, text: string, contentType = 'text/plain'): void {
    this.objects.set(key, { bytes: new TextEncoder().encode(text), contentType, uploaded: new Date() });
  }

  private meta(key: string): R2ObjectLike | null {
    const o = this.objects.get(key);
    return o ? { key, size: o.bytes.byteLength, etag: `etag-${o.bytes.byteLength}`, httpEtag: `"etag-${o.bytes.byteLength}"`, uploaded: o.uploaded, httpMetadata: { contentType: o.contentType } } : null;
  }

  async head(key: string): Promise<R2ObjectLike | null> {
    return this.meta(key);
  }

  async get(key: string, options?: { range?: { offset: number; length?: number } | { suffix: number } }) {
    const o = this.objects.get(key);
    const meta = this.meta(key);
    if (!o || !meta) return null;
    let bytes = o.bytes;
    const range = options?.range;
    if (range && 'offset' in range) bytes = bytes.slice(range.offset, range.length !== undefined ? range.offset + range.length : undefined);
    const copy = bytes.slice();
    return { ...meta, body: new Blob([copy as BlobPart]).stream(), arrayBuffer: async () => copy.buffer as ArrayBuffer };
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }): Promise<R2ObjectLike> {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType, uploaded: new Date() });
    return this.meta(key)!;
  }

  async delete(key: string | string[]): Promise<void> {
    for (const k of Array.isArray(key) ? key : [key]) this.objects.delete(k);
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const objects = [...this.objects.keys()].filter((k) => !options?.prefix || k.startsWith(options.prefix)).map((k) => this.meta(k)!);
    return { objects, truncated: false };
  }
}

// --- harness ----------------------------------------------------------------------------

export interface RouteHarnessOptions {
  /** Staff roles by user id (learners have none). */
  roles?: Record<string, Role[]>;
  /** Configure the AI provider (a dummy OpenRouter key + the fake base URL). Off = deployment without AI. */
  openRouter?: boolean;
  /** Bind an in-memory R2 bucket as `MEDIA`. */
  media?: boolean;
  env?: Partial<Env>;
}

export interface RouteHarness {
  ctx: AppContext;
  db: FakePostgrest;
  openrouter: FakeOpenRouter;
  bucket: FakeBucket | null;
  /** Every request the fake network refused (anything but the fake Supabase / OpenRouter). Must stay empty. */
  blocked: string[];
  token(userId: string): Promise<string>;
  call: (path: string, opts?: CallOptions) => ReturnType<typeof call>;
  /** Await background work (audit rows, ai_requests ledger) started by the handled requests. */
  flush(): Promise<void>;
  restore(): void;
}

export function routeHarness(options: RouteHarnessOptions = {}): RouteHarness {
  const db = new FakePostgrest();
  const openrouter = new FakeOpenRouter();
  const bucket = options.media ? new FakeBucket() : null;
  const blocked: string[] = [];
  const supabaseOrigin = new URL(offlineEnv.SUPABASE_URL).origin;
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === supabaseOrigin && url.pathname.startsWith('/rest/v1/')) return db.handle(request);
    if (request.url.startsWith(FAKE_OPENROUTER_BASE)) return openrouter.handle(request);
    blocked.push(`${request.method} ${url.origin}${url.pathname}`);
    throw new TypeError(`route tests: network access blocked (${request.method} ${url.origin}${url.pathname})`);
  };
  vi.stubGlobal('fetch', fakeFetch);
  const env: Env = {
    ...offlineEnv,
    ...(options.openRouter ? { OPENROUTER_API_KEY: 'fake-openrouter-key-for-route-tests', OPENROUTER_BASE_URL: FAKE_OPENROUTER_BASE } : {}),
    ...(bucket ? { MEDIA: bucket } : {}),
    ...options.env,
  };
  const roles = options.roles ?? {};
  const background = new Set<Promise<unknown>>();
  const ctx = createApp({ env, fetch: fakeFetch, logSink: () => undefined, roleResolver: async (userId) => roles[userId] ?? [], background });
  return {
    ctx,
    db,
    openrouter,
    bucket,
    blocked,
    token: (userId) => signTestToken(userId),
    call: (path, opts) => call(ctx, path, opts),
    flush: () => ctx.flush(),
    restore: () => vi.unstubAllGlobals(),
  };
}

// --- row builders -----------------------------------------------------------------------

export const profileRow = (userId: string, over: DbRow = {}): DbRow => ({
  user_id: userId,
  display_name: 'Test Learner',
  ui_locale: 'fr-CA',
  default_source_language_code: 'fr',
  time_zone: 'America/Toronto',
  privacy_options: {},
  accessibility_options: {},
  deleted_at: null,
  ...over,
});

export const enrollmentRow = (userId: string, courseTrackId: string, over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  user_id: userId,
  course_track_id: courseTrackId,
  source_language_code: 'en',
  status: 'active',
  script_mode: 'native',
  learner_level: 'beginner',
  preferred_learning_speed: 'regular',
  preferred_target_variant_id: null,
  regional_preference: null,
  active_mission_id: null,
  translation_peek_language_code: null,
  added_at: NOW(),
  last_opened_at: null,
  ...over,
});

export const mediaAssetRow = (over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  storage_key: `masters/${crypto.randomUUID()}.mp3`,
  bucket: 'langquest-media',
  owner_id: null,
  kind: 'audio',
  checksum_sha256: 'a'.repeat(64),
  mime_type: 'audio/mpeg',
  byte_length: 1024,
  duration_ms: 1000,
  visibility: 'private',
  state: 'imported_draft',
  disposition: 'active',
  legacy_filename: null,
  legacy_path: null,
  content_rights_id: null,
  derivation: null,
  etag: null,
  source_asset_id: null,
  sample_rate_hz: null,
  bitrate_kbps: null,
  channels: null,
  ...over,
});

export const audioLessonRow = (over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  chapter_id: crypto.randomUUID(),
  title_translations: { en: 'Greetings' },
  description_translations: {},
  sort_order: 0,
  episode_number: null,
  level: null,
  target_variety_id: 'fr',
  instruction_language_code: 'en',
  spoken_language_codes: ['fr'],
  regional_dialect: null,
  topic: null,
  tags: [],
  scene: null,
  cover_visual_asset_id: null,
  content_rights_id: null,
  state: 'metadata_needed',
  visibility: 'private',
  quality_review_status: 'unreviewed',
  transcript_status: 'none',
  listen_length_ms: null,
  published_revision: null,
  ...over,
});

export const modelProfileRow = (over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  task: 'character_dialogue',
  target_variety_id: 'fr',
  source_language_code: null,
  provider: 'openrouter',
  primary_model: 'fake/dialogue-model',
  fallback_models: [],
  params: {},
  capabilities: {},
  latency_class: 'interactive',
  daily_budget_usd: null,
  enabled: true,
  version: 1,
  benchmark_status: 'unbenchmarked',
  updated_by: null,
  ...over,
});
