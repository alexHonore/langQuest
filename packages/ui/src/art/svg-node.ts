/**
 * Renderer-agnostic SVG scene graph.
 *
 * Every piece of LangQuest artwork (mascot, character portraits, scenes, covers,
 * icons) is described ONCE as a tree of {@link SvgNode}s. Two renderers consume
 * that tree: {@link toSvgString} (standalone `<svg>` markup for web/admin/static
 * exports) and the react-native-svg renderer in `./native.tsx`. Keeping geometry
 * in plain data guarantees the mobile app and the exported static files never
 * drift apart.
 *
 * Attribute names use the camelCase form accepted by react-native-svg
 * (`strokeWidth`, `fillOpacity`, `clipPath`, …); the string renderer converts
 * them to the kebab-case SVG attribute names.
 */

export type SvgTag =
  | 'g'
  | 'circle'
  | 'ellipse'
  | 'path'
  | 'rect'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'defs'
  | 'linearGradient'
  | 'radialGradient'
  | 'stop'
  | 'clipPath';

export type SvgAttrValue = string | number | undefined;

export interface SvgNode {
  tag: SvgTag;
  attrs: Record<string, SvgAttrValue>;
  children?: SvgNode[];
}

/** Top-level document description shared by both renderers. */
export interface SvgDocument {
  viewBox: { x: number; y: number; width: number; height: number };
  /** Rendered width/height (CSS px on web, dp in React Native). */
  width: number;
  height: number;
  /** Accessible description (never rendered as visible text). */
  label: string;
  children: SvgNode[];
}

/** Round to two decimals and drop trailing zeros so exports stay compact. */
export function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 100) / 100;
  return String(r).replace(/\.?0+$/, '');
}

/** Convenience node constructor. */
export function el(
  tag: SvgTag,
  attrs: Record<string, SvgAttrValue> = {},
  children?: SvgNode[],
): SvgNode {
  return children && children.length > 0 ? { tag, attrs, children } : { tag, attrs };
}

export const g = (attrs: Record<string, SvgAttrValue>, children: SvgNode[]): SvgNode =>
  el('g', attrs, children);
export const circle = (
  cx: number,
  cy: number,
  r: number,
  attrs: Record<string, SvgAttrValue> = {},
): SvgNode => el('circle', { cx, cy, r, ...attrs });
export const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  attrs: Record<string, SvgAttrValue> = {},
): SvgNode => el('ellipse', { cx, cy, rx, ry, ...attrs });
export const path = (d: string, attrs: Record<string, SvgAttrValue> = {}): SvgNode =>
  el('path', { d, ...attrs });
export const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  attrs: Record<string, SvgAttrValue> = {},
): SvgNode => el('rect', { x, y, width, height, ...attrs });
export const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  attrs: Record<string, SvgAttrValue> = {},
): SvgNode => el('line', { x1, y1, x2, y2, ...attrs });
export const polyline = (
  points: ReadonlyArray<readonly [number, number]>,
  attrs: Record<string, SvgAttrValue> = {},
): SvgNode =>
  el('polyline', { points: points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' '), ...attrs });
export const polygon = (
  points: ReadonlyArray<readonly [number, number]>,
  attrs: Record<string, SvgAttrValue> = {},
): SvgNode =>
  el('polygon', { points: points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' '), ...attrs });

/** Stroke helper for consistent rounded line work. */
export function stroke(
  color: string,
  width: number,
  extra: Record<string, SvgAttrValue> = {},
): Record<string, SvgAttrValue> {
  return {
    fill: 'none',
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...extra,
  };
}

/** Linear gradient definition (vertical by default). */
export function linearGradient(
  id: string,
  stops: ReadonlyArray<readonly [offset: number, color: string, opacity?: number]>,
  coords: { x1?: number; y1?: number; x2?: number; y2?: number } = {},
): SvgNode {
  const { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = coords;
  return el(
    'linearGradient',
    { id, x1, y1, x2, y2 },
    stops.map(([offset, color, opacity]) =>
      el('stop', { offset: `${fmt(offset * 100)}%`, stopColor: color, stopOpacity: opacity }),
    ),
  );
}

/** Radial gradient definition. */
export function radialGradient(
  id: string,
  stops: ReadonlyArray<readonly [offset: number, color: string, opacity?: number]>,
  coords: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number } = {},
): SvgNode {
  const { cx = 0.5, cy = 0.5, r = 0.5, fx, fy } = coords;
  return el(
    'radialGradient',
    { id, cx, cy, r, fx, fy },
    stops.map(([offset, color, opacity]) =>
      el('stop', { offset: `${fmt(offset * 100)}%`, stopColor: color, stopOpacity: opacity }),
    ),
  );
}

/** Build a rounded "pebble" path (superellipse-ish blob) centred at (cx, cy). */
export function pebble(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  squashTop = 0.92,
  squashBottom = 1,
): string {
  const k = 0.5523; // circle approximation constant
  const rt = ry * squashTop;
  const rb = ry * squashBottom;
  return [
    `M${fmt(cx - rx)},${fmt(cy)}`,
    `C${fmt(cx - rx)},${fmt(cy - rt * k)} ${fmt(cx - rx * k)},${fmt(cy - rt)} ${fmt(cx)},${fmt(cy - rt)}`,
    `C${fmt(cx + rx * k)},${fmt(cy - rt)} ${fmt(cx + rx)},${fmt(cy - rt * k)} ${fmt(cx + rx)},${fmt(cy)}`,
    `C${fmt(cx + rx)},${fmt(cy + rb * k)} ${fmt(cx + rx * k)},${fmt(cy + rb)} ${fmt(cx)},${fmt(cy + rb)}`,
    `C${fmt(cx - rx * k)},${fmt(cy + rb)} ${fmt(cx - rx)},${fmt(cy + rb * k)} ${fmt(cx - rx)},${fmt(cy)}`,
    'Z',
  ].join('');
}

/** Rounded rectangle path with per-corner radii [tl, tr, br, bl]. */
export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number | readonly [number, number, number, number],
): string {
  const [tl, tr, br, bl] = typeof radii === 'number' ? [radii, radii, radii, radii] : radii;
  return [
    `M${fmt(x + tl)},${fmt(y)}`,
    `H${fmt(x + w - tr)}`,
    `A${fmt(tr)},${fmt(tr)} 0 0 1 ${fmt(x + w)},${fmt(y + tr)}`,
    `V${fmt(y + h - br)}`,
    `A${fmt(br)},${fmt(br)} 0 0 1 ${fmt(x + w - br)},${fmt(y + h)}`,
    `H${fmt(x + bl)}`,
    `A${fmt(bl)},${fmt(bl)} 0 0 1 ${fmt(x)},${fmt(y + h - bl)}`,
    `V${fmt(y + tl)}`,
    `A${fmt(tl)},${fmt(tl)} 0 0 1 ${fmt(x + tl)},${fmt(y)}`,
    'Z',
  ].join('');
}

/** Regular polygon / star points helper. */
export function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points = 5,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* String renderer                                                          */
/* ------------------------------------------------------------------------ */

const ATTR_NAME_OVERRIDES: Record<string, string> = {
  viewBox: 'viewBox',
  gradientUnits: 'gradientUnits',
  gradientTransform: 'gradientTransform',
  clipPathUnits: 'clipPathUnits',
  patternUnits: 'patternUnits',
  preserveAspectRatio: 'preserveAspectRatio',
  spreadMethod: 'spreadMethod',
};

/** camelCase → kebab-case for SVG presentation attributes. */
export function svgAttrName(name: string): string {
  const override = ATTR_NAME_OVERRIDES[name];
  if (override) return override;
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attrsToString(attrs: Record<string, SvgAttrValue>): string {
  let out = '';
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === 'number' ? fmt(v) : v;
    out += ` ${svgAttrName(k)}="${escapeAttr(s)}"`;
  }
  return out;
}

/** Serialise one node (and its subtree) to SVG markup. */
export function nodeToString(node: SvgNode): string {
  const open = `<${node.tag}${attrsToString(node.attrs)}`;
  if (!node.children || node.children.length === 0) return `${open}/>`;
  return `${open}>${node.children.map(nodeToString).join('')}</${node.tag}>`;
}

/**
 * Serialise a whole document to a standalone, accessible `<svg>` string.
 * The accessible label goes into `<title>` (assistive technology), never into
 * visible text, so exports stay free of baked-in words.
 */
export function toSvgString(doc: SvgDocument): string {
  const { x, y, width, height } = doc.viewBox;
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(width)} ${fmt(height)}" ` +
    `width="${fmt(doc.width)}" height="${fmt(doc.height)}" role="img" aria-label="${escapeAttr(doc.label)}">`;
  return `${head}<title>${escapeText(doc.label)}</title>${doc.children.map(nodeToString).join('')}</svg>`;
}

/** Count nodes in a tree (used by tests to bound complexity). */
export function countNodes(nodes: readonly SvgNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node.children) n += countNodes(node.children);
  }
  return n;
}
