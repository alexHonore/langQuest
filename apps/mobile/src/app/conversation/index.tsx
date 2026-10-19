import { getCourseTrack, type ConversationMode, type ConversationSessionCreateResponse, type EnrollmentDto } from '@langquest/contracts';
import { Button, CharacterPortrait, Chip, HintSheet, IconButton, ProgressBar, Row, SceneArtwork, SpeakButton, SpeechStateIndicator, StatusLine, Surface, ThemedText, findCharacter, useTheme } from '@langquest/ui';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { SyntheticVoiceBadge } from '@/components/SyntheticVoiceBadge';
import { findCastCharacter } from '@/features/characters/cast';
import { useCast } from '@/features/characters/use-cast';
import { ConversationController, type ConversationSnapshot } from '@/features/conversation/controller';
import { sessionScopeFromParams } from '@/features/conversation/scope';
import { levelToUnit } from '@/features/conversation/vad';
import { isolateSourceText, sourceTextDirection, turnLayersForScriptMode } from '@/features/lesson/forms';
import { useActiveEnrollment, useInvalidateLearner } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { createClipPlayer } from '@/lib/clip-player';
import { useExtraLabels } from '@/lib/extra-labels';
import { haptic } from '@/lib/haptics';
import { localDateKey, newUuid, nowIso, nowMs } from '@/lib/ids';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { requestMicPermission, useRecorder, type MicPermission } from '@/lib/recorder';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';
import { getLocalStore } from '@/store';

/** Screen 5: live AI character conversation (pipeline realtime, §8.3 machine, barge-in). */
export default function ConversationScreen(): React.JSX.Element {
  const router = useRouter();
  const t = useT();
  const { api } = useServices();
  const params = useLocalSearchParams<{ enrollmentId?: string; characterId?: string; missionId?: string; scenarioId?: string; audioLessonId?: string; transcriptSegmentIds?: string }>();
  const { enrollments, enrollment: active, me, query } = useActiveEnrollment();
  const prefMode = usePrefs((s) => s.speakMode);
  // A requested enrollment that does not exist (stale link, archived course) is an error, never a
  // silent switch to another course and instruction language.
  const requested = typeof params.enrollmentId === 'string' && params.enrollmentId.length > 0 ? params.enrollmentId : null;
  const enrollment = requested ? (enrollments.find((e) => e.id === requested) ?? null) : active;
  const unknownEnrollment = Boolean(requested) && !enrollment && Boolean(query.data);
  // Voice controls exist only when the pair's capability snapshot says STT + TTS are usable (CONVENTIONS §8).
  const nav = useEnrollmentNavigation(enrollment);
  const voiceAllowed = nav.conversationVoice;
  const [session, setSession] = useState<ConversationSessionCreateResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [permission, setPermission] = useState<MicPermission | null>(null);
  const [clientSessionId] = useState(() => newUuid());

  const mode: ConversationMode = !voiceAllowed || permission === 'denied' || permission === 'unavailable' ? 'text_only' : prefMode;

  useEffect(() => {
    if (!enrollment) return;
    let alive = true;
    (async () => {
      const p = !voiceAllowed || prefMode === 'text_only' ? 'granted' : await requestMicPermission();
      if (!alive) return;
      setPermission(p);
      try {
        const res = await api.conversationSessionCreate({
          enrollmentId: enrollment.id,
          characterId: params.characterId,
          missionId: params.missionId,
          scenarioId: params.scenarioId,
          scope: sessionScopeFromParams(params),
          mode: p === 'granted' && voiceAllowed ? prefMode : 'text_only',
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
  }, [enrollment?.id, voiceAllowed]);

  if (enrollment && !nav.liveConversation) return <Redirect href="/(tabs)" />;
  return (
    <Screen title={t('speak.title')} onBack={() => router.back()} scroll={false} enrollment={enrollment}>
      {unknownEnrollment ? <ErrorView error={new Error(t('errors.notFound'))} /> : !enrollment && query.data ? <ErrorView error={new Error(t('home.noCourse'))} /> : null}
      {!session && !error && enrollment ? <LoadingView rows={1} label={t('speak.state.preparing')} /> : null}
      {error ? <ErrorView error={error} onRetry={() => router.replace({ pathname: '/conversation', params })} /> : null}
      {session && enrollment ? <LiveConversation session={session} enrollment={enrollment} mode={mode} voice={voiceAllowed} /> : null}
    </Screen>
  );
}

function LiveConversation({ session, enrollment, mode, voice }: { session: ConversationSessionCreateResponse; enrollment: EnrollmentDto; mode: ConversationMode; voice: boolean }): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
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
  const [endQueued, setEndQueued] = useState(false);
  const startedAt = useRef(0);
  const sourceDir = sourceTextDirection(enrollment.sourceLanguageCode);
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
          synthesize: (textToSpeak, speed, signal) => api.synthesize({ enrollmentId: enrollment.id, targetVarietyId: trackDef.targetVarietyId, text: textToSpeak, speed, outputEncoding: 'mp3' }, signal),
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
  // Portrait art is keyed by the roster slug the manifest carries for this character; the stable uuid
  // resolves too for the seeded cast, so a manifest that is still loading degrades to the uuid lookup.
  const { cast } = useCast(enrollment);
  const roster = findCharacter(findCastCharacter(cast, session.character.id)?.portraitKey ?? session.character.id);
  const speechState = snap?.speechState ?? 'idle';
  const machineState = snap?.machine.state ?? 'preparing';
  const stateLabel = labels.conversationState(machineState, characterName);
  const ended = snap?.ended ?? null;
  const noticeCode = snap?.notice?.code ?? null;
  const noticeText = noticeCode === null ? null : noticeCode === 'offline' ? t('errors.reconnectingDetail') : noticeCode === 'no_speech' ? t('speak.noSpeech') : noticeCode === 'tts_unavailable' ? t('errors.providerUnavailable') : (X.conversationNotice[noticeCode] ?? X.conversationNotice.generic ?? null);
  const endPending = snap?.pendingEnd ?? null;

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

  const activityRecorded = useRef(false);
  const finish = async (reason: 'learner_ended' | 'completed'): Promise<void> => {
    const res = await controller.end(reason);
    if (!activityRecorded.current) {
      activityRecorded.current = true;
      track.conversationFunnel('ended', snap?.machine.turnCount ?? null);
      const seconds = Math.round((snap?.speakingMs ?? 0) / 1000);
      if (seconds > 0) track.speakingTime(seconds, 'conversation');
      await enqueue({ type: 'activity_minutes', activityDate: localDateKey(), minutesActive: Math.max(1, Math.round((nowMs() - startedAt.current) / 60_000)), speakingSeconds: seconds }, enrollment.id);
    }
    if (res) await invalidate();
  };

  // The end request could not be delivered: queue it for replay on reconnect (§4.6) and let the learner
  // either retry now or leave without a summary.
  const queueEnd = async (): Promise<void> => {
    const pending = controller.snapshot().pendingEnd;
    if (!pending) return;
    const store = await getLocalStore();
    await store.cache.putPendingConversationEnd({ sessionId: session.session.sessionId, enrollmentId: enrollment.id, body: pending, queuedAt: nowIso(), attempts: 0 });
    setEndQueued(true);
  };
  const leaveWithoutSummary = async (): Promise<void> => {
    await queueEnd();
    controller.abandonLocally();
    router.back();
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
        <SpeechStateIndicator state={speechState} labels={{ ...labels.speechStatesFor(characterName), [speechState]: stateLabel }} detail={noticeText} compact />
        <IconButton icon="close" accessibilityLabel={t('speak.controls.leave')} onPress={leave} />
      </Row>
      {machineState === 'recoverable_error' && online ? (
        // Online but stuck in recoverable_error (e.g. the provider was unavailable): an explicit retry, no endless spinner.
        <Row gap={theme.spacing.xs}>
          <Button label={X.tryAgain} variant="secondary" size="sm" icon="replay" onPress={() => controller.reconnect()} accessibilityLabel={X.tryAgain} />
        </Row>
      ) : null}
      {snap?.canRetryTurn ? (
        <Row gap={theme.spacing.xs}>
          <Button label={X.tryAgain} variant="secondary" size="sm" icon="replay" onPress={() => void controller.retryLastTurn()} accessibilityLabel={X.tryAgain} />
        </Row>
      ) : null}
      {endPending && !ended ? (
        <Surface variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
          <StatusLine icon={noticeCode === 'end_offline' ? 'offline' : 'warning'} tone="warning" text={noticeText ?? X.conversationNotice.end_failed ?? ''} />
          {endQueued ? <ThemedText variant="caption" tone="muted">{X.endPendingQueued}</ThemedText> : null}
          <Row gap={theme.spacing.xs} wrap>
            <Button label={X.retryEnd} variant="secondary" size="sm" icon="replay" loading={snap?.ending} onPress={() => void finish(endPending.reason === 'completed' ? 'completed' : 'learner_ended')} accessibilityLabel={X.retryEnd} />
            <Button label={X.leaveWithoutSummary} variant="ghost" size="sm" onPress={() => void leaveWithoutSummary()} accessibilityLabel={X.leaveWithoutSummary} />
          </Row>
        </Surface>
      ) : null}
      <SceneArtwork sceneId="cafe" aspectRatio={2.4} overlay={<CharacterPortrait characterId={roster?.id ?? session.character.id} expression={snap?.lastCharacterTurn?.expression ?? 'neutral'} speechState={speechState} name={characterName} subtitle={roster ? `${roster.role} · ${roster.city}` : session.character.role} size={96} stateLabels={labels.speechStatesFor(characterName)} />} overlayPosition="center" scrim />
      <Row gap={theme.spacing.xs} wrap>
        {session.character.syntheticVoice ? <SyntheticVoiceBadge name={characterName} /> : null}
        <ThemedText variant="caption" tone="muted" style={{ flexShrink: 1 }}>
          {t('speak.sourceLanguageNote', { source: names(enrollment.sourceLanguageCode), name: characterName, target: trackDef.displayName })}
          {session.character.syntheticVoice ? ` · ${X.syntheticVoice}` : ''}
        </ThemedText>
      </Row>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: theme.spacing.sm }}>
        {(snap?.turns ?? []).map((turn) => {
          const learner = turn.role === 'learner';
          if (!transcript && learner) return null;
          return (
            <Surface key={turn.id} variant={learner ? 'accentSoft' : 'surface'} bordered radius="md" padding={theme.spacing.md} style={{ alignSelf: learner ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 2 }}>
              <ThemedText variant="caption" tone="muted">
                {learner ? t('speak.turnLabel.learner') : t('speak.turnLabel.character', { name: characterName })}
              </ThemedText>
              {(() => {
                const layers = learner ? { primary: turn.text, secondary: null, primaryIsTransliteration: false } : turnLayersForScriptMode(turn, enrollment.scriptMode);
                return (
                  <>
                    <ThemedText script={layers.primaryIsTransliteration ? 'Latn' : trackDef.scripts.primary} variant={layers.primaryIsTransliteration ? 'transliteration' : 'body'}>{layers.primary}</ThemedText>
                    {layers.secondary ? <ThemedText variant="transliteration" tone="muted">{layers.secondary}</ThemedText> : null}
                  </>
                );
              })()}
              {gloss && turn.sourceGloss ? <ThemedText tone="secondary" direction={sourceDir}>{turn.sourceGloss}</ThemedText> : null}
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
          <TextInput testID="conversation-text-input" value={text} onChangeText={setText} placeholder={t('lesson.typePlaceholder')} placeholderTextColor={theme.colors.textMuted} accessibilityLabel={t('lesson.typePlaceholder')} style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
          <Button
            testID="conversation-send"
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
        {/* Replay / slower re-synthesise the character turn: no TTS for this pair → no such buttons (§8). */}
        {voice ? <IconButton icon="replay" accessibilityLabel={t('speak.controls.repeat')} onPress={() => void controller.command('repeat')} disabled={!snap?.lastCharacterTurn} /> : null}
        {voice ? <IconButton icon="slow" accessibilityLabel={t('speak.controls.slower')} onPress={() => void controller.command('slower')} disabled={!canTalk} /> : null}
        <IconButton icon="hint" accessibilityLabel={t('speak.controls.hint')} onPress={() => setHintsOpen(true)} />
        <IconButton icon="translate" accessibilityLabel={t('speak.controls.translate')} selected={gloss} onPress={() => setGloss(!gloss)} />
        <IconButton icon="transcript" accessibilityLabel={t('speak.controls.transcript')} selected={transcript} onPress={() => setTranscript(!transcript)} />
        <IconButton icon={machineState === 'paused' ? 'play' : 'pause'} accessibilityLabel={machineState === 'paused' ? t('speak.controls.resume') : t('speak.controls.pause')} onPress={() => (machineState === 'paused' ? controller.resume() : controller.pause())} />
      </Row>
      <Row gap={theme.spacing.xs} justify="flex-end">
        {/* Correction timing is not a session option in the contracts yet (cross-package gap); no decorative toggle. */}
        <Button testID="conversation-end" label={t('speak.endConversation')} variant="secondary" size="sm" loading={snap?.ending} disabled={Boolean(endPending)} onPress={leave} accessibilityLabel={t('speak.endConversation')} />
      </Row>
      <HintSheet
        visible={hintsOpen}
        onClose={() => setHintsOpen(false)}
        hints={[]}
        translation={snap?.lastCharacterTurn?.sourceGloss ? isolateSourceText(snap.lastCharacterTurn.sourceGloss, enrollment.sourceLanguageCode) : null}
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
