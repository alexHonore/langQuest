import Link from 'next/link';
import { CONTENT_STATE_VALUES } from '@langquest/contracts';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listLessons } from '@/src/lib/queries/structure';
import { parsePage } from '@/src/lib/queries';
import { formatDateTime, pickLocalized, shortId } from '@/src/lib/format';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { StatusBadge } from '@/src/components/badges';
import { LessonsFilters } from './lessons-filters';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lessons' };

export default async function LessonsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSection('lessons');
  const sp = await searchParams;
  const { t, locale } = await serverTranslator();
  const page = parsePage(sp.page);
  const lessons = await listLessons(page, 50, { state: sp.state || undefined, q: sp.q || undefined, chapterId: sp.chapter || undefined });
  return (
    <div>
      <PageHeader title={t('admin.sections.lessons')} />
      <LessonsFilters states={[...CONTENT_STATE_VALUES]} page={page} hasNext={lessons.ok ? lessons.data.hasNext : false} />
      {!lessons.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={lessons.error} /> : null}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('admin.ui.title')}</th>
              <th className="px-3 py-2 text-start">{t('admin.sections.chapters')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.targetVariety')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.sourceLanguage')}</th>
              <th className="px-3 py-2 text-start">{t('admin.transcripts.title')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.status')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {lessons.ok && lessons.data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-fg-muted">
                  {t('admin.ui.emptyFiltered')}
                </td>
              </tr>
            ) : null}
            {lessons.ok
              ? lessons.data.rows.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={`/lessons/${l.id}`} className="font-medium text-accent-text hover:underline">
                        {l.sort_order}. {pickLocalized(l.title_translations, locale) || shortId(l.id)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.chapter ? (
                        <>
                          <Link href={`/collections/${l.chapter.collection?.id}`} className="text-accent-text hover:underline">
                            {pickLocalized(l.chapter.collection?.title_translations, locale)}
                          </Link>
                          {' › '}
                          <Link href={`/chapters/${l.chapter.id}`} className="text-accent-text hover:underline">
                            {pickLocalized(l.chapter.title_translations, locale)}
                          </Link>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">{l.target_variety_id ?? '—'}</td>
                    <td className="px-3 py-2">{l.instruction_language_code ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{t(`admin.transcripts.status.${l.transcript_status}`)}</td>
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
