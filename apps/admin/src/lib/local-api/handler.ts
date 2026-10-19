import 'server-only';
/**
 * Local adapter routes (`app/api/admin/**`) — the CMS needs a handful of writes the shared
 * contracts do not expose yet (speakers, collections/chapters/lessons structure, rights
 * records, coverage editorial status, transcript segments, role grants, revision rollback,
 * job retry, model probes). Each handler:
 *   1. requires a verified staff session and the section role,
 *   2. validates the body with Zod,
 *   3. writes through the user's own Supabase session, so RLS (editor/reviewer/admin
 *      policies) remains the security boundary — the admin app has no service role,
 *   4. answers with the contracts envelope (`{ ok, data }` / `{ ok:false, error }`).
 * Every route is listed as a cross-package gap to move into `@langquest/contracts` + `apps/api`.
 * Where the API already serves an operation, the local route is only a thin adapter that forwards
 * to it with the staff token (`serverApi`): `content/:id/decision` → `adminContentRequestReview`
 * for send-backs, `jobs/:id/retry` → `adminAssetProcess` for asset-parented jobs.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { API_ERROR_HTTP_STATUS, err, type ApiErrorCode, type JsonValue } from '@langquest/contracts';
import { getStaffSession, type StaffSession } from '@/src/lib/auth/session';
import { canAccessSection, type AdminSection } from '@/src/lib/auth/roles';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';

export type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Error raised by a local route handler. `message` is what the browser sees, so it must be
 * client-safe. `internal` is an optional server-only detail (raw PostgREST text, context
 * label); it is logged with the request id and never serialised into the envelope.
 */
export class LocalApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: JsonValue,
    readonly internal?: string,
  ) {
    super(message);
    this.name = 'LocalApiError';
  }
}

/** Generic, client-safe copy for each failure class (mirrors `apps/api/src/http/envelope.ts`). */
export const SAFE_MESSAGES = {
  internal: 'Something went wrong on our side',
  database: 'Database request failed',
  forbidden: 'You do not have access to this resource',
  conflict: 'A conflicting record already exists',
  notFound: 'Resource not found',
  reference: 'A referenced record does not exist or is not accessible',
  constraint: 'A value does not satisfy a data constraint',
  provider: 'A provider is temporarily unavailable. Please try again in a moment.',
  timeout: 'The request took too long and was cancelled. Please retry.',
  providerAnswer: 'The AI provider returned an unusable answer. Please retry.',
} as const;

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(code: ApiErrorCode, message: string, details?: JsonValue, traceId?: string) {
  return NextResponse.json(err(code, message, details, traceId), { status: API_ERROR_HTTP_STATUS[code] });
}

export interface HandlerContext<B> {
  session: StaffSession;
  supabase: SupabaseServer;
  body: B;
  params: Record<string, string>;
  /** Request id echoed as `traceId` on failures and attached to server logs. */
  requestId: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Reuse a well-formed upstream `x-request-id`; otherwise mint one so logs and envelopes correlate. */
function resolveRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  if (incoming && REQUEST_ID_PATTERN.test(incoming)) return incoming;
  return crypto.randomUUID();
}

/** Compact, client-safe Zod issue list (no `input` echo). */
function zodIssues(error: z.ZodError): JsonValue {
  return error.issues.slice(0, 25).map((i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code }));
}

/** Server-side record of a failed route; the client only ever receives the generic envelope. */
function logRouteFailure(requestId: string, section: AdminSection, error: unknown): void {
  const base = { requestId, section };
  if (error instanceof LocalApiError) {
    if (error.internal || error.code === 'internal') console.error('[admin.local-api]', { ...base, code: error.code, internal: error.internal ?? error.message });
    return;
  }
  const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { value: String(error) };
  console.error('[admin.local-api]', { ...base, code: 'internal', ...detail });
}

/**
 * Normalise a thrown value into a `LocalApiError` with client-safe copy (same shapes as
 * `apps/api` `toProblem`): `@langquest/ai` capability errors keep their authored message,
 * provider/timeout failures become `provider_unavailable`, everything else `internal`.
 */
function toLocalApiError(error: unknown): LocalApiError {
  if (error instanceof LocalApiError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'capability_unsupported') return new LocalApiError('capability_unsupported', (error as Error).message);
  if (code === 'provider_unavailable') return new LocalApiError('provider_unavailable', SAFE_MESSAGES.provider);
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return new LocalApiError('provider_unavailable', SAFE_MESSAGES.timeout);
  if (name === 'OpenRouterError' || name === 'StructuredOutputError') return new LocalApiError('provider_unavailable', SAFE_MESSAGES.providerAnswer);
  return new LocalApiError('internal', SAFE_MESSAGES.internal);
}

/**
 * Wrap a handler with auth, role, validation and error mapping. Unknown errors are logged with
 * the request id and answered with a generic `internal` message; PostgREST/Postgres text never
 * reaches the browser.
 */
export function adminRoute<B>(section: AdminSection, bodySchema: z.ZodType<B> | null, run: (ctx: HandlerContext<B>) => Promise<unknown>) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }) => {
    const requestId = resolveRequestId(request);
    try {
      const session = await getStaffSession();
      if (!session) return fail('unauthorized', 'Sign in required', undefined, requestId);
      if (!canAccessSection(session.roles, section)) return fail('forbidden', `Your role cannot access ${section}`, undefined, requestId);
      let body: B = undefined as B;
      if (bodySchema) {
        const raw = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) return fail('validation_failed', 'Invalid request body', zodIssues(parsed.error), requestId);
        body = parsed.data;
      }
      const supabase = await createSupabaseServerClient();
      const params = await context.params;
      const data = await run({ session, supabase, body, params, requestId });
      return ok(data);
    } catch (error) {
      logRouteFailure(requestId, section, error);
      const problem = toLocalApiError(error);
      const message = problem.code === 'internal' ? SAFE_MESSAGES.internal : problem.message;
      return fail(problem.code, message, problem.details, requestId);
    }
  };
}

/**
 * Map a PostgREST error to a contract code with a fixed, client-safe message
 * (RLS denial → forbidden, unique → conflict, FK/check → validation_failed). The raw
 * Postgres text and `context` label are kept server-side on `LocalApiError.internal`.
 */
export function throwDb(error: { code?: string; message: string; details?: string | null } | null, context: string): never {
  const code = error?.code ?? '';
  const internal = `${context}: [${code || 'no-code'}] ${error?.message ?? 'unknown error'}${error?.details ? ` — ${error.details}` : ''}`;
  if (code === '42501') throw new LocalApiError('forbidden', SAFE_MESSAGES.forbidden, undefined, internal);
  if (code === '23505') throw new LocalApiError('conflict', SAFE_MESSAGES.conflict, undefined, internal);
  if (code === 'PGRST116' || code === 'P0002') throw new LocalApiError('not_found', SAFE_MESSAGES.notFound, undefined, internal);
  if (code === '23503') throw new LocalApiError('validation_failed', SAFE_MESSAGES.reference, undefined, internal);
  if (code === '23514' || code === '22023' || code === '22P02') throw new LocalApiError('validation_failed', SAFE_MESSAGES.constraint, undefined, internal);
  throw new LocalApiError('internal', SAFE_MESSAGES.database, undefined, internal);
}

/** Append a content revision (reviewer/editor insert policy requires editor_id = auth.uid()). */
export async function recordRevision(supabase: SupabaseServer, session: StaffSession, entityTable: string, entityId: string, diff: Record<string, unknown>, snapshot: Record<string, unknown> | null, note?: string) {
  const { data: last } = await supabase.from('content_revisions').select('revision').eq('entity_table', entityTable).eq('entity_id', entityId).order('revision', { ascending: false }).limit(1).maybeSingle();
  const revision = (last?.revision ?? -1) + 1;
  const { data, error } = await supabase
    .from('content_revisions')
    .insert({ entity_table: entityTable, entity_id: entityId, revision, diff: diff as never, snapshot: snapshot as never, editor_id: session.userId, note: note ?? null })
    .select('id, revision')
    .single();
  if (error) {
    // Revisions are best-effort for roles without the reviewer policy; the write itself already succeeded.
    return { id: null, revision };
  }
  return data;
}
