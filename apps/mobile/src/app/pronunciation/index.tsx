import { getCourseTrack, type MissionExpression, type SpeechEvaluationResult } from '@langquest/contracts';
import { Chip, EmptyState, IconButton, InfoAffordance, LessonAccentScope, PronunciationFeedback, Row, SpeakButton, SpeechStateIndicator, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Melo } from '@/components/Melo';
import { Screen } from '@/components/Screen';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { formsForScriptMode, sourceTextDirection } from '@/features/lesson/forms';
import { usePathway } from '@/features/missions/use-pathway';
import { withoutNumericScore } from '@/features/session/capabilities';
import { useActiveEnrollment, useMissionDetail } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { createClipPlayer, materialiseClip } from '@/lib/clip-player';
import { useExtraLabels } from '@/lib/extra-labels';
import { haptic } from '@/lib/haptics';
import { newUuid } from '@/lib/ids';
import { useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { requestMicPermission, useRecorder, type MicPermission } from '@/lib/recorder';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/**
 * Screen 6: pronunciation coach (calm density): the target phrase, reference playback icons, ONE primary
 * action (the mic) and the honest feedback. The honesty note, what the assessor can measure and the
 * tips live behind the header ⓘ. Rendered only when the enrollment's capability snapshot offers spoken
 * feedback for mission expressions (CONVENTIONS §8). A numeric score appears only when the pair's assessor
 * is acoustic: the result's `assessmentMode` AND the snapshot must agree — otherwise the number is dropped
 * client-side and the screen is listen-and-compare only, with no "not available" copy.
 */
export default function PronunciationCoach(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const labels = useUiLabels();
  const { api, online } = useServices();
  const params = useLocalSearchParams<{ missionId?: string; expressionId?: string }>();
  const { enrollment } = useActiveEnrollment();
  const nav = useEnrollmentNavigation(enrollment);
  const { pathway } = usePathway(nav.pronunciationDrills ? enrollment : null);
  const missionId = params.missionId ?? pathway?.next?.mission.id ?? null;
  const mission = useMissionDetail(missionId, nav.pronunciationDrills ? enrollment : null);
  const recorder = useRecorder();
  const player = useMemo(() => createClipPlayer(), []);
  const tapToTalk = usePrefs((s) => s.tapToTalk);
  const [selected, setSelected] = useState<string | null>(params.expressionId ?? null);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'assessing' | 'result'>('idle');
  const [result, setResult] = useState<SpeechEvaluationResult | null>(null);
  const [myClipUri, setMyClipUri] = useState<string | null>(null);
  const [permission, setPermission] = useState<MicPermission | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => () => player.dispose(), [player]);

  const expressions = useMemo(() => (mission.data?.data.steps ?? []).flatMap((s) => s.expressions).filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i), [mission.data]);
  const expression: MissionExpression | null = expressions.find((e) => e.id === selected) ?? expressions[0] ?? null;
  const trackDef = enrollment ? getCourseTrack(enrollment.courseTrackId) : null;
  const reference = expression?.audio.find((a) => a.asset.publicUrl) ?? null;
  const slowReference = expression?.audio.find((a) => a.speechRate === 'slow' && a.asset.publicUrl) ?? null;
  const sourceDir = sourceTextDirection(enrollment?.sourceLanguageCode);

  const record = async (): Promise<void> => {
    const p = permission === 'granted' ? 'granted' : await requestMicPermission();
    setPermission(p);
    if (p !== 'granted') return;
    player.stop();
    await recorder.start();
    setPhase('recording');
  };
  const stop = async (): Promise<void> => {
    const clip = await recorder.stop();
    if (!clip || !expression || !enrollment || !trackDef) {
      setPhase('idle');
      setError(clip ? null : new Error(t('speak.noSpeech')));
      return;
    }
    setPhase('assessing');
    setError(null);
    try {
      setMyClipUri(await materialiseClip(clip.base64, clip.encoding === 'wav' ? 'audio/wav' : clip.encoding === 'webm_opus' ? 'audio/webm' : 'audio/mp4'));
      const res = await api.pronunciationAssess({
        enrollmentId: enrollment.id,
        targetVarietyId: trackDef.targetVarietyId,
        expressionId: expression.id,
        audio: { source: 'inline', base64: clip.base64, encoding: clip.encoding, sampleRateHz: clip.sampleRateHz },
        requestedFeatures: trackDef.tonal ? ['word', 'phoneme', 'tone', 'prosody'] : ['word', 'phoneme', 'prosody'],
        clientRequestId: newUuid(),
      });
      setResult(withoutNumericScore(res, nav));
      setPhase('result');
      track.speakingTime(Math.round(clip.durationMs / 1000), 'drill');
      void haptic('success');
    } catch (e) {
      setError(e);
      setPhase('idle');
    }
  };

  if (enrollment && !nav.pronunciationDrills) return <Redirect href="/(tabs)" />;
  const speechState = phase === 'recording' ? 'learner_mic_active' : phase === 'assessing' ? 'thinking' : player.playing ? 'character_speaking' : 'idle';
  const mascotState = phase === 'recording' ? 'listening' : phase === 'assessing' ? 'thinking' : player.playing ? 'quiet_audio' : result ? (result.intelligibility === 'understood' ? 'success' : 'encouraging') : 'neutral';
  const about = [nav.numericScore ? t('enrollment.disclaimer.includes.pronunciationAcoustic') : t('enrollment.disclaimer.includes.pronunciationReference'), t('pronunciation.honesty'), t('pronunciation.feedback.accentRespect'), ...(reference?.synthetic ? [X.syntheticReference] : []), t('pronunciation.tipListen'), t('pronunciation.tipSlow'), t('pronunciation.tipShadow')];
  return (
    <LessonAccentScope lessonType="pronunciation_drill" courseTrackId={enrollment?.courseTrackId ?? null}>
      <Screen title={t('pronunciation.title')} onBack={() => router.back()} headerEnd={<InfoAffordance label={t('pronunciation.aboutFeedback')} title={t('pronunciation.title')} text={about} />}>
        {!enrollment ? <EmptyState title={t('home.noCourse')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} /> : null}
        {mission.isLoading ? <LoadingView rows={1} /> : null}
        {mission.error && !mission.data ? <ErrorView error={mission.error} onRetry={() => void mission.refetch()} /> : null}
        {expressions.length > 1 ? (
          <Row gap={theme.spacing.xs} wrap>
            {expressions.map((e) => (
              <Chip key={e.id} label={e.meaning} selected={expression?.id === e.id} onPress={() => { setSelected(e.id); setResult(null); setPhase('idle'); }} />
            ))}
          </Row>
        ) : null}
        {expression && trackDef ? (
          <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
            {formsForScriptMode(expression, trackDef.scripts.primary, enrollment!.scriptMode).map((f, i) => (
              <ThemedText key={i} variant={f.transliterationScheme ? 'transliteration' : 'phrase'} script={f.script} tone={f.transliterationScheme ? 'muted' : 'primary'}>{f.text}</ThemedText>
            ))}
            <ThemedText tone="secondary" direction={sourceDir}>{expression.meaning}</ThemedText>
            {/* No reference audio → no playback icons (§8). */}
            <Row gap={theme.spacing.xs} wrap>
              {reference ? <IconButton icon="play" accessibilityLabel={t('pronunciation.playReference')} onPress={() => void player.playUri(reference.asset.publicUrl!, 1)} /> : null}
              {reference ? <IconButton icon="slow" accessibilityLabel={t('lesson.slow')} onPress={() => void player.playUri((slowReference ?? reference).asset.publicUrl!, slowReference ? 1 : 0.75)} /> : null}
              {myClipUri ? <IconButton icon="volume" accessibilityLabel={t('pronunciation.playYours')} onPress={() => void player.playUri(myClipUri, 1)} /> : null}
            </Row>
          </Surface>
        ) : null}
        <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Row gap={theme.spacing.sm} align="center">
            <Melo state={mascotState} size={56} animate={false} testID="pronunciation-mascot" />
            <SpeechStateIndicator state={speechState} labels={labels.speechStates} shortLabels={labels.speechStatesShort} compact />
          </Row>
          <SpeakButton mode={tapToTalk ? 'toggle' : 'hold'} state={phase === 'recording' ? 'recording' : phase === 'assessing' ? 'processing' : !expression || permission === 'denied' ? 'disabled' : 'idle'} onStart={() => void record()} onStop={() => void stop()} onHaptic={(k) => void haptic(k)} labels={labels.speakButton} onModeChange={(m) => usePrefs.getState().set({ tapToTalk: m === 'toggle' })} />
          {permission === 'denied' ? <StatusLine icon="micOff" tone="warning" text={t('errors.permission.micDenied')} /> : null}
          {!online ? <StatusLine icon="offline" tone="warning" text={t('errors.network')} /> : null}
          {error ? <ErrorView error={error} /> : null}
        </View>
        {result && trackDef ? (
          <PronunciationFeedback result={result} targetScript={trackDef.scripts.primary} onRetry={() => { setResult(null); setPhase('idle'); }} onReplayReference={reference ? () => void player.playUri(reference.asset.publicUrl!, 1) : undefined} onReplaySlow={reference ? () => void player.playUri((slowReference ?? reference).asset.publicUrl!, slowReference ? 1 : 0.75) : undefined} labels={labels.pronunciation} calmLabels={{ details: t('common.details'), hideDetails: t('common.hideDetails') }} intelligibilityLabels={labels.intelligibility} />
        ) : null}
      </Screen>
    </LessonAccentScope>
  );
}
