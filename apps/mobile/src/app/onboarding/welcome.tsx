import { Button, Mascot, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/** Screen 1 hero: original mascot + "Start speaking from day one"; no paywall copy anywhere. */
export default function Welcome(): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const set = usePrefs((s) => s.set);
  useEffect(() => track.onboardingStep('welcome'), []);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.spacing.xl, gap: theme.spacing.xl, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.lg }}>
          <Mascot state="welcome" size="welcome" animate={!theme.reducedMotion} accessibilityLabel={t('common.a11y.mascotImage', { state: t('mascot.a11yState.welcome') })} />
          <ThemedText variant="display" align="center" accessibilityRole="header">
            {t('onboarding.heroPromise')}
          </ThemedText>
          <ThemedText tone="secondary" align="center">
            {t('onboarding.heroSubtitle')}
          </ThemedText>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <StatusLine icon="check" tone="success" text={t('onboarding.noPaywall')} />
          <StatusLine icon="info" tone="info" text={t('onboarding.privacyNote')} />
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <Button label={t('onboarding.getStarted')} size="lg" fullWidth onPress={() => router.push('/onboarding/language')} accessibilityLabel={t('onboarding.getStarted')} />
          <Button
            label={t('onboarding.alreadyHaveAccount')}
            variant="ghost"
            fullWidth
            onPress={() => {
              set({ onboardingComplete: true });
              router.replace('/auth/sign-in');
            }}
            accessibilityLabel={t('onboarding.alreadyHaveAccount')}
          />
        </View>
      </ScrollView>
    </View>
  );
}
