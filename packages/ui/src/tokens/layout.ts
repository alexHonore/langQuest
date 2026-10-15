/**
 * Spacing, radii, elevation, motion, icon sizes, illustration crops and focus
 * rings. Plain numbers so they work in RN styles and in CSS on the admin.
 */

export const SPACING = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
  colossal: 64,
} as const;
export type SpacingKey = keyof typeof SPACING;

export const RADII = {
  none: 0,
  sm: 6,
  md: 12,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;
export type RadiusKey = keyof typeof RADII;

/** Shadow recipe usable as an RN style (`shadow*` on iOS/web, `elevation` on Android). */
export interface ElevationStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export const ELEVATION_LEVELS = [0, 1, 2, 3, 4] as const;
export type ElevationLevel = (typeof ELEVATION_LEVELS)[number];

/** Build the shadow style for a level; the colour is the theme's `textPrimary` so it reads in dark mode too. */
export function elevationStyle(level: ElevationLevel, shadowColor = '#000000'): ElevationStyle {
  const table: Record<ElevationLevel, Omit<ElevationStyle, 'shadowColor'>> = {
    0: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
    1: {
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    2: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 3 },
    3: {
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.14,
      shadowRadius: 12,
      elevation: 6,
    },
    4: {
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
      elevation: 12,
    },
  };
  return { shadowColor, ...table[level] };
}

/** Durations in ms. `reducedMotion` collapses every entry to 0 (§10.2, §10.3). */
export interface MotionTokens {
  instant: number;
  fast: number;
  base: number;
  slow: number;
  /** Celebration / achievement reveal; always skippable. */
  celebrate: number;
  /** Mascot idle breathing cycle. */
  idleCycle: number;
  /** Interval between automatic mascot blinks. */
  blinkEvery: number;
  reducedMotion: boolean;
}

export const MOTION_DURATIONS = {
  instant: 0,
  fast: 120,
  base: 200,
  slow: 320,
  celebrate: 600,
  idleCycle: 4000,
  blinkEvery: 4000,
} as const;

export function motionTokens(reducedMotion: boolean): MotionTokens {
  if (reducedMotion) {
    return {
      instant: 0,
      fast: 0,
      base: 0,
      slow: 0,
      celebrate: 0,
      idleCycle: 0,
      blinkEvery: 0,
      reducedMotion: true,
    };
  }
  return { ...MOTION_DURATIONS, reducedMotion: false };
}

export const ICON_SIZES = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
  xl: 40,
} as const;
export type IconSizeKey = keyof typeof ICON_SIZES;

/** Canonical illustration sizes and aspect ratios (§10.2A mascot variants, §10.2A art table). */
export const ILLUSTRATION_CROPS = {
  /** 24–40 dp icon variant of the mascot. */
  mascotIcon: 32,
  /** 64–96 dp lesson companion. */
  mascotCompanion: 80,
  /** Medium welcome illustration. */
  mascotWelcome: 160,
  /** Large full-screen celebration. */
  mascotCelebration: 280,
  portraitAvatar: 56,
  portraitCard: 96,
  portraitHalf: 180,
  /** width / height */
  sceneAspect: 16 / 9,
  coverAspect: 3 / 2,
  contextImageAspect: 4 / 3,
  /** Minimum height for scene art so the uncluttered centre band stays usable for overlays. */
  sceneMinHeight: 140,
} as const;

/** Focus indicator (keyboard / switch access on web & TV; also used for RN `accessibilityState.selected`). */
export interface FocusRingTokens {
  width: number;
  offset: number;
  radius: number;
}

export function focusRingTokens(highContrast: boolean): FocusRingTokens {
  return { width: highContrast ? 3 : 2, offset: 2, radius: RADII.md };
}

/** Minimum interactive sizes (§10.3 motor accessibility). */
export const TOUCH_TARGETS = {
  min: 44,
  comfortable: 56,
  /** Primary speak button; large so press-and-hold is forgiving. */
  speak: 88,
  speakCompact: 64,
} as const;

/** Z-index layers (web) / stacking order hints. */
export const Z_INDEX = {
  base: 0,
  raised: 10,
  sticky: 100,
  overlay: 1000,
  sheet: 1100,
  toast: 1200,
} as const;
