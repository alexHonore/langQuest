import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listPublishables, listRecentPublicationEvents, listRevisions } from '@/src/lib/queries/ops';
import { parsePage } from '@/src/lib/queries';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { PublishingScreen, type PublishableRow, type RevisionRow, type EventRow } from './publishing-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Publishing' };

export default async function PublishingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSection('publishing');
  const sp = await searchParams;
  const { t } = await serverTranslator();
  const table = sp.table === 'audio_course_collections' ? 'audio_course_collections' : 'audio_lessons';
  const page = parsePage(sp.page);
  const [items, events, detail] = await Promise.all([listPublishables(table, page), listRecentPublicationEvents(30), sp.id ? listRevisions(table, sp.id) : Promise.resolve(null)]);
  return (
    <div>
      <PageHeader title={t('admin.publish.title')} description={t('admin.ui.pbRollbackHint')} />
      {!items.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={items.error} /> : null}
      <PublishingScreen
        table={table}
        rows={(items.ok ? items.data.rows : []) as unknown as PublishableRow[]}
        page={page}
        hasNext={items.ok ? items.data.hasNext : false}
        selectedId={sp.id ?? null}
        revisions={detail && detail.revisions.ok ? (detail.revisions.data as unknown as RevisionRow[]) : []}
        entityEvents={detail && detail.events.ok ? (detail.events.data as unknown as EventRow[]) : []}
        recentEvents={(events.ok ? events.data : []) as unknown as EventRow[]}
      />
    </div>
  );
}
