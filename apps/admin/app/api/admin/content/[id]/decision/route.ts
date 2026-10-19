import { z } from 'zod';
import { serverApi } from '@/src/lib/api-server';
import { planDecision } from '@/src/lib/local-api/decisions';
import { forwardApiError } from '@/src/lib/local-api/forward';
import { adminRoute, LocalApiError, recordRevision, throwDb } from '@/src/lib/local-api/handler';

const Body = z.object({
  entityTable: z.enum(['missions', 'expressions', 'audio_lessons', 'characters']),
  decision: z.enum(['approve', 'reject', 'request_review']),
  note: z.string().max(1000).optional(),
});

/**
 * POST /api/admin/content/:id/decision — editorial approve / reject / send-back for drafts.
 *
 * - `request_review` is forwarded to the API (`adminContentRequestReview`): it owns the review
 *   workflow, the translation-review event and the audit log.
 * - `approve` / `reject` have no contract route yet (`adminContent*` covers generate / request-review /
 *   publish / unpublish only; cross-package gap). They are applied here
 *   under the editor RLS policy, but only along a legal §7.6 transition (`canTransitionContent`),
 *   never on published content, and the move is recorded in `content_revisions` and
 *   `publication_events` (append-only, actor = the signed-in editor). `audit_logs` has no JWT
 *   insert path, so that row is missing until the API serves the decision — the response says so.
 */
export const POST = adminRoute('qualityReview', Body, async ({ supabase, session, params, body }) => {
  const id = params.id!;

  if (body.decision === 'request_review') {
    try {
      const res = await serverApi(session).call('adminContentRequestReview', { params: { id }, body: { note: body.note } });
      return { id: res.contentId, state: res.state, revision: null, via: 'api' as const, audited: true };
    } catch (err) {
      forwardApiError(err, 'review requests');
    }
  }

  const { data: current, error: readError } = await supabase.from(body.entityTable).select('id, state').eq('id', id).maybeSingle();
  if (readError) throwDb(readError, body.entityTable);
  if (!current) throw new LocalApiError('not_found', 'Content not found');
  const plan = planDecision(current.state, body.decision);
  if (!plan.ok) throw new LocalApiError(plan.code, plan.message, { from: plan.from, to: plan.to });

  const patch: Record<string, unknown> = { state: plan.to };
  if (body.entityTable === 'expressions') {
    patch.reviewed = body.decision === 'approve';
    patch.reviewer_id = session.userId;
  }
  if (!plan.noop || body.entityTable === 'expressions') {
    const { error } = await supabase.from(body.entityTable).update(patch as never).eq('id', id);
    if (error) throwDb(error, `${body.entityTable}.decision`);
  }
  const rev = await recordRevision(supabase, session, body.entityTable, id, { state: { from: plan.from, to: plan.to } }, null, body.note ?? body.decision);
  let publicationEventRecorded = false;
  if (!plan.noop) {
    const { error: eventError } = await supabase
      .from('publication_events')
      .insert({ entity_table: body.entityTable, entity_id: id, revision: rev.revision, from_state: plan.from, to_state: plan.to, actor_id: session.userId, reason: body.note ?? body.decision });
    // Reviewers without the content-editor insert policy still get the revision; the response is honest about the gap.
    publicationEventRecorded = !eventError;
  }
  return { id, state: plan.to, revision: rev.revision, via: 'local' as const, audited: false, publicationEventRecorded };
});
