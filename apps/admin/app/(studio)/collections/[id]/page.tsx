import Link from 'next/link';
import { notFound } from 'next/navigation';
import { courseCoverSvgString } from '@art/covers';
import { requireSection } from '@/src/lib/auth/session';
import { serverTranslator } from '@/src/lib/i18n/server';
import { getCollection } from '@/src/lib/queries/structure';
import { loadPickerOptions } from '@/src/lib/queries/library';
import { pickLocalized, shortId } from '@/src/lib/format';
import { Card, PageHeader } from '@/src/components/ui';
import { StatusBadge } from '@/src/components/badges';
import { SvgArt } from '@/src/components/asset-preview';
import { PublishControls } from '@/src/components/publish-controls';
import { CollectionEditor } from '../collection-editor';
import { ChapterEditor } from '../../chapters/chapter-editor';

export const dynamic = 'force-dynamic';

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection('collections');
  const { id } = await params;
  const { t, locale } = await serverTranslator();
  const [{ collection, chapters }, options] = await Promise.all([getCollection(id), loadPickerOptions()]);
  if (!collection.ok || !collection.data) notFound();
  const c = collection.data;
  const title = pickLocalized(c.title_translations, locale) || shortId(c.id);
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={`${c.course_track_id ?? '—'} · ${c.target_variety_id ?? '—'} · ${t('admin.ui.sourceLanguage')}: ${c.instruction_language_code ?? '—'}`}
        actions={
          <>
            <StatusBadge state={c.state} />
            <CollectionEditor
              mode="edit"
              options={options}
              initial={{
                id: c.id,
                titleTranslations: (c.title_translations as Record<string, string>) ?? {},
                descriptionTranslations: (c.description_translations as Record<string, string>) ?? {},
                courseTrackId: c.course_track_id,
                targetVarietyId: c.target_variety_id,
                instructionLanguageCode: c.instruction_language_code,
                region: c.region,
                instructorSpeakerId: c.instructor_speaker_id,
                coverVisualAssetId: c.cover_visual_asset_id,
                contentRightsId: c.content_rights_id,
                sortOrder: c.sort_order,
              }}
            />
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <Card title={t('admin.ui.colPublishState')}>
            <PublishControls entityTable="audio_course_collections" entityId={c.id} state={c.state} revision={c.published_version ?? 0} />
          </Card>
          <Card title={t('admin.ui.colChapters')} actions={<ChapterEditor mode="create" collectionId={c.id} nextOrder={(chapters.ok ? chapters.data.length : 0) + 1} />}>
            {chapters.ok && chapters.data.length === 0 ? <p className="text-sm text-fg-muted">{t('admin.ui.empty')}</p> : null}
            <ol className="divide-y divide-border">
              {chapters.ok
                ? chapters.data.map((ch) => (
                    <li key={ch.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        <span className="me-2 tabular-nums text-fg-muted">{ch.sort_order}.</span>
                        <Link href={`/chapters/${ch.id}`} className="font-medium text-accent hover:underline">
                          {pickLocalized(ch.title_translations, locale) || shortId(ch.id)}
                        </Link>
                        <span className="ms-2 text-xs text-fg-muted">{t('admin.ui.upFiles', { count: ch.lessons.length }).replace(/file/i, 'lesson')}</span>
                      </span>
                      <StatusBadge state={ch.state} />
                    </li>
                  ))
                : null}
            </ol>
          </Card>
        </div>
        <aside className="space-y-2">
          <p className="text-xs text-fg-muted">{c.cover_visual_asset_id ? `${t('admin.ui.colCover')}: ${shortId(c.cover_visual_asset_id)}` : t('admin.ui.colCoverGenerated')}</p>
          {c.course_track_id ? <SvgArt svg={courseCoverSvgString(c.course_track_id, { width: 256 })} label={title} className="rounded-md border border-border" /> : null}
          <dl className="text-xs text-fg-muted">
            <dt>{t('admin.ui.colRightsLink')}</dt>
            <dd>{c.content_rights_id ? <Link href={`/rights?id=${c.content_rights_id}`} className="text-accent">{shortId(c.content_rights_id)}</Link> : t('admin.ui.none')}</dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
