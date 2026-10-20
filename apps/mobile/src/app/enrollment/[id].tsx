import { SOURCE_LANGUAGES, getCourseTrack, type EnrollmentPatchRequest, type LearnerLevel, type SourceLanguageCode } from '@langquest/contracts';
import { Button, Chip, InfoAffordance, Row, StatusLine, Surface, ThemedText, orderedSourceLanguages, useTheme } from '@langquest/ui';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CapabilityDisclaimer } from '@/components/CapabilityDisclaimer';
import { CoverageStatus } from '@/components/CoverageStatus';
import { ErrorView } from '@/components/StateViews';
import { useFallbackOptIn } from '@/features/session/fallback';
import { useActiveEnrollment, useCourses, useInvalidateLearner } from '@/features/session/queries';
import { ApiClientError } from '@/lib/api/client';
import { useExtraLabels } from '@/lib/extra-labels';
import { haptic } from '@/lib/haptics';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';
import { getLocalStore } from '@/store';

const LEVELS: readonly LearnerLevel[] = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'];

/**
 * Per-enrollment editor (§2.1, calm density): change the instruction language (never resets
 * progress; server RPC only touches `source_language_code`), script mode, regional preference,
 * level, temporary translation language, and remove the course with confirmation — archive
 * (progress kept, `PATCH ?confirm=archive`) or delete (§15: progress erased, `DELETE ?confirm=delete`).
 * Other enrollments are untouched. The explanations live behind the header ⓘ.
 */
export default function EnrollmentEditor(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const { api } = useServices();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enrollments, me } = useActiveEnrollment();
  const invalidate = useInvalidateLearner();
  const setPrefs = usePrefs((s) => s.set);
  const activeId = usePrefs((s) => s.activeEnrollmentId);
  const enrollment = enrollments.find((e) => e.id === id) ?? me?.enrollments.find((e) => e.id === id) ?? null;
  const [source, setSource] = useState<SourceLanguageCode | null>(enrollment?.sourceLanguageCode ?? null);
  const coursesForSource = useCourses(source);
  const coverage = coursesForSource.data?.data.courses.find((c) => c.track.id === enrollment?.courseTrackId)?.coverage.find((c) => c.sourceLanguageCode === source) ?? null;
  const [status, setStatus] = useState<string | null>(null);
  const fallback = useFallbackOptIn(enrollment);

  /** Leave the editor once the course is gone server-side (archived or deleted). */
  const leaveAfterRemoval = (removedId: string): void => {
    if (activeId === removedId) setPrefs({ activeEnrollmentId: null });
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const patch = useMutation({
    mutationFn: async (body: EnrollmentPatchRequest) => {
      if (!enrollment) throw new Error('missing');
      const before = enrollment.sourceLanguageCode;
      // Archiving sends `?confirm=archive` (derived in the endpoint wrapper); the API answers 412 otherwise.
      const dto = await api.enrollmentPatch(enrollment.id, body, body.status === 'archived' ? { confirm: 'archive' } : undefined);
      if (body.sourceLanguageCode && body.sourceLanguageCode !== before) {
        track.enrollmentSourceChanged(before, body.sourceLanguageCode);
        const store = await getLocalStore();
        await store.cache.invalidateSource(enrollment.courseTrackId, before);
      }
      return dto;
    },
    onSuccess: async (dto, body) => {
      await invalidate();
      void haptic('success');
      if (body.status === 'archived') {
        // Only now is the course gone server-side: clear the active course and leave.
        leaveAfterRemoval(dto.id);
        return;
      }
      if (body.sourceLanguageCode) setStatus(t('enrollment.sourceChanged', { target: getCourseTrack(dto.courseTrackId).displayName, source: names(dto.sourceLanguageCode) }));
      else setStatus(t('common.done'));
    },
  });

  const remove = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!enrollment) throw new Error('missing');
      try {
        const dto = await api.enrollmentDelete(enrollment.id);
        return dto.enrollmentId;
      } catch (error) {
        // A transport retry after a lost success response lands on the already-deleted row: that is done, not a failure.
        if (error instanceof ApiClientError && error.kind === 'not_found') return enrollment.id;
        throw error;
      }
    },
    onSuccess: async (removedId) => {
      // The server erased this course's progress; drop the device copy too so nothing resurrects it offline.
      const store = await getLocalStore();
      await store.cache.forgetEnrollment(removedId);
      await invalidate();
      leaveAfterRemoval(removedId);
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

  const removing = remove.isPending || (patch.isPending && patch.variables?.status === 'archived');
  const confirmRemove = (): void => {
    Alert.alert(t('enrollment.removeTitle', { target: trackDef.displayName }), `${X.removeDeletePermanent} ${t('enrollment.removeOtherCoursesSafe')}`, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('enrollment.removeArchive'),
        onPress: () => patch.mutate({ status: 'archived' }),
      },
      {
        text: t('enrollment.removeDelete'),
        style: 'destructive',
        onPress: () => remove.mutate(),
      },
    ]);
  };
  const about = [t('enrollment.editSourceHint'), t('enrollment.editSourceOnlyThis'), ...(fallback.offered ? [fallback.active ? X.fallbackInUse(names(fallback.active)) : t('enrollment.coverage.optInFallbackHint', { fallback: names(fallback.offered), source: names(enrollment.sourceLanguageCode) })] : []), `${t('enrollment.removeArchive')} · ${t('enrollment.removeDelete')} — ${X.removeDeletePermanent} ${t('enrollment.removeOtherCoursesSafe')}`];

  return (
    <Screen title={trackDef.displayName} onBack={() => router.back()} enrollment={enrollment} noEdit headerEnd={<InfoAffordance label={t('enrollment.aboutEditor')} title={t('enrollment.sourceLanguageFor', { target: trackDef.displayName })} text={about} tone="accent" />}>
      <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="subheading" accessibilityRole="header">
          {t('enrollment.sourceLanguage')}
        </ThemedText>
        <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
          {sources.map((s) => (
            <View key={s.code} testID={`enrollment-source-${s.code}`}>
              <Chip label={names(s.code)} selected={source === s.code} tone={s.prominent ? 'accent' : 'neutral'} onPress={() => setSource(s.code)} accessibilityLabel={names(s.code)} />
            </View>
          ))}
        </Row>
        {source ? (
          <CoverageStatus
            testID="enrollment-coverage"
            status={coverage?.status ?? (source === enrollment.sourceLanguageCode ? enrollment.coverage.status : 'planned')}
            sourceLanguageCode={source}
            nativeReviewed={coverage?.nativeReviewed ?? (source === enrollment.sourceLanguageCode ? enrollment.coverage.nativeReviewed : undefined)}
            fallbackSourceLanguageCode={coverage?.fallbackSourceLanguageCode ?? (source === enrollment.sourceLanguageCode ? enrollment.coverage.fallbackSourceLanguageCode : null)}
            verbose
          />
        ) : null}
        {source === enrollment.sourceLanguageCode && enrollment.coverage.status !== 'complete' && fallback.offered ? (
          fallback.active ? (
            <Button label={X.fallbackStop} variant="ghost" size="sm" onPress={fallback.optOut} accessibilityLabel={X.fallbackStop} />
          ) : (
            <Button label={t('enrollment.coverage.optInFallback', { fallback: names(fallback.offered) })} variant="secondary" size="sm" onPress={fallback.optIn} accessibilityLabel={t('enrollment.coverage.optInFallback', { fallback: names(fallback.offered) })} />
          )
        ) : null}
        {source && source !== enrollment.sourceLanguageCode ? (
          <Button testID="enrollment-change-source" label={t('enrollment.editSource')} glow loading={patch.isPending} onPress={() => patch.mutate({ sourceLanguageCode: source })} accessibilityLabel={t('enrollment.editSource')} />
        ) : null}
      </Surface>

      {/* Per-pair capabilities (§8); the DTO is refetched after a source change, so this follows the new pair. */}
      <CapabilityDisclaimer testID="enrollment-includes" capabilities={enrollment.capabilities} sourceName={names(enrollment.sourceLanguageCode)} targetName={trackDef.displayName} showIncludes />

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
      {status ? <Button testID="enrollment-done" label={t('common.done')} variant="secondary" onPress={() => router.back()} accessibilityLabel={t('common.done')} /> : null}
      {patch.error ? <ErrorView error={patch.error} /> : null}
      {remove.error ? <ErrorView error={remove.error} /> : null}
      <Button testID="enrollment-remove" label={t('enrollment.remove')} variant="danger" icon="close" loading={removing} onPress={confirmRemove} accessibilityLabel={t('enrollment.remove')} />
    </Screen>
  );
}
