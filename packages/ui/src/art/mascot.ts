/**
 * The LangQuest mascot — **Melo**, an original chubby chameleon (design exploration M3,
 * owner-approved 2026-10-19; supersedes the orbit-creature baseline).
 *
 * Pear body with the head *as* the body, a saffron crest, two eye turrets that swivel
 * independently, stubby mitten limbs and a spiral tail that doubles as a gesture. Like a
 * chameleon it **changes colour with the situation**: `mascotTint()` blends a per-state hue
 * with the course family's hue (see `./mascot/tint.ts`). Hue never encodes an evaluation
 * result — every state reads by pose + prop first.
 *
 * The geometry lives in `./mascot/geometry.ts` as renderer-agnostic {@link SvgNode}s so the
 * React Native component (`./native.tsx`), the string renderer, the Lottie generator and
 * the Rive master export share one source of truth. Coordinate space: 100 × 100 viewBox.
 */
import { MASCOT_STATE_VALUES, type MascotState } from '@langquest/contracts';
import { type ArtTheme, MASCOT_PALETTE } from './palette';
import {
  type ArmPose,
  type EyeParams,
  EYE_L,
  EYE_R,
  type MascotColors,
  type MascotDetail,
  type MouthShape,
  type PropKind,
  armsNodes,
  bandNodes,
  bodyNodes,
  cheekNodes,
  crestNodes,
  eyeParts,
  feetNodes,
  lidChord,
  mascotColors,
  mouthNodes,
  propNodes,
  tailNodes,
} from './mascot/geometry';
import { MASCOT_POSES, type MascotPose } from './mascot/poses';
import { type CourseFamilyId, type MascotTint, mascotTint } from './mascot/tint';
import { type SvgDocument, type SvgNode, fmt, g, toSvgString } from './svg-node';

export type {
  ArmPose,
  EyeShape,
  MouthShape,
  PropKind,
  TailSpec,
  MascotDetail,
} from './mascot/geometry';
export type { MascotPose } from './mascot/poses';
export { MASCOT_POSES } from './mascot/poses';
export {
  MASCOT_STATE_TINTS,
  COURSE_FAMILY_IDS,
  COURSE_FAMILY_HUE_OFFSETS,
  COURSE_TRACK_FAMILIES,
  courseFamilyTint,
  mascotTint,
  mascotBaseTint,
  mascotTintTable,
} from './mascot/tint';
export type {
  CourseFamilyId,
  CourseFamilyTint,
  MascotTint,
  MascotTintInput,
  MascotStateTint,
} from './mascot/tint';

/**
 * @deprecated The orbit-creature had eyebrows; Melo's eye turrets carry expression through
 * gaze, lids and scale instead. Kept so existing type imports keep compiling.
 */
export type BrowShape =
  'none' | 'relaxed' | 'raised' | 'raisedLeft' | 'raisedRight' | 'worried' | 'low';

/** Working name (not a trademark claim; UI copy always goes through localized `mascot.*` keys). */
export const MASCOT_NAME = 'Melo';

/** The 17 mascot states, in contract order. */
export const MASCOT_STATES: readonly MascotState[] = MASCOT_STATE_VALUES;

/** Short, culture-neutral accessibility labels (English source; localise via `mascot.a11yState.<state>` keys). */
export const MASCOT_ACCESSIBILITY_LABELS: Record<MascotState, string> = {
  neutral: 'Mascot, relaxed',
  welcome: 'Mascot waving hello',
  happy: 'Mascot smiling',
  curious: 'Mascot looking curious',
  listening: 'Mascot listening to you',
  speaking: 'Mascot speaking',
  thinking: 'Mascot thinking',
  encouraging: 'Mascot cheering you on',
  try_again: 'Mascot inviting you to try again',
  celebrate: 'Mascot celebrating',
  achievement: 'Mascot presenting an achievement',
  quiet_audio: 'Mascot wearing headphones, audio mode',
  sleep: 'Mascot resting',
  offline: 'Mascot, offline',
  connection_error: 'Mascot, connection problem',
  success: 'Mascot, success',
  gentle_hint: 'Mascot offering a hint',
};

/**
 * i18n key for a state's **accessibility label** (`mascot.a11yState.<state>`,
 * e.g. "Guide is listening"). This is the localized counterpart of
 * {@link MASCOT_ACCESSIBILITY_LABELS}; pass `t(mascotLabelKey(state))` as the
 * image's `accessibilityLabel`. Catalogs live in `@langquest/locales`.
 */
export function mascotLabelKey(state: MascotState): string {
  return `mascot.a11yState.${state}`;
}

/**
 * i18n key for a state's **speech-bubble copy** (`mascot.state.<state>`, e.g.
 * "I'm listening."). This is what the mascot says, in the enrollment's source
 * language — never use it as an accessibility label.
 */
export function mascotSpeechKey(state: MascotState): string {
  return `mascot.state.${state}`;
}

/* ------------------------------------------------------------- options --- */

export interface MascotRenderOptions {
  theme?: ArtTheme;
  /** Render size in dp/px — below 40 the "icon" detail level drops fine features. */
  size?: number;
  /** 0 = eyes open, 1 = fully closed. Animation hook; static renders use 0. */
  blink?: number;
  /** −1..1 breathing phase (scale about the feet). Animation hook; static renders use 0. */
  breath?: number;
  /** Override both pupils' gaze (−1..1 per axis). Animation hook. */
  gaze?: readonly [number, number];
  /** Override the left / right pupil independently (the chameleon scan). */
  gazeL?: readonly [number, number];
  gazeR?: readonly [number, number];
  /** 0..1 tail spiral tightness; 1 = the pose's own curl. Animation hook. */
  tailCurl?: number;
  /** Extra head/body tilt in degrees added to the pose's tilt. Animation hook. */
  headTilt?: number;
  /** Explicit chameleon tint (wins over `courseFamily` / `trackId`). */
  tint?: MascotTint;
  /** Course family for the tint dial (wins over `trackId`). */
  courseFamily?: CourseFamilyId | string | null;
  /** Course track id for the tint dial (`COURSE_TRACK_IDS`). */
  trackId?: string | null;
}

export const MASCOT_VIEWBOX = { x: 0, y: 0, width: 100, height: 100 } as const;
/** Tilt pivot (figure centre) and breath pivot (ground centre). */
export const MASCOT_PIVOT = { tilt: [50, 60] as const, breath: [50, 88] as const };

/** Named parts, in paint order. These are the Rive/Lottie layers and the master-SVG groups. */
export const MASCOT_PART_IDS = [
  'propsBehind',
  'tail',
  'crest',
  'feet',
  'body',
  'bands',
  'armL',
  'armR',
  'cheeks',
  'mouth',
  'turretL',
  'pupilL',
  'lidL',
  'turretR',
  'pupilR',
  'lidR',
  'propsFront',
] as const;
export type MascotPartId = (typeof MASCOT_PART_IDS)[number];

export interface MascotParts {
  state: MascotState;
  pose: MascotPose;
  detail: MascotDetail;
  colors: MascotColors;
  tint: MascotTint;
  /** Nodes per part (empty arrays for parts the state/detail level does not draw). */
  nodes: Record<MascotPartId, SvgNode[]>;
  /** Figure transform the body parts (not the props) sit under. */
  figure: { tilt: number; breath: number; scaleX: number; scaleY: number };
  /** Eye geometry for animation anchors. */
  eyes: { left: EyeParams & { radius: number }; right: EyeParams & { radius: number } };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function eyeParamsFor(
  pose: MascotPose,
  side: 'L' | 'R',
  opts: MascotRenderOptions,
  blink: number,
): EyeParams {
  const shape = (side === 'L' ? pose.eyesL : pose.eyesR) ?? pose.eyes;
  const poseGaze = (side === 'L' ? pose.gazeL : pose.gazeR) ?? pose.gaze;
  const gaze = (side === 'L' ? opts.gazeL : opts.gazeR) ?? opts.gaze ?? poseGaze;
  const lid = Math.max((side === 'L' ? pose.lidL : pose.lidR) ?? pose.lid ?? 0, blink);
  const scale = (side === 'L' ? pose.eyeScaleL : pose.eyeScaleR) ?? 1;
  return { shape, gaze, lid, scale };
}

/**
 * Build every named part of the mascot for a state. `buildMascotNodes` composes them into
 * the render tree; the Lottie generator and the Rive master read them part by part.
 */
export function buildMascotParts(state: MascotState, opts: MascotRenderOptions = {}): MascotParts {
  const theme = opts.theme ?? 'light';
  const pose = MASCOT_POSES[state];
  const detail: MascotDetail = (opts.size ?? 96) < 40 ? 'icon' : 'full';
  const tint =
    opts.tint ??
    mascotTint({ state, theme, courseFamily: opts.courseFamily, trackId: opts.trackId });
  const colors = mascotColors(MASCOT_PALETTE[theme], tint);
  const blink = clamp(opts.blink ?? 0, 0, 1);
  const breath = clamp(opts.breath ?? 0, -1, 1);
  const tailCurl = clamp(opts.tailCurl ?? 1, 0, 1);

  const eyeL = eyeParamsFor(pose, 'L', opts, blink);
  const eyeR = eyeParamsFor(pose, 'R', opts, blink);
  const partsL = eyeParts(colors, EYE_L, eyeL, detail);
  const partsR = eyeParts(colors, EYE_R, eyeR, detail);
  const arms = detail === 'full' ? armsNodes(colors, pose.arms) : { left: [], right: [] };
  const props = propNodes(colors, pose.prop, detail);

  return {
    state,
    pose,
    detail,
    colors,
    tint,
    nodes: {
      propsBehind: props.behind,
      tail: tailNodes(colors, pose.tail, tailCurl, detail),
      crest: crestNodes(colors, detail),
      feet: detail === 'full' ? feetNodes(colors) : [],
      body: bodyNodes(colors, detail),
      bands: detail === 'full' ? bandNodes(colors) : [],
      armL: arms.left,
      armR: arms.right,
      cheeks: pose.cheeks && detail === 'full' ? cheekNodes(colors) : [],
      mouth: mouthNodes(colors, pose.mouth, pose.mouthDx ?? 0),
      turretL: partsL.turret,
      pupilL: partsL.pupil,
      lidL: partsL.lid,
      turretR: partsR.turret,
      pupilR: partsR.pupil,
      lidR: partsR.lid,
      propsFront: props.front,
    },
    figure: {
      tilt: pose.tilt + (opts.headTilt ?? 0),
      breath,
      scaleX: 1 + 0.02 * breath,
      scaleY: 1 - 0.015 * breath,
    },
    eyes: {
      left: { ...eyeL, radius: partsL.radius },
      right: { ...eyeR, radius: partsR.radius },
    },
  };
}

/** SVG transform string of the figure group (tilt about the centre, breath about the feet). */
export function figureTransform(f: MascotParts['figure']): string | undefined {
  const [tx, ty] = MASCOT_PIVOT.tilt;
  const [bx, by] = MASCOT_PIVOT.breath;
  const parts: string[] = [];
  if (f.tilt !== 0)
    parts.push(`translate(${tx},${ty}) rotate(${fmt(f.tilt)}) translate(${-tx},${-ty})`);
  if (f.breath !== 0)
    parts.push(
      `translate(${bx},${by}) scale(${fmt(f.scaleX)},${fmt(f.scaleY)}) translate(${-bx},${-by})`,
    );
  return parts.length > 0 ? parts.join(' ') : undefined;
}

const FIGURE_PARTS: readonly MascotPartId[] = MASCOT_PART_IDS.filter(
  (id) => id !== 'propsBehind' && id !== 'propsFront',
);

/**
 * Build the mascot's node tree for a state. Both renderers call this.
 * @param state contract mascot state
 * @param opts theme, size (detail level), tint/course and optional animation phases
 */
export function buildMascotNodes(state: MascotState, opts: MascotRenderOptions = {}): SvgNode[] {
  const parts = buildMascotParts(state, opts);
  const figureChildren = FIGURE_PARTS.flatMap((id) => parts.nodes[id]);
  const transform = figureTransform(parts.figure);
  const figure = g(transform ? { transform } : {}, figureChildren);
  return [...parts.nodes.propsBehind, figure, ...parts.nodes.propsFront];
}

/** Full document description for a state (used by both renderers and tests). */
export function buildMascotDocument(
  state: MascotState,
  opts: MascotRenderOptions = {},
): SvgDocument {
  const size = opts.size ?? 96;
  return {
    viewBox: MASCOT_VIEWBOX,
    width: size,
    height: size,
    label: MASCOT_ACCESSIBILITY_LABELS[state],
    children: buildMascotNodes(state, opts),
  };
}

/**
 * Standalone `<svg>` markup for the mascot in a given state (web, admin, static exports).
 * @example mascotSvgString('listening', { size: 64, theme: 'dark', trackId: 'arabic-moroccan' })
 */
export function mascotSvgString(
  state: MascotState,
  opts: {
    size?: number;
    theme?: ArtTheme;
    tint?: MascotTint;
    trackId?: string | null;
    courseFamily?: CourseFamilyId | string | null;
  } = {},
): string {
  return toSvgString(
    buildMascotDocument(state, {
      size: opts.size,
      theme: opts.theme,
      tint: opts.tint,
      trackId: opts.trackId,
      courseFamily: opts.courseFamily,
    }),
  );
}

/* ------------------------------------------------------------- master --- */

const ALL_MOUTHS: readonly MouthShape[] = [
  'smile',
  'small',
  'tiny',
  'grin',
  'open',
  'o',
  'line',
  'wavy',
];
const ALL_PROPS: readonly PropKind[] = [
  'sparkle',
  'soundIn',
  'soundOut',
  'thoughtBubbles',
  'replayArrow',
  'confetti',
  'starMedal',
  'headphones',
  'zzz',
  'cloudSlash',
  'brokenLink',
  'checkBadge',
  'lightbulb',
];
const ALL_ARMS: readonly ArmPose[] = [
  'down',
  'up',
  'wave',
  'ear',
  'chin',
  'point',
  'clasp',
  'thumbs',
  'hug',
  'out',
  'gesture',
];

/**
 * Layered master for Rive import (`assets/mascot/master-rive.svg`): the neutral pose with one
 * `<g id="…">` per part (ids = `MASCOT_PART_IDS`), closed lids at opacity 0, plus hidden
 * libraries of every mouth, arm pose and prop so the rig can swap shapes instead of morphing.
 * See `docs/design/mascot-rive-spec.md`.
 */
export function mascotMasterSvgString(theme: ArtTheme = 'light', size = 512): string {
  const parts = buildMascotParts('neutral', { theme, size });
  const c = parts.colors;
  const children: SvgNode[] = [];
  for (const id of MASCOT_PART_IDS) {
    if (id === 'propsBehind' || id === 'propsFront') continue;
    let nodes = parts.nodes[id];
    if (id === 'lidL') nodes = [lidChord(c, EYE_L[0], EYE_L[1], parts.eyes.left.radius, 1)];
    if (id === 'lidR') nodes = [lidChord(c, EYE_R[0], EYE_R[1], parts.eyes.right.radius, 1)];
    const attrs: Record<string, string | number> = { id };
    if (id === 'lidL' || id === 'lidR') attrs.opacity = 0;
    children.push(g(attrs, nodes));
  }
  children.push(
    g(
      { id: 'library-mouths', opacity: 0 },
      ALL_MOUTHS.map((m) => g({ id: `mouth-${m}` }, mouthNodes(c, m))),
    ),
    g(
      { id: 'library-arms', opacity: 0 },
      ALL_ARMS.flatMap((a) => {
        const arms = armsNodes(c, a);
        return [g({ id: `armL-${a}` }, arms.left), g({ id: `armR-${a}` }, arms.right)];
      }),
    ),
    g(
      { id: 'library-props', opacity: 0 },
      ALL_PROPS.map((p) => {
        const nodes = propNodes(c, p, 'full');
        return g({ id: `prop-${p}` }, [...nodes.behind, ...nodes.front]);
      }),
    ),
  );
  return toSvgString({
    viewBox: MASCOT_VIEWBOX,
    width: size,
    height: size,
    label: `${MASCOT_NAME} mascot, layered master for rigging`,
    children,
  });
}
