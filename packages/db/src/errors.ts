/** Error normalisation for supabase-js / PostgREST results. */
import type { PostgrestError } from '@supabase/supabase-js';

export class DbError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;
  constructor(error: PostgrestError, context?: string) {
    super(context ? `${context}: ${error.message}` : error.message);
    this.name = 'DbError';
    this.code = error.code;
    this.details = error.details ?? null;
    this.hint = error.hint ?? null;
  }
  /** Postgres unique_violation (23505) or our RPCs raising it. */
  get isUniqueViolation(): boolean {
    return this.code === '23505';
  }
  /** Postgres insufficient_privilege (42501): RLS or RPC ownership check. */
  get isForbidden(): boolean {
    return this.code === '42501';
  }
  /** PostgREST "no rows" when `.single()` found nothing. */
  get isNotFound(): boolean {
    return this.code === 'PGRST116' || this.code === 'P0002';
  }
}

type ResultLike = { data: unknown; error: PostgrestError | null };

/** Unwraps `{ data, error }`; throws `DbError` on error. */
export function unwrap<R extends ResultLike>(result: R, context?: string): NonNullable<R['data']> {
  if (result.error) throw new DbError(result.error, context);
  return result.data as NonNullable<R['data']>;
}

/** Like `unwrap` but maps PostgREST not-found to `null` instead of throwing. */
export function unwrapMaybe<R extends ResultLike>(result: R, context?: string): NonNullable<R['data']> | null {
  if (result.error) {
    if (result.error.code === 'PGRST116') return null;
    throw new DbError(result.error, context);
  }
  return (result.data ?? null) as NonNullable<R['data']> | null;
}
