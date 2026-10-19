import Link from 'next/link';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listCollections } from '@/src/lib/queries/structure';
import { loadPickerOptions } from '@/src/lib/queries/library';
import { formatDateTime, pickLocalized, shortId } from '@/src/lib/format';
import { EmptyState, ErrorState, PageHeader } from '@/src/components/ui';
import { CollectionEditor } from './collection-editor';
import { StatusBadge } from '@/src/components/badges';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Collections' };

export default async function CollectionsPage() {
  await requireSection('collections');
  const { t, locale } = await serverTranslator();
  const [collections, options] = await Promise.all([listCollections(), loadPickerOptions()]);
  const empty = collections.ok && collections.data.length === 0;
  return (
    <div>
      <PageHeader title={t('admin.sections.collections')} actions={empty ? null : <CollectionEditor mode="create" options={options} />} />
      {!collections.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={collections.error} /> : null}
      {empty ? <EmptyState title={t('admin.ui.colEmptyHint')} action={<CollectionEditor mode="create" options={options} />} /> : null}
      {empty ? null : (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('admin.ui.title')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.colTrack')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.sourceLanguage')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.colChapters')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.status')}</th>
              <th className="px-3 py-2 text-start">{t('admin.ui.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {collections.ok
              ? collections.data.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={`/collections/${c.id}`} className="font-medium text-accent hover:underline">
                        {pickLocalized(c.title_translations, locale) || shortId(c.id)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{c.course_track_id ?? '—'}{c.target_variety_id ? <span className="ms-1 text-xs text-fg-muted">({c.target_variety_id})</span> : null}</td>
                    <td className="px-3 py-2">{c.instruction_language_code ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{c.chapters.length}</td>
                    <td className="px-3 py-2">
                      <StatusBadge state={c.state} />
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{formatDateTime(c.updated_at, locale)}</td>
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
