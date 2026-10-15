/**
 * Semantic colour tokens. Components reference these names only — never raw
 * hex values — so light, dark and high-contrast variants stay interchangeable.
 *
 * Every `text*`, status and speech-state token is verified by `tokens.test.ts`
 * to reach WCAG AA (4.5:1) against `background`, `surface` and `elevated`.
 */

export type PaletteName = 'light' | 'dark' | 'highContrastLight' | 'highContrastDark';

export interface SpeechStateColors {
  /** Learner microphone is capturing. */
  listening: string;
  /** Character / reference audio is playing. */
  speaking: string;
  /** Model or scorer is working; nothing is being recorded. */
  thinking: string;
  /** Transport dropped; we are reconnecting, nothing is lost silently. */
  reconnecting: string;
  /** Unrecoverable provider / permission error. */
  error: string;
}

export interface ColorTokens {
  background: string;
  surface: string;
  /** Cards, sheets, popovers. */
  elevated: string;
  /** Subtle fills (skeletons, inactive chips, seek-bar track). */
  surfaceMuted: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Text / icon drawn on top of `accent`. */
  onAccent: string;
  accent: string;
  /** Hover / pressed accent. */
  accentStrong: string;
  /** Tinted accent background (selected chips, highlighted segments). */
  accentSoft: string;
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
  /** Celebration confetti / badge accents (secondary brand hues). */
  celebrationA: string;
  celebrationB: string;
  celebrationC: string;
  speech: SpeechStateColors;
}

export const LIGHT_COLORS: ColorTokens = {
  background: '#F7F5F0',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  surfaceMuted: '#ECEEEA',
  textPrimary: '#1E2A33',
  textSecondary: '#44535C',
  textMuted: '#5E6E78',
  onAccent: '#FFFFFF',
  accent: '#0E7A6B',
  accentStrong: '#0A5F53',
  accentSoft: '#DDF3EF',
  success: '#1D7A4A',
  successSoft: '#DDF4E6',
  warning: '#8A5100',
  warningSoft: '#FFF0D6',
  error: '#B3261E',
  errorSoft: '#FCE2E0',
  info: '#1E5BA8',
  infoSoft: '#DFEAFA',
  border: '#D6DAD6',
  borderStrong: '#7E8E94',
  focusRing: '#1E5BA8',
  overlay: 'rgba(15, 26, 32, 0.55)',
  celebrationA: '#FF8F6B',
  celebrationB: '#FFC94D',
  celebrationC: '#49C5B1',
  speech: {
    listening: '#B4420C',
    speaking: '#0E7A6B',
    thinking: '#5B45C4',
    reconnecting: '#8A5100',
    error: '#B3261E',
  },
};

export const DARK_COLORS: ColorTokens = {
  background: '#0F1A20',
  surface: '#182329',
  elevated: '#202E35',
  surfaceMuted: '#2A373E',
  textPrimary: '#F2F5F6',
  textSecondary: '#C9D2D7',
  textMuted: '#A3B0B8',
  onAccent: '#0F1A20',
  accent: '#5FD6C3',
  accentStrong: '#8BE4D5',
  accentSoft: '#1C3B38',
  success: '#7ADBA3',
  successSoft: '#1C3A2B',
  warning: '#F5C96A',
  warningSoft: '#3E3018',
  error: '#FF9B9E',
  errorSoft: '#4A2426',
  info: '#8FC3FF',
  infoSoft: '#1E3350',
  border: '#35444C',
  borderStrong: '#6D7E87',
  focusRing: '#8FC3FF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  celebrationA: '#FF9D7C',
  celebrationB: '#FFD46A',
  celebrationC: '#5FD6C3',
  speech: {
    listening: '#FFA981',
    speaking: '#5FD6C3',
    thinking: '#C4B3FF',
    reconnecting: '#F5C96A',
    error: '#FF9B9E',
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
  accent: '#00534A',
  accentStrong: '#003A33',
  accentSoft: '#D2ECE7',
  success: '#0B5A2D',
  successSoft: '#D6F0DF',
  warning: '#633A00',
  warningSoft: '#FFEBC7',
  error: '#9A0000',
  errorSoft: '#FBDADA',
  info: '#003E8C',
  infoSoft: '#D9E6FA',
  border: '#000000',
  borderStrong: '#000000',
  focusRing: '#000000',
  overlay: 'rgba(0, 0, 0, 0.7)',
  celebrationA: '#B23A00',
  celebrationB: '#6B4A00',
  celebrationC: '#00534A',
  speech: {
    listening: '#8A2E00',
    speaking: '#00534A',
    thinking: '#3B1C8E',
    reconnecting: '#633A00',
    error: '#9A0000',
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
  accent: '#7FF5DF',
  accentStrong: '#B2FFF0',
  accentSoft: '#0F2E2A',
  success: '#8FF0B5',
  successSoft: '#0F2E1C',
  warning: '#FFD97A',
  warningSoft: '#33280C',
  error: '#FFB3B3',
  errorSoft: '#3A1414',
  info: '#A9D3FF',
  infoSoft: '#0F2240',
  border: '#FFFFFF',
  borderStrong: '#FFFFFF',
  focusRing: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.8)',
  celebrationA: '#FFB08F',
  celebrationB: '#FFE18A',
  celebrationC: '#7FF5DF',
  speech: {
    listening: '#FFB08F',
    speaking: '#7FF5DF',
    thinking: '#D3C6FF',
    reconnecting: '#FFD97A',
    error: '#FFB3B3',
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
  'accent',
  'success',
  'warning',
  'error',
  'info',
] as const satisfies readonly (keyof ColorTokens)[];

/** Surfaces text can appear on. */
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
