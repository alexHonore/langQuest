import { describe, expect, it } from 'vitest';
import { planDecision } from './decisions';

describe('planDecision', () => {
  it('approves and rejects content that is in review', () => {
    expect(planDecision('review_needed', 'approve')).toEqual({ ok: true, from: 'review_needed', to: 'approved', noop: false });
    expect(planDecision('review_needed', 'reject')).toEqual({ ok: true, from: 'review_needed', to: 'rejected', noop: false });
  });

  it('refuses to touch published content', () => {
    const plan = planDecision('published', 'reject');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe('precondition_failed');
  });

  it('refuses illegal §7.6 transitions instead of forcing the state', () => {
    // imported_draft → approved is not in CONTENT_TRANSITIONS: drafts must be reviewed first.
    const plan = planDecision('imported_draft', 'approve');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('cannot move');
    // rejected → review_needed is allowed (send back to review).
    expect(planDecision('rejected', 'request_review')).toMatchObject({ ok: true, to: 'review_needed' });
    // rejected → approved is not allowed: it must go through review again.
    expect(planDecision('rejected', 'approve').ok).toBe(false);
  });

  it('treats a repeated decision as a no-op rather than a failure', () => {
    expect(planDecision('approved', 'approve')).toEqual({ ok: true, from: 'approved', to: 'approved', noop: true });
  });

  it('rejects unknown states', () => {
    const plan = planDecision('mystery', 'approve');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe('validation_failed');
  });
});
