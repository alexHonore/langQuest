/**
 * Spacing, radii, elevation (glass levels + glow), motion, icon sizes,
 * illustration crops and focus rings — "Night Market" (U2) values. Plain
 * numbers so they work in RN styles and in CSS on the admin.
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

/** U2 radii: sm 10, md 16, lg 22 (cards), xl 28 (tab bar, sheets), pill. */
export const RADII = {
  none: 0,
  sm: 10,
  md: 16,
  lg: 22,
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
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.22,
      shadowRadius: 14,
      elevation: 2,
    },
    2: {
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.3,
      shadowRadius: 22,
      elevation: 4,
    },
    3: {
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.38,
      shadowRadius: 28,
      elevation: 8,
    },
    4: {
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.45,
      shadowRadius: 34,
      elevation: 12,
    },
  };
  return { shadowColor, ...table[level] };
}

/* --------------------------------------------------------------- glass --- */

/** Glass (translucent) surface levels: 0 canvas, 1 card, 2 strong (tab bar, pills, sheets). */
export const GLASS_LEVELS = [0, 1, 2] as const;
export type GlassLevel = (typeof GLASS_LEVELS)[number];

export interface GlassStyle {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  /** Backdrop blur radius the host may apply (expo-blur / CSS `backdrop-filter`); 0 = none. */
  blur: number;
  /** Saturation boost paired with the blur (CSS `saturate()` %, 100 = none). */
  saturate: number;
}

/** Blur radii per glass level (U2: card 20, strong 24). */
export const GLASS_BLUR: Readonly<Record<GlassLevel, number>> = { 0: 0, 1: 20, 2: 24 };

/**
 * Glass surface recipe. With `fallback` (device-tier flag, reduced transparency
 * or no blur support) the surface is the opaque `solid` tier and blur is 0.
 */
export function glassStyle(
  level: GlassLevel,
  colors: {
    fill: string;
    fillStrong: string;
    border: string;
    borderStrong: string;
    solid: string;
    solidStrong: string;
  },
  canvas: string,
  fallback: boolean,
): GlassStyle {
  if (level === 0) {
    return {
      backgroundColor: canvas,
      borderColor: 'transparent',
      borderWidth: 0,
      blur: 0,
      saturate: 100,
    };
  }
  const strong = level === 2;
  if (fallback) {
    return {
      backgroundColor: strong ? colors.solidStrong : colors.solid,
      borderColor: strong ? colors.borderStrong : colors.border,
      borderWidth: 1,
      blur: 0,
      saturate: 100,
    };
  }
  return {
    backgroundColor: strong ? colors.fillStrong : colors.fill,
    borderColor: strong ? colors.borderStrong : colors.border,
    borderWidth: 1,
    blur: GLASS_BLUR[level],
    saturate: strong ? 160 : 150,
  };
}

/* ---------------------------------------------------------------- glow --- */

/**
 * Glow = elevation level 3 (U2): an accent ring (5 px @ 28 %) plus a 34 px
 * bloom. Reserved for exactly two things: the speech state and the one
 * primary action on a screen.
 */
export const GLOW = {
  ringWidth: 5,
  ringAlpha: 0.28,
  bloomRadius: 34,
  bloomSpread: 6,
  bloomAlpha: 0.55,
  /** Scale reached at the top of the breathe loop. */
  pulseScale: 1.06,
} as const;

export interface GlowStyle {
  /** Ring colour with alpha (`rgba`), for a border or an outer `View`. */
  ringColor: string;
  ringWidth: number;
  /** RN shadow props approximating the bloom. */
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
  /** CSS `box-shadow` for the admin / web. */
  boxShadow: string;
}

function rgba(color: string, alpha: number): string {
  const h = color.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.slice(0, 6),
    16,
  );
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Glow recipe for a colour; `intensity` 0..1 scales both ring and bloom (0 = static ring only). */
export function glowStyle(color: string, intensity = 1): GlowStyle {
  const i = Math.max(0, Math.min(1, intensity));
  const ringAlpha = GLOW.ringAlpha * (0.5 + i / 2);
  const bloomAlpha = GLOW.bloomAlpha * i;
  return {
    ringColor: rgba(color, ringAlpha),
    ringWidth: GLOW.ringWidth,
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: bloomAlpha,
    shadowRadius: GLOW.bloomRadius / 2,
    elevation: Math.round(8 * i),
    boxShadow: `0 0 0 ${GLOW.ringWidth}px ${rgba(color, ringAlpha)}, 0 0 ${GLOW.bloomRadius}px ${GLOW.bloomSpread}px ${rgba(color, bloomAlpha)}`,
  };
}

/* -------------------------------------------------------------- motion --- */

/** Reanimated / RN `Animated.spring` parameters (U2: damping 14 · stiffness 180 · mass 1). */
export interface SpringTokens {
  damping: number;
  stiffness: number;
  mass: number;
}

export const MOTION_SPRINGS = {
  /** Mic press (scale .94 → 1), mission card tap, mascot reaction bounce. */
  press: { damping: 14, stiffness: 180, mass: 1 },
  /** Gentler settle for sheets and pucks. */
  settle: { damping: 18, stiffness: 140, mass: 1 },
} as const satisfies Record<string, SpringTokens>;

/** Cubic-bezier control points. */
export const MOTION_EASINGS = {
  /** Everything entering / moving on screen. */
  standard: [0.2, 0.8, 0.2, 1],
  /** Exits and dismissals. */
  emphasized: [0.3, 0, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Durations in ms. `reducedMotion` collapses every entry to 0 except `colorChange` (§10.2, §10.3, U2). */
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
  /** Speech-ring / primary-glow breathe loop (runs only while the audio engine reports activity). */
  glowPulse: number;
  /** Background lantern drift (one leg of the alternate loop); 0 when disabled. */
  lanternDrift: number;
  /** Card entrance: translateY 12 → 0 + fade. */
  cardEnter: number;
  /** Reconnect banner slide. */
  banner: number;
  /** State-colour change kept under reduced motion for clarity (U2). */
  colorChange: number;
  reducedMotion: boolean;
  /** Lantern drift is off under reduced motion and on low-end devices (static gradient). */
  lanternDriftEnabled: boolean;
  /** Glows breathe; false = static rings. */
  glowAnimated: boolean;
  springs: typeof MOTION_SPRINGS;
  easings: typeof MOTION_EASINGS;
}

export const MOTION_DURATIONS = {
  instant: 0,
  fast: 120,
  base: 200,
  slow: 320,
  celebrate: 600,
  idleCycle: 4000,
  blinkEvery: 4000,
  glowPulse: 1600,
  lanternDrift: 22000,
  cardEnter: 200,
  banner: 320,
  colorChange: 120,
} as const;

/** Lantern drift durations per blob (22–31 s, alternate). */
export const LANTERN_DRIFT_MS = [22000, 27000, 31000] as const;

export interface MotionOptions {
  /** Device-tier flag: disables lantern drift (blur + drift are the expensive part). */
  lowEndDevice?: boolean;
}

export function motionTokens(reducedMotion: boolean, options: MotionOptions = {}): MotionTokens {
  const lowEnd = options.lowEndDevice ?? false;
  if (reducedMotion) {
    return {
      instant: 0,
      fast: 0,
      base: 0,
      slow: 0,
      celebrate: 0,
      idleCycle: 0,
      blinkEvery: 0,
      glowPulse: 0,
      lanternDrift: 0,
      cardEnter: 0,
      banner: 0,
      colorChange: MOTION_DURATIONS.colorChange,
      reducedMotion: true,
      lanternDriftEnabled: false,
      glowAnimated: false,
      springs: MOTION_SPRINGS,
      easings: MOTION_EASINGS,
    };
  }
  return {
    ...MOTION_DURATIONS,
    lanternDrift: lowEnd ? 0 : MOTION_DURATIONS.lanternDrift,
    reducedMotion: false,
    lanternDriftEnabled: !lowEnd,
    glowAnimated: true,
    springs: MOTION_SPRINGS,
    easings: MOTION_EASINGS,
  };
}

/* ---------------------------------------------------------------- misc --- */

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

/** Minimum interactive sizes (§10.3 motor accessibility; U2 mic 88 lesson / 84 conversation). */
export const TOUCH_TARGETS = {
  min: 44,
  comfortable: 56,
  /** Primary speak button; large so press-and-hold is forgiving. */
  speak: 88,
  speakConversation: 84,
  speakCompact: 64,
} as const;

/** Z-index layers (web) / stacking order hints. */
export const Z_INDEX = {
  base: 0,
  lantern: 1,
  raised: 10,
  sticky: 100,
  overlay: 1000,
  sheet: 1100,
  toast: 1200,
} as const;

/** Text budget per screen (U2 "calm" density): components enforce it through their `density` variants. */
export const TEXT_BUDGET = {
  headings: 1,
  helperLines: 1,
  primaryActions: 1,
  /** Max words per bullet in calm disclaimers / badges. */
  wordsPerBullet: 6,
  wordsPerBadge: 2,
} as const;
