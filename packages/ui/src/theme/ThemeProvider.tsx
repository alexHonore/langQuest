/**
 * React context for the resolved {@link Theme}. Works on React Native and
 * react-native-web: OS colour scheme, reduce-motion and RTL are read through
 * RN's `useColorScheme`, `AccessibilityInfo` and `I18nManager`, each of which
 * react-native-web implements.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, I18nManager, useColorScheme } from 'react-native';
import { DEFAULT_THEME, type Theme, type ThemePreferences, resolveTheme } from './resolve';

const ThemeContext = createContext<Theme>(DEFAULT_THEME);
ThemeContext.displayName = 'LangQuestTheme';

export interface ThemeProviderProps extends ThemePreferences {
  children: React.ReactNode;
}

/** Subscribe to the OS reduce-motion setting (null until known). */
function useSystemReducedMotion(enabled: boolean): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const query = AccessibilityInfo.isReduceMotionEnabled?.();
    if (query && typeof query.then === 'function') {
      query
        .then((v) => {
          if (alive) setValue(Boolean(v));
        })
        .catch(() => {
          if (alive) setValue(false);
        });
    } else {
      setValue(false);
    }
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) =>
      setValue(Boolean(v)),
    );
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, [enabled]);
  return value;
}

/**
 * Provides a resolved theme. Pass the learner's `accessibility_options`
 * (reduce_motion, mascot_enabled, high_contrast, text_scale, haptics_enabled)
 * and the UI locale's direction; everything else follows the OS.
 */
export function ThemeProvider(props: ThemeProviderProps): React.JSX.Element {
  const { children, ...prefs } = props;
  const systemScheme = useColorScheme();
  const followsSystemMotion = prefs.reducedMotion === undefined || prefs.reducedMotion === 'system';
  const systemReducedMotion = useSystemReducedMotion(followsSystemMotion);
  const nativeRtl = prefs.nativeRtl ?? I18nManager.isRTL;

  const theme = useMemo(
    () =>
      resolveTheme({
        ...prefs,
        systemScheme:
          prefs.systemScheme ??
          (systemScheme === 'dark' ? 'dark' : systemScheme === 'light' ? 'light' : null),
        systemReducedMotion: prefs.systemReducedMotion ?? systemReducedMotion,
        nativeRtl,
      }),
    [
      prefs.scheme,
      prefs.systemScheme,
      prefs.highContrast,
      prefs.reducedMotion,
      prefs.systemReducedMotion,
      prefs.mascotEnabled,
      prefs.textScale,
      prefs.rtl,
      prefs.hapticsEnabled,
      systemScheme,
      systemReducedMotion,
      nativeRtl,
    ],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Current theme; falls back to the default light theme outside a provider. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Override part of the theme for a subtree (e.g. force dark on a celebration screen). */
export function ThemeOverride(props: {
  prefs: ThemePreferences;
  children: React.ReactNode;
}): React.JSX.Element {
  const parent = useTheme();
  const theme = useMemo(
    () =>
      resolveTheme({
        scheme: parent.scheme,
        highContrast: parent.highContrast,
        reducedMotion: parent.reducedMotion,
        mascotEnabled: parent.mascotEnabled,
        textScale: parent.textScale,
        rtl: parent.direction.rtl,
        nativeRtl: parent.direction.rtl !== parent.direction.mirrorRows,
        hapticsEnabled: parent.hapticsEnabled,
        ...props.prefs,
      }),
    [parent, props.prefs],
  );
  return <ThemeContext.Provider value={theme}>{props.children}</ThemeContext.Provider>;
}
