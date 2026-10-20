import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listUserRoles } from '@/src/lib/queries/ops';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { UsersScreen } from './users-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users & roles' };

export default async function UsersPage() {
  const session = await requireSection('users');
  const { t } = await serverTranslator();
  const roles = await listUserRoles();
  return (
    <div>
      <PageHeader title={t('admin.users.title')} info={t('admin.ui.usLookupHint')} />
      {!roles.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={roles.error} /> : null}
      <UsersScreen rows={roles.ok ? roles.data : []} currentUserId={session.userId} />
    </div>
  );
}
