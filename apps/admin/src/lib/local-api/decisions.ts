/**
 * Editorial decision planning for the local `content/:id/decision` adapter route.
 *
 * The API owns publishing (§7.6 gate, manifests, audit log); approve / reject have no contract
 * route yet (cross-package gap), so the admin applies them itself. To keep the state machine
 * honest the transition is validated with the same `canTransitionContent` table the API uses,
 * and the write is mirrored in `publication_events` (append-only, actor = the editor) next to
 * the `content_revisions` row. `request_review` is not planned here: it is forwarded to the API
 * (`adminContentRequestReview`) by the route.
 */
import { ContentStateSchema, type ContentState } from '@langquest/contracts';
import { canTransitionContent } from '@langquest/media/rights';

export type EditorialDecision = 'approve' | 'reject' | 'request_review';

export const DECISION_TARGET_STATE: Readonly<Record<EditorialDecision, ContentState>> = {
  approve: 'approved',
  reject: 'rejected',
  request_review: 'review_needed',
};

export type DecisionPlan = { ok: true; from: ContentState; to: ContentState; noop: boolean } | { ok: false; code: 'validation_failed' | 'precondition_failed'; message: string; from: string | null; to: ContentState };

/**
 * Decide whether `decision` may be applied to content currently in `currentState`.
 * Published content is never changed here (unpublish goes through the API with takedown
 * propagation), and every other move must be a legal §7.6 transition.
 */
export function planDecision(currentState: string | null | undefined, decision: EditorialDecision): DecisionPlan {
  const to = DECISION_TARGET_STATE[decision];
  const parsed = ContentStateSchema.safeParse(currentState);
  if (!parsed.success) return { ok: false, code: 'validation_failed', message: `Content has an unknown state "${String(currentState)}"`, from: currentState ?? null, to };
  const from = parsed.data;
  if (from === 'published') return { ok: false, code: 'precondition_failed', message: 'Unpublish before changing the editorial decision.', from, to };
  if (from === to) return { ok: true, from, to, noop: true };
  if (!canTransitionContent(from, to)) return { ok: false, code: 'precondition_failed', message: `Content in state "${from}" cannot move to "${to}"`, from, to };
  return { ok: true, from, to, noop: false };
}
