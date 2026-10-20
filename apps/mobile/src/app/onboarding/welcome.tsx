import { Button, InfoAffordance, Lanterns, Row, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Melo } from '@/components/Melo';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/** Screen 1 hero (calm): Melo + "Start speaking from day one" + one line; the free / privacy notes sit behind ⓘ. */
export default function Welcome(): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const set = usePrefs((s) => s.set);
  useEffect(() => track.onboardingStep('welcome'), []);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {theme.lanterns.enabled ? <Lanterns /> : null}
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.spacing.xl, gap: theme.spacing.xl, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.lg }}>
          <Melo state="welcome" size="welcome" testID="welcome-mascot" />
          <ThemedText variant="display" align="center" accessibilityRole="header">
            {t('onboarding.heroPromise')}
          </ThemedText>
          <Row gap={theme.spacing.xs} justify="center" align="center">
            <ThemedText tone="secondary" align="center" style={{ flexShrink: 1 }}>
              {t('onboarding.heroSubtitle')}
            </ThemedText>
            <InfoAffordance label={t('onboarding.aboutLangQuest')} title={t('common.appName')} text={[t('onboarding.noPaywall'), t('onboarding.privacyNote'), t('common.free')]} />
          </Row>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <Button testID="onboarding-get-started" label={t('onboarding.getStarted')} size="lg" fullWidth glow onPress={() => router.push('/onboarding/language')} accessibilityLabel={t('onboarding.getStarted')} />
          <Button
            testID="onboarding-have-account"
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
