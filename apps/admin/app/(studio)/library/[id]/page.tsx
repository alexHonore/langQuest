import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { getAsset, listAssetJobs, type LibraryAssetRow } from '@/src/lib/queries/library';
import { formatBytes, formatDateTime, formatDurationMs, pickLocalized, shortId } from '@/src/lib/format';
import { Card, Mono, PageHeader } from '@/src/components/ui';
import { Badge, JobBadge, StatusBadge } from '@/src/components/badges';
import { AssetPreview } from '@/src/components/asset-preview';

export const dynamic = 'force-dynamic';

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection('library');
  const { id } = await params;
  const { t, locale } = await serverTranslator();
  const [asset, jobs] = await Promise.all([getAsset(id), listAssetJobs(id)]);
  if (!asset.ok || !asset.data) notFound();
  const a = asset.data as unknown as LibraryAssetRow;
  const lessons = a.lessonLinks.map((l) => l.lesson).filter((l): l is NonNullable<typeof l> => Boolean(l));
  return (
    <div className="space-y-4">
      <PageHeader title={a.legacy_filename ?? a.storage_key.split('/').pop()} description={a.legacy_path ?? undefined} actions={<StatusBadge state={a.state} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('admin.library.preview')}>
          <AssetPreview assetId={a.id} kind={a.kind} mimeType={a.mime_type} title={a.legacy_filename ?? undefined} />
        </Card>
        <Card title={t('admin.ui.id')}>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-muted">{t('admin.ui.id')}</dt>
            <dd>
              <Mono>{a.id}</Mono>
            </dd>
            <dt className="text-fg-muted">{t('admin.library.contentHash')}</dt>
            <dd>
              <Mono>{a.checksum_sha256}</Mono>
            </dd>
            <dt className="text-fg-muted">storage key</dt>
            <dd>
              <Mono>{a.storage_key}</Mono>
            </dd>
            <dt className="text-fg-muted">{t('admin.library.kind')}</dt>
            <dd>
              {a.kind} · {a.mime_type} {a.source_asset_id ? <Badge tone="neutral">{t('admin.library.derived')} · {a.derivation}</Badge> : <Badge tone="neutral">{t('admin.library.original')}</Badge>}
            </dd>
            <dt className="text-fg-muted">{t('admin.ui.size')}</dt>
            <dd>{formatBytes(a.byte_length, locale)}</dd>
            <dt className="text-fg-muted">{t('admin.library.duration')}</dt>
            <dd>{formatDurationMs(a.duration_ms)}</dd>
            <dt className="text-fg-muted">visibility / disposition</dt>
            <dd>
              {a.visibility} / {a.disposition}
            </dd>
            <dt className="text-fg-muted">{t('admin.library.rightsState')}</dt>
            <dd>{a.rights ? <Badge tone={a.rights.verified ? 'success' : 'warning'}>{a.rights.license_id} · {a.rights.verified ? t('admin.ui.libRightsVerified') : t('admin.ui.libRightsUnverified')}</Badge> : <Badge tone="warning">{t('admin.upload.rightsRequired')}</Badge>}</dd>
            <dt className="text-fg-muted">{t('admin.ui.created')}</dt>
            <dd>{formatDateTime(a.created_at, locale)}</dd>
          </dl>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('admin.sections.lessons')}>
          {lessons.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('admin.ui.lsNoAssets')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {lessons.map((l) => (
                <li key={l.id}>
                  <Link href={`/lessons/${l.id}`} className="text-accent hover:underline">
                    {pickLocalized(l.title_translations, locale) || shortId(l.id)}
                  </Link>
                  <span className="ms-2 text-xs text-fg-muted">{t('admin.transcripts.title')}: {t(`admin.transcripts.status.${l.transcript_status}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('admin.jobs.title')}>
          {!jobs.ok || jobs.data.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('admin.jobs.noJobs')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {jobs.data.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/jobs?q=${j.id}`} className="font-mono text-xs text-accent">
                    {shortId(j.id)}
                  </Link>
                  <span>{j.job_type}</span>
                  <JobBadge state={j.state} />
                  <span className="text-xs text-fg-muted">{j.progress_pct}%</span>
                  {j.failure_code ? <span className="text-xs text-error">{j.failure_code}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
