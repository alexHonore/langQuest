'use client';
import Link from 'next/link';
import { useState } from 'react';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatDateTime, formatUsd, shortId } from '@/src/lib/format';
import { DataTable, type Column } from '@/src/components/data-table';
import { FilterBar, FilterSearch, FilterSelect, UrlPager, useUrlFilters } from '@/src/components/filters';
import { JobBadge } from '@/src/components/badges';
import { Button, Mono, Notice } from '@/src/components/ui';
import { SECTION_PATHS } from '@/src/lib/auth/roles';
import { Dialog } from '@/src/components/dialog';

export interface JobRow {
  id: string;
  job_type: string;
  parent_asset_id: string | null;
  parent_entity_table: string | null;
  parent_entity_id: string | null;
  state: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  progress_pct: number;
  provider: string | null;
  params: unknown;
  cost_estimate_usd: number | null;
  cost_actual_usd: number | null;
  failure_code: string | null;
  failure_message: string | null;
  output_asset_ids: string[];
  output: unknown;
  idempotency_key: string;
  requested_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  locked_by: string | null;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export function JobsScreen({ rows, page, hasNext, states, types, canRetry }: { rows: JobRow[]; page: number; hasNext: boolean; states: string[]; types: string[]; canRetry: boolean }) {
  const { t, locale } = useI18n();
  const { set } = useUrlFilters();
  const [detail, setDetail] = useState<JobRow | null>(null);
  const retry = useAction(async (id: string) => browserApi().call('adminProcessingJobRetry', { params: { id }, body: {} }), { successMessage: (r) => t('admin.ui.jbRetried', { jobId: r.jobId.slice(0, 8) }) });

  const columns: Column<JobRow>[] = [
    { key: 'id', header: t('admin.ui.id'), render: (j) => <button type="button" className="font-mono text-xs text-accent-text hover:underline" onClick={() => setDetail(j)}>{shortId(j.id)}</button> },
    { key: 'type', header: t('admin.jobs.type'), render: (j) => j.job_type },
    { key: 'state', header: t('admin.ui.status'), render: (j) => <JobBadge state={j.state} /> },
    {
      key: 'progress',
      header: t('admin.ui.jbProgress'),
      render: (j) => (
        <div className="w-28">
          <div className="h-1.5 w-full overflow-hidden rounded bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.progress_pct}>
            <div className="h-full bg-accent" style={{ width: `${j.progress_pct}%` }} />
          </div>
          <span className="text-[11px] text-fg-muted">
            {j.progress_pct}% · {t('admin.jobs.attempts', { attempt: j.attempts, max: j.max_attempts })}
          </span>
        </div>
      ),
    },
    { key: 'parent', header: t('admin.ui.jbParent'), render: (j) => (j.parent_asset_id ? <Link href={`/library/${j.parent_asset_id}`} className="font-mono text-xs text-accent-text hover:underline">{shortId(j.parent_asset_id)}</Link> : j.parent_entity_table ? <span className="text-xs">{j.parent_entity_table}:{shortId(j.parent_entity_id)}</span> : '—') },
    { key: 'cost', header: t('admin.analytics.cost'), className: 'tabular-nums', render: (j) => formatUsd(j.cost_actual_usd ?? j.cost_estimate_usd, locale) },
    { key: 'error', header: t('admin.ui.jbErrors'), render: (j) => (j.failure_code ? <span className="text-xs text-error" title={j.failure_message ?? ''}>{j.failure_code}</span> : '—') },
    { key: 'created', header: t('admin.ui.created'), className: 'whitespace-nowrap text-fg-muted', render: (j) => formatDateTime(j.created_at, locale) },
    {
      key: 'actions',
      header: t('admin.ui.actions'),
      render: (j) =>
        canRetry && (j.state === 'failed' || j.state === 'review_needed') ? (
          <Button size="sm" loading={retry.busy} onClick={() => void retry.run(j.id)}>
            {t('admin.jobs.retry')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <FilterBar onClear={() => set({ state: null, type: null, q: null, assetId: null })}>
        <FilterSelect name="state" label={t('admin.ui.jbStateFilter')} options={states.map((s) => ({ value: s, label: t(`admin.jobs.state.${s}`) }))} />
        <FilterSelect name="type" label={t('admin.ui.jbTypeFilter')} options={types.map((s) => ({ value: s, label: s }))} />
        <FilterSearch name="q" label={t('admin.ui.id')} />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(j) => j.id}
        empty={t('admin.ui.jbEmptyHint')}
        emptyAction={
          <Link href={SECTION_PATHS.uploads} className="text-sm text-accent-text hover:underline">
            {t('admin.sections.uploads')} →
          </Link>
        }
        caption={t('admin.jobs.title')}
        dense
      />
      <UrlPager page={page} hasNext={hasNext} />
      <Dialog open={detail !== null} onClose={() => setDetail(null)} wide title={detail ? `${detail.job_type} · ${shortId(detail.id)}` : ''}>
        {detail ? (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <JobBadge state={detail.state} />
              <span>{t('admin.jobs.attempts', { attempt: detail.attempts, max: detail.max_attempts })}</span>
              <span className="text-fg-muted">priority {detail.priority}</span>
              {detail.provider ? <span className="text-fg-muted">{detail.provider}</span> : null}
              {detail.locked_by ? <span className="text-fg-muted">worker {detail.locked_by}</span> : null}
            </div>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-fg-muted">{t('admin.ui.id')}</dt>
              <dd>
                <Mono>{detail.id}</Mono>
              </dd>
              <dt className="text-fg-muted">idempotency</dt>
              <dd>
                <Mono>{detail.idempotency_key}</Mono>
              </dd>
              <dt className="text-fg-muted">{t('admin.ui.jbRequestedBy')}</dt>
              <dd>{detail.requested_by ? shortId(detail.requested_by) : '—'}</dd>
              <dt className="text-fg-muted">{t('admin.jobs.startedAt', { date: detail.started_at ? new Date(detail.started_at) : new Date(detail.created_at) })}</dt>
              <dd>{detail.finished_at ? formatDateTime(detail.finished_at, locale) : '—'}</dd>
              <dt className="text-fg-muted">{t('admin.analytics.cost')}</dt>
              <dd>
                {formatUsd(detail.cost_actual_usd, locale)} (est. {formatUsd(detail.cost_estimate_usd, locale)})
              </dd>
            </dl>
            {detail.failure_code ? (
              <Notice tone="error">
                {detail.failure_code}: {detail.failure_message}
              </Notice>
            ) : null}
            <details>
              <summary className="cursor-pointer text-xs font-medium">params</summary>
              <pre className="max-h-48 overflow-auto rounded bg-surface-muted p-2 text-[11px]">{JSON.stringify(detail.params, null, 2)}</pre>
            </details>
            <details open={Boolean(detail.output)}>
              <summary className="cursor-pointer text-xs font-medium">{t('admin.ui.jbOutput')}</summary>
              <pre className="max-h-48 overflow-auto rounded bg-surface-muted p-2 text-[11px]">{JSON.stringify(detail.output, null, 2) ?? '—'}</pre>
              {detail.output_asset_ids.length ? (
                <p className="text-xs">
                  assets:{' '}
                  {detail.output_asset_ids.map((id) => (
                    <Link key={id} href={`/library/${id}`} className="me-1 font-mono text-accent-text hover:underline">
                      {shortId(id)}
                    </Link>
                  ))}
                </p>
              ) : null}
            </details>
            <div className="flex flex-wrap items-center gap-2">
              {canRetry && (detail.state === 'failed' || detail.state === 'review_needed') ? (
                <Button loading={retry.busy} onClick={() => void retry.run(detail.id).then(() => setDetail(null))}>
                  {t('admin.jobs.retry')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
