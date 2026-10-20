import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MASCOT_PART_IDS, buildMascotParts } from '../mascot';
import { countNodes } from '../svg-node';
import {
  LOTTIE_FPS,
  LOTTIE_SIZE,
  type LottieAnimation,
  type LottieProp,
  type LottieShape,
  MASCOT_LOTTIE_CLIPS,
  buildMascotLottie,
  matrixToTr,
  parseTransform,
  renderLottieFrameSvg,
  walkLottieShapes,
} from './lottie';

const here = dirname(fileURLToPath(import.meta.url));
const lottieDir = resolve(here, '../../../../../assets/mascot/lottie');

const SHAPE_KINDS = new Set(['gr', 'sh', 'el', 'rc', 'fl', 'st', 'tr']);

/** Structural "schema-ish" check of a bodymovin v5 animation (shape layers only). */
function expectValidLottie(anim: LottieAnimation): void {
  expect(anim.v).toMatch(/^5\./);
  expect(anim.fr).toBe(LOTTIE_FPS);
  expect(anim.ip).toBe(0);
  expect(anim.op).toBeGreaterThan(0);
  expect(anim.w).toBe(LOTTIE_SIZE);
  expect(anim.h).toBe(LOTTIE_SIZE);
  expect(anim.ddd).toBe(0);
  expect(anim.assets).toEqual([]); // no images, no precomps, no fonts
  expect(anim.layers.length).toBeGreaterThan(5);
  const inds = new Set<number>();
  for (const layer of anim.layers) {
    expect([3, 4]).toContain(layer.ty); // null or shape layers only (no text/image/solid)
    expect(inds.has(layer.ind)).toBe(false);
    inds.add(layer.ind);
    expect(layer.ip).toBe(0);
    expect(layer.op).toBe(anim.op);
    for (const key of ['a', 'p', 's', 'r', 'o'] as const) expectValidProp(layer.ks[key]);
    if (layer.ty === 4) expect(layer.shapes?.length ?? 0).toBeGreaterThan(0);
  }
  for (const layer of anim.layers)
    if (layer.parent !== undefined) expect(inds.has(layer.parent)).toBe(true);
  walkLottieShapes(anim, (s) => {
    expect(SHAPE_KINDS.has(s.ty)).toBe(true);
    if (s.ty === 'sh') {
      const k = s.ks.k;
      expect(k.v.length).toBeGreaterThanOrEqual(2);
      expect(k.i.length).toBe(k.v.length);
      expect(k.o.length).toBe(k.v.length);
      for (const p of [...k.v, ...k.i, ...k.o]) {
        expect(p.length).toBe(2);
        for (const n of p) expect(Number.isFinite(n)).toBe(true);
      }
    }
    if (s.ty === 'gr') {
      const last = s.it[s.it.length - 1];
      expect(last?.ty).toBe('tr'); // every group ends with its transform
      for (const inner of s.it) expect(SHAPE_KINDS.has(inner.ty)).toBe(true);
    }
    if (s.ty === 'fl' || s.ty === 'st') {
      expectValidProp(s.c);
      expectValidProp(s.o);
      const c = s.c.a === 0 ? (s.c.k as number[]) : [];
      expect(c.length).toBe(4);
      for (const ch of c) expect(ch >= 0 && ch <= 1).toBe(true);
    }
    if (s.ty === 'tr')
      for (const key of ['a', 'p', 's', 'r', 'o'] as const) expectValidProp(s[key]);
  });
}

function expectValidProp(p: LottieProp): void {
  expect([0, 1]).toContain(p.a);
  if (p.a === 0) {
    const k = p.k;
    for (const n of Array.isArray(k) ? k : [k]) expect(Number.isFinite(n)).toBe(true);
    return;
  }
  expect(p.k.length).toBeGreaterThanOrEqual(2);
  let prev = -1;
  for (const key of p.k) {
    expect(key.t).toBeGreaterThanOrEqual(prev);
    prev = key.t;
    for (const n of key.s) expect(Number.isFinite(n)).toBe(true);
    if (key.i) {
      expect(key.i.x.length).toBe(key.s.length);
      expect(key.o?.x.length).toBe(key.s.length);
    }
  }
}

function countShapeGeometry(anim: LottieAnimation): number {
  let n = 0;
  walkLottieShapes(anim, (s) => {
    if (s.ty === 'sh' || s.ty === 'el' || s.ty === 'rc') n += 1;
  });
  return n;
}

describe('mascot Lottie generator', () => {
  it.each(MASCOT_LOTTIE_CLIPS)(
    '%s is a valid shape-layer animation that references only generated parts',
    (clip) => {
      const anim = buildMascotLottie(clip);
      expectValidLottie(anim);
      const names = anim.layers.map((l) => l.nm);
      expect(names).toContain('root');
      expect(names).toContain('figure');
      expect(names).toContain('breath');
      for (const nm of names)
        expect(['root', 'figure', 'breath', ...MASCOT_PART_IDS]).toContain(nm);
      // Every shape-layer name maps to a non-empty generated part of the clip's base state.
      const state = anim.markers[0]!.cm.split(':')[1] as Parameters<typeof buildMascotParts>[0];
      const parts = buildMascotParts(state, { size: 256 });
      for (const layer of anim.layers) {
        if (layer.ty !== 4) continue;
        const id = layer.nm as (typeof MASCOT_PART_IDS)[number];
        expect(MASCOT_PART_IDS).toContain(id);
        if (id !== 'lidL' && id !== 'lidR') {
          expect(parts.nodes[id].length).toBeGreaterThan(0);
          expect(layer.shapes?.length).toBe(parts.nodes[id].length);
        }
      }
      // Lottie listing is top-most first: props must come before the tail.
      expect(
        names.indexOf('propsFront') === -1 || names.indexOf('propsFront') < names.indexOf('tail'),
      ).toBe(true);
      // Something must animate.
      let animated = 0;
      const visit = (p: LottieProp): void => {
        if (p.a === 1) animated += 1;
      };
      for (const l of anim.layers)
        for (const key of ['a', 'p', 's', 'r', 'o'] as const) visit(l.ks[key]);
      walkLottieShapes(anim, (s: LottieShape) => {
        if (s.ty === 'tr') for (const key of ['a', 'p', 's', 'r', 'o'] as const) visit(s[key]);
      });
      expect(animated).toBeGreaterThan(0);
      // Deterministic.
      expect(JSON.stringify(buildMascotLottie(clip))).toBe(JSON.stringify(anim));
    },
  );

  it('rebuilds a non-trivial SVG at frame 0 and mid-clip (render sanity)', () => {
    for (const clip of MASCOT_LOTTIE_CLIPS) {
      const anim = buildMascotLottie(clip);
      const f0 = renderLottieFrameSvg(anim, 0);
      const mid = renderLottieFrameSvg(anim, Math.floor(anim.op / 2));
      expect(f0.startsWith('<svg')).toBe(true);
      expect(f0).toContain(`viewBox="0 0 ${LOTTIE_SIZE} ${LOTTIE_SIZE}"`);
      expect(f0).not.toContain('NaN');
      expect(f0.length).toBeGreaterThan(4000);
      expect(mid).not.toEqual(f0);
      expect(mid).not.toContain('NaN');
      // Every geometry item of the clip ends up as an element in the rebuilt frame.
      const geoms = countShapeGeometry(anim);
      const elements = (f0.match(/<(path|ellipse|rect)\b/g) ?? []).length;
      expect(elements).toBe(geoms);
      // Geometry count equals what the parts tree draws (lids are the full-circle variant).
      const state = anim.markers[0]!.cm.split(':')[1] as Parameters<typeof buildMascotParts>[0];
      const parts = buildMascotParts(state, { size: 256 });
      const drawn = MASCOT_PART_IDS.filter((id) => id !== 'lidL' && id !== 'lidR').reduce(
        (n, id) => n + countNodes(parts.nodes[id]),
        0,
      );
      expect(geoms).toBeGreaterThanOrEqual(drawn - 4); // groups/polylines counted as nodes, arcs may split
    }
  });

  it('idle breathes and blinks; celebrate bounces with confetti; thinking drifts the eyes', () => {
    const idle = buildMascotLottie('idle');
    const breath = idle.layers.find((l) => l.nm === 'breath')!;
    expect(breath.ks.s.a).toBe(1);
    const lidL = idle.layers.find((l) => l.nm === 'lidL')!;
    expect(lidL.ks.s.a).toBe(1);
    const closed = (lidL.ks.s as { a: 1; k: Array<{ s: number[] }> }).k.some((k) => k.s[1] === 100);
    expect(closed).toBe(true);

    const cel = buildMascotLottie('celebrate_bounce');
    expect(cel.op).toBe(36); // ≤ 1.2 s, skippable
    const bounce = cel.layers.find((l) => l.nm === 'breath')!;
    expect(bounce.ks.p.a).toBe(1);
    const confetti = cel.layers.find((l) => l.nm === 'propsFront')!;
    let moving = 0;
    walkLottieShapes({ ...cel, layers: [confetti] }, (s) => {
      if (s.ty === 'tr' && s.p.a === 1 && s.o.a === 1) moving += 1;
    });
    expect(moving).toBeGreaterThanOrEqual(8);

    const think = buildMascotLottie('thinking');
    const pupilR = think.layers.find((l) => l.nm === 'pupilR')!;
    expect(pupilR.ks.p.a).toBe(1);
    const react = buildMascotLottie('reaction');
    expect(react.op).toBe(12); // ≤ 400 ms
    expect(react.layers.find((l) => l.nm === 'tail')!.ks.r.a).toBe(1);
  });

  it('supports dark theme and course tints', () => {
    const light = JSON.stringify(buildMascotLottie('idle'));
    expect(JSON.stringify(buildMascotLottie('idle', { theme: 'dark' }))).not.toEqual(light);
    expect(JSON.stringify(buildMascotLottie('idle', { trackId: 'japanese' }))).not.toEqual(light);
  });

  it('parses the transforms the geometry uses', () => {
    const tr = matrixToTr(parseTransform('rotate(30 10 20)'));
    expect(tr.r.a === 0 && tr.r.k).toBe(30);
    const t2 = matrixToTr(parseTransform('translate(50,60) scale(2,0.5) translate(-50,-60)'));
    expect(t2.s.a === 0 && t2.s.k).toEqual([200, 50]);
    expect(t2.p.a === 0 && t2.p.k).toEqual([-50, 30]);
    expect(matrixToTr(parseTransform(undefined)).p.a === 0).toBe(true);
  });

  it('the committed assets/mascot/lottie files parse and match the generator', () => {
    if (!existsSync(lottieDir)) return; // assets are regenerated by the export scripts
    for (const clip of MASCOT_LOTTIE_CLIPS) {
      const file = resolve(lottieDir, `${clip}.json`);
      expect(existsSync(file), file).toBe(true);
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as LottieAnimation;
      expectValidLottie(parsed);
      expect(parsed).toEqual(buildMascotLottie(clip));
      const frame = resolve(lottieDir, `${clip}.frame0.svg`);
      expect(readFileSync(frame, 'utf8').trim()).toBe(renderLottieFrameSvg(parsed, 0));
    }
  });
});
