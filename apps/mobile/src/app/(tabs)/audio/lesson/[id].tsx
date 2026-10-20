import { AudioPlayer, Button, Chip, IconButton, InfoAffordance, LessonAccentScope, Row, StatusLine, Surface, ThemedText, formatDurationMs, useTheme, type AUDIO_LABELS } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { SKIP_BACK_MS, SKIP_FORWARD_MS } from '@/audio/engine-state';
import { loopBoundsFor, nearestSegmentIndex, type TranscriptSegment } from '@/audio/transcript-sync';
import { CoverArt } from '@/features/audio/components/CoverArt';
import { DownloadControls } from '@/features/audio/components/DownloadControls';
import { MediaNotice } from '@/features/audio/components/MediaNotice';
import { TranscriptPanel } from '@/features/audio/components/TranscriptPanel';
import { useAudioLabels } from '@/features/audio/labels';
import { practiceSegmentIds } from '@/features/audio/practice-scope';
import { useTranscript } from '@/features/audio/queries';
import { useAudioRuntime, useEngineEvents, useLessonBookmarks } from '@/features/audio/use-audio';
import { useLessonPlayer } from '@/features/audio/use-lesson-player';
import { useActiveEnrollment } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { usePrefs } from '@/state/prefs';

/**
 * Full player (§10.2B screen 7, Phase 3/8, calm density): artwork, seek, speed with pitch
 * correction, skip, prev/next lesson, sleep timer, transcript follow-along with A/B loop and
 * save-to-review, bookmarks, download and "Practice this with AI". Attribution, speakers,
 * description, tags and the practice note sit behind the header ⓘ. Honest states when media
 * cannot be served. Lantern accents follow the `listening_comprehension` lesson type.
 */
export default function LessonPlayerScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const L = useAudioLabels();
  const params = useLocalSearchParams<{ id: string; autoplay?: string }>();
  const lessonId = params.id ?? null;
  const { enrollment } = useActiveEnrollment();
  const nav = useEnrollmentNavigation(enrollment);
  const runtime = useAudioRuntime();
  const captionsDefault = usePrefs((s) => s.captionsDefaultOn);
  const player = useLessonPlayer(lessonId, enrollment, params.autoplay !== '0');
  const { lesson, state, controller, isCurrent } = player;
  const [transcriptOpen, setTranscriptOpen] = useState(captionsDefault);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((text: string, ms = 4000): void => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const transcriptEnabled = Boolean(lesson && lesson.transcriptStatus !== 'none' && lesson.transcriptStatus !== 'failed');
  const transcriptQuery = useTranscript(lessonId, enrollment?.sourceLanguageCode ?? null, enrollment?.id ?? null, transcriptEnabled && transcriptOpen);
  const transcript = transcriptQuery.data?.data ?? null;
  const bookmarks = useLessonBookmarks(lessonId);
  const savedSegmentIds = useMemo(() => new Set(bookmarks.data.filter((b) => b.segmentId).map((b) => b.segmentId!)), [bookmarks.data]);

  useEngineEvents((event) => {
    if (event.type === 'url_renewed') showNotice(L.renewedLink);
    else if (event.type === 'interrupted') showNotice(L.interrupted);
    else if (event.type === 'sleep_fired') showNotice(L.sleepTimerFired);
  });

  const engine = runtime?.engine ?? null;
  const positionMs = controller.positionMs;
  const durationMs = controller.durationMs;

  const addBookmark = async (segment?: TranscriptSegment): Promise<void> => {
    if (!runtime || !lessonId) return;
    await runtime.bookmarks.add({ lessonId, positionMs, segmentId: segment?.id ?? null, expressionText: segment?.text ?? null, expressionTranslation: segment?.translation?.text ?? null, note: segment ? segment.text : null });
    bookmarks.reload();
    void haptic('success');
    showNotice(segment ? L.savedExpression : t('audio.player.bookmarkAdded', { position: formatDurationMs(positionMs) }), 3000);
  };

  const repeatSentence = (): void => {
    if (!transcript || !engine || !isCurrent) return;
    const idx = nearestSegmentIndex(transcript.segments, state.positionMs);
    if (idx < 0) return;
    const bounds = loopBoundsFor(transcript.segments, idx, { durationMs: state.durationMs });
    if (bounds) engine.setLoop(bounds);
  };

  /**
   * "Practice this with AI": the conversation is scoped to this lesson (`scope.kind = 'audio_lesson'`), carrying
   * the transcript segments the learner saved plus the one currently playing, so the character is grounded in
   * exactly what was heard. A linked mission is passed too (the server keeps both).
   */
  const practice = (): void => {
    if (!enrollment || !lesson) return;
    engine?.pause('user');
    const missionId = lesson.linkedMissionIds[0];
    const segmentIds = practiceSegmentIds(transcript?.segments ?? null, positionMs, savedSegmentIds);
    router.push({
      pathname: '/conversation',
      params: { enrollmentId: enrollment.id, ...(missionId ? { missionId } : {}), audioLessonId: lesson.id, ...(segmentIds.length > 0 ? { transcriptSegmentIds: segmentIds.join(',') } : {}) },
    });
  };

  const sleep = isCurrent ? state.sleep : { kind: 'off' as const };
  const about = lesson
    ? [
        ...lesson.speakers.map((s) => `${t('audio.attribution', { speaker: s.displayName })}${s.synthetic ? ` · ${L.synthetic}` : ''}`),
        ...(lesson.attributionText ? [lesson.attributionText] : []),
        ...(lesson.description ? [lesson.description] : []),
        ...(lesson.tags.length > 0 ? [lesson.tags.join(' · ')] : []),
        L.originalAudio,
        t('audio.player.backgroundNote'),
        ...(enrollment ? [lesson.linkedMissionIds.length > 0 ? L.practiceLinked : L.practiceNote] : []),
      ]
    : [];

  return (
    <LessonAccentScope lessonType="listening_comprehension" courseTrackId={enrollment?.courseTrackId ?? null}>
    <Screen insideTabs title={lesson?.title ?? t('audio.title')} onBack={() => router.back()} headerEnd={lesson ? <InfoAffordance label={t('audio.aboutLesson')} title={lesson.title} text={about} /> : undefined}>
      {player.lessonLoading && !lesson ? <LoadingView /> : null}
      {player.lessonError && !lesson ? <ErrorView error={player.lessonError} onRetry={player.refetchLesson} /> : null}
      {player.fromCache ? <CacheNotice fetchedAt={null} /> : null}
      {lesson ? (
        <>
          <MediaNotice reason={player.mediaReason} detail={isCurrent ? state.error?.message : null} />
          {notice ? <StatusLine icon="info" tone="info" text={notice} /> : null}
          {isCurrent && state.pauseReason === 'interrupted' && !notice ? <StatusLine icon="info" tone="warning" text={L.interrupted} /> : null}
          <AudioPlayer
            testID="audio-player"
            controller={controller}
            title={lesson.title}
            subtitle={player.queueItem?.subtitle ?? null}
            artwork={<CoverArt imageUri={lesson.coverArt?.publicUrl} courseTrackId={enrollment?.courseTrackId ?? null} title={lesson.title} size={96} square />}
            skipSeconds={15}
            transcript={{ available: transcriptEnabled, visible: transcriptOpen, onToggle: () => setTranscriptOpen((v) => !v) }}
            onBookmark={() => void addBookmark()}
            onPracticeWithAi={enrollment ? practice : undefined}
            onRepeatSentence={transcript && isCurrent ? repeatSentence : undefined}
            sleepOptionsMinutes={[15, 30, 45, 60]}
            errorText={state.error?.message ?? null}
            attributionText={lesson.attributionText}
            labels={{
              play: t('audio.player.play'),
              pause: t('audio.player.pause'),
              skipBack: (s: number) => t('audio.player.skipBack', { seconds: s }),
              skipForward: (s: number) => t('audio.player.skipForward', { seconds: s }),
              speed: (r: number) => t('audio.player.speed', { rate: r }),
              sleepTimer: t('audio.player.sleepTimer'),
              sleepOff: t('audio.player.sleepTimerOff'),
              transcript: t('audio.player.transcript'),
              bookmark: t('audio.player.bookmark'),
              practice: t('audio.player.practiceWithAi'),
              repeatSentence: t('audio.player.repeatSentence'),
              position: (cur: string, total: string) => t('audio.player.position', { current: cur, total }),
              error: t('errors.audioPlayback'),
              loading: t('common.loading'),
            } as Partial<typeof AUDIO_LABELS>}
          />
          <Row gap={theme.spacing.sm} justify="space-between" align="center">
            <IconButton icon="chevronLeft" accessibilityLabel={t('audio.player.previousChapter')} onPress={() => void engine?.previous()} disabled={!isCurrent} mirrorRtl />
            <Row gap={theme.spacing.xs} wrap justify="center" style={{ flex: 1 }}>
              <Chip label={`−${SKIP_BACK_MS / 1000}s`} onPress={() => void (isCurrent ? engine?.skipBack() : controller.seekTo(positionMs - SKIP_BACK_MS))} accessibilityLabel={t('audio.player.skipBack', { seconds: SKIP_BACK_MS / 1000 })} />
              <Chip label={`+${SKIP_FORWARD_MS / 1000}s`} onPress={() => void (isCurrent ? engine?.skipForward() : controller.seekTo(positionMs + SKIP_FORWARD_MS))} accessibilityLabel={t('audio.player.skipForward', { seconds: SKIP_FORWARD_MS / 1000 })} />
              <Chip label={t('audio.player.sleepTimerEndOfChapter')} icon="sleep" selected={sleep.kind === 'end_of_item'} onPress={() => engine?.setSleepTimer(sleep.kind === 'end_of_item' ? null : 'end_of_item')} />
              {isCurrent && state.loop ? <Chip label={L.loopOff} icon="close" tone="accent" onPress={() => engine?.setLoop(null)} /> : null}
            </Row>
            <IconButton icon="chevronRight" accessibilityLabel={t('audio.player.nextChapter')} onPress={() => void engine?.next()} disabled={!isCurrent || !engine?.hasNext} mirrorRtl />
          </Row>
          {isCurrent && state.source?.kind === 'local' ? <StatusLine icon="offline" tone="success" text={t('audio.download.downloaded')} /> : null}

          {transcriptOpen ? (
            <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.sm }}>
              {!transcriptEnabled ? <ThemedText tone="muted">{L.transcriptNone}</ThemedText> : null}
              {transcriptEnabled && lesson.transcriptStatus === 'pending' ? <ThemedText tone="muted">{L.transcriptPending}</ThemedText> : null}
              {transcriptEnabled && transcriptQuery.isLoading ? <LoadingView rows={1} /> : null}
              {transcriptEnabled && transcriptQuery.error && !transcript ? <ErrorView error={transcriptQuery.error} onRetry={() => void transcriptQuery.refetch()} /> : null}
              {transcript ? (
                <TranscriptPanel
                  transcript={transcript}
                  positionMs={positionMs}
                  durationMs={durationMs}
                  loop={isCurrent ? state.loop : null}
                  translationLanguage={enrollment?.sourceLanguageCode ?? null}
                  savedSegmentIds={savedSegmentIds}
                  onSeek={(ms) => controller.seekTo(ms)}
                  onSetLoop={(loop) => {
                    if (!isCurrent) void player.start(true).then(() => engine?.setLoop(loop));
                    else engine?.setLoop(loop);
                  }}
                  onSaveExpression={(segment) => void addBookmark(segment)}
                  reducedMotion={theme.reducedMotion}
                />
              ) : null}
            </Surface>
          ) : null}

          {bookmarks.data.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <ThemedText variant="heading" accessibilityRole="header">
              {L.bookmarks}
            </ThemedText>
            {bookmarks.data.map((b) => (
              <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`${formatDurationMs(b.positionMs)} ${b.note ?? ''}`} onPress={() => controller.seekTo(b.positionMs)}>
                <Surface variant="glass" level={1} radius="md" padding={theme.spacing.sm}>
                  <Row gap={theme.spacing.sm} align="center">
                    <Chip label={formatDurationMs(b.positionMs)} icon="bookmark" />
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="label" numberOfLines={2}>
                        {b.expressionText ?? b.note ?? t('audio.player.bookmark')}
                      </ThemedText>
                      {b.expressionTranslation ? (
                        <ThemedText variant="caption" tone="secondary" numberOfLines={2}>
                          {b.expressionTranslation}
                        </ThemedText>
                      ) : null}
                    </View>
                    {b.sync !== 'synced' ? <Chip label={L.pendingSync} tone="warning" /> : null}
                  </Row>
                </Surface>
              </Pressable>
            ))}
          </View>
          ) : null}

          {nav.downloads ? <DownloadControls lessonId={lesson.id} offlineEligible={lesson.offlineEligible} meta={{ title: lesson.title, subtitle: player.queueItem?.subtitle ?? null, durationMs: lesson.durationMs, artworkUri: lesson.coverArt?.publicUrl ?? null, courseTrackId: enrollment?.courseTrackId ?? null }} /> : null}

          {!enrollment ? <Button label={t('home.addCourse')} variant="secondary" onPress={() => router.push('/catalog')} /> : null}
        </>
      ) : null}
    </Screen>
    </LessonAccentScope>
  );
}

