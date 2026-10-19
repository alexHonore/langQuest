import { getCourseTrack, type MissionExpression, type SpeechEvaluationResult } from '@langquest/contracts';
import { Button, Chip, EmptyState, PronunciationFeedback, Row, SpeakButton, SpeechStateIndicator, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { formsForScriptMode, sourceTextDirection } from '@/features/lesson/forms';
import { usePathway } from '@/features/missions/use-pathway';
import { useActiveEnrollment, useCapabilities, useMissionDetail } from '@/features/session/queries';
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
 * Screen 6: pronunciation coach. Reference audio, record/retry, feedback.
 * A numeric score appears only when the result's assessmentMode is acoustic
 * (`pronunciationDisplay` in the ui package enforces it); otherwise the
 * honest "not yet available" line and listen-and-compare guidance.
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
  const { pathway } = usePathway(enrollment);
  const missionId = params.missionId ?? pathway?.next?.mission.id ?? null;
  const mission = useMissionDetail(missionId, enrollment);
  // Capability claims come from the live registry (cached per track for offline), never from the static catalog.
  const capabilities = useCapabilities(enrollment);
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
  const scoring = capabilities.data?.data.pronunciationScoring ?? null;
  const scoringText = scoring ? t(`catalog.scoringSupport.${scoring === 'none' ? 'limited' : scoring}`) : capabilities.isLoading ? X.checkingAssessor : X.assessorUnconfirmed;
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
      setResult(res);
      setPhase('result');
      track.speakingTime(Math.round(clip.durationMs / 1000), 'drill');
      void haptic('success');
    } catch (e) {
      setError(e);
      setPhase('idle');
    }
  };

  return (
    <Screen title={t('pronunciation.title')} onBack={() => router.back()}>
      {!enrollment ? <EmptyState title={t('home.noCourse')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} /> : null}
      {mission.isLoading ? <LoadingView rows={1} /> : null}
      {mission.error && !mission.data ? <ErrorView error={mission.error} onRetry={() => void mission.refetch()} /> : null}
      <StatusLine icon="info" tone={scoring === 'full' ? 'success' : 'info'} text={scoringText} />
      {capabilities.data?.fromCache ? <ThemedText variant="caption" tone="muted">{t('errors.offlineLessonsAvailable')}</ThemedText> : null}
      <ThemedText variant="caption" tone="muted">
        {t('pronunciation.honesty')} {t('pronunciation.feedback.accentRespect')}
      </ThemedText>
      {expressions.length > 1 ? (
        <Row gap={theme.spacing.xs} wrap>
          {expressions.map((e) => (
            <Chip key={e.id} label={e.meaning} selected={expression?.id === e.id} onPress={() => { setSelected(e.id); setResult(null); setPhase('idle'); }} />
          ))}
        </Row>
      ) : null}
      {expression && trackDef ? (
        <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
          <ThemedText variant="caption" tone="muted">{t('pronunciation.targetPhrase')}</ThemedText>
          {formsForScriptMode(expression, trackDef.scripts.primary, enrollment!.scriptMode).map((f, i) => (
            <ThemedText key={i} variant={f.transliterationScheme ? 'transliteration' : 'phrase'} script={f.script} tone={f.transliterationScheme ? 'muted' : 'primary'}>{f.text}</ThemedText>
          ))}
          <ThemedText tone="secondary" direction={sourceDir}>{expression.meaning}</ThemedText>
          <Row gap={theme.spacing.xs} wrap>
            <Button label={t('pronunciation.playReference')} icon="play" variant="secondary" size="sm" disabled={!reference} onPress={() => void player.playUri(reference!.asset.publicUrl!, 1)} accessibilityLabel={t('pronunciation.playReference')} />
            <Button label={t('lesson.slow')} icon="slow" variant="secondary" size="sm" disabled={!reference} onPress={() => void player.playUri((slowReference ?? reference)!.asset.publicUrl!, slowReference ? 1 : 0.75)} accessibilityLabel={t('lesson.slow')} />
            {myClipUri ? <Button label={t('pronunciation.playYours')} icon="volume" variant="ghost" size="sm" onPress={() => void player.playUri(myClipUri, 1)} accessibilityLabel={t('pronunciation.playYours')} /> : null}
          </Row>
          {!reference ? <ThemedText variant="caption" tone="muted">{t('pronunciation.referenceAudio')}: {t('common.notAvailable')}</ThemedText> : null}
          {reference?.synthetic ? <ThemedText variant="caption" tone="muted">{X.syntheticReference}</ThemedText> : null}
        </Surface>
      ) : mission.data ? (
        <EmptyState title={t('common.notAvailable')} description={t('pronunciation.tipListen')} mascotState="quiet_audio" />
      ) : null}
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <SpeechStateIndicator state={phase === 'recording' ? 'learner_mic_active' : phase === 'assessing' ? 'thinking' : player.playing ? 'character_speaking' : 'idle'} labels={labels.speechStates} compact />
        <SpeakButton mode={tapToTalk ? 'toggle' : 'hold'} state={phase === 'recording' ? 'recording' : phase === 'assessing' ? 'processing' : !expression || permission === 'denied' ? 'disabled' : 'idle'} onStart={() => void record()} onStop={() => void stop()} onHaptic={(k) => void haptic(k)} labels={labels.speakButton} showModeSwitch onModeChange={(m) => usePrefs.getState().set({ tapToTalk: m === 'toggle' })} />
        {permission === 'denied' ? <StatusLine icon="micOff" tone="warning" text={t('errors.permission.micDenied')} /> : null}
        {!online ? <StatusLine icon="offline" tone="warning" text={t('errors.network')} /> : null}
        {error ? <ErrorView error={error} /> : null}
      </View>
      {result && trackDef ? (
        <PronunciationFeedback result={result} targetScript={trackDef.scripts.primary} onRetry={() => { setResult(null); setPhase('idle'); }} onReplayReference={reference ? () => void player.playUri(reference.asset.publicUrl!, 1) : undefined} onReplaySlow={reference ? () => void player.playUri((slowReference ?? reference).asset.publicUrl!, slowReference ? 1 : 0.75) : undefined} labels={labels.pronunciation} intelligibilityLabels={labels.intelligibility} />
      ) : null}
      <Surface variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: 2 }}>
        <ThemedText variant="label">{t('pronunciation.tipsTitle')}</ThemedText>
        <ThemedText variant="caption" tone="secondary">{t('pronunciation.tipListen')}</ThemedText>
        <ThemedText variant="caption" tone="secondary">{t('pronunciation.tipSlow')}</ThemedText>
        <ThemedText variant="caption" tone="secondary">{t('pronunciation.tipShadow')}</ThemedText>
      </Surface>
    </Screen>
  );
}
