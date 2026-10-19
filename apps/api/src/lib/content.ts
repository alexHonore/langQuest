/**
 * Content-lifecycle helpers for admin routes (§7.6): locating an entity across content tables, recording
 * `content_revisions` / `publication_events` (append-only, actor = the editor), and state transitions validated
 * by `@langquest/media` `canTransitionContent`.
 */
import type { ContentState } from '@langquest/contracts';
import type { Row } from '@langquest/db/types';
import { canTransitionContent } from '@langquest/media/rights';
import { problem } from '../http/envelope';
import type { RequestServices } from '../services/context';

export const CONTENT_TABLES = ['audio_lessons', 'audio_course_collections', 'missions', 'lesson_courses', 'expressions', 'characters', 'visual_assets'] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];
/** Tables whose edits are versioned in `content_revisions` (the admin structure/rights/suggestion resources carry `revision` too). */
export type RevisionTable = ContentTable | 'audio_chapters' | 'speakers' | 'content_rights' | 'asset_suggestions';

export type ContentRow = { table: 'audio_lessons'; row: Row<'audio_lessons'> } | { table: 'audio_course_collections'; row: Row<'audio_course_collections'> } | { table: 'missions'; row: Row<'missions'> } | { table: 'lesson_courses'; row: Row<'lesson_courses'> } | { table: 'expressions'; row: Row<'expressions'> } | { table: 'characters'; row: Row<'characters'> } | { table: 'visual_assets'; row: Row<'visual_assets'> };

/** Load a content row by (table, id) with the service client. */
export async function loadContent(s: RequestServices, table: ContentTable, id: string): Promise<ContentRow> {
  const res = await s.service.from(table).select('*').eq('id', id).maybeSingle();
  if (res.error) throw problem.internal(`Could not read ${table}: ${res.error.message}`);
  if (!res.data) throw problem.notFound('Content');
  return { table, row: res.data } as ContentRow;
}

/** Find which content table holds `id` (request-review has no entityTable in its contract). */
export async function locateContent(s: RequestServices, id: string): Promise<ContentRow> {
  for (const table of CONTENT_TABLES) {
    const res = await s.service.from(table).select('*').eq('id', id).maybeSingle();
    if (res.data) return { table, row: res.data } as ContentRow;
  }
  throw problem.notFound('Content');
}

/** Lifecycle state of a content row (`visual_assets` use `review_status`). */
export function stateOf(content: ContentRow): ContentState {
  if (content.table === 'visual_assets') {
    // `review_status` is the contracts `ReviewStatus` (draft | review_needed | in_review | approved | rejected).
    const rs = content.row.review_status;
    return rs === 'approved' ? 'approved' : rs === 'rejected' ? 'rejected' : rs === 'review_needed' || rs === 'in_review' ? 'review_needed' : 'imported_draft';
  }
  return content.row.state as ContentState;
}

export async function currentRevision(s: RequestServices, table: RevisionTable, id: string): Promise<number> {
  const res = await s.service.from('content_revisions').select('revision').eq('entity_table', table).eq('entity_id', id).order('revision', { ascending: false }).limit(1).maybeSingle();
  return res.data?.revision ?? 0;
}

/** Latest revision per id for one table (ids without a revision row map to 0). */
export async function currentRevisions(s: RequestServices, table: RevisionTable, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, 0);
  if (ids.length === 0) return out;
  const res = await s.service.from('content_revisions').select('entity_id, revision').eq('entity_table', table).in('entity_id', [...ids]);
  for (const r of res.data ?? []) if ((out.get(r.entity_id) ?? 0) < r.revision) out.set(r.entity_id, r.revision);
  return out;
}

export async function recordRevision(s: RequestServices, table: RevisionTable, id: string, diff: Record<string, unknown>, note?: string | null): Promise<number> {
  const { principal } = s.requireUser();
  const next = (await currentRevision(s, table, id)) + 1;
  const res = await s.service.from('content_revisions').insert({ entity_table: table, entity_id: id, revision: next, diff: diff as never, editor_id: principal.userId, note: note ?? null });
  if (res.error) throw problem.internal(`Could not record the content revision: ${res.error.message}`);
  return next;
}

export async function recordPublicationEvent(s: RequestServices, table: ContentTable, id: string, revision: number, from: ContentState | null, to: ContentState, reason?: string | null): Promise<void> {
  const { principal } = s.requireUser();
  const res = await s.service.from('publication_events').insert({ entity_table: table, entity_id: id, revision, from_state: from, to_state: to, actor_id: principal.userId, reason: reason ?? null });
  if (res.error) throw problem.internal(`Could not record the publication event: ${res.error.message}`);
}

/** Validate and apply a state change on a content row (visual assets map onto review_status). */
export async function transitionContent(s: RequestServices, content: ContentRow, to: ContentState, extra: Record<string, unknown> = {}): Promise<void> {
  const from = stateOf(content);
  if (from !== to && !canTransitionContent(from, to)) throw problem.precondition(`Content in state "${from}" cannot move to "${to}"`, { from, to });
  const patch: Record<string, unknown> = content.table === 'visual_assets' ? { review_status: to === 'approved' || to === 'published' ? 'approved' : to === 'rejected' ? 'rejected' : to === 'review_needed' ? 'review_needed' : 'draft', ...extra } : { state: to, ...extra };
  const res = await s.service.from(content.table).update(patch as never).eq('id', content.row.id);
  if (res.error) throw problem.internal(`Could not update ${content.table}: ${res.error.message}`);
}

export const titleOf = (translations: unknown): string | null => {
  const t = (translations ?? {}) as Record<string, string>;
  return t.en ?? Object.values(t).find((v) => typeof v === 'string' && v.trim()) ?? null;
};
