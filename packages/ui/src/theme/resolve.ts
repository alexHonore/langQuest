/**
 * Pure theme resolution (no React / RN imports) so it is unit-testable and
 * reusable on the admin web app.
 */
import type { ScriptId } from '@langquest/contracts';
import {
  COLOR_PALETTES,
  type ColorTokens,
  type PaletteName,
  paletteNameFor,
} from '../tokens/color';
import {
  ELEVATION_LEVELS,
  ICON_SIZES,
  ILLUSTRATION_CROPS,
  RADII,
  SPACING,
  TOUCH_TARGETS,
  type ElevationLevel,
  type ElevationStyle,
  type FocusRingTokens,
  type MotionTokens,
  elevationStyle,
  focusRingTokens,
  motionTokens,
} from '../tokens/layout';
import {
  type ResolvedTextStyle,
  type TypeRoleName,
  clampTextScale,
  resolveTextStyle,
} from '../tokens/typography';

export type ColorScheme = 'light' | 'dark';

/** Inputs a host app provides (from OS settings + the learner's accessibility options). */
export interface ThemePreferences {
  /** `'system'` follows the OS; resolved via `systemScheme`. */
  scheme?: ColorScheme | 'system';
  /** What the OS reports; used when `scheme` is `'system'`. */
  systemScheme?: ColorScheme | null;
  highContrast?: boolean;
  /** `'system'` follows the OS reduce-motion setting (`systemReducedMotion`). */
  reducedMotion?: boolean | 'system';
  systemReducedMotion?: boolean | null;
  /** Learner may switch the mascot off (§10.2A). */
  mascotEnabled?: boolean;
  /** 0.8 .. 2, mirrors `accessibility_options.text_scale`. */
  textScale?: number;
  /** Logical layout direction of the UI language. `'auto'` uses `nativeRtl`. */
  rtl?: boolean | 'auto';
  /** Whether the native layout engine is already mirrored (RN `I18nManager.isRTL`). */
  nativeRtl?: boolean;
  /** Haptics are optional (§10.3). */
  hapticsEnabled?: boolean;
}

export interface DirectionTokens {
  rtl: boolean;
  /**
   * True when the UI is RTL but the native layout engine is not mirrored, so
   * components must flip rows themselves. On RN with `I18nManager.isRTL` the
   * engine already mirrors `row`, `marginStart`, etc.
   */
  mirrorRows: boolean;
  row: 'row' | 'row-reverse';
  /** `undefined` means "leave to the platform default (start-aligned)". */
  textAlign: 'left' | 'right' | undefined;
  writingDirection: 'ltr' | 'rtl';
  /** Multiplier for horizontal icon mirroring (chevrons, skip-back/forward). */
  iconScaleX: 1 | -1;
}

export interface Theme {
  scheme: ColorScheme;
  paletteName: PaletteName;
  colors: ColorTokens;
  highContrast: boolean;
  reducedMotion: boolean;
  mascotEnabled: boolean;
  hapticsEnabled: boolean;
  textScale: number;
  direction: DirectionTokens;
  motion: MotionTokens;
  spacing: typeof SPACING;
  radii: typeof RADII;
  iconSizes: typeof ICON_SIZES;
  illustration: typeof ILLUSTRATION_CROPS;
  touchTargets: typeof TOUCH_TARGETS;
  focusRing: FocusRingTokens;
  /** Shadow style for a level, tinted for the current scheme. */
  elevation: (level: ElevationLevel) => ElevationStyle;
  /** Resolved text style for a role, honouring text scale and (optionally) a script. */
  text: (role: TypeRoleName, script?: ScriptId) => ResolvedTextStyle;
  /** Art theme understood by the art module (`MascotSvg`, scenes, portraits). */
  artTheme: 'light' | 'dark';
}

export const DEFAULT_THEME_PREFERENCES: Required<
  Omit<ThemePreferences, 'systemScheme' | 'systemReducedMotion'>
> & { systemScheme: ColorScheme | null; systemReducedMotion: boolean | null } = {
  scheme: 'system',
  systemScheme: null,
  highContrast: false,
  reducedMotion: 'system',
  systemReducedMotion: null,
  mascotEnabled: true,
  textScale: 1,
  rtl: 'auto',
  nativeRtl: false,
  hapticsEnabled: true,
};

export function resolveDirection(rtl: boolean, nativeRtl: boolean): DirectionTokens {
  const mirrorRows = rtl !== nativeRtl;
  return {
    rtl,
    mirrorRows,
    row: mirrorRows ? 'row-reverse' : 'row',
    textAlign: mirrorRows ? (rtl ? 'right' : 'left') : undefined,
    writingDirection: rtl ? 'rtl' : 'ltr',
    iconScaleX: rtl ? -1 : 1,
  };
}

/** Resolve preferences + OS signals into a concrete, immutable theme. */
export function resolveTheme(prefs: ThemePreferences = {}): Theme {
  const p = { ...DEFAULT_THEME_PREFERENCES, ...stripUndefined(prefs) };
  const scheme: ColorScheme = p.scheme === 'system' ? (p.systemScheme ?? 'light') : p.scheme;
  const reducedMotion =
    p.reducedMotion === 'system' ? (p.systemReducedMotion ?? false) : p.reducedMotion;
  const paletteName = paletteNameFor(scheme, p.highContrast);
  const colors = COLOR_PALETTES[paletteName];
  const textScale = clampTextScale(p.textScale);
  const nativeRtl = p.nativeRtl;
  const rtl = p.rtl === 'auto' ? nativeRtl : p.rtl;
  const shadowColor = scheme === 'dark' ? '#000000' : colors.textPrimary;

  const textCache = new Map<string, ResolvedTextStyle>();
  const text = (role: TypeRoleName, script?: ScriptId): ResolvedTextStyle => {
    const key = `${role}:${script ?? 'Latn'}`;
    let v = textCache.get(key);
    if (!v) {
      v = resolveTextStyle(role, { script, textScale });
      textCache.set(key, v);
    }
    return v;
  };

  return Object.freeze({
    scheme,
    paletteName,
    colors,
    highContrast: p.highContrast,
    reducedMotion,
    mascotEnabled: p.mascotEnabled,
    hapticsEnabled: p.hapticsEnabled,
    textScale,
    direction: resolveDirection(rtl, nativeRtl),
    motion: motionTokens(reducedMotion),
    spacing: SPACING,
    radii: RADII,
    iconSizes: ICON_SIZES,
    illustration: ILLUSTRATION_CROPS,
    touchTargets: TOUCH_TARGETS,
    focusRing: focusRingTokens(p.highContrast),
    elevation: (level: ElevationLevel) =>
      elevationStyle(ELEVATION_LEVELS.includes(level) ? level : 0, shadowColor),
    text,
    artTheme: scheme,
  });
}

/** The theme used when no `ThemeProvider` is mounted (light, LTR, motion on). */
export const DEFAULT_THEME: Theme = resolveTheme();

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
