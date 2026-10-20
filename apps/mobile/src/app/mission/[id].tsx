import { getCourseTrack, type MissionDetailResponse, type EnrollmentDto } from '@langquest/contracts';
import { AchievementCelebration, Button, CharacterPortrait, Chip, HintSheet, IconButton, InfoAffordance, LessonAccentScope, LessonProgress, PronunciationFeedback, Row, SceneArtwork, SpeakButton, SpeechStateIndicator, StatusLine, Surface, ThemedText, expressionForSpeechState, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Melo } from '@/components/Melo';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { SyntheticVoiceBadge } from '@/components/SyntheticVoiceBadge';
import { findCastCharacter } from '@/features/characters/cast';
import { useCast } from '@/features/characters/use-cast';
import { sceneForMission } from '@/features/missions/story';
import { formsForScriptMode, isolateSourceText, sourceTextDirection } from '@/features/lesson/forms';
import { fitScene } from '@/features/lesson/layout';
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

/**
 * Screen 4: listen → context → anticipate → speak → compare → repeat (calm density). The lantern accents
 * follow the mission and the current step type (`LessonAccentScope`); the character of the mission is
 * drawn from the published cast (manifest `characterIds` → portrait key) with the synthetic-voice badge.
 */
export default function MissionScreen(): React.JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enrollment } = useActiveEnrollment();
  const mission = useMissionDetail(typeof id === 'string' ? id : null, enrollment);
  return (
    <LessonAccentScope lessonType={mission.data?.data.type ?? null}>
      {/* No scrolling: the step lays itself out to fit the screen (`features/lesson/layout.ts`; device QA 2026-10-20 found
          "next step" at y≈1039 on an 874 pt phone with the old fixed-height scene). */}
      <Screen onBack={() => router.back()} scroll={false}>
        {mission.isLoading ? <LoadingView rows={2} /> : null}
        {mission.error && !mission.data ? <ErrorView error={mission.error} onRetry={() => void mission.refetch()} /> : null}
        {mission.data?.fromCache ? <CacheNotice fetchedAt={mission.data.fetchedAt} /> : null}
        {mission.data && enrollment ? <LessonPlayerView mission={mission.data.data} enrollment={enrollment} /> : null}
      </Screen>
    </LessonAccentScope>
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
  const { cast } = useCast(enrollment);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [typingChoice, setTyping] = useState(false);
  const typing = typingChoice || !micCoaching;
  const [typed, setTyped] = useState('');
  const [permission, setPermission] = useState<MicPermission | null>(null);
  const [celebrated, setCelebrated] = useState(false);
  const [sceneBox, setSceneBox] = useState({ width: 0, height: 0 });
  const compactMic = useWindowDimensions().height < 760;
  // Full-screen modal: nothing else pads the home-indicator strip, so the step keeps "next" above it.
  const safeBottom = useSafeAreaInsets().bottom;
  useEffect(() => () => player.dispose(), [player]);

  const trackDef = getCourseTrack(enrollment.courseTrackId);
  const { state, step } = lesson;
  const current = state.current;
  const expression = step.expressions[0] ?? null;
  const character = mission.characters[0] ?? null;
  const castMember = findCastCharacter(cast, character?.id);
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

  // Haptic on the compare verdict (gated by the learner's haptics setting inside `haptic`).
  useEffect(() => {
    if (current.phase === 'compare' && current.outcome) void haptic(current.outcome === 'success' ? 'success' : 'select');
  }, [current.phase, current.outcome]);

  if (state.finished && state.abandonedAtIndex === null) {
    const res = lesson.result;
    const summaryDetails = res
      ? [
          t('missions.summary.objectivesMet', { count: res.evaluation.objectivesCompleted.length }),
          `${t('missions.summary.skillsExercised')}: ${res.evaluation.skillsExercised.map((k) => k.replace(/_/g, ' ')).join(', ')}`,
          t('missions.summary.reviewAdded', { count: res.scheduledReviews.length }),
          // `confidence` is null when no evaluator ran (rubric-only result): say so, never invent a number.
          res.evaluation.confidence === null ? X.confidenceNotEvaluated : t('missions.summary.confidence', { confidence: Math.round(res.evaluation.confidence * 100) + '%' }),
          ...res.masteryChanges.map((m) => `${m.skillKey.replace(/_/g, ' ')}: ${labels.mastery[m.from]} → ${labels.mastery[m.to]}`),
        ]
      : [];
    return (
      <LessonAccentScope lessonType="feedback_retry">
        <View style={{ flex: 1, gap: theme.spacing.md, paddingVertical: theme.spacing.md }}>
          <Row gap={theme.spacing.md} align="center">
            <Melo state={res ? 'celebrate' : lesson.finishError ? 'try_again' : 'thinking'} size="companion" clip={res && !celebrated ? 'celebrate_bounce' : null} testID="mission-summary-mascot" />
            <ThemedText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
              {res ? t('missions.summary.completed') : t('missions.summary.title')}
            </ThemedText>
            {res ? <InfoAffordance label={t('common.details')} title={t('missions.summary.title')} text={summaryDetails} testID="mission-summary-details" /> : null}
          </Row>
          {lesson.finishing ? <StatusLine icon="info" tone="info" text={t('missions.summary.evaluationPending')} /> : null}
          {lesson.finishError ? (
            <>
              <StatusLine icon="warning" tone="warning" text={t('missions.summary.evaluationUnavailable')} />
              <ErrorView error={lesson.finishError} onRetry={() => void lesson.finish()} />
            </>
          ) : null}
          {res ? (
            <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
              <ThemedText variant="subheading">{t('missions.summary.corrections')}</ThemedText>
              {res.evaluation.priorityCorrections.length === 0 ? <ThemedText tone="secondary">{t('missions.summary.correctionsNone')}</ThemedText> : null}
              {res.evaluation.priorityCorrections.slice(0, 2).map((c, i) => (
                <Surface key={i} variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: 2 }}>
                  <ThemedText script={trackDef.scripts.primary} tone="muted">
                    {c.learnerUtterance}
                  </ThemedText>
                  <ThemedText script={trackDef.scripts.primary}>{c.suggestedUtterance}</ThemedText>
                  <ThemedText variant="caption" tone="secondary">
                    {c.explanation}
                  </ThemedText>
                </Surface>
              ))}
              <Row gap={theme.spacing.xs} wrap>
                {res.masteryChanges.map((m) => (
                  <Chip key={m.skillKey} label={`${m.skillKey.replace(/_/g, ' ')} → ${labels.mastery[m.to]}`} tone="success" icon="check" />
                ))}
              </Row>
            </Surface>
          ) : null}
          <Button
            label={t('common.done')}
            size="lg"
            fullWidth
            glow
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
      </LessonAccentScope>
    );
  }

  const speakState = current.phase === 'recording' ? 'recording' : current.phase === 'processing' ? 'processing' : permission === 'denied' ? 'disabled' : 'idle';
  const speechState = current.phase === 'recording' ? 'learner_mic_active' : current.phase === 'processing' ? 'thinking' : lesson.playing ? 'character_speaking' : current.phase === 'anticipate' ? 'waiting' : 'idle';
  const mascotState = current.phase === 'recording' ? 'listening' : current.phase === 'processing' ? 'thinking' : lesson.playing ? 'quiet_audio' : current.phase === 'compare' ? (current.outcome === 'success' ? 'success' : 'try_again') : current.error ? 'connection_error' : current.phase === 'anticipate' ? 'curious' : 'neutral';
  const stepAbout = [step.instruction, t('lesson.anticipateHint'), ...(micCoaching ? [t('lesson.textAlternativeNote')] : []), ...(mission.localizationComplete ? [] : [t('enrollment.coverage.draftAvailable', { source: names(enrollment.sourceLanguageCode) })])];

  // Fit-to-screen (owner feedback 2026-10-20): progress, phrase card, action zone and "next" keep their natural
  // height; the scene takes what is left (measured) and hides when too little is left. No scrolling, no overflow.
  const scene = fitScene(sceneBox.width, sceneBox.height);
  const comparing = current.phase === 'compare' && spec.options.length === 0 && Boolean(lesson.textAnswer || lesson.evaluation);
  const portraitSize = Math.max(40, Math.min(72, scene.height - 44));
  const melo = <Melo state={mascotState} size={scene.visible ? Math.max(32, Math.min(48, Math.floor(scene.height / 2.5))) : 40} animate={false} testID="mission-mascot" />;
  const speechLine = <SpeechStateIndicator state={speechState} labels={labels.speechStates} shortLabels={labels.speechStatesShort} compact />;

  return (
    <LessonAccentScope lessonType={step.type}>
      <View style={{ flex: 1, gap: theme.spacing.sm, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm + safeBottom }} testID="mission-step">
        <Row gap={theme.spacing.sm} justify="space-between">
          <View style={{ flex: 1 }}>
            <LessonProgress step={state.index + 1} totalSteps={state.steps.length} phase={uiPhase(current.phase)} phaseLabel={t(`lesson.stepTypes.${step.type}`)} title={mission.title} formatStep={(a, b) => t('missions.stepOf', { current: a, total: b })} />
          </View>
          <InfoAffordance label={t('lesson.aboutStep')} title={t(`lesson.stepTypes.${step.type}`)} text={stepAbout} />
          <IconButton testID="mission-leave" icon="close" accessibilityLabel={t('missions.leaveMission')} onPress={leave} />
        </Row>
        {lesson.offlineLimited ? <StatusLine icon="offline" tone="warning" text={t('errors.offlineLessonsAvailable')} /> : null}

        {/* The flexible zone: the scene with the character, Melo and the speech state laid over it. */}
        <View
          style={{ flex: 1, minHeight: 0, justifyContent: 'center' }}
          onLayout={(e) => {
            const width = Math.round(e.nativeEvent.layout.width);
            const height = Math.round(e.nativeEvent.layout.height);
            setSceneBox((b) => (b.width === width && b.height === height ? b : { width, height }));
          }}
          testID="mission-scene-zone"
        >
          {scene.visible ? (
            <View>
              <SceneArtwork
                sceneId={sceneId ?? 'cafe'}
                imageUri={mission.sceneArt?.publicUrl ?? null}
                altText={mission.sceneArt?.altTextKey ? t(mission.sceneArt.altTextKey) : undefined}
                height={scene.height}
                overlay={character ? <CharacterPortrait characterId={castMember?.portraitKey ?? character.id} expression={expressionForSpeechState(speechState)} speechState={speechState} name={character.name} size={portraitSize} showStatusText={false} stateLabels={labels.speechStatesFor(character.name)} testID="mission-character" /> : undefined}
                overlayPosition="center"
                scrim
              />
              {/* Glass backing keeps the speech-state word legible over any scene art. */}
              <Surface variant="glass" level={2} radius="md" padding={theme.spacing.xs} style={{ position: 'absolute', left: theme.spacing.sm, bottom: theme.spacing.xs, flexDirection: theme.direction.row, alignItems: 'center', gap: theme.spacing.xs }}>
                {melo}
                {speechLine}
              </Surface>
              {character?.syntheticVoice ? (
                <View style={{ position: 'absolute', left: theme.spacing.sm, top: theme.spacing.sm }}>
                  <SyntheticVoiceBadge name={character.name} />
                </View>
              ) : null}
            </View>
          ) : (
            <Row gap={theme.spacing.sm} align="center" wrap>
              {melo}
              {speechLine}
              {character?.syntheticVoice ? <SyntheticVoiceBadge name={character.name} /> : null}
            </Row>
          )}
        </View>

        <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
          {expression && (current.revealed || step.type !== 'anticipation') ? (
            <View style={{ gap: 2 }}>
              {scriptForms.map((f, i) => (
                <ThemedText key={i} variant={f.transliterationScheme ? 'transliteration' : 'phrase'} script={f.script} tone={f.transliterationScheme ? 'muted' : 'primary'}>
                  {f.text}
                </ThemedText>
              ))}
            </View>
          ) : (
            <ThemedText tone="secondary" direction={sourceDir}>
              {step.instruction}
            </ThemedText>
          )}
          {expression && (current.translationShown || captions) ? (
            <ThemedText tone="secondary" direction={sourceDir}>
              {expression.meaning}
              {expression.contextNote ? ` — ${expression.contextNote}` : ''}
            </ThemedText>
          ) : null}
          <Row gap={theme.spacing.xs} wrap>
            {/* No reference audio → no replay controls (§8: never a disabled placeholder). */}
            {lesson.referenceUri ? <IconButton testID="mission-replay" icon="replay" accessibilityLabel={t('lesson.replay')} disabled={current.phase === 'recording'} onPress={() => lesson.dispatch({ type: 'replay', slow: false })} /> : null}
            {lesson.referenceUri ? <IconButton testID="mission-slow" icon="slow" accessibilityLabel={t('lesson.slow')} disabled={current.phase === 'recording'} onPress={() => lesson.dispatch({ type: 'replay', slow: true })} /> : null}
            <IconButton icon="translate" accessibilityLabel={current.translationShown ? t('lesson.hideTranslation') : t('lesson.translate')} selected={current.translationShown} onPress={() => lesson.dispatch({ type: 'toggle_translation' })} />
            <IconButton icon="transcript" accessibilityLabel={t('lesson.toggleTranscript')} selected={current.transcriptShown} onPress={() => lesson.dispatch({ type: 'toggle_transcript' })} />
            <IconButton testID="mission-hint" icon="hint" accessibilityLabel={t('lesson.hint')} onPress={() => setHintsOpen(true)} />
          </Row>
        </Surface>

        {/* Action zone: the options, OR the mic (+ typed alternative), OR — once compared — the feedback in its place. */}
        {spec.options.length > 0 ? (
          <View style={{ gap: theme.spacing.xs }}>
            {spec.options.map((o) => (
              <Button key={o.id} label={o.label} variant={current.selectedOptionId === o.id ? 'primary' : 'secondary'} size="sm" fullWidth disabled={current.phase === 'compare'} onPress={() => lesson.dispatch({ type: 'choose_option', optionId: o.id })} accessibilityLabel={o.label} />
            ))}
            {current.phase === 'compare' ? <StatusLine icon={current.outcome === 'success' ? 'check' : 'info'} tone={current.outcome === 'success' ? 'success' : 'warning'} text={current.outcome === 'success' ? t('lesson.accept') : t('lesson.tryAgain')} /> : null}
          </View>
        ) : comparing && lesson.textAnswer ? (
          // A typed answer: meaning checked against the expression's forms, no speech assessed (§3.6).
          <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.sm }}>
            <Row justify="space-between" gap={theme.spacing.sm}>
              <StatusLine icon={lesson.textAnswer.semanticIntentMatched ? 'check' : 'info'} tone={lesson.textAnswer.semanticIntentMatched ? 'success' : 'warning'} text={lesson.textAnswer.semanticIntentMatched ? X.typedAnswerMatched : t('lesson.tryAgain')} />
              <InfoAffordance label={t('common.details')} title={t('pronunciation.feedback.title')} text={[X.typedAnswerTitle, lesson.textAnswer.semanticIntentMatched ? X.typedAnswerMatched : X.typedAnswerNotMatched, `${t('lesson.yourAnswer')}: ${lesson.textAnswer.text}`, ...(lesson.textAnswer.matchedForm ? [X.typedAnswerMatchedForm(lesson.textAnswer.matchedForm)] : [])]} />
            </Row>
            <Row gap={theme.spacing.xs} wrap>
              <Button label={t('pronunciation.retry')} variant="secondary" size="sm" icon="replay" onPress={() => lesson.dispatch({ type: 'retry' })} accessibilityLabel={t('pronunciation.retry')} />
              {lesson.referenceUri ? <IconButton icon="play" accessibilityLabel={t('pronunciation.playReference')} onPress={() => lesson.dispatch({ type: 'replay', slow: false })} /> : null}
            </Row>
          </Surface>
        ) : comparing && lesson.evaluation ? (
          <PronunciationFeedback
            result={withoutNumericScore(lesson.evaluation, nav)}
            targetScript={trackDef.scripts.primary}
            onRetry={() => lesson.dispatch({ type: 'retry' })}
            onReplayReference={lesson.referenceUri ? () => lesson.dispatch({ type: 'replay', slow: false }) : undefined}
            onReplaySlow={lesson.referenceUri ? () => lesson.dispatch({ type: 'replay', slow: true }) : undefined}
            labels={labels.pronunciation}
            calmLabels={{ details: t('common.details'), hideDetails: t('common.hideDetails') }}
            intelligibilityLabels={labels.intelligibility}
            showTranscript={current.transcriptShown || captions}
          />
        ) : (
          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {/* The question only on an anticipation step; a listen step teaches, it does not quiz. */}
            {current.phase === 'anticipate' ? (
              <ThemedText variant="subheading" align="center" accessibilityRole="header">
                {t('lesson.anticipate')}
              </ThemedText>
            ) : null}
            {micCoaching && !typing ? (
              <SpeakButton
                mode={tapToTalk ? 'toggle' : 'hold'}
                state={speakState}
                size={compactMic ? 'compact' : 'default'}
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
            {typing ? (
              <Row gap={theme.spacing.xs} style={{ width: '100%' }}>
                <TextInput testID="mission-typed-input" value={typed} onChangeText={setTyped} placeholder={t('lesson.typePlaceholder')} placeholderTextColor={theme.colors.textMuted} accessibilityLabel={t('lesson.typePlaceholder')} style={{ flex: 1, backgroundColor: theme.glass(1).backgroundColor, borderWidth: 1, borderColor: theme.glass(1).borderColor, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }} />
                <Button testID="mission-typed-submit" label={t('lesson.speak')} size="sm" disabled={!typed.trim()} onPress={() => { lesson.dispatch({ type: 'type_answer', text: typed }); setTyped(''); }} accessibilityLabel={t('lesson.speak')} />
              </Row>
            ) : null}
            <Row gap={theme.spacing.xs} wrap justify="center">
              {micCoaching ? <Button testID="mission-type-instead" label={typing ? t('lesson.speak') : t('lesson.typeInstead')} icon={typing ? 'mic' : 'transcript'} variant="ghost" size="sm" onPress={() => setTyping(!typingChoice)} accessibilityLabel={t('lesson.typeInstead')} /> : null}
              {!current.revealed ? <Button testID="mission-reveal" label={t('lesson.reveal')} variant="ghost" size="sm" onPress={() => lesson.dispatch({ type: 'reveal' })} accessibilityLabel={t('lesson.revealAndCompare')} /> : null}
            </Row>
          </View>
        )}

        <Row gap={theme.spacing.sm} justify="flex-end">
          <Button
            testID="mission-next-step"
            label={state.index + 1 === state.steps.length ? t('common.done') : t('lesson.nextStep')}
            icon="chevronRight"
            iconPosition="end"
            disabled={!canAdvance || !revealAllowed}
            onPress={() => {
              void haptic('select');
              lesson.dispatch({ type: 'next', now: Date.now() });
            }}
            accessibilityLabel={t('lesson.nextStep')}
          />
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
          calmLabels={{ more: t('lesson.hintMore'), less: t('lesson.hintLess') }}
          targetScript={trackDef.scripts.primary}
        />
      </View>
    </LessonAccentScope>
  );
}
