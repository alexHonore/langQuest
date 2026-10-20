import Link from 'next/link';
import { requireSection } from '@/src/lib/auth/session';
import { SECTION_PATHS } from '@/src/lib/auth/roles';
import { serverTranslator } from '@/src/lib/i18n/server';
import { publicEnv } from '@/src/lib/env';
import { loadSetupStatus } from '@/src/lib/setup/status';
import { Card, PageHeader } from '@/src/components/ui';
import { SetupItemRow } from '@/src/components/setup-card';
import { ApiHealth } from './api-health';
import pkg from '../../../package.json';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireSection('settings');
  const { t, locale } = await serverTranslator();
  const env = publicEnv();
  const setup = await loadSetupStatus();
  const providers = setup.items.filter((i) => i.key === 'media' || i.key === 'ai' || i.key === 'speech' || i.key === 'adminProbe');
  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.settings.title')} info={t('admin.settings.secretsNote')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('admin.ui.stEnvironment')}>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-muted">{t('admin.ui.stSupabase')}</dt>
            <dd className="font-mono text-xs">{env.NEXT_PUBLIC_SUPABASE_URL}</dd>
            <dt className="text-fg-muted">{t('admin.ui.stApiBase')}</dt>
            <dd className="font-mono text-xs">{env.NEXT_PUBLIC_API_BASE_URL}</dd>
            <dt className="text-fg-muted">{t('admin.ui.stApiHealth')}</dt>
            <dd>
              <ApiHealth />
            </dd>
            <dt className="text-fg-muted">{t('admin.ui.stLocale')}</dt>
            <dd>{locale}</dd>
            <dt className="text-fg-muted">{t('admin.ui.stVersion')}</dt>
            <dd>
              {pkg.name} {pkg.version}
            </dd>
          </dl>
        </Card>
        {/* Live provider status observed from the API (never a static "configured" badge). */}
        <Card
          title={t('admin.ui.stProviders')}
          actions={
            <Link href={SECTION_PATHS.setup} className="text-xs text-accent-text hover:underline">
              {t('admin.ui.setup.openSetup')} →
            </Link>
          }
        >
          <ul className="divide-y divide-border">
            {providers.map((item) => (
              <SetupItemRow key={item.key} item={item} />
            ))}
          </ul>
          <p className="mt-3 text-xs text-fg-muted">{t('admin.ui.stQueues')}: postgres (ADR-005)</p>
          <p className="mt-1 text-xs text-fg-muted">{t('admin.ui.stStorageHint')}</p>
          <p className="mt-1 text-xs text-fg-muted">{t('admin.ui.stSetupLink')}</p>
        </Card>
      </div>
    </div>
  );
}
