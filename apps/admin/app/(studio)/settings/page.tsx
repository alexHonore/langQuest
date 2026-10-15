import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { publicEnv, serverEnv } from '@/src/lib/env';
import { Card, PageHeader } from '@/src/components/ui';
import { Badge } from '@/src/components/badges';
import { ApiHealth } from './api-health';
import pkg from '../../../package.json';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireSection('settings');
  const { t, locale } = await serverTranslator();
  const env = publicEnv();
  const hasProbeKey = Boolean(serverEnv().OPENROUTER_API_KEY);
  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.settings.title')} description={t('admin.settings.secretsNote')} />
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
        <Card title={t('admin.ui.stProviders')}>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span>{t('admin.ui.stOpenRouter')}</span>
              <span className="flex gap-1">
                <Badge tone="info">{t('admin.ui.stConfiguredOnApi')}</Badge>
                <Badge tone={hasProbeKey ? 'success' : 'neutral'}>
                  {t('admin.ui.stLocalProbe')}: {hasProbeKey ? t('admin.ui.yes') : t('admin.ui.no')}
                </Badge>
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span>{t('admin.ui.stR2')}</span>
              <Badge tone="info">{t('admin.ui.stConfiguredOnApi')}</Badge>
            </li>
            <li className="flex items-center justify-between">
              <span>{t('admin.ui.stQueues')}</span>
              <Badge tone="info">postgres (ADR-005)</Badge>
            </li>
          </ul>
          <p className="mt-3 text-xs text-fg-muted">{t('admin.ui.stStorageHint')}</p>
        </Card>
      </div>
    </div>
  );
}
