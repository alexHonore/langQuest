/**
 * Melo's anatomy as renderer-agnostic {@link SvgNode} parts — the production port of
 * `design/explorations/mascots/M3/generator.js`. Every drawer returns plain nodes so the
 * React Native renderer, the string renderer, the Lottie generator and the Rive master
 * export all share one geometry.
 *
 * Figure space: 100 × 100. Crown y 18, eye axis y 42, mouth y 60, ground y 88.
 * The head IS the body (pear shape). Eye turrets Ø 22 at (33, 42) and (67, 42). The tail
 * is a tapered polygon (9 → 2.4 units) spiralling inward; it attaches lower-right.
 */
import type { MascotPalette } from '../palette';
import {
  type SvgNode,
  circle,
  ellipse,
  path,
  polygon,
  polyline,
  rect,
  roundedRect,
  stroke,
} from '../svg-node';
import type { MascotTint } from './tint';

export type MascotDetail = 'icon' | 'full';

/** Palette with the chameleon tint applied (body / shade / belly / crest swapped in). */
export interface MascotColors extends MascotPalette {
  /** True for network states: props use the muted tokens, cheeks fade. */
  isMuted: boolean;
}

export function mascotColors(palette: MascotPalette, tint: MascotTint): MascotColors {
  return {
    ...palette,
    body: tint.body,
    bodyShade: tint.bodyShade,
    belly: tint.belly,
    crest: tint.crest,
    crestShade: tint.crestShade,
    ribbon: tint.crest,
    ribbonShade: tint.crestShade,
    limb: tint.bodyShade,
    accent: tint.crest,
    cheek: tint.muted ? tint.belly : palette.cheek,
    isMuted: tint.muted,
  };
}

/* --------------------------------------------------------------- helpers --- */

type Pt = readonly [number, number];
const r1 = (n: number): number => Math.round(n * 10) / 10;
const norm = (v: Pt): [number, number] => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const bez2 = (p0: Pt, p1: Pt, p2: Pt, t: number): [number, number] => {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
};
const OUTLINE_W = 2.2;

/* ------------------------------------------------------------------ tail --- */

/** Tail description: an optional quadratic lead from the root, then an inward spiral. */
export interface TailSpec {
  /** Root point (hidden behind the body). */
  attach: Pt;
  /** Initial tangent direction. */
  startDir: Pt;
  /** Optional quadratic lead segment: control `c`, end `b` (spiral starts at `b`). */
  lead?: { c: Pt; b: Pt };
  /** Spiral start radius. */
  R: number;
  /** Spiral turns (1 = one full loop). */
  turns: number;
  /** +1 clockwise on screen, −1 counter-clockwise. */
  dir: 1 | -1;
  wStart?: number;
  wEnd?: number;
  /** Radius shrink over the spiral (0..1). */
  shrink?: number;
}

/** Centreline samples of the tail (used by the path builder and by the Rive bone spec). */
export function tailCentreline(spec: TailSpec, curl = 1): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let dirAtSpiral = norm(spec.startDir);
  let spiralStart: Pt = spec.attach;
  if (spec.lead) {
    const n = 14;
    for (let i = 0; i <= n; i += 1) pts.push(bez2(spec.attach, spec.lead.c, spec.lead.b, i / n));
    spiralStart = spec.lead.b;
    dirAtSpiral = norm([spec.lead.b[0] - spec.lead.c[0], spec.lead.b[1] - spec.lead.c[1]]);
  }
  const s = spec.dir;
  const turns = spec.turns * (0.35 + 0.65 * Math.min(1, Math.max(0, curl)));
  const R = spec.R * (0.8 + 0.2 * Math.min(1, Math.max(0, curl)));
  const shrink = spec.shrink ?? 0.8;
  const th0 = Math.atan2(-s * dirAtSpiral[0], s * dirAtSpiral[1]);
  const C: Pt = [spiralStart[0] - R * Math.cos(th0), spiralStart[1] - R * Math.sin(th0)];
  const n = Math.max(6, Math.round(44 * turns));
  const T = s * turns * Math.PI * 2;
  for (let i = spec.lead ? 1 : 0; i <= n; i += 1) {
    const t = i / n;
    const r = R * (1 - shrink * t);
    const th = th0 + T * t;
    pts.push([C[0] + r * Math.cos(th), C[1] + r * Math.sin(th)]);
  }
  return pts;
}

/** Tapered tail outline as one closed polygon path. */
export function tailPath(spec: TailSpec, curl = 1): string {
  const pts = tailCentreline(spec, curl);
  const wStart = spec.wStart ?? 9;
  const wEnd = spec.wEnd ?? 2.4;
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1] || 1;
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const tg = norm([b[0] - a[0], b[1] - a[1]]);
    const nrm = [-tg[1], tg[0]] as const;
    const f = cum[i]! / total;
    const w = (wStart * (1 - f) + wEnd * f) / 2;
    const p = pts[i]!;
    left.push([p[0] + nrm[0] * w, p[1] + nrm[1] * w]);
    right.push([p[0] - nrm[0] * w, p[1] - nrm[1] * w]);
  }
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  const tg = norm([last[0] - prev[0], last[1] - prev[1]]);
  const tip: Array<[number, number]> = [];
  for (let k = 1; k < 6; k += 1) {
    const ang = Math.atan2(tg[1], tg[0]) + Math.PI / 2 - (Math.PI * k) / 6;
    tip.push([last[0] + (wEnd / 2) * Math.cos(ang), last[1] + (wEnd / 2) * Math.sin(ang)]);
  }
  const poly = [...left, ...tip, ...right.reverse()];
  return `M${poly.map((p) => `${r1(p[0])},${r1(p[1])}`).join('L')}Z`;
}

export function tailNodes(
  c: MascotColors,
  spec: TailSpec,
  curl: number,
  detail: MascotDetail,
): SvgNode[] {
  return [
    path(tailPath(spec, curl), {
      fill: c.body,
      stroke: c.outline,
      strokeWidth: detail === 'icon' ? 3 : OUTLINE_W,
      strokeLinejoin: 'round',
    }),
  ];
}

/* ------------------------------------------------------------------ body --- */

export const BODY_FRONT =
  'M50,18 C63,18 73,28 73,40 C73,50 78,60 77,70 C76,82 64,88 50,88 C36,88 24,82 23,70 C22,60 27,50 27,40 C27,28 37,18 50,18 Z';
export const CREST_FRONT = 'M36,27 C38,6 62,6 64,27 Z';

export function crestNodes(c: MascotColors, detail: MascotDetail): SvgNode[] {
  return [
    path(CREST_FRONT, {
      fill: c.crest,
      stroke: c.outline,
      strokeWidth: detail === 'icon' ? 3 : OUTLINE_W,
      strokeLinejoin: 'round',
    }),
  ];
}

function footNodes(c: MascotColors, x: number, y: number): SvgNode[] {
  return [
    circle(x - 2.3, y, 3.9, { fill: c.outline }),
    circle(x + 2.3, y, 3.9, { fill: c.outline }),
    circle(x - 2.3, y, 2.4, { fill: c.bodyShade }),
    circle(x + 2.3, y, 2.4, { fill: c.bodyShade }),
  ];
}

export function feetNodes(c: MascotColors): SvgNode[] {
  return [...footNodes(c, 39, 87), ...footNodes(c, 61, 87)];
}

export function bodyNodes(c: MascotColors, detail: MascotDetail): SvgNode[] {
  const nodes: SvgNode[] = [
    path(BODY_FRONT, {
      fill: c.body,
      stroke: c.outline,
      strokeWidth: detail === 'icon' ? 3 : OUTLINE_W,
      strokeLinejoin: 'round',
    }),
  ];
  if (detail === 'full') {
    nodes.push(
      path('M27,66 C34,84 66,84 73,66 C66,80 34,80 27,66 Z', {
        fill: c.bodyShade,
        fillOpacity: 0.4,
      }),
    );
  }
  nodes.push(ellipse(50, 72, 15, 10, { fill: c.belly, fillOpacity: 0.92 }));
  return nodes;
}

/** Flank bands, dots and the top-left highlight (full detail only). */
export function bandNodes(c: MascotColors): SvgNode[] {
  const band = stroke(c.crest, 3.4, { strokeOpacity: 0.85 });
  return [
    path('M28.5,55 Q35,62 30,71', band),
    path('M71.5,55 Q65,62 70,71', band),
    circle(35, 77, 1.7, { fill: c.crest, fillOpacity: 0.75 }),
    circle(65, 77, 1.7, { fill: c.crest, fillOpacity: 0.75 }),
    ellipse(40, 27, 7, 3.2, {
      fill: c.highlight,
      fillOpacity: 0.35,
      transform: 'rotate(-28 40 27)',
    }),
  ];
}

/* ------------------------------------------------------------------ arms --- */

export type ArmPose =
  | 'down'
  | 'up'
  | 'wave'
  | 'ear'
  | 'chin'
  | 'point'
  | 'clasp'
  | 'thumbs'
  | 'tucked'
  | 'out'
  | 'gesture'
  | 'hug';

type ArmGeom = readonly [Pt, Pt, Pt];
const ARM_L_DOWN: ArmGeom = [
  [26, 63],
  [20, 70],
  [22, 77],
];
const ARM_R_DOWN: ArmGeom = [
  [74, 63],
  [80, 70],
  [78, 77],
];
const ARMS: Record<ArmPose, readonly [ArmGeom, ArmGeom]> = {
  down: [ARM_L_DOWN, ARM_R_DOWN],
  wave: [
    ARM_L_DOWN,
    [
      [74, 60],
      [85, 55],
      [86, 43],
    ],
  ],
  out: [
    [
      [26, 62],
      [15, 58],
      [11, 62],
    ],
    [
      [74, 62],
      [85, 58],
      [89, 62],
    ],
  ],
  chin: [
    ARM_L_DOWN,
    [
      [74, 63],
      [72, 72],
      [61, 67],
    ],
  ],
  clasp: [
    [
      [26, 64],
      [33, 78],
      [47, 75],
    ],
    [
      [74, 64],
      [67, 78],
      [53, 75],
    ],
  ],
  up: [
    [
      [26, 60],
      [15, 52],
      [16, 40],
    ],
    [
      [74, 60],
      [85, 52],
      [84, 40],
    ],
  ],
  gesture: [
    [
      [26, 62],
      [16, 60],
      [12, 66],
    ],
    [
      [74, 61],
      [86, 54],
      [92, 56],
    ],
  ],
  hug: [
    [
      [26, 64],
      [30, 74],
      [40, 73],
    ],
    [
      [74, 64],
      [70, 74],
      [60, 73],
    ],
  ],
  tucked: [
    [
      [26, 64],
      [30, 74],
      [40, 73],
    ],
    [
      [74, 64],
      [70, 74],
      [60, 73],
    ],
  ],
  thumbs: [
    ARM_L_DOWN,
    [
      [74, 60],
      [86, 57],
      [86, 46],
    ],
  ],
  point: [
    [
      [26, 60],
      [14, 52],
      [12, 40],
    ],
    ARM_R_DOWN,
  ],
  ear: [
    ARM_L_DOWN,
    [
      [74, 60],
      [85, 52],
      [79, 45],
    ],
  ],
};

function armNodes(c: MascotColors, [from, ctrl, to]: ArmGeom, thumb = false): SvgNode[] {
  const d = `M${from[0]},${from[1]} Q${ctrl[0]},${ctrl[1]} ${to[0]},${to[1]}`;
  const tg = norm([to[0] - ctrl[0], to[1] - ctrl[1]]);
  const n = [-tg[1], tg[0]] as const;
  const h1: Pt = [r1(to[0] + n[0] * 1.9), r1(to[1] + n[1] * 1.9)];
  const h2: Pt = [r1(to[0] - n[0] * 1.9), r1(to[1] - n[1] * 1.9)];
  const nodes: SvgNode[] = [
    path(d, stroke(c.outline, 7.6)),
    circle(h1[0], h1[1], 3.9, { fill: c.outline }),
    circle(h2[0], h2[1], 3.9, { fill: c.outline }),
  ];
  if (thumb) {
    const t = `M${to[0]},${to[1] - 2} L${to[0]},${r1(to[1] - 7)}`;
    nodes.push(path(t, stroke(c.outline, 6)));
  }
  nodes.push(
    path(d, stroke(c.bodyShade, 4.8)),
    circle(h1[0], h1[1], 2.6, { fill: c.bodyShade }),
    circle(h2[0], h2[1], 2.6, { fill: c.bodyShade }),
  );
  if (thumb)
    nodes.push(path(`M${to[0]},${to[1] - 2} L${to[0]},${r1(to[1] - 7)}`, stroke(c.bodyShade, 3.2)));
  return nodes;
}

export function armsNodes(c: MascotColors, pose: ArmPose): { left: SvgNode[]; right: SvgNode[] } {
  const [l, r] = ARMS[pose];
  return { left: armNodes(c, l), right: armNodes(c, r, pose === 'thumbs') };
}

/* ------------------------------------------------------------------ face --- */

export function cheekNodes(c: MascotColors): SvgNode[] {
  return [
    ellipse(35, 56, 4, 2.4, { fill: c.cheek, fillOpacity: 0.8 }),
    ellipse(65, 56, 4, 2.4, { fill: c.cheek, fillOpacity: 0.8 }),
  ];
}

export type MouthShape = 'smile' | 'small' | 'grin' | 'open' | 'o' | 'line' | 'wavy' | 'tiny';

export function mouthNodes(c: MascotColors, kind: MouthShape, dx = 0, cy = 60): SvgNode[] {
  const cx = 50 + dx;
  const w = 2.4;
  const s = stroke(c.outline, w);
  switch (kind) {
    case 'smile':
      return [path(`M${cx - 12},${cy - 2} Q${cx},${cy + 7} ${cx + 12},${cy - 2}`, s)];
    case 'small':
      return [path(`M${cx - 6},${cy - 1} Q${cx},${cy + 3.5} ${cx + 6},${cy - 1}`, s)];
    case 'tiny':
      return [path(`M${cx - 3},${cy} Q${cx},${cy + 2} ${cx + 3},${cy}`, s)];
    case 'grin':
      return [
        path(
          `M${cx - 13},${cy - 3} Q${cx},${cy + 12} ${cx + 13},${cy - 3} Q${cx},${cy + 2} ${cx - 13},${cy - 3} Z`,
          { fill: c.pupil, stroke: c.outline, strokeWidth: 2, strokeLinejoin: 'round' },
        ),
        path(`M${cx - 5},${cy + 2.2} Q${cx},${cy + 8.5} ${cx + 5},${cy + 2.2} Z`, {
          fill: c.tongue,
        }),
      ];
    case 'open':
      return [
        ellipse(cx, cy + 1.5, 6, 5.2, { fill: c.pupil, stroke: c.outline, strokeWidth: 2 }),
        ellipse(cx, cy + 4.2, 3.2, 1.9, { fill: c.tongue }),
      ];
    case 'o':
      return [circle(cx + 4, cy, 2.7, { fill: c.pupil, stroke: c.outline, strokeWidth: 1.6 })];
    case 'line':
      return [path(`M${cx - 8},${cy} L${cx + 8},${cy}`, s)];
    case 'wavy':
      return [
        path(
          `M${cx - 9},${cy} Q${cx - 4.5},${cy - 3} ${cx},${cy} Q${cx + 4.5},${cy + 3} ${cx + 9},${cy}`,
          s,
        ),
      ];
    default:
      return [];
  }
}

export type EyeShape = 'open' | 'wide' | 'happy' | 'closed' | 'half' | 'soft';

export interface EyeParams {
  shape: EyeShape;
  /** Pupil offset, −1..1 on each axis (× 3.2 units). */
  gaze: Pt;
  /** Lid closure 0..1 on top of the shape's own lid (`half` 0.45, `soft` 0.2). */
  lid: number;
  /** Turret scale (1.08 = the "leading" eye). */
  scale: number;
}

export interface EyeParts {
  /** Turret ring + eye white (or the shut/happy eye). */
  turret: SvgNode[];
  /** Pupil + highlight (empty for happy/closed). */
  pupil: SvgNode[];
  /** Lid chord (empty when fully open). */
  lid: SvgNode[];
  /** Eye white radius after shape scaling (for animation anchors). */
  radius: number;
}

export const EYE_L: Pt = [33, 42];
export const EYE_R: Pt = [67, 42];
export const EYE_TURRET_R = 11;

export function eyeParts(
  c: MascotColors,
  [cx, cy]: Pt,
  e: EyeParams,
  detail: MascotDetail,
): EyeParts {
  const rr = EYE_TURRET_R * e.scale;
  const ew = 8 * e.scale;
  const pr = 4.2 * e.scale;
  const ow = detail === 'icon' ? 3 : OUTLINE_W;
  const turret: SvgNode[] = [
    circle(cx, cy, r1(rr), { fill: c.bodyShade, stroke: c.outline, strokeWidth: ow }),
  ];
  if (detail === 'full')
    turret.push(
      circle(cx, cy, r1(rr - 1.9), {
        fill: 'none',
        stroke: c.belly,
        strokeOpacity: 0.45,
        strokeWidth: 1.2,
      }),
    );
  if (e.shape === 'happy') {
    turret.push(
      circle(cx, cy, r1(ew), { fill: c.body, stroke: c.outline, strokeWidth: 1.8 }),
      path(
        `M${r1(cx - 5.2 * e.scale)},${r1(cy + 1.6 * e.scale)} Q${cx},${r1(cy - 6 * e.scale)} ${r1(cx + 5.2 * e.scale)},${r1(cy + 1.6 * e.scale)}`,
        stroke(c.outline, 2.6),
      ),
    );
    return { turret, pupil: [], lid: [], radius: ew };
  }
  if (e.shape === 'closed') {
    turret.push(
      circle(cx, cy, r1(ew), { fill: c.body, stroke: c.outline, strokeWidth: 1.8 }),
      path(
        `M${r1(cx - 5 * e.scale)},${r1(cy - 1)} Q${cx},${r1(cy + 4 * e.scale)} ${r1(cx + 5 * e.scale)},${r1(cy - 1)}`,
        stroke(c.outline, 2.4),
      ),
    );
    return { turret, pupil: [], lid: [], radius: ew };
  }
  const wide = e.shape === 'wide' ? 1.12 : 1;
  const R = r1(ew * wide);
  turret.push(circle(cx, cy, R, { fill: c.eyeWhite, stroke: c.outline, strokeWidth: 1.8 }));
  const gx = Math.min(1, Math.max(-1, e.gaze[0]));
  const gy = Math.min(1, Math.max(-1, e.gaze[1]));
  const px = r1(cx + gx * 3.2 * e.scale);
  const py = r1(cy + gy * 3.2 * e.scale);
  const pupil: SvgNode[] = [circle(px, py, r1(pr * wide), { fill: c.pupil })];
  if (detail === 'full')
    pupil.push(
      circle(r1(px - 1.5 * e.scale), r1(py - 1.6 * e.scale), r1(1.5 * e.scale), {
        fill: c.eyeWhite,
      }),
    );
  const base = e.shape === 'half' ? 0.45 : e.shape === 'soft' ? 0.2 : 0;
  const closure = Math.min(1, Math.max(base, e.lid));
  const lid: SvgNode[] = [];
  if (closure > 0) lid.push(lidChord(c, cx, cy, R, closure));
  return { turret, pupil, lid, radius: R };
}

/** Eyelid: the chord of the eye-white circle covered from the top, in body-shade colour. */
export function lidChord(
  c: MascotColors,
  cx: number,
  cy: number,
  R: number,
  closure: number,
): SvgNode {
  const style = {
    fill: c.bodyShade,
    stroke: c.outline,
    strokeWidth: 1.8,
    strokeLinejoin: 'round',
  } as const;
  if (closure >= 0.995) {
    // Fully shut: the chord degenerates, draw the whole disc as two half arcs.
    return path(
      `M${r1(cx - R)},${cy} A${r1(R)},${r1(R)} 0 1 1 ${r1(cx + R)},${cy} A${r1(R)},${r1(R)} 0 1 1 ${r1(cx - R)},${cy} Z`,
      style,
    );
  }
  const lidY = cy - R + 2 * R * closure;
  const hc = Math.sqrt(Math.max(0, R * R - (lidY - cy) ** 2));
  const large = closure > 0.5 ? 1 : 0;
  return path(
    `M${r1(cx - hc)},${r1(lidY)} A${r1(R)},${r1(R)} 0 ${large} 1 ${r1(cx + hc)},${r1(lidY)} Z`,
    style,
  );
}

/* ----------------------------------------------------------------- props --- */

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

export function star4(x: number, y: number, r: number, fill: string): SvgNode {
  return path(
    `M${x},${r1(y - r)} Q${x},${y} ${r1(x + r)},${y} Q${x},${y} ${x},${r1(y + r)} Q${x},${y} ${r1(x - r)},${y} Q${x},${y} ${x},${r1(y - r)} Z`,
    { fill },
  );
}

function soundArcs(c: MascotColors, x: number, y: number, dirx: 1 | -1): SvgNode[] {
  const out: SvgNode[] = [];
  for (let i = 0; i < 3; i += 1) {
    const r = 5 + i * 4.2;
    out.push(
      path(`M${x},${r1(y - r)} A${r},${r} 0 0 ${dirx > 0 ? 1 : 0} ${x},${r1(y + r)}`, {
        ...stroke(c.prop, 2.2),
        strokeOpacity: 1 - i * 0.22,
        transform: `translate(${r1(dirx * i * 1.2)},0)`,
      }),
    );
  }
  return out;
}

function thoughtBubbles(c: MascotColors, x: number, y: number): SvgNode[] {
  return [
    circle(x, y, 1.8, { fill: c.propFill, stroke: c.prop, strokeWidth: 1.6 }),
    circle(x + 4.5, y - 5, 2.8, { fill: c.propFill, stroke: c.prop, strokeWidth: 1.6 }),
    circle(x + 11, y - 12, 5, { fill: c.propFill, stroke: c.prop, strokeWidth: 1.8 }),
  ];
}

/** Confetti pieces: [x, y, angle, colourKey]. Exposed for the Lottie burst. */
export const CONFETTI_PIECES: ReadonlyArray<
  readonly [number, number, number, 'accent' | 'sky' | 'pink']
> = [
  [14, 20, -20, 'accent'],
  [22, 10, 30, 'sky'],
  [80, 12, 15, 'pink'],
  [90, 24, -35, 'accent'],
  [10, 40, 50, 'pink'],
  [92, 44, -15, 'sky'],
  [30, 6, 0, 'pink'],
  [70, 6, 40, 'sky'],
];
export const CONFETTI_STARS: ReadonlyArray<readonly [number, number, number]> = [
  [18, 30, 4],
  [84, 34, 5],
  [50, 6, 3.5],
];

export function confettiColor(c: MascotColors, key: 'accent' | 'sky' | 'pink'): string {
  return key === 'accent' ? c.accent : key === 'sky' ? c.confettiSky : c.confettiPink;
}

function confetti(c: MascotColors, detail: MascotDetail): SvgNode[] {
  const pieces = detail === 'icon' ? CONFETTI_PIECES.slice(0, 4) : CONFETTI_PIECES;
  const out: SvgNode[] = pieces.map(([x, y, a, k]) =>
    rect(x - 1.6, y - 3, 3.2, 6, {
      rx: 1,
      fill: confettiColor(c, k),
      transform: `rotate(${a} ${x} ${y})`,
    }),
  );
  if (detail === 'full') for (const [x, y, r] of CONFETTI_STARS) out.push(star4(x, y, r, c.accent));
  return out;
}

function replayArrow(c: MascotColors, x: number, y: number): SvgNode[] {
  return [
    circle(x, y, 9.5, { fill: c.propFill, stroke: c.prop, strokeWidth: 1.8 }),
    path(`M${x + 5.2},${y - 1.5} A5.5,5.5 0 1 0 ${x + 3.8},${y + 4}`, stroke(c.crestShade, 2.6)),
    path(`M${x + 1.8},${y - 4.8} L${x + 6.2},${y - 1.2} L${x + 1.4},${y + 0.4} Z`, {
      fill: c.crestShade,
    }),
  ];
}

function offlineCloud(c: MascotColors, x: number, y: number): SvgNode[] {
  return [
    path(
      `M${x - 9},${y + 4} a4.5,4.5 0 0 1 0.6,-9 a6,6 0 0 1 11.4,-2.4 a5,5 0 0 1 6.2,6.1 a3.6,3.6 0 0 1 -0.6,5.3 Z`,
      { fill: c.propFill, stroke: c.prop, strokeWidth: 1.8, strokeLinejoin: 'round' },
    ),
    path(`M${x - 9},${y + 6} L${x + 10},${y - 10}`, stroke(c.danger, 2.6)),
  ];
}

function starMedal(c: MascotColors, x: number, y: number): SvgNode[] {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 8.5 : 4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([r1(x + r * Math.cos(a)), r1(y + r * Math.sin(a))]);
  }
  return [
    path(roundedRect(x - 5.5, y + 5, 4.5, 10, 1.2), {
      fill: c.danger,
      transform: `rotate(12 ${x - 3.3} ${y + 5})`,
    }),
    path(roundedRect(x + 1, y + 5, 4.5, 10, 1.2), {
      fill: c.danger,
      transform: `rotate(-12 ${x + 3.3} ${y + 5})`,
    }),
    polygon(pts, { fill: c.accent, stroke: c.outline, strokeWidth: 1.8, strokeLinejoin: 'round' }),
    circle(x, y, 2.6, { fill: c.propFill, fillOpacity: 0.9 }),
  ];
}

function headphones(c: MascotColors): { behind: SvgNode[]; front: SvgNode[] } {
  return {
    behind: [path('M19,44 C16,-6 84,-6 81,44', stroke(c.prop, 4.4))],
    front: [
      path(roundedRect(15, 37, 9, 15, 4), { fill: c.propFill, stroke: c.prop, strokeWidth: 2 }),
      path(roundedRect(76, 37, 9, 15, 4), { fill: c.propFill, stroke: c.prop, strokeWidth: 2 }),
    ],
  };
}

function zzz(c: MascotColors, detail: MascotDetail): SvgNode[] {
  const z = (x: number, y: number, w: number): SvgNode =>
    polyline(
      [
        [x, y],
        [x + w, y],
        [x, y + w],
        [x + w, y + w],
      ],
      stroke(c.sleepy, Math.max(1.8, w / 2.6)),
    );
  return detail === 'icon'
    ? [z(76, 16, 7), z(86, 4, 9)]
    : [z(70, 26, 5), z(78, 16, 7), z(88, 3, 9)];
}

function brokenLink(c: MascotColors): SvgNode[] {
  const s = stroke(c.prop, 2.2);
  return [
    path(roundedRect(64, 20, 12, 7, 3.5), { ...s, transform: 'rotate(-40 70 23.5)' }),
    path(roundedRect(80, 10, 12, 7, 3.5), { ...s, transform: 'rotate(-40 86 13.5)' }),
    polyline(
      [
        [76, 16],
        [78, 12],
        [80, 16],
        [82, 11],
      ],
      stroke(c.danger, 1.8),
    ),
  ];
}

function checkBadge(c: MascotColors): SvgNode[] {
  return [
    circle(86, 24, 9.5, { fill: c.accent, stroke: c.outline, strokeWidth: 1.8 }),
    polyline(
      [
        [81, 24.5],
        [84.5, 28],
        [91.5, 20],
      ],
      stroke(c.outline, 2.6),
    ),
  ];
}

function lightbulb(c: MascotColors, detail: MascotDetail): SvgNode[] {
  const s = stroke(c.prop, 2);
  const out: SvgNode[] = [
    circle(14, 22, 7.5, { fill: c.accent, stroke: c.prop, strokeWidth: 2 }),
    path(roundedRect(10.5, 29, 7, 5, [0, 0, 2, 2]), {
      fill: c.propFill,
      stroke: c.prop,
      strokeWidth: 1.8,
    }),
  ];
  if (detail === 'full')
    out.push(
      path('M14,8 L14,11', s),
      path('M3,13 L5.5,15', s),
      path('M25,13 L22.5,15', s),
      path('M1,24 L4,24', s),
      path('M27,24 L24,24', s),
    );
  return out;
}

const SPARKLES: ReadonlyArray<readonly [number, number, number]> = [
  [88, 28, 4],
  [95, 40, 2.6],
  [8, 30, 3],
];

/**
 * Prop nodes for a state. `behind` is drawn before the figure (headphone band), `front`
 * after it. Props live outside the tilt/breath group so they never rotate with the body.
 */
export function propNodes(
  c: MascotColors,
  kind: PropKind,
  detail: MascotDetail,
): { behind: SvgNode[]; front: SvgNode[] } {
  const front = (nodes: SvgNode[]): { behind: SvgNode[]; front: SvgNode[] } => ({
    behind: [],
    front: nodes,
  });
  switch (kind) {
    case 'sparkle':
      return front(
        (detail === 'icon' ? SPARKLES.slice(0, 1) : SPARKLES).map(([x, y, r]) =>
          star4(x, y, r, c.accent),
        ),
      );
    case 'soundIn':
      return front(soundArcs(c, 12, 44, -1));
    case 'soundOut':
      return front(soundArcs(c, 88, 30, 1));
    case 'thoughtBubbles':
      return front(thoughtBubbles(c, 78, 28));
    case 'replayArrow':
      return front(replayArrow(c, 86, 26));
    case 'confetti':
      return front(confetti(c, detail));
    case 'starMedal':
      return front(starMedal(c, 86, 22));
    case 'headphones':
      return headphones(c);
    case 'zzz':
      return front(zzz(c, detail));
    case 'cloudSlash':
      return front(offlineCloud(c, 84, 24));
    case 'brokenLink':
      return front(brokenLink(c));
    case 'checkBadge':
      return front(checkBadge(c));
    case 'lightbulb':
      return front(lightbulb(c, detail));
    default:
      return front([]);
  }
}
