import { SOURCE_LANGUAGES, getCourseTrack, type EnrollmentPatchRequest, type LearnerLevel, type SourceLanguageCode } from '@langquest/contracts';
import { Button, Chip, CoverageBadge, Row, StatusLine, Surface, ThemedText, orderedSourceLanguages, useTheme } from '@langquest/ui';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView } from '@/components/StateViews';
import { useActiveEnrollment, useCourses, useInvalidateLearner } from '@/features/session/queries';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';
import { getLocalStore } from '@/store';

const LEVELS: readonly LearnerLevel[] = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'];

/**
 * Per-enrollment editor (§2.1): change the instruction language (never resets
 * progress; server RPC only touches `source_language_code`), script mode,
 * regional preference, level, temporary translation language, and archive
 * with confirmation. Other enrollments are untouched.
 */
export default function EnrollmentEditor(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const labels = useUiLabels();
  const { api } = useServices();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enrollments, me } = useActiveEnrollment();
  const invalidate = useInvalidateLearner();
  const setPrefs = usePrefs((s) => s.set);
  const enrollment = enrollments.find((e) => e.id === id) ?? me?.enrollments.find((e) => e.id === id) ?? null;
  const [source, setSource] = useState<SourceLanguageCode | null>(enrollment?.sourceLanguageCode ?? null);
  const coursesForSource = useCourses(source);
  const coverage = coursesForSource.data?.data.courses.find((c) => c.track.id === enrollment?.courseTrackId)?.coverage.find((c) => c.sourceLanguageCode === source) ?? null;
  const [status, setStatus] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: async (body: EnrollmentPatchRequest) => {
      if (!enrollment) throw new Error('missing');
      const before = enrollment.sourceLanguageCode;
      const dto = await api.enrollmentPatch(enrollment.id, body);
      if (body.sourceLanguageCode && body.sourceLanguageCode !== before) {
        track.enrollmentSourceChanged(before, body.sourceLanguageCode);
        const store = await getLocalStore();
        await store.cache.invalidateSource(enrollment.courseTrackId, before);
      }
      return dto;
    },
    onSuccess: async (dto, body) => {
      await invalidate();
      if (body.sourceLanguageCode) setStatus(t('enrollment.sourceChanged', { target: getCourseTrack(dto.courseTrackId).displayName, source: names(dto.sourceLanguageCode) }));
      else setStatus(t('common.done'));
    },
  });

  if (!enrollment) {
    return (
      <Screen title={t('enrollment.title')} onBack={() => router.back()}>
        <ErrorView error={new Error(t('errors.notFound'))} />
      </Screen>
    );
  }
  const trackDef = getCourseTrack(enrollment.courseTrackId);
  const sources = orderedSourceLanguages().filter((s) => s.code !== trackDef.languageCode && SOURCE_LANGUAGES.some((x) => x.code === s.code));

  const archive = (): void => {
    Alert.alert(t('enrollment.removeTitle', { target: trackDef.displayName }), t('enrollment.removeOtherCoursesSafe'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('enrollment.removeArchive'),
        style: 'destructive',
        onPress: () => {
          patch.mutate({ status: 'archived' });
          setPrefs({ activeEnrollmentId: null });
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen title={t('enrollment.sourceLanguageFor', { target: trackDef.displayName })} onBack={() => router.back()} enrollment={enrollment} noEdit>
      <StatusLine icon="info" tone="info" text={t('enrollment.editSourceHint')} />
      <ThemedText variant="caption" tone="muted">
        {t('enrollment.editSourceOnlyThis')}
      </ThemedText>
      <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('enrollment.sourceLanguage')}</ThemedText>
        <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
          {sources.map((s) => (
            <Chip key={s.code} label={names(s.code)} selected={source === s.code} tone={s.prominent ? 'accent' : 'neutral'} onPress={() => setSource(s.code)} accessibilityLabel={names(s.code)} />
          ))}
        </Row>
        {source ? <CoverageBadge status={coverage?.status ?? (source === enrollment.sourceLanguageCode ? enrollment.coverage.status : 'planned')} sourceLanguageCode={source} nativeReviewed={coverage?.nativeReviewed ?? enrollment.coverage.nativeReviewed} fallbackSourceLanguageCode={coverage?.fallbackSourceLanguageCode ?? null} verbose labels={labels.coverage} languageNames={{ [source]: names(source) }} /> : null}
        {source && source !== enrollment.sourceLanguageCode ? (
          <Button label={t('enrollment.editSource')} loading={patch.isPending} onPress={() => patch.mutate({ sourceLanguageCode: source })} accessibilityLabel={t('enrollment.editSource')} />
        ) : null}
        {patch.isPending && source !== enrollment.sourceLanguageCode ? <ThemedText variant="caption" tone="muted">{t('enrollment.sourceChangeRefresh', { source: names(source ?? '') })}</ThemedText> : null}
      </Surface>

      {trackDef.scriptModeOptions.length > 1 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('enrollment.scriptMode')}</ThemedText>
          <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
            {trackDef.scriptModeOptions.map((m) => (
              <Chip key={m} label={t(`lesson.scriptMode.${m}`, { script: trackDef.scripts.primary })} selected={enrollment.scriptMode === m} onPress={() => patch.mutate({ scriptMode: m })} />
            ))}
          </Row>
        </View>
      ) : null}
      {trackDef.regionalOptions.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('enrollment.regionalPreference')}</ThemedText>
          <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
            {trackDef.regionalOptions.map((o) => (
              <Chip key={o.id} label={o.label} selected={enrollment.regionalPreference === o.id} onPress={() => patch.mutate({ regionalPreference: enrollment.regionalPreference === o.id ? null : o.id })} />
            ))}
          </Row>
        </View>
      ) : null}
      <View style={{ gap: theme.spacing.xs }}>
        <ThemedText variant="label">{t('enrollment.level')}</ThemedText>
        <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
          {LEVELS.map((l) => (
            <Chip key={l} label={t(`onboarding.level.${l}`)} selected={enrollment.learnerLevel === l} onPress={() => patch.mutate({ learnerLevel: l })} />
          ))}
        </Row>
      </View>
      <View style={{ gap: theme.spacing.xs }}>
        <ThemedText variant="label">{t('enrollment.temporaryTranslation')}</ThemedText>
        <Row gap={theme.spacing.xs} wrap>
          <Chip label={t('common.no')} selected={enrollment.translationPeekLanguageCode === null} onPress={() => patch.mutate({ translationPeekLanguageCode: null })} />
          {sources
            .filter((s) => s.code !== enrollment.sourceLanguageCode)
            .slice(0, 8)
            .map((s) => (
              <Chip key={s.code} label={names(s.code)} selected={enrollment.translationPeekLanguageCode === s.code} onPress={() => patch.mutate({ translationPeekLanguageCode: s.code })} />
            ))}
        </Row>
      </View>
      {status ? <StatusLine icon="check" tone="success" text={status} /> : null}
      {patch.error ? <ErrorView error={patch.error} /> : null}
      <Button label={t('enrollment.remove')} variant="danger" icon="close" onPress={archive} accessibilityLabel={t('enrollment.remove')} />
      <ThemedText variant="caption" tone="muted">
        {t('enrollment.removeArchive')} — {t('enrollment.removeOtherCoursesSafe')}
      </ThemedText>
    </Screen>
  );
}
