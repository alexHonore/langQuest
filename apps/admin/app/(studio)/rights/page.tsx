import { requireSection } from '@/src/lib/auth/session';
import { isAdminRole } from '@/src/lib/auth/roles';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listRights } from '@/src/lib/queries/structure';
import { parsePage } from '@/src/lib/queries';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { RightsScreen, type RightsRow } from './rights-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rights & licensing' };

export default async function RightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSection('rights');
  const sp = await searchParams;
  const { t } = await serverTranslator();
  const page = parsePage(sp.page);
  const rights = await listRights(page, sp.unverified === '1');
  return (
    <div>
      <PageHeader title={t('admin.rights.title')} description={t('admin.ui.rtGateHint')} />
      {!rights.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={rights.error} /> : null}
      <RightsScreen rows={(rights.ok ? rights.data.rows : []) as unknown as RightsRow[]} page={page} hasNext={rights.ok ? rights.data.hasNext : false} highlightId={sp.id ?? null} canVerify={isAdminRole(session.roles)} />
    </div>
  );
}
