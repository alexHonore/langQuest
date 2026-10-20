import Link from 'next/link';
import { ART_STYLE_VERSION } from '@art/manifest';
import { CONTENT_STATE_VALUES, JOB_STATE_VALUES } from '@langquest/contracts';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { loadDashboard } from '@/src/lib/queries/dashboard';
import { formatBytes, formatDateTime, formatUsd } from '@/src/lib/format';
import { Card, Notice, PageHeader, Stat } from '@/src/components/ui';
import { JobBadge, StatusBadge, CoverageBadge, Badge } from '@/src/components/badges';
import { Melo } from '@/src/components/brand';
import { SECTION_PATHS } from '@/src/lib/auth/roles';

export const dynamic = 'force-dynamic';

/**
 * Dashboard. Text budget (owner decision 2026-10-19): one heading, numbers, one primary link per
 * card; every explanation sits behind ⓘ. Cards that the role cannot use are not rendered
 * (CONVENTIONS §8), never greyed out.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requireSection('dashboard');
  const { denied } = await searchParams;
  const { t, locale } = await serverTranslator();
  const data = await loadDashboard();
  const more = (href: string, label: string) => (
    <Link href={href} className="mt-3 inline-block text-xs text-accent-text hover:underline">
      {label} →
    </Link>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.sections.dashboard')} info={t('admin.ui.dashHint')} />
      {denied ? <Notice tone="warning">{t('admin.ui.denied', { section: t(`admin.sections.${denied}`) })}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('admin.ui.dashPending')} value={data.jobs.pending} />
        <Stat label={t('admin.ui.dashRunning')} value={data.jobs.running} tone={data.jobs.running > 0 ? 'success' : 'default'} />
        <Stat label={t('admin.ui.dashFailed')} value={data.jobs.failed} tone={data.jobs.failed > 0 ? 'error' : 'default'} />
        <Stat label={t('admin.ui.dashReviewNeeded')} value={data.pendingReviews.total} tone={data.pendingReviews.total > 0 ? 'warning' : 'default'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {data.costToday.error === 'forbidden' ? null : (
          <Card title={t('admin.ui.dashCostToday')} info={t('admin.ui.dashCostHint')}>
            {data.costToday.ok ? (
              <div>
                <div className="text-2xl font-semibold tabular-nums">{formatUsd(data.costToday.usd, locale)}</div>
                <p className="mt-1 text-xs text-fg-muted">
                  {t('admin.ui.dashRequestsToday', { count: data.costToday.requests })}
                  {data.costToday.unpriced > 0 ? ` · ${data.costToday.unpriced} unpriced` : ''}
                </p>
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
          {more(SECTION_PATHS.jobQueue, t('admin.sections.jobQueue'))}
        </Card>

        <Card title={t('admin.review.queue')}>
          <ul className="space-y-1 text-sm">
            {(
              [
                ['qrLessons', data.pendingReviews.lessons],
                ['qrTranscripts', data.pendingReviews.transcripts],
                ['qrTranslations', data.pendingReviews.translations],
                ['qrVisual', data.pendingReviews.visual],
              ] as const
            ).map(([key, n]) => (
              <li key={key} className="flex justify-between">
                <span>{t(`admin.ui.${key}`)}</span>
                <span className="tabular-nums">{n}</span>
              </li>
            ))}
            {data.rightsUnverified > 0 ? <li className="border-t border-border pt-1 text-fg-muted">{t('admin.dashboard.rightsUnverified', { count: data.rightsUnverified })}</li> : null}
          </ul>
          {more(SECTION_PATHS.qualityReview, t('admin.sections.qualityReview'))}
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
          {more(SECTION_PATHS.uploads, t('admin.sections.uploads'))}
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
                <Link href={SECTION_PATHS.uploads} className="text-accent-text hover:underline">
                  {t('admin.sections.uploads')} →
                </Link>
              </li>
            ) : null}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('admin.ui.dashCoverage')} info={t('admin.ui.dashCoverageInfo')} className="lg:col-span-2">
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
          {more(SECTION_PATHS.languages, t('admin.sections.languages'))}
        </Card>
        <Card title={t('admin.ui.dashQuickActions')} info={t('admin.ui.dashStyle', { version: ART_STYLE_VERSION })}>
          <div className="flex items-start gap-3">
            {/* Melo "welcome", tinted by the active course (chameleon) — the only art on the page. */}
            <Melo state="welcome" size={96} />
            <div className="space-y-1 text-sm">
              <Link href={SECTION_PATHS.uploads} className="block text-accent-text hover:underline">
                {t('admin.upload.title')}
              </Link>
              <Link href={SECTION_PATHS.contentFactory} className="block text-accent-text hover:underline">
                {t('admin.contentFactory.generate')}
              </Link>
              <Link href={SECTION_PATHS.rights} className="block text-accent-text hover:underline">
                {t('admin.rights.report')}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
