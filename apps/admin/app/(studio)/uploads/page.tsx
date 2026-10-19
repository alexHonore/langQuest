import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { loadSetupStatus } from '@/src/lib/setup/status';
import { PageHeader } from '@/src/components/ui';
import { SetupCard } from '@/src/components/setup-card';
import { UploadsScreen } from './uploads-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Uploads' };

/** Without media storage on the API there is nothing to upload to: the page is the setup step, not a greyed-out drop zone. */
export default async function UploadsPage() {
  await requireSection('uploads');
  const { t } = await serverTranslator();
  const setup = await loadSetupStatus();
  return (
    <div>
      <PageHeader title={t('admin.upload.title')} description={setup.capabilities.mediaAvailable ? t('admin.upload.multipart') : undefined} />
      {setup.capabilities.mediaAvailable ? <UploadsScreen /> : <SetupCard keys={['api', 'media']} />}
    </div>
  );
}
