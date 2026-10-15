import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { listSpeakers } from '@/src/lib/queries/structure';
import { loadPickerOptions } from '@/src/lib/queries/library';
import { ErrorState, PageHeader } from '@/src/components/ui';
import { SpeakersScreen } from './speakers-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Speakers' };

export default async function SpeakersPage() {
  await requireSection('speakers');
  const { t } = await serverTranslator();
  const [speakers, options] = await Promise.all([listSpeakers(), loadPickerOptions()]);
  return (
    <div>
      <PageHeader title={t('admin.speakersSection.title')} />
      {!speakers.ok ? <ErrorState title={t('admin.ui.errorTitle')} message={speakers.error} /> : null}
      <SpeakersScreen speakers={speakers.ok ? speakers.data : []} rights={options.rights} />
    </div>
  );
}
