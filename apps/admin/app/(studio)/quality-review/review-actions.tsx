'use client';
import { browserApi } from '@/src/lib/api-browser';
import { localCall } from '@/src/lib/local-api/client';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { Button } from '@/src/components/ui';

/** Approve / reject a lesson's quality review (API patch) and move the editorial state (local decision route). */
export function LessonReviewActions({ lessonId, state }: { lessonId: string; state: string }) {
  const { t } = useI18n();
  const review = useAction(
    async (decision: 'approved' | 'rejected') => {
      await browserApi().call('adminAudioLessonPatch', { params: { id: lessonId }, body: { qualityReviewStatus: decision } });
      if (state === 'review_needed') await localCall(`/api/admin/content/${lessonId}/decision`, { method: 'POST', body: { entityTable: 'audio_lessons', decision: decision === 'approved' ? 'approve' : 'reject' } });
      return decision;
    },
    { successMessage: t('admin.ui.saved') },
  );
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
