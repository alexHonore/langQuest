/**
 * Lottie (bodymovin v5.x) clips generated from the mascot's SvgNode parts.
 *
 * The geometry is never re-drawn: each named part of {@link buildMascotParts} becomes one
 * shape layer whose shapes are converted 1:1 from the SvgNodes (paths → bezier vertices,
 * circles/ellipses → `el`, rects → `rc`, strokes/fills → `st`/`fl`). Animation is applied
 * on layer or group transforms only (breath, bounce, tail rotation, pupil drift, lids,
 * confetti), so every frame is still "Melo as drawn in code".
 *
 * Layer tree:  root (null, scales 100 → canvas)
 *              └─ figure (null, tilt about 50,60)
 *                 └─ breath (null, squash about 50,88)
 *                    └─ every body part layer
 *              └─ prop layers (never tilt with the body)
 *
 * `renderLottieFrameSvg` is a tiny evaluator used by the tests and the export script to
 * prove the JSON is self-consistent (it rebuilds an SVG from the Lottie data at a frame).
 */
import type { MascotState } from '@langquest/contracts';
import type { ArtTheme } from '../palette';
import { type SvgNode, fmt, toSvgString } from '../svg-node';
import {
  type MascotPartId,
  type MascotParts,
  MASCOT_PART_IDS,
  MASCOT_PIVOT,
  MASCOT_VIEWBOX,
  buildMascotParts,
} from '../mascot';
import { EYE_L, EYE_R, lidChord } from './geometry';
import { tailCentreline } from './geometry';

/* ------------------------------------------------------------- types --- */

export interface LottieKeyframe {
  t: number;
  s: number[];
  i?: { x: number[]; y: number[] };
  o?: { x: number[]; y: number[] };
}
export type LottieProp = { a: 0; k: number | number[] } | { a: 1; k: LottieKeyframe[] };
export interface LottieBezier {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}
export type LottieShape =
  | { ty: 'gr'; nm?: string; it: LottieShape[] }
  | { ty: 'sh'; nm?: string; d: 1; ks: { a: 0; k: LottieBezier } }
  | { ty: 'el'; nm?: string; d: 1; p: LottieProp; s: LottieProp }
  | { ty: 'rc'; nm?: string; d: 1; p: LottieProp; s: LottieProp; r: LottieProp }
  | { ty: 'fl'; nm?: string; c: LottieProp; o: LottieProp; r: 1 }
  | {
      ty: 'st';
      nm?: string;
      c: LottieProp;
      o: LottieProp;
      w: LottieProp;
      lc: 1 | 2;
      lj: 1 | 2;
      ml: number;
    }
  | {
      ty: 'tr';
      nm?: string;
      a: LottieProp;
      p: LottieProp;
      s: LottieProp;
      r: LottieProp;
      o: LottieProp;
      sk: LottieProp;
      sa: LottieProp;
    };
export interface LottieTransform {
  a: LottieProp;
  p: LottieProp;
  s: LottieProp;
  r: LottieProp;
  o: LottieProp;
}
export interface LottieLayer {
  ddd: 0;
  ind: number;
  ty: 3 | 4;
  nm: string;
  sr: 1;
  ks: LottieTransform;
  ao: 0;
  shapes?: LottieShape[];
  ip: number;
  op: number;
  st: 0;
  bm: 0;
  parent?: number;
}
export interface LottieAnimation {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: never[];
  layers: LottieLayer[];
  markers: Array<{ tm: number; cm: string; dr: number }>;
}

export const MASCOT_LOTTIE_CLIPS = ['idle', 'reaction', 'celebrate_bounce', 'thinking'] as const;
export type MascotLottieClip = (typeof MASCOT_LOTTIE_CLIPS)[number];

export const LOTTIE_FPS = 30;
export const LOTTIE_SIZE = 256;

/* ---------------------------------------------------------- helpers --- */

const st = (k: number | number[]): LottieProp => ({ a: 0, k });
const EASE = (dims: number): Pick<LottieKeyframe, 'i' | 'o'> => ({
  i: { x: Array(dims).fill(0.42), y: Array(dims).fill(1) },
  o: { x: Array(dims).fill(0.58), y: Array(dims).fill(0) },
});
/** Keyframed property from [frame, value[]] pairs with ease-in-out between keys. */
export function kf(keys: ReadonlyArray<readonly [number, number[]]>): LottieProp {
  return {
    a: 1,
    k: keys.map(([t, s], idx) =>
      idx === keys.length - 1 ? { t, s: [...s] } : { t, s: [...s], ...EASE(s.length) },
    ),
  };
}
const round = (n: number): number => Math.round(n * 1000) / 1000;

function hexToRgb(hex: string): number[] {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return [
    round(((n >> 16) & 0xff) / 255),
    round(((n >> 8) & 0xff) / 255),
    round((n & 0xff) / 255),
    1,
  ];
}

function num(v: string | number | undefined, dflt: number): number {
  if (v === undefined) return dflt;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

/* ------------------------------------------------------- path parser --- */

type Mat = readonly [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Parse an SVG `transform` made of translate/rotate/scale into a matrix. */
export function parseTransform(t: string | number | undefined): Mat {
  if (!t || typeof t !== 'string') return IDENT;
  let m: Mat = IDENT;
  const re = /(translate|rotate|scale)\s*\(([^)]*)\)/g;
  for (const match of t.matchAll(re)) {
    const args = (match[2] ?? '')
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    const fn = match[1];
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]);
    else if (fn === 'scale') m = mul(m, [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]);
    else if (fn === 'rotate') {
      const a = ((args[0] ?? 0) * Math.PI) / 180;
      const cx = args[1] ?? 0;
      const cy = args[2] ?? 0;
      const rot: Mat = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
      m = mul(m, [1, 0, 0, 1, cx, cy]);
      m = mul(m, rot);
      m = mul(m, [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return m;
}

/** Decompose a translate/rotate/scale matrix into a Lottie transform (anchor 0,0). */
export function matrixToTr(m: Mat): LottieShape & { ty: 'tr' } {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = (Math.hypot(m[2], m[3]) || 1) * (det < 0 ? -1 : 1);
  const r = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  return {
    ty: 'tr',
    a: st([0, 0]),
    p: st([round(m[4]), round(m[5])]),
    s: st([round(sx * 100), round(sy * 100)]),
    r: st(round(r)),
    o: st(100),
    sk: st(0),
    sa: st(0),
  };
}

interface Seg {
  v: [number, number];
  i: [number, number];
  o: [number, number];
}

function arcToCubics(
  x1: number,
  y1: number,
  rx0: number,
  ry0: number,
  phi: number,
  fa: number,
  fs: number,
  x2: number,
  y2: number,
): Array<[number, number, number, number, number, number]> {
  // SVG implementation notes F.6.5 — endpoint to centre parametrisation, then ≤ 90° pieces.
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const rad = (phi * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = fa === fs ? -1 : 1;
  const numer = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, numer / denom));
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const d = ux * vx + uy * vy;
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, d / l)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (fs === 0 && dth > 0) dth -= 2 * Math.PI;
  if (fs === 1 && dth < 0) dth += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2));
  const delta = dth / n;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: Array<[number, number, number, number, number, number]> = [];
  let th = th1;
  for (let k = 0; k < n; k += 1) {
    const c1 = Math.cos(th);
    const s1 = Math.sin(th);
    const th2 = th + delta;
    const c2 = Math.cos(th2);
    const s2 = Math.sin(th2);
    const p = (ex: number, ey: number): [number, number] => [
      cx + cos * rx * ex - sin * ry * ey,
      cy + sin * rx * ex + cos * ry * ey,
    ];
    const q1 = p(c1 - t * s1, s1 + t * c1);
    const q2 = p(c2 + t * s2, s2 - t * c2);
    const e = p(c2, s2);
    out.push([q1[0], q1[1], q2[0], q2[1], e[0], e[1]]);
    th = th2;
  }
  return out;
}

/** Convert an SVG path `d` (M L H V C S Q T A Z, absolute or relative) to Lottie bezier subpaths. */
export function svgPathToBeziers(d: string): LottieBezier[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: LottieBezier[] = [];
  let segs: Seg[] = [];
  let closed = false;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevC: [number, number] | null = null;
  let prevQ: [number, number] | null = null;
  let cmd = '';
  let idx = 0;
  const flush = (): void => {
    if (segs.length > 0) {
      const first = segs[0]!;
      const last = segs[segs.length - 1]!;
      if (
        closed &&
        segs.length > 1 &&
        Math.abs(first.v[0] - last.v[0]) < 1e-6 &&
        Math.abs(first.v[1] - last.v[1]) < 1e-6
      ) {
        first.i = last.i;
        segs.pop();
      }
      out.push({
        c: closed,
        v: segs.map((s) => [round(s.v[0]), round(s.v[1])]),
        i: segs.map((s) => [round(s.i[0]), round(s.i[1])]),
        o: segs.map((s) => [round(s.o[0]), round(s.o[1])]),
      });
    }
    segs = [];
    closed = false;
  };
  const next = (): number => Number(tokens[idx++]);
  const lineTo = (x: number, y: number): void => {
    segs.push({ v: [x, y], i: [0, 0], o: [0, 0] });
    cx = x;
    cy = y;
    prevC = null;
    prevQ = null;
  };
  const cubicTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): void => {
    const last = segs[segs.length - 1];
    if (last) last.o = [x1 - last.v[0], y1 - last.v[1]];
    segs.push({ v: [x, y], i: [x2 - x, y2 - y], o: [0, 0] });
    cx = x;
    cy = y;
    prevC = [x2, y2];
    prevQ = null;
  };
  const quadTo = (qx: number, qy: number, x: number, y: number): void => {
    const c1x = cx + (2 / 3) * (qx - cx);
    const c1y = cy + (2 / 3) * (qy - cy);
    const c2x = x + (2 / 3) * (qx - x);
    const c2y = y + (2 / 3) * (qy - y);
    cubicTo(c1x, c1y, c2x, c2y, x, y);
    prevQ = [qx, qy];
  };
  while (idx < tokens.length) {
    const tok = tokens[idx]!;
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok;
      idx += 1;
    } else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z';
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        flush();
        const x = next() + ox;
        const y = next() + oy;
        sx = x;
        sy = y;
        lineTo(x, y);
        break;
      }
      case 'L':
        lineTo(next() + ox, next() + oy);
        break;
      case 'H':
        lineTo(next() + ox, cy);
        break;
      case 'V':
        lineTo(cx, next() + oy);
        break;
      case 'C': {
        const x1 = next() + ox;
        const y1 = next() + oy;
        const x2 = next() + ox;
        const y2 = next() + oy;
        cubicTo(x1, y1, x2, y2, next() + ox, next() + oy);
        break;
      }
      case 'S': {
        const x1 = prevC ? 2 * cx - prevC[0] : cx;
        const y1 = prevC ? 2 * cy - prevC[1] : cy;
        const x2 = next() + ox;
        const y2 = next() + oy;
        cubicTo(x1, y1, x2, y2, next() + ox, next() + oy);
        break;
      }
      case 'Q': {
        const qx = next() + ox;
        const qy = next() + oy;
        quadTo(qx, qy, next() + ox, next() + oy);
        break;
      }
      case 'T': {
        const qx = prevQ ? 2 * cx - prevQ[0] : cx;
        const qy = prevQ ? 2 * cy - prevQ[1] : cy;
        quadTo(qx, qy, next() + ox, next() + oy);
        break;
      }
      case 'A': {
        const rx = next();
        const ry = next();
        const phi = next();
        const fa = next();
        const fs = next();
        const x = next() + ox;
        const y = next() + oy;
        for (const [x1, y1, x2, y2, ex, ey] of arcToCubics(cx, cy, rx, ry, phi, fa, fs, x, y))
          cubicTo(x1, y1, x2, y2, ex, ey);
        break;
      }
      case 'Z':
        closed = true;
        cx = sx;
        cy = sy;
        flush();
        break;
      default:
        throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  flush();
  return out;
}

/* ---------------------------------------------------- node → shapes --- */

function styleShapes(attrs: SvgNode['attrs']): LottieShape[] {
  const out: LottieShape[] = [];
  const strokeColor = attrs.stroke;
  if (typeof strokeColor === 'string' && strokeColor !== 'none') {
    out.push({
      ty: 'st',
      c: st(hexToRgb(strokeColor)),
      o: st(round(num(attrs.strokeOpacity, 1) * 100)),
      w: st(num(attrs.strokeWidth, 1)),
      lc: attrs.strokeLinecap === 'round' ? 2 : 1,
      lj: attrs.strokeLinejoin === 'round' ? 2 : 1,
      ml: 4,
    });
  }
  const fill = attrs.fill;
  // SVG semantics: a missing `fill` paints black; only `fill="none"` disables it.
  const hasFill = fill === undefined ? true : fill !== 'none';
  if (hasFill) {
    out.push({
      ty: 'fl',
      c: st(hexToRgb(typeof fill === 'string' ? fill : '#000000')),
      o: st(round(num(attrs.fillOpacity, 1) * 100)),
      r: 1,
    });
  }
  return out;
}

function pointsToBezier(points: string | number | undefined, closed: boolean): LottieBezier {
  const v = String(points ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map((p) => p.split(',').map(Number) as [number, number]);
  return { c: closed, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) };
}

/** Convert one SvgNode (and subtree) into a Lottie group `[shapes…, styles…, tr]`. */
export function nodeToLottieGroup(node: SvgNode, nm?: string): LottieShape & { ty: 'gr' } {
  const a = node.attrs;
  const it: LottieShape[] = [];
  switch (node.tag) {
    case 'g':
      // Lottie lists items top-most first; SvgNode children are in paint order.
      for (const child of [...(node.children ?? [])].reverse()) it.push(nodeToLottieGroup(child));
      break;
    case 'path':
      for (const bz of svgPathToBeziers(String(a.d ?? '')))
        it.push({ ty: 'sh', d: 1, ks: { a: 0, k: bz } });
      it.push(...styleShapes(a));
      break;
    case 'circle':
      it.push({
        ty: 'el',
        d: 1,
        p: st([num(a.cx, 0), num(a.cy, 0)]),
        s: st([2 * num(a.r, 0), 2 * num(a.r, 0)]),
      });
      it.push(...styleShapes(a));
      break;
    case 'ellipse':
      it.push({
        ty: 'el',
        d: 1,
        p: st([num(a.cx, 0), num(a.cy, 0)]),
        s: st([2 * num(a.rx, 0), 2 * num(a.ry, 0)]),
      });
      it.push(...styleShapes(a));
      break;
    case 'rect': {
      const w = num(a.width, 0);
      const h = num(a.height, 0);
      it.push({
        ty: 'rc',
        d: 1,
        p: st([num(a.x, 0) + w / 2, num(a.y, 0) + h / 2]),
        s: st([w, h]),
        r: st(num(a.rx, 0)),
      });
      it.push(...styleShapes(a));
      break;
    }
    case 'line':
      it.push({
        ty: 'sh',
        d: 1,
        ks: {
          a: 0,
          k: {
            c: false,
            v: [
              [num(a.x1, 0), num(a.y1, 0)],
              [num(a.x2, 0), num(a.y2, 0)],
            ],
            i: [
              [0, 0],
              [0, 0],
            ],
            o: [
              [0, 0],
              [0, 0],
            ],
          },
        },
      });
      it.push(...styleShapes(a));
      break;
    case 'polyline':
      it.push({ ty: 'sh', d: 1, ks: { a: 0, k: pointsToBezier(a.points, false) } });
      it.push(...styleShapes(a));
      break;
    case 'polygon':
      it.push({ ty: 'sh', d: 1, ks: { a: 0, k: pointsToBezier(a.points, true) } });
      it.push(...styleShapes(a));
      break;
    default:
      throw new Error(`Lottie export does not support <${node.tag}>`);
  }
  const tr = matrixToTr(parseTransform(a.transform));
  if (a.opacity !== undefined) tr.o = st(round(num(a.opacity, 1) * 100));
  it.push(tr);
  return nm ? { ty: 'gr', nm, it } : { ty: 'gr', it };
}

/* ------------------------------------------------------------ layers --- */

const staticTr = (ax: number, ay: number): LottieTransform => ({
  a: st([ax, ay, 0]),
  p: st([ax, ay, 0]),
  s: st([100, 100, 100]),
  r: st(0),
  o: st(100),
});

interface Ctx {
  layers: LottieLayer[];
  op: number;
  nextInd: number;
}

function nullLayer(ctx: Ctx, nm: string, ks: LottieTransform, parent?: number): number {
  const ind = ctx.nextInd++;
  ctx.layers.push({
    ddd: 0,
    ind,
    ty: 3,
    nm,
    sr: 1,
    ks,
    ao: 0,
    ip: 0,
    op: ctx.op,
    st: 0,
    bm: 0,
    ...(parent ? { parent } : {}),
  });
  return ind;
}

function shapeLayer(
  ctx: Ctx,
  nm: string,
  nodes: SvgNode[],
  ks: LottieTransform,
  parent: number,
): LottieLayer {
  const ind = ctx.nextInd++;
  const layer: LottieLayer = {
    ddd: 0,
    ind,
    ty: 4,
    nm,
    sr: 1,
    ks,
    ao: 0,
    // Top-most first (AE order): reverse the paint-ordered nodes.
    shapes: nodes.map((n, i) => nodeToLottieGroup(n, `${nm}-${i}`)).reverse(),
    ip: 0,
    op: ctx.op,
    st: 0,
    bm: 0,
    parent,
  };
  ctx.layers.push(layer);
  return layer;
}

/** Tail root (attach point) — the rotation pivot for tail gestures. */
function tailPivot(parts: MascotParts): [number, number] {
  const [x, y] = parts.pose.tail.attach;
  return [x, y];
}

function tailTipDirection(parts: MascotParts): number {
  const pts = tailCentreline(parts.pose.tail, 1);
  const a = pts[0]!;
  const b = pts[Math.min(pts.length - 1, 6)]!;
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

export interface MascotLottieOptions {
  theme?: ArtTheme;
  trackId?: string | null;
  /** Clip length override in seconds. */
  seconds?: number;
}

const CLIP_SPEC: Record<MascotLottieClip, { state: MascotState; seconds: number; nm: string }> = {
  idle: { state: 'neutral', seconds: 4, nm: 'Melo idle (breath + blink)' },
  reaction: { state: 'neutral', seconds: 0.4, nm: 'Melo reaction (tail wave)' },
  celebrate_bounce: { state: 'celebrate', seconds: 1.2, nm: 'Melo celebrate (bounce + confetti)' },
  thinking: { state: 'thinking', seconds: 3, nm: 'Melo thinking (eye drift)' },
};

/** Build one Lottie clip. Pure: same inputs → same JSON. */
export function buildMascotLottie(
  clip: MascotLottieClip,
  opts: MascotLottieOptions = {},
): LottieAnimation {
  const spec = CLIP_SPEC[clip];
  const seconds = opts.seconds ?? spec.seconds;
  const op = Math.round(seconds * LOTTIE_FPS);
  const parts = buildMascotParts(spec.state, {
    theme: opts.theme,
    size: 256,
    trackId: opts.trackId,
  });
  const ctx: Ctx = { layers: [], op, nextInd: 1 };
  const scale = LOTTIE_SIZE / MASCOT_VIEWBOX.width;

  const root = nullLayer(ctx, 'root', {
    a: st([0, 0, 0]),
    p: st([0, 0, 0]),
    s: st([scale * 100, scale * 100, 100]),
    r: st(0),
    o: st(100),
  });
  const [tx, ty] = MASCOT_PIVOT.tilt;
  const [bx, by] = MASCOT_PIVOT.breath;
  const figureKs: LottieTransform = { ...staticTr(tx, ty), r: st(parts.figure.tilt) };
  const breathKs: LottieTransform = staticTr(bx, by);

  // Clip-specific transforms on the null layers.
  if (clip === 'idle') {
    breathKs.s = kf([
      [0, [100, 100, 100]],
      [op / 2, [102, 98.5, 100]],
      [op, [100, 100, 100]],
    ]);
  }
  if (clip === 'reaction') {
    breathKs.s = kf([
      [0, [100, 100, 100]],
      [3, [103, 96, 100]],
      [8, [100, 100, 100]],
      [op, [100, 100, 100]],
    ]);
  }
  if (clip === 'celebrate_bounce') {
    // anticipation crouch (90 ms) → two ease-out bounces → settle; feet stay planted on the ground.
    breathKs.s = kf([
      [0, [100, 100, 100]],
      [3, [106, 92, 100]],
      [8, [96, 106, 100]],
      [12, [100, 100, 100]],
      [15, [103, 96, 100]],
      [20, [98, 103, 100]],
      [24, [100, 100, 100]],
      [op, [100, 100, 100]],
    ]);
    breathKs.p = kf([
      [0, [bx, by, 0]],
      [3, [bx, by, 0]],
      [8, [bx, by - 9, 0]],
      [12, [bx, by, 0]],
      [15, [bx, by, 0]],
      [20, [bx, by - 5, 0]],
      [24, [bx, by, 0]],
      [op, [bx, by, 0]],
    ]);
  }
  const figure = nullLayer(ctx, 'figure', figureKs, root);
  const breath = nullLayer(ctx, 'breath', breathKs, figure);

  const body: MascotPartId[] = MASCOT_PART_IDS.filter(
    (id) => id !== 'propsBehind' && id !== 'propsFront',
  );
  for (const id of body) {
    let nodes = parts.nodes[id];
    let ks: LottieTransform = staticTr(0, 0);
    if (id === 'lidL' || id === 'lidR') {
      // Full lid (closure 1) scaled down from the eye top; animated only by the blink.
      const eye = id === 'lidL' ? parts.eyes.left : parts.eyes.right;
      const [cx, cy] = id === 'lidL' ? EYE_L : EYE_R;
      if (eye.shape === 'happy' || eye.shape === 'closed') continue;
      nodes = [lidChord(parts.colors, cx, cy, eye.radius, 1)];
      const rest =
        Math.max(eye.lid, eye.shape === 'half' ? 0.45 : eye.shape === 'soft' ? 0.2 : 0) * 100;
      const restS = [100, Math.max(2, rest), 100];
      ks = { ...staticTr(cx, cy - eye.radius), s: st(restS) };
      if (clip === 'idle' || clip === 'thinking') {
        const t0 =
          clip === 'idle'
            ? Math.round(op * 0.78) + (id === 'lidR' ? 2 : 0)
            : Math.round(op * 0.5) + (id === 'lidR' ? 2 : 0);
        ks.s = kf([
          [0, restS],
          [t0, restS],
          [t0 + 2, [100, 100, 100]],
          [t0 + 3, [100, 100, 100]],
          [t0 + 6, restS],
          [op, restS],
        ]);
      }
    }
    if (id === 'tail') {
      const [px, py] = tailPivot(parts);
      ks = staticTr(px, py);
      if (clip === 'idle')
        ks.r = kf([
          [0, [0]],
          [op * 0.25, [-2.5]],
          [op * 0.75, [2.5]],
          [op, [0]],
        ]);
      if (clip === 'reaction')
        ks.r = kf([
          [0, [0]],
          [3, [-16]],
          [7, [12]],
          [10, [-6]],
          [op, [0]],
        ]);
      if (clip === 'celebrate_bounce')
        ks.r = kf([
          [0, [0]],
          [3, [6]],
          [8, [-14]],
          [12, [-4]],
          [20, [-10]],
          [op, [0]],
        ]);
      if (clip === 'thinking') {
        // slow curl/uncurl of the question hook: 0..1 maps to a gentle rotation + the spiral breathing
        const dir = tailTipDirection(parts);
        const amp = 4 * Math.sign(Math.cos(dir) || 1);
        ks.r = kf([
          [0, [0]],
          [op / 2, [amp]],
          [op, [0]],
        ]);
      }
    }
    if (id === 'pupilL' || id === 'pupilR') {
      if (clip === 'idle') {
        const t0 = Math.round(op * 0.5);
        const drift = id === 'pupilL' ? [2, 0, 0] : [0, 0, 0];
        ks.p = kf([
          [0, [0, 0, 0]],
          [t0, [0, 0, 0]],
          [t0 + 6, drift],
          [t0 + 14, drift],
          [t0 + 16, [0, 0, 0]],
          [op, [0, 0, 0]],
        ]);
      }
      if (clip === 'reaction') {
        const conv = id === 'pupilL' ? [2.2, 2, 0] : [-2.2, 2, 0];
        ks.p = kf([
          [0, [0, 0, 0]],
          [4, conv],
          [9, conv],
          [op, [0.6, 1, 0]],
        ]);
      }
      if (clip === 'thinking') {
        const drift =
          id === 'pupilR'
            ? [
                [0, 0, 0],
                [-1.5, 1.2, 0],
                [1, -0.8, 0],
                [0, 0, 0],
              ]
            : [
                [0, 0, 0],
                [0.8, 0.6, 0],
                [-0.6, 0.2, 0],
                [0, 0, 0],
              ];
        ks.p = kf([
          [0, drift[0]!],
          [op * 0.33, drift[1]!],
          [op * 0.66, drift[2]!],
          [op, drift[3]!],
        ]);
      }
    }
    if (nodes.length === 0) continue;
    shapeLayer(ctx, id, nodes, ks, breath);
  }

  for (const id of ['propsBehind', 'propsFront'] as const) {
    const nodes = parts.nodes[id];
    if (nodes.length === 0) continue;
    const layer = shapeLayer(ctx, id, nodes, staticTr(0, 0), root);
    if (clip === 'celebrate_bounce' && id === 'propsFront') {
      // Confetti burst from the crest: each piece falls in from above, spins and fades.
      layer.shapes?.forEach((grp, i) => {
        if (grp.ty !== 'gr') return;
        const tr = grp.it[grp.it.length - 1];
        if (!tr || tr.ty !== 'tr') return;
        const base = tr.p.a === 0 && Array.isArray(tr.p.k) ? tr.p.k : [0, 0];
        const baseR = tr.r.a === 0 && typeof tr.r.k === 'number' ? tr.r.k : 0;
        const delay = 4 + (i % 4) * 2;
        tr.p = kf([
          [0, [base[0]!, base[1]! - 26]],
          [delay, [base[0]!, base[1]! - 26]],
          [delay + 10, [base[0]!, base[1]!]],
          [op, [base[0]!, base[1]! + 6]],
        ]);
        tr.r = kf([
          [0, [baseR]],
          [delay, [baseR]],
          [op, [baseR + (i % 2 === 0 ? 120 : -120)]],
        ]);
        tr.o = kf([
          [0, [0]],
          [delay, [0]],
          [delay + 2, [100]],
          [op - 6, [100]],
          [op, [0]],
        ]);
      });
    }
    if (clip === 'thinking' && id === 'propsFront') {
      // Thought bubbles pulse 0.9 → 1.1 in sequence.
      layer.shapes?.forEach((grp, i) => {
        if (grp.ty !== 'gr') return;
        const el = grp.it.find((s) => s.ty === 'el');
        const tr = grp.it[grp.it.length - 1];
        if (!el || el.ty !== 'el' || !tr || tr.ty !== 'tr') return;
        const c = el.p.a === 0 && Array.isArray(el.p.k) ? el.p.k : [0, 0];
        tr.a = st([c[0]!, c[1]!]);
        tr.p = st([c[0]!, c[1]!]);
        const off = (i * op) / 6;
        tr.s = kf([
          [0, [90, 90]],
          [off + op / 4, [110, 110]],
          [off + op / 2, [90, 90]],
          [op, [90, 90]],
        ]);
      });
    }
  }

  return {
    v: '5.7.4',
    fr: LOTTIE_FPS,
    ip: 0,
    op,
    w: LOTTIE_SIZE,
    h: LOTTIE_SIZE,
    nm: spec.nm,
    ddd: 0,
    assets: [],
    // Lottie layers are listed top-most first; ctx.layers was filled in paint order.
    layers: [...ctx.layers].reverse(),
    markers: [{ tm: 0, cm: `${clip}:${spec.state}`, dr: op }],
  };
}

/* ----------------------------------------------------- frame renderer --- */

function evalProp(p: LottieProp, frame: number): number[] {
  if (p.a === 0) return Array.isArray(p.k) ? p.k : [p.k];
  const keys = p.k;
  if (keys.length === 0) return [0];
  if (frame <= keys[0]!.t) return keys[0]!.s;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (frame >= a.t && frame <= b.t) {
      const u = b.t === a.t ? 0 : (frame - a.t) / (b.t - a.t);
      return a.s.map((v, k) => v + ((b.s[k] ?? v) - v) * u);
    }
  }
  return keys[keys.length - 1]!.s;
}

function trMatrix(a: number[], p: number[], s: number[], r: number): Mat {
  const rad = (r * Math.PI) / 180;
  let m: Mat = [1, 0, 0, 1, p[0] ?? 0, p[1] ?? 0];
  m = mul(m, [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]);
  m = mul(m, [(s[0] ?? 100) / 100, 0, 0, (s[1] ?? 100) / 100, 0, 0]);
  m = mul(m, [1, 0, 0, 1, -(a[0] ?? 0), -(a[1] ?? 0)]);
  return m;
}

const matStr = (m: Mat): string => `matrix(${m.map((n) => fmt(n)).join(' ')})`;
const rgb = (c: number[]): string =>
  `#${c
    .slice(0, 3)
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();

function bezierToD(b: LottieBezier): string {
  if (b.v.length === 0) return '';
  let d = `M${fmt(b.v[0]![0]!)},${fmt(b.v[0]![1]!)}`;
  const n = b.v.length;
  const segs = b.c ? n : n - 1;
  for (let k = 0; k < segs; k += 1) {
    const j = (k + 1) % n;
    const p0 = b.v[k]!;
    const p1 = b.v[j]!;
    const c1 = [p0[0]! + b.o[k]![0]!, p0[1]! + b.o[k]![1]!];
    const c2 = [p1[0]! + b.i[j]![0]!, p1[1]! + b.i[j]![1]!];
    d += `C${fmt(c1[0]!)},${fmt(c1[1]!)} ${fmt(c2[0]!)},${fmt(c2[1]!)} ${fmt(p1[0]!)},${fmt(p1[1]!)}`;
  }
  return b.c ? `${d}Z` : d;
}

function shapesToNodes(shapes: LottieShape[], frame: number): SvgNode[] {
  const out: SvgNode[] = [];
  // Top-most first in the data → paint the last group first.
  for (const s of [...shapes].reverse()) {
    if (s.ty !== 'gr') continue;
    const geoms: SvgNode[] = [];
    const attrs: Record<string, string | number | undefined> = {};
    let tr: Mat = IDENT;
    let opacity = 1;
    const nestedGroups: LottieShape[] = [];
    for (const it of s.it) {
      switch (it.ty) {
        case 'gr':
          nestedGroups.push(it);
          break;
        case 'sh':
          geoms.push({ tag: 'path', attrs: { d: bezierToD(it.ks.k) } });
          break;
        case 'el': {
          const p = evalProp(it.p, frame);
          const sz = evalProp(it.s, frame);
          geoms.push({
            tag: 'ellipse',
            attrs: { cx: p[0], cy: p[1], rx: (sz[0] ?? 0) / 2, ry: (sz[1] ?? 0) / 2 },
          });
          break;
        }
        case 'rc': {
          const p = evalProp(it.p, frame);
          const sz = evalProp(it.s, frame);
          geoms.push({
            tag: 'rect',
            attrs: {
              x: (p[0] ?? 0) - (sz[0] ?? 0) / 2,
              y: (p[1] ?? 0) - (sz[1] ?? 0) / 2,
              width: sz[0],
              height: sz[1],
              rx: evalProp(it.r, frame)[0],
            },
          });
          break;
        }
        case 'fl':
          attrs.fill = rgb(evalProp(it.c, frame));
          attrs.fillOpacity = (evalProp(it.o, frame)[0] ?? 100) / 100;
          break;
        case 'st':
          attrs.stroke = rgb(evalProp(it.c, frame));
          attrs.strokeWidth = evalProp(it.w, frame)[0];
          attrs.strokeOpacity = (evalProp(it.o, frame)[0] ?? 100) / 100;
          attrs.strokeLinecap = it.lc === 2 ? 'round' : 'butt';
          attrs.strokeLinejoin = it.lj === 2 ? 'round' : 'miter';
          break;
        case 'tr':
          tr = trMatrix(
            evalProp(it.a, frame),
            evalProp(it.p, frame),
            evalProp(it.s, frame),
            evalProp(it.r, frame)[0] ?? 0,
          );
          opacity = (evalProp(it.o, frame)[0] ?? 100) / 100;
          break;
        default:
          break;
      }
    }
    if (attrs.fill === undefined) attrs.fill = 'none';
    const nested = shapesToNodes(nestedGroups, frame);
    const children = [
      ...nested,
      ...geoms.map((gm) => ({ tag: gm.tag, attrs: { ...gm.attrs, ...attrs } })),
    ];
    out.push({
      tag: 'g',
      attrs: { transform: matStr(tr), opacity: opacity === 1 ? undefined : opacity },
      children,
    });
  }
  return out;
}

/**
 * Rebuild an SVG from a Lottie clip at a frame (linear interpolation, parenting honoured).
 * A sanity renderer for tests / the export script — not a player.
 */
export function renderLottieFrameSvg(anim: LottieAnimation, frame: number): string {
  const byInd = new Map(anim.layers.map((l) => [l.ind, l]));
  const worldOf = (l: LottieLayer): Mat => {
    const local = trMatrix(
      evalProp(l.ks.a, frame),
      evalProp(l.ks.p, frame),
      evalProp(l.ks.s, frame),
      evalProp(l.ks.r, frame)[0] ?? 0,
    );
    const parent = l.parent !== undefined ? byInd.get(l.parent) : undefined;
    return parent ? mul(worldOf(parent), local) : local;
  };
  const children: SvgNode[] = [];
  // Lottie lists layers top-most first, so the last layer is painted first.
  for (const l of [...anim.layers].reverse()) {
    if (l.ty !== 4 || !l.shapes) continue;
    if (frame < l.ip || frame > l.op) continue;
    const o = (evalProp(l.ks.o, frame)[0] ?? 100) / 100;
    children.push({
      tag: 'g',
      attrs: { transform: matStr(worldOf(l)), opacity: o === 1 ? undefined : o },
      children: shapesToNodes(l.shapes, frame),
    });
  }
  return toSvgString({
    viewBox: { x: 0, y: 0, width: anim.w, height: anim.h },
    width: anim.w,
    height: anim.h,
    label: `${anim.nm} — frame ${frame}`,
    children,
  });
}

/** Walk every shape in a clip (tests: "references only generated shapes"). */
export function walkLottieShapes(
  anim: LottieAnimation,
  visit: (s: LottieShape, layer: LottieLayer) => void,
): void {
  const rec = (shapes: LottieShape[], layer: LottieLayer): void => {
    for (const s of shapes) {
      visit(s, layer);
      if (s.ty === 'gr') rec(s.it, layer);
    }
  };
  for (const l of anim.layers) if (l.shapes) rec(l.shapes, l);
}
