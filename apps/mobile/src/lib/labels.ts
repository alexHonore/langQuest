/**
 * Localized label sets for the `@langquest/ui` components (their defaults are
 * English). One hook per screen keeps the `t()` wiring in a single place.
 */
import type { CoverageStatus, Intelligibility, MasteryState, SpeechState, ConversationState } from '@langquest/contracts';
import type { CELEBRATION_LABELS, HINT_LABELS, MISSION_LABELS, PRONUNCIATION_LABELS, SHELL_LABELS, SPEAK_BUTTON_LABELS, STORY_MAP_LABELS } from '@langquest/ui';
import { useMemo } from 'react';
import { useI18n } from './i18n';

/**
 * The ui package types its label sets `as const`, so localized overrides must be cast
 * to the literal type (cross-package gap noted in the build report).
 */
type Localized<T> = { [K in keyof T]: NonNullable<T[K]> extends string ? string : NonNullable<T[K]> extends (...args: never[]) => unknown ? T[K] : NonNullable<T[K]> extends object ? Localized<NonNullable<T[K]>> : T[K] };
const loc = <T>(labels: Localized<T>): T => labels as unknown as T;

export function useUiLabels() {
  const { t } = useI18n();
  return useMemo(() => {
    const speechStates: Record<SpeechState, string> = {
      idle: t('speak.state.idle'),
      character_speaking: t('speak.state.character_speaking', { name: '' }).trim(),
      waiting: t('speak.state.waiting'),
      learner_mic_active: t('speak.state.learner_mic_active'),
      thinking: t('speak.state.thinking', { name: '' }).trim(),
      reconnecting: t('speak.state.reconnecting'),
      error: t('speak.state.error'),
    };
    const speechStatesFor = (name: string): Record<SpeechState, string> => ({ ...speechStates, character_speaking: t('speak.state.character_speaking', { name }), thinking: t('speak.state.thinking', { name }) });
    const conversationState = (state: ConversationState, name: string): string => t(`speak.state.${state}`, { name });
    const intelligibility: Record<Intelligibility, string> = {
      understood: t('pronunciation.feedback.understood'),
      partially_understood: t('pronunciation.feedback.partially_understood'),
      not_understood: t('pronunciation.feedback.not_understood'),
      no_speech_detected: t('pronunciation.feedback.no_speech_detected'),
    };
    // Chip labels: `CoverageBadge` prefixes the language name itself, so these are the source-less
    // short forms (the `{source}` sentences would read as truncated, e.g. "Prévu à partir du").
    const coverage: Record<CoverageStatus, string> = {
      complete: t('enrollment.coverage.short.complete'),
      partial: t('enrollment.coverage.short.partial'),
      planned: t('enrollment.coverage.short.planned'),
      unavailable: t('enrollment.coverage.short.unavailable'),
    };
    const mastery: Record<MasteryState, string> = {
      not_attempted: t('progress.mastery.not_attempted'),
      emerging: t('progress.mastery.emerging'),
      practiced: t('progress.mastery.practiced'),
      independent: t('progress.mastery.independent'),
      durable: t('progress.mastery.durable'),
    };
    return {
      speechStates,
      speechStatesFor,
      conversationState,
      intelligibility,
      coverage,
      mastery,
      speakButton: loc<typeof SPEAK_BUTTON_LABELS>({
        holdToSpeak: t('speak.pushToTalk'),
        tapToSpeak: t('speak.tapToTalk'),
        tapToStop: t('speak.tapToStop'),
        release: t('speak.button.release'),
        recording: t('pronunciation.recording'),
        processing: t('speak.button.processing'),
        disabled: t('speak.button.disabled'),
        switchToTap: t('speak.button.switchToTap'),
        switchToHold: t('speak.button.switchToHold'),
      }),
      hints: loc<typeof HINT_LABELS>({
        title: t('lesson.hint'),
        hint: t('speak.controls.hint'),
        nextHint: t('lesson.hintAnother'),
        translate: t('speak.controls.translate'),
        example: t('speak.controls.example'),
        meaning: t('speak.controls.meaning'),
        slower: t('speak.controls.slower'),
        repeat: t('speak.controls.repeat'),
        skip: t('speak.controls.skip'),
        close: t('common.close'),
        revealAlternative: t('lesson.revealAndCompare'),
        hintLevel: (n: number, total: number) => `${n}/${total}`,
      }),
      mission: loc<typeof MISSION_LABELS>({
        minutes: (m: number) => t('common.minutesShort', { count: m }),
        status: { locked: t('missions.status.locked'), available: t('missions.status.available'), in_progress: t('missions.status.in_progress'), completed: t('missions.status.completed') },
        focus: { pronunciation: t('missions.focus.pronunciation'), listening: t('missions.focus.listening'), conversation: t('missions.focus.conversation'), tone: t('missions.focus.tone') },
        start: t('missions.startButton'),
        continue: t('home.resumeMission'),
        replay: t('missions.status.replay'),
        skillsLabel: t('progress.skillMastery'),
        objective: t('missions.learningGoal'),
      }),
      storyMap: loc<typeof STORY_MAP_LABELS>({
        listView: t('missions.listView'),
        mapView: t('missions.mapView'),
        chapter: (title: string) => t('missions.chapter', { number: '', title }).replace(/^\S*\s*:?\s*/, '').trim() || title,
        status: { locked: t('missions.chapterLocked'), available: t('missions.status.available'), in_progress: t('missions.status.in_progress'), completed: t('missions.status.completed') },
        branchesTo: (n: number) => `→ ${n}`,
      }),
      celebration: loc<typeof CELEBRATION_LABELS>({ skip: t('common.skip'), continue: t('common.continue'), xp: (n: number) => `+${n} ${t('progress.xp')}`, engagementNote: t('home.xpNote') }),
      shell: loc<typeof SHELL_LABELS>({ learning: (target: string, source: string) => t('home.activeCourse', { target, source }), editCourse: t('enrollment.editSource'), back: t('common.back'), offline: t('common.offline') }),
      pronunciation: loc<Partial<typeof PRONUNCIATION_LABELS>>({
        heading: t('pronunciation.feedback.title'),
        score: t('pronunciation.feedback.scoreAvailable', { score: '' }).replace(/[:\s/0-9]+$/, ''),
        scoreOutOf: t('pronunciation.feedback.scoreOutOf'),
        detailedUnavailable: t('pronunciation.feedback.scoreUnavailable'),
        listenCompare: t('pronunciation.feedback.mode.reference-comparison'),
        humanCalibrated: t('pronunciation.feedback.mode.human-calibrated-reference-comparison'),
        semanticOnly: t('pronunciation.feedback.mode.semantic-only'),
        wordScores: t('pronunciation.feedback.wordScores'),
        retrySegment: t('pronunciation.feedback.retrySegment'),
        tryAgain: t('pronunciation.retry'),
        replayReference: t('pronunciation.playReference'),
        replaySlow: t('lesson.slow'),
      }),
    };
  }, [t]);
}
