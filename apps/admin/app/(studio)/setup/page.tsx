import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { loadSetupStatus } from '@/src/lib/setup/status';
import { PageHeader } from '@/src/components/ui';
import { SetupChecklist } from '@/src/components/setup-card';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Setup' };

/**
 * Deployment setup checklist (CONVENTIONS §8): what is configured, the exact next step for what is not, and
 * which Studio controls are hidden meanwhile. The page itself is always usable — it reads public API signals
 * and never shows a disabled placeholder. Opening it forces a fresh observation (the layout cache is ~30 s).
 */
export default async function SetupPage() {
  await requireSection('setup');
  const { t } = await serverTranslator();
  const status = await loadSetupStatus({ fresh: true });
  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.ui.setup.title')} description={t('admin.ui.setup.intro')} />
      <SetupChecklist status={status} />
    </div>
  );
}
