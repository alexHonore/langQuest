import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { PageHeader } from '@/src/components/ui';
import { AnalyticsScreen } from './analytics-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics' };

export default async function AnalyticsPage() {
  await requireSection('analytics');
  const { t } = await serverTranslator();
  return (
    <div>
      <PageHeader title={t('admin.analytics.title')} description={t('admin.ui.anNeedsApi')} />
      <AnalyticsScreen />
    </div>
  );
}
