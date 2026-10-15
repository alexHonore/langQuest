import { INTENTS } from '@langquest/curriculum';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listContentDrafts } from '@/src/lib/queries/ops';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { ContentFactoryScreen, type DraftExpression, type DraftMission, type GenerationJob } from './content-factory-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content factory' };

export default async function ContentFactoryPage() {
  const session = await requireSection('contentFactory');
  const { t } = await serverTranslator();
  const { missions, expressions, jobs } = await listContentDrafts();
  return (
    <div>
      <PageHeader title={t('admin.contentFactory.title')} description={t('admin.contentFactory.draftNote')} />
      {!missions.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={missions.error} /> : null}
      <ContentFactoryScreen
        intents={INTENTS.map((i) => ({ key: i.intentKey, description: i.description, concept: i.conceptId }))}
        missions={(missions.ok ? missions.data : []) as unknown as DraftMission[]}
        expressions={(expressions.ok ? expressions.data : []) as unknown as DraftExpression[]}
        jobs={(jobs.ok ? jobs.data : []) as unknown as GenerationJob[]}
        canDecide={session.roles.some((r) => ['super_admin', 'admin', 'content_editor', 'language_reviewer'].includes(r))}
      />
    </div>
  );
}
