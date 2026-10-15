/**
 * WCAG 2.x contrast utilities. Pure functions, no React / RN imports, so they
 * run in Node tests and in the admin web bundle alike.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0..1, defaults to 1. */
  a: number;
}

const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()` into channels (0..255). */
export function parseColor(input: string): Rgb {
  const trimmed = input.trim();
  const hex = HEX_RE.exec(trimmed);
  if (hex) {
    let h = hex[1] ?? '';
    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const n = parseInt(h, 16);
    if (h.length === 8) {
      return { r: (n >>> 24) & 255, g: (n >>> 16) & 255, b: (n >>> 8) & 255, a: (n & 255) / 255 };
    }
    return { r: (n >>> 16) & 255, g: (n >>> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = RGBA_RE.exec(trimmed);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`Unsupported colour value: ${input}`);
}

/** Alpha-composite `fg` over an opaque `bg`. */
export function composite(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance of an opaque colour (0 black .. 1 white). */
export function relativeLuminance(color: string | Rgb): number {
  const c = typeof color === 'string' ? parseColor(color) : color;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * Contrast ratio (1..21) between a foreground and an opaque background. A
 * translucent foreground is composited over the background first.
 */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  const fg = composite(parseColor(foreground), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export type WcagLevel = 'AA' | 'AAA';
export type WcagTextSize = 'normal' | 'large';

/** Minimum ratio required by WCAG 2.x for text (1.4.3 / 1.4.6). */
export function requiredContrast(level: WcagLevel = 'AA', size: WcagTextSize = 'normal'): number {
  if (level === 'AAA') return size === 'large' ? 4.5 : 7;
  return size === 'large' ? 3 : 4.5;
}

/** Minimum contrast for non-text UI components and graphical objects (WCAG 1.4.11). */
export const UI_COMPONENT_MIN_CONTRAST = 3;

/** True when `foreground` text on `background` meets the WCAG level for the given text size. */
export function meetsWcag(
  foreground: string,
  background: string,
  level: WcagLevel = 'AA',
  size: WcagTextSize = 'normal',
): boolean {
  return contrastRatio(foreground, background) >= requiredContrast(level, size);
}

/** Pick whichever of two candidates contrasts more with `background` (e.g. text on an accent). */
export function pickReadable(background: string, candidates: readonly [string, string]): string {
  const [a, b] = candidates;
  return contrastRatio(a, background) >= contrastRatio(b, background) ? a : b;
}

/** Serialise channels back to `#rrggbb` (alpha dropped when 1, else `#rrggbbaa`). */
export function toHex(color: Rgb): string {
  const h = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  const base = `#${h(color.r)}${h(color.g)}${h(color.b)}`;
  return color.a >= 1 ? base : `${base}${h(color.a * 255)}`;
}

/** Blend a colour towards white (positive) or black (negative) by `amount` in -1..1. */
export function shade(color: string, amount: number): string {
  const c = parseColor(color);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  return toHex({
    r: c.r + (target - c.r) * t,
    g: c.g + (target - c.g) * t,
    b: c.b + (target - c.b) * t,
    a: c.a,
  });
}

/** Apply an alpha to an opaque colour (`#rrggbb` → `rgba(...)`). */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}
