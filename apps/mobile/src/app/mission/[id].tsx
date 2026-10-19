import { getCourseTrack, type MissionDetailResponse, type EnrollmentDto } from '@langquest/contracts';
import { AchievementCelebration, Button, Chip, HintSheet, IconButton, LessonProgress, PronunciationFeedback, Row, SceneArtwork, SpeakButton, SpeechStateIndicator, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { sceneForMission } from '@/features/missions/story';
import { formsForScriptMode, isolateSourceText, sourceTextDirection } from '@/features/lesson/forms';
import { uiPhase } from '@/features/lesson/machine';
import { useLessonPlayer } from '@/features/lesson/use-lesson-player';
import { withoutNumericScore } from '@/features/session/capabilities';
import { useActiveEnrollment, useInvalidateLearner, useMissionDetail } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { createClipPlayer } from '@/lib/clip-player';
import { useExtraLabels } from '@/lib/extra-labels';
import { haptic } from '@/lib/haptics';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { requestMicPermission, useRecorder, type MicPermission } from '@/lib/recorder';
import { usePrefs } from '@/state/prefs';

/** Screen 4: listen → context → anticipate → speak → compare → repeat. */
export default function MissionScreen(): React.JSX.Element {
  const router = useRouter();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enrollment } = useActiveEnrollment();
  const mission = useMissionDetail(typeof id === 'string' ? id : null, enrollment);
  return (
    <Screen title={mission.data?.data.title ?? t('missions.title')} onBack={() => router.back()} scroll={false}>
      {mission.isLoading ? <LoadingView rows={2} /> : null}
      {mission.error && !mission.data ? <ErrorView error={mission.error} onRetry={() => void mission.refetch()} /> : null}
      {mission.data?.fromCache ? <CacheNotice fetchedAt={mission.data.fetchedAt} /> : null}
      {mission.data && enrollment ? <LessonPlayerView mission={mission.data.data} enrollment={enrollment} /> : null}
    </Screen>
  );
}

function LessonPlayerView({ mission, enrollment }: { mission: MissionDetailResponse; enrollment: EnrollmentDto }): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const labels = useUiLabels();
  const invalidate = useInvalidateLearner();
  const recorder = useRecorder();
  const player = useMemo(() => createClipPlayer(), []);
  const tapToTalk = usePrefs((s) => s.tapToTalk);
  const captions = usePrefs((s) => s.captionsDefaultOn);
  const lesson = useLessonPlayer({ mission, enrollment, recorder, player });
  // §8: without spoken feedback for this pair there is no mic coaching — the typed answer is the only input.
  const nav = useEnrollmentNavigation(enrollment);
  const micCoaching = nav.pronunciationDrills;
  const [hintsOpen, setHintsOpen] = useState(false);
  const [typingChoice, setTyping] = useState(false);
  const typing = typingChoice || !micCoaching;
  const [typed, setTyped] = useState('');
  const [permission, setPermission] = useState<MicPermission | null>(null);
  const [celebrated, setCelebrated] = useState(false);
  useEffect(() => () => player.dispose(), [player]);

  const trackDef = getCourseTrack(enrollment.courseTrackId);
  const { state, step } = lesson;
  const current = state.current;
  const expression = step.expressions[0] ?? null;
  const character = mission.characters[0] ?? null;
  const sceneId = sceneForMission({ ...mission, order: 0, titleKey: null, difficulty: 0, prerequisiteSkillKeys: [], skillKeys: mission.goals.flatMap((g) => g.skillKeys), characterIds: [], publishedRevision: mission.revision, steps: [], localizationComplete: mission.localizationComplete }, null);
  const scriptForms = expression ? formsForScriptMode(expression, trackDef.scripts.primary, enrollment.scriptMode) : [];
  // Instruction-language text (instructions, meanings, hints) follows the SOURCE language's direction, not the UI's.
  const sourceDir = sourceTextDirection(enrollment.sourceLanguageCode);
  const spec = state.steps[state.index]!;
  const revealAllowed = current.revealed || !spec.requiresAttemptBeforeReveal || current.attempts > 0;
  const canAdvance = !(spec.requiresAttemptBeforeReveal && !current.revealed && current.attempts === 0) && current.phase !== 'recording' && current.phase !== 'processing';

  const ensureMic = async (): Promise<boolean> => {
    if (permission === 'granted') return true;
    const p = await requestMicPermission();
    setPermission(p);
    return p === 'granted';
  };

  const leave = (): void => {
    Alert.alert(t('missions.leaveMission'), t('missions.leaveMissionHint'), [
      { text: t('missions.stayButton'), style: 'cancel' },
      {
        text: t('missions.leaveConfirm'),
        style: 'destructive',
        onPress: () => {
          void lesson.leave().then(() => router.back());
        },
      },
    ]);
  };

  useEffect(() => {
    if (state.finished && !state.abandonedAtIndex && !lesson.result && !lesson.finishing && !lesson.finishError) void lesson.finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.finished]);

  if (state.finished && state.abandonedAtIndex === null) {
    const res = lesson.result;
    return (
      <View style={{ flex: 1, gap: theme.spacing.md, paddingVertical: theme.spacing.md }}>
        <ThemedText variant="title" accessibilityRole="header">
          {t('missions.summary.title')}
        </ThemedText>
        {lesson.finishing ? <StatusLine icon="info" tone="info" text={t('missions.summary.evaluationPending')} /> : null}
        {lesson.finishError ? (
          <>
            <StatusLine icon="warning" tone="warning" text={t('missions.summary.evaluationUnavailable')} />
            <ErrorView error={lesson.finishError} onRetry={() => void lesson.finish()} />
          </>
        ) : null}
        {res ? (
          <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
            <StatusLine icon="check" tone="success" text={t('missions.summary.completed')} />
            <ThemedText>{t('missions.summary.objectivesMet', { count: res.evaluation.objectivesCompleted.length })}</ThemedText>
            <ThemedText variant="label">{t('missions.summary.skillsExercised')}</ThemedText>
            <Row gap={theme.spacing.xs} wrap>
              {res.evaluation.skillsExercised.map((k) => (
                <Chip key={k} label={k.replace(/_/g, ' ')} />
              ))}
            </Row>
            <ThemedText variant="label">{t('missions.summary.corrections')}</ThemedText>
            {res.evaluation.priorityCorrections.length === 0 ? <ThemedText tone="secondary">{t('missions.summary.correctionsNone')}</ThemedText> : null}
            {res.evaluation.priorityCorrections.slice(0, 2).map((c, i) => (
              <Surface key={i} variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: 2 }}>
                <ThemedText variant="caption" tone="muted">{t('lesson.yourAnswer')}</ThemedText>
                <ThemedText script={trackDef.scripts.primary}>{c.learnerUtterance}</ThemedText>
                <ThemedText variant="caption" tone="muted">{t('lesson.modelAnswer')}</ThemedText>
                <ThemedText script={trackDef.scripts.primary}>{c.suggestedUtterance}</ThemedText>
                <ThemedText tone="secondary">{c.explanation}</ThemedText>
              </Surface>
            ))}
            <ThemedText tone="secondary">{t('missions.summary.reviewAdded', { count: res.scheduledReviews.length })}</ThemedText>
            <ThemedText variant="caption" tone="muted" testID="mission-evaluation-confidence">
              {/* `confidence` is null when no evaluator ran (rubric-only result): say so, never invent a number. */}
              {res.evaluation.confidence === null ? X.confidenceNotEvaluated : t('missions.summary.confidence', { confidence: Math.round(res.evaluation.confidence * 100) + '%' })}
            </ThemedText>
            {res.masteryChanges.map((m) => (
              <Chip key={m.skillKey} label={`${m.skillKey.replace(/_/g, ' ')}: ${labels.mastery[m.from]} → ${labels.mastery[m.to]}`} tone="success" />
            ))}
          </Surface>
        ) : null}
        <Button
          label={t('common.done')}
          size="lg"
          fullWidth
          onPress={async () => {
            await invalidate();
            router.back();
          }}
          accessibilityLabel={t('common.done')}
        />
        {res ? (
          <AchievementCelebration
            visible={!celebrated && (res.achievementsUnlocked.length > 0 || res.xpAwarded > 0)}
            title={res.achievementsUnlocked[0]?.replace(/_/g, ' ') ?? t('missions.summary.completed')}
            description={res.achievementsUnlocked.length > 1 ? res.achievementsUnlocked.slice(1).join(', ') : undefined}
            xp={res.xpReplayed ? null : res.xpAwarded}
            onContinue={() => setCelebrated(true)}
            onHaptic={() => void haptic('success')}
            labels={labels.celebration}
          />
        ) : null}
      </View>
    );
  }

  const speakState = current.phase === 'recording' ? 'recording' : current.phase === 'processing' ? 'processing' : permission === 'denied' ? 'disabled' : 'idle';
  const speechState = current.phase === 'recording' ? 'learner_mic_active' : current.phase === 'processing' ? 'thinking' : lesson.playing ? 'character_speaking' : current.phase === 'anticipate' ? 'waiting' : 'idle';

  return (
    <View style={{ flex: 1, gap: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
      <Row gap={theme.spacing.sm} justify="space-between">
        <View style={{ flex: 1 }}>
          <LessonProgress step={state.index + 1} totalSteps={state.steps.length} phase={uiPhase(current.phase)} phaseLabel={t(`lesson.stepTypes.${step.type}`)} title={mission.title} formatStep={(a, b) => t('missions.stepOf', { current: a, total: b })} />
        </View>
        <IconButton testID="mission-leave" icon="close" accessibilityLabel={t('missions.leaveMission')} onPress={leave} />
      </Row>
      {!mission.localizationComplete ? <StatusLine icon="info" tone="warning" text={t('enrollment.coverage.draftAvailable', { source: names(enrollment.sourceLanguageCode) })} /> : null}
      {lesson.offlineLimited ? <StatusLine icon="offline" tone="warning" text={t('errors.offlineLessonsAvailable')} /> : null}

      <SceneArtwork sceneId={sceneId ?? 'cafe'} imageUri={mission.sceneArt?.publicUrl ?? null} altText={mission.sceneArt?.altTextKey ? t(mission.sceneArt.altTextKey) : undefined} overlay={character ? <ThemedText variant="caption" tone="onAccent">{character.name}</ThemedText> : undefined} overlayPosition="bottom" scrim />

      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        <ThemedText tone="secondary" direction={sourceDir}>{step.instruction}</ThemedText>
        {expression && (current.revealed || step.type !== 'anticipation') ? (
          <View style={{ gap: 2 }}>
            {scriptForms.map((f, i) => (
              <ThemedText key={i} variant={f.transliterationScheme ? 'transliteration' : 'phrase'} script={f.script} tone={f.transliterationScheme ? 'muted' : 'primary'}>
                {f.text}
              </ThemedText>
            ))}
          </View>
        ) : null}
        {expression && (current.translationShown || captions) ? (
          <View style={{ gap: 2 }}>
            <ThemedText variant="caption" tone="muted">{t('lesson.translation')}</ThemedText>
            <ThemedText direction={sourceDir}>{expression.meaning}</ThemedText>
            {expression.contextNote ? <ThemedText variant="caption" tone="secondary" direction={sourceDir}>{expression.contextNote}</ThemedText> : null}
          </View>
        ) : null}
        <Row gap={theme.spacing.xs} wrap>
          {/* No reference audio → no replay controls (§8: never a disabled placeholder). */}
          {lesson.referenceUri ? <Button testID="mission-replay" label={t('lesson.replay')} icon="replay" variant="secondary" size="sm" disabled={current.phase === 'recording'} onPress={() => lesson.dispatch({ type: 'replay', slow: false })} accessibilityLabel={t('lesson.replay')} /> : null}
          {lesson.referenceUri ? <Button testID="mission-slow" label={t('lesson.slow')} icon="slow" variant="secondary" size="sm" disabled={current.phase === 'recording'} onPress={() => lesson.dispatch({ type: 'replay', slow: true })} accessibilityLabel={t('lesson.slow')} /> : null}
          <Button label={current.translationShown ? t('lesson.hideTranslation') : t('lesson.translate')} icon="translate" variant="ghost" size="sm" onPress={() => lesson.dispatch({ type: 'toggle_translation' })} accessibilityLabel={t('lesson.translate')} />
        </Row>
      </Surface>

      <SpeechStateIndicator state={speechState} labels={labels.speechStates} compact />

      {spec.options.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          {spec.options.map((o) => (
            <Button key={o.id} label={o.label} variant={current.selectedOptionId === o.id ? 'primary' : 'secondary'} fullWidth disabled={current.phase === 'compare'} onPress={() => lesson.dispatch({ type: 'choose_option', optionId: o.id })} accessibilityLabel={o.label} />
          ))}
          {current.phase === 'compare' ? <StatusLine icon={current.outcome === 'success' ? 'check' : 'info'} tone={current.outcome === 'success' ? 'success' : 'warning'} text={current.outcome === 'success' ? t('lesson.accept') : t('lesson.tryAgain')} /> : null}
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          {current.phase === 'listen' || current.phase === 'anticipate' ? <ThemedText variant="heading" align="center">{t('lesson.anticipate')}</ThemedText> : null}
          {current.phase === 'anticipate' ? <ThemedText variant="caption" tone="muted" align="center">{t('lesson.anticipateHint')}</ThemedText> : null}
          {micCoaching ? (
            <SpeakButton
              mode={tapToTalk ? 'toggle' : 'hold'}
              state={speakState}
              showModeSwitch
              onModeChange={(m) => usePrefs.getState().set({ tapToTalk: m === 'toggle' })}
              onStart={() => {
                void ensureMic().then((ok) => ok && lesson.dispatch({ type: 'record_start' }));
              }}
              onStop={() => lesson.dispatch({ type: 'record_stop', durationMs: recorder.durationMs() })}
              onCancel={() => lesson.dispatch({ type: 'record_cancel' })}
              onHaptic={(k) => void haptic(k)}
              elapsedText={current.phase === 'recording' ? t('lesson.listening') : current.phase === 'processing' ? t('lesson.processing') : null}
              labels={labels.speakButton}
            />
          ) : null}
          {micCoaching && permission === 'denied' ? <StatusLine icon="micOff" tone="warning" text={t('errors.permission.micDenied')} /> : null}
          {current.error ? <StatusLine icon="warning" tone="warning" text={current.error === 'offline' ? t('errors.network') : current.error === 'no_input' ? t('speak.noSpeech') : t('errors.providerUnavailable')} /> : null}
          <Row gap={theme.spacing.xs} wrap justify="center">
            <Button testID="mission-hint" label={t('lesson.hint')} icon="hint" variant="ghost" size="sm" onPress={() => setHintsOpen(true)} accessibilityLabel={t('lesson.hint')} />
            {micCoaching ? <Button testID="mission-type-instead" label={typing ? t('lesson.cannotSpeakNow') : t('lesson.typeInstead')} icon="transcript" variant="ghost" size="sm" onPress={() => setTyping(!typingChoice)} accessibilityLabel={t('lesson.typeInstead')} /> : null}
            {!current.revealed ? <Button testID="mission-reveal" label={t('lesson.revealAndCompare')} variant="ghost" size="sm" onPress={() => lesson.dispatch({ type: 'reveal' })} accessibilityLabel={t('lesson.revealAndCompare')} /> : null}
          </Row>
          {typing ? (
            <Row gap={theme.spacing.xs} style={{ width: '100%' }}>
              <TextInput testID="mission-typed-input" value={typed} onChangeText={setTyped} placeholder={t('lesson.typePlaceholder')} placeholderTextColor={theme.colors.textMuted} accessibilityLabel={t('lesson.typePlaceholder')} style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
              <Button testID="mission-typed-submit" label={t('lesson.speak')} size="sm" disabled={!typed.trim()} onPress={() => { lesson.dispatch({ type: 'type_answer', text: typed }); setTyped(''); }} accessibilityLabel={t('lesson.speak')} />
            </Row>
          ) : null}
          {typing && micCoaching ? <ThemedText variant="caption" tone="muted" align="center">{t('lesson.textAlternativeNote')}</ThemedText> : null}
        </View>
      )}

      {lesson.textAnswer && current.phase === 'compare' ? (
        // A typed answer: meaning checked against the expression's forms, no speech assessed (§3.6).
        <Surface variant="elevated" level={1} radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
          <ThemedText variant="heading">{t('pronunciation.feedback.title')}</ThemedText>
          <StatusLine icon="transcript" tone="info" text={X.typedAnswerTitle} variant="subheading" />
          <StatusLine icon={lesson.textAnswer.semanticIntentMatched ? 'check' : 'info'} tone={lesson.textAnswer.semanticIntentMatched ? 'success' : 'warning'} text={lesson.textAnswer.semanticIntentMatched ? X.typedAnswerMatched : X.typedAnswerNotMatched} />
          <ThemedText variant="caption" tone="muted">{t('lesson.yourAnswer')}</ThemedText>
          <ThemedText script={trackDef.scripts.primary}>{lesson.textAnswer.text}</ThemedText>
          {lesson.textAnswer.matchedForm ? <ThemedText variant="caption" tone="secondary">{X.typedAnswerMatchedForm(lesson.textAnswer.matchedForm)}</ThemedText> : null}
          <Row gap={theme.spacing.xs} wrap>
            <Button label={t('pronunciation.retry')} variant="secondary" size="sm" icon="replay" onPress={() => lesson.dispatch({ type: 'retry' })} accessibilityLabel={t('pronunciation.retry')} />
            {lesson.referenceUri ? <Button label={t('pronunciation.playReference')} variant="ghost" size="sm" icon="play" onPress={() => lesson.dispatch({ type: 'replay', slow: false })} accessibilityLabel={t('pronunciation.playReference')} /> : null}
          </Row>
        </Surface>
      ) : null}
      {lesson.evaluation && !lesson.textAnswer && current.phase === 'compare' ? (
        <PronunciationFeedback
          result={withoutNumericScore(lesson.evaluation, nav)}
          targetScript={trackDef.scripts.primary}
          onRetry={() => lesson.dispatch({ type: 'retry' })}
          onReplayReference={lesson.referenceUri ? () => lesson.dispatch({ type: 'replay', slow: false }) : undefined}
          onReplaySlow={lesson.referenceUri ? () => lesson.dispatch({ type: 'replay', slow: true }) : undefined}
          labels={labels.pronunciation}
          intelligibilityLabels={labels.intelligibility}
          showTranscript={current.transcriptShown || captions}
        />
      ) : null}

      <Row gap={theme.spacing.sm} justify="space-between">
        <Button label={current.transcriptShown ? t('lesson.transcriptOff') : t('lesson.transcriptOn')} variant="ghost" size="sm" icon="transcript" onPress={() => lesson.dispatch({ type: 'toggle_transcript' })} accessibilityLabel={t('lesson.toggleTranscript')} />
        <Button testID="mission-next-step" label={state.index + 1 === state.steps.length ? t('common.done') : t('lesson.nextStep')} icon="chevronRight" iconPosition="end" disabled={!canAdvance || !revealAllowed} onPress={() => lesson.dispatch({ type: 'next', now: Date.now() })} accessibilityLabel={t('lesson.nextStep')} />
      </Row>

      <HintSheet
        visible={hintsOpen}
        onClose={() => setHintsOpen(false)}
        hints={step.hints.map((h) => ({ text: isolateSourceText(h, enrollment.sourceLanguageCode) }))}
        translation={expression ? isolateSourceText(expression.meaning, enrollment.sourceLanguageCode) : null}
        example={current.revealed && expression ? expression.canonicalText : null}
        meaning={expression?.contextNote ? isolateSourceText(expression.contextNote, enrollment.sourceLanguageCode) : null}
        availableCommands={['hint', 'translate', 'repeat', 'slower']}
        onCommand={(c) => {
          if (c === 'hint') lesson.dispatch({ type: 'hint' });
          if (c === 'translate') lesson.dispatch({ type: 'toggle_translation' });
          if (c === 'repeat') lesson.dispatch({ type: 'replay', slow: false });
          if (c === 'slower') lesson.dispatch({ type: 'replay', slow: true });
        }}
        onRevealModelAnswer={() => {
          lesson.dispatch({ type: 'reveal' });
          setHintsOpen(false);
        }}
        labels={labels.hints}
        targetScript={trackDef.scripts.primary}
      />
    </View>
  );
}
