import { ThemedText, useTheme } from '@langquest/ui';
import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Melo } from '@/components/Melo';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/state/auth';
import { usePrefs } from '@/state/prefs';

/** Entry gate: onboarding → auth → learner tabs. Melo (tint + Lottie + reduced-motion pipeline) waits with the learner. */
export default function Index(): React.JSX.Element {
  const hydrated = usePrefs((s) => s.hydrated);
  const onboardingComplete = usePrefs((s) => s.onboardingComplete);
  const status = useAuth((s) => s.status);
  const theme = useTheme();
  const t = useT();

  if (!hydrated || status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, backgroundColor: theme.colors.background }} accessibilityLabel={t('common.a11y.loadingIndicator')}>
        <Melo state="neutral" size="welcome" testID="entry-mascot" />
        <ActivityIndicator color={theme.colors.accent} />
        <ThemedText tone="muted">{t('common.loading')}</ThemedText>
      </View>
    );
  }
  if (!onboardingComplete) return <Redirect href="/onboarding/welcome" />;
  if (status !== 'signed_in') return <Redirect href="/auth/sign-in" />;
  return <Redirect href="/(tabs)" />;
}
