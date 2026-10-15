/**
 * Build engine queues from collection manifests (chapter play queue, §1.3)
 * and from the local download index (offline). Pure.
 */
import type { AudioCollectionManifest, AudioLessonResponse, AudioManifestLesson } from '@langquest/contracts';
import type { QueueItem } from '@/audio/engine-state';
import type { DownloadRecord } from './download-index';

/** Preferred playable asset: the API picks the best rendition per request; we hand it the first audio asset. */
export function preferredAssetId(assets: readonly { assetId: string; kind: string }[]): string | null {
  return assets.find((a) => a.kind === 'audio')?.assetId ?? null;
}

export function preferredLessonAssetId(lesson: Pick<AudioLessonResponse, 'assets'>): string | null {
  const byType = (type: string) => lesson.assets.find((a) => a.type === type && a.ref.kind === 'audio')?.ref.assetId ?? null;
  return byType('mobile_encoded') ?? byType('master') ?? byType('slow') ?? lesson.assets.find((a) => a.ref.kind === 'audio')?.ref.assetId ?? null;
}

export function manifestLessonToQueueItem(manifest: AudioCollectionManifest, chapter: AudioCollectionManifest['chapters'][number], lesson: AudioManifestLesson, courseTrackId: string | null): QueueItem | null {
  const assetId = preferredAssetId(lesson.assets);
  if (!assetId) return null;
  return {
    id: lesson.id,
    collectionId: manifest.collectionId,
    chapterId: chapter.id,
    title: lesson.title,
    subtitle: [manifest.title, chapter.title].filter((s) => s && s.length > 0).join(' · ') || null,
    artworkUri: chapter.coverArt?.publicUrl ?? manifest.coverArt?.publicUrl ?? null,
    assetId,
    durationMs: lesson.durationMs,
    attributionText: manifest.attributionText,
    courseTrackId,
  };
}

/** Every playable lesson of a collection in chapter → lesson order (optionally one chapter only). */
export function buildQueue(manifest: AudioCollectionManifest, options: { chapterId?: string | null; courseTrackId?: string | null } = {}): QueueItem[] {
  const items: QueueItem[] = [];
  const chapters = [...manifest.chapters].sort((a, b) => a.order - b.order);
  for (const chapter of chapters) {
    if (options.chapterId && chapter.id !== options.chapterId) continue;
    for (const lesson of [...chapter.lessons].sort((a, b) => a.order - b.order)) {
      const item = manifestLessonToQueueItem(manifest, chapter, lesson, options.courseTrackId ?? null);
      if (item) items.push(item);
    }
  }
  return items;
}

export function lessonToQueueItem(lesson: AudioLessonResponse, context: { collectionTitle: string | null; chapterTitle: string | null; courseTrackId: string | null }): QueueItem | null {
  const assetId = preferredLessonAssetId(lesson);
  if (!assetId) return null;
  return {
    id: lesson.id,
    collectionId: lesson.collectionId,
    chapterId: lesson.chapterId,
    title: lesson.title,
    subtitle: [context.collectionTitle, context.chapterTitle].filter((s): s is string => Boolean(s)).join(' · ') || null,
    artworkUri: lesson.coverArt?.publicUrl ?? null,
    assetId,
    durationMs: lesson.durationMs,
    attributionText: lesson.attributionText,
    courseTrackId: context.courseTrackId,
  };
}

/** Queue of downloaded lessons (offline library), newest first. */
export function queueFromDownloads(records: readonly DownloadRecord[]): QueueItem[] {
  return records
    .filter((r) => r.status === 'complete')
    .map((r) => {
      const audio = r.files.find((f) => f.kind === 'audio' && f.state === 'done');
      if (!audio) return null;
      return { id: r.lessonId, collectionId: r.collectionId, chapterId: '', title: r.title, subtitle: r.subtitle, artworkUri: r.artworkUri, assetId: audio.assetId, durationMs: r.durationMs, attributionText: r.attributionText, courseTrackId: r.courseTrackId } satisfies QueueItem;
    })
    .filter((q): q is QueueItem => q !== null);
}

export const queueIndexOf = (queue: readonly QueueItem[], lessonId: string): number => queue.findIndex((q) => q.id === lessonId);
