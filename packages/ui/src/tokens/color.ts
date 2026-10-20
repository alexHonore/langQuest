/**
 * Semantic colour tokens — "Night Market" (design direction U2, owner decision
 * 2026-10-19). Dark-first: the dark palette is the reference, the light palette
 * is derived from it (canvas / text inverted, accent *text* tokens darkened,
 * accent *fill* tokens kept close) and the two high-contrast palettes push the
 * same hues to AAA. Components reference these names only — never raw hex
 * values — so the direction can be swapped by editing this file alone (see
 * `docs/design/design-system.md`).
 *
 * Rules enforced by `tokens.test.ts`:
 * - every `TEXT_COLOR_TOKEN_KEYS` entry reaches WCAG AA (4.5:1) on every
 *   `SURFACE_COLOR_TOKEN_KEYS` surface, in all four palettes;
 * - accent *fill* tokens (`accent`, `amber`, `cyan`) are never used for text:
 *   they are measured against the 3:1 non-text threshold and text drawn on
 *   them uses the paired `on*` ink token (4.5:1);
 * - speech-state colours read as text on every surface and stay distinct.
 */

export type PaletteName = 'light' | 'dark' | 'highContrastLight' | 'highContrastDark';

export interface SpeechStateColors {
  /** Learner microphone is capturing (cyan family: "mic open"). */
  listening: string;
  /** Character / reference audio is playing (magenta family: "speech ring"). */
  speaking: string;
  /** Model or scorer is working; nothing is being recorded. */
  thinking: string;
  /** Transport dropped; we are reconnecting, nothing is lost silently. */
  reconnecting: string;
  /** Unrecoverable provider / permission error. */
  error: string;
}

/**
 * Translucent glass surfaces (elevation levels 1–2). `fill` / `fillStrong` are
 * rgba strings composited over the canvas; `solid` is the opaque fallback used
 * when blur is unavailable or `glassFallback` is on (low-end devices).
 */
export interface GlassColors {
  fill: string;
  fillStrong: string;
  border: string;
  borderStrong: string;
  solid: string;
  solidStrong: string;
}

export interface ColorTokens {
  /** Canvas (bg0). `background` stays the historical name; `canvas` is an alias. */
  background: string;
  surface: string;
  /** Cards, sheets, popovers (bg2). */
  elevated: string;
  /** Subtle fills (skeletons, inactive chips, seek-bar track). */
  surfaceMuted: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Text / icon drawn on top of `accent`. */
  onAccent: string;
  /** Primary accent FILL (magenta lantern): buttons, LEDs, glow. Never text. */
  accent: string;
  /** Hover / pressed accent fill. */
  accentStrong: string;
  /** Tinted accent background (selected chips, highlighted segments). */
  accentSoft: string;
  /** Accent used AS TEXT (AA on every surface). */
  accentText: string;
  /** Amber lantern fill (secondary action, warmth) + its text / ink pair. */
  amber: string;
  amberText: string;
  onAmber: string;
  /** Cyan lantern fill (microphone open, info) + its text / ink pair. */
  cyan: string;
  cyanText: string;
  onCyan: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorSoft: string;
  info: string;
  infoSoft: string;
  border: string;
  borderStrong: string;
  focusRing: string;
  /** Scrim behind sheets and dialogs. */
  overlay: string;
  /** Scrim under glass that sits on scene art (mandatory, U2). */
  sceneScrim: string;
  /**
   * Text / icon drawn directly on `overlay` / `sceneScrim` (scene captions, sheet
   * backdrops). The scrims are dark in every palette, so this ink is white or
   * near-white everywhere — never `onAccent`, which is dark ink in the dark scheme.
   */
  onScrim: string;
  /** Celebration confetti / badge accents (the three lantern hues). */
  celebrationA: string;
  celebrationB: string;
  celebrationC: string;
  /** Default lantern glow colours (magenta, cyan, amber); per-course accents override them. */
  lantern: readonly [string, string, string];
  glass: GlassColors;
  speech: SpeechStateColors;
}

export const DARK_COLORS: ColorTokens = {
  background: '#0B0913',
  surface: '#130F21',
  elevated: '#1C1730',
  surfaceMuted: '#262038',
  textPrimary: '#F5F2FB',
  textSecondary: '#BDB6D0',
  textMuted: '#9A93B1',
  onAccent: '#2A0718',
  accent: '#FF4FA3',
  accentStrong: '#FF6DB4',
  accentSoft: '#3C1230',
  accentText: '#FF7CBB',
  amber: '#FFB547',
  amberText: '#FFC46A',
  onAmber: '#2B1A00',
  cyan: '#3EE1E8',
  cyanText: '#5FE9EF',
  onCyan: '#04282B',
  success: '#45E0A6',
  successSoft: '#0F3328',
  warning: '#FFC46A',
  warningSoft: '#3A2A0E',
  error: '#FF8A96',
  errorSoft: '#45191F',
  info: '#5FE9EF',
  infoSoft: '#0D3236',
  border: '#2B2739',
  borderStrong: '#817A9B',
  focusRing: '#3EE1E8',
  overlay: 'rgba(11, 9, 19, 0.72)',
  sceneScrim: 'rgba(11, 9, 19, 0.55)',
  onScrim: '#F5F2FB',
  celebrationA: '#FF4FA3',
  celebrationB: '#FFB547',
  celebrationC: '#3EE1E8',
  lantern: ['#FF4FA3', '#3EE1E8', '#FFB547'],
  glass: {
    fill: 'rgba(255, 255, 255, 0.06)',
    fillStrong: 'rgba(255, 255, 255, 0.11)',
    border: 'rgba(255, 255, 255, 0.13)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    solid: '#1A1821',
    solidStrong: '#232030',
  },
  speech: {
    listening: '#5FE9EF',
    speaking: '#FF7CBB',
    thinking: '#C9B8FF',
    reconnecting: '#FFC46A',
    error: '#FF8A96',
  },
};

export const LIGHT_COLORS: ColorTokens = {
  background: '#F6F3FB',
  surface: '#FFFFFF',
  elevated: '#FCFBFE',
  surfaceMuted: '#EDE8F7',
  textPrimary: '#1A1430',
  textSecondary: '#534B6C',
  textMuted: '#675F82',
  onAccent: '#FFFFFF',
  accent: '#D1177C',
  accentStrong: '#A30F62',
  accentSoft: '#FDEAF4',
  accentText: '#B0106A',
  amber: '#C96F00',
  amberText: '#8A4B00',
  onAmber: '#1F1200',
  cyan: '#0B7A82',
  cyanText: '#0A6E77',
  onCyan: '#FFFFFF',
  success: '#0D6B45',
  successSoft: '#DCF4E8',
  warning: '#8A4B00',
  warningSoft: '#FFF0D6',
  error: '#C0283A',
  errorSoft: '#FCE3E5',
  info: '#0A6E77',
  infoSoft: '#DCF3F5',
  border: '#DAD4E6',
  borderStrong: '#6F678A',
  focusRing: '#0B7A82',
  // 0.62: the weakest ink-plum scrim on which white `onScrim` stays AA (≥ 4.5:1) even over
  // pure-white scene art (0.55 capped at 3.97:1).
  overlay: 'rgba(26, 20, 48, 0.62)',
  sceneScrim: 'rgba(26, 20, 48, 0.45)',
  onScrim: '#FFFFFF',
  celebrationA: '#D1177C',
  celebrationB: '#C96F00',
  celebrationC: '#0B7A82',
  lantern: ['#D1177C', '#0B7A82', '#C96F00'],
  glass: {
    fill: 'rgba(255, 255, 255, 0.66)',
    fillStrong: 'rgba(255, 255, 255, 0.86)',
    border: 'rgba(26, 20, 48, 0.08)',
    borderStrong: 'rgba(26, 20, 48, 0.12)',
    solid: '#FCFBFE',
    solidStrong: '#FFFFFF',
  },
  speech: {
    listening: '#0A6E77',
    speaking: '#B0106A',
    thinking: '#5B45C4',
    reconnecting: '#8A4B00',
    error: '#C0283A',
  },
};

export const HIGH_CONTRAST_DARK_COLORS: ColorTokens = {
  background: '#000000',
  surface: '#000000',
  elevated: '#0A0A0A',
  surfaceMuted: '#262626',
  textPrimary: '#FFFFFF',
  textSecondary: '#F0F0F0',
  textMuted: '#DADADA',
  onAccent: '#000000',
  accent: '#FF7CBB',
  accentStrong: '#FFA3D0',
  accentSoft: '#3A0F26',
  accentText: '#FF9CCB',
  amber: '#FFC46A',
  amberText: '#FFD48F',
  onAmber: '#000000',
  cyan: '#5FE9EF',
  cyanText: '#8FF1F5',
  onCyan: '#000000',
  success: '#8FF0B5',
  successSoft: '#0F2E1C',
  warning: '#FFD97A',
  warningSoft: '#33280C',
  error: '#FFB3B3',
  errorSoft: '#3A1414',
  info: '#A9E9F0',
  infoSoft: '#0F2A2E',
  border: '#FFFFFF',
  borderStrong: '#FFFFFF',
  focusRing: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.8)',
  sceneScrim: 'rgba(0, 0, 0, 0.7)',
  onScrim: '#FFFFFF',
  celebrationA: '#FF9CCB',
  celebrationB: '#FFD48F',
  celebrationC: '#8FF1F5',
  lantern: ['#FF7CBB', '#5FE9EF', '#FFC46A'],
  glass: {
    fill: '#000000',
    fillStrong: '#0A0A0A',
    border: '#FFFFFF',
    borderStrong: '#FFFFFF',
    solid: '#000000',
    solidStrong: '#0A0A0A',
  },
  speech: {
    listening: '#8FF1F5',
    speaking: '#FF9CCB',
    thinking: '#D3C6FF',
    reconnecting: '#FFD97A',
    error: '#FFB3B3',
  },
};

export const HIGH_CONTRAST_LIGHT_COLORS: ColorTokens = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  surfaceMuted: '#E6E6E6',
  textPrimary: '#000000',
  textSecondary: '#141414',
  textMuted: '#2E2E2E',
  onAccent: '#FFFFFF',
  accent: '#9A0A5C',
  accentStrong: '#6E0742',
  accentSoft: '#FBDDEC',
  accentText: '#8A0852',
  amber: '#7A4200',
  amberText: '#5C3100',
  onAmber: '#FFFFFF',
  cyan: '#085E66',
  cyanText: '#064A50',
  onCyan: '#FFFFFF',
  success: '#0B5A2D',
  successSoft: '#D6F0DF',
  warning: '#5C3100',
  warningSoft: '#FFEBC7',
  error: '#9A0000',
  errorSoft: '#FBDADA',
  info: '#064A50',
  infoSoft: '#D9F0F2',
  border: '#000000',
  borderStrong: '#000000',
  focusRing: '#000000',
  overlay: 'rgba(0, 0, 0, 0.7)',
  sceneScrim: 'rgba(0, 0, 0, 0.6)',
  onScrim: '#FFFFFF',
  celebrationA: '#9A0A5C',
  celebrationB: '#7A4200',
  celebrationC: '#085E66',
  lantern: ['#9A0A5C', '#085E66', '#7A4200'],
  glass: {
    fill: '#FFFFFF',
    fillStrong: '#FFFFFF',
    border: '#000000',
    borderStrong: '#000000',
    solid: '#FFFFFF',
    solidStrong: '#FFFFFF',
  },
  speech: {
    listening: '#064A50',
    speaking: '#8A0852',
    thinking: '#3B1C8E',
    reconnecting: '#5C3100',
    error: '#9A0000',
  },
};

export const COLOR_PALETTES: Readonly<Record<PaletteName, ColorTokens>> = {
  light: LIGHT_COLORS,
  dark: DARK_COLORS,
  highContrastLight: HIGH_CONTRAST_LIGHT_COLORS,
  highContrastDark: HIGH_CONTRAST_DARK_COLORS,
};

export const PALETTE_NAMES: readonly PaletteName[] = [
  'light',
  'dark',
  'highContrastLight',
  'highContrastDark',
];

/** Tokens that are rendered as text or icons and therefore need 4.5:1 on every surface. */
export const TEXT_COLOR_TOKEN_KEYS = [
  'textPrimary',
  'textSecondary',
  'textMuted',
  'accentText',
  'amberText',
  'cyanText',
  'success',
  'warning',
  'error',
  'info',
] as const satisfies readonly (keyof ColorTokens)[];

/** Accent FILL tokens: never text; 3:1 against every surface, with an ink pair at 4.5:1. */
export const FILL_COLOR_TOKEN_KEYS = [
  'accent',
  'amber',
  'cyan',
] as const satisfies readonly (keyof ColorTokens)[];

/** Ink token drawn on each fill. */
export const FILL_INK_TOKEN: Readonly<
  Record<(typeof FILL_COLOR_TOKEN_KEYS)[number], 'onAccent' | 'onAmber' | 'onCyan'>
> = {
  accent: 'onAccent',
  amber: 'onAmber',
  cyan: 'onCyan',
};

/** Surfaces text can appear on (canvas, surface, card and the two solid glass fallbacks). */
export const SURFACE_COLOR_TOKEN_KEYS = [
  'background',
  'surface',
  'elevated',
] as const satisfies readonly (keyof ColorTokens)[];

/** Resolve the palette for a scheme + high-contrast preference. */
export function paletteNameFor(scheme: 'light' | 'dark', highContrast: boolean): PaletteName {
  if (highContrast) return scheme === 'dark' ? 'highContrastDark' : 'highContrastLight';
  return scheme;
}
