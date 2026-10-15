import { Button, Chip, EmptyState, Mascot, MissionCard, ProgressBar, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { usePathway } from '@/features/missions/use-pathway';
import { useActiveEnrollment, useProgress, useReviewsDue } from '@/features/session/queries';
import { useSourceTranslator, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { AUDIO_TAB_PLACEHOLDER } from '@/features/audio/placeholder';

/** Screen 2: Home / today. Primary CTA launches a speakable mission in one tap. */
export default function Home(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const labels = useUiLabels();
  const { pendingEvents, syncStatus } = useServices();
  const { enrollment, me, query } = useActiveEnrollment();
  const { pathway, manifest } = usePathway(enrollment);
  const reviews = useReviewsDue(enrollment, 12);
  const progress = useProgress(Boolean(me));
  const sourceT = useSourceTranslator(enrollment?.sourceLanguageCode, enrollment?.coverage.fallbackSourceLanguageCode);
  useEffect(() => track.screenView('home', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);

  const perEnrollment = progress.data?.data.perEnrollment.find((p) => p.enrollmentId === enrollment?.id) ?? null;
  const speakingMinutes = perEnrollment ? Math.round(perEnrollment.speakingSecondsLast7Days / 60) : null;
  const streak = progress.data?.data.streak ?? null;
  const next = pathway?.next ?? null;
  const greeting = me?.displayName ? t('home.welcomeBack', { name: me.displayName }) : perEnrollment && perEnrollment.missionsCompleted > 0 ? t('home.welcomeBackAnonymous') : t('home.welcomeFirst');
  const mascotLine = sourceT?.resolve('mascot.state.welcome');

  return (
    <Screen insideTabs headerEnd={<Button label={t('account.title')} variant="ghost" size="sm" icon="settings" onPress={() => router.push('/account')} accessibilityLabel={t('account.title')} />}>
      <Row gap={theme.spacing.md} align="flex-start">
        <Mascot state="welcome" size="companion" speech={mascotLine && !mascotLine.missing ? mascotLine.text : undefined} />
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <ThemedText variant="title" accessibilityRole="header">
            {greeting}
          </ThemedText>
          {mascotLine?.isFallback && sourceT ? <ThemedText variant="caption" tone="muted">{t('enrollment.coverage.fallbackLabel', { fallback: sourceT.fallbackLanguage ?? '', source: sourceT.sourceLanguage })}</ThemedText> : null}
        </View>
      </Row>

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
            <Button label={t('home.switchCourse')} variant="ghost" size="sm" icon="globe" onPress={() => router.push('/course-switcher')} accessibilityLabel={t('home.switchCourse')} />
          </Row>
          {enrollment.coverage.status !== 'complete' ? (
            <StatusLine icon="info" tone="warning" text={t(`enrollment.coverage.${enrollment.coverage.status}`, { source: enrollment.sourceLanguageCode })} />
          ) : null}
          {manifest.isLoading ? <LoadingView rows={1} /> : null}
          {manifest.error && !manifest.data ? <ErrorView error={manifest.error} onRetry={() => void manifest.refetch()} /> : null}
          {next ? (
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
          ) : manifest.data ? (
            <EmptyState title={t('missions.summary.completed')} description={t('progress.review.allDone')} mascotState="celebrate" />
          ) : null}

          <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
            <ThemedText variant="subheading">{t('home.dailySpeaking')}</ThemedText>
            {speakingMinutes !== null ? (
              <>
                <ProgressBar value={Math.min(1, speakingMinutes / 20)} accessibilityLabel={t('home.dailySpeaking')} tone="success" />
                <ThemedText tone="secondary">{t('home.dailySpeakingDetail', { spoken: speakingMinutes })}</ThemedText>
              </>
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
          <Button label={t('home.quickSpeak')} icon="mic" fullWidth onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id } })} accessibilityLabel={t('home.quickSpeak')} />

          {pendingEvents > 0 ? <StatusLine icon={syncStatus === 'error' ? 'warning' : 'info'} tone={syncStatus === 'error' ? 'warning' : 'info'} text={syncStatus === 'error' ? t('errors.syncFailed') : `${pendingEvents} pending sync`} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
