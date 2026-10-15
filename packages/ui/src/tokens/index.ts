/**
 * Design tokens for `@langquest/ui`: semantic colours (light / dark / high
 * contrast), script-aware typography, spacing, radii, elevation, motion, icon
 * sizes, illustration crops and focus rings, plus a WCAG contrast checker.
 */
export type { PaletteName, ColorTokens, SpeechStateColors } from './color';
export {
  COLOR_PALETTES,
  PALETTE_NAMES,
  LIGHT_COLORS,
  DARK_COLORS,
  HIGH_CONTRAST_LIGHT_COLORS,
  HIGH_CONTRAST_DARK_COLORS,
  TEXT_COLOR_TOKEN_KEYS,
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
  MotionTokens,
  IconSizeKey,
  FocusRingTokens,
} from './layout';
export {
  SPACING,
  RADII,
  ELEVATION_LEVELS,
  elevationStyle,
  MOTION_DURATIONS,
  motionTokens,
  ICON_SIZES,
  ILLUSTRATION_CROPS,
  focusRingTokens,
  TOUCH_TARGETS,
  Z_INDEX,
} from './layout';
