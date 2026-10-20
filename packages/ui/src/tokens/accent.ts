/**
 * Lantern accents per course and per lesson (U2 "Night Market", owner
 * decision 2026-10-19): "the lantern glow colours change with the language /
 * course and with the lesson". Every track's three lantern hues, its primary
 * action fill and its glow ring are derived from the track's cover palette
 * (`COVER_RECIPES` in `../art/covers`), then modulated by the lesson /
 * mission type. Text tokens are never touched by course tinting: the
 * derived `primaryText` is tuned until it reaches WCAG AA on every surface
 * and `onPrimary` is tuned to 4.5:1 on the fill, so the 30 tracks stay AA.
 *
 * The mascot's chameleon tint (course family × situation) lives in the art
 * module (`art/mascot/tint.ts`); the theme exposes it as `theme.mascotTint(state)`.
 */
import {
  LESSON_TYPE_VALUES,
  type LessonType,
  MISSION_STEP_TYPE_VALUES,
  MISSION_TYPE_VALUES,
  type MissionStepType,
  type MissionType,
} from '@langquest/contracts';
import { COVER_RECIPES, type CoverRecipe } from '../art/covers';
import { hsl } from '../art/palette';
import { COLOR_PALETTES, type ColorTokens, type PaletteName } from './color';
import { contrastRatio } from './contrast';

/* --------------------------------------------------------- course accent --- */

export interface CourseAccent {
  /** Track the accent was derived from; `null` for the direction's default lanterns. */
  trackId: string | null;
  /** Lantern hues in degrees (course hue, cover motif hue, derived third hue). */
  hues: readonly [number, number, number];
  /** Three lantern glow colours (blurred background blobs; no contrast requirement). */
  lantern: readonly [string, string, string];
  /** Primary action FILL (never text). */
  primary: string;
  /** Pressed / hover fill. */
  primaryStrong: string;
  /** Tinted background for selected chips / highlighted segments. */
  primarySoft: string;
  /** Ink drawn on `primary` (≥ 4.5:1). */
  onPrimary: string;
  /** The course accent used AS TEXT (≥ 4.5:1 on canvas, surface and card). */
  primaryText: string;
  /** Glow ring / bloom colour for the speech state and the primary action. */
  ring: string;
  /** False when the palette's fixed accent is used (high contrast / unknown track). */
  tinted: boolean;
}

const recipeByTrack = new Map<string, CoverRecipe>(COVER_RECIPES.map((r) => [r.trackId, r]));

/** Third lantern hue: a warm/cool counterpoint so the triple stays unique per track. */
function thirdHue(r: CoverRecipe): number {
  return (r.hue + 150 + r.variant * 12) % 360;
}

const SURFACE_KEYS = ['background', 'surface', 'elevated'] as const;

/** Walk lightness from `start` in `step` until `ok` holds (bounded). */
function tuneLightness(
  hue: number,
  sat: number,
  start: number,
  step: number,
  ok: (hex: string) => boolean,
): string {
  let l = start;
  for (let i = 0; i < 40; i += 1) {
    const hex = hsl(hue, sat, l);
    if (ok(hex)) return hex;
    l = Math.max(0.04, Math.min(0.96, l + step));
  }
  return hsl(hue, sat, l);
}

function lanternColors(
  hues: readonly [number, number, number],
  dark: boolean,
): [string, string, string] {
  const s = dark ? 0.95 : 0.8;
  const l = dark ? 0.6 : 0.46;
  return [hsl(hues[0], s, l), hsl(hues[1], s, l), hsl(hues[2], s, l)];
}

function defaultAccent(palette: ColorTokens): CourseAccent {
  return {
    trackId: null,
    hues: [330, 183, 42],
    lantern: palette.lantern,
    primary: palette.accent,
    primaryStrong: palette.accentStrong,
    primarySoft: palette.accentSoft,
    onPrimary: palette.onAccent,
    primaryText: palette.accentText,
    ring: palette.accent,
    tinted: false,
  };
}

const accentCache = new Map<string, CourseAccent>();

/**
 * Accent set for a course track in a palette. High-contrast palettes keep the
 * fixed accent fill/text (only the lanterns follow the course) so AAA is
 * preserved; unknown / missing tracks return the direction's defaults.
 */
export function courseAccent(
  trackId: string | null | undefined,
  scheme: PaletteName = 'dark',
): CourseAccent {
  const palette = COLOR_PALETTES[scheme];
  const recipe = trackId ? recipeByTrack.get(trackId) : undefined;
  if (!recipe) return defaultAccent(palette);
  const key = `${scheme}:${recipe.trackId}`;
  const cached = accentCache.get(key);
  if (cached) return cached;

  const dark = scheme === 'dark' || scheme === 'highContrastDark';
  const hues: [number, number, number] = [recipe.hue, recipe.hue2, thirdHue(recipe)];
  const lantern = lanternColors(hues, dark);
  let accent: CourseAccent;
  if (scheme === 'highContrastDark' || scheme === 'highContrastLight') {
    accent = { ...defaultAccent(palette), trackId: recipe.trackId, hues, lantern, tinted: false };
  } else {
    const surfaces = SURFACE_KEYS.map((k) => palette[k]);
    const readableOnAll = (hex: string): boolean =>
      surfaces.every((s) => contrastRatio(hex, s) >= 4.5);
    const fillOk =
      (ink: string) =>
      (hex: string): boolean =>
        contrastRatio(ink, hex) >= 4.5 && surfaces.every((s) => contrastRatio(hex, s) >= 3);
    const hue = recipe.hue;
    const onPrimary = dark ? palette.background : '#FFFFFF';
    const primary = dark
      ? tuneLightness(hue, 0.88, 0.6, 0.02, fillOk(onPrimary))
      : tuneLightness(hue, 0.85, 0.42, -0.02, fillOk(onPrimary));
    const primaryStrong = dark
      ? tuneLightness(hue, 0.9, 0.72, 0.02, fillOk(onPrimary))
      : tuneLightness(hue, 0.85, 0.3, -0.02, fillOk(onPrimary));
    const primaryText = dark
      ? tuneLightness(hue, 0.9, 0.68, 0.02, readableOnAll)
      : tuneLightness(hue, 0.85, 0.36, -0.02, readableOnAll);
    const softOk = (hex: string): boolean => contrastRatio(primaryText, hex) >= 4.5;
    const primarySoft = dark
      ? tuneLightness(hue, 0.45, 0.2, -0.02, softOk)
      : tuneLightness(hue, 0.6, 0.93, 0.01, softOk);
    const ring = dark ? hsl(hue, 1, 0.68) : hsl(hue, 0.9, 0.46);
    accent = {
      trackId: recipe.trackId,
      hues,
      lantern,
      primary,
      primaryStrong,
      primarySoft,
      onPrimary,
      primaryText,
      ring,
      tinted: true,
    };
  }
  accentCache.set(key, Object.freeze(accent));
  return accent;
}

/** Track ids that have a derived accent (the 30 catalog tracks). */
export const ACCENT_TRACK_IDS: readonly string[] = COVER_RECIPES.map((r) => r.trackId);

/* --------------------------------------------------------- lesson accent --- */

/** Anything the app knows about what the learner is doing right now. */
export type LessonAccentKey = MissionType | MissionStepType | LessonType;

export interface LessonAccent {
  key: LessonAccentKey | null;
  /** Degrees added to every lantern hue (warm +, cool −). */
  hueShift: number;
  /** Which lantern leads (moves to the first slot): 0 course hue, 1 motif hue, 2 counterpoint. */
  lead: 0 | 1 | 2;
  /** 0..1 — how much the glows breathe; calm listening steps glow less than live speaking. */
  glowIntensity: number;
  /** Which element owns the glow on this kind of screen. */
  glowTarget: 'speech' | 'primary' | 'both';
}

const NEUTRAL: LessonAccent = {
  key: null,
  hueShift: 0,
  lead: 0,
  glowIntensity: 0.8,
  glowTarget: 'primary',
};

const A = (
  key: LessonAccentKey,
  hueShift: number,
  lead: 0 | 1 | 2,
  glowIntensity: number,
  glowTarget: LessonAccent['glowTarget'],
): LessonAccent => ({ key, hueShift, lead, glowIntensity, glowTarget });

/**
 * Modulation per mission / step / lesson type. Speaking-first screens lead
 * with the course hue and glow fully; listening steps are cooler and calmer;
 * story and situational missions lean warm; reviews are quiet.
 */
export const LESSON_ACCENTS: Readonly<Record<LessonAccentKey, LessonAccent>> = {
  // mission types — every entry differs from the neutral (no lesson) lanterns and from each
  // other, so a standard mission, a free conversation and Home never share a lantern set.
  standard: A('standard', 4, 0, 0.8, 'primary'),
  story: A('story', 18, 2, 0.7, 'speech'),
  review: A('review', -10, 1, 0.5, 'primary'),
  free_conversation: A('free_conversation', 8, 1, 1, 'speech'),
  audio_linked: A('audio_linked', -24, 1, 0.45, 'primary'),
  pronunciation: A('pronunciation', -36, 1, 1, 'both'),
  situational: A('situational', 24, 2, 0.8, 'speech'),
  // mission step types
  context_listening: A('context_listening', -24, 1, 0.4, 'speech'),
  modeled_expression: A('modeled_expression', -12, 0, 0.6, 'speech'),
  anticipation: A('anticipation', 12, 2, 0.5, 'primary'),
  listen_identify: A('listen_identify', -30, 1, 0.4, 'speech'),
  shadowing: A('shadowing', -36, 1, 0.9, 'both'),
  comprehension_check: A('comprehension_check', 6, 2, 0.5, 'primary'),
  pronunciation_drill: A('pronunciation_drill', -40, 1, 1, 'both'),
  character_conversation: A('character_conversation', -8, 2, 1, 'speech'),
  story_branch: A('story_branch', 20, 2, 0.6, 'primary'),
  feedback_retry: A('feedback_retry', 30, 2, 0.7, 'primary'),
  review_recall: A('review_recall', -10, 1, 0.5, 'primary'),
  script_support: A('script_support', 8, 2, 0.4, 'primary'),
  // lesson types
  anticipate_speak: A('anticipate_speak', -6, 0, 0.9, 'both'),
  guided_roleplay: A('guided_roleplay', 6, 0, 1, 'speech'),
  listening_comprehension: A('listening_comprehension', -28, 1, 0.4, 'speech'),
  mission_story: A('mission_story', 18, 2, 0.7, 'speech'),
  situational_task: A('situational_task', 24, 2, 0.8, 'speech'),
  audio_only: A('audio_only', -24, 1, 0.35, 'primary'),
  adaptive_review: A('adaptive_review', -10, 1, 0.5, 'primary'),
  audio_course_linked: A('audio_course_linked', -24, 1, 0.45, 'primary'),
};

export const LESSON_ACCENT_KEYS: readonly LessonAccentKey[] = [
  ...MISSION_TYPE_VALUES,
  ...MISSION_STEP_TYPE_VALUES,
  ...LESSON_TYPE_VALUES,
].filter((k, i, all) => all.indexOf(k) === i);

/** Lesson modulation; unknown / missing keys are neutral. */
export function lessonAccent(key: string | null | undefined): LessonAccent {
  if (!key) return NEUTRAL;
  return (LESSON_ACCENTS as Record<string, LessonAccent | undefined>)[key] ?? NEUTRAL;
}

/* ------------------------------------------------------------- resolved --- */

export interface ResolvedAccents extends CourseAccent {
  lesson: LessonAccent;
  /** Lantern colours after the lesson's hue shift, lead lantern first. */
  lantern: readonly [string, string, string];
  /** Background blob opacity (0 in high contrast and when lanterns are off). */
  lanternOpacity: number;
  glowIntensity: number;
  glowTarget: LessonAccent['glowTarget'];
}

export interface ResolveAccentsOptions {
  scheme?: PaletteName;
  /** Lanterns off (device tier / learner preference). */
  lanterns?: boolean;
}

/** Course accent modulated by the current lesson — what `theme.accents` exposes. */
export function resolveAccents(
  trackId: string | null | undefined,
  lessonKey: string | null | undefined,
  options: ResolveAccentsOptions = {},
): ResolvedAccents {
  const scheme = options.scheme ?? 'dark';
  const base = courseAccent(trackId, scheme);
  const lesson = lessonAccent(lessonKey);
  const dark = scheme === 'dark' || scheme === 'highContrastDark';
  const highContrast = scheme === 'highContrastDark' || scheme === 'highContrastLight';
  const shifted: [number, number, number] = [
    base.hues[0] + lesson.hueShift,
    base.hues[1] + lesson.hueShift,
    base.hues[2] + lesson.hueShift,
  ];
  const at = (i: number): number => shifted[((i % 3) + 3) % 3] ?? shifted[0];
  const ordered: [number, number, number] = [
    at(lesson.lead),
    at(lesson.lead + 1),
    at(lesson.lead + 2),
  ];
  const lantern =
    base.trackId === null && lesson.hueShift === 0 && lesson.lead === 0
      ? base.lantern
      : lanternColors(ordered, dark);
  const lanternsOn = (options.lanterns ?? true) && !highContrast;
  return Object.freeze({
    ...base,
    lesson,
    lantern,
    lanternOpacity: lanternsOn ? (dark ? 0.3 : 0.18) : 0,
    glowIntensity: highContrast ? 0 : lesson.glowIntensity,
    glowTarget: lesson.glowTarget,
  });
}
