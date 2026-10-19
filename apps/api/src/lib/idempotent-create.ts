/**
 * Idempotent admin creates (§6.4): every create/reorder/revoke body carries an `idempotencyKey`; the first
 * successful call writes a `content_revisions` row whose diff records the key, so a retry with the same key
 * (after a lost response) resolves to the SAME entity instead of a duplicate. The lookup is scoped to the action
 * and the actor: two editors reusing a key never collide, and a key can never resolve to someone else's row.
 */
import type { RequestServices } from '../services/context';

/** Entity id created earlier by this actor under (`action`, `idempotencyKey`), or null. */
export async function findIdempotentCreate(s: RequestServices, action: string, idempotencyKey: string): Promise<string | null> {
  const { principal } = s.requireUser();
  const res = await s.service
    .from('content_revisions')
    .select('entity_id')
    .eq('editor_id', principal.userId)
    .eq('revision', 1)
    .contains('diff', { create: true, idempotencyKey, action })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) return null;
  return res.data?.entity_id ?? null;
}

/** The diff recorded by a create so `findIdempotentCreate` can find it later. */
export const createDiff = (action: string, idempotencyKey: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ create: true, action, idempotencyKey, ...extra });
