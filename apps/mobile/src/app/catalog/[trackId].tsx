import { SOURCE_LANGUAGES, getCourseTrack, isCourseTrackId, type LearnerLevel, type ScriptMode, type SourceLanguageCode } from '@langquest/contracts';
import { Button, Chip, CourseCover, InfoAffordance, Row, Surface, ThemedText, dialectClarification, orderedSourceLanguages, useTheme } from '@langquest/ui';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CapabilityDisclaimer } from '@/components/CapabilityDisclaimer';
import { CoverageStatus } from '@/components/CoverageStatus';
import { ErrorView } from '@/components/StateViews';
import { useActiveEnrollment, useCourseCapabilities, useCourses, useInvalidateLearner } from '@/features/session/queries';
import { haptic } from '@/lib/haptics';
import { useExtraLabels } from '@/lib/extra-labels';
import { newUuid } from '@/lib/ids';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

const LEVELS: readonly LearnerLevel[] = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'];

/**
 * Enrollment wizard (calm density): cover, one helper line (what this variety is), the instruction
 * language, the script / regional / level chips, the short disclaimer card of what this course ×
 * instruction language does not have yet (CONVENTIONS §8) and ONE primary action. Assumptions,
 * tonal note, shared assets, mission counts and scoring support sit behind the ⓘ "About this course".
 * The confirm button stays enabled: the learner decides.
 */
export default function EnrollTrack(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
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
  const course = useMemo(() => courses.data?.data.courses.find((c) => c.track.id === trackId) ?? null, [courses.data, trackId]);
  const coverage = useMemo(() => course?.coverage.find((c) => c.sourceLanguageCode === source) ?? null, [course, source]);
  const existing = enrollments.find((e) => e.courseTrackId === trackId && e.sourceLanguageCode === source);
  const capabilities = useCourseCapabilities(valid ? trackId : null, source);

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
      void haptic('success');
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
  const about = [
    `${clar.varietyName} · ${trackDef.defaultLocale}`,
    ...trackDef.assumptions.map((a) => t('catalog.assumption', { text: a })),
    ...(trackDef.tonal ? [t('catalog.tonalNote')] : []),
    ...(trackDef.sharesAssetsWithTrackId ? [t('catalog.sharedAssets')] : []),
    t('catalog.scriptsOffered', { scripts: [trackDef.scripts.primary, ...trackDef.scripts.alternatives, ...trackDef.scripts.transliterations].join(', ') }),
    ...(course && course.publishedMissionCount > 0 ? [X.missionsPublished(course.publishedMissionCount)] : []),
    ...(course && (course.capabilities.pronunciationScoring === 'full' || course.capabilities.pronunciationScoring === 'partial') ? [t(`catalog.scoringSupport.${course.capabilities.pronunciationScoring}`)] : []),
    ...(trackDef.regionalOptions.length > 0 ? [t('catalog.regionalOptionHint')] : []),
    t('onboarding.learnFromEditLater'),
  ];

  return (
    <Screen title={trackDef.displayName} onBack={() => router.back()} enrollment={null} course={null} headerEnd={<InfoAffordance label={t('catalog.aboutCourse')} title={trackDef.displayName} text={about} tone="accent" />}>
      <CourseCover trackId={trackDef.id} title={trackDef.displayName} />
      <Row gap={theme.spacing.xs} wrap align="center">
        <ThemedText tone="secondary" style={{ flexShrink: 1 }}>
          {clar.focus}
        </ThemedText>
        {clar.distinctFrom.map((n) => (
          <Chip key={n} label={`≠ ${n}`} tone="warning" />
        ))}
      </Row>

      <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="subheading" accessibilityRole="header">
          {t('enrollment.sourceLanguage')}
        </ThemedText>
        <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
          {sources.map((s) => (
            <View key={s.code} testID={`catalog-source-${s.code}`}>
              <Chip label={names(s.code)} selected={source === s.code} tone={s.prominent ? 'accent' : 'neutral'} onPress={() => setSource(s.code)} accessibilityLabel={names(s.code)} />
            </View>
          ))}
        </Row>
        {/* The editorial status for this exact (track, source) pair; while it loads nothing is guessed. */}
        {source && (coverage || !courses.isLoading) ? <CoverageStatus testID="catalog-coverage" status={coverage?.status ?? 'planned'} sourceLanguageCode={source} nativeReviewed={coverage?.nativeReviewed} fallbackSourceLanguageCode={coverage?.fallbackSourceLanguageCode ?? null} verbose /> : null}
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

      {/* What this course × instruction language does not have yet — disclosed before enrolling (§8). */}
      {source ? <CapabilityDisclaimer testID="catalog-disclaimer" capabilities={capabilities.data?.data ?? null} sourceName={names(source)} targetName={trackDef.displayName} /> : null}

      {enroll.error ? <ErrorView error={enroll.error} /> : null}
      {existing ? (
        <Button label={t('catalog.enrolled')} variant="secondary" icon="check" fullWidth onPress={() => { setPrefs({ activeEnrollmentId: existing.id }); router.replace('/(tabs)'); }} accessibilityLabel={t('catalog.enrolled')} />
      ) : (
        <Button testID="catalog-enroll" label={source ? t('onboarding.learnFrom', { target: trackDef.displayName, source: names(source) }) : t('catalog.enroll')} size="lg" fullWidth glow disabled={!source} loading={enroll.isPending} onPress={() => enroll.mutate()} accessibilityLabel={t('catalog.enroll')} />
      )}
    </Screen>
  );
}
