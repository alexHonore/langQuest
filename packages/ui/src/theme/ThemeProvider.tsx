/**
 * React context for the resolved {@link Theme}. Works on React Native and
 * react-native-web: OS colour scheme, reduce-motion and RTL are read through
 * RN's `useColorScheme`, `AccessibilityInfo` and `I18nManager`, each of which
 * react-native-web implements. Pass `courseTrackId` / `lessonType` so the
 * lanterns, the primary action and the mascot follow the course and the lesson.
 */
import type { MascotState } from '@langquest/contracts';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, I18nManager, useColorScheme } from 'react-native';
import type { MascotTint } from '../art/mascot/tint';
import type { ResolvedAccents } from '../tokens/accent';
import {
  DEFAULT_THEME,
  type Density,
  type Theme,
  type ThemePreferences,
  resolveTheme,
} from './resolve';

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
 * (reduce_motion, mascot_enabled, high_contrast, text_scale, haptics_enabled),
 * the UI locale's direction, the active `courseTrackId` and the current
 * `lessonType`; everything else follows the OS.
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
    // Every preference is listed explicitly (no react-hooks plugin in this package's lint config).
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
      prefs.courseTrackId,
      prefs.lessonType,
      prefs.density,
      prefs.glassFallback,
      prefs.lowEndDevice,
      prefs.lanterns,
      systemScheme,
      systemReducedMotion,
      nativeRtl,
    ],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Current theme; falls back to the default dark theme outside a provider. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Course × lesson accents of the current theme (lanterns, primary action, glow ring). */
export function useAccents(): ResolvedAccents {
  return useTheme().accents;
}

/** Current text density (`calm` unless the host asked for `full`). */
export function useDensity(override?: Density): Density {
  const theme = useTheme();
  return override ?? theme.density;
}

/** Chameleon tint for the mascot in a given state, for the active course. */
export function useMascotTint(state: MascotState): MascotTint {
  const theme = useTheme();
  return useMemo(() => theme.mascotTint(state), [theme, state]);
}

/** Preferences a parent theme carries over into an override. */
function inheritedPrefs(parent: Theme): ThemePreferences {
  return {
    scheme: parent.scheme,
    highContrast: parent.highContrast,
    reducedMotion: parent.reducedMotion,
    mascotEnabled: parent.mascotEnabled,
    textScale: parent.textScale,
    rtl: parent.direction.rtl,
    nativeRtl: parent.direction.rtl !== parent.direction.mirrorRows,
    hapticsEnabled: parent.hapticsEnabled,
    courseTrackId: parent.courseTrackId,
    lessonType: parent.lessonType,
    density: parent.density,
    glassFallback: parent.glassFallback,
    lowEndDevice: !parent.motion.lanternDriftEnabled && !parent.reducedMotion,
    lanterns: parent.lanterns.enabled || parent.highContrast,
  };
}

/** Override part of the theme for a subtree (e.g. force dark on a celebration screen). */
export function ThemeOverride(props: {
  prefs: ThemePreferences;
  children: React.ReactNode;
}): React.JSX.Element {
  const parent = useTheme();
  const theme = useMemo(
    () => resolveTheme({ ...inheritedPrefs(parent), ...props.prefs }),
    [parent, props.prefs],
  );
  return <ThemeContext.Provider value={theme}>{props.children}</ThemeContext.Provider>;
}

/**
 * Scope the lantern accents to a lesson / mission for a subtree (lesson and
 * conversation screens): `<LessonAccentScope lessonType="pronunciation_drill">`.
 */
export function LessonAccentScope(props: {
  lessonType: string | null | undefined;
  courseTrackId?: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const prefs = useMemo<ThemePreferences>(
    () => ({
      lessonType: props.lessonType ?? null,
      ...(props.courseTrackId !== undefined ? { courseTrackId: props.courseTrackId } : {}),
    }),
    [props.lessonType, props.courseTrackId],
  );
  return <ThemeOverride prefs={prefs}>{props.children}</ThemeOverride>;
}
