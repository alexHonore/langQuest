/**
 * Root providers: safe areas, react-query, theme (learner accessibility prefs
 * + OS, Night Market dark-first with calm density), i18n (device locale →
 * ui_locale, RTL), services (API/local store/sync), the auth bootstrap and the
 * course accent scope (lanterns + primary action + mascot family follow the
 * active enrollment's course track).
 */
import { ThemeProvider } from '@langquest/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect, useMemo } from 'react';
import { I18nManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CourseAccentScope } from '@/components/CourseAccentScope';
import { LOW_END_DEVICE } from '@/lib/device-tier';
import { useAppStateFocus } from '@/lib/query-focus';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { ServicesProvider } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { useAuth } from '@/state/auth';
import { usePrefs } from '@/state/prefs';

const startedAt = Date.now();

function ThemedApp(props: { children: React.ReactNode }): React.JSX.Element {
  const prefs = usePrefs();
  const { isRtl } = useI18n();
  useEffect(() => {
    // Native layout mirroring needs a restart; the theme mirrors rows itself until then (§2.3 RTL).
    if (Platform.OS !== 'web' && I18nManager.isRTL !== isRtl) {
      I18nManager.allowRTL(isRtl);
      I18nManager.forceRTL(isRtl);
    }
  }, [isRtl]);
  useEffect(() => {
    track.mascotPreference(prefs.mascotEnabled, prefs.reducedMotion === true);
  }, [prefs.mascotEnabled, prefs.reducedMotion]);
  return (
    <ThemeProvider
      scheme={prefs.scheme}
      highContrast={prefs.highContrast}
      reducedMotion={prefs.reducedMotion}
      mascotEnabled={prefs.mascotEnabled}
      textScale={prefs.textScale}
      hapticsEnabled={prefs.hapticsEnabled}
      rtl={isRtl}
      nativeRtl={I18nManager.isRTL}
      // Night Market (U2): dark-first, calm text density, lanterns + glass gated by the device tier.
      density="calm"
      lanterns={prefs.lanternsEnabled}
      lowEndDevice={LOW_END_DEVICE}
      glassFallback="auto"
    >
      {props.children}
    </ThemeProvider>
  );
}

function AuthBootstrap(props: { children: React.ReactNode }): React.JSX.Element {
  const bootstrap = useAuth((s) => s.bootstrap);
  useAppStateFocus();
  useEffect(() => {
    void bootstrap();
    track.appStart(Date.now() - startedAt, LOW_END_DEVICE);
  }, [bootstrap]);
  return <>{props.children}</>;
}

export function Providers(props: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 10 * 60_000 } } }), []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemedApp>
            <AuthBootstrap>
              <ServicesProvider>
                <CourseAccentScope>{props.children}</CourseAccentScope>
              </ServicesProvider>
            </AuthBootstrap>
          </ThemedApp>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
