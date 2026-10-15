import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { getLesson } from '@/src/lib/queries/structure';
import { loadPickerOptions } from '@/src/lib/queries/library';
import { formatDateTime, pickLocalized, shortId } from '@/src/lib/format';
import { Card, PageHeader } from '@/src/components/ui';
import { StatusBadge } from '@/src/components/badges';
import { PublishControls } from '@/src/components/publish-controls';
import { LessonEditor } from './lesson-editor';
import { LessonAssets } from './lesson-assets';

export const dynamic = 'force-dynamic';

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSection('lessons');
  const { id } = await params;
  const { t, locale } = await serverTranslator();
  const [{ lesson, assets, speakers, revisions }, options] = await Promise.all([getLesson(id), loadPickerOptions()]);
  if (!lesson.ok || !lesson.data) notFound();
  const l = lesson.data;
  const title = pickLocalized(l.title_translations, locale) || shortId(l.id);
  const revision = revisions.ok && revisions.data[0] ? revisions.data[0].revision : (l.published_revision ?? 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={
          l.chapter ? (
            <>
              <Link href={`/collections/${l.chapter.collection?.id}`} className="text-accent hover:underline">
                {pickLocalized(l.chapter.collection?.title_translations, locale)}
              </Link>
              {' › '}
              <Link href={`/chapters/${l.chapter.id}`} className="text-accent hover:underline">
                {pickLocalized(l.chapter.title_translations, locale)}
              </Link>
              {' · '}
              {t('admin.ui.targetVariety')}: {l.target_variety_id ?? '—'} · {t('admin.ui.sourceLanguage')}: {l.instruction_language_code ?? '—'}
            </>
          ) : null
        }
        actions={
          <>
            <StatusBadge state={l.state} />
            <Link href={`/transcripts/${l.id}`} className="text-sm text-accent hover:underline">
              {t('admin.transcripts.title')} →
            </Link>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <LessonEditor
            lesson={{
              id: l.id,
              chapterId: l.chapter_id,
              titleTranslations: (l.title_translations as Record<string, string>) ?? {},
              descriptionTranslations: (l.description_translations as Record<string, string>) ?? {},
              sortOrder: l.sort_order,
              episodeNumber: l.episode_number,
              level: l.level,
              targetVarietyId: l.target_variety_id,
              instructionLanguageCode: l.instruction_language_code,
              spokenLanguageCodes: l.spoken_language_codes,
              regionalDialect: l.regional_dialect,
              topic: l.topic,
              tags: l.tags,
              scene: l.scene,
              speakerIds: speakers.ok ? speakers.data.map((s) => s.speaker?.id).filter((x): x is string => Boolean(x)) : [],
              coverVisualAssetId: l.cover_visual_asset_id,
              contentRightsId: l.content_rights_id,
              visibility: l.visibility as 'private' | 'authenticated',
              qualityReviewStatus: l.quality_review_status as 'unreviewed' | 'approved' | 'rejected',
              expectedRevision: revision,
            }}
            options={options}
            canReview={session.roles.some((r) => ['super_admin', 'admin', 'content_editor', 'language_reviewer'].includes(r))}
          />
          <Card title={t('admin.ui.lsAssets')}>
            <LessonAssets lessonId={l.id} assets={(assets.ok ? assets.data : []) as unknown as Parameters<typeof LessonAssets>[0]['assets']} />
          </Card>
        </div>
        <aside className="space-y-4">
          <Card title={t('admin.ui.colPublishState')}>
            <PublishControls entityTable="audio_lessons" entityId={l.id} state={l.state} revision={revision} canDecide />
          </Card>
          <Card title={t('admin.ui.pbRevisions')}>
            {!revisions.ok || revisions.data.length === 0 ? (
              <p className="text-xs text-fg-muted">{t('admin.ui.none')}</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {revisions.data.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span>{t('admin.ui.lsRevision', { revision: r.revision })}</span>
                    <span className="truncate text-fg-muted" title={r.note ?? ''}>
                      {r.note ?? ''}
                    </span>
                    <span className="whitespace-nowrap text-fg-muted">{formatDateTime(r.created_at, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/publishing?table=audio_lessons&id=${l.id}`} className="mt-2 inline-block text-xs text-accent hover:underline">
              {t('admin.sections.publishing')} →
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
