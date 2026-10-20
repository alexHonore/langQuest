/**
 * The C2 "soft dimensional" (clay / plush) recipe, as shared helpers.
 *
 * Every shape is: flat base value → focal radial gradient (warm key light from the
 * upper-left: fx 0.33 / fy 0.27, three stops at 0 / 0.52 / 1) → a cool rim light
 * (#EEF5FF) stroked along the lower-right edge and clipped to the shape itself →
 * optional specular and contact shadow. There are no outlines: touching materials
 * separate by value. Only gradients, clip paths and opacity are used (no filters), so
 * the output renders identically in browsers and in react-native-svg.
 *
 * The helpers are the single source of truth for the look (style-sheet rule: never
 * reproduce the stops by hand). `ClayContext` collects the gradient / clipPath defs a
 * portrait needs, with ids prefixed per character so several portraits can share one DOM.
 */
import { shade } from '../palette';
import {
  type SvgAttrValue,
  type SvgNode,
  el,
  fmt,
  linearGradient,
  path,
  radialGradient,
} from '../svg-node';

/** Cool rim light colour (C2 style sheet). */
export const RIM_COLOR = '#EEF5FF';
/** Contact-shadow ink (C2 style sheet). */
export const SHADOW_INK = '#3A2418';
/** Rim-light peak opacity per theme (dark mode raises the rim to 80 %). */
export const RIM_OPACITY = { light: 0.62, dark: 0.8 } as const;
/** Focal point of the warm key light, in object bounding-box units. */
export const KEY_LIGHT = { cx: 0.42, cy: 0.38, r: 0.8, fx: 0.33, fy: 0.27 } as const;

/** Linear blend of two hex colours (`t` = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const ch = (shift: number): number => {
    const ca = (pa >> shift) & 0xff;
    const cb = (pb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * Math.min(1, Math.max(0, t)));
  };
  const hex = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${hex(ch(16))}${hex(ch(8))}${hex(ch(0))}`.toUpperCase();
}

/** A shaded material: highlight / base / shadow values plus the gradient id to paint with. */
export interface ClayMaterial {
  id: string;
  base: string;
  hi: string;
  lo: string;
  /** `url(#id)` paint. */
  paint: string;
}

export interface ClayContextOptions {
  /** Id prefix (per character × theme) so several portraits can share a DOM. */
  prefix: string;
  /** Rim-light peak opacity. */
  rimOpacity: number;
}

/**
 * Collects the `<defs>` of one portrait and paints shapes with the recipe.
 * In `flat` mode nothing is registered and shapes are painted with their base value only
 * (the ≤ 48 px level of detail).
 */
export class ClayContext {
  readonly defs: SvgNode[] = [];
  readonly rimPaint: string;
  readonly shadowPaint: string;
  private readonly materials = new Map<string, ClayMaterial>();
  private clips = 0;
  private readonly prefix: string;

  constructor(opts: ClayContextOptions) {
    this.prefix = opts.prefix;
    const rimId = `${this.prefix}-rim`;
    const shadowId = `${this.prefix}-shadow`;
    this.rimPaint = `url(#${rimId})`;
    this.shadowPaint = `url(#${shadowId})`;
    this.defs.push(
      linearGradient(
        rimId,
        [
          [0.5, RIM_COLOR, 0],
          [1, RIM_COLOR, opts.rimOpacity],
        ],
        { x1: 0, y1: 0, x2: 1, y2: 1 },
      ),
      radialGradient(shadowId, [
        [0, SHADOW_INK, 0.38],
        [0.6, SHADOW_INK, 0.17],
        [1, SHADOW_INK, 0],
      ]),
    );
  }

  /**
   * Register (once) a three-stop focal material. `hi` / `lo` are `shade()` amounts
   * relative to the base value (defaults follow the style sheet: +20 % / −32 %).
   */
  material(name: string, base: string, hi = 0.2, lo = -0.32): ClayMaterial {
    const existing = this.materials.get(name);
    if (existing) return existing;
    const id = `${this.prefix}-${name}`;
    const mat: ClayMaterial = {
      id,
      base,
      hi: shade(base, hi),
      lo: shade(base, lo),
      paint: `url(#${id})`,
    };
    this.defs.push(
      radialGradient(
        id,
        [
          [0, mat.hi],
          [0.52, mat.base],
          [1, mat.lo],
        ],
        KEY_LIGHT,
      ),
    );
    this.materials.set(name, mat);
    return mat;
  }

  /** A vertical fade (`color` at `topOpacity` → transparent) for hair shadows and neck shade. */
  fade(name: string, color: string, topOpacity: number): string {
    const id = `${this.prefix}-${name}`;
    if (!this.materials.has(id)) {
      this.defs.push(
        linearGradient(id, [
          [0, color, topOpacity],
          [1, color, 0],
        ]),
      );
      this.materials.set(id, { id, base: color, hi: color, lo: color, paint: `url(#${id})` });
    }
    return `url(#${id})`;
  }

  /** A soft radial blob (`color` at `opacity` in the centre → transparent). */
  glow(name: string, color: string, opacity: number): string {
    const id = `${this.prefix}-${name}`;
    if (!this.materials.has(id)) {
      this.defs.push(
        radialGradient(id, [
          [0, color, opacity],
          [1, color, 0],
        ]),
      );
      this.materials.set(id, { id, base: color, hi: color, lo: color, paint: `url(#${id})` });
    }
    return `url(#${id})`;
  }

  /** Register a clip path for `d` and return its `url(#…)` reference. */
  clip(d: string, extra: Record<string, SvgAttrValue> = {}): string {
    this.clips += 1;
    const id = `${this.prefix}-c${this.clips}`;
    this.defs.push(el('clipPath', { id }, [path(d, extra)]));
    return `url(#${id})`;
  }

  /**
   * Paint a path with a material: gradient fill plus, when `rim` > 0, the clipped
   * cool rim light along the lower-right edge. `extra` attributes (e.g. a transform)
   * apply to both the fill and the rim.
   */
  shape(
    d: string,
    mat: ClayMaterial,
    rim = 0,
    extra: Record<string, SvgAttrValue> = {},
  ): SvgNode[] {
    const nodes: SvgNode[] = [path(d, { fill: mat.paint, ...extra })];
    if (rim > 0) {
      nodes.push(
        path(d, {
          fill: 'none',
          stroke: this.rimPaint,
          strokeWidth: rim,
          clipPath: this.clip(d, extra.transform ? { transform: extra.transform } : {}),
          ...extra,
        }),
      );
    }
    return nodes;
  }

  /** Soft contact shadow (an ellipse of the shadow gradient). */
  contactShadow(cx: number, cy: number, rx: number, ry: number): SvgNode {
    return el('ellipse', { cx, cy, rx, ry, fill: this.shadowPaint });
  }
}

/** Elliptical specular highlight (white at `opacity`), rotated towards the key light. */
export function specular(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  opacity: number,
  angle = -28,
): SvgNode {
  return el('ellipse', {
    cx,
    cy,
    rx,
    ry,
    transform: `rotate(${fmt(angle)} ${fmt(cx)} ${fmt(cy)})`,
    fill: '#FFFFFF',
    fillOpacity: opacity,
  });
}

/** Closed elliptical path (so ellipses can be clipped / rim-lit like any other shape). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${fmt(cx - rx)},${fmt(cy)} a${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(rx * 2)},0 a${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(-rx * 2)},0Z`;
}

/** Closed circular path. */
export const circlePath = (cx: number, cy: number, r: number): string => ellipsePath(cx, cy, r, r);
