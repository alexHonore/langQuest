import { JOB_STATE_VALUES, PROCESSING_JOB_TYPE_VALUES_ALL } from '@langquest/contracts';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listJobs } from '@/src/lib/queries/ops';
import { parsePage } from '@/src/lib/queries';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { JobsScreen, type JobRow } from './jobs-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job queue' };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSection('jobQueue');
  const sp = await searchParams;
  const { t } = await serverTranslator();
  const page = parsePage(sp.page);
  const jobs = await listJobs(page, { state: sp.state || undefined, type: sp.type || undefined, assetId: sp.assetId || undefined });
  const rows = (jobs.ok ? jobs.data.rows : []) as unknown as JobRow[];
  const filtered = sp.q ? rows.filter((r) => r.id.startsWith(sp.q!) || r.idempotency_key.includes(sp.q!)) : rows;
  return (
    <div>
      <PageHeader title={t('admin.jobs.title')} description={t('admin.ui.jbRetryHint')} />
      {!jobs.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={jobs.error} /> : null}
      <JobsScreen rows={filtered} page={page} hasNext={jobs.ok ? jobs.data.hasNext : false} states={[...JOB_STATE_VALUES]} types={[...PROCESSING_JOB_TYPE_VALUES_ALL]} canRetry={session.roles.some((r) => ['super_admin', 'admin', 'content_editor'].includes(r))} />
    </div>
  );
}
