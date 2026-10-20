'use client';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { Button } from '@/src/components/ui';

/**
 * Approve / reject a lesson's quality review.
 *
 * - A lesson in `review_needed` is decided through the decision route (`adminContentDecision`, reviewers and editors):
 *   it moves the editorial state AND records the lesson's `quality_review_status` in one write, one revision and one
 *   audit row, so a language reviewer never needs the editor-only lesson PATCH.
 * - Any other lesson in the queue only needs its quality status set, which is the editor-only lesson PATCH
 *   (`adminAudioLessonPatch`); those controls are shown to content editors only (visible means usable).
 */
export function LessonReviewActions({ lessonId, state, canEdit }: { lessonId: string; state: string; canEdit: boolean }) {
  const { t } = useI18n();
  const decide = state === 'review_needed';
  const review = useAction(
    async (decision: 'approved' | 'rejected') => {
      if (decide) await browserApi().call('adminContentDecision', { params: { id: lessonId }, body: { entityTable: 'audio_lessons', decision: decision === 'approved' ? 'approve' : 'reject' } });
      else await browserApi().call('adminAudioLessonPatch', { params: { id: lessonId }, body: { qualityReviewStatus: decision } });
      return decision;
    },
    { successMessage: t('admin.ui.saved') },
  );
  if (!decide && !canEdit) return null;
  return (
    <span className="flex gap-1">
      <Button size="sm" loading={review.busy} onClick={() => void review.run('approved')}>
        {t('admin.ui.qrApproveLesson')}
      </Button>
      <Button size="sm" variant="danger" loading={review.busy} onClick={() => void review.run('rejected')}>
        {t('admin.ui.qrRejectLesson')}
      </Button>
    </span>
  );
}
