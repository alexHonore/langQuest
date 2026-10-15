import Link from 'next/link';
import { TRANSCRIPT_STATUS_VALUES } from '@langquest/contracts';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listTranscriptLessons } from '@/src/lib/queries/transcripts';
import { parsePage } from '@/src/lib/queries';
import { formatDateTime, formatDurationMs, pickLocalized, shortId } from '@/src/lib/format';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { Badge, StatusBadge } from '@/src/components/badges';
import { TranscriptsFilters } from './transcripts-filters';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Transcripts' };

export default async function TranscriptsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSection('transcripts');
  const sp = await searchParams;
  const { t, locale } = await serverTranslator();
  const page = parsePage(sp.page);
  const rows = await listTranscriptLessons(page, sp.status || undefined);
  return (
    <div>
      <PageHeader title={t('admin.transcripts.title')} description={t('admin.ui.trSelectLesson')} />
      <TranscriptsFilters statuses={[...TRANSCRIPT_STATUS_VALUES]} page={page} hasNext={rows.ok ? rows.data.hasNext : false} />
      {!rows.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={rows.error} /> : null}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('admin.ui.upLesson')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.targetVariety')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.lsSpoken')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.duration')}</th>
              <th className="px-3 py-2 text-start">{t('admin.transcripts.title')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.status')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.ok && rows.data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-fg-muted">
                  {t('admin.ui.emptyFiltered')}
                </td>
              </tr>
            ) : null}
            {rows.ok
              ? rows.data.rows.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={`/transcripts/${l.id}`} className="font-medium text-accent hover:underline">
                        {pickLocalized(l.title_translations, locale) || shortId(l.id)}
                      </Link>
                      <div className="text-xs text-fg-muted">
                        {pickLocalized(l.chapter?.collection?.title_translations, locale)} › {pickLocalized(l.chapter?.title_translations, locale)}
                      </div>
                    </td>
                    <td className="px-3 py-2">{l.target_variety_id ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{l.spoken_language_codes.join(', ') || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{formatDurationMs(l.listen_length_ms)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={l.transcript_status === 'reviewed' ? 'success' : l.transcript_status === 'failed' ? 'error' : l.transcript_status === 'none' ? 'neutral' : 'info'}>{t(`admin.transcripts.status.${l.transcript_status}`)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge state={l.state} />
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{formatDateTime(l.updated_at, locale)}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
