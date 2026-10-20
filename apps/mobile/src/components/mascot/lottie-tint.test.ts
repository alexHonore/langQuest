import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TINTED_LOTTIE_LAYERS, hexToLottieRgba, lottieBaseColors, tintLottieClip, type LottieClipLike } from './lottie-tint';

const CLIP_DIR = fileURLToPath(new URL('../../../../../assets/mascot/lottie', import.meta.url));
const load = (name: string): LottieClipLike => JSON.parse(readFileSync(resolve(CLIP_DIR, `${name}.json`), 'utf8')) as LottieClipLike;
const TINT = { body: '#e07a5f', bodyShade: '#b85c43', crest: '#f2cc8f' };

type Shape = { ty?: string; nm?: string; it?: Shape[]; c?: { a: number; k: unknown } };
type Layer = { nm?: string; shapes?: Shape[] };
const rgb = (k: unknown): string => (Array.isArray(k) ? k.slice(0, 3).map((v: number) => Math.round(v * 1000)).join(',') : '');
const key = (hex: string): string => rgb(hexToLottieRgba(hex));
function* walk(shapes: Shape[] | undefined): Generator<Shape> {
  for (const s of shapes ?? []) {
    yield s;
    if (s.it) yield* walk(s.it);
  }
}
const layer = (clip: LottieClipLike, nm: string): Layer | undefined => (clip.layers as Layer[] | undefined)?.find((l) => l.nm === nm);

describe('tintLottieClip', () => {
  it('converts hex to the generator’s 3-decimal rgba', () => {
    expect(hexToLottieRgba('#ffffff')).toEqual([1, 1, 1, 1]);
    expect(hexToLottieRgba('#000000')).toEqual([0, 0, 0, 1]);
    expect(hexToLottieRgba('6dc071')).toEqual([0.427, 0.753, 0.443, 1]);
    expect(hexToLottieRgba('nope')).toEqual([0, 0, 0, 1]);
  });

  for (const name of ['idle', 'reaction', 'celebrate_bounce', 'thinking']) {
    it(`${name}: tints every body-coloured layer and leaves the belly, crest and outline alone`, () => {
      const clip = load(name);
      const base = lottieBaseColors(clip);
      expect(base.body).toBeTruthy();
      expect(base.bodyShade).toBeTruthy();
      expect(base.crest).toBeTruthy();
      const out = tintLottieClip(clip, TINT);
      expect(out).not.toBe(clip);
      // Immutability: the bundled clip object is not mutated.
      expect(rgb(([...walk(layer(clip, 'tail')?.shapes)].find((s) => s.ty === 'fl') as Shape).c?.k)).toBe(base.body);

      for (const nm of TINTED_LOTTIE_LAYERS) {
        const l = layer(out, nm);
        if (!l) continue; // a clip may omit a layer (e.g. no lids on a happy pose)
        for (const s of walk(l.shapes)) {
          if (s.ty === 'fl') expect([base.body, base.bodyShade, base.crest], `${name}/${nm} fill still wears a base colour`).not.toContain(rgb(s.c?.k));
          if (s.ty === 'st') expect(rgb(s.c?.k), `${name}/${nm} stroke changed`).not.toBe(key(TINT.body));
        }
      }
      // Limbs, tail and turrets now wear the tint body colour somewhere.
      for (const nm of ['tail', 'armL', 'armR', 'feet', 'turretL', 'turretR']) {
        const fillsOf = [...walk(layer(out, nm)?.shapes)].filter((s) => s.ty === 'fl').map((s) => rgb(s.c?.k));
        expect(fillsOf.some((c) => c === key(TINT.body) || c === key(TINT.bodyShade)), `${name}/${nm} has no tinted fill`).toBe(true);
      }
      // Belly: the body layer keeps exactly one fill that is neither base nor tint body colour (the belly ellipse).
      const bodyFills = [...walk(layer(out, 'body')?.shapes)].filter((s) => s.ty === 'fl').map((s) => rgb(s.c?.k));
      expect(bodyFills).toContain(key(TINT.body));
      expect(bodyFills.filter((c) => c !== key(TINT.body) && c !== key(TINT.bodyShade))).toHaveLength(1);
      // Crest layer untouched (deep-equal to the input).
      expect(layer(out, 'crest')).toEqual(layer(clip, 'crest'));
      // Outline strokes unchanged everywhere.
      const strokesIn = (c: LottieClipLike): string[] => (c.layers as Layer[]).flatMap((l) => [...walk(l.shapes)].filter((s) => s.ty === 'st').map((s) => rgb(s.c?.k)));
      expect(strokesIn(out)).toEqual(strokesIn(clip));
    });
  }

  it('returns the input when there is nothing to recolour', () => {
    const empty: LottieClipLike = { layers: [] };
    expect(tintLottieClip(empty, TINT)).toBe(empty);
    const noLayers: LottieClipLike = {};
    expect(tintLottieClip(noLayers, TINT)).toBe(noLayers);
  });
});
