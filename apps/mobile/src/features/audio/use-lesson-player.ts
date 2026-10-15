/**
 * Full-player wiring for one lesson: loads lesson detail + the collection
 * manifest, builds the chapter play queue, resumes from the best known
 * position (local first, server otherwise), starts the engine once, and
 * exposes an `AudioPlayerController` for the shared `AudioPlayer` UI.
 */
import type { AudioLessonResponse, EnrollmentDto } from '@langquest/contracts';
import type { AudioPlaybackStatus, AudioPlayerController, PlaybackRate } from '@langquest/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentItem, resumePosition, type AudioEngineState, type QueueItem } from '@/audio/engine-state';
import { mediaUnavailableReason, type MediaUnavailableReason } from './api';
import { useAudioLesson, useCollectionManifest } from './queries';
import { buildQueue, lessonToQueueItem, queueFromDownloads, queueIndexOf } from './queue';
import { useAudioRuntime, useClock, useEngineState, useListeningProgress } from './use-audio';
import { mediaReasonFromEngineError } from './components/MediaNotice';

const toUiStatus = (status: AudioEngineState['status']): AudioPlaybackStatus => status;

export interface LessonPlayer {
  lesson: AudioLessonResponse | null;
  lessonLoading: boolean;
  lessonError: unknown;
  refetchLesson: () => void;
  fromCache: boolean;
  queueItem: QueueItem | null;
  /** True when the global engine currently holds this lesson. */
  isCurrent: boolean;
  state: AudioEngineState;
  controller: AudioPlayerController;
  /** Why media cannot play (null when it can or we do not know yet). */
  mediaReason: MediaUnavailableReason | null;
  start: (autoplay: boolean) => Promise<void>;
  collectionTitle: string | null;
  chapterTitle: string | null;
  playing: boolean;
}

export function useLessonPlayer(lessonId: string | null, enrollment: EnrollmentDto | null, autoplay: boolean): LessonPlayer {
  const runtime = useAudioRuntime();
  const state = useEngineState();
  const lessonQuery = useAudioLesson(lessonId);
  const lesson = lessonQuery.data?.data ?? null;
  const manifestQuery = useCollectionManifest(lesson?.collectionId ?? null);
  const manifest = manifestQuery.data?.data ?? null;
  const progress = useListeningProgress(lessonId);
  const startedFor = useRef<string | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const current = currentItem(state);
  const isCurrent = Boolean(lessonId && current?.id === lessonId);
  const playing = state.status === 'playing';
  const now = useClock(isCurrent && state.sleep.kind === 'minutes');

  const chapter = useMemo(() => manifest?.chapters.find((c) => c.id === lesson?.chapterId) ?? null, [manifest, lesson?.chapterId]);
  const courseTrackId = enrollment?.courseTrackId ?? null;

  const queueItem = useMemo<QueueItem | null>(() => {
    if (!lesson) return null;
    return lessonToQueueItem(lesson, { collectionTitle: manifest?.title ?? null, chapterTitle: chapter?.title ?? null, courseTrackId });
  }, [lesson, manifest?.title, chapter?.title, courseTrackId]);

  // Merge the server's position into the local store once the lesson arrives (local unsynced edits win).
  useEffect(() => {
    if (!runtime || !lesson || !queueItem || lessonQuery.data?.fromCache) return;
    void runtime.progress
      .mergeServer(lesson.id, lesson.progress, { title: queueItem.title, subtitle: queueItem.subtitle, collectionId: lesson.collectionId, chapterId: lesson.chapterId, artworkUri: queueItem.artworkUri, courseTrackId }, lesson.durationMs)
      .then(() => progress.refresh());
    void runtime.bookmarks.mergeServer(lesson.id, lesson.bookmarks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, lesson?.id, lessonQuery.data?.fromCache]);

  const start = useCallback(
    async (play: boolean): Promise<void> => {
      if (!runtime || !lessonId) return;
      setStartError(null);
      const engine = runtime.engine;
      if (currentItem(engine.getState())?.id === lessonId) {
        if (play) await engine.play();
        return;
      }
      const local = await runtime.progress.get(lessonId);
      const durationMs = lesson?.durationMs ?? local?.durationMs ?? null;
      const positionMs = local ? resumePosition(local.positionMs, durationMs, local.completed) : lesson?.progress ? resumePosition(lesson.progress.positionMs, durationMs, lesson.progress.completed) : 0;
      let queue: QueueItem[] = [];
      if (manifest) queue = buildQueue(manifest, { courseTrackId });
      if (queueIndexOf(queue, lessonId) < 0 && queueItem) queue = [queueItem];
      if (queue.length === 0) {
        // Offline without any cached catalog: fall back to the download index.
        queue = queueFromDownloads(await runtime.index.list());
      }
      const index = queueIndexOf(queue, lessonId);
      if (index < 0) {
        setStartError(new Error('This lesson has no playable audio.'));
        return;
      }
      startedFor.current = lessonId;
      await engine.setQueue(queue, index, { positionMs, autoplay: play });
    },
    [runtime, lessonId, lesson, manifest, queueItem, courseTrackId],
  );

  // Auto-start once per lesson when data is available (manifest optional).
  useEffect(() => {
    if (!runtime || !lessonId || startedFor.current === lessonId) return;
    if (currentItem(state)?.id === lessonId) {
      startedFor.current = lessonId;
      return;
    }
    const ready = Boolean(queueItem) && (manifest !== null || manifestQuery.isError || !lesson?.collectionId);
    if (!ready) return;
    void start(autoplay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, lessonId, queueItem, manifest, manifestQuery.isError, autoplay]);

  const localPosition = progress.data?.positionMs ?? lesson?.progress?.positionMs ?? 0;

  const controller = useMemo<AudioPlayerController>(() => {
    const engine = runtime?.engine ?? null;
    return {
      status: isCurrent ? toUiStatus(state.status) : lesson ? 'paused' : 'loading',
      positionMs: isCurrent ? state.positionMs : resumePosition(localPosition, lesson?.durationMs ?? null, progress.data?.completed ?? false),
      durationMs: isCurrent ? (state.durationMs ?? lesson?.durationMs ?? null) : (lesson?.durationMs ?? null),
      rate: state.rate,
      play: () => void (isCurrent && engine ? engine.play() : start(true)),
      pause: () => engine?.pause('user'),
      seekTo: (ms) => void (isCurrent && engine ? engine.seekTo(ms) : start(false).then(() => engine?.seekTo(ms))),
      setRate: (rate: PlaybackRate) => engine?.setRate(rate),
      sleepRemainingMs: isCurrent && state.sleep.kind === 'minutes' ? Math.max(0, state.sleep.endsAt - now) : null,
      setSleepTimer: (minutes) => engine?.setSleepTimer(minutes),
    };
  }, [runtime, isCurrent, state, lesson, localPosition, progress.data?.completed, start, now]);

  const mediaReason: MediaUnavailableReason | null = isCurrent && state.error ? mediaReasonFromEngineError(state.error) : startError ? 'not_found' : lessonQuery.error && !lesson ? mediaUnavailableReason(lessonQuery.error) : null;

  return {
    lesson,
    lessonLoading: lessonQuery.isLoading,
    lessonError: lessonQuery.error,
    refetchLesson: () => void lessonQuery.refetch(),
    fromCache: lessonQuery.data?.fromCache ?? false,
    queueItem,
    isCurrent,
    state,
    controller,
    mediaReason,
    start,
    collectionTitle: manifest?.title ?? null,
    chapterTitle: chapter?.title ?? null,
    playing,
  };
}
