import { getCourseTrack } from '@langquest/contracts';
import { Button, Chip, EmptyState, InfoAffordance, MissionCard, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Melo } from '@/components/Melo';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView, errorMessageFor } from '@/components/StateViews';
import { MissionCast } from '@/features/characters/MissionCast';
import { useCast } from '@/features/characters/use-cast';
import { usePathway } from '@/features/missions/use-pathway';
import { useOnboardingReplay } from '@/features/onboarding/use-onboarding-replay';
import { useFallbackOptIn } from '@/features/session/fallback';
import { useActiveEnrollment, useProgress, useReviewsDue } from '@/features/session/queries';
import { homeCta } from '@/features/session/capabilities';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { useExtraLabels } from '@/lib/extra-labels';
import { haptic } from '@/lib/haptics';
import { useLanguageNames, useSourceTranslator, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';

/**
 * Screen 2: Home / today (Night Market, calm density). One heading (the greeting), Melo's one line,
 * ONE primary action — the next speakable mission card (glowing), or the live conversation for a
 * pair without a pathway (CONVENTIONS §8: controls the enrollment cannot use are not rendered).
 * Everything explanatory (XP note, coverage, fallback) sits behind ⓘ sheets.
 */
export default function Home(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const labels = useUiLabels();
  const { pendingEvents, syncStatus, storageDegraded } = useServices();
  const { enrollment, me, query } = useActiveEnrollment();
  const nav = useEnrollmentNavigation(enrollment);
  const cta = homeCta(nav);
  const { pathway, manifest } = usePathway(nav.missions ? enrollment : null);
  const { cast } = useCast(nav.missions ? enrollment : null);
  const reviews = useReviewsDue(enrollment, 12);
  const progress = useProgress(Boolean(me));
  const fallback = useFallbackOptIn(enrollment);
  // The course picked in onboarding is replayed into an enrollment here, after sign-up or sign-in.
  const replay = useOnboardingReplay();
  // Only the fallback the learner explicitly accepted is ever passed to the translator (§2.1).
  const sourceT = useSourceTranslator(enrollment?.sourceLanguageCode, fallback.active);
  useEffect(() => track.screenView('home', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);

  const perEnrollment = progress.data?.data.perEnrollment.find((p) => p.enrollmentId === enrollment?.id) ?? null;
  // The API only reports a 7-day figure; it is labelled as such (no "today", no invented goal).
  const speakingMinutes7d = perEnrollment ? Math.round(perEnrollment.speakingSecondsLast7Days / 60) : null;
  const streak = progress.data?.data.streak ?? null;
  const next = pathway?.next ?? null;
  const greeting = me?.displayName ? t('home.welcomeBack', { name: me.displayName }) : perEnrollment && perEnrollment.missionsCompleted > 0 ? t('home.welcomeBackAnonymous') : t('home.welcomeFirst');
  const mascotLine = sourceT?.resolve('mascot.state.welcome');
  const sourceName = enrollment ? names(enrollment.sourceLanguageCode) : '';
  const fallbackName = fallback.offered ? names(fallback.offered) : null;
  const mascotState = !enrollment ? 'curious' : next || cta === 'speak' ? 'welcome' : 'happy';
  const openConversation = (): void => {
    // Guard instead of `enrollment!`: an unconditional `enrollment.id` load in a render-scope closure lets the
    // React Compiler treat `enrollment` as non-null and drop the `?.` from the memoised deps above, which then
    // throws while `/v1/me` is still loading (blank Home on web, caught by the headless evidence run).
    if (!enrollment) return;
    void haptic('select');
    router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id } });
  };

  return (
    <Screen insideTabs testID="screen-home" headerEnd={<Button testID="home-account" label={t('account.title')} variant="ghost" size="sm" icon="settings" onPress={() => router.push('/account')} accessibilityLabel={t('account.title')} />}>
      <Row gap={theme.spacing.md} align="flex-start">
        <Melo state={mascotState} size="companion" speech={mascotLine && !mascotLine.missing ? mascotLine.text : undefined} bubblePlacement="below" testID="home-mascot" />
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <ThemedText variant="title" accessibilityRole="header">
            {greeting}
          </ThemedText>
          {mascotLine?.isFallback && sourceT ? <Chip label={X.fallbackInUse(names(sourceT.fallbackLanguage ?? ''))} tone="info" icon="translate" /> : null}
        </View>
      </Row>

      {storageDegraded ? <StatusLine icon="warning" tone="warning" text={X.storageDegraded} /> : null}
      {query.isLoading ? <LoadingView /> : null}
      {query.error && !query.data ? <ErrorView error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data?.fromCache ? <CacheNotice fetchedAt={query.data.fetchedAt} /> : null}

      {replay.state.status === 'running' || (replay.pending && replay.state.status === 'idle' && !enrollment) ? <StatusLine icon="info" tone="info" text={t('onboarding.replay.pending')} /> : null}
      {replay.state.status === 'failed' ? (
        <Surface variant="glass" level={1} radius="md" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
          <Row justify="space-between" gap={theme.spacing.sm}>
            <StatusLine icon="warning" tone="warning" text={t('onboarding.replay.failed')} />
            <InfoAffordance label={t('common.details')} text={errorMessageFor(replay.state.error, t)} />
          </Row>
          {replay.state.retryable ? <Button label={t('onboarding.replay.retry')} variant="secondary" size="sm" icon="replay" onPress={replay.retry} accessibilityLabel={t('onboarding.replay.retry')} /> : null}
        </Surface>
      ) : null}
      {query.data && !enrollment && !replay.pending && replay.state.status !== 'running' ? <EmptyState title={t('home.noCourse')} description={t('onboarding.chooseTargetHint')} infoLabel={t('common.moreInformation')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} /> : null}

      {enrollment ? (
        <View style={{ gap: theme.spacing.lg }}>
          {/* Hidden switch affordance kept for the e2e flows; the header's edit icon is the visible one. */}
          <View style={{ height: 0, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Button testID="home-switch-course" label={t('home.switchCourse')} variant="ghost" size="sm" onPress={() => router.push('/course-switcher')} accessibilityLabel={t('home.switchCourse')} />
          </View>
          {enrollment.coverage.status !== 'complete' ? (
            // Coverage = one compact chip (2 words); the long status, the detail and the fallback note sit behind ⓘ.
            <View style={{ gap: theme.spacing.xs }}>
              <Row gap={theme.spacing.sm} align="center">
                <Chip label={t(`enrollment.coverage.short.${enrollment.coverage.status}`)} tone="warning" icon="info" accessibilityLabel={t(`enrollment.coverage.${enrollment.coverage.status}`, { source: sourceName })} />
                <InfoAffordance
                  label={t('home.coverageInfo')}
                  title={t(`enrollment.coverage.${enrollment.coverage.status}`, { source: sourceName })}
                  text={[t(`enrollment.coverage.detail.${enrollment.coverage.status}`, { source: sourceName, fallback: fallbackName ?? '' }), ...(fallback.offered && fallbackName ? [fallback.active ? X.fallbackInUse(fallbackName) : t('enrollment.coverage.optInFallbackHint', { fallback: fallbackName, source: sourceName })] : [])]}
                />
              </Row>
              {fallback.offered && fallbackName ? (
                fallback.active ? (
                  <Button label={X.fallbackStop} variant="ghost" size="sm" onPress={fallback.optOut} accessibilityLabel={X.fallbackStop} />
                ) : (
                  <Button label={t('enrollment.coverage.optInFallback', { fallback: fallbackName })} variant="secondary" size="sm" onPress={fallback.optIn} accessibilityLabel={t('enrollment.coverage.optInFallback', { fallback: fallbackName })} />
                )
              ) : null}
            </View>
          ) : null}
          {cta === 'missions' && manifest.isLoading ? <LoadingView rows={1} /> : null}
          {cta === 'missions' && manifest.error && !manifest.data ? <ErrorView error={manifest.error} onRetry={() => void manifest.refetch()} /> : null}
          {cta === 'speak' ? (
            // No mission pathway for this pair yet: the primary action is the live conversation (never an empty card).
            <Button testID="home-cta-speak" label={t('home.quickSpeak')} icon="mic" size="lg" fullWidth glow onPress={openConversation} accessibilityLabel={`${t('home.quickSpeak')} · ${getCourseTrack(enrollment.courseTrackId).displayName}`} />
          ) : next ? (
            <View style={{ gap: theme.spacing.sm }}>
              <MissionCard
                title={next.mission.title}
                objective={next.mission.skillKeys.map((k) => k.replace(/_/g, ' ')).join(', ')}
                minutes={next.minutes}
                focus={next.focus}
                status={next.status}
                type={next.mission.type}
                sceneId={next.sceneId}
                skills={next.mission.skillKeys.map((k) => ({ key: k, label: k.replace(/_/g, ' '), completed: false }))}
                labels={labels.mission}
                calmLabels={{ details: t('common.details'), hideDetails: t('common.hideDetails') }}
                onPress={() => {
                  void haptic('select');
                  track.onboardingStep('first_mission_started');
                  router.push({ pathname: '/mission/[id]', params: { id: next.mission.id } });
                }}
              />
              <MissionCast characterIds={next.mission.characterIds} cast={cast} mission={{ skillKeys: next.mission.skillKeys, sceneId: next.sceneId }} withName testID="home-mission-cast" />
            </View>
          ) : pathway && pathway.missions.length > 0 ? (
            <EmptyState title={t('missions.summary.completed')} description={t('progress.review.allDone')} infoLabel={t('common.moreInformation')} mascotState="celebrate" />
          ) : null}

          {/* Melo's bubble is Home's one helper line. The 7-day speaking figure and the XP note live in the Progress tab;
              on Home the ⓘ only accompanies the figure it explains (the streak chip), so no affordance ever sits alone on a
              line (calm density: nothing on screen without a referent). A failed progress query shows the retry
              affordance, never an "insufficient data" line. */}
          <Row gap={theme.spacing.sm} align="center" wrap>
            {/* Nothing due → no button (§8: never a greyed control); the Progress tab keeps the review calendar. */}
            {reviews.data && reviews.data.data.dueCount > 0 ? <Button label={t('home.reviewDueCount', { count: reviews.data.data.dueCount })} variant="secondary" icon="replay" onPress={() => router.push('/review')} accessibilityLabel={t('home.reviewDue')} /> : null}
            {nav.audio ? <Button label={t('common.tabs.audio')} variant="secondary" icon="headphones" onPress={() => router.push('/(tabs)/audio')} accessibilityLabel={t('home.continueAudio')} /> : null}
            {nav.liveConversation && cta !== 'speak' ? <Button label={t('home.quickSpeak')} variant="secondary" icon="mic" onPress={openConversation} accessibilityLabel={`${t('home.quickSpeak')} · ${getCourseTrack(enrollment.courseTrackId).displayName}`} /> : null}
            {progress.error && !progress.data ? <Button label={t('common.retry')} variant="ghost" size="sm" icon="replay" onPress={() => void progress.refetch()} accessibilityLabel={`${t('home.aboutProgress')} · ${t('common.retry')}`} /> : null}
          </Row>
          {streak?.enabled && streak.currentDays > 0 ? (
            <Row gap={theme.spacing.xs} align="center">
              <Chip label={t('home.streak', { count: streak.currentDays })} icon="flame" tone="accent" />
              <InfoAffordance label={t('home.aboutProgress')} title={t('home.dailySpeaking')} text={[...(speakingMinutes7d !== null ? [t('home.speakingSummary', { count: speakingMinutes7d })] : []), t('home.xpNote'), t('progress.noFluencyClaim')]} />
            </Row>
          ) : null}

          {pendingEvents > 0 ? <StatusLine icon={syncStatus === 'error' ? 'warning' : 'info'} tone={syncStatus === 'error' ? 'warning' : 'info'} text={syncStatus === 'error' ? t('errors.syncFailed') : X.pendingSync(pendingEvents)} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
