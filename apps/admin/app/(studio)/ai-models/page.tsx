import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listModelProfiles } from '@/src/lib/queries/ops';
import { serverEnv } from '@/src/lib/env';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { AiModelsScreen, type BenchmarkRow, type ProfileRow } from './ai-models-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI models' };

export default async function AiModelsPage() {
  await requireSection('aiModels');
  const { t } = await serverTranslator();
  const { profiles, benchmarks } = await listModelProfiles();
  return (
    <div>
      <PageHeader title={t('admin.models.title')} info={`${t('admin.models.pricingNote')} ${t('admin.models.fallbackNote')}`} />
      {!profiles.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={profiles.error} /> : null}
      <AiModelsScreen profiles={(profiles.ok ? profiles.data : []) as unknown as ProfileRow[]} benchmarks={(benchmarks.ok ? benchmarks.data : []) as unknown as BenchmarkRow[]} localProbeAvailable={Boolean(serverEnv().OPENROUTER_API_KEY)} />
    </div>
  );
}
