import { SOURCE_LANGUAGES, getCourseTrack, isCourseTrackId, type LearnerLevel, type ScriptMode, type SourceLanguageCode } from '@langquest/contracts';
import { Button, Chip, CourseCover, Row, StatusLine, Surface, ThemedText, dialectClarification, orderedSourceLanguages, useTheme } from '@langquest/ui';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CoverageStatus } from '@/components/CoverageStatus';
import { ErrorView } from '@/components/StateViews';
import { useActiveEnrollment, useCourses, useInvalidateLearner } from '@/features/session/queries';
import { useExtraLabels } from '@/lib/extra-labels';
import { newUuid } from '@/lib/ids';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

const LEVELS: readonly LearnerLevel[] = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'];

/**
 * Enrollment wizard: source language prefilled from the profile default but
 * editable here; script mode, regional option and level; honest coverage for
 * the chosen (track, source) pair with an explicit fallback opt-in.
 */
export default function EnrollTrack(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const X = useExtraLabels();
  const { api } = useServices();
  const { trackId } = useLocalSearchParams<{ trackId: string }>();
  const { me, enrollments } = useActiveEnrollment();
  const setPrefs = usePrefs((s) => s.set);
  const invalidate = useInvalidateLearner();
  const valid = typeof trackId === 'string' && isCourseTrackId(trackId);
  const trackDef = valid ? getCourseTrack(trackId) : null;
  const [source, setSource] = useState<SourceLanguageCode | null>((me?.defaultSourceLanguageCode as SourceLanguageCode | null) ?? null);
  const [scriptMode, setScriptMode] = useState<ScriptMode | null>(trackDef?.defaultScriptMode ?? null);
  const [regional, setRegional] = useState<string | null>(null);
  const [level, setLevel] = useState<LearnerLevel>('beginner');
  const courses = useCourses(source);
  const coverage = useMemo(() => courses.data?.data.courses.find((c) => c.track.id === trackId)?.coverage.find((c) => c.sourceLanguageCode === source) ?? null, [courses.data, trackId, source]);
  const existing = enrollments.find((e) => e.courseTrackId === trackId && e.sourceLanguageCode === source);
  const summary = courses.data?.data.courses.find((c) => c.track.id === trackId) ?? null;

  const enroll = useMutation({
    mutationFn: async () => {
      if (!trackDef || !source) throw new Error('missing selection');
      const dto = await api.enrollmentCreate(
        { courseTrackId: trackDef.id, sourceLanguageCode: source, scriptMode: scriptMode ?? undefined, regionalPreference: regional ?? undefined, learnerLevel: level },
        newUuid(),
      );
      return dto;
    },
    onSuccess: async (dto) => {
      track.onboardingStep('enrolled');
      setPrefs({ activeEnrollmentId: dto.id, pendingTrackId: null });
      await invalidate();
      router.replace('/(tabs)');
    },
  });

  if (!trackDef) {
    return (
      <Screen title={t('catalog.title')} onBack={() => router.back()}>
        <ErrorView error={new Error(t('errors.notFound'))} />
      </Screen>
    );
  }
  const clar = dialectClarification(trackDef);
  const sources = orderedSourceLanguages().filter((s) => s.code !== trackDef.languageCode && SOURCE_LANGUAGES.some((x) => x.code === s.code));

  return (
    <Screen title={trackDef.displayName} onBack={() => router.back()} enrollment={null} course={null}>
      <CourseCover trackId={trackDef.id} title={trackDef.displayName} />
      <ThemedText tone="secondary">{clar.focus}</ThemedText>
      {clar.distinctFrom.length > 0 ? <StatusLine icon="warning" tone="warning" text={`≠ ${clar.distinctFrom.join(', ')}`} /> : null}
      {trackDef.assumptions.map((a) => (
        <ThemedText key={a} variant="caption" tone="muted">
          {t('catalog.assumption', { text: a })}
        </ThemedText>
      ))}
      {trackDef.tonal ? <StatusLine icon="info" tone="info" text={t('catalog.tonalNote')} /> : null}
      {trackDef.sharesAssetsWithTrackId ? <StatusLine icon="info" tone="info" text={t('catalog.sharedAssets')} /> : null}

      <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('enrollment.sourceLanguageFor', { target: trackDef.displayName })}</ThemedText>
        <ThemedText variant="caption" tone="muted">
          {t('onboarding.learnFromEditLater')}
        </ThemedText>
        <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
          {sources.map((s) => (
            <View key={s.code} testID={`catalog-source-${s.code}`}>
              <Chip label={names(s.code)} selected={source === s.code} tone={s.prominent ? 'accent' : 'neutral'} onPress={() => setSource(s.code)} accessibilityLabel={names(s.code)} />
            </View>
          ))}
        </Row>
        {source ? (
          <View style={{ gap: theme.spacing.xs }}>
            {/* The editorial status for this exact (track, source) pair; while it loads nothing is guessed. */}
            {coverage || !courses.isLoading ? (
              <CoverageStatus testID="catalog-coverage" status={coverage?.status ?? 'planned'} sourceLanguageCode={source} nativeReviewed={coverage?.nativeReviewed} fallbackSourceLanguageCode={coverage?.fallbackSourceLanguageCode ?? null} verbose />
            ) : null}
            {coverage && coverage.status !== 'complete' && coverage.fallbackSourceLanguageCode ? (
              <ThemedText variant="caption" tone="secondary">
                {t('enrollment.coverage.optInFallbackHint', { fallback: names(coverage.fallbackSourceLanguageCode), source: names(source) })}
              </ThemedText>
            ) : null}
            {summary ? (
              <Row gap={theme.spacing.xs} wrap>
                {summary.publicationState !== 'published' ? <Chip label={X.publicationState[summary.publicationState] ?? summary.publicationState} tone="warning" icon="info" /> : null}
                <Chip label={X.missionsPublished(summary.publishedMissionCount)} tone={summary.publishedMissionCount === 0 ? 'warning' : 'neutral'} />
              </Row>
            ) : null}
            {!courses.data && courses.isLoading ? <ThemedText variant="caption" tone="muted">{t('common.loading')}</ThemedText> : null}
          </View>
        ) : null}
      </Surface>

      {trackDef.scriptModeOptions.length > 1 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('enrollment.scriptMode')}</ThemedText>
          <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
            {trackDef.scriptModeOptions.map((m) => (
              <Chip key={m} label={t(`lesson.scriptMode.${m}`, { script: trackDef.scripts.primary })} selected={scriptMode === m} onPress={() => setScriptMode(m)} />
            ))}
          </Row>
        </View>
      ) : null}
      {trackDef.regionalOptions.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('catalog.regionalOptions')}</ThemedText>
          <ThemedText variant="caption" tone="muted">
            {t('catalog.regionalOptionHint')}
          </ThemedText>
          <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
            {trackDef.regionalOptions.map((o) => (
              <Chip key={o.id} label={o.label} selected={regional === o.id} onPress={() => setRegional(regional === o.id ? null : o.id)} />
            ))}
          </Row>
        </View>
      ) : null}
      <View style={{ gap: theme.spacing.xs }}>
        <ThemedText variant="label">{t('onboarding.level.title')}</ThemedText>
        <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
          {LEVELS.map((l) => (
            <Chip key={l} label={t(`onboarding.level.${l}`)} selected={level === l} onPress={() => setLevel(l)} />
          ))}
        </Row>
      </View>

      {enroll.error ? <ErrorView error={enroll.error} /> : null}
      {existing ? (
        <Button label={t('catalog.enrolled')} variant="secondary" icon="check" fullWidth onPress={() => { setPrefs({ activeEnrollmentId: existing.id }); router.replace('/(tabs)'); }} accessibilityLabel={t('catalog.enrolled')} />
      ) : (
        <Button testID="catalog-enroll" label={source ? t('onboarding.learnFrom', { target: trackDef.displayName, source: names(source) }) : t('catalog.enroll')} size="lg" fullWidth disabled={!source || coverage?.status === 'unavailable'} loading={enroll.isPending} onPress={() => enroll.mutate()} accessibilityLabel={t('catalog.enroll')} />
      )}
    </Screen>
  );
}
