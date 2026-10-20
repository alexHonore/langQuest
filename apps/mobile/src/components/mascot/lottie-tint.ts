/**
 * Chameleon tint for the Lottie clips of Melo (pure, platform-free).
 *
 * `lottie-react-native`'s `colorFilters` recolour every colour property under a layer, strokes
 * included, so filtering the `body` layer would also paint the outline and the belly. Instead the
 * clip is recoloured in data: every *fill* on a body-coloured layer (`tail`, `armL`, `armR`,
 * `feet`, `turretL`, `turretR`, `body`, `bands`) that wears the clip's own body / body-shade /
 * crest colour is swapped for the tint; strokes (the outline), the belly, the crest layer, eyes,
 * mouth, cheeks and props are left untouched. The reference colours are read from the clip itself
 * (the `body` and `crest` layers), so a regenerated clip with a different base palette still tints.
 */
import type { MascotTint } from '@langquest/ui';

/** Layers whose fills follow the chameleon tint (the belly ellipse inside `body` is excluded by colour). */
export const TINTED_LOTTIE_LAYERS: readonly string[] = ['tail', 'armL', 'armR', 'feet', 'turretL', 'turretR', 'body', 'bands'];

type Rgba = readonly [number, number, number, number];
interface LottieColorProp {
  a: 0 | 1;
  k: Rgba | readonly number[] | unknown;
}
interface LottieShapeLike {
  ty?: string;
  nm?: string;
  it?: LottieShapeLike[];
  c?: LottieColorProp;
}
interface LottieLayerLike {
  nm?: string;
  shapes?: LottieShapeLike[];
}
/** The subset of a Lottie document the tint touches (`lottie-react-native`'s `AnimationObject` satisfies it). */
export interface LottieClipLike {
  layers?: LottieLayerLike[];
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** `#rrggbb` → Lottie `[r, g, b, 1]` (0..1 floats, 3 decimals like the generator). */
export function hexToLottieRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0, 1];
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return [Math.round(clamp01(r) * 1000) / 1000, Math.round(clamp01(g) * 1000) / 1000, Math.round(clamp01(b) * 1000) / 1000, 1];
}

const colorKey = (k: unknown): string | null => {
  if (!Array.isArray(k) || k.length < 3 || !k.slice(0, 3).every((v) => typeof v === 'number')) return null;
  return k
    .slice(0, 3)
    .map((v: number) => Math.round(v * 1000))
    .join(',');
};

function* fills(shapes: readonly LottieShapeLike[] | undefined): Generator<LottieShapeLike> {
  for (const s of shapes ?? []) {
    if (s.ty === 'fl' && s.c) yield s;
    if (s.it) yield* fills(s.it);
  }
}

/** Paint-order index of a group named `<layer>-<i>` (the generator names groups that way). */
const groupIndex = (nm: string | undefined, layer: string): number | null => {
  if (!nm || !nm.startsWith(`${layer}-`)) return null;
  const n = Number(nm.slice(layer.length + 1));
  return Number.isInteger(n) ? n : null;
};

/** The clip's own body, body-shade and crest colours (first fill of `body-0`, `body-1` and the `crest` layer). */
export function lottieBaseColors(clip: LottieClipLike): { body: string | null; bodyShade: string | null; crest: string | null } {
  const layer = (name: string): LottieLayerLike | undefined => clip.layers?.find((l) => l.nm === name);
  const firstFill = (shapes: readonly LottieShapeLike[] | undefined): string | null => {
    for (const f of fills(shapes)) {
      const key = colorKey(f.c?.k);
      if (key) return key;
    }
    return null;
  };
  const body = layer('body');
  const group = (i: number): LottieShapeLike | undefined => body?.shapes?.find((s) => groupIndex(s.nm, 'body') === i);
  return { body: firstFill(group(0) ? [group(0)!] : undefined), bodyShade: firstFill(group(1) ? [group(1)!] : undefined), crest: firstFill(layer('crest')?.shapes) };
}

/**
 * A copy of `clip` whose body-coloured fills wear `tint`. Static colours only (`a: 0`); animated
 * colour properties and everything that is not a body / body-shade / crest fill are untouched.
 * Returns the input itself when there is nothing to recolour (no layers, no base colours).
 */
export function tintLottieClip<T extends LottieClipLike>(clip: T, tint: Pick<MascotTint, 'body' | 'bodyShade' | 'crest'>): T {
  const base = lottieBaseColors(clip);
  if (!clip.layers || (!base.body && !base.bodyShade && !base.crest)) return clip;
  const replacement = new Map<string, [number, number, number, number]>();
  if (base.body) replacement.set(base.body, hexToLottieRgba(tint.body));
  if (base.bodyShade) replacement.set(base.bodyShade, hexToLottieRgba(tint.bodyShade));
  if (base.crest) replacement.set(base.crest, hexToLottieRgba(tint.crest));
  const tinted = TINTED_LOTTIE_LAYERS;
  let changed = false;
  const mapShape = (s: LottieShapeLike): LottieShapeLike => {
    if (s.ty === 'fl' && s.c && s.c.a === 0) {
      const key = colorKey(s.c.k);
      const next = key ? replacement.get(key) : undefined;
      if (next) {
        changed = true;
        const alpha = Array.isArray(s.c.k) && typeof s.c.k[3] === 'number' ? (s.c.k[3] as number) : 1;
        return { ...s, c: { ...s.c, k: [next[0], next[1], next[2], alpha] } };
      }
      return s;
    }
    if (s.it) return { ...s, it: s.it.map(mapShape) };
    return s;
  };
  const layers = clip.layers.map((l) => (l.nm && tinted.includes(l.nm) && l.shapes ? { ...l, shapes: l.shapes.map(mapShape) } : l));
  return changed ? ({ ...clip, layers } as T) : clip;
}
