import { getCourseTrack, type CourseTrackId } from '@langquest/contracts';
import { Chip, CourseCover, Row, StatusLine, ThemedText, dialectClarification, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { OnboardingFrame } from '@/components/OnboardingFrame';
import { useLanguageNames, useT } from '@/lib/i18n';
import { usePrefs } from '@/state/prefs';

/** "Learn X from Y" confirmation for this enrollment; the source can be edited per course later. */
export default function ConfirmStep(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const trackId = usePrefs((s) => s.pendingTrackId) as CourseTrackId | null;
  const source = usePrefs((s) => s.pendingDefaultSourceLanguage);
  if (!trackId || !source) {
    router.replace('/onboarding/language');
    return <View />;
  }
  const track = getCourseTrack(trackId);
  const clar = dialectClarification(track);
  return (
    <OnboardingFrame step={3} title={t('onboarding.learnFromConfirm', { target: track.displayName, source: names(source) })} primaryLabel={t('common.confirm')} primaryTestID="onboarding-confirm" onPrimary={() => router.push('/onboarding/warmup')}>
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
    </OnboardingFrame>
  );
}
