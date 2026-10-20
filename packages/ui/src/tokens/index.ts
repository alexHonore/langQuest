/**
 * Design tokens for `@langquest/ui` — "Night Market" (U2): semantic colours
 * (dark-first, derived light, high contrast), glass + glow elevation, lantern
 * accents per course and lesson, script-aware typography, spacing, radii,
 * motion (springs, easings, durations), icon sizes, illustration crops, focus
 * rings and a WCAG contrast checker.
 */
export type { PaletteName, ColorTokens, SpeechStateColors, GlassColors } from './color';
export {
  COLOR_PALETTES,
  PALETTE_NAMES,
  LIGHT_COLORS,
  DARK_COLORS,
  HIGH_CONTRAST_LIGHT_COLORS,
  HIGH_CONTRAST_DARK_COLORS,
  TEXT_COLOR_TOKEN_KEYS,
  FILL_COLOR_TOKEN_KEYS,
  FILL_INK_TOKEN,
  SURFACE_COLOR_TOKEN_KEYS,
  paletteNameFor,
} from './color';

export type { Rgb, WcagLevel, WcagTextSize } from './contrast';
export {
  parseColor,
  composite,
  relativeLuminance,
  contrastRatio,
  requiredContrast,
  UI_COMPONENT_MIN_CONTRAST,
  meetsWcag,
  pickReadable,
  toHex,
  shade,
  withAlpha,
} from './contrast';

export type {
  CourseAccent,
  LessonAccentKey,
  LessonAccent,
  ResolvedAccents,
  ResolveAccentsOptions,
} from './accent';
export {
  courseAccent,
  ACCENT_TRACK_IDS,
  LESSON_ACCENTS,
  LESSON_ACCENT_KEYS,
  lessonAccent,
  resolveAccents,
} from './accent';

export type {
  ScriptTypography,
  FontWeight,
  TypeRole,
  TypeRoleName,
  ResolvedTextStyle,
} from './typography';
export {
  SCRIPT_TYPOGRAPHY,
  TALL_SCRIPTS,
  TYPE_ROLES,
  TEXT_SCALE_MIN,
  TEXT_SCALE_MAX,
  clampTextScale,
  fontFamilyCss,
  resolveTextStyle,
} from './typography';

export type {
  SpacingKey,
  RadiusKey,
  ElevationStyle,
  ElevationLevel,
  GlassLevel,
  GlassStyle,
  GlowStyle,
  SpringTokens,
  MotionTokens,
  MotionOptions,
  IconSizeKey,
  FocusRingTokens,
} from './layout';
export {
  SPACING,
  RADII,
  ELEVATION_LEVELS,
  elevationStyle,
  GLASS_LEVELS,
  GLASS_BLUR,
  glassStyle,
  GLOW,
  glowStyle,
  MOTION_SPRINGS,
  MOTION_EASINGS,
  MOTION_DURATIONS,
  LANTERN_DRIFT_MS,
  motionTokens,
  ICON_SIZES,
  ILLUSTRATION_CROPS,
  focusRingTokens,
  TOUCH_TARGETS,
  Z_INDEX,
  TEXT_BUDGET,
} from './layout';
