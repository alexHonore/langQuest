import 'server-only';
/**
 * Lightweight read queries used by server components. Every query runs through the signed-in
 * staff member's Supabase session, so RLS (`staff_select`, `admin_select`, …) decides what is
 * visible. Column lists are explicit (no `select('*')`) and results are plain data for the
 * client components. Mutations never live here — they go through the LangQuest API (`/v1/admin/*`).
 */
import { createSupabaseServerClient } from '@/src/lib/supabase/server';

/** Request-scoped Supabase client acting as the signed-in staff member (anon key + their JWT, RLS applies). */
export type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function db(): Promise<Db> {
  return createSupabaseServerClient();
}

/** Result wrapper so pages can render honest access/empty states instead of throwing. */
export type QueryResult<T> = { ok: true; data: T } | { ok: false; error: string; forbidden: boolean };

/** List queries never yield null (coalesced to []); single-row queries keep `null` for "not found". */
export type SafeData<T> = Exclude<T, null> extends readonly unknown[] ? Exclude<T, null> : T;

export async function safe<T>(run: () => PromiseLike<{ data: T; error: { message: string; code?: string } | null }>): Promise<QueryResult<SafeData<T>>> {
  try {
    const { data, error } = await run();
    if (error) return { ok: false, error: error.message, forbidden: error.code === '42501' || /permission denied|row-level security/i.test(error.message) };
    return { ok: true, data: (data ?? ([] as unknown)) as SafeData<T> };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), forbidden: false };
  }
}

export const PAGE_SIZE = 50;

/** Offset pagination helper for server-rendered lists (`?page=N`). */
export function pageRange(page: number, size = PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, page);
  return { from: (p - 1) * size, to: p * size - 1 };
}

export function parsePage(value: string | undefined): number {
  const n = Number(value ?? '1');
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
