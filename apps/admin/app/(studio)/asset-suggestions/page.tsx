import { requireSection } from '@/src/lib/auth/session';
import { canEditContent } from '@/src/lib/auth/roles';
import { serverTranslator } from '@/src/lib/i18n/server';
import { PageHeader } from '@/src/components/ui';
import { SuggestionsScreen } from './suggestions-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Asset suggestions' };

/** §7.4 review queue: the list and every decision go to the LangQuest API from the browser; the server only gates the role. */
export default async function AssetSuggestionsPage() {
  const session = await requireSection('assetSuggestions');
  const { t } = await serverTranslator();
  return (
    <div>
      <PageHeader title={t('admin.sections.assetSuggestions')} description={t('admin.ui.sgIntro')} />
      <SuggestionsScreen canDecide={canEditContent(session.roles)} />
    </div>
  );
}
