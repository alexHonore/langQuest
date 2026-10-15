import { getCourseTrack, type ConversationMode, type ConversationSessionCreateResponse, type EnrollmentDto } from '@langquest/contracts';
import { Button, CharacterPortrait, Chip, HintSheet, IconButton, ProgressBar, Row, SceneArtwork, SpeakButton, SpeechStateIndicator, StatusLine, Surface, ThemedText, findCharacter, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { ConversationController, type ConversationSnapshot } from '@/features/conversation/controller';
import { levelToUnit } from '@/features/conversation/vad';
import { useActiveEnrollment, useInvalidateLearner } from '@/features/session/queries';
import { createClipPlayer } from '@/lib/clip-player';
import { haptic } from '@/lib/haptics';
import { localDateKey, newUuid, nowMs } from '@/lib/ids';
import { useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { requestMicPermission, useRecorder, type MicPermission } from '@/lib/recorder';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/** Screen 5: live AI character conversation (pipeline realtime, §8.3 machine, barge-in). */
export default function ConversationScreen(): React.JSX.Element {
  const router = useRouter();
  const t = useT();
  const { api } = useServices();
  const params = useLocalSearchParams<{ enrollmentId?: string; characterId?: string; missionId?: string; scenarioId?: string }>();
  const { enrollments, me } = useActiveEnrollment();
  const prefMode = usePrefs((s) => s.speakMode);
  const enrollment = enrollments.find((e) => e.id === params.enrollmentId) ?? enrollments[0] ?? null;
  const [session, setSession] = useState<ConversationSessionCreateResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [permission, setPermission] = useState<MicPermission | null>(null);
  const [clientSessionId] = useState(() => newUuid());

  const mode: ConversationMode = permission === 'denied' || permission === 'unavailable' ? 'text_only' : prefMode;

  useEffect(() => {
    if (!enrollment) return;
    let alive = true;
    (async () => {
      const p = prefMode === 'text_only' ? 'granted' : await requestMicPermission();
      if (!alive) return;
      setPermission(p);
      try {
        const res = await api.conversationSessionCreate({
          enrollmentId: enrollment.id,
          characterId: params.characterId,
          missionId: params.missionId,
          scenarioId: params.scenarioId,
          mode: p === 'granted' ? prefMode : 'text_only',
          clientSessionId,
          inputEncoding: Platform.OS === 'web' ? 'webm_opus' : 'm4a',
          speechRetention: me?.privacyOptions.store_speech_recordings,
        });
        if (alive) {
          setSession(res);
          track.conversationFunnel('session_created', 0);
        }
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollment?.id]);

  return (
    <Screen title={t('speak.title')} onBack={() => router.back()} scroll={false} enrollment={enrollment}>
      {!enrollment ? <ErrorView error={new Error(t('home.noCourse'))} /> : null}
      {!session && !error && enrollment ? <LoadingView rows={1} label={t('speak.state.preparing')} /> : null}
      {error ? <ErrorView error={error} onRetry={() => router.replace({ pathname: '/conversation', params })} /> : null}
      {session && enrollment ? <LiveConversation session={session} enrollment={enrollment} mode={mode} /> : null}
    </Screen>
  );
}

function LiveConversation({ session, enrollment, mode }: { session: ConversationSessionCreateResponse; enrollment: EnrollmentDto; mode: ConversationMode }): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const labels = useUiLabels();
  const { api, online, enqueue } = useServices();
  const invalidate = useInvalidateLearner();
  const recorder = useRecorder();
  const player = useMemo(() => createClipPlayer(), []);
  const tapToTalk = usePrefs((s) => s.tapToTalk);
  const captions = usePrefs((s) => s.captionsDefaultOn);
  const trackDef = getCourseTrack(enrollment.courseTrackId);
  const [snap, setSnap] = useState<ConversationSnapshot | null>(null);
  const [transcript, setTranscript] = useState(captions);
  const [gloss, setGloss] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [text, setText] = useState('');
  const [immediateCorrections, setImmediateCorrections] = useState(false);
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = nowMs();
  }, []);

  const controller = useMemo(
    () =>
      new ConversationController({
        session,
        mode,
        api: {
          turn: (id, body, signal) => api.conversationTurn(id, body, signal),
          transcribe: async (clip, _signal) => {
            return api.transcribe({ enrollmentId: enrollment.id, targetVarietyId: trackDef.targetVarietyId, audio: { source: 'inline', base64: clip.base64, encoding: clip.encoding, sampleRateHz: clip.sampleRateHz }, clientRequestId: newUuid() });
          },
          synthesize: (textToSpeak, speed) => api.synthesize({ enrollmentId: enrollment.id, targetVarietyId: trackDef.targetVarietyId, text: textToSpeak, speed, outputEncoding: 'mp3' }),
          end: (id, body) => api.conversationEnd(id, body),
        },
        audio: player,
        recorder,
        newId: newUuid,
        isOnline: () => online,
        onEvent: (event) => {
          if (event.type === 'barge_in') track.conversationFunnel('barge_in', null);
          if (event.type === 'command') track.conversationFunnel('command_used', null);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.session.sessionId],
  );

  useEffect(() => {
    const unsub = controller.subscribe(setSnap);
    void controller.start().then(() => controller.armHandsFree());
    return () => {
      unsub();
      controller.dispose();
      player.dispose();
    };
  }, [controller, player]);

  // Hands-free metering loop (real levels; nothing is drawn when the mic is off).
  useEffect(() => {
    if (mode !== 'hands_free' && mode !== 'push_to_talk') return;
    const timer = setInterval(() => {
      if (recorder.isRecording()) void controller.meter(recorder.level(), nowMs());
    }, 100);
    return () => clearInterval(timer);
  }, [controller, mode, recorder]);

  // Connectivity → machine.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (wasOnline.current && !online) controller.disconnect('offline');
    if (!wasOnline.current && online) controller.reconnect();
    wasOnline.current = online;
  }, [online, controller]);

  const characterName = session.character.name;
  const roster = findCharacter(session.character.id);
  const speechState = snap?.speechState ?? 'idle';
  const machineState = snap?.machine.state ?? 'preparing';
  const stateLabel = labels.conversationState(machineState, characterName);
  const ended = snap?.ended ?? null;

  const leave = (): void => {
    Alert.alert(t('speak.endConversation'), t('speak.endConversationHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('speak.controls.leave'),
        style: 'destructive',
        onPress: () => void finish('learner_ended'),
      },
    ]);
  };

  const finish = async (reason: 'learner_ended' | 'completed'): Promise<void> => {
    const res = await controller.end(reason);
    track.conversationFunnel('ended', snap?.machine.turnCount ?? null);
    const seconds = Math.round((snap?.speakingMs ?? 0) / 1000);
    if (seconds > 0) track.speakingTime(seconds, 'conversation');
    await enqueue({ type: 'activity_minutes', activityDate: localDateKey(), minutesActive: Math.max(1, Math.round((nowMs() - startedAt.current) / 60_000)), speakingSeconds: seconds }, enrollment.id);
    if (res) await invalidate();
  };

  useEffect(() => {
    if (machineState === 'finished' && !ended && !snap?.ending && snap?.machine.endedReason === 'completed') void finish('completed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineState]);

  if (ended) {
    const ev = ended.evaluation;
    return (
      <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingVertical: theme.spacing.md }}>
        <ThemedText variant="title" accessibilityRole="header">
          {t('missions.summary.title')}
        </ThemedText>
        <StatusLine icon="check" tone="success" text={t('speak.state.finished')} />
        <ThemedText>{t('missions.summary.objectivesMet', { count: ev.objectivesCompleted.length })}</ThemedText>
        <ThemedText tone="secondary">{ended.summary}</ThemedText>
        <ThemedText variant="label">{t('missions.summary.corrections')}</ThemedText>
        {ev.priorityCorrections.length === 0 ? <ThemedText tone="secondary">{t('missions.summary.correctionsNone')}</ThemedText> : null}
        {ev.priorityCorrections.slice(0, 2).map((c, i) => (
          <Surface key={i} variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: 2 }}>
            <Chip label={c.category.replace(/_/g, ' ')} />
            <ThemedText script={trackDef.scripts.primary}>{c.learnerUtterance}</ThemedText>
            <ThemedText script={trackDef.scripts.primary} tone="accent">{c.suggestedUtterance}</ThemedText>
            <ThemedText tone="secondary">{c.explanation}</ThemedText>
          </Surface>
        ))}
        <ThemedText tone="secondary">{t('missions.summary.reviewAdded', { count: ended.scheduledReviews.length })}</ThemedText>
        <ThemedText variant="caption" tone="muted">
          {labels.celebration.xp(ended.xpAwarded)} · {t('home.xpNote')} · {ended.transcriptRetained ? t('account.privacy.recordings') : t('account.privacy.speechRetention.none')}
        </ThemedText>
        <Button label={t('common.done')} size="lg" fullWidth onPress={() => router.back()} accessibilityLabel={t('common.done')} />
      </ScrollView>
    );
  }

  const canTalk = machineState === 'listening' || machineState === 'responding' || machineState === 'interrupted' || machineState === 'speech_detected';
  const speakButtonState = snap?.recording && machineState === 'speech_detected' ? 'recording' : machineState === 'interpreting' ? 'processing' : canTalk ? 'idle' : 'disabled';

  return (
    <View style={{ flex: 1, gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }}>
      <Row gap={theme.spacing.sm} justify="space-between">
        <SpeechStateIndicator state={speechState} labels={{ ...labels.speechStatesFor(characterName), [speechState]: stateLabel }} detail={snap?.notice ? (snap.notice.code === 'offline' ? t('errors.reconnectingDetail') : snap.notice.code === 'no_speech' ? t('speak.noSpeech') : snap.notice.code === 'tts_unavailable' ? t('errors.providerUnavailable') : snap.notice.code) : null} compact />
        <IconButton icon="close" accessibilityLabel={t('speak.controls.leave')} onPress={leave} />
      </Row>
      {!session.capabilities.realtime.supported ? <StatusLine icon="info" tone="warning" text={t('speak.providerFallback')} /> : null}
      <SceneArtwork sceneId="cafe" aspectRatio={2.4} overlay={<CharacterPortrait characterId={roster?.id ?? session.character.id} expression={snap?.lastCharacterTurn?.expression ?? 'neutral'} speechState={speechState} name={characterName} subtitle={roster ? `${roster.role} · ${roster.city}` : session.character.role} size={96} stateLabels={labels.speechStatesFor(characterName)} />} overlayPosition="center" scrim />
      <ThemedText variant="caption" tone="muted">
        {t('speak.sourceLanguageNote', { source: enrollment.sourceLanguageCode, name: characterName, target: trackDef.displayName })} {session.character.syntheticVoice ? `· ${t('audio.coverGenerated').replace(/cover art/i, 'voice')}` : ''}
      </ThemedText>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.spacing.sm }}>
        {(snap?.turns ?? []).map((turn) => {
          const learner = turn.role === 'learner';
          if (!transcript && learner) return null;
          return (
            <Surface key={turn.id} variant={learner ? 'accentSoft' : 'surface'} bordered radius="md" padding={theme.spacing.md} style={{ alignSelf: learner ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 2 }}>
              <ThemedText variant="caption" tone="muted">
                {learner ? t('speak.turnLabel.learner') : t('speak.turnLabel.character', { name: characterName })}
              </ThemedText>
              <ThemedText script={trackDef.scripts.primary}>{turn.text}</ThemedText>
              {turn.transliteration && enrollment.scriptMode !== 'native' ? <ThemedText variant="transliteration" tone="muted">{turn.transliteration}</ThemedText> : null}
              {gloss && turn.sourceGloss ? <ThemedText tone="secondary">{turn.sourceGloss}</ThemedText> : null}
              {learner && turn.confidence !== null && turn.confidence < 0.5 ? <ThemedText variant="caption" tone="warning">{t('speak.lowConfidence')}</ThemedText> : null}
            </Surface>
          );
        })}
        {snap?.objectivesCompleted.length ? (
          <Row gap={theme.spacing.xs} wrap>
            {session.objectives.map((o) => (
              <Chip key={o.id} label={o.description} tone={snap.objectivesCompleted.includes(o.id) ? 'success' : 'neutral'} icon={snap.objectivesCompleted.includes(o.id) ? 'check' : undefined} />
            ))}
          </Row>
        ) : null}
      </ScrollView>

      {mode === 'hands_free' ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="caption" tone="muted">
            {t('speak.handsFreeOn')} · {t('speak.micLevel', { level: levelToUnit(recorder.level()) })}
          </ThemedText>
          <ProgressBar value={snap?.micLevel ?? 0} accessibilityLabel={t('speak.noFakeWaveform')} tone="info" height={6} />
        </View>
      ) : null}

      {mode === 'text_only' ? (
        <Row gap={theme.spacing.xs}>
          <TextInput value={text} onChangeText={setText} placeholder={t('lesson.typePlaceholder')} placeholderTextColor={theme.colors.textMuted} accessibilityLabel={t('lesson.typePlaceholder')} style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
          <Button
            label={t('lesson.speak')}
            disabled={!text.trim()}
            onPress={() => {
              void controller.submitText(text);
              setText('');
              track.conversationFunnel('first_turn', snap?.machine.turnCount ?? null);
            }}
            accessibilityLabel={t('lesson.speak')}
          />
        </Row>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <SpeakButton
            mode={tapToTalk ? 'toggle' : 'hold'}
            state={mode === 'hands_free' ? (speakButtonState === 'recording' ? 'recording' : 'disabled') : speakButtonState}
            onStart={() => void controller.pressStart()}
            onStop={() => void controller.pressStop()}
            onHaptic={(k) => void haptic(k)}
            elapsedText={snap?.machine.state === 'responding' ? t('speak.interruptHint', { name: characterName }) : null}
            labels={labels.speakButton}
          />
        </View>
      )}

      <Row gap={theme.spacing.xs} wrap justify="center">
        <IconButton icon="replay" accessibilityLabel={t('speak.controls.repeat')} onPress={() => void controller.command('repeat')} disabled={!snap?.lastCharacterTurn} />
        <IconButton icon="slow" accessibilityLabel={t('speak.controls.slower')} onPress={() => void controller.command('slower')} disabled={!canTalk} />
        <IconButton icon="hint" accessibilityLabel={t('speak.controls.hint')} onPress={() => setHintsOpen(true)} />
        <IconButton icon="translate" accessibilityLabel={t('speak.controls.translate')} selected={gloss} onPress={() => setGloss(!gloss)} />
        <IconButton icon="transcript" accessibilityLabel={t('speak.controls.transcript')} selected={transcript} onPress={() => setTranscript(!transcript)} />
        <IconButton icon={machineState === 'paused' ? 'play' : 'pause'} accessibilityLabel={machineState === 'paused' ? t('speak.controls.resume') : t('speak.controls.pause')} onPress={() => (machineState === 'paused' ? controller.resume() : controller.pause())} />
      </Row>
      <Row gap={theme.spacing.xs} justify="space-between">
        <Button label={immediateCorrections ? t('speak.correctionsAfter') : t('speak.immediateCorrection')} variant="ghost" size="sm" onPress={() => setImmediateCorrections(!immediateCorrections)} accessibilityLabel={t('speak.immediateCorrection')} />
        <Button label={t('speak.endConversation')} variant="secondary" size="sm" loading={snap?.ending} onPress={leave} accessibilityLabel={t('speak.endConversation')} />
      </Row>
      <HintSheet
        visible={hintsOpen}
        onClose={() => setHintsOpen(false)}
        hints={[]}
        translation={snap?.lastCharacterTurn?.sourceGloss ?? null}
        availableCommands={['translate', 'example', 'meaning', 'slower', 'repeat', 'hint', 'skip']}
        onCommand={(c) => {
          setHintsOpen(false);
          if (c === 'translate') setGloss(true);
          else void controller.command(c);
        }}
        labels={labels.hints}
        targetScript={trackDef.scripts.primary}
      />
    </View>
  );
}
