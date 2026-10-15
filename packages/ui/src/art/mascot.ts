/**
 * The LangQuest mascot — an original floating "orbit-creature" (provisional
 * working name: Orbi). Soft rounded body, two expressive eyes, tiny limbs and a
 * distinctive asymmetric ribbon tail trailing from the lower-right of the body.
 *
 * The geometry lives here as renderer-agnostic {@link SvgNode}s so the React
 * Native component (`./native.tsx`) and the standalone string renderer share
 * one source of truth. Every one of the 17 contract states is expressed through
 * eye shape, brows, mouth, limb pose, ribbon motion and a small prop.
 *
 * Coordinate space: 100 × 100 viewBox. Body centre (50, 56).
 */
import { MASCOT_STATE_VALUES, type MascotState } from '@langquest/contracts';
import { type ArtTheme, MASCOT_PALETTE, type MascotPalette } from './palette';
import {
  type SvgAttrValue,
  type SvgDocument,
  type SvgNode,
  circle,
  ellipse,
  fmt,
  g,
  line,
  path,
  pebble,
  polygon,
  polyline,
  rect,
  roundedRect,
  starPoints,
  stroke,
  toSvgString,
} from './svg-node';

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

export type EyeShape = 'open' | 'wide' | 'happy' | 'closed' | 'half' | 'soft';
export type MouthShape = 'smile' | 'small' | 'grin' | 'open' | 'o' | 'line' | 'wavy' | 'tiny';
export type ArmPose =
  'down' | 'up' | 'wave' | 'ear' | 'chin' | 'point' | 'clasp' | 'thumbs' | 'tucked' | 'out';
export type BrowShape =
  'none' | 'relaxed' | 'raised' | 'raisedLeft' | 'raisedRight' | 'worried' | 'low';
export type PropKind =
  | 'none'
  | 'sparkle'
  | 'soundIn'
  | 'soundOut'
  | 'thoughtBubbles'
  | 'replayArrow'
  | 'confetti'
  | 'starMedal'
  | 'headphones'
  | 'zzz'
  | 'cloudSlash'
  | 'brokenLink'
  | 'checkBadge'
  | 'lightbulb';

/** Parametric description of one state — the "expression vocabulary" of the style guide. */
export interface MascotPose {
  eyes: EyeShape;
  /** Pupil offset in viewBox units (x, y). */
  gaze: readonly [number, number];
  /** Per-eye override: right eye closed/happy (wink). */
  wink?: boolean;
  brows: BrowShape;
  mouth: MouthShape;
  arms: ArmPose;
  /** Ribbon lift: -1 (drooping) .. 1 (lifted high). */
  tailLift: number;
  /** Ribbon curl amount 0..1. */
  tailCurl: number;
  /** Head/body tilt in degrees (positive = clockwise). */
  tilt: number;
  cheeks: boolean;
  prop: PropKind;
  /** Use the muted palette (offline / error). */
  muted?: boolean;
}

/** The expression vocabulary, one entry per contract state. */
export const MASCOT_POSES: Record<MascotState, MascotPose> = {
  neutral: {
    eyes: 'open',
    gaze: [0, 0],
    brows: 'relaxed',
    mouth: 'smile',
    arms: 'down',
    tailLift: 0.1,
    tailCurl: 0.5,
    tilt: 0,
    cheeks: false,
    prop: 'none',
  },
  welcome: {
    eyes: 'open',
    gaze: [0, -0.3],
    brows: 'raised',
    mouth: 'grin',
    arms: 'wave',
    tailLift: 0.6,
    tailCurl: 0.6,
    tilt: -4,
    cheeks: true,
    prop: 'sparkle',
  },
  happy: {
    eyes: 'happy',
    gaze: [0, 0],
    brows: 'none',
    mouth: 'grin',
    arms: 'out',
    tailLift: 0.5,
    tailCurl: 0.7,
    tilt: 0,
    cheeks: true,
    prop: 'none',
  },
  curious: {
    eyes: 'wide',
    gaze: [1.2, -0.8],
    brows: 'raisedRight',
    mouth: 'o',
    arms: 'down',
    tailLift: 0.3,
    tailCurl: 0.9,
    tilt: -9,
    cheeks: false,
    prop: 'sparkle',
  },
  listening: {
    eyes: 'open',
    gaze: [-1.4, 0],
    brows: 'raised',
    mouth: 'small',
    arms: 'ear',
    tailLift: 0.2,
    tailCurl: 0.4,
    tilt: 5,
    cheeks: false,
    prop: 'soundIn',
  },
  speaking: {
    eyes: 'open',
    gaze: [0, 0],
    brows: 'relaxed',
    mouth: 'open',
    arms: 'out',
    tailLift: -0.1,
    tailCurl: 0.5,
    tilt: 0,
    cheeks: false,
    prop: 'soundOut',
  },
  thinking: {
    eyes: 'half',
    gaze: [1.2, -1.2],
    brows: 'raisedLeft',
    mouth: 'line',
    arms: 'chin',
    tailLift: 0,
    tailCurl: 0.3,
    tilt: 3,
    cheeks: false,
    prop: 'thoughtBubbles',
  },
  encouraging: {
    eyes: 'open',
    gaze: [0, 0],
    wink: true,
    brows: 'raised',
    mouth: 'grin',
    arms: 'thumbs',
    tailLift: 0.7,
    tailCurl: 0.6,
    tilt: -3,
    cheeks: true,
    prop: 'sparkle',
  },
  try_again: {
    eyes: 'soft',
    gaze: [0, 0],
    brows: 'worried',
    mouth: 'smile',
    arms: 'clasp',
    tailLift: 0.1,
    tailCurl: 0.5,
    tilt: 4,
    cheeks: false,
    prop: 'replayArrow',
  },
  celebrate: {
    eyes: 'happy',
    gaze: [0, 0],
    brows: 'none',
    mouth: 'grin',
    arms: 'up',
    tailLift: 1,
    tailCurl: 1,
    tilt: 0,
    cheeks: true,
    prop: 'confetti',
  },
  achievement: {
    eyes: 'wide',
    gaze: [0, -1],
    brows: 'raised',
    mouth: 'grin',
    arms: 'up',
    tailLift: 0.9,
    tailCurl: 0.8,
    tilt: 0,
    cheeks: true,
    prop: 'starMedal',
  },
  quiet_audio: {
    eyes: 'half',
    gaze: [0, 0.4],
    brows: 'relaxed',
    mouth: 'small',
    arms: 'down',
    tailLift: -0.2,
    tailCurl: 0.5,
    tilt: 0,
    cheeks: false,
    prop: 'headphones',
  },
  sleep: {
    eyes: 'closed',
    gaze: [0, 0],
    brows: 'none',
    mouth: 'tiny',
    arms: 'tucked',
    tailLift: -0.8,
    tailCurl: 0.2,
    tilt: 6,
    cheeks: false,
    prop: 'zzz',
  },
  offline: {
    eyes: 'open',
    gaze: [0, 0.6],
    brows: 'worried',
    mouth: 'line',
    arms: 'down',
    tailLift: -0.5,
    tailCurl: 0.3,
    tilt: 0,
    cheeks: false,
    prop: 'cloudSlash',
    muted: true,
  },
  connection_error: {
    eyes: 'open',
    gaze: [0.6, -0.4],
    brows: 'worried',
    mouth: 'wavy',
    arms: 'out',
    tailLift: -0.3,
    tailCurl: 0.3,
    tilt: -3,
    cheeks: false,
    prop: 'brokenLink',
    muted: true,
  },
  success: {
    eyes: 'happy',
    gaze: [0, 0],
    brows: 'none',
    mouth: 'smile',
    arms: 'thumbs',
    tailLift: 0.6,
    tailCurl: 0.7,
    tilt: 0,
    cheeks: true,
    prop: 'checkBadge',
  },
  gentle_hint: {
    eyes: 'open',
    gaze: [-1, -0.6],
    brows: 'raisedLeft',
    mouth: 'small',
    arms: 'point',
    tailLift: 0.3,
    tailCurl: 0.6,
    tilt: -5,
    cheeks: false,
    prop: 'lightbulb',
  },
};

export interface MascotRenderOptions {
  theme?: ArtTheme;
  /** Render size in dp/px — below 40 the "icon" detail level drops fine features. */
  size?: number;
  /** 0 = eyes open, 1 = fully closed. Animation hook; static renders use 0. */
  blink?: number;
  /** -1..1 breathing phase. Animation hook; static renders use 0. */
  breath?: number;
}

export const MASCOT_VIEWBOX = { x: 0, y: 0, width: 100, height: 100 } as const;
const CX = 50;
const CY = 56;
const RX = 26;
const RY = 24;
const EYE_L: readonly [number, number] = [41, 50];
const EYE_R: readonly [number, number] = [59, 50];

/* ---------------------------------------------------------------- tail --- */

function ribbonTail(
  p: MascotPalette,
  lift: number,
  curl: number,
  detail: 'icon' | 'full',
): SvgNode {
  // Attached at the lower-right of the body; sweeps outward with a tapered end.
  const sx = 70;
  const sy = 66;
  const mx = 84;
  const my = 70 - lift * 14;
  const ex = 93;
  const ey = 62 - lift * 24;
  const c1 = [78, 73 - lift * 4] as const;
  const c2 = [86, 76 - lift * 16] as const;
  const c3 = [90, 70 - lift * 20] as const;
  const c4 = [94, 68 - lift * 24] as const;
  // Curl: a short hook back from the end point.
  const curlEnd = [ex - 6 * curl, ey - 7 * curl + (lift < 0 ? 3 : 0)] as const;
  const curlC1 = [ex + 3, ey - 6 * curl] as const;
  const curlC2 = [ex - 1, ey - 9 * curl] as const;
  const thick = `M${sx},${sy} C${fmt(c1[0])},${fmt(c1[1])} ${fmt(c2[0])},${fmt(c2[1])} ${mx},${fmt(my)}`;
  const thin = `M${mx},${fmt(my)} C${fmt(c3[0])},${fmt(c3[1])} ${fmt(c4[0])},${fmt(c4[1])} ${ex},${fmt(ey)}`;
  const tip = `M${ex},${fmt(ey)} C${fmt(curlC1[0])},${fmt(curlC1[1])} ${fmt(curlC2[0])},${fmt(curlC2[1])} ${fmt(curlEnd[0])},${fmt(curlEnd[1])}`;
  const outlineW = detail === 'icon' ? 2.4 : 2;
  const children: SvgNode[] = [
    // outline pass (drawn first, slightly wider) keeps the silhouette crisp in grayscale
    path(thick, stroke(p.outline, 9 + outlineW)),
    path(thin, stroke(p.outline, 5.5 + outlineW)),
    path(tip, stroke(p.outline, 3.2 + outlineW)),
    path(thick, stroke(p.ribbon, 9)),
    path(thin, stroke(p.ribbon, 5.5)),
    path(tip, stroke(p.ribbon, 3.2)),
  ];
  if (detail === 'full') {
    children.push(
      path(
        thick,
        stroke(p.ribbonShade, 2.4, { strokeOpacity: 0.55, transform: 'translate(0.6,2.2)' }),
      ),
    );
  }
  return g({}, children);
}

/* ---------------------------------------------------------------- body --- */

function body(p: MascotPalette, detail: 'icon' | 'full', muted: boolean): SvgNode[] {
  const bodyFill = muted ? p.mutedFill : p.body;
  const nodes: SvgNode[] = [
    path(pebble(CX, CY, RX, RY, 0.92, 1), { fill: bodyFill, stroke: p.outline, strokeWidth: 2.2 }),
  ];
  if (detail === 'full') {
    nodes.push(
      // lower shade crescent
      path(
        `M${CX - RX + 4},${CY + 8} C${CX - 10},${CY + RY + 2} ${CX + 12},${CY + RY + 2} ${CX + RX - 4},${CY + 6} C${CX + 14},${CY + RY - 3} ${CX - 14},${CY + RY - 3} ${CX - RX + 4},${CY + 8}Z`,
        {
          fill: muted ? p.muted : p.bodyShade,
          fillOpacity: 0.35,
        },
      ),
      // belly
      ellipse(CX, CY + 9, 14, 9.5, { fill: p.belly, fillOpacity: muted ? 0.55 : 0.9 }),
      // top-left highlight
      ellipse(CX - 11, CY - 15, 6.5, 3.4, {
        fill: p.highlight,
        fillOpacity: 0.4,
        transform: `rotate(-25 ${CX - 11} ${CY - 15})`,
      }),
      // foot nubs
      ellipse(CX - 8, CY + RY - 1, 4.2, 2.6, {
        fill: muted ? p.mutedFill : p.body,
        stroke: p.outline,
        strokeWidth: 1.6,
      }),
      ellipse(CX + 8, CY + RY - 1, 4.2, 2.6, {
        fill: muted ? p.mutedFill : p.body,
        stroke: p.outline,
        strokeWidth: 1.6,
      }),
    );
  } else {
    nodes.push(ellipse(CX, CY + 9, 13, 9, { fill: p.belly, fillOpacity: muted ? 0.5 : 0.85 }));
  }
  return nodes;
}

/* ---------------------------------------------------------------- arms --- */

function arm(
  p: MascotPalette,
  from: readonly [number, number],
  via: readonly [number, number],
  to: readonly [number, number],
  muted: boolean,
): SvgNode {
  const d = `M${fmt(from[0])},${fmt(from[1])} Q${fmt(via[0])},${fmt(via[1])} ${fmt(to[0])},${fmt(to[1])}`;
  const limb = muted ? p.muted : p.limb;
  return g({}, [
    path(d, stroke(p.outline, 7.2)),
    path(d, stroke(limb, 4.6)),
    circle(to[0], to[1], 3.6, { fill: limb, stroke: p.outline, strokeWidth: 1.8 }),
  ]);
}

function arms(p: MascotPalette, pose: ArmPose, muted: boolean): SvgNode[] {
  const L: readonly [number, number] = [27, 60];
  const R: readonly [number, number] = [73, 60];
  switch (pose) {
    case 'down':
      return [arm(p, L, [22, 66], [23, 72], muted), arm(p, R, [78, 66], [77, 72], muted)];
    case 'out':
      return [arm(p, L, [18, 60], [15, 66], muted), arm(p, R, [82, 60], [85, 66], muted)];
    case 'up':
      return [arm(p, L, [18, 52], [17, 40], muted), arm(p, R, [82, 52], [83, 40], muted)];
    case 'wave':
      return [arm(p, L, [22, 66], [23, 72], muted), arm(p, R, [84, 54], [86, 42], muted)];
    case 'ear':
      return [arm(p, L, [22, 66], [23, 72], muted), arm(p, R, [82, 54], [72, 46], muted)];
    case 'chin':
      return [arm(p, L, [22, 66], [23, 72], muted), arm(p, R, [76, 70], [58, 68], muted)];
    case 'point':
      return [arm(p, L, [16, 50], [12, 36], muted), arm(p, R, [78, 66], [77, 72], muted)];
    case 'clasp':
      return [arm(p, L, [28, 74], [45, 74], muted), arm(p, R, [72, 74], [55, 74], muted)];
    case 'thumbs':
      return [
        arm(p, L, [22, 66], [23, 72], muted),
        g({}, [
          arm(p, R, [84, 56], [84, 44], muted),
          // thumb nub
          path('M84,41.5 l0,-4', stroke(p.outline, 4.4)),
          path('M84,41.5 l0,-4', stroke(muted ? p.muted : p.limb, 2.2)),
        ]),
      ];
    case 'tucked':
      return [arm(p, L, [28, 70], [36, 72], muted), arm(p, R, [72, 70], [64, 72], muted)];
    default:
      return [];
  }
}

/* ---------------------------------------------------------------- face --- */

function eye(
  p: MascotPalette,
  c: readonly [number, number],
  shape: EyeShape,
  gaze: readonly [number, number],
  blink: number,
  detail: 'icon' | 'full',
  lidFill: string,
): SvgNode {
  const [cx, cy] = c;
  const r = shape === 'wide' ? 7.4 : shape === 'soft' ? 6.2 : 6.6;
  const w = detail === 'icon' ? 2 : 1.8;
  if (shape === 'happy') {
    return path(
      `M${fmt(cx - 5.5)},${cy + 1.5} Q${cx},${cy - 6.5} ${fmt(cx + 5.5)},${cy + 1.5}`,
      stroke(p.pupil, 2.8),
    );
  }
  if (shape === 'closed') {
    return path(
      `M${fmt(cx - 5)},${cy} Q${cx},${cy + 4} ${fmt(cx + 5)},${cy}`,
      stroke(p.pupil, 2.6),
    );
  }
  const pupilR = shape === 'wide' ? 2.9 : 3.3;
  const px = cx + gaze[0];
  const py = cy + gaze[1];
  const closure = Math.max(blink, shape === 'half' ? 0.45 : shape === 'soft' ? 0.2 : 0);
  const inner: SvgNode[] = [
    circle(cx, cy, r, { fill: p.eyeWhite, stroke: p.outline, strokeWidth: w }),
    circle(px, py, pupilR, { fill: p.pupil }),
  ];
  if (detail === 'full') inner.push(circle(px - 1.1, py - 1.2, 1.1, { fill: p.highlight }));
  if (closure > 0) {
    // eyelid in body colour, cut as a chord over the top of the eye
    const lidY = cy - r + 2 * r * closure;
    inner.push(
      path(
        `M${fmt(cx - r - 1)},${fmt(cy - r - 1)} H${fmt(cx + r + 1)} V${fmt(lidY)} H${fmt(cx - r - 1)}Z`,
        { fill: lidFill, stroke: 'none' },
      ),
    );
    inner.push(line(cx - r, lidY, cx + r, lidY, stroke(p.outline, w)));
  }
  return g({}, inner);
}

function brows(p: MascotPalette, shape: BrowShape, detail: 'icon' | 'full'): SvgNode[] {
  if (shape === 'none' || detail === 'icon') return [];
  const s = stroke(p.outline, 2);
  const [lx, ly] = EYE_L;
  const [rx, ry] = EYE_R;
  const y = ly - 9.5;
  switch (shape) {
    case 'relaxed':
      return [
        path(`M${lx - 4},${y + 0.5} Q${lx},${y - 1} ${lx + 4},${y}`, s),
        path(`M${rx - 4},${ry - 9.5} Q${rx},${y - 1} ${rx + 4},${y + 0.5}`, s),
      ];
    case 'raised':
      return [
        path(`M${lx - 4},${y - 1} Q${lx},${y - 4} ${lx + 4},${y - 2}`, s),
        path(`M${rx - 4},${y - 2} Q${rx},${y - 4} ${rx + 4},${y - 1}`, s),
      ];
    case 'raisedLeft':
      return [
        path(`M${lx - 4},${y - 2} Q${lx},${y - 5} ${lx + 4},${y - 3}`, s),
        path(`M${rx - 4},${y + 1} Q${rx},${y} ${rx + 4},${y + 1}`, s),
      ];
    case 'raisedRight':
      return [
        path(`M${lx - 4},${y + 1} Q${lx},${y} ${lx + 4},${y + 1}`, s),
        path(`M${rx - 4},${y - 3} Q${rx},${y - 5} ${rx + 4},${y - 2}`, s),
      ];
    case 'worried':
      return [
        path(`M${lx - 4},${y + 1} Q${lx},${y - 2.5} ${lx + 4},${y - 2}`, s),
        path(`M${rx - 4},${y - 2} Q${rx},${y - 2.5} ${rx + 4},${y + 1}`, s),
      ];
    case 'low':
      return [
        path(`M${lx - 4},${y + 2} L${lx + 4},${y + 3}`, s),
        path(`M${rx - 4},${y + 3} L${rx + 4},${y + 2}`, s),
      ];
    default:
      return [];
  }
}

function mouth(p: MascotPalette, shape: MouthShape): SvgNode[] {
  const mx = 50;
  const my = 63.5;
  const s = stroke(p.mouth, 2.2);
  switch (shape) {
    case 'smile':
      return [path(`M${mx - 6},${my - 1} Q${mx},${my + 5} ${mx + 6},${my - 1}`, s)];
    case 'small':
      return [path(`M${mx - 3.5},${my} Q${mx},${my + 3} ${mx + 3.5},${my}`, s)];
    case 'tiny':
      return [path(`M${mx - 2},${my + 1} Q${mx},${my + 2.5} ${mx + 2},${my + 1}`, s)];
    case 'grin':
      return [
        path(
          `M${mx - 8},${my - 2} Q${mx},${my + 11} ${mx + 8},${my - 2} Q${mx},${my + 1} ${mx - 8},${my - 2}Z`,
          { fill: p.mouth },
        ),
        path(
          `M${mx - 4},${my + 3.2} Q${mx},${my + 7.5} ${mx + 4},${my + 3.2} Q${mx},${my + 4.5} ${mx - 4},${my + 3.2}Z`,
          { fill: p.tongue },
        ),
      ];
    case 'open':
      return [
        path(roundedRect(mx - 4.5, my - 2, 9, 8, [4, 4, 4.5, 4.5]), { fill: p.mouth }),
        ellipse(mx, my + 4.6, 3, 1.6, { fill: p.tongue }),
      ];
    case 'o':
      return [ellipse(mx, my + 1, 2.8, 3.4, { fill: p.mouth })];
    case 'line':
      return [line(mx - 4, my + 1, mx + 4, my + 1, s)];
    case 'wavy':
      return [path(`M${mx - 6},${my + 1} q3,-3 6,0 t6,0`, s)];
    default:
      return [];
  }
}

function cheeks(p: MascotPalette): SvgNode[] {
  return [
    ellipse(35.5, 58, 4, 2.4, { fill: p.cheek, fillOpacity: 0.8 }),
    ellipse(64.5, 58, 4, 2.4, { fill: p.cheek, fillOpacity: 0.8 }),
  ];
}

/* --------------------------------------------------------------- props --- */

function sparkle(p: MascotPalette, cx: number, cy: number, r: number): SvgNode {
  const d = `M${cx},${fmt(cy - r)} Q${cx},${cy} ${fmt(cx + r)},${cy} Q${cx},${cy} ${cx},${fmt(cy + r)} Q${cx},${cy} ${fmt(cx - r)},${cy} Q${cx},${cy} ${cx},${fmt(cy - r)}Z`;
  return path(d, { fill: p.accent, stroke: p.outline, strokeWidth: 1.2, strokeLinejoin: 'round' });
}

function props(p: MascotPalette, kind: PropKind, detail: 'icon' | 'full'): SvgNode[] {
  const s = (w: number): Record<string, SvgAttrValue> => stroke(p.prop, w);
  switch (kind) {
    case 'none':
      return [];
    case 'sparkle':
      return detail === 'icon' ? [] : [sparkle(p, 84, 26, 5), sparkle(p, 90, 38, 2.6)];
    case 'soundIn':
      return [
        path('M20,44 A11,11 0 0 1 20,60', s(2.4)),
        path('M13,39 A17,17 0 0 1 13,65', s(2.2)),
        ...(detail === 'icon' ? [] : [path('M7,34 A22,22 0 0 1 7,70', s(2))]),
      ];
    case 'soundOut':
      return [
        path('M82,48 A9,9 0 0 1 82,62', s(2.4)),
        path('M88,43 A15,15 0 0 1 88,67', s(2.2)),
        ...(detail === 'icon' ? [] : [path('M94,38 A21,21 0 0 1 94,72', s(2))]),
      ];
    case 'thoughtBubbles':
      return [
        circle(74, 30, 2.2, { fill: p.propFill, stroke: p.prop, strokeWidth: 1.6 }),
        circle(80, 22, 3.2, { fill: p.propFill, stroke: p.prop, strokeWidth: 1.6 }),
        circle(89, 13, 5, { fill: p.propFill, stroke: p.prop, strokeWidth: 1.8 }),
      ];
    case 'replayArrow':
      return [
        path('M90,26 A8,8 0 1 1 82,18', s(2.6)),
        polygon(
          [
            [80, 13],
            [88, 18],
            [80, 23],
          ],
          { fill: p.prop },
        ),
      ];
    case 'confetti': {
      const bits: SvgNode[] = [
        rect(10, 20, 4, 7, { fill: p.ribbon, transform: 'rotate(20 12 23)' }),
        rect(86, 18, 4, 7, { fill: p.accent, transform: 'rotate(-30 88 21)' }),
        rect(90, 56, 3.5, 6, { fill: p.body, transform: 'rotate(40 92 59)' }),
        circle(20, 36, 2.4, { fill: p.accent }),
        circle(82, 42, 2.2, { fill: p.ribbon }),
        circle(8, 56, 2, { fill: p.body }),
      ];
      if (detail === 'full') {
        bits.push(
          polygon(starPoints(26, 20, 4.5, 2, 5), {
            fill: p.accent,
            stroke: p.outline,
            strokeWidth: 1,
          }),
          polygon(starPoints(74, 12, 4, 1.8, 5), {
            fill: p.ribbon,
            stroke: p.outline,
            strokeWidth: 1,
          }),
          rect(24, 84, 4, 6, { fill: p.accent, transform: 'rotate(15 26 87)' }),
          rect(76, 86, 4, 6, { fill: p.body, transform: 'rotate(-25 78 89)' }),
        );
      }
      return bits;
    }
    case 'starMedal':
      return [
        // ribbon strips
        polygon(
          [
            [44, 22],
            [50, 24],
            [45, 32],
            [39, 30],
          ],
          { fill: p.ribbon, stroke: p.outline, strokeWidth: 1.2 },
        ),
        polygon(
          [
            [56, 22],
            [50, 24],
            [55, 32],
            [61, 30],
          ],
          { fill: p.ribbon, stroke: p.outline, strokeWidth: 1.2 },
        ),
        polygon(starPoints(50, 17, 10, 4.6, 5), {
          fill: p.accent,
          stroke: p.outline,
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
      ];
    case 'headphones':
      return [
        path('M24,54 C24,26 76,26 76,54', s(4.4)),
        path(roundedRect(18, 46, 10, 15, 4), { fill: p.propFill, stroke: p.prop, strokeWidth: 2 }),
        path(roundedRect(72, 46, 10, 15, 4), { fill: p.propFill, stroke: p.prop, strokeWidth: 2 }),
      ];
    case 'zzz': {
      const z = (x: number, y: number, w: number): SvgNode =>
        polyline(
          [
            [x, y],
            [x + w, y],
            [x, y + w],
            [x + w, y + w],
          ],
          stroke(p.sleepy, Math.max(1.8, w / 2.6)),
        );
      return [z(68, 32, 5), z(76, 22, 7), z(86, 8, 9)];
    }
    case 'cloudSlash':
      return [
        path('M70,30 a7,7 0 0 1 13,-3 a6,6 0 0 1 9,6 a5,5 0 0 1 -1,9 H70 a6,6 0 0 1 0,-12Z', {
          fill: p.propFill,
          stroke: p.prop,
          strokeWidth: 2,
          strokeLinejoin: 'round',
        }),
        line(68, 44, 96, 20, { ...s(2.6), stroke: p.danger }),
      ];
    case 'brokenLink':
      return [
        path(roundedRect(64, 20, 12, 7, 3.5), { ...s(2.2), transform: 'rotate(-40 70 23.5)' }),
        path(roundedRect(80, 10, 12, 7, 3.5), { ...s(2.2), transform: 'rotate(-40 86 13.5)' }),
        polyline(
          [
            [76, 16],
            [78, 12],
            [80, 16],
            [82, 11],
          ],
          { ...s(1.8), stroke: p.danger },
        ),
      ];
    case 'checkBadge':
      return [
        circle(84, 24, 9.5, { fill: p.accent, stroke: p.outline, strokeWidth: 1.8 }),
        polyline(
          [
            [79, 24.5],
            [82.5, 28],
            [89.5, 20],
          ],
          stroke(p.outline, 2.6),
        ),
      ];
    case 'lightbulb':
      return [
        circle(16, 22, 7.5, { fill: p.accent, stroke: p.prop, strokeWidth: 2 }),
        path(roundedRect(12.5, 29, 7, 5, [0, 0, 2, 2]), {
          fill: p.propFill,
          stroke: p.prop,
          strokeWidth: 1.8,
        }),
        ...(detail === 'icon'
          ? []
          : [
              line(16, 8, 16, 11, s(2)),
              line(5, 13, 7.5, 15, s(2)),
              line(27, 13, 24.5, 15, s(2)),
              line(3, 24, 6, 24, s(2)),
              line(29, 24, 26, 24, s(2)),
            ]),
      ];
    default:
      return [];
  }
}

/* --------------------------------------------------------------- build --- */

/**
 * Build the mascot's node tree for a state. Both renderers call this.
 * @param state contract mascot state
 * @param opts theme, size (detail level) and optional animation phases
 */
export function buildMascotNodes(state: MascotState, opts: MascotRenderOptions = {}): SvgNode[] {
  const theme = opts.theme ?? 'light';
  const p = MASCOT_PALETTE[theme];
  const pose = MASCOT_POSES[state];
  const detail: 'icon' | 'full' = (opts.size ?? 96) < 40 ? 'icon' : 'full';
  const blink = Math.min(1, Math.max(0, opts.blink ?? 0));
  const breath = Math.min(1, Math.max(-1, opts.breath ?? 0));
  const muted = pose.muted === true;

  const face: SvgNode[] = [
    eye(p, EYE_L, pose.eyes, pose.gaze, blink, detail, muted ? p.mutedFill : p.body),
    eye(
      p,
      EYE_R,
      pose.wink ? 'happy' : pose.eyes,
      pose.gaze,
      blink,
      detail,
      muted ? p.mutedFill : p.body,
    ),
    ...brows(p, pose.brows, detail),
    ...mouth(p, pose.mouth),
    ...(pose.cheeks && detail === 'full' ? cheeks(p) : []),
  ];

  const creature: SvgNode[] = [
    ribbonTail(p, pose.tailLift, pose.tailCurl, detail),
    ...body(p, detail, muted),
    ...arms(p, pose.arms, muted),
    ...face,
  ];

  // Headphones sit over the body; everything else floats beside it.
  const propNodes = props(p, pose.prop, detail);
  const inner = pose.prop === 'headphones' ? [...creature, ...propNodes] : creature;

  const sx = 1 + 0.02 * breath;
  const sy = 1 - 0.015 * breath;
  const transform = `translate(${CX},${CY}) rotate(${fmt(pose.tilt)}) scale(${fmt(sx)},${fmt(sy)}) translate(${-CX},${-CY})`;
  const figure = g({ transform }, inner);
  return pose.prop === 'headphones' ? [figure] : [figure, ...propNodes];
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
 * @example mascotSvgString('listening', { size: 64, theme: 'dark' })
 */
export function mascotSvgString(
  state: MascotState,
  opts: { size?: number; theme?: ArtTheme } = {},
): string {
  return toSvgString(buildMascotDocument(state, { size: opts.size, theme: opts.theme }));
}
