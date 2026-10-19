import { getCourseTrack, type CourseTrackId, type ScriptMode } from '@langquest/contracts';
import { Chip, CourseCover, Row, StatusLine, ThemedText, dialectClarification, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { OnboardingFrame } from '@/components/OnboardingFrame';
import { newUuid } from '@/lib/ids';
import { useLanguageNames, useT } from '@/lib/i18n';
import { usePrefs } from '@/state/prefs';

/** "Learn X from Y" confirmation for this enrollment; the source can be edited per course later. */
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
  return (
    <OnboardingFrame step={3} title={t('onboarding.learnFromConfirm', { target: track.displayName, source: names(source) })} primaryLabel={t('common.confirm')} primaryTestID="onboarding-confirm" onPrimary={confirm}>
      <CourseCover trackId={track.id} title={track.displayName} />
      <View style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading">{t('onboarding.learnFrom', { target: track.displayName, source: names(source) })}</ThemedText>
        <StatusLine icon="info" tone="info" text={t('onboarding.learnFromEditLater')} />
        <ThemedText tone="secondary">{clar.focus}</ThemedText>
        {clar.distinctFrom.length > 0 ? (
          <Row gap={theme.spacing.xs} wrap>
            {clar.distinctFrom.map((n) => (
              <Chip key={n} label={`≠ ${n}`} tone="warning" />
            ))}
          </Row>
        ) : null}
        {track.assumptions.map((a) => (
          <ThemedText key={a} variant="caption" tone="muted">
            {t('catalog.assumption', { text: a })}
          </ThemedText>
        ))}
        <ThemedText variant="caption" tone="muted">
          {t('catalog.scriptsOffered', { scripts: [track.scripts.primary, ...track.scripts.alternatives, ...track.scripts.transliterations].join(', ') })}
        </ThemedText>
      </View>
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
          <ThemedText variant="caption" tone="muted">
            {t('onboarding.replay.scriptModeHint')}
          </ThemedText>
        </View>
      ) : null}
      {track.regionalOptions.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('catalog.regionalOptions')}</ThemedText>
          <ThemedText variant="caption" tone="muted">
            {t('catalog.regionalOptionHint')}
          </ThemedText>
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
