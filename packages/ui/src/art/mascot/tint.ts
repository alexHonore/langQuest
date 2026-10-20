/**
 * Chameleon colour — Melo changes hue with the situation.
 *
 * Two independent dials are blended into the body tokens:
 *
 * 1. **State tint** (`MASCOT_STATE_TINTS`): every contract state owns a hue — listening is
 *    sea-teal, thinking lavender, celebrate saffron-lime, try_again soft coral, sleep dusk blue,
 *    offline / connection_error a desaturated grey-green, success a bright leaf…
 * 2. **Course-family tint** (`courseFamilyTint`): the M3 "body hue dial" — an abstract hue
 *    offset per course family so the same friend wears the local light of the course.
 *    Families are abstract groupings and never echo a flag; the mapping is a product
 *    decision kept in one table so it can be swapped without touching any screen.
 *
 * Blend: `hue = stateHue + familyOffset × familyWeight(state)`. Mood states (neutral,
 * welcome, happy…) take the family offset in full; signal states (listening, thinking,
 * offline…) take it at a reduced weight so their hue stays recognisable in any course.
 *
 * Honesty rule: hue never *encodes* an evaluation result. `success` and `celebrate` are
 * readable by pose + prop (thumbs up, confetti) first; their tint is a mood, not a score.
 * The crest, outline, eyes and props never shift, so the silhouette stays the brand anchor.
 */
import { type MascotState, MASCOT_STATE_VALUES } from '@langquest/contracts';
import {
  type ArtTheme,
  MASCOT_BASE_HUE,
  MASCOT_BASE_SATURATION,
  MASCOT_PALETTE,
  mascotBodyTokens,
} from '../palette';

/** One entry of the state tint table. */
export interface MascotStateTint {
  /** Human-readable colour name (documentation / admin preview only, never UI copy). */
  name: string;
  /** Absolute body hue in HSL degrees. */
  hue: number;
  /** Body saturation 0..1. Grey-green signal states sit near 0.1. */
  saturation: number;
  /** Lightness delta applied to body and shade (−0.1..0.1). */
  lightness: number;
  /** How much of the course-family offset is applied (0..1). */
  familyWeight: number;
  /** True for the desaturated network states (props also use the muted tokens). */
  muted?: boolean;
}

/** Per-state hue table — the chameleon's "situations". */
export const MASCOT_STATE_TINTS: Record<MascotState, MascotStateTint> = {
  neutral: { name: 'leaf', hue: MASCOT_BASE_HUE, saturation: 0.4, lightness: 0, familyWeight: 1 },
  welcome: { name: 'spring green', hue: 107, saturation: 0.44, lightness: 0.01, familyWeight: 1 },
  happy: { name: 'lime leaf', hue: 95, saturation: 0.46, lightness: 0.01, familyWeight: 1 },
  curious: { name: 'mint', hue: 152, saturation: 0.4, lightness: 0, familyWeight: 0.8 },
  listening: { name: 'sea teal', hue: 174, saturation: 0.42, lightness: 0, familyWeight: 0.35 },
  speaking: { name: 'fresh green', hue: 105, saturation: 0.44, lightness: 0.01, familyWeight: 0.8 },
  thinking: { name: 'lavender', hue: 262, saturation: 0.3, lightness: 0.02, familyWeight: 0.3 },
  encouraging: {
    name: 'chartreuse',
    hue: 82,
    saturation: 0.46,
    lightness: 0.01,
    familyWeight: 0.8,
  },
  try_again: { name: 'soft coral', hue: 16, saturation: 0.44, lightness: 0.03, familyWeight: 0.3 },
  celebrate: {
    name: 'saffron lime',
    hue: 70,
    saturation: 0.56,
    lightness: 0.02,
    familyWeight: 0.4,
  },
  achievement: {
    name: 'warm gold-green',
    hue: 50,
    saturation: 0.52,
    lightness: 0.02,
    familyWeight: 0.4,
  },
  quiet_audio: { name: 'calm sky', hue: 205, saturation: 0.32, lightness: 0, familyWeight: 0.4 },
  sleep: { name: 'dusk blue', hue: 226, saturation: 0.28, lightness: 0, familyWeight: 0.3 },
  offline: {
    name: 'grey-green',
    hue: 140,
    saturation: 0.08,
    lightness: 0.02,
    familyWeight: 0.2,
    muted: true,
  },
  connection_error: {
    name: 'grey-green (dim)',
    hue: 140,
    saturation: 0.1,
    lightness: -0.02,
    familyWeight: 0.2,
    muted: true,
  },
  success: { name: 'bright leaf', hue: 128, saturation: 0.55, lightness: 0.04, familyWeight: 0.6 },
  gentle_hint: {
    name: 'soft yellow-green',
    hue: 60,
    saturation: 0.42,
    lightness: 0.02,
    familyWeight: 0.7,
  },
};

/* ---------------------------------------------------------- course family --- */

/** Abstract course families (the M3 hue dial). Names are groupings, not nationalities. */
export const COURSE_FAMILY_IDS = [
  'germanic',
  'romance',
  'west-asian',
  'east-asian',
  'slavic-hellenic',
  'indic',
  'african',
] as const;
export type CourseFamilyId = (typeof COURSE_FAMILY_IDS)[number];

/** Hue offset (degrees) of each family on the M3 body-hue dial. */
export const COURSE_FAMILY_HUE_OFFSETS: Record<CourseFamilyId, number> = {
  germanic: 0,
  romance: -18,
  'east-asian': -40,
  'west-asian': 20,
  'slavic-hellenic': 42,
  indic: 54,
  african: 66,
};

/** Track → family mapping (product decision; swappable without touching screens). */
export const COURSE_TRACK_FAMILIES: Readonly<Record<string, CourseFamilyId>> = {
  english: 'germanic',
  danish: 'germanic',
  german: 'germanic',
  swedish: 'germanic',
  french: 'romance',
  italian: 'romance',
  'spanish-latin-american': 'romance',
  'spanish-spain': 'romance',
  'portuguese-brazilian': 'romance',
  'portuguese-european': 'romance',
  romanian: 'romance',
  'haitian-creole': 'romance',
  'arabic-eastern': 'west-asian',
  'arabic-moroccan': 'west-asian',
  'arabic-egyptian': 'west-asian',
  'arabic-msa': 'west-asian',
  hebrew: 'west-asian',
  'chinese-cantonese': 'east-asian',
  'chinese-mandarin': 'east-asian',
  'chinese-simplified': 'east-asian',
  japanese: 'east-asian',
  korean: 'east-asian',
  vietnamese: 'east-asian',
  greek: 'slavic-hellenic',
  russian: 'slavic-hellenic',
  ukrainian: 'slavic-hellenic',
  hindi: 'indic',
  swahili: 'african',
  kinyarwanda: 'african',
  lingala: 'african',
};

export interface CourseFamilyTint {
  family: CourseFamilyId | null;
  /** Hue offset on the dial (0 when the track is unknown). */
  hueOffset: number;
  /** Resting (neutral-state) body hue for this family. */
  hue: number;
}

/**
 * Family tint for a course track id (or a family id). Unknown ids fall back to the base
 * tint (offset 0) so a missing mapping can never break a screen.
 */
export function courseFamilyTint(trackOrFamily: string | null | undefined): CourseFamilyTint {
  if (!trackOrFamily) return { family: null, hueOffset: 0, hue: MASCOT_BASE_HUE };
  const family: CourseFamilyId | undefined = (COURSE_FAMILY_IDS as readonly string[]).includes(
    trackOrFamily,
  )
    ? (trackOrFamily as CourseFamilyId)
    : COURSE_TRACK_FAMILIES[trackOrFamily];
  if (!family) return { family: null, hueOffset: 0, hue: MASCOT_BASE_HUE };
  const hueOffset = COURSE_FAMILY_HUE_OFFSETS[family];
  return { family, hueOffset, hue: MASCOT_BASE_HUE + hueOffset };
}

/* ------------------------------------------------------------------ tint --- */

/** Resolved body tokens for one render. */
export interface MascotTint {
  body: string;
  bodyShade: string;
  belly: string;
  crest: string;
  crestShade: string;
  /** Final body hue (degrees, normalised 0..360). */
  hue: number;
  saturation: number;
  /** True when the muted prop tokens should be used (network states). */
  muted: boolean;
}

export interface MascotTintInput {
  state: MascotState;
  theme?: ArtTheme;
  /** Course family id (wins over `trackId`). */
  courseFamily?: CourseFamilyId | string | null;
  /** Course track id (`COURSE_TRACK_IDS`); mapped through `COURSE_TRACK_FAMILIES`. */
  trackId?: string | null;
}

const norm = (h: number): number => ((h % 360) + 360) % 360;

/**
 * The chameleon's colour for a situation: state hue blended with the course-family dial.
 * Pure and deterministic — safe to call per frame.
 */
export function mascotTint(input: MascotTintInput): MascotTint {
  const theme = input.theme ?? 'light';
  const st = MASCOT_STATE_TINTS[input.state];
  const fam = courseFamilyTint(input.courseFamily ?? input.trackId);
  const hue = norm(st.hue + fam.hueOffset * st.familyWeight);
  const saturation = Math.min(1, Math.max(0, st.saturation));
  const body = mascotBodyTokens(theme, hue, saturation, st.lightness);
  const p = MASCOT_PALETTE[theme];
  const muted = st.muted === true;
  return {
    ...body,
    crest: muted ? p.muted : p.crest,
    crestShade: muted ? p.mutedFill : p.crestShade,
    hue,
    saturation,
    muted,
  };
}

/** The base (neutral, no course) tint — what the style guide shows as "Melo". */
export const mascotBaseTint = (theme: ArtTheme = 'light'): MascotTint =>
  mascotTint({ state: 'neutral', theme });

/** Every state's tint for a theme/course (admin previews, tests, docs tables). */
export function mascotTintTable(
  theme: ArtTheme = 'light',
  trackId?: string | null,
): Record<MascotState, MascotTint> {
  return Object.fromEntries(
    MASCOT_STATE_VALUES.map((s) => [s, mascotTint({ state: s, theme, trackId })]),
  ) as Record<MascotState, MascotTint>;
}

export { MASCOT_BASE_HUE, MASCOT_BASE_SATURATION };
