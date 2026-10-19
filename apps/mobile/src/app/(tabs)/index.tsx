import { getCourseTrack } from '@langquest/contracts';
import { Button, Chip, EmptyState, Mascot, MissionCard, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { usePathway } from '@/features/missions/use-pathway';
import { useFallbackOptIn } from '@/features/session/fallback';
import { useActiveEnrollment, useProgress, useReviewsDue } from '@/features/session/queries';
import { useExtraLabels } from '@/lib/extra-labels';
import { useLanguageNames, useSourceTranslator, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { AUDIO_TAB_PLACEHOLDER } from '@/features/audio/placeholder';

/** Screen 2: Home / today. Primary CTA launches a speakable mission in one tap. */
export default function Home(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const labels = useUiLabels();
  const { pendingEvents, syncStatus, storageDegraded } = useServices();
  const { enrollment, me, query } = useActiveEnrollment();
  const { pathway, manifest } = usePathway(enrollment);
  const reviews = useReviewsDue(enrollment, 12);
  const progress = useProgress(Boolean(me));
  const fallback = useFallbackOptIn(enrollment);
  // Only the fallback the learner explicitly accepted is ever passed to the translator (§2.1).
  const sourceT = useSourceTranslator(enrollment?.sourceLanguageCode, fallback.active);
  useEffect(() => track.screenView('home', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);

  const perEnrollment = progress.data?.data.perEnrollment.find((p) => p.enrollmentId === enrollment?.id) ?? null;
  // The API only reports a 7-day figure; it is labelled as such (no "today", no invented goal).
  const speakingMinutes7d = perEnrollment ? Math.round(perEnrollment.speakingSecondsLast7Days / 60) : null;
  const streak = progress.data?.data.streak ?? null;
  const next = pathway?.next ?? null;
  const noContent = pathway !== null && pathway.missions.length === 0;
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

      {query.data && !enrollment ? <EmptyState title={t('home.noCourse')} description={t('onboarding.chooseTargetHint')} mascotState="curious" actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} /> : null}

      {enrollment ? (
        <View style={{ gap: theme.spacing.lg }}>
          <Row gap={theme.spacing.sm} justify="space-between">
            <ThemedText variant="heading" accessibilityRole="header">
              {t('home.nextConversation')}
            </ThemedText>
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
          {manifest.isLoading ? <LoadingView rows={1} /> : null}
          {manifest.error && !manifest.data ? <ErrorView error={manifest.error} onRetry={() => void manifest.refetch()} /> : null}
          {noContent ? (
            // A course with no published missions is "not available yet", never "all caught up".
            <EmptyState title={t('common.notAvailable')} description={fallbackName ? t('enrollment.coverage.detail.planned', { source: sourceName, fallback: fallbackName }) : X.plannedNoFallback(sourceName)} mascotState="quiet_audio" />
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
          ) : pathway ? (
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

          <Button
            label={`${t('home.reviewDue')} · ${t('home.reviewDueCount', { count: reviews.data?.data.dueCount ?? 0 })}`}
            variant="secondary"
            icon="replay"
            fullWidth
            disabled={!reviews.data || reviews.data.data.dueCount === 0}
            onPress={() => router.push('/review')}
            accessibilityLabel={t('home.reviewDue')}
          />
          <Button label={t('home.continueAudio')} variant="secondary" icon="headphones" fullWidth disabled={!AUDIO_TAB_PLACEHOLDER.available} onPress={() => router.push('/(tabs)/audio')} accessibilityLabel={t('home.continueAudio')} />
          <Button label={t('home.quickSpeak')} icon="mic" fullWidth onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id } })} accessibilityLabel={`${t('home.quickSpeak')} · ${getCourseTrack(enrollment.courseTrackId).displayName}`} />

          {pendingEvents > 0 ? <StatusLine icon={syncStatus === 'error' ? 'warning' : 'info'} tone={syncStatus === 'error' ? 'warning' : 'info'} text={syncStatus === 'error' ? t('errors.syncFailed') : X.pendingSync(pendingEvents)} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
