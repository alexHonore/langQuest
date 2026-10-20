import { getCourseTrack, type CourseTrackId, type ScriptMode } from '@langquest/contracts';
import { Chip, CourseCover, InfoAffordance, Row, ThemedText, dialectClarification, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { CapabilityDisclaimer } from '@/components/CapabilityDisclaimer';
import { OnboardingFrame } from '@/components/OnboardingFrame';
import { useCourseCapabilities } from '@/features/session/queries';
import { newUuid } from '@/lib/ids';
import { useLanguageNames, useT } from '@/lib/i18n';
import { usePrefs } from '@/state/prefs';

/**
 * "Learn X from Y" confirmation for this enrollment (calm density); the source can be edited per course
 * later. Shows the short capability disclaimer of the pair before the learner confirms (CONVENTIONS §8;
 * public coverage endpoint). Assumptions, scripts and the "edit later" notes sit behind ⓘ.
 */
export default function ConfirmStep(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const set = usePrefs((s) => s.set);
  const trackId = usePrefs((s) => s.pendingTrackId) as CourseTrackId | null;
  const source = usePrefs((s) => s.pendingDefaultSourceLanguage);
  const pendingScriptMode = usePrefs((s) => s.pendingScriptMode);
  const pendingRegionalOption = usePrefs((s) => s.pendingRegionalOption);
  const pendingEnrollmentKey = usePrefs((s) => s.pendingEnrollmentKey);
  const capabilities = useCourseCapabilities(trackId, source);
  if (!trackId || !source) {
    router.replace('/onboarding/language');
    return <View />;
  }
  const track = getCourseTrack(trackId);
  const clar = dialectClarification(track);
  // Choices replayed into the enrollment after sign-up (see `features/onboarding/replay.ts`); only what the
  // track offers is selectable, and the track default applies until the learner picks something.
  const scriptMode: ScriptMode = pendingScriptMode && (track.scriptModeOptions as readonly string[]).includes(pendingScriptMode) ? pendingScriptMode : track.defaultScriptMode;
  const regional = pendingRegionalOption && track.regionalOptions.some((o) => o.id === pendingRegionalOption) ? pendingRegionalOption : null;
  const confirm = (): void => {
    set({ pendingScriptMode: scriptMode, pendingRegionalOption: regional, pendingEnrollmentKey: pendingEnrollmentKey ?? newUuid() });
    router.push('/onboarding/warmup');
  };
  const about = [
    t('onboarding.learnFromEditLater'),
    ...track.assumptions.map((a) => t('catalog.assumption', { text: a })),
    t('catalog.scriptsOffered', { scripts: [track.scripts.primary, ...track.scripts.alternatives, ...track.scripts.transliterations].join(', ') }),
    ...(track.scriptModeOptions.length > 1 ? [t('onboarding.replay.scriptModeHint')] : []),
    ...(track.regionalOptions.length > 0 ? [t('catalog.regionalOptionHint')] : []),
  ];
  return (
    <OnboardingFrame step={3} title={t('onboarding.learnFrom', { target: track.displayName, source: names(source) })} primaryLabel={t('common.confirm')} primaryTestID="onboarding-confirm" onPrimary={confirm} headerEnd={<InfoAffordance label={t('catalog.aboutCourse')} title={track.displayName} text={about} />}>
      <CourseCover trackId={track.id} title={track.displayName} />
      <Row gap={theme.spacing.xs} wrap align="center">
        <ThemedText tone="secondary" style={{ flexShrink: 1 }}>
          {clar.focus}
        </ThemedText>
        {clar.distinctFrom.map((n) => (
          <Chip key={n} label={`≠ ${n}`} tone="warning" />
        ))}
      </Row>
      {track.scriptModeOptions.length > 1 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('enrollment.scriptMode')}</ThemedText>
          <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
            {track.scriptModeOptions.map((m) => (
              <View key={m} testID={`onboarding-script-${m}`}>
                <Chip label={t(`lesson.scriptMode.${m}`, { script: track.scripts.primary })} selected={scriptMode === m} onPress={() => set({ pendingScriptMode: m })} accessibilityLabel={t(`lesson.scriptMode.${m}`, { script: track.scripts.primary })} />
              </View>
            ))}
          </Row>
        </View>
      ) : null}
      <CapabilityDisclaimer testID="onboarding-disclaimer" capabilities={capabilities.data?.data ?? null} sourceName={names(source)} targetName={track.displayName} />
      {track.regionalOptions.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('catalog.regionalOptions')}</ThemedText>
          <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
            {track.regionalOptions.map((o) => (
              <View key={o.id} testID={`onboarding-regional-${o.id}`}>
                <Chip label={o.label} selected={regional === o.id} onPress={() => set({ pendingRegionalOption: regional === o.id ? null : o.id })} accessibilityLabel={o.label} />
              </View>
            ))}
          </Row>
        </View>
      ) : null}
    </OnboardingFrame>
  );
}
