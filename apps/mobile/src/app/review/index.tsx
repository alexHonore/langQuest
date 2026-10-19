import { getCourseTrack, type ReviewRating } from '@langquest/contracts';
import { Button, Chip, EmptyState, Mascot, Row, SceneArtwork, SpeakButton, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { formsForScriptMode, sourceTextDirection } from '@/features/lesson/forms';
import { useActiveEnrollment, useInvalidateLearner, useReviewsDue } from '@/features/session/queries';
import { createClipPlayer } from '@/lib/clip-player';
import { haptic } from '@/lib/haptics';
import { nowMs } from '@/lib/ids';
import { useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { requestMicPermission, useRecorder } from '@/lib/recorder';
import { useServices } from '@/lib/services';
import { usePrefs } from '@/state/prefs';

const RATINGS: readonly ReviewRating[] = ['again', 'hard', 'good', 'easy'];

/**
 * Due reviews (§3.5, A17): each card is presented in a varied practical scenario,
 * the learner retrieves (optionally speaking it), then rates recall. Results go
 * through the outbox (`review_result`) so they sync idempotently even offline.
 */
export default function ReviewSession(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const labels = useUiLabels();
  const { enqueue } = useServices();
  const invalidate = useInvalidateLearner();
  const { enrollment } = useActiveEnrollment();
  const reviews = useReviewsDue(enrollment, 20);
  const recorder = useRecorder();
  const player = useMemo(() => createClipPlayer(), []);
  const tapToTalk = usePrefs((s) => s.tapToTalk);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [hints, setHints] = useState(0);
  const [replays, setReplays] = useState(0);
  const [recording, setRecording] = useState(false);
  const [spoke, setSpoke] = useState(false);
  const [startedAt, setStartedAt] = useState(() => nowMs());
  const [done, setDone] = useState(0);
  useEffect(() => () => player.dispose(), [player]);

  const items = reviews.data?.data.items ?? [];
  const item = items[index] ?? null;
  const trackDef = enrollment ? getCourseTrack(enrollment.courseTrackId) : null;
  const reference = item?.expression?.audio.find((a) => a.asset.publicUrl) ?? null;
  const sourceDir = sourceTextDirection(enrollment?.sourceLanguageCode);

  const rate = async (rating: ReviewRating): Promise<void> => {
    if (!item || !enrollment) return;
    await enqueue({ type: 'review_result', cardId: item.card.id, rating, hintsUsed: hints, replays, responseTimeMs: nowMs() - startedAt, scenarioId: item.scenario.id }, enrollment.id);
    void haptic(rating === 'again' ? 'error' : 'success');
    setDone(done + 1);
    setIndex(index + 1);
    setRevealed(false);
    setHints(0);
    setReplays(0);
    setSpoke(false);
    setStartedAt(nowMs());
  };

  return (
    <Screen title={t('progress.review.title')} onBack={() => router.back()}>
      {reviews.isLoading ? <LoadingView rows={1} /> : null}
      {reviews.error && !reviews.data ? <ErrorView error={reviews.error} onRetry={() => void reviews.refetch()} /> : null}
      {reviews.data?.fromCache ? <CacheNotice fetchedAt={reviews.data.fetchedAt} /> : null}
      {reviews.data && !item ? (
        <EmptyState
          title={t('progress.review.allDone')}
          description={t('progress.review.due', { count: 0 })}
          mascotState={done > 0 ? 'celebrate' : 'quiet_audio'}
          actionLabel={t('common.done')}
          onAction={async () => {
            await invalidate();
            router.back();
          }}
        />
      ) : null}
      {item && trackDef ? (
        <View style={{ gap: theme.spacing.md }}>
          <Row gap={theme.spacing.sm} justify="space-between">
            <Chip label={`${index + 1}/${items.length}`} />
            <Chip label={item.card.targetKind === 'skill' ? t('progress.skillMastery') : t('lesson.wordHelp')} tone="info" />
          </Row>
          <SceneArtwork sceneId="park" imageUri={item.scenario.sceneArt?.publicUrl ?? null} aspectRatio={2.4} overlay={<ThemedText tone="onAccent" align="center" direction={sourceDir}>{item.scenario.description}</ThemedText>} scrim />
          <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
            {item.expression ? (
              <>
                <ThemedText variant="caption" tone="muted">{t('lesson.anticipate')}</ThemedText>
                <ThemedText variant="heading" direction={sourceDir}>{item.expression.meaning}</ThemedText>
                {item.expression.contextNote ? <ThemedText variant="caption" tone="secondary" direction={sourceDir}>{item.expression.contextNote}</ThemedText> : null}
                {revealed ? (
                  <View style={{ gap: 2, marginTop: theme.spacing.sm }}>
                    {formsForScriptMode(item.expression, trackDef.scripts.primary, enrollment!.scriptMode).map((f, i) => (
                      <ThemedText key={i} variant={f.transliterationScheme ? 'transliteration' : 'phrase'} script={f.script} tone={f.transliterationScheme ? 'muted' : 'primary'}>{f.text}</ThemedText>
                    ))}
                  </View>
                ) : null}
              </>
            ) : item.skill ? (
              <>
                <ThemedText variant="caption" tone="muted">{t('progress.canDo')}</ThemedText>
                <ThemedText variant="heading">{item.skill.descriptor}</ThemedText>
              </>
            ) : null}
            <Row gap={theme.spacing.xs} wrap>
              {!revealed ? <Button label={t('progress.review.showAnswer')} size="sm" variant="secondary" onPress={() => { setRevealed(true); setHints(hints + 1); }} accessibilityLabel={t('progress.review.showAnswer')} /> : null}
              {reference ? <Button label={t('lesson.replay')} icon="play" size="sm" variant="secondary" onPress={() => { setReplays(replays + 1); void player.playUri(reference.asset.publicUrl!, 1); }} accessibilityLabel={t('lesson.replay')} /> : null}
            </Row>
          </Surface>
          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <SpeakButton
              mode={tapToTalk ? 'toggle' : 'hold'}
              size="compact"
              state={recording ? 'recording' : 'idle'}
              onStart={() => {
                void requestMicPermission().then(async (p) => {
                  if (p !== 'granted') return;
                  await recorder.start();
                  setRecording(true);
                });
              }}
              onStop={() => {
                void recorder.stop().then((clip) => {
                  setRecording(false);
                  setSpoke(Boolean(clip));
                });
              }}
              onHaptic={(k) => void haptic(k)}
              labels={labels.speakButton}
            />
            {spoke ? <StatusLine icon="check" tone="success" text={t('speak.noPenalty')} /> : <ThemedText variant="caption" tone="muted">{t('lesson.textAlternativeNote')}</ThemedText>}
          </View>
          <Row gap={theme.spacing.xs} wrap justify="center">
            {RATINGS.map((r) => (
              <Button key={r} label={t(`progress.review.${r}`)} variant={r === 'again' ? 'danger' : r === 'good' ? 'primary' : 'secondary'} onPress={() => void rate(r)} accessibilityLabel={t(`progress.review.${r}`)} />
            ))}
          </Row>
          <Mascot state={revealed ? 'encouraging' : 'curious'} size="icon" />
        </View>
      ) : null}
    </Screen>
  );
}
