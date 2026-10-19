import { Button, Chip, EmptyState, ProgressBar, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { dueCalendar } from '@/features/progress/due-calendar';
import { useActiveEnrollment, useProgress, useReviewsDue } from '@/features/session/queries';
import { useExtraLabels } from '@/lib/extra-labels';
import { useI18n } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';

/** Screen 9: can-do mastery with evidence + uncertainty, due calendar, achievements; XP is engagement only. */
export default function Progress(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { t, translator } = useI18n();
  const X = useExtraLabels();
  const labels = useUiLabels();
  const { api } = useServices();
  const { enrollment } = useActiveEnrollment();
  const progress = useProgress();
  const reviews = useReviewsDue(enrollment, 50);
  const skills = useQuery({ queryKey: ['skills', enrollment?.id], enabled: Boolean(enrollment), queryFn: () => api.skills(enrollment!.id), retry: false });
  useEffect(() => track.screenView('progress', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);
  const per = progress.data?.data.perEnrollment.find((p) => p.enrollmentId === enrollment?.id) ?? null;
  const calendar = useMemo(() => dueCalendar(reviews.data?.data.items.map((i) => i.card.due) ?? [], new Date()), [reviews.data]);

  return (
    <Screen insideTabs title={t('progress.title')}>
      {progress.isLoading ? <LoadingView /> : null}
      {progress.error && !progress.data ? <ErrorView error={progress.error} onRetry={() => void progress.refetch()} /> : null}
      {progress.data?.fromCache ? <CacheNotice fetchedAt={progress.data.fetchedAt} /> : null}

      {per ? (
        <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
          <ThemedText variant="heading">{t('progress.overview')}</ThemedText>
          <ThemedText>{t('progress.conversationOutcome', { completed: per.missionsCompletedWithoutHints, total: per.missionsCompleted })}</ThemedText>
          <ThemedText tone="secondary">{X.speakingLast7Days(Math.round(per.speakingSecondsLast7Days / 60))}</ThemedText>
          {per.recall7DayPct !== null ? <ThemedText tone="secondary">{`7d: ${translator.formatPercent(per.recall7DayPct)}`}</ThemedText> : <ThemedText tone="muted">{t('progress.trendUnavailable')}</ThemedText>}
          <Row gap={theme.spacing.sm} wrap>
            <Chip label={`${per.xp} ${t('progress.xp')}`} tone="neutral" icon="star" />
            {progress.data?.data.streak.enabled ? <Chip label={t('home.streak', { count: progress.data.data.streak.currentDays })} icon="flame" /> : null}
          </Row>
          <ThemedText variant="caption" tone="muted">
            {t('progress.xpExplainer')} {t('progress.noFluencyClaim')}
          </ThemedText>
        </Surface>
      ) : null}

      <ThemedText variant="heading" accessibilityRole="header">
        {t('progress.canDo')}
      </ThemedText>
      {skills.isLoading ? <LoadingView rows={2} /> : null}
      {skills.error ? <ErrorView error={skills.error} onRetry={() => void skills.refetch()} /> : null}
      {skills.data && skills.data.items.length === 0 ? <EmptyState title={t('progress.evidenceCount', { count: 0 })} description={t('progress.masteryHint.not_attempted')} mascotState="encouraging" /> : null}
      {skills.data?.items.map((s) => (
        <Surface key={s.skillKey} radius="md" padding={theme.spacing.md} bordered style={{ gap: theme.spacing.xs }}>
          <Row gap={theme.spacing.sm} justify="space-between">
            <ThemedText variant="subheading" style={{ flex: 1 }}>
              {s.descriptor}
            </ThemedText>
            <Chip label={labels.mastery[s.masteryState]} tone={s.masteryState === 'durable' || s.masteryState === 'independent' ? 'success' : s.masteryState === 'not_attempted' ? 'neutral' : 'info'} />
          </Row>
          <ThemedText variant="caption" tone="secondary">
            {t(`progress.masteryHint.${s.masteryState}`)}
          </ThemedText>
          <ThemedText variant="caption" tone="muted">
            {t('progress.evidenceCount', { count: s.evidenceCount })} · {t('progress.uncertainty', { level: s.uncertainty > 0.66 ? t('pronunciation.feedback.confidence.limited') : s.uncertainty > 0.33 ? t('pronunciation.feedback.confidence.medium') : t('pronunciation.feedback.confidence.high') })}
          </ThemedText>
          {s.cefrCanDo ? <ThemedText variant="caption" tone="muted">{s.cefrCanDo}</ThemedText> : null}
          <ProgressBar value={1 - s.uncertainty} accessibilityLabel={t('progress.uncertaintyHint')} height={4} tone="info" />
        </Surface>
      ))}

      <ThemedText variant="heading" accessibilityRole="header">
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
          {reviews.data.data.dueCount > 0 ? <Button label={t('progress.review.title')} icon="replay" onPress={() => router.push('/review')} accessibilityLabel={t('progress.review.title')} /> : null}
        </View>
      ) : reviews.isLoading ? (
        <LoadingView rows={1} />
      ) : null}

      <ThemedText variant="heading" accessibilityRole="header">
        {t('progress.badges')}
      </ThemedText>
      {progress.data && progress.data.data.achievements.length === 0 ? <ThemedText tone="muted">{t('common.items', { count: 0 })}</ThemedText> : null}
      <Row gap={theme.spacing.sm} wrap>
        {progress.data?.data.achievements.map((a) => (
          <Chip key={`${a.key}-${a.unlockedAt}`} label={a.key.replace(/_/g, ' ')} icon="star" tone="success" />
        ))}
      </Row>
      <StatusLine icon="info" tone="secondary" text={t('progress.uncertaintyHint')} />
    </Screen>
  );
}
