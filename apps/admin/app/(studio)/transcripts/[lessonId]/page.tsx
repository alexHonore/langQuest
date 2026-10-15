import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { loadTranscript } from '@/src/lib/queries/transcripts';
import { pickLocalized, shortId } from '@/src/lib/format';
import { PageHeader } from '@/src/components/ui';
import { TranscriptEditor } from './transcript-editor';

export const dynamic = 'force-dynamic';

export default async function TranscriptPage({ params, searchParams }: { params: Promise<{ lessonId: string }>; searchParams: Promise<{ revision?: string }> }) {
  const session = await requireSection('transcripts');
  const { lessonId } = await params;
  const { revision } = await searchParams;
  const { t, locale } = await serverTranslator();
  const bundle = await loadTranscript(lessonId, revision ? Number(revision) : undefined);
  if (!bundle.ok) notFound();
  const { lesson } = bundle.data;
  return (
    <div className="space-y-3">
      <PageHeader
        title={pickLocalized(lesson.title_translations, locale) || shortId(lesson.id)}
        description={
          <>
            <Link href={`/lessons/${lesson.id}`} className="text-accent hover:underline">
              {t('admin.ui.upLesson')}
            </Link>
            {' · '}
            {t('admin.ui.targetVariety')}: {lesson.target_variety_id ?? '—'} · {t('admin.ui.sourceLanguage')}: {lesson.instruction_language_code ?? '—'}
          </>
        }
      />
      <TranscriptEditor bundle={bundle.data} canReview={session.roles.some((r) => ['super_admin', 'admin', 'content_editor', 'language_reviewer'].includes(r))} />
    </div>
  );
}
