import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { getChapter } from '@/src/lib/queries/structure';
import { pickLocalized, shortId } from '@/src/lib/format';
import { Card, PageHeader } from '@/src/components/ui';
import { StatusBadge } from '@/src/components/badges';
import { ChapterEditor } from '../chapter-editor';
import { LessonList } from './lesson-list';

export const dynamic = 'force-dynamic';

export default async function ChapterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection('chapters');
  const { id } = await params;
  const { t, locale } = await serverTranslator();
  const { chapter, lessons } = await getChapter(id);
  if (!chapter.ok || !chapter.data) notFound();
  const ch = chapter.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={pickLocalized(ch.title_translations, locale) || shortId(ch.id)}
        description={
          ch.collection ? (
            <Link href={`/collections/${ch.collection.id}`} className="text-accent-text hover:underline">
              {pickLocalized(ch.collection.title_translations, locale) || shortId(ch.collection.id)}
            </Link>
          ) : null
        }
        actions={
          <>
            <StatusBadge state={ch.state} />
            <ChapterEditor
              mode="edit"
              collectionId={ch.collection_id}
              initial={{ id: ch.id, collectionId: ch.collection_id, titleTranslations: (ch.title_translations as Record<string, string>) ?? {}, summaryTranslations: (ch.summary_translations as Record<string, string>) ?? {}, sortOrder: ch.sort_order, coverVisualAssetId: ch.cover_visual_asset_id }}
            />
          </>
        }
      />
      <Card title={t('admin.ui.colLessons')}>
        <LessonList
          chapterId={ch.id}
          lessons={lessons.ok ? lessons.data : []}
          defaults={{ targetVarietyId: ch.collection?.target_variety_id ?? null, instructionLanguageCode: ch.collection?.instruction_language_code ?? null }}
        />
      </Card>
    </div>
  );
}
