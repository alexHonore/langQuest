import Link from 'next/link';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listChapters } from '@/src/lib/queries/structure';
import { pickLocalized, shortId } from '@/src/lib/format';
import { EmptyState, ErrorState, PageHeader } from '@/src/components/ui';
import { Melo } from '@/src/components/brand';
import { SECTION_PATHS } from '@/src/lib/auth/roles';
import { StatusBadge } from '@/src/components/badges';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chapters' };

export default async function ChaptersPage() {
  await requireSection('chapters');
  const { t, locale } = await serverTranslator();
  const chapters = await listChapters();
  const empty = chapters.ok && chapters.data.length === 0;
  return (
    <div>
      <PageHeader title={t('admin.sections.chapters')} description={t('admin.ui.chNew') + ': ' + t('admin.sections.collections')} />
      {!chapters.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={chapters.error} /> : null}
      {empty ? (
        <EmptyState
          art={<Melo state="curious" size={72} />}
          title={t('admin.ui.chEmptyHint')}
          action={
            <Link href={SECTION_PATHS.collections} className="text-sm text-accent-text hover:underline">
              {t('admin.sections.collections')} →
            </Link>
          }
        />
      ) : null}
      {empty ? null : (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('admin.ui.order')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.title')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.upCollection')}</th>
              <th className="px-3 py-2 text-start">{t('admin.sections.lessons')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.status')}</th>
            </tr>
          </thead>
          <tbody>
            {chapters.ok
              ? chapters.data.map((ch) => (
                  <tr key={ch.id} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{ch.sort_order}</td>
                    <td className="px-3 py-2">
                      <Link href={`/chapters/${ch.id}`} className="font-medium text-accent-text hover:underline">
                        {pickLocalized(ch.title_translations, locale) || shortId(ch.id)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {ch.collection ? (
                        <Link href={`/collections/${ch.collection.id}`} className="text-accent-text hover:underline">
                          {pickLocalized(ch.collection.title_translations, locale) || shortId(ch.collection.id)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{ch.lessons.length}</td>
                    <td className="px-3 py-2">
                      <StatusBadge state={ch.state} />
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
