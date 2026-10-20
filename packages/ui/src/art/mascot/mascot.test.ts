import { COURSE_TRACK_IDS, MASCOT_STATE_VALUES } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import {
  MASCOT_ACCESSIBILITY_LABELS,
  MASCOT_NAME,
  MASCOT_PART_IDS,
  MASCOT_POSES,
  MASCOT_STATES,
  buildMascotNodes,
  buildMascotParts,
  mascotMasterSvgString,
  mascotSvgString,
} from '../mascot';
import { MASCOT_PALETTE, mascotBodyTokens } from '../palette';
import { countNodes } from '../svg-node';
import { svgPathToBeziers } from './lottie';
import { tailPath } from './geometry';
import {
  COURSE_FAMILY_IDS,
  COURSE_TRACK_FAMILIES,
  MASCOT_STATE_TINTS,
  courseFamilyTint,
  mascotTint,
  mascotTintTable,
} from './tint';

const KB = 1024;
const isSvg = (s: string): boolean =>
  s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && s.endsWith('</svg>');

/** Relative luminance of a hex colour (WCAG). */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 0xff) + 0.7152 * ch((n >> 8) & 0xff) + 0.0722 * ch(n & 0xff);
}
const contrast = (a: string, b: string): number => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
};

describe('Melo — states', () => {
  it('is named Melo and covers exactly the 17 contract states', () => {
    expect(MASCOT_NAME).toBe('Melo');
    expect(MASCOT_STATES).toEqual(MASCOT_STATE_VALUES);
    expect(Object.keys(MASCOT_POSES).sort()).toEqual([...MASCOT_STATE_VALUES].sort());
    expect(Object.keys(MASCOT_STATE_TINTS).sort()).toEqual([...MASCOT_STATE_VALUES].sort());
    for (const s of MASCOT_STATES) expect(MASCOT_ACCESSIBILITY_LABELS[s]).toMatch(/^Mascot/);
  });

  it.each(MASCOT_STATES)(
    '%s renders in light + dark, full + icon detail, within budget',
    (state) => {
      for (const theme of ['light', 'dark'] as const) {
        const full = mascotSvgString(state, { theme, size: 96 });
        expect(isSvg(full)).toBe(true);
        expect(full).not.toContain('<text');
        expect(full.length).toBeLessThan(8 * KB);
        const icon = mascotSvgString(state, { theme, size: 24 });
        expect(isSvg(icon)).toBe(true);
        expect(icon).toContain('width="24" height="24"');
        expect(icon.length).toBeLessThan(full.length);
        // Icon detail keeps the meaning carriers: crest, both turrets, tail, prop.
        const parts = buildMascotParts(state, { theme, size: 24 });
        expect(parts.detail).toBe('icon');
        expect(parts.nodes.crest.length).toBeGreaterThan(0);
        expect(parts.nodes.turretL.length).toBeGreaterThan(0);
        expect(parts.nodes.turretR.length).toBeGreaterThan(0);
        expect(parts.nodes.tail.length).toBe(1);
        expect(parts.nodes.armL.length).toBe(0);
        expect(parts.nodes.feet.length).toBe(0);
        if (MASCOT_POSES[state].prop !== 'none')
          expect(parts.nodes.propsFront.length + parts.nodes.propsBehind.length).toBeGreaterThan(0);
      }
      // Light and dark are different renders of the same pose.
      expect(mascotSvgString(state, { theme: 'light' })).not.toEqual(
        mascotSvgString(state, { theme: 'dark' }),
      );
    },
  );

  it('every state has a distinct pose/prop signature, not just a colour', () => {
    // Force one tint for all states: silhouettes must still differ.
    const tint = mascotTint({ state: 'neutral' });
    const sigs = new Set(MASCOT_STATES.map((s) => mascotSvgString(s, { tint })));
    expect(sigs.size).toBe(MASCOT_STATES.length);
  });

  it('exposes every named part in paint order and composes them into the node tree', () => {
    expect(MASCOT_PART_IDS[0]).toBe('propsBehind');
    expect(MASCOT_PART_IDS[MASCOT_PART_IDS.length - 1]).toBe('propsFront');
    const parts = buildMascotParts('quiet_audio');
    expect(parts.nodes.propsBehind.length).toBe(1); // headphone band behind the crest
    expect(parts.nodes.propsFront.length).toBe(2); // two cups in front
    const total = MASCOT_PART_IDS.reduce((n, id) => n + countNodes(parts.nodes[id]), 0);
    expect(countNodes(buildMascotNodes('quiet_audio'))).toBe(total + 1); // + the figure group
  });

  it('eyes swivel independently (chameleon trait)', () => {
    const thinking = buildMascotParts('thinking');
    expect(thinking.eyes.left.gaze).not.toEqual(thinking.eyes.right.gaze);
    expect(thinking.eyes.left.lid).toBeGreaterThan(0);
    expect(thinking.eyes.right.lid).toBe(0);
    const scan = buildMascotParts('neutral', { gazeL: [0.8, 0] });
    expect(scan.eyes.left.gaze).toEqual([0.8, 0]);
    expect(scan.eyes.right.gaze).toEqual([0, 0]);
    const wink = buildMascotParts('encouraging');
    expect(wink.eyes.right.shape).toBe('happy');
    expect(wink.nodes.pupilR).toEqual([]);
    expect(wink.nodes.pupilL.length).toBeGreaterThan(0);
  });

  it('animation hooks change the output without changing the node count', () => {
    const base = buildMascotNodes('neutral');
    const n = countNodes(base);
    for (const opts of [
      { blink: 0.6 },
      { breath: 0.9 },
      { tailCurl: 0.2 },
      { headTilt: 8 },
      { gaze: [0.5, -0.5] as const },
    ]) {
      const nodes = buildMascotNodes('neutral', opts);
      expect(JSON.stringify(nodes)).not.toEqual(JSON.stringify(base));
      expect(countNodes(nodes)).toBeGreaterThanOrEqual(n);
    }
    // A full blink adds a lid chord on each open eye.
    expect(countNodes(buildMascotNodes('neutral', { blink: 1 }))).toBe(n + 2);
    // Tail curl 0 still yields one closed polygon.
    expect(tailPath(MASCOT_POSES.neutral.tail, 0)).toMatch(/^M.*Z$/);
  });

  it('layered master carries one group per part plus hidden shape libraries', () => {
    const master = mascotMasterSvgString('light', 512);
    expect(isSvg(master)).toBe(true);
    for (const id of MASCOT_PART_IDS)
      if (id !== 'propsBehind' && id !== 'propsFront') expect(master).toContain(`id="${id}"`);
    expect(master).toContain('id="lidL" opacity="0"');
    expect(master).toContain('id="library-mouths"');
    expect(master).toContain('id="prop-confetti"');
    expect(master).toContain('id="armR-thumbs"');
    expect(master).not.toContain('<text');
    expect(master.length).toBeLessThan(64 * KB);
  });
});

describe('Melo — chameleon tint', () => {
  it('gives every state its own hue and body token', () => {
    const table = mascotTintTable('light');
    const bodies = new Set(Object.values(table).map((t) => t.body));
    expect(bodies.size).toBe(MASCOT_STATES.length);
    expect(Math.round(table.listening.hue)).toBe(174); // sea-teal
    expect(Math.round(table.thinking.hue)).toBe(262); // lavender
    expect(Math.round(table.sleep.hue)).toBe(226); // dusk blue
    expect(table.try_again.hue).toBeLessThan(30); // soft coral
    expect(table.offline.muted).toBe(true);
    expect(table.connection_error.muted).toBe(true);
    expect(table.offline.saturation).toBeLessThan(0.15); // desaturated grey-green
    expect(table.success.saturation).toBeGreaterThan(0.5); // bright leaf
    expect(table.neutral.body).toBe(MASCOT_PALETTE.light.body);
  });

  it('keeps the crest / outline fixed and never carries meaning by colour alone', () => {
    const table = mascotTintTable('light');
    for (const s of MASCOT_STATES) {
      if (!table[s].muted) expect(table[s].crest).toBe(MASCOT_PALETTE.light.crest);
      // Outline on body ≥ 3:1 in both themes (silhouette readable in grayscale).
      for (const theme of ['light', 'dark'] as const) {
        const t = mascotTint({ state: s, theme });
        expect(
          contrast(t.body, MASCOT_PALETTE[theme].outline),
          `${s}/${theme}`,
        ).toBeGreaterThanOrEqual(3);
        expect(luminance(t.bodyShade)).toBeLessThan(luminance(t.body));
        expect(luminance(t.belly)).toBeGreaterThan(luminance(t.body));
      }
    }
    // success and celebrate are readable without their tint: pose + prop differ from neutral.
    const neutralTint = mascotTint({ state: 'neutral' });
    expect(mascotSvgString('success', { tint: neutralTint })).not.toEqual(
      mascotSvgString('neutral'),
    );
    expect(MASCOT_POSES.success.prop).toBe('checkBadge');
    expect(MASCOT_POSES.celebrate.prop).toBe('confetti');
  });

  it('blends the course-family dial into the state hue, with a fallback for unknown tracks', () => {
    for (const id of COURSE_TRACK_IDS) {
      expect(COURSE_FAMILY_IDS).toContain(COURSE_TRACK_FAMILIES[id]);
      expect(courseFamilyTint(id).family).toBe(COURSE_TRACK_FAMILIES[id]);
    }
    expect(courseFamilyTint('klingon')).toEqual({ family: null, hueOffset: 0, hue: 123 });
    expect(courseFamilyTint(null).hueOffset).toBe(0);
    expect(courseFamilyTint('east-asian').hueOffset).toBe(-40);
    const neutralEn = mascotTint({ state: 'neutral', trackId: 'english' });
    const neutralJa = mascotTint({ state: 'neutral', trackId: 'japanese' });
    const neutralSw = mascotTint({ state: 'neutral', courseFamily: 'african' });
    expect(neutralEn.hue).toBe(123);
    expect(neutralJa.hue).toBe(83); // full dial on a mood state
    expect(neutralSw.hue).toBe(189);
    // Signal states keep their identity across courses (reduced family weight).
    const listenEn = mascotTint({ state: 'listening', trackId: 'english' });
    const listenJa = mascotTint({ state: 'listening', trackId: 'japanese' });
    expect(Math.abs(listenEn.hue - listenJa.hue)).toBeLessThan(20);
    expect(listenEn.body).not.toEqual(listenJa.body);
    // courseFamily wins over trackId; explicit tint wins over both.
    expect(
      mascotTint({ state: 'neutral', trackId: 'japanese', courseFamily: 'germanic' }).hue,
    ).toBe(123);
    expect(mascotSvgString('neutral', { tint: neutralJa })).toContain(neutralJa.body);
    expect(mascotSvgString('neutral', { trackId: 'japanese' })).toContain(neutralJa.body);
    expect(mascotSvgString('neutral', { trackId: 'japanese' })).not.toContain(neutralEn.body);
  });

  it('derives body tokens per theme from hue/saturation/lightness', () => {
    const light = mascotBodyTokens('light', 123);
    const dark = mascotBodyTokens('dark', 123);
    expect(light.body).toBe('#6DC071');
    expect(dark.body).not.toBe(light.body);
    expect(luminance(dark.body)).toBeGreaterThan(luminance(light.body));
    expect(mascotBodyTokens('light', 123, 0.4, 0.5).body).toBe('#FFFFFF'); // clamped
  });
});

describe('Melo — path conversion helper', () => {
  it('converts M/L/Q/C/A/Z paths into closed bezier subpaths', () => {
    const [bz] = svgPathToBeziers('M0,0 L10,0 Q15,5 10,10 A5,5 0 0 1 0,10 Z');
    expect(bz?.c).toBe(true);
    expect(bz?.v.length).toBeGreaterThanOrEqual(4);
    expect(bz?.v[0]).toEqual([0, 0]);
    expect(bz?.i.length).toBe(bz?.v.length);
    expect(bz?.o.length).toBe(bz?.v.length);
    const open = svgPathToBeziers('M1,1 C2,2 3,3 4,4');
    expect(open[0]?.c).toBe(false);
    expect(open[0]?.o[0]).toEqual([1, 1]);
    expect(open[0]?.i[1]).toEqual([-1, -1]);
    expect(svgPathToBeziers('M0,0 L5,5 M10,10 L20,20').length).toBe(2);
    expect(() => svgPathToBeziers('M0,0 X1')).toThrow(/Unsupported/);
  });
});
