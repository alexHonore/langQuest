import { Mascot, ThemedText, useTheme } from '@langquest/ui';
import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/state/auth';
import { usePrefs } from '@/state/prefs';

/** Entry gate: onboarding → auth → learner tabs. */
export default function Index(): React.JSX.Element {
  const hydrated = usePrefs((s) => s.hydrated);
  const onboardingComplete = usePrefs((s) => s.onboardingComplete);
  const status = useAuth((s) => s.status);
  const theme = useTheme();
  const t = useT();

  if (!hydrated || status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, backgroundColor: theme.colors.background }} accessibilityLabel={t('common.a11y.loadingIndicator')}>
        <Mascot state="neutral" size="welcome" />
        <ActivityIndicator color={theme.colors.accent} />
        <ThemedText tone="muted">{t('common.loading')}</ThemedText>
      </View>
    );
  }
  if (!onboardingComplete) return <Redirect href="/onboarding/welcome" />;
  if (status !== 'signed_in') return <Redirect href="/auth/sign-in" />;
  return <Redirect href="/(tabs)" />;
}
