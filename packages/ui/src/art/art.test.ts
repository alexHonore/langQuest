import {
  CHARACTER_EXPRESSION_VALUES,
  COURSE_TRACK_IDS,
  CharacterVisualProfileSchema,
  MASCOT_STATE_VALUES,
} from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_EXPRESSIONS,
  CHARACTER_ROSTER,
  characterPortraitSvgString,
  charactersForVariety,
  findCharacter,
} from './characters';
import { COVER_RECIPES, buildCoverDocument, courseCoverSvgString, coverAltTextKey } from './covers';
import { ICON_NAMES, iconSvgString } from './icons';
import { ART_MANIFEST, listArtExports } from './manifest';
import {
  MASCOT_ACCESSIBILITY_LABELS,
  MASCOT_POSES,
  MASCOT_STATES,
  buildMascotNodes,
  mascotLabelKey,
  mascotSpeechKey,
  mascotSvgString,
} from './mascot';
import { SCENES, sceneArtSvgString } from './scenes';
import { countNodes, svgAttrName, toSvgString } from './svg-node';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KB = 1024;
const isSvg = (s: string): boolean =>
  s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && s.endsWith('</svg>');

describe('svg-node renderer', () => {
  it('kebab-cases presentation attributes but keeps viewBox-style names', () => {
    expect(svgAttrName('strokeWidth')).toBe('stroke-width');
    expect(svgAttrName('clipPath')).toBe('clip-path');
    expect(svgAttrName('viewBox')).toBe('viewBox');
    expect(svgAttrName('gradientUnits')).toBe('gradientUnits');
  });
  it('escapes labels and omits undefined attrs', () => {
    const s = toSvgString({
      viewBox: { x: 0, y: 0, width: 1, height: 1 },
      width: 1,
      height: 1,
      label: 'a < b & "c"',
      children: [{ tag: 'rect', attrs: { x: 0, fill: undefined } }],
    });
    expect(s).toContain('aria-label="a &lt; b &amp; &quot;c&quot;"');
    expect(s).toContain('<rect x="0"/>');
    expect(s).not.toContain('fill');
  });
});

describe('mascot i18n keys', () => {
  type Catalog = { readonly [key: string]: string | Catalog };
  const here = dirname(fileURLToPath(import.meta.url));
  const en = JSON.parse(
    readFileSync(resolve(here, '../../../locales/src/catalogs/en.json'), 'utf8'),
  ) as Catalog;
  const lookup = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (acc, k) => (acc && typeof acc === 'object' ? (acc as Catalog)[k] : undefined),
        en,
      );

  it('mascotLabelKey points at the accessibility label namespace, mascotSpeechKey at the speech copy', () => {
    for (const state of MASCOT_STATE_VALUES) {
      expect(mascotLabelKey(state)).toBe(`mascot.a11yState.${state}`);
      expect(mascotSpeechKey(state)).toBe(`mascot.state.${state}`);
      expect(typeof lookup(mascotLabelKey(state)), state).toBe('string');
      expect(typeof lookup(mascotSpeechKey(state)), state).toBe('string');
      expect(MASCOT_ACCESSIBILITY_LABELS[state]).toBeTruthy();
    }
  });
});

describe('mascot', () => {
  it('exposes exactly the 17 contract states in order', () => {
    expect(MASCOT_STATES).toEqual(MASCOT_STATE_VALUES);
    expect(Object.keys(MASCOT_POSES).sort()).toEqual([...MASCOT_STATE_VALUES].sort());
  });
  it.each(MASCOT_STATES)('renders %s as non-empty svg in both themes and at icon size', (state) => {
    for (const theme of ['light', 'dark'] as const) {
      const svg = mascotSvgString(state, { theme, size: 96 });
      expect(isSvg(svg)).toBe(true);
      expect(svg).toContain('<title>');
      expect(svg.length).toBeLessThan(12 * KB);
    }
    const icon = mascotSvgString(state, { size: 24 });
    expect(isSvg(icon)).toBe(true);
    expect(icon.length).toBeLessThan(mascotSvgString(state, { size: 400 }).length + 1);
    expect(icon).toContain('width="24" height="24"');
  });
  it('never bakes visible text into the artwork', () => {
    for (const state of MASCOT_STATES) expect(mascotSvgString(state)).not.toContain('<text');
  });
  it('every state has a distinct silhouette/pose signature', () => {
    const sigs = new Set(MASCOT_STATES.map((s) => mascotSvgString(s)));
    expect(sigs.size).toBe(MASCOT_STATES.length);
  });
  it('supports animation phases without changing node count', () => {
    const a = countNodes(buildMascotNodes('neutral'));
    const b = countNodes(buildMascotNodes('neutral', { blink: 0.5, breath: 0.8 }));
    expect(b).toBeGreaterThanOrEqual(a);
    expect(mascotSvgString('neutral')).not.toEqual(
      toSvgString({
        viewBox: { x: 0, y: 0, width: 100, height: 100 },
        width: 96,
        height: 96,
        label: 'x',
        children: buildMascotNodes('neutral', { blink: 1 }),
      }),
    );
  });
});

describe('characters', () => {
  it('has at least 12 characters with stable ids and contract-valid profiles', () => {
    expect(CHARACTER_ROSTER.length).toBeGreaterThanOrEqual(12);
    const ids = new Set(CHARACTER_ROSTER.map((c) => c.id));
    expect(ids.size).toBe(CHARACTER_ROSTER.length);
    expect(ids.has('ary-cafe-staff-nadia')).toBe(true);
    for (const c of CHARACTER_ROSTER) {
      const parsed = CharacterVisualProfileSchema.safeParse(c);
      expect(parsed.success, `${c.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(c.complete).toBe(false); // no reviewed visual_assets rows yet — honest status
      expect(c.trackIds.length).toBeGreaterThan(0);
    }
  });
  it('character ids are findable by slug and by uuid', () => {
    const nadia = findCharacter('ary-cafe-staff-nadia');
    expect(nadia?.name).toBe('Nadia');
    expect(findCharacter(nadia!.characterId)?.id).toBe('ary-cafe-staff-nadia');
    expect(
      charactersForVariety('ary')
        .map((c) => c.id)
        .slice(0, 2),
    ).toEqual(['ary-cafe-staff-nadia', 'ary-neighbour-youssef']);
    expect(charactersForVariety('ary').every((c) => c.varietyId === 'ary')).toBe(true);
    // MSA never gets Darija characters and vice versa.
    expect(charactersForVariety('arb').some((c) => c.varietyId !== 'arb')).toBe(false);
    expect(charactersForVariety('arb').map((c) => c.id)).not.toContain('ary-cafe-staff-nadia');
  });
  it('covers the 9 required expressions', () => {
    expect(CHARACTER_EXPRESSIONS).toEqual(CHARACTER_EXPRESSION_VALUES);
  });
  it('renders every character × expression', () => {
    for (const c of CHARACTER_ROSTER) {
      const variants = new Set<string>();
      for (const e of CHARACTER_EXPRESSIONS) {
        const svg = characterPortraitSvgString(c.id, e, { size: 120 });
        expect(isSvg(svg)).toBe(true);
        expect(svg).toContain(c.name);
        expect(svg.length).toBeLessThan(16 * KB);
        variants.add(svg);
      }
      expect(variants.size).toBe(CHARACTER_EXPRESSIONS.length);
      expect(isSvg(characterPortraitSvgString(c.id, 'neutral', { theme: 'dark' }))).toBe(true);
    }
  });
  it('throws for unknown characters', () => {
    expect(() => characterPortraitSvgString('nobody', 'neutral')).toThrow(/Unknown character/);
  });
});

describe('scenes', () => {
  it('defines the 12 required settings with alt text', () => {
    expect(SCENES.map((s) => s.id)).toEqual([
      'cafe',
      'street',
      'airport',
      'market',
      'home',
      'office',
      'transit',
      'restaurant',
      'gathering',
      'station',
      'park',
      'clinic',
    ]);
    for (const s of SCENES) expect(s.altText.length).toBeGreaterThan(20);
  });
  it.each(SCENES.map((s) => s.id))('renders %s in day/evening and light/dark', (id) => {
    const day = sceneArtSvgString(id, { width: 320 });
    const evening = sceneArtSvgString(id, { width: 320, variant: 'evening' });
    const dark = sceneArtSvgString(id, { width: 320, theme: 'dark' });
    for (const svg of [day, evening, dark]) {
      expect(isSvg(svg)).toBe(true);
      expect(svg).not.toContain('<text');
      expect(svg.length).toBeLessThan(40 * KB);
    }
    expect(day).not.toEqual(evening);
    expect(day).not.toEqual(dark);
    expect(day).toContain('width="320" height="180"');
  });
});

describe('covers', () => {
  it('has one unique recipe per catalog track', () => {
    expect(COVER_RECIPES.map((r) => r.trackId).sort()).toEqual([...COURSE_TRACK_IDS].sort());
    const combos = new Set(COVER_RECIPES.map((r) => `${r.motif}:${r.variant}:${r.hue}`));
    expect(combos.size).toBe(COVER_RECIPES.length);
  });
  it('renders all 30 covers distinctly without text', () => {
    const out = new Set<string>();
    for (const id of COURSE_TRACK_IDS) {
      const svg = courseCoverSvgString(id, { width: 300 });
      expect(isSvg(svg)).toBe(true);
      expect(svg).not.toContain('<text');
      expect(svg.length).toBeLessThan(24 * KB);
      out.add(svg);
    }
    expect(out.size).toBe(30);
    expect(() => courseCoverSvgString('klingon')).toThrow(/No cover recipe/);
  });
  it('uses the localized altText as the accessible label, English catalog name by default', () => {
    expect(buildCoverDocument('french').label).toBe('Course cover art for French');
    const svg = courseCoverSvgString('french', {
      width: 300,
      altText: 'Couverture du cours de <français>',
    });
    expect(svg).toContain('aria-label="Couverture du cours de &lt;français&gt;"');
    expect(svg).toContain('<title>Couverture du cours de &lt;français&gt;</title>');
    expect(svg).not.toContain('Course cover art for French');
    // Blank alt text falls back instead of producing an empty label.
    expect(buildCoverDocument('french', { altText: '   ' }).label).toBe(
      'Course cover art for French',
    );
    // The art itself is identical whatever the label (no text baked in).
    const strip = (s: string): string =>
      s.replace(/<title>.*?<\/title>/, '').replace(/aria-label="[^"]*"/, '');
    expect(strip(svg)).toBe(strip(courseCoverSvgString('french', { width: 300 })));
  });
  it('derives the alt-text catalog key per cover', () => {
    expect(coverAltTextKey('arabic-moroccan')).toBe('catalog.cover.arabic-moroccan');
    expect(ART_MANIFEST.coverAltTextKeys['arabic-moroccan']).toBe('catalog.cover.arabic-moroccan');
    expect(Object.keys(ART_MANIFEST.coverAltTextKeys).sort()).toEqual(
      Object.keys(ART_MANIFEST.covers).sort(),
    );
    for (const [trackId, key] of Object.entries(ART_MANIFEST.coverAltTextKeys))
      expect(key).toBe(`catalog.cover.${trackId}`);
  });
});

describe('icons', () => {
  it('renders every icon on the 24 grid', () => {
    expect(ICON_NAMES.length).toBe(37);
    for (const n of ICON_NAMES) {
      const svg = iconSvgString(n, { color: '#123456' });
      expect(isSvg(svg)).toBe(true);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('#123456');
      expect(svg.length).toBeLessThan(2 * KB);
    }
  });
});

describe('manifest', () => {
  it('lists every mascot state, character expression, scene and cover', () => {
    expect(Object.keys(ART_MANIFEST.mascot)).toEqual([...MASCOT_STATE_VALUES]);
    expect(Object.keys(ART_MANIFEST.characters).length).toBe(CHARACTER_ROSTER.length);
    expect(ART_MANIFEST.characters['ary-cafe-staff-nadia']?.greeting).toBe(
      'characters/ary-cafe-staff-nadia/greeting.svg',
    );
    expect(Object.keys(ART_MANIFEST.scenes).length).toBe(12);
    expect(Object.keys(ART_MANIFEST.covers).length).toBe(30);
    expect(ART_MANIFEST.mascot.neutral).toBe('mascot/neutral.svg');
    for (const p of Object.values(ART_MANIFEST.mascot)) expect(p.startsWith('/')).toBe(false);
  });
  it('export list contains every manifest path exactly once and bounds total size', () => {
    const files = listArtExports();
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    const manifestPaths = [
      ...Object.values(ART_MANIFEST.mascot),
      ...Object.values(ART_MANIFEST.characters).flatMap((m) => Object.values(m)),
      ...Object.values(ART_MANIFEST.scenes),
      ...Object.values(ART_MANIFEST.covers),
      ...Object.values(ART_MANIFEST.icons),
    ];
    for (const p of manifestPaths) expect(paths).toContain(p);
    // 97 clay portraits × 9 expressions dominate the export (≈ 9 KB each at 240 px).
    const total = files.reduce((n, f) => n + f.svg.length, 0);
    expect(total).toBeLessThan(16 * KB * KB);
  });
});
