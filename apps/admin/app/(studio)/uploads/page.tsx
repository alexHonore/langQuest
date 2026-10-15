import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { PageHeader } from '@/src/components/ui';
import { UploadsScreen } from './uploads-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Uploads' };

export default async function UploadsPage() {
  await requireSection('uploads');
  const { t } = await serverTranslator();
  return (
    <div>
      <PageHeader title={t('admin.upload.title')} description={t('admin.upload.multipart')} />
      <UploadsScreen />
    </div>
  );
}
