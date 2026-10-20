/**
 * Art palettes (light / dark). Semantic names only — components must never
 * hard-code hex values. Mirrors the mascot style guide (`docs/mascot-style-guide.md`).
 */

export type ArtTheme = 'light' | 'dark';

/**
 * Mascot palette — Melo the chameleon (design exploration M3, owner-approved 2026-10-19).
 *
 * `body` / `bodyShade` / `belly` are the *base* leaf-green tint; at render time they are
 * replaced by `mascotTint(...)` (see `./mascot/tint.ts`), which shifts the hue with the
 * mascot state and the course family — the chameleon mechanic. `crest`, `outline`, props
 * and eyes never shift so the silhouette stays the brand anchor.
 *
 * Fields kept from the previous (orbit-creature) palette for API compatibility:
 * `ribbon` / `ribbonShade` now alias the crest colours, `limb` aliases `bodyShade`,
 * `mouth` aliases `pupil`.
 */
export interface MascotPalette {
  body: string;
  bodyShade: string;
  belly: string;
  /** Saffron casque (crest) and flank bands — never tinted. */
  crest: string;
  crestShade: string;
  /** @deprecated alias of `crest` (the orbit-creature's tail colour). */
  ribbon: string;
  /** @deprecated alias of `crestShade`. */
  ribbonShade: string;
  outline: string;
  eyeWhite: string;
  pupil: string;
  highlight: string;
  cheek: string;
  /** @deprecated alias of `bodyShade` (arms and feet use the body shade). */
  limb: string;
  /** @deprecated alias of `pupil`. */
  mouth: string;
  tongue: string;
  prop: string;
  propFill: string;
  /** Warm accent used by props (stars, badge, bulb). Same as `crest`. */
  accent: string;
  danger: string;
  muted: string;
  mutedFill: string;
  sleepy: string;
  /** Confetti / sparkle secondaries. */
  confettiSky: string;
  confettiPink: string;
}

/** Base body hue of the leaf-green chameleon (HSL degrees). */
export const MASCOT_BASE_HUE = 123;
/** Base body saturation (0..1). */
export const MASCOT_BASE_SATURATION = 0.4;
/** Body / shade / belly lightness per theme (0..1). */
export const MASCOT_BODY_LIGHTNESS: Record<
  ArtTheme,
  { body: number; shade: number; belly: number }
> = {
  light: { body: 0.59, shade: 0.45, belly: 0.94 },
  dark: { body: 0.62, shade: 0.48, belly: 0.92 },
};

/**
 * Body tokens for a hue / saturation / lightness-offset triple. Used by the chameleon
 * tint system; also handy for previews ("what does Melo look like at hue X?").
 */
export function mascotBodyTokens(
  theme: ArtTheme,
  hue: number,
  saturation: number = MASCOT_BASE_SATURATION,
  lightnessDelta = 0,
): { body: string; bodyShade: string; belly: string } {
  const L = MASCOT_BODY_LIGHTNESS[theme];
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return {
    body: hsl(hue, saturation, clamp(L.body + lightnessDelta)),
    bodyShade: hsl(hue, saturation, clamp(L.shade + lightnessDelta)),
    belly: hsl(hue - 20, Math.min(1, saturation + 0.05), clamp(L.belly)),
  };
}

function buildMascotPalette(theme: ArtTheme): MascotPalette {
  const dark = theme === 'dark';
  const base = mascotBodyTokens(theme, MASCOT_BASE_HUE);
  const crest = dark ? '#FFBC4F' : '#F2A93B';
  const crestShade = dark ? '#E09A2E' : '#D98C1F';
  const outline = dark ? '#0E1A12' : '#243B2A';
  const pupil = dark ? '#0F1A20' : '#1F2A2E';
  return {
    ...base,
    crest,
    crestShade,
    ribbon: crest,
    ribbonShade: crestShade,
    outline,
    eyeWhite: dark ? '#F4F7F2' : '#FFFFFF',
    pupil,
    highlight: '#FFFFFF',
    cheek: dark ? '#FF9E8A' : '#FFB08A',
    limb: base.bodyShade,
    mouth: pupil,
    tongue: dark ? '#FF8E9B' : '#F07C8A',
    prop: dark ? '#E8F1EA' : '#243B2A',
    propFill: dark ? '#1C2B20' : '#FFFFFF',
    accent: crest,
    danger: dark ? '#FF7A7E' : '#E0565B',
    muted: dark ? '#8C9792' : '#9AA3A8',
    mutedFill: dark ? '#46524F' : '#E8EDEF',
    sleepy: dark ? '#A9B6E8' : '#8F9FD6',
    confettiSky: dark ? '#7CC8EA' : '#5FB3D9',
    confettiPink: dark ? '#FF8E9B' : '#F07C8A',
  };
}

export const MASCOT_PALETTE: Record<ArtTheme, MascotPalette> = {
  light: buildMascotPalette('light'),
  dark: buildMascotPalette('dark'),
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
