// Must stay first: Hermes lacks Intl.PluralRules / Locale / DisplayNames (see the module).
import '@/lib/intl-polyfills';
import { useTheme } from '@langquest/ui';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Providers } from '@/components/Providers';
import { usePrefs } from '@/state/prefs';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootStack(): React.JSX.Element {
  const theme = useTheme();
  const hydrated = usePrefs((s) => s.hydrated);
  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync().catch(() => undefined);
  }, [hydrated]);
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: theme.reducedMotion ? 'none' : 'default' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="course-switcher" options={{ presentation: 'modal' }} />
        <Stack.Screen name="mission/[id]" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="conversation" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout(): React.JSX.Element {
  return (
    <Providers>
      <RootStack />
    </Providers>
  );
}
