import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listLibraryAssets, loadPickerOptions } from '@/src/lib/queries/library';
import { listLessonOptions } from '@/src/lib/queries/structure';
import { parsePage } from '@/src/lib/queries';
import { PageHeader } from '@/src/components/ui';
import { LibraryScreen } from './library-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Library' };

type Search = Record<string, string | undefined>;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSection('library');
  const sp = await searchParams;
  const { t } = await serverTranslator();
  const page = parsePage(sp.page);
  const [assets, options, lessons] = await Promise.all([
    listLibraryAssets({
      page,
      status: sp.status || undefined,
      kind: sp.kind || undefined,
      targetVarietyId: sp.variety || undefined,
      instructionLanguage: sp.source || undefined,
      speakerId: sp.speaker || undefined,
      collectionId: sp.collection || undefined,
      q: sp.q || undefined,
      derived: (sp.derived as 'original' | 'derived' | 'all' | undefined) || 'all',
    }),
    loadPickerOptions(),
    listLessonOptions(),
  ]);
  return (
    <div>
      <PageHeader title={t('admin.library.title')} />
      <LibraryScreen
        page={page}
        result={assets.ok ? assets.data : null}
        error={assets.ok ? null : assets.error}
        options={options}
        lessonOptions={lessons.ok ? (lessons.data as unknown as Parameters<typeof LibraryScreen>[0]['lessonOptions']) : []}
        canEdit={session.roles.some((r) => ['super_admin', 'admin', 'content_editor'].includes(r))}
      />
    </div>
  );
}
