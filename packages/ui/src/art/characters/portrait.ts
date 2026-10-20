/**
 * Parametric clay portraits (C2 "soft dimensional", owner-approved 2026-10-19).
 *
 * One rig renders every roster character in the 9 contract expressions. Two levels of
 * detail share the same geometry:
 *  - `full`  (> 48 px): three-stop focal gradients, clipped cool rim light, specular,
 *    contact shadows, bead eyes with two highlights, sculpted lips. No outlines.
 *  - `flat`  (≤ 48 px): the same silhouettes as two-value flat fills (base value + one
 *    shadow value per material), dot eyes and stroke mouths — crisp and cheap in lists.
 *
 * Coordinate space: 120 × 120 viewBox, circular disc of radius 56 at (60, 60).
 * No text is ever baked into the artwork; the accessible label lives in `<title>`.
 */
import type { CharacterExpression } from '@langquest/contracts';
import { type ArtTheme, CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, shade } from '../palette';
import {
  type SvgAttrValue,
  type SvgDocument,
  type SvgNode,
  circle,
  el,
  ellipse,
  fmt,
  g,
  line,
  path,
  roundedRect,
  stroke,
  toSvgString,
} from '../svg-node';
import {
  type ClayMaterial,
  ClayContext,
  RIM_OPACITY,
  circlePath,
  ellipsePath,
  mix,
  specular,
} from './clay';
import { CHARACTER_EXPRESSION_POSES, EXPRESSION_LABELS, type ExpressionPose } from './expressions';
import type {
  HeadShape,
  LangQuestCharacter,
  PortraitDetail,
  PortraitParams,
  Stature,
} from './types';

export const PORTRAIT_VIEWBOX = { x: 0, y: 0, width: 120, height: 120 } as const;
/** Rendered size (px / dp) at or below which the flat level of detail is used. */
export const PORTRAIT_FLAT_MAX_SIZE = 48;

/** Level of detail implied by a rendered size (undefined size → full). */
export function portraitDetailForSize(size: number | undefined): PortraitDetail {
  return size !== undefined && size <= PORTRAIT_FLAT_MAX_SIZE ? 'flat' : 'full';
}

export interface PortraitRenderOptions {
  theme?: ArtTheme;
  /** Explicit level of detail; defaults from `size` (≤ 48 px → flat). */
  detail?: PortraitDetail;
  /** Rendered size, used only to pick the default level of detail. */
  size?: number;
}

const HX = 60;
const HY = 52;
const PIVOT_Y = HY + 20;
const TEETH = '#FBF7F2';
const TONGUE = '#D9646E';
const FRAME = '#3B3230';
const CHARCOAL = '#3C3F45';

/* ------------------------------------------------------------------ rig --- */

interface HeadGeom {
  rx: number;
  ry: number;
  d: string;
  top: number;
  bottom: number;
}

function headGeom(shape: HeadShape): HeadGeom {
  switch (shape) {
    case 'round':
      return { rx: 21, ry: 22, d: ellipsePath(HX, HY, 21, 22), top: HY - 22, bottom: HY + 22 };
    case 'oval':
      return { rx: 19.5, ry: 24, d: ellipsePath(HX, HY, 19.5, 24), top: HY - 24, bottom: HY + 24 };
    case 'long':
      return { rx: 18, ry: 26, d: ellipsePath(HX, HY + 1, 18, 26), top: HY - 25, bottom: HY + 27 };
    case 'square':
      return {
        rx: 20.5,
        ry: 23,
        d: roundedRect(HX - 20.5, HY - 23, 41, 46, [16, 16, 13, 13]),
        top: HY - 23,
        bottom: HY + 23,
      };
    case 'heart':
      return {
        rx: 21,
        ry: 23,
        d: `M${HX - 21},${HY - 8} C${HX - 21},${HY - 24} ${HX - 10},${HY - 25} ${HX},${HY - 25} C${HX + 10},${HY - 25} ${HX + 21},${HY - 24} ${HX + 21},${HY - 8} C${HX + 21},${HY + 8} ${HX + 10},${HY + 23} ${HX},${HY + 23} C${HX - 10},${HY + 23} ${HX - 21},${HY + 8} ${HX - 21},${HY - 8}Z`,
        top: HY - 25,
        bottom: HY + 23,
      };
    default:
      return { rx: 20, ry: 23, d: ellipsePath(HX, HY, 20, 23), top: HY - 23, bottom: HY + 23 };
  }
}

interface StatureSpec {
  headScale: number;
  shoulderWidth: number;
  eyeScale: number;
}

const STATURES: Record<Stature, StatureSpec> = {
  child: { headScale: 1.1, shoulderWidth: 0.8, eyeScale: 1.12 },
  teen: { headScale: 1.03, shoulderWidth: 0.92, eyeScale: 1.04 },
  adult: { headScale: 1, shoulderWidth: 1, eyeScale: 1 },
};

interface Rig {
  ctx: ClayContext;
  flat: boolean;
  theme: ArtTheme;
  p: PortraitParams;
  pose: ExpressionPose;
  h: HeadGeom;
  stature: StatureSpec;
  skin: string;
  hairColor: string;
  cloth: string;
  accent: string;
  /** Dark feature stroke (lashes, nostril) — a darker value of the skin, never black. */
  ink: string;
  /** Mid skin shadow used for soft lines (nose, lids, smile lines). */
  soft: string;
  lip: string;
  mouthDark: string;
  brow: string;
  skinMat: ClayMaterial;
  hairMat: ClayMaterial;
  clothMat: ClayMaterial;
  accentMat: ClayMaterial;
}

function makeRig(
  c: LangQuestCharacter,
  expression: CharacterExpression,
  theme: ArtTheme,
  detail: PortraitDetail,
): Rig {
  const p = c.look;
  const flat = detail === 'flat';
  const ctx = new ClayContext({
    prefix: `${c.id}${theme === 'dark' ? '-d' : ''}`,
    rimOpacity: RIM_OPACITY[theme],
  });
  const skin = SKIN_TONES[p.skin];
  const hairColor = HAIR_COLORS[p.hairColor];
  const cloth = CLOTH_COLORS[p.clothColor];
  const accent = CLOTH_COLORS[p.clothAccent];
  const lightHair = p.hairColor === 'blonde' || p.hairColor === 'silver' || p.hairColor === 'grey';
  const lip = mix(shade(skin, -0.28), '#B5524B', 0.55);
  return {
    ctx,
    flat,
    theme,
    p,
    pose: CHARACTER_EXPRESSION_POSES[expression],
    h: headGeom(p.head),
    stature: STATURES[p.stature ?? 'adult'],
    skin,
    hairColor,
    cloth,
    accent,
    ink: shade(skin, -0.66),
    soft: shade(skin, -0.32),
    lip,
    mouthDark: mix(lip, '#1A0C10', 0.62),
    brow: lightHair ? mix(hairColor, '#4A3A2A', 0.45) : shade(hairColor, -0.1),
    skinMat: ctx.material('skin', skin, 0.16, -0.3),
    hairMat: ctx.material('hair', hairColor, 0.22, -0.38),
    clothMat: ctx.material('cloth', cloth, 0.18, -0.32),
    accentMat: ctx.material('accent', accent, 0.16, -0.3),
  };
}

/** Paint a shape: clay recipe in full detail, flat base value in flat detail. */
function paint(
  rig: Rig,
  d: string,
  mat: ClayMaterial,
  rim = 0,
  extra: Record<string, SvgAttrValue> = {},
): SvgNode[] {
  if (rig.flat) return [path(d, { fill: mat.base, ...extra })];
  return rig.ctx.shape(d, mat, rim, extra);
}

/** Nodes that exist only in full detail. */
const detailOnly = (rig: Rig, nodes: () => SvgNode[]): SvgNode[] => (rig.flat ? [] : nodes());

/* ----------------------------------------------------------------- hair --- */

function hairBack(rig: Rig): SvgNode[] {
  const { h, hairMat, p } = rig;
  const style = p.hair;
  const dark = shade(rig.hairColor, -0.3);
  const fill = (d: string, rim = 2.6): SvgNode[] => paint(rig, d, hairMat, rim);
  const curl = (cx: number, cy: number, r: number): SvgNode[] =>
    paint(rig, circlePath(cx, cy, r), hairMat);
  switch (style) {
    case 'longStraight':
      return fill(
        `M${HX - h.rx - 3},${h.top + 14} C${HX - h.rx - 6},${HY + 30} ${HX - h.rx - 2},${HY + 46} ${HX - h.rx + 2},${HY + 48} H${HX + h.rx - 2} C${HX + h.rx + 2},${HY + 46} ${HX + h.rx + 6},${HY + 30} ${HX + h.rx + 3},${h.top + 14} Q${HX},${h.top - 6} ${HX - h.rx - 3},${h.top + 14}Z`,
        3,
      );
    case 'wavyMedium':
      return fill(
        `M${HX - h.rx - 4},${h.top + 12} C${HX - h.rx - 9},${HY + 16} ${HX - h.rx - 3},${HY + 28} ${HX - h.rx - 6},${HY + 36} C${HX - h.rx + 4},${HY + 38} ${HX - h.rx + 8},${HY + 30} ${HX + h.rx - 6},${HY + 24} L${HX + h.rx - 6},${HY + 24} C${HX + h.rx - 8},${HY + 30} ${HX + h.rx - 4},${HY + 38} ${HX + h.rx + 6},${HY + 36} C${HX + h.rx + 3},${HY + 28} ${HX + h.rx + 9},${HY + 16} ${HX + h.rx + 4},${h.top + 12} Q${HX},${h.top - 6} ${HX - h.rx - 4},${h.top + 12}Z`,
        3,
      );
    case 'bob':
      return fill(
        `M${HX - h.rx - 4},${h.top + 10} C${HX - h.rx - 7},${HY + 10} ${HX - h.rx - 5},${HY + 20} ${HX - h.rx - 1},${HY + 22} H${HX + h.rx + 1} C${HX + h.rx + 5},${HY + 20} ${HX + h.rx + 7},${HY + 10} ${HX + h.rx + 4},${h.top + 10} Q${HX},${h.top - 6} ${HX - h.rx - 4},${h.top + 10}Z`,
        3,
      );
    case 'braids': {
      const d = `M${HX + h.rx - 6},${HY + 2} C${HX + h.rx + 2},${HY + 16} ${HX + h.rx + 4},${HY + 30} ${HX + h.rx - 2},${HY + 44}`;
      return [
        path(d, stroke(hairMat.base, 7.5)),
        ...detailOnly(rig, () => [
          path(d, stroke(hairMat.hi, 2.2, { strokeOpacity: 0.35 })),
          path(
            `M${HX + h.rx - 4},${HY + 10} l3,3 M${HX + h.rx - 1},${HY + 20} l3,3 M${HX + h.rx},${HY + 30} l3,3`,
            stroke(dark, 1.4),
          ),
        ]),
      ];
    }
    case 'locs':
    case 'twists': {
      const w = style === 'twists' ? 5.2 : 4.4;
      const nodes: SvgNode[] = [];
      for (const dx of [-14, -7, 0, 7, 14]) {
        const d = `M${HX + dx},${h.top + 10} Q${fmt(HX + dx * 1.6)},${HY + 20} ${fmt(HX + dx * 1.7)},${HY + 34}`;
        nodes.push(path(d, stroke(hairMat.base, w)));
        if (!rig.flat && style === 'twists')
          nodes.push(
            path(
              `M${HX + dx * 1.2},${HY + 4} l1,2 M${HX + dx * 1.45},${HY + 14} l1,2 M${HX + dx * 1.62},${HY + 24} l1,2`,
              stroke(hairMat.hi, 1.2, { strokeOpacity: 0.45 }),
            ),
          );
      }
      return nodes;
    }
    case 'ponytail': {
      const d = `M${HX + 6},${h.top + 4} C${HX + 26},${h.top - 2} ${HX + 30},${HY + 14} ${HX + 22},${HY + 30}`;
      return [
        path(d, stroke(hairMat.base, 7.4)),
        ...detailOnly(rig, () => [path(d, stroke(hairMat.hi, 2, { strokeOpacity: 0.3 }))]),
      ];
    }
    case 'pigtails': {
      const y = HY + 6;
      return [
        ...paint(rig, ellipsePath(HX - h.rx - 5, y, 5.5, 9.5), hairMat, 2.2),
        ...paint(rig, ellipsePath(HX + h.rx + 5, y, 5.5, 9.5), hairMat, 2.2),
        ...paint(rig, ellipsePath(HX - h.rx - 5, y - 8, 3.2, 1.6), rig.accentMat),
        ...paint(rig, ellipsePath(HX + h.rx + 5, y - 8, 3.2, 1.6), rig.accentMat),
      ];
    }
    case 'afro':
      return paint(rig, circlePath(HX, HY - 4, h.rx + 12), hairMat, 3.2);
    case 'curlyVolume':
      return [
        ...curl(HX - h.rx + 2, HY - 4, 12),
        ...curl(HX + h.rx - 2, HY - 4, 12),
        ...curl(HX - h.rx + 10, HY - 16, 12),
        ...curl(HX + h.rx - 10, HY - 16, 12),
        ...paint(rig, circlePath(HX, HY - 20, 13), hairMat, 2.4),
        ...curl(HX - h.rx + 4, HY + 8, 10),
        ...curl(HX + h.rx - 4, HY + 8, 10),
      ];
    case 'headscarf':
      return paint(
        rig,
        `M${HX - h.rx - 6},${h.top + 12} C${HX - h.rx - 10},${HY + 20} ${HX - h.rx - 4},${HY + 44} ${HX - 6},${HY + 48} H${HX + 8} C${HX + h.rx + 6},${HY + 44} ${HX + h.rx + 10},${HY + 20} ${HX + h.rx + 6},${h.top + 12} Q${HX},${h.top - 8} ${HX - h.rx - 6},${h.top + 12}Z`,
        rig.accentMat,
        3.2,
      );
    default:
      return [];
  }
}

/** Front hair + hats; `true` in the second slot when a hairline shadow belongs under it. */
function hairFront(rig: Rig): [SvgNode[], boolean] {
  const { h, hairMat, p } = rig;
  const t = h.top;
  const r = h.rx;
  const nodes: SvgNode[] = [];
  const fill = (d: string, rim = 2.4): void => {
    nodes.push(...paint(rig, d, hairMat, rim));
  };
  let shadow = true;
  switch (p.hair) {
    case 'short':
      fill(
        `M${HX - r + 1},${t + 16} C${HX - r - 1},${t + 2} ${HX - 8},${t - 4} ${HX + 2},${t - 3} C${HX + 14},${t - 3} ${HX + r + 1},${t + 4} ${HX + r - 1},${t + 15} C${HX + r - 6},${t + 8} ${HX + 4},${t + 4} ${HX - 6},${t + 8} C${HX - 12},${t + 10} ${HX - r + 4},${t + 12} ${HX - r + 1},${t + 16}Z`,
      );
      break;
    case 'buzz':
      nodes.push(
        path(
          `M${HX - r + 1},${t + 13} C${HX - r},${t + 2} ${HX - 10},${t - 2} ${HX},${t - 2} C${HX + 10},${t - 2} ${HX + r},${t + 2} ${HX + r - 1},${t + 13} C${HX + 8},${t + 7} ${HX - 8},${t + 7} ${HX - r + 1},${t + 13}Z`,
          { fill: rig.flat ? hairMat.base : hairMat.paint, fillOpacity: 0.9 },
        ),
      );
      shadow = false;
      break;
    case 'curlyShort':
      fill(
        `M${HX - r},${t + 15} C${HX - r - 3},${t + 2} ${HX - 10},${t - 6} ${HX},${t - 5} C${HX + 10},${t - 6} ${HX + r + 3},${t + 2} ${HX + r},${t + 15} C${HX + r - 4},${t + 10} ${HX + 6},${t + 6} ${HX},${t + 9} C${HX - 6},${t + 6} ${HX - r + 4},${t + 10} ${HX - r},${t + 15}Z`,
      );
      for (const [cx, cy] of [
        [HX - r + 2, t + 8],
        [HX + r - 2, t + 8],
        [HX - 8, t - 1],
        [HX + 8, t - 1],
      ] as const)
        nodes.push(...paint(rig, circlePath(cx, cy, 5), hairMat));
      break;
    case 'curlyVolume':
    case 'afro':
    case 'locs':
    case 'twists':
      fill(
        `M${HX - r + 1},${t + 12} C${HX - r},${t + 4} ${HX - 10},${t} ${HX},${t} C${HX + 10},${t} ${HX + r},${t + 4} ${HX + r - 1},${t + 12} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 12}Z`,
        2,
      );
      break;
    case 'longStraight':
      fill(
        `M${HX - r - 1},${t + 18} C${HX - r - 2},${t + 2} ${HX - 8},${t - 4} ${HX},${t - 4} C${HX + 8},${t - 4} ${HX + r + 2},${t + 2} ${HX + r + 1},${t + 18} L${HX + r - 3},${t + 14} L${HX - r + 3},${t + 14}Z`,
      );
      break;
    case 'bob':
    case 'pigtails':
      fill(
        `M${HX - r - 1},${t + 16} C${HX - r - 2},${t + 2} ${HX - 6},${t - 4} ${HX + 2},${t - 4} C${HX + 10},${t - 4} ${HX + r + 2},${t + 2} ${HX + r + 1},${t + 16} C${HX + r - 2},${t + 6} ${HX + 2},${t + 4} ${HX - 4},${t + 10} C${HX - 8},${t + 14} ${HX - r + 3},${t + 12} ${HX - r - 1},${t + 16}Z`,
      );
      break;
    case 'bun':
      nodes.push(...paint(rig, circlePath(HX, t - 2, 8), hairMat, 2.4));
      fill(
        `M${HX - r + 1},${t + 14} C${HX - r},${t + 3} ${HX - 10},${t - 1} ${HX},${t - 1} C${HX + 10},${t - 1} ${HX + r},${t + 3} ${HX + r - 1},${t + 14} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 14}Z`,
      );
      break;
    case 'topknot':
      nodes.push(...paint(rig, ellipsePath(HX, t - 4, 7, 5.5), hairMat, 2.2));
      fill(
        `M${HX - r + 1},${t + 12} C${HX - r},${t + 3} ${HX - 10},${t - 1} ${HX},${t - 1} C${HX + 10},${t - 1} ${HX + r},${t + 3} ${HX + r - 1},${t + 12} C${HX + 8},${t + 6} ${HX - 8},${t + 6} ${HX - r + 1},${t + 12}Z`,
        1.8,
      );
      break;
    case 'braids':
      fill(
        `M${HX - r + 1},${t + 14} C${HX - r},${t + 3} ${HX - 10},${t - 1} ${HX},${t - 1} C${HX + 10},${t - 1} ${HX + r},${t + 3} ${HX + r - 1},${t + 14} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 14}Z`,
      );
      nodes.push(
        ...detailOnly(rig, () => [
          path(
            `M${HX - 6},${t + 1} Q${HX + 4},${t + 4} ${HX + 10},${t + 10}`,
            stroke(hairMat.lo, 1.2),
          ),
        ]),
      );
      break;
    case 'cornrows':
      fill(
        `M${HX - r + 1},${t + 12} C${HX - r},${t + 2} ${HX - 10},${t - 3} ${HX},${t - 3} C${HX + 10},${t - 3} ${HX + r},${t + 2} ${HX + r - 1},${t + 12} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 12}Z`,
        1.8,
      );
      nodes.push(
        ...detailOnly(rig, () =>
          [-12, -6, 0, 6, 12].map((dx) =>
            path(
              `M${HX + dx * 0.6},${t + 9.5} Q${HX + dx * 0.9},${t + 2} ${HX + dx * 1.2},${t - 2.2}`,
              stroke(hairMat.hi, 0.9, { strokeOpacity: 0.55 }),
            ),
          ),
        ),
      );
      break;
    case 'wavyMedium':
      fill(
        `M${HX - r - 1},${t + 18} C${HX - r - 2},${t + 2} ${HX - 8},${t - 5} ${HX + 2},${t - 4} C${HX + 12},${t - 4} ${HX + r + 2},${t + 2} ${HX + r + 1},${t + 18} C${HX + r - 3},${t + 10} ${HX + 10},${t + 4} ${HX},${t + 10} C${HX - 8},${t + 12} ${HX - r + 3},${t + 12} ${HX - r - 1},${t + 18}Z`,
      );
      break;
    case 'sidePart':
      fill(
        `M${HX - r + 1},${t + 15} C${HX - r - 2},${t + 2} ${HX - 10},${t - 6} ${HX + 4},${t - 5} C${HX + 16},${t - 5} ${HX + r + 2},${t + 3} ${HX + r - 1},${t + 15} C${HX + r - 6},${t + 6} ${HX + 10},${t + 2} ${HX - 8},${t + 12} C${HX - 12},${t + 13} ${HX - r + 3},${t + 12} ${HX - r + 1},${t + 15}Z`,
      );
      break;
    case 'ponytail':
      fill(
        `M${HX - r + 1},${t + 14} C${HX - r},${t + 2} ${HX - 10},${t - 2} ${HX},${t - 2} C${HX + 10},${t - 2} ${HX + r},${t + 2} ${HX + r - 1},${t + 14} C${HX + 8},${t + 8} ${HX - 8},${t + 8} ${HX - r + 1},${t + 14}Z`,
      );
      break;
    case 'headscarf':
      nodes.push(
        ...paint(
          rig,
          `M${HX - r - 2},${t + 20} C${HX - r - 4},${t + 2} ${HX - 8},${t - 6} ${HX},${t - 6} C${HX + 8},${t - 6} ${HX + r + 4},${t + 2} ${HX + r + 2},${t + 20} C${HX + r - 2},${t + 10} ${HX + 10},${t + 5} ${HX},${t + 5} C${HX - 10},${t + 5} ${HX - r + 2},${t + 10} ${HX - r - 2},${t + 20}Z`,
          rig.accentMat,
          2.6,
        ),
      );
      break;
    case 'bald':
      nodes.push(...detailOnly(rig, () => [specular(HX - 6, t + 7, 5.5, 2.4, 0.22)]));
      shadow = false;
      break;
    default:
      shadow = false;
      break;
  }
  nodes.push(...hats(rig));
  return [nodes, shadow];
}

function hats(rig: Rig): SvgNode[] {
  const { h, p } = rig;
  const t = h.top;
  const r = h.rx;
  const nodes: SvgNode[] = [];
  const extras = p.extras;
  if (extras.includes('headband'))
    nodes.push(
      path(
        `M${HX - r + 2},${t + 11} Q${HX},${t + 4} ${HX + r - 2},${t + 11}`,
        stroke(CLOTH_COLORS.coral, 3.2),
      ),
    );
  if (extras.includes('cap')) {
    const hat = rig.ctx.material('hat', CLOTH_COLORS.navy, 0.18, -0.3);
    nodes.push(
      ...paint(
        rig,
        `M${HX - r - 1},${t + 12} C${HX - r},${t} ${HX - 10},${t - 6} ${HX},${t - 6} C${HX + 10},${t - 6} ${HX + r},${t} ${HX + r + 1},${t + 12}Z`,
        hat,
        2.6,
      ),
      ...paint(
        rig,
        `M${HX - r - 1},${t + 12} H${HX + r + 12} q3,0 2,3 Q${HX + 10},${t + 13} ${HX - r - 1},${t + 12}Z`,
        rig.ctx.material('hat2', shade(CLOTH_COLORS.navy, -0.2), 0.14, -0.28),
      ),
    );
  }
  if (extras.includes('beanie')) {
    nodes.push(
      ...paint(
        rig,
        `M${HX - r - 2},${t + 14} C${HX - r - 2},${t - 2} ${HX - 10},${t - 9} ${HX},${t - 9} C${HX + 10},${t - 9} ${HX + r + 2},${t - 2} ${HX + r + 2},${t + 14}Z`,
        rig.accentMat,
        2.6,
      ),
      ...paint(
        rig,
        roundedRect(HX - r - 3, t + 9, r * 2 + 6, 6, 3),
        rig.ctx.material('accent2', shade(rig.accent, -0.12), 0.14, -0.28),
      ),
    );
  }
  if (extras.includes('kippah'))
    nodes.push(...paint(rig, ellipsePath(HX + 5, t - 1.5, 6.5, 2.6), rig.accentMat, 1.4));
  if (extras.includes('headphones')) {
    const cups = rig.ctx.material('charcoal', CHARCOAL, 0.2, -0.3);
    nodes.push(
      path(
        `M${HX - r - 2},${HY + 2} C${HX - r - 2},${t - 6} ${HX + r + 2},${t - 6} ${HX + r + 2},${HY + 2}`,
        stroke(CHARCOAL, 2.4),
      ),
      ...paint(rig, roundedRect(HX - r - 4.5, HY - 2.5, 7, 9.5, 3), cups, 1.6),
      ...paint(rig, roundedRect(HX + r - 2.5, HY - 2.5, 7, 9.5, 3), cups, 1.6),
    );
  }
  return nodes;
}

/* ---------------------------------------------------------------- torso --- */

function torso(rig: Rig): SvgNode[] {
  const { p, clothMat, accentMat, skinMat, ctx } = rig;
  const wf = rig.stature.shoulderWidth;
  const nodes: SvgNode[] = [];
  const shoulders = `M14,124 C14,98 36,90 60,90 C84,90 106,98 106,124Z`;
  const neckline = `M46,91 Q60,101 74,91 Q60,97 46,91Z`;
  const clothDark = ctx.material('cloth2', shade(rig.cloth, -0.16), 0.14, -0.28);
  const soft = (d: string, w: number, op = 0.4): SvgNode =>
    path(d, stroke(clothMat.lo, w, { strokeOpacity: op }));
  const button = (cx: number, cy: number): SvgNode =>
    circle(cx, cy, 1.3, { fill: TEETH, fillOpacity: 0.9 });

  // neck (shadowed from the chin), then the shirt
  nodes.push(...paint(rig, roundedRect(53, 66, 14, 28, 5), skinMat));
  nodes.push(
    ...detailOnly(rig, () => [
      path(roundedRect(53, 66, 14, 20, 5), { fill: ctx.fade('neckshade', rig.soft, 0.55) }),
    ]),
  );
  if (rig.flat)
    nodes.push(path(`M53,72 Q60,82 67,72 L67,66 H53Z`, { fill: rig.soft, fillOpacity: 0.55 }));
  nodes.push(...paint(rig, shoulders, clothMat, 4.2));
  nodes.push(...detailOnly(rig, () => [ctx.contactShadow(60, 93, 20, 5.5)]));

  switch (p.clothing) {
    case 'crew':
      nodes.push(...paint(rig, neckline, clothDark));
      break;
    case 'vneck':
      nodes.push(...paint(rig, 'M50,91 L60,106 L70,91Z', skinMat));
      nodes.push(soft('M50,91 L60,106 L70,91', 1.6, 0.6));
      break;
    case 'collar':
      nodes.push(
        ...paint(rig, 'M50,90 L60,102 L70,90 L74,96 L64,110 L60,104 L56,110 L46,96Z', accentMat, 2),
      );
      nodes.push(
        soft('M60,104 V124', 1.1),
        ...detailOnly(rig, () => [button(60, 112), button(60, 119)]),
      );
      break;
    case 'apron':
      nodes.push(...paint(rig, neckline, clothDark));
      nodes.push(...paint(rig, 'M40,124 V104 Q40,98 46,98 H74 Q80,98 80,104 V124Z', accentMat, 3));
      nodes.push(
        path('M46,98 C46,92 50,90 54,90', stroke(accentMat.base, 2.2)),
        path('M74,98 C74,92 70,90 66,90', stroke(accentMat.base, 2.2)),
      );
      break;
    case 'coat':
      nodes.push(...paint(rig, 'M46,91 L60,112 L74,91 L82,96 L82,124 H38 V96Z', clothDark, 3));
      nodes.push(...paint(rig, 'M46,91 L60,112 L74,91Z', accentMat, 1.8));
      nodes.push(soft('M60,112 V124', 1.1));
      break;
    case 'hoodie':
      nodes.push(
        ...paint(
          rig,
          'M38,100 C40,90 50,86 60,86 C70,86 80,90 82,100 Q70,96 60,104 Q50,96 38,100Z',
          clothDark,
          2.6,
        ),
      );
      nodes.push(path('M54,104 V116 M66,104 V116', stroke(accentMat.base, 2.2)));
      break;
    case 'blazer':
      nodes.push(...paint(rig, 'M44,94 L60,124 L76,94 L76,124 H44Z', accentMat));
      if (p.extras.includes('tie'))
        nodes.push(...paint(rig, 'M57,97 L63,97 L61.5,116 L60,120 L58.5,116Z', clothDark));
      nodes.push(
        ...paint(rig, 'M44,94 L52,96 L60,118 L68,96 L76,94 L82,100 L82,124 H38 V100Z', clothMat, 3),
      );
      nodes.push(soft('M52,96 L46,104 M68,96 L74,104', 1.1, 0.35));
      break;
    case 'hiVis':
      nodes.push(...paint(rig, neckline, clothDark));
      nodes.push(
        ...paint(rig, 'M36,124 V100 Q40,92 50,92 L60,100 L70,92 Q80,92 84,100 V124Z', accentMat, 3),
      );
      nodes.push(path('M36,112 H84 M36,118 H84', stroke('#E8EAEC', 2.2, { strokeOpacity: 0.9 })));
      break;
    case 'scarf':
      nodes.push(...paint(rig, 'M40,97 Q60,110 80,97 L83,106 Q60,120 37,106Z', accentMat, 2.6));
      nodes.push(
        ...paint(
          rig,
          'M70,108 L80,124 H90 L78,104Z',
          ctx.material('accent2', shade(rig.accent, -0.12), 0.14, -0.28),
        ),
      );
      nodes.push(path('M46,104 Q50,110 56,112', stroke(accentMat.lo, 1.2, { strokeOpacity: 0.6 })));
      break;
    case 'cardigan':
      nodes.push(...paint(rig, 'M48,91 L60,108 L72,91 L72,124 H48Z', accentMat));
      nodes.push(soft('M46,92 L55,96 L55,124 M74,92 L65,96 L65,124', 1.2, 0.5));
      nodes.push(...detailOnly(rig, () => [button(60, 114), button(60, 120)]));
      break;
    case 'scrubs':
      nodes.push(...paint(rig, 'M49,91 L60,104 L71,91 Q60,97 49,91Z', clothDark));
      nodes.push(...paint(rig, roundedRect(66, 110, 10, 9, 1.5), clothDark));
      break;
    case 'polo':
      nodes.push(
        ...paint(
          rig,
          'M50,90 L60,100 L70,90 L73,95 L63,104 L60,100 L57,104 L47,95Z',
          clothDark,
          1.6,
        ),
      );
      nodes.push(
        soft('M60,100 V110', 1.1),
        ...detailOnly(rig, () => [button(60, 104), button(60, 108.5)]),
      );
      break;
    case 'turtleneck':
      nodes.push(...paint(rig, roundedRect(49, 78, 22, 14, 6), clothMat, 2));
      nodes.push(soft('M51,85 H69', 1, 0.35));
      break;
    case 'kurta':
      nodes.push(...paint(rig, 'M50,90 Q60,98 70,90 Q60,101 50,90Z', accentMat));
      nodes.push(...paint(rig, roundedRect(57, 92, 6, 18, 2), accentMat));
      nodes.push(...detailOnly(rig, () => [button(60, 97), button(60, 103)]));
      break;
    case 'jersey':
      nodes.push(...paint(rig, 'M50,90 L60,101 L70,90 L68,88 L60,97 L52,88Z', accentMat));
      nodes.push(...paint(rig, 'M38,110 L60,118 L82,110 L82,116 L60,124 L38,116Z', accentMat));
      break;
    case 'overalls':
      nodes.push(...paint(rig, neckline, clothDark));
      nodes.push(...paint(rig, 'M48,90 L50,124 H56 L54,90Z', accentMat, 1.4));
      nodes.push(...paint(rig, 'M66,90 L64,124 H70 L72,90Z', accentMat, 1.4));
      nodes.push(...paint(rig, roundedRect(46, 106, 28, 18, 3), accentMat, 2));
      break;
    default:
      break;
  }
  if (p.extras.includes('tie') && p.clothing !== 'blazer')
    nodes.push(...paint(rig, 'M57,100 L63,100 L61.5,118 L60,121 L58.5,118Z', accentMat));
  if (p.extras.includes('lanyard'))
    nodes.push(
      path('M52,94 L58,118 M68,94 L62,118', stroke(CLOTH_COLORS.coral, 1.8)),
      path(roundedRect(56, 116, 8, 6, 1.5), { fill: '#FFFFFF' }),
    );
  if (p.extras.includes('pen'))
    nodes.push(
      path(roundedRect(72, 100, 3, 12, 1.5), {
        fill: CLOTH_COLORS.navy,
        transform: 'rotate(8 73 106)',
      }),
    );
  if (p.extras.includes('stethoscope'))
    nodes.push(
      path('M48,92 C48,104 54,110 60,112 C66,110 72,104 72,92', stroke(CHARCOAL, 1.8)),
      circle(60, 113, 2.6, { fill: '#C9CDD2' }),
      circle(60, 113, 1.2, { fill: '#8A9099' }),
    );
  const transform = wf !== 1 ? `translate(60 0) scale(${fmt(wf)} 1) translate(-60 0)` : undefined;
  return transform ? [g({ transform }, nodes)] : nodes;
}

/* ----------------------------------------------------------------- face --- */

function eyes(rig: Rig): SvgNode[] {
  const { pose, ink, soft, ctx, flat } = rig;
  const es = rig.stature.eyeScale;
  const ex = 9.4;
  const ey = HY + 1;
  const nodes: SvgNode[] = [];
  const white = flat ? null : ctx.material('eyewhite', '#F7F1EC', 0.07, -0.16);
  const iris = flat ? null : ctx.material('iris', rig.p.eyeColor, 0.3, -0.55);
  const one = (cx: number): void => {
    const gx = cx + pose.gaze[0];
    const gy = ey + pose.gaze[1];
    if (flat) {
      if (pose.eyes === 'happy')
        nodes.push(
          path(
            `M${fmt(cx - 3.6)},${ey + 1} Q${cx},${ey - 4} ${fmt(cx + 3.6)},${ey + 1}`,
            stroke(ink, 1.8),
          ),
        );
      else if (pose.eyes === 'half')
        nodes.push(path(`M${fmt(cx - 3)},${ey} H${fmt(cx + 3)}`, stroke(ink, 2.2)));
      else nodes.push(circle(gx, gy, (pose.eyes === 'wide' ? 2.2 : 1.9) * es, { fill: ink }));
      return;
    }
    const w = white as ClayMaterial;
    const ir = iris as ClayMaterial;
    const lash = (lift: number): SvgNode =>
      path(
        `M${fmt(cx - 5.2 * es)},${fmt(ey - 0.4)} Q${cx},${fmt(ey - lift * es)} ${fmt(cx + 5.2 * es)},${fmt(ey - 0.4)}`,
        stroke(ink, 1.25, { strokeOpacity: 0.85 }),
      );
    const crease = path(
      `M${fmt(cx - 4.2 * es)},${fmt(ey - 3.6 * es)} Q${cx},${fmt(ey - 6.8 * es)} ${fmt(cx + 4.2 * es)},${fmt(ey - 3.6 * es)}`,
      stroke(soft, 0.95, { strokeOpacity: 0.4 }),
    );
    switch (pose.eyes) {
      case 'happy':
        nodes.push(
          path(
            `M${fmt(cx - 4.6 * es)},${ey + 0.6} Q${cx},${fmt(ey - 4.6 * es)} ${fmt(cx + 4.6 * es)},${ey + 0.6}`,
            stroke(ink, 1.6),
          ),
          path(
            `M${fmt(cx - 3)},${ey + 2.6} Q${cx},${ey + 3.6} ${fmt(cx + 3)},${ey + 2.6}`,
            stroke(soft, 0.9, { strokeOpacity: 0.5 }),
          ),
        );
        return;
      case 'wide':
        nodes.push(
          ellipse(cx, ey + 0.4, 6 * es, 5.8 * es, { fill: soft, fillOpacity: 0.18 }),
          ellipse(cx, ey, 5.4 * es, 5.2 * es, { fill: w.paint }),
          circle(gx, gy, 2.7 * es, { fill: ir.paint }),
          circle(gx, gy, 1.35 * es, { fill: '#1D1310' }),
          circle(gx - 1.1, gy - 1.3, 0.95, { fill: '#FFFFFF' }),
          circle(gx + 1, gy + 1.2, 0.45, { fill: '#FFFFFF', fillOpacity: 0.75 }),
          lash(9.6),
        );
        return;
      case 'half':
        nodes.push(
          ellipse(cx, ey + 0.6, 5.8 * es, 4 * es, { fill: soft, fillOpacity: 0.2 }),
          ellipse(cx, ey, 5 * es, 3.6 * es, { fill: w.paint }),
          circle(gx, gy + 0.5, 2.6 * es, { fill: ir.paint }),
          circle(gx, gy + 0.5, 1.3 * es, { fill: '#1D1310' }),
          circle(gx - 1, gy - 0.6, 0.8, { fill: '#FFFFFF' }),
          path(
            `M${fmt(cx - 5.4 * es)},${fmt(ey - 4.5)} H${fmt(cx + 5.4 * es)} V${fmt(ey - 0.9)} H${fmt(cx - 5.4 * es)}Z`,
            { fill: rig.skinMat.paint },
          ),
          line(
            cx - 5 * es,
            ey - 0.9,
            cx + 5 * es,
            ey - 0.9,
            stroke(ink, 1.3, { strokeOpacity: 0.85 }),
          ),
        );
        return;
      default:
        nodes.push(
          ellipse(cx, ey + 0.6, 6 * es, 5 * es, { fill: soft, fillOpacity: 0.2 }),
          ellipse(cx, ey, 5.1 * es, 4.2 * es, { fill: w.paint }),
          circle(gx, gy, 2.9 * es, { fill: ir.paint }),
          circle(gx, gy, 1.5 * es, { fill: '#1D1310' }),
          circle(gx - 1.1, gy - 1.2, 0.95, { fill: '#FFFFFF' }),
          circle(gx + 1, gy + 1.1, 0.45, { fill: '#FFFFFF', fillOpacity: 0.75 }),
          lash(8.6),
          crease,
        );
    }
  };
  one(HX - ex);
  one(HX + ex);
  return nodes;
}

function brows(rig: Rig): SvgNode[] {
  const { pose } = rig;
  const ex = 9.4;
  const browY = HY + 1 - 7.6;
  const b = stroke(rig.brow, rig.flat ? 1.8 : 2.3);
  const left = (lift: number, inner: number): SvgNode =>
    path(
      `M${fmt(HX - ex - 4.6)},${fmt(browY - lift)} Q${fmt(HX - ex)},${fmt(browY - lift - 2.4 - inner)} ${fmt(HX - ex + 4.6)},${fmt(browY - lift - inner)}`,
      b,
    );
  const right = (lift: number, inner: number): SvgNode =>
    path(
      `M${fmt(HX + ex - 4.6)},${fmt(browY - lift - inner)} Q${fmt(HX + ex)},${fmt(browY - lift - 2.4 - inner)} ${fmt(HX + ex + 4.6)},${fmt(browY - lift)}`,
      b,
    );
  switch (pose.brows) {
    case 'raised':
      return [left(2.5, 0.5), right(2.5, 0.5)];
    case 'raisedOne':
      return [left(0, 0), right(3.5, 1)];
    case 'furrowed':
      return [left(-1, -1.5), right(-1, -1.5)];
    case 'soft':
      return [left(1, 0.3), right(1, 0.3)];
    default:
      return [left(0, 0), right(0, 0)];
  }
}

function nose(rig: Rig): SvgNode[] {
  if (rig.flat) return [path(`M${HX - 1},${HY + 5} q-2,5 1.5,6`, stroke(rig.soft, 1.4))];
  const ny = HY + 9.3;
  return [
    ellipse(HX, ny + 2.1, 2.8, 1.1, { fill: rig.soft, fillOpacity: 0.35 }),
    ...paint(rig, ellipsePath(HX, ny, 3.2, 2.7), rig.skinMat),
    circle(HX - 1.2, ny - 1.1, 0.9, { fill: '#FFFFFF', fillOpacity: 0.45 }),
  ];
}

function mouth(rig: Rig): SvgNode[] {
  const { pose, lip, mouthDark, flat } = rig;
  const my = HY + 16.5;
  const m = stroke(lip, flat ? 1.6 : 1.7);
  const lowerLip = (): SvgNode[] =>
    flat
      ? []
      : [
          ellipse(HX, my + 2.8, 3.8, 1.3, { fill: lip, fillOpacity: 0.45 }),
          ellipse(HX, my + 4.9, 2.8, 0.65, { fill: '#FFFFFF', fillOpacity: 0.3 }),
        ];
  switch (pose.mouth) {
    case 'closedSmile':
      return [path(`M${HX - 6},${my} Q${HX},${my + 5} ${HX + 6},${my}`, m), ...lowerLip()];
    case 'smile':
      return [
        path(`M${HX - 7},${my - 0.5} Q${HX},${my + 6.5} ${HX + 7},${my - 0.5}`, {
          ...m,
          strokeWidth: 1.8,
        }),
        ...(flat
          ? []
          : [
              path(`M${HX - 4.5},${my + 0.6} Q${HX},${my + 3.4} ${HX + 4.5},${my + 0.6}Z`, {
                fill: TEETH,
                fillOpacity: 0.9,
              }),
            ]),
        ...lowerLip(),
      ];
    case 'grin':
      return [
        path(
          `M${HX - 7.5},${my - 1} Q${HX},${my + 9.5} ${HX + 7.5},${my - 1} Q${HX},${my + 1} ${HX - 7.5},${my - 1}Z`,
          { fill: mouthDark },
        ),
        ...(flat
          ? []
          : [
              path(`M${HX - 5.2},${my - 0.2} Q${HX},${my + 2.6} ${HX + 5.2},${my - 0.2}Z`, {
                fill: TEETH,
              }),
              ellipse(HX, my + 5.5, 2.6, 1.4, { fill: TONGUE, fillOpacity: 0.8 }),
            ]),
      ];
    case 'open':
      return [
        path(
          `M${HX - 3.8},${my} Q${HX - 3.8},${my - 1.6} ${HX},${my - 1.6} Q${HX + 3.8},${my - 1.6} ${HX + 3.8},${my} Q${HX + 3.8},${my + 5.2} ${HX},${my + 5.2} Q${HX - 3.8},${my + 5.2} ${HX - 3.8},${my}Z`,
          { fill: mouthDark },
        ),
        ...(flat
          ? []
          : [
              path(roundedRect(HX - 2.6, my - 1.2, 5.2, 1.6, 0.6), { fill: TEETH }),
              ellipse(HX, my + 3.6, 2.4, 1.3, { fill: TONGUE }),
            ]),
      ];
    case 'wideOpen':
      return [
        ellipse(HX, my + 1.8, 4.8, 5.4, { fill: mouthDark }),
        ...(flat ? [] : [ellipse(HX, my + 5, 2.8, 1.8, { fill: TONGUE })]),
      ];
    case 'o':
      return [
        ellipse(HX, my + 1.2, 2.5, 3.2, { fill: mouthDark }),
        ...(flat ? [] : [ellipse(HX, my + 1.2, 2.5, 3.2, stroke(lip, 1.2))]),
      ];
    case 'wavy':
      return [path(`M${HX - 5.5},${my + 0.5} q2.75,-2.6 5.5,0 t5.5,0`, m)];
    case 'flat':
      return [line(HX - 4.5, my + 0.5, HX + 4.5, my + 0.5, m), ...lowerLip()];
    case 'ee':
      return [
        path(roundedRect(HX - 6.4, my - 1.2, 12.8, 4.6, 2.3), { fill: mouthDark }),
        ...(flat ? [] : [path(roundedRect(HX - 4.8, my - 0.5, 9.6, 1.9, 0.7), { fill: TEETH })]),
      ];
    default:
      return [];
  }
}

function facialHair(rig: Rig): SvgNode[] {
  const { p, h, hairMat } = rig;
  const my = HY + 16.5;
  const hairFill = rig.flat ? hairMat.base : hairMat.paint;
  switch (p.facialHair) {
    case 'stubble':
      return [
        path(
          `M${HX - 14},${HY + 8} Q${HX},${h.bottom + 2} ${HX + 14},${HY + 8} Q${HX},${HY + 20} ${HX - 14},${HY + 8}Z`,
          { fill: hairMat.base, fillOpacity: 0.18 },
        ),
      ];
    case 'beard':
      return paint(
        rig,
        `M${HX - h.rx + 1},${HY + 2} C${HX - h.rx},${HY + 20} ${HX - 10},${h.bottom + 4} ${HX},${h.bottom + 4} C${HX + 10},${h.bottom + 4} ${HX + h.rx},${HY + 20} ${HX + h.rx - 1},${HY + 2} C${HX + h.rx - 4},${HY + 12} ${HX + 8},${HY + 10} ${HX},${HY + 20} C${HX - 8},${HY + 10} ${HX - h.rx + 4},${HY + 12} ${HX - h.rx + 1},${HY + 2}Z`,
        hairMat,
        2,
      );
    case 'moustache':
      return [
        path(
          `M${HX - 7},${my - 2.5} Q${HX - 3},${my - 6} ${HX},${my - 3} Q${HX + 3},${my - 6} ${HX + 7},${my - 2.5} Q${HX},${my - 1} ${HX - 7},${my - 2.5}Z`,
          { fill: hairFill },
        ),
      ];
    case 'goatee':
      return [
        path(
          `M${HX - 5},${my + 4} Q${HX},${h.bottom + 3} ${HX + 5},${my + 4} Q${HX},${my + 6} ${HX - 5},${my + 4}Z`,
          { fill: hairFill },
        ),
        path(
          `M${HX - 6},${my - 2.5} Q${HX},${my - 5} ${HX + 6},${my - 2.5}`,
          stroke(hairMat.base, 1.8),
        ),
      ];
    default:
      return [];
  }
}

function faceDetails(rig: Rig): SvgNode[] {
  if (rig.flat) return [];
  const { p, pose, soft, ctx } = rig;
  const nodes: SvgNode[] = [];
  if (pose.blush) {
    const blush = ctx.glow('blush', '#F08A7A', 0.5);
    nodes.push(
      ellipse(HX - 13, HY + 8.5, 6, 3.5, { fill: blush }),
      ellipse(HX + 13, HY + 8.5, 6, 3.5, { fill: blush }),
    );
  }
  if (p.freckles) {
    for (const [dx, dy] of [
      [-13, 7],
      [-10.5, 9],
      [-14.5, 10],
      [13, 7],
      [10.5, 9],
      [14.5, 10],
    ] as const)
      nodes.push(circle(HX + dx, HY + dy, 0.55, { fill: soft, fillOpacity: 0.5 }));
  }
  if (p.age === 'senior') {
    nodes.push(
      path(
        `M${HX - 15},${HY + 6} q1,3 3,4 M${HX + 15},${HY + 6} q-1,3 -3,4`,
        stroke(soft, 1, { strokeOpacity: 0.55 }),
      ),
      path(
        `M${HX - 8},${HY + 14} q-2,3 -1,6 M${HX + 8},${HY + 14} q2,3 1,6`,
        stroke(soft, 0.9, { strokeOpacity: 0.45 }),
      ),
    );
  }
  return nodes;
}

function glasses(rig: Rig): SvgNode[] {
  const { p } = rig;
  const ex = 9.4;
  const ey = HY + 1;
  const w = rig.flat ? 1.4 : 1.5;
  const lens = rig.flat ? [] : [{ fill: '#FFFFFF', fillOpacity: 0.08 }];
  if (p.glasses === 'round')
    return [
      ...lens.map((a) => circle(HX - ex, ey, 6.4, a)),
      ...lens.map((a) => circle(HX + ex, ey, 6.4, a)),
      circle(HX - ex, ey, 6.4, stroke(FRAME, w)),
      circle(HX + ex, ey, 6.4, stroke(FRAME, w)),
      line(HX - 3, ey - 0.5, HX + 3, ey - 0.5, stroke(FRAME, w - 0.2)),
    ];
  if (p.glasses === 'rect')
    return [
      ...lens.map((a) => path(roundedRect(HX - ex - 6.4, ey - 4.8, 12.8, 9.6, 2.5), a)),
      ...lens.map((a) => path(roundedRect(HX + ex - 6.4, ey - 4.8, 12.8, 9.6, 2.5), a)),
      path(roundedRect(HX - ex - 6.4, ey - 4.8, 12.8, 9.6, 2.5), stroke(FRAME, w)),
      path(roundedRect(HX + ex - 6.4, ey - 4.8, 12.8, 9.6, 2.5), stroke(FRAME, w)),
      line(HX - 3, ey - 1, HX + 3, ey - 1, stroke(FRAME, w - 0.2)),
    ];
  return [];
}

function ears(rig: Rig): SvgNode[] {
  const { p, h, skinMat } = rig;
  if (p.hair === 'headscarf') return [];
  const nodes: SvgNode[] = [];
  const gold = rig.flat ? null : rig.ctx.material('gold', '#E6B35A', 0.2, -0.3);
  for (const side of [-1, 1] as const) {
    const cx = HX + side * (h.rx + 1);
    nodes.push(...paint(rig, ellipsePath(cx, HY + 2, 3.6, 4.8), skinMat, 2.2));
    nodes.push(
      ...detailOnly(rig, () => [
        ellipse(cx, HY + 2.5, 1.7, 2.8, { fill: rig.soft, fillOpacity: 0.45 }),
      ]),
    );
    if (p.earrings === 'studs')
      nodes.push(circle(cx, HY + 5.8, 1.3, { fill: gold ? gold.paint : '#E6B35A' }));
    else if (p.earrings === 'hoops')
      nodes.push(circle(cx, HY + 9.2, 2.7, stroke(gold ? gold.paint : '#E6B35A', 1.4)));
  }
  if (p.extras.includes('earbud'))
    nodes.push(circle(HX + h.rx + 1, HY + 2, 1.8, { fill: '#FFFFFF' }));
  return nodes;
}

function hand(rig: Rig): SvgNode[] {
  const { pose, skinMat } = rig;
  if (pose.hand === 'none') return [];
  const sleeve = rig.clothMat.base;
  const finger = (x: number, y: number, w: number, hgt: number): SvgNode[] =>
    paint(rig, roundedRect(x, y, w, hgt, 1.5), skinMat);
  if (pose.hand === 'wave') {
    const px = 97;
    const py = 68;
    const arm = `M${px - 4},${py + 24} Q${px - 6},${py + 10} ${px - 2},${py + 2}`;
    return [
      path(arm, stroke(sleeve, 8.5)),
      path(arm, stroke(skinMat.base, 5.6)),
      ...paint(rig, roundedRect(px - 7, py - 8, 13, 14, 5), skinMat, 2),
      ...finger(px - 7, py - 16, 3, 10),
      ...finger(px - 3.5, py - 18, 3, 12),
      ...finger(px, py - 17, 3, 11),
      ...finger(px + 3.5, py - 14, 3, 8),
      ...paint(rig, roundedRect(px - 11, py - 4, 5, 3, 1.5), skinMat, 0, {
        transform: `rotate(-30 ${px - 9} ${py - 3})`,
      }),
    ];
  }
  const px = 72;
  const py = 80;
  const arm = `M${px + 14},${py + 30} Q${px + 16},${py + 12} ${px + 4},${py}`;
  return [
    path(arm, stroke(sleeve, 8.5)),
    path(arm, stroke(skinMat.base, 5.6)),
    ...paint(rig, roundedRect(px - 4, py - 9, 11, 12, 4.5), skinMat, 2),
    ...detailOnly(rig, () => [
      path(
        `M${px - 2},${py - 8} q0,-3 3,-3 q3,0 3,3`,
        stroke(rig.soft, 1.1, { strokeOpacity: 0.6 }),
      ),
    ]),
  ];
}

/* ------------------------------------------------------------- portrait --- */

function headGroup(rig: Rig): SvgNode {
  const { h, p, pose, ctx, skinMat } = rig;
  const s = rig.stature.headScale;
  const [front, hairlineShadow] = hairFront(rig);
  const children: SvgNode[] = [
    ...hairBack(rig),
    ...ears(rig),
    ...paint(rig, h.d, skinMat, 3.8),
    ...detailOnly(rig, () => [specular(HX - 9, HY - 12, 6.5, 3.2, 0.2)]),
  ];
  if (hairlineShadow) {
    const t = h.top;
    const r = h.rx;
    const d = `M${HX - r},${t + 14} Q${HX},${t + 2} ${HX + r},${t + 14} Q${HX},${t + 24} ${HX - r},${t + 14}Z`;
    children.push(
      rig.flat
        ? path(d, { fill: rig.soft, fillOpacity: 0.28 })
        : path(d, { fill: ctx.fade('hairshadow', rig.soft, 0.45) }),
    );
  }
  if (rig.flat)
    children.push(
      path(
        `M${HX - 12},${h.bottom - 6} Q${HX},${h.bottom + 2} ${HX + 12},${h.bottom - 6} Q${HX},${h.bottom - 3} ${HX - 12},${h.bottom - 6}Z`,
        { fill: rig.soft, fillOpacity: 0.22 },
      ),
    );
  children.push(
    ...faceDetails(rig),
    ...eyes(rig),
    ...brows(rig),
    ...nose(rig),
    ...mouth(rig),
    ...facialHair(rig),
  );
  children.push(...front);
  if (p.extras.includes('bindi')) children.push(circle(HX, HY - 8, 0.95, { fill: '#B3263D' }));
  children.push(...glasses(rig));
  const transform = `translate(${HX} ${PIVOT_Y}) rotate(${fmt(pose.tilt)}) scale(${fmt(s)}) translate(${-HX} ${-PIVOT_Y})`;
  return g({ transform }, children);
}

/** Build the portrait node tree for a character × expression. */
export function buildPortraitNodes(
  c: LangQuestCharacter,
  expression: CharacterExpression,
  opts: PortraitRenderOptions = {},
): SvgNode[] {
  const theme = opts.theme ?? 'light';
  const detail = opts.detail ?? portraitDetailForSize(opts.size);
  const rig = makeRig(c, expression, theme, detail);
  const { ctx } = rig;
  const discBase = theme === 'dark' ? shade(c.look.backdrop, -0.62) : c.look.backdrop;
  const disc = ctx.material(
    'disc',
    discBase,
    theme === 'dark' ? 0.12 : 0.08,
    theme === 'dark' ? -0.3 : -0.14,
  );
  const discPath = circlePath(60, 60, 56);
  const body = [...torso(rig), headGroup(rig), ...hand(rig)];
  const clipped = g({ clipPath: ctx.clip(discPath) }, body);
  const defs = el('defs', {}, rig.flat ? ctx.defs.filter((n) => n.tag === 'clipPath') : ctx.defs);
  return [defs, path(discPath, { fill: rig.flat ? disc.base : disc.paint }), clipped];
}

/** Accessible label for a portrait (expression appended for assistive tech). */
export function portraitLabel(name: string, expression: CharacterExpression): string {
  return `${name}, ${EXPRESSION_LABELS[expression]}`;
}

/** Full document description for a portrait. */
export function buildPortraitDocument(
  c: LangQuestCharacter,
  expression: CharacterExpression,
  opts: PortraitRenderOptions = {},
): SvgDocument {
  const size = opts.size ?? 120;
  return {
    viewBox: PORTRAIT_VIEWBOX,
    width: size,
    height: size,
    label: portraitLabel(c.name, expression),
    children: buildPortraitNodes(c, expression, { ...opts, size }),
  };
}

/** Standalone `<svg>` markup for a portrait. */
export function portraitSvgString(
  c: LangQuestCharacter,
  expression: CharacterExpression,
  opts: PortraitRenderOptions = {},
): string {
  return toSvgString(buildPortraitDocument(c, expression, opts));
}
