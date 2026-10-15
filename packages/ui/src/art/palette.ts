/**
 * Art palettes (light / dark). Semantic names only — components must never
 * hard-code hex values. Mirrors the mascot style guide (`docs/mascot-style-guide.md`).
 */

export type ArtTheme = 'light' | 'dark';

/** Mascot ("Orbi", provisional name) palette. */
export interface MascotPalette {
  body: string;
  bodyShade: string;
  belly: string;
  ribbon: string;
  ribbonShade: string;
  outline: string;
  eyeWhite: string;
  pupil: string;
  highlight: string;
  cheek: string;
  limb: string;
  mouth: string;
  tongue: string;
  prop: string;
  propFill: string;
  accent: string;
  danger: string;
  muted: string;
  mutedFill: string;
  sleepy: string;
}

export const MASCOT_PALETTE: Record<ArtTheme, MascotPalette> = {
  light: {
    body: '#49C5B1',
    bodyShade: '#2FA896',
    belly: '#F4FBF8',
    ribbon: '#FF8F6B',
    ribbonShade: '#E5704E',
    outline: '#1E3A3A',
    eyeWhite: '#FFFFFF',
    pupil: '#1E2A33',
    highlight: '#FFFFFF',
    cheek: '#FFB3A0',
    limb: '#2FA896',
    mouth: '#1E2A33',
    tongue: '#FF8F6B',
    prop: '#1E3A3A',
    propFill: '#FFFFFF',
    accent: '#FFC94D',
    danger: '#E0565B',
    muted: '#7F8E96',
    mutedFill: '#E3E9EC',
    sleepy: '#8F9FD6',
  },
  dark: {
    body: '#5FD6C3',
    bodyShade: '#3DB8A4',
    belly: '#E6F7F3',
    ribbon: '#FF9D7C',
    ribbonShade: '#E87C5A',
    outline: '#0F1F22',
    eyeWhite: '#FFFFFF',
    pupil: '#0F1A20',
    highlight: '#FFFFFF',
    cheek: '#FF9E8A',
    limb: '#3DB8A4',
    mouth: '#0F1A20',
    tongue: '#FF9D7C',
    prop: '#E8F1F2',
    propFill: '#1C2B2F',
    accent: '#FFD46A',
    danger: '#FF7A7E',
    muted: '#9AA8B0',
    mutedFill: '#2A373C',
    sleepy: '#A9B6E8',
  },
};

/** Neutral UI-ish colours used by scenes/covers/portraits for backgrounds and line work. */
export interface SceneBasePalette {
  ink: string;
  paper: string;
  skyDay: [string, string];
  skyEvening: [string, string];
  sunDay: string;
  sunEvening: string;
  groundDay: string;
  groundEvening: string;
  glow: string;
  shadow: string;
}

export const SCENE_BASE: Record<ArtTheme, SceneBasePalette> = {
  light: {
    ink: '#2B3A42',
    paper: '#FFF9F2',
    skyDay: ['#DCEFFB', '#F8F3E9'],
    skyEvening: ['#4E4B8C', '#F3A26B'],
    sunDay: '#FFE3A3',
    sunEvening: '#FFB36B',
    groundDay: '#E8DCC8',
    groundEvening: '#6A5A72',
    glow: '#FFD98A',
    shadow: '#2B3A42',
  },
  dark: {
    ink: '#101A20',
    paper: '#1B262C',
    skyDay: ['#2E4A66', '#3C5466'],
    skyEvening: ['#1D1B45', '#8C4A3A'],
    sunDay: '#D9C48A',
    sunEvening: '#E09A5A',
    groundDay: '#4A4238',
    groundEvening: '#2E2838',
    glow: '#E8B860',
    shadow: '#05090C',
  },
};

/** Skin tones used by the portrait generator (inclusive, from light to deep). */
export const SKIN_TONES = {
  s1: '#F6D7C3',
  s2: '#EEC4A8',
  s3: '#E2AC86',
  s4: '#C98F66',
  s5: '#A86D4A',
  s6: '#8A5536',
  s7: '#6B4027',
  s8: '#4B2C1A',
} as const;
export type SkinToneId = keyof typeof SKIN_TONES;

/** Hair colours. */
export const HAIR_COLORS = {
  black: '#1F1B1C',
  darkBrown: '#3D2A20',
  brown: '#6B4A33',
  auburn: '#8C4A2F',
  blonde: '#D9B36B',
  grey: '#9FA4A8',
  silver: '#D6D9DC',
} as const;
export type HairColorId = keyof typeof HAIR_COLORS;

/** Clothing / accent colours (restrained, contemporary). */
export const CLOTH_COLORS = {
  teal: '#3A9D8F',
  coral: '#F07C5E',
  mustard: '#E0A93A',
  navy: '#2F4A6D',
  plum: '#7A4B7D',
  olive: '#7F8C4F',
  sky: '#6FB2D8',
  sand: '#D9C39A',
  white: '#F7F7F5',
  charcoal: '#3C3F45',
  rose: '#D86B8A',
  mint: '#8FD3B5',
  rust: '#B5562F',
  denim: '#4A6FA5',
} as const;
export type ClothColorId = keyof typeof CLOTH_COLORS;

/** Adjust a hex colour towards black (negative amount) or white (positive), 0..1. */
export function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 0xff;
  const gg = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number): number => {
    const target = amount < 0 ? 0 : 255;
    const t = Math.min(1, Math.abs(amount));
    return Math.round(c + (target - c) * t);
  };
  const toHex = (c: number): string => c.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(gg))}${toHex(mix(b))}`.toUpperCase();
}

/** Convert HSL (h 0..360, s/l 0..1) to a hex colour. Used by the cover system. */
export function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let gg = 0;
  let b = 0;
  if (hh < 60) [r, gg, b] = [c, x, 0];
  else if (hh < 120) [r, gg, b] = [x, c, 0];
  else if (hh < 180) [r, gg, b] = [0, c, x];
  else if (hh < 240) [r, gg, b] = [0, x, c];
  else if (hh < 300) [r, gg, b] = [x, 0, c];
  else [r, gg, b] = [c, 0, x];
  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(gg)}${toHex(b)}`.toUpperCase();
}
