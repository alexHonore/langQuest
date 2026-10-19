import Link from 'next/link';
import { mascotSvgString } from '@art/mascot';
import { ART_STYLE_VERSION } from '@art/manifest';
import { CONTENT_STATE_VALUES, JOB_STATE_VALUES } from '@langquest/contracts';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { loadDashboard } from '@/src/lib/queries/dashboard';
import { formatBytes, formatDateTime, formatUsd } from '@/src/lib/format';
import { Card, Notice, PageHeader, Stat } from '@/src/components/ui';
import { JobBadge, StatusBadge, CoverageBadge, Badge } from '@/src/components/badges';
import { SvgArt } from '@/src/components/asset-preview';
import { SECTION_PATHS } from '@/src/lib/auth/roles';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requireSection('dashboard');
  const { denied } = await searchParams;
  const { t, locale } = await serverTranslator();
  const data = await loadDashboard();
  const mascot = mascotSvgString('neutral', { size: 96 });

  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.sections.dashboard')} description={t('admin.dashboard.coverageByPair')} />
      {denied ? <Notice tone="warning">{t('admin.ui.denied', { section: t(`admin.sections.${denied}`) })}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.ui.dashPending')} value={data.jobs.pending} />
        <Stat label={t('admin.ui.dashRunning')} value={data.jobs.running} tone={data.jobs.running > 0 ? 'success' : 'default'} />
        <Stat label={t('admin.ui.dashFailed')} value={data.jobs.failed} tone={data.jobs.failed > 0 ? 'error' : 'default'} hint={t('admin.dashboard.failedJobs', { count: data.jobs.failed })} />
        <Stat label={t('admin.ui.dashReviewNeeded')} value={data.pendingReviews.total} tone={data.pendingReviews.total > 0 ? 'warning' : 'default'} hint={t('admin.dashboard.pendingReview', { count: data.pendingReviews.total })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Cost needs the admin role: without it the card is not rendered (CONVENTIONS §8), it is not a placeholder. */}
        {data.costToday.error === 'forbidden' ? null : (
        <Card title={t('admin.ui.dashCostToday')}>
          {data.costToday.ok ? (
            <div>
              <div className="text-2xl font-semibold tabular-nums">{formatUsd(data.costToday.usd, locale)}</div>
              <p className="mt-1 text-xs text-fg-muted">
                {t('admin.ui.dashRequestsToday', { count: data.costToday.requests })}
                {data.costToday.unpriced > 0 ? ` · ${data.costToday.unpriced} unpriced` : ''}
              </p>
              <p className="mt-2 text-xs text-fg-muted">{t('admin.ui.dashCostHint')}</p>
            </div>
          ) : (
            <Notice tone="error">{t('admin.ui.dashCostError', { reason: data.costToday.error ?? 'unknown' })}</Notice>
          )}
        </Card>
        )}

        <Card title={t('admin.ui.dashJobsHealth')}>
          <ul className="space-y-1 text-sm">
            {JOB_STATE_VALUES.map((s) => (
              <li key={s} className="flex items-center justify-between">
                <JobBadge state={s} />
                <span className="tabular-nums">{data.jobs[s]}</span>
              </li>
            ))}
          </ul>
          <Link href={SECTION_PATHS.jobQueue} className="mt-3 inline-block text-xs text-accent hover:underline">
            {t('admin.sections.jobQueue')} →
          </Link>
        </Card>

        <Card title={t('admin.review.queue')}>
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span>{t('admin.ui.qrLessons')}</span>
              <span className="tabular-nums">{data.pendingReviews.lessons}</span>
            </li>
            <li className="flex justify-between">
              <span>{t('admin.ui.qrTranscripts')}</span>
              <span className="tabular-nums">{data.pendingReviews.transcripts}</span>
            </li>
            <li className="flex justify-between">
              <span>{t('admin.ui.qrTranslations')}</span>
              <span className="tabular-nums">{data.pendingReviews.translations}</span>
            </li>
            <li className="flex justify-between">
              <span>{t('admin.ui.qrVisual')}</span>
              <span className="tabular-nums">{data.pendingReviews.visual}</span>
            </li>
            <li className="flex justify-between border-t border-border pt-1 text-fg-muted">
              <span>{t('admin.dashboard.rightsUnverified', { count: data.rightsUnverified })}</span>
            </li>
          </ul>
          <Link href={SECTION_PATHS.qualityReview} className="mt-3 inline-block text-xs text-accent hover:underline">
            {t('admin.sections.qualityReview')} →
          </Link>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('admin.ui.dashRecentUploads')} className="lg:col-span-2">
          {data.recentUploads.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('admin.ui.dashNoUploads')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-fg-muted">
                <tr>
                  <th className="text-start py-1">{t('admin.ui.filename')}</th>
                  <th className="text-start py-1">{t('admin.ui.status')}</th>
                  <th className="text-end py-1">{t('admin.ui.size')}</th>
                  <th className="text-end py-1">{t('admin.ui.created')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentUploads.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="py-1 truncate max-w-[18rem]" title={u.original_filename}>
                      {u.original_filename}
                    </td>
                    <td className="py-1">
                      <Badge tone={u.status === 'verified' ? 'success' : u.status === 'failed' || u.status === 'aborted' ? 'error' : 'info'}>{u.status}</Badge>
                      {u.failure_code ? <span className="ms-1 text-xs text-error">{u.failure_code}</span> : null}
                    </td>
                    <td className="py-1 text-end tabular-nums">{formatBytes(u.declared_byte_length, locale)}</td>
                    <td className="py-1 text-end text-fg-muted">{formatDateTime(u.created_at, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link href={SECTION_PATHS.uploads} className="mt-3 inline-block text-xs text-accent hover:underline">
            {t('admin.sections.uploads')} →
          </Link>
        </Card>

        <Card title={t('admin.ui.dashAssetsByState')}>
          <ul className="space-y-1 text-sm">
            {CONTENT_STATE_VALUES.filter((s) => data.assetsByState[s] > 0).map((s) => (
              <li key={s} className="flex items-center justify-between">
                <StatusBadge state={s} />
                <span className="tabular-nums">{data.assetsByState[s]}</span>
              </li>
            ))}
            {CONTENT_STATE_VALUES.every((s) => data.assetsByState[s] === 0) ? (
              <li className="text-fg-muted">
                {t('admin.ui.dashNoAssetsHint')}{' '}
                <Link href={SECTION_PATHS.uploads} className="text-accent hover:underline">
                  {t('admin.sections.uploads')} →
                </Link>
              </li>
            ) : null}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('admin.ui.dashCoverage')} className="lg:col-span-2">
          <p className="mb-2 text-xs text-fg-muted">{t('admin.ui.dashCoverageHint')}</p>
          {data.coverage.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('admin.ui.lgRowsMissing')}</p>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {data.coverage.map((c) => (
                <li key={c.status} className="flex items-center gap-2 text-sm">
                  <CoverageBadge status={c.status} />
                  <span className="tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={SECTION_PATHS.languages} className="mt-3 inline-block text-xs text-accent hover:underline">
            {t('admin.sections.languages')} →
          </Link>
        </Card>
        <Card title={t('admin.ui.dashQuickActions')}>
          <div className="flex items-start gap-3">
            <SvgArt svg={mascot} label={t('common.a11y.mascotImage', { state: 'neutral' })} className="w-24 shrink-0" />
            <div className="space-y-1 text-sm">
              <Link href={SECTION_PATHS.uploads} className="block text-accent hover:underline">
                {t('admin.upload.title')}
              </Link>
              <Link href={SECTION_PATHS.contentFactory} className="block text-accent hover:underline">
                {t('admin.contentFactory.generate')}
              </Link>
              <Link href={SECTION_PATHS.rights} className="block text-accent hover:underline">
                {t('admin.rights.report')}
              </Link>
              <p className="pt-2 text-xs text-fg-muted">{t('admin.ui.dashMascot', { version: ART_STYLE_VERSION })}</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
