import { requireSection } from '@/src/lib/auth/session';
import { canEditContent } from '@/src/lib/auth/roles';
import { serverTranslator } from '@/src/lib/i18n/server';
import { loadPickerOptions } from '@/src/lib/queries/library';
import { listLessonOptions } from '@/src/lib/queries/structure';
import { PageHeader } from '@/src/components/ui';
import { VisualAssetsScreen, type LessonPick } from './visual-assets-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Visual assets' };

/**
 * §10.2A visual assets. Reads and writes go to the LangQuest API from the browser (API-paged
 * list, assignment filters applied per page); the server only supplies picker options
 * (collections / chapters / lessons / rights) and the role gate.
 */
export default async function VisualAssetsPage() {
  const session = await requireSection('visualAssets');
  const { t } = await serverTranslator();
  const [options, lessons] = await Promise.all([loadPickerOptions(), listLessonOptions()]);
  return (
    <div>
      <PageHeader title={t('admin.sections.visualAssets')} description={t('admin.ui.vaIntro')} />
      <VisualAssetsScreen options={{ collections: options.collections, chapters: options.chapters, rights: options.rights }} lessons={(lessons.ok ? lessons.data : []) as LessonPick[]} canEdit={canEditContent(session.roles)} />
    </div>
  );
}
