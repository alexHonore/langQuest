import { getCourseTrack } from '@langquest/contracts';
import { Button, Chip, EmptyState, Mascot, MissionCard, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView, errorMessageFor } from '@/components/StateViews';
import { usePathway } from '@/features/missions/use-pathway';
import { useOnboardingReplay } from '@/features/onboarding/use-onboarding-replay';
import { useFallbackOptIn } from '@/features/session/fallback';
import { useActiveEnrollment, useProgress, useReviewsDue } from '@/features/session/queries';
import { homeCta } from '@/features/session/capabilities';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { headingLevel } from '@/lib/a11y';
import { useExtraLabels } from '@/lib/extra-labels';
import { useLanguageNames, useSourceTranslator, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';

/**
 * Screen 2: Home / today. Primary CTA launches a speakable mission in one tap — or, for a pair without a
 * mission pathway, the live conversation (CONVENTIONS §8: controls the enrollment cannot use are not rendered).
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

  return (
    <Screen insideTabs testID="screen-home" headerEnd={<Button testID="home-account" label={t('account.title')} variant="ghost" size="sm" icon="settings" onPress={() => router.push('/account')} accessibilityLabel={t('account.title')} />}>
      <Row gap={theme.spacing.md} align="flex-start">
        <Mascot state="welcome" size="companion" speech={mascotLine && !mascotLine.missing ? mascotLine.text : undefined} />
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <ThemedText variant="title" accessibilityRole="header">
            {greeting}
          </ThemedText>
          {mascotLine?.isFallback && sourceT ? <ThemedText variant="caption" tone="muted">{t('enrollment.coverage.fallbackLabel', { fallback: names(sourceT.fallbackLanguage ?? ''), source: names(sourceT.sourceLanguage) })}</ThemedText> : null}
        </View>
      </Row>

      {storageDegraded ? <StatusLine icon="warning" tone="warning" text={X.storageDegraded} /> : null}
      {query.isLoading ? <LoadingView /> : null}
      {query.error && !query.data ? <ErrorView error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data?.fromCache ? <CacheNotice fetchedAt={query.data.fetchedAt} /> : null}

      {replay.state.status === 'running' || (replay.pending && replay.state.status === 'idle' && !enrollment) ? <StatusLine icon="info" tone="info" text={t('onboarding.replay.pending')} /> : null}
      {replay.state.status === 'failed' ? (
        <Surface variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
          <StatusLine icon="warning" tone="warning" text={t('onboarding.replay.failed')} />
          <ThemedText variant="caption" tone="muted">{errorMessageFor(replay.state.error, t)}</ThemedText>
          {replay.state.retryable ? <Button label={t('onboarding.replay.retry')} variant="secondary" size="sm" icon="replay" onPress={replay.retry} accessibilityLabel={t('onboarding.replay.retry')} /> : null}
        </Surface>
      ) : null}
      {query.data && !enrollment && !replay.pending && replay.state.status !== 'running' ? <EmptyState title={t('home.noCourse')} description={t('onboarding.chooseTargetHint')} mascotState="curious" actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} /> : null}

      {enrollment ? (
        <View style={{ gap: theme.spacing.lg }}>
          <Row gap={theme.spacing.sm} justify="space-between">
            {cta ? (
              <ThemedText variant="heading" accessibilityRole="header" {...headingLevel(2)}>
                {t('home.nextConversation')}
              </ThemedText>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Button testID="home-switch-course" label={t('home.switchCourse')} variant="ghost" size="sm" icon="globe" onPress={() => router.push('/course-switcher')} accessibilityLabel={t('home.switchCourse')} />
          </Row>
          {enrollment.coverage.status !== 'complete' ? (
            <Surface variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
              <StatusLine icon="info" tone="warning" text={t(`enrollment.coverage.${enrollment.coverage.status}`, { source: sourceName })} />
              {fallback.offered && fallbackName ? (
                fallback.active ? (
                  <>
                    <ThemedText variant="caption" tone="secondary">{X.fallbackInUse(fallbackName)}</ThemedText>
                    <Button label={X.fallbackStop} variant="ghost" size="sm" onPress={fallback.optOut} accessibilityLabel={X.fallbackStop} />
                  </>
                ) : (
                  <>
                    <ThemedText variant="caption" tone="secondary">{t('enrollment.coverage.optInFallbackHint', { fallback: fallbackName, source: sourceName })}</ThemedText>
                    <Button label={t('enrollment.coverage.optInFallback', { fallback: fallbackName })} variant="secondary" size="sm" onPress={fallback.optIn} accessibilityLabel={t('enrollment.coverage.optInFallback', { fallback: fallbackName })} />
                  </>
                )
              ) : null}
            </Surface>
          ) : null}
          {cta === 'missions' && manifest.isLoading ? <LoadingView rows={1} /> : null}
          {cta === 'missions' && manifest.error && !manifest.data ? <ErrorView error={manifest.error} onRetry={() => void manifest.refetch()} /> : null}
          {cta === 'speak' ? (
            // No mission pathway for this pair yet: the primary action is the live conversation (never an empty card).
            <Button testID="home-cta-speak" label={t('home.quickSpeak')} icon="mic" size="lg" fullWidth onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id } })} accessibilityLabel={`${t('home.quickSpeak')} · ${getCourseTrack(enrollment.courseTrackId).displayName}`} />
          ) : next ? (
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
              onPress={() => {
                track.onboardingStep('first_mission_started');
                router.push({ pathname: '/mission/[id]', params: { id: next.mission.id } });
              }}
            />
          ) : pathway && pathway.missions.length > 0 ? (
            <EmptyState title={t('missions.summary.completed')} description={t('progress.review.allDone')} mascotState="celebrate" />
          ) : null}

          <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
            <ThemedText variant="subheading">{t('home.dailySpeaking')}</ThemedText>
            {speakingMinutes7d !== null ? (
              <ThemedText tone="secondary">{X.speakingLast7Days(speakingMinutes7d)}</ThemedText>
            ) : (
              <ThemedText tone="muted">{progress.isLoading ? t('common.loading') : t('progress.trendUnavailable')}</ThemedText>
            )}
            {streak?.enabled && streak.currentDays > 0 ? <Chip label={t('home.streak', { count: streak.currentDays })} icon="flame" tone="accent" /> : null}
            <ThemedText variant="caption" tone="muted">
              {t('home.xpNote')}
            </ThemedText>
          </Surface>

          {/* Nothing due → no button (§8: never a greyed control); the Progress tab keeps the review calendar. */}
          {reviews.data && reviews.data.data.dueCount > 0 ? (
            <Button
              label={`${t('home.reviewDue')} · ${t('home.reviewDueCount', { count: reviews.data.data.dueCount })}`}
              variant="secondary"
              icon="replay"
              fullWidth
              onPress={() => router.push('/review')}
              accessibilityLabel={t('home.reviewDue')}
            />
          ) : null}
          {nav.audio ? <Button label={t('home.continueAudio')} variant="secondary" icon="headphones" fullWidth onPress={() => router.push('/(tabs)/audio')} accessibilityLabel={t('home.continueAudio')} /> : null}
          {nav.liveConversation && cta !== 'speak' ? <Button label={t('home.quickSpeak')} icon="mic" fullWidth onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id } })} accessibilityLabel={`${t('home.quickSpeak')} · ${getCourseTrack(enrollment.courseTrackId).displayName}`} /> : null}

          {pendingEvents > 0 ? <StatusLine icon={syncStatus === 'error' ? 'warning' : 'info'} tone={syncStatus === 'error' ? 'warning' : 'info'} text={syncStatus === 'error' ? t('errors.syncFailed') : X.pendingSync(pendingEvents)} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
