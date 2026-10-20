import Link from 'next/link';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listReviewQueue } from '@/src/lib/queries/ops';
import { formatDateTime, pickLocalized, shortId } from '@/src/lib/format';
import { Card, EmptyState, PageHeader } from '@/src/components/ui';
import { Melo } from '@/src/components/brand';
import { SECTION_PATHS, canEditContent } from '@/src/lib/auth/roles';
import { Badge, StatusBadge } from '@/src/components/badges';
import { LessonReviewActions } from './review-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quality review' };

export default async function QualityReviewPage() {
  const session = await requireSection('qualityReview');
  // Lessons outside `review_needed` only need a quality status, which is the editor-only lesson PATCH.
  const canEdit = canEditContent(session.roles);
  const { t, locale } = await serverTranslator();
  const { lessons, transcripts, translations, visual } = await listReviewQueue();
  const total = (lessons.ok ? lessons.data.length : 0) + (transcripts.ok ? transcripts.data.length : 0) + (translations.ok ? translations.data.length : 0) + (visual.ok ? visual.data.length : 0);
  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.review.title')} description={t('admin.dashboard.pendingReview', { count: total })} />
      {total === 0 ? (
        <EmptyState
          art={<Melo state="success" size={72} />}
          title={t('admin.ui.qrClear')}
          action={
            <Link href={SECTION_PATHS.library} className="text-sm text-accent-text hover:underline">
              {t('admin.sections.library')} →
            </Link>
          }
        />
      ) : null}
      {lessons.ok && lessons.data.length > 0 ? (
      <Card title={t('admin.ui.qrLessons')}>
        <ul className="divide-y divide-border">
          {lessons.ok
            ? lessons.data.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link href={`/lessons/${l.id}`} className="font-medium text-accent-text hover:underline">
                    {pickLocalized(l.title_translations, locale) || shortId(l.id)}
                  </Link>
                  <span className="text-xs text-fg-muted">
                    {l.target_variety_id ?? '—'} / {l.instruction_language_code ?? '—'} · {t(`admin.transcripts.status.${l.transcript_status}`)}
                  </span>
                  <StatusBadge state={l.state} />
                  <Badge tone={l.quality_review_status === 'approved' ? 'success' : l.quality_review_status === 'rejected' ? 'error' : 'warning'}>{l.quality_review_status}</Badge>
                  <span className="ms-auto">
                    <LessonReviewActions lessonId={l.id} state={l.state} canEdit={canEdit} />
                  </span>
                </li>
              ))
            : null}
        </ul>
      </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {transcripts.ok && transcripts.data.length > 0 ? (
        <Card title={t('admin.ui.qrTranscripts')}>
          <ul className="space-y-1 text-sm">
            {transcripts.ok
              ? transcripts.data.map((tr) => (
                  <li key={tr.id}>
                    <Link href={`/transcripts/${tr.lesson_id}?revision=${tr.revision}`} className="text-accent-text hover:underline">
                      {pickLocalized(tr.lesson?.title_translations, locale) || shortId(tr.lesson_id)} · v{tr.revision}
                    </Link>
                    <span className="ms-1 text-xs text-fg-muted">{tr.primary_language_code} · {formatDateTime(tr.updated_at, locale)}</span>
                  </li>
                ))
              : null}
          </ul>
        </Card>
        ) : null}
        {translations.ok && translations.data.length > 0 ? (
        <Card title={t('admin.ui.qrTranslations')}>
          <ul className="space-y-1 text-sm">
            {translations.ok
              ? translations.data.slice(0, 50).map((tr) => (
                  <li key={tr.id} className="flex items-center gap-2">
                    <Badge>{tr.language_code}</Badge>
                    <span className="truncate">{tr.text}</span>
                  </li>
                ))
              : null}
          </ul>
        </Card>
        ) : null}
        {visual.ok && visual.data.length > 0 ? (
        <Card title={t('admin.ui.qrVisual')}>
          <ul className="space-y-1 text-sm">
            {visual.ok
              ? visual.data.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <Link href="/visual-assets" className="font-mono text-xs text-accent-text hover:underline">
                      {shortId(v.id)}
                    </Link>
                    <span>{v.type}</span>
                    <Badge>{v.origin}</Badge>
                    <span className="text-xs text-fg-muted">{v.alt_text_key}</span>
                  </li>
                ))
              : null}
          </ul>
        </Card>
        ) : null}
      </div>
    </div>
  );
}
