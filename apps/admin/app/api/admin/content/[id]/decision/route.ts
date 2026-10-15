import { z } from 'zod';
import { adminRoute, LocalApiError, recordRevision, throwDb } from '@/src/lib/local-api/handler';

const Body = z.object({
  entityTable: z.enum(['missions', 'expressions', 'audio_lessons', 'characters']),
  decision: z.enum(['approve', 'reject', 'request_review']),
  note: z.string().max(1000).optional(),
});

/**
 * POST /api/admin/content/:id/decision — editorial approve / reject / send-back for drafts.
 * Approval never publishes (publishing has its own gate through the API); it moves
 * `review_needed → approved` (or `rejected`) under the editor RLS policy and records a revision.
 */
export const POST = adminRoute('qualityReview', Body, async ({ supabase, session, params, body }) => {
  const id = params.id!;
  const nextState = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : 'review_needed';
  const { data: current, error: readError } = await supabase.from(body.entityTable).select('id, state').eq('id', id).maybeSingle();
  if (readError) throwDb(readError, body.entityTable);
  if (!current) throw new LocalApiError('not_found', 'Content not found');
  if (current.state === 'published') throw new LocalApiError('precondition_failed', 'Unpublish before changing the editorial decision.');
  const patch: Record<string, unknown> = { state: nextState };
  if (body.entityTable === 'expressions') {
    patch.reviewed = body.decision === 'approve';
    patch.reviewer_id = session.userId;
  }
  const { error } = await supabase.from(body.entityTable).update(patch as never).eq('id', id);
  if (error) throwDb(error, `${body.entityTable}.decision`);
  const rev = await recordRevision(supabase, session, body.entityTable, id, { state: { from: current.state, to: nextState } }, null, body.note ?? body.decision);
  return { id, state: nextState, revision: rev.revision };
});
