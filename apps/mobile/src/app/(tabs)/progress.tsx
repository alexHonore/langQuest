import { Button, Chip, EmptyState, InfoAffordance, ProgressBar, Row, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { dueCalendar } from '@/features/progress/due-calendar';
import { useActiveEnrollment, useProgress, useReviewsDue } from '@/features/session/queries';
import { headingLevel } from '@/lib/a11y';
import { useI18n } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';

/**
 * Screen 9 (calm density): can-do mastery with evidence + uncertainty, due calendar, achievements; XP is
 * engagement only. One line per skill (descriptor + mastery chip + uncertainty bar); how mastery, evidence
 * and uncertainty are measured — and that streaks never mean "fluent" — sit behind the header ⓘ.
 */
export default function Progress(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { t, translator } = useI18n();
  const labels = useUiLabels();
  const { api } = useServices();
  const { enrollment } = useActiveEnrollment();
  const progress = useProgress();
  const reviews = useReviewsDue(enrollment, 50);
  const skills = useQuery({ queryKey: ['skills', enrollment?.id], enabled: Boolean(enrollment), queryFn: () => api.skills(enrollment!.id), retry: false });
  useEffect(() => track.screenView('progress', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);
  const per = progress.data?.data.perEnrollment.find((p) => p.enrollmentId === enrollment?.id) ?? null;
  const calendar = useMemo(() => dueCalendar(reviews.data?.data.items.map((i) => i.card.due) ?? [], new Date()), [reviews.data]);
  const about = [t('progress.xpExplainer'), t('progress.noFluencyClaim'), t('progress.uncertaintyHint'), ...(['not_attempted', 'emerging', 'practiced', 'independent', 'durable'] as const).map((m) => `${labels.mastery[m]}: ${t(`progress.masteryHint.${m}`)}`)];

  return (
    <Screen insideTabs title={t('progress.title')} headerEnd={<InfoAffordance label={t('progress.aboutMastery')} title={t('progress.title')} text={about} />}>
      {progress.isLoading ? <LoadingView /> : null}
      {progress.error && !progress.data ? <ErrorView error={progress.error} onRetry={() => void progress.refetch()} /> : null}
      {progress.data?.fromCache ? <CacheNotice fetchedAt={progress.data.fetchedAt} /> : null}

      {per ? (
        <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
          <ThemedText variant="subheading">{t('progress.conversationOutcome', { completed: per.missionsCompletedWithoutHints, total: per.missionsCompleted })}</ThemedText>
          <ThemedText tone="secondary">{t('home.speakingSummary', { count: Math.round(per.speakingSecondsLast7Days / 60) })}</ThemedText>
          <Row gap={theme.spacing.sm} wrap>
            <Chip label={`${per.xp} ${t('progress.xp')}`} tone="neutral" icon="star" />
            {per.recall7DayPct !== null ? <Chip label={`7d · ${translator.formatPercent(per.recall7DayPct)}`} tone="info" /> : null}
            {progress.data?.data.streak.enabled ? <Chip label={t('home.streak', { count: progress.data.data.streak.currentDays })} icon="flame" tone="accent" /> : null}
          </Row>
        </Surface>
      ) : null}

      <ThemedText variant="heading" accessibilityRole="header" {...headingLevel(2)}>
        {t('progress.canDo')}
      </ThemedText>
      {skills.isLoading ? <LoadingView rows={2} /> : null}
      {skills.error ? <ErrorView error={skills.error} onRetry={() => void skills.refetch()} /> : null}
      {skills.data && skills.data.items.length === 0 ? <EmptyState title={t('progress.evidenceCount', { count: 0 })} description={t('progress.masteryHint.not_attempted')} infoLabel={t('common.moreInformation')} mascotState="encouraging" /> : null}
      {skills.data?.items.map((s) => (
        <Surface key={s.skillKey} variant="glass" level={1} radius="md" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
          <Row gap={theme.spacing.sm} justify="space-between">
            <ThemedText variant="subheading" style={{ flex: 1 }}>
              {s.descriptor}
            </ThemedText>
            <Chip label={labels.mastery[s.masteryState]} tone={s.masteryState === 'durable' || s.masteryState === 'independent' ? 'success' : s.masteryState === 'not_attempted' ? 'neutral' : 'info'} />
          </Row>
          <ProgressBar value={1 - s.uncertainty} accessibilityLabel={`${t(`progress.masteryHint.${s.masteryState}`)} ${t('progress.evidenceCount', { count: s.evidenceCount })} · ${t('progress.uncertainty', { level: s.uncertainty > 0.66 ? t('pronunciation.feedback.confidence.limited') : s.uncertainty > 0.33 ? t('pronunciation.feedback.confidence.medium') : t('pronunciation.feedback.confidence.high') })}${s.cefrCanDo ? ` · ${s.cefrCanDo}` : ''}`} height={4} tone="info" />
        </Surface>
      ))}

      <ThemedText variant="heading" accessibilityRole="header" {...headingLevel(2)}>
        {t('progress.dueReviews')}
      </ThemedText>
      {reviews.data ? (
        <View style={{ gap: theme.spacing.xs }}>
          {calendar.map((day) => (
            <Row key={day.date} gap={theme.spacing.md} justify="space-between">
              <ThemedText tone={day.overdue ? 'warning' : 'primary'}>{day.label}</ThemedText>
              <Chip label={t('progress.review.due', { count: day.count })} tone={day.count > 0 ? (day.overdue ? 'warning' : 'accent') : 'neutral'} />
            </Row>
          ))}
          {reviews.data.data.dueCount > 0 ? <Button label={t('progress.review.title')} icon="replay" glow onPress={() => router.push('/review')} accessibilityLabel={t('progress.review.title')} /> : null}
        </View>
      ) : reviews.isLoading ? (
        <LoadingView rows={1} />
      ) : null}

      {progress.data && progress.data.data.achievements.length > 0 ? (
        <>
          <ThemedText variant="heading" accessibilityRole="header" {...headingLevel(2)}>
            {t('progress.badges')}
          </ThemedText>
          <Row gap={theme.spacing.sm} wrap>
            {progress.data.data.achievements.map((a) => (
              <Chip key={`${a.key}-${a.unlockedAt}`} label={a.key.replace(/_/g, ' ')} icon="star" tone="success" />
            ))}
          </Row>
        </>
      ) : null}
    </Screen>
  );
}
