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
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { API_ERROR_HTTP_STATUS, type ApiErrorCode } from '@langquest/contracts';
import { getStaffSession, type StaffSession } from '@/src/lib/auth/session';
import { canAccessSection, type AdminSection } from '@/src/lib/auth/roles';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';

export type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export class LocalApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'LocalApiError';
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(code: ApiErrorCode, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status: API_ERROR_HTTP_STATUS[code] });
}

export interface HandlerContext<B> {
  session: StaffSession;
  supabase: SupabaseServer;
  body: B;
  params: Record<string, string>;
}

/** Wrap a handler with auth, role, validation and error mapping. */
export function adminRoute<B>(section: AdminSection, bodySchema: z.ZodType<B> | null, run: (ctx: HandlerContext<B>) => Promise<unknown>) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }) => {
    try {
      const session = await getStaffSession();
      if (!session) return fail('unauthorized', 'Sign in required');
      if (!canAccessSection(session.roles, section)) return fail('forbidden', `Role cannot access ${section}`);
      let body: B = undefined as B;
      if (bodySchema) {
        const raw = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) return fail('validation_failed', 'Invalid request body', parsed.error.issues);
        body = parsed.data;
      }
      const supabase = await createSupabaseServerClient();
      const params = await context.params;
      const data = await run({ session, supabase, body, params });
      return ok(data);
    } catch (error) {
      if (error instanceof LocalApiError) return fail(error.code, error.message, error.details);
      const message = error instanceof Error ? error.message : String(error);
      return fail('internal', message);
    }
  };
}

/** Map a PostgREST error to a contract code (RLS denial → forbidden, unique → conflict). */
export function throwDb(error: { code?: string; message: string; details?: string | null } | null, context: string): never {
  const code = error?.code ?? '';
  if (code === '42501') throw new LocalApiError('forbidden', `${context}: ${error?.message}`);
  if (code === '23505') throw new LocalApiError('conflict', `${context}: ${error?.message}`);
  if (code === 'PGRST116') throw new LocalApiError('not_found', `${context}: not found`);
  if (code === '23514' || code === '23503') throw new LocalApiError('validation_failed', `${context}: ${error?.message}`);
  throw new LocalApiError('internal', `${context}: ${error?.message ?? 'unknown error'}`);
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
