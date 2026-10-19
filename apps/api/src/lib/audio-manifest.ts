/**
 * Audio collection manifest builder (§6.3, ADR-004) shared by the learner `audioCollectionChapters` route (learner RLS
 * client: published rows only) and the stored-manifest writer (service client on publish). Rights rows are read with
 * the service client and reduced to attribution text + the offline-eligibility boolean, never returned raw.
 */
import type { AudioCollectionManifest, AudioManifestLesson, SourceLanguageCode } from '@langquest/contracts';
import type { DbClient } from '@langquest/db/client';
import type { Row } from '@langquest/db/types';
import { buildAudioCollectionManifest } from '@langquest/media/manifests';
import { MEDIA_ASSET_COLUMNS, mediaAssetToRef, type MediaAssetPublicRow } from './dto';
import { attributionFor, loadRights, redistributable } from './rights';
import type { RequestServices } from '../services/context';

export const localizedTitle = (translations: unknown, lang: string | null): string => {
  const t = (translations ?? {}) as Record<string, string>;
  return (lang && t[lang]) || t.en || Object.values(t)[0] || '';
};
export const localizedDescription = (translations: unknown, lang: string | null): string | null => {
  const t = (translations ?? {}) as Record<string, string>;
  return (lang && t[lang]) || null;
};

export async function buildAudioManifest(s: RequestServices, db: DbClient, collection: Row<'audio_course_collections'>): Promise<AudioCollectionManifest> {
  const lang = collection.instruction_language_code;
  const chapters = ((await db.from('audio_chapters').select('*').eq('collection_id', collection.id).order('sort_order')).data ?? []) as Row<'audio_chapters'>[];
  const chapterIds = chapters.map((ch) => ch.id);
  const lessons = chapterIds.length ? (((await db.from('audio_lessons').select('*').in('chapter_id', chapterIds).order('sort_order')).data ?? []) as Row<'audio_lessons'>[]) : [];
  const lessonIds = lessons.map((l) => l.id);
  const [links, speakerLinks, transcripts, rightsRows] = await Promise.all([
    lessonIds.length ? db.from('audio_lesson_assets').select('*').in('lesson_id', lessonIds).then((r) => r.data ?? []) : Promise.resolve([]),
    lessonIds.length ? db.from('lesson_speakers').select('lesson_id, speakers!inner(display_name)').in('lesson_id', lessonIds).then((r) => (r.data ?? []) as unknown as { lesson_id: string; speakers: { display_name: string } | null }[]) : Promise.resolve([]),
    lessonIds.length ? db.from('transcripts').select('lesson_id, status, id').in('lesson_id', lessonIds).then((r) => r.data ?? []) : Promise.resolve([]),
    loadRights(s, [collection.content_rights_id, ...lessons.map((l) => l.content_rights_id)]),
  ]);
  const assetIds = [...new Set(links.map((l) => l.asset_id))];
  const media = assetIds.length ? (((await db.from('media_assets').select(MEDIA_ASSET_COLUMNS).in('id', assetIds)).data as MediaAssetPublicRow[] | null) ?? []) : [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const transcriptIds = transcripts.map((t) => t.id);
  const translationLangs = transcriptIds.length ? ((((await db.from('transcript_translations').select('language_code, transcript_segments!inner(transcript_id)').in('transcript_segments.transcript_id', transcriptIds)).data ?? []) as unknown) as { language_code: string; transcript_segments: { transcript_id: string } }[]) : [];
  const collectionRights = collection.content_rights_id ? (rightsRows.get(collection.content_rights_id) ?? null) : null;
  const toLesson = (l: Row<'audio_lessons'>): AudioManifestLesson => {
    const r = l.content_rights_id ? (rightsRows.get(l.content_rights_id) ?? collectionRights) : collectionRights;
    const tr = transcripts.filter((t) => t.lesson_id === l.id);
    const langs = [...new Set(translationLangs.filter((x) => tr.some((t) => t.id === x.transcript_segments.transcript_id)).map((x) => x.language_code))];
    return {
      id: l.id,
      order: l.sort_order,
      title: localizedTitle(l.title_translations, lang),
      description: localizedDescription(l.description_translations, lang),
      durationMs: l.listen_length_ms,
      level: l.level as AudioManifestLesson['level'],
      speakerNames: speakerLinks.filter((sp) => sp.lesson_id === l.id).map((sp) => sp.speakers?.display_name ?? '').filter(Boolean),
      assets: links.filter((lk) => lk.lesson_id === l.id && mediaById.has(lk.asset_id)).map((lk) => mediaAssetToRef(mediaById.get(lk.asset_id)!)),
      transcriptAvailable: tr.some((t) => t.status === 'ready' || t.status === 'reviewed'),
      transcriptLanguages: langs,
      offlineEligible: l.state === 'published' && redistributable(r),
    };
  };
  return buildAudioCollectionManifest({
    collectionId: collection.id,
    title: localizedTitle(collection.title_translations, lang),
    targetVarietyId: collection.target_variety_id as never,
    instructionLanguageCode: (lang ?? null) as SourceLanguageCode | null,
    version: collection.published_version ?? 0,
    coverArt: null,
    attributionText: attributionFor(collectionRights, localizedTitle(collection.title_translations, lang)),
    chapters: chapters.map((ch) => ({ id: ch.id, order: ch.sort_order, title: localizedTitle(ch.title_translations, lang), summary: localizedDescription(ch.summary_translations, lang), coverArt: null, lessons: lessons.filter((l) => l.chapter_id === ch.id).map(toLesson) })),
  });
}
