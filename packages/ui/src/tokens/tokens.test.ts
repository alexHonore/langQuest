import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTES,
  FILL_COLOR_TOKEN_KEYS,
  FILL_INK_TOKEN,
  PALETTE_NAMES,
  SURFACE_COLOR_TOKEN_KEYS,
  TEXT_COLOR_TOKEN_KEYS,
  paletteNameFor,
} from './color';
import {
  composite,
  contrastRatio,
  meetsWcag,
  parseColor,
  pickReadable,
  relativeLuminance,
  shade,
  toHex,
  withAlpha,
  UI_COMPONENT_MIN_CONTRAST,
} from './contrast';
import {
  GLOW,
  MOTION_DURATIONS,
  MOTION_SPRINGS,
  RADII,
  elevationStyle,
  focusRingTokens,
  glassStyle,
  glowStyle,
  motionTokens,
} from './layout';
import {
  SCRIPT_TYPOGRAPHY,
  TALL_SCRIPTS,
  TYPE_ROLES,
  clampTextScale,
  fontFamilyCss,
  resolveTextStyle,
} from './typography';

describe('contrast checker', () => {
  it('parses hex and rgb forms', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#1E2A33')).toEqual({ r: 30, g: 42, b: 51, a: 1 });
    expect(parseColor('#00000080').a).toBeCloseTo(0.5, 2);
    expect(parseColor('rgba(15, 26, 32, 0.55)')).toEqual({ r: 15, g: 26, b: 32, a: 0.55 });
    expect(() => parseColor('teal')).toThrow();
  });

  it('matches the WCAG reference values', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 2);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
    expect(meetsWcag('#767676', '#FFFFFF')).toBe(true);
    expect(meetsWcag('#777777', '#FFFFFF')).toBe(false);
    expect(meetsWcag('#777777', '#FFFFFF', 'AA', 'large')).toBe(true);
  });

  it('composites translucent foregrounds before measuring', () => {
    const solid = contrastRatio('#000000', '#FFFFFF');
    const faint = contrastRatio('rgba(0,0,0,0.2)', '#FFFFFF');
    expect(faint).toBeLessThan(solid);
    expect(faint).toBeGreaterThan(1);
  });

  it('exposes helpers', () => {
    expect(pickReadable('#FFFFFF', ['#FFFFFF', '#000000'])).toBe('#000000');
    expect(toHex({ r: 255, g: 0, b: 16, a: 1 })).toBe('#ff0010');
    expect(shade('#000000', 1)).toBe('#ffffff');
    expect(shade('#ffffff', -1)).toBe('#000000');
    expect(withAlpha('#FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });
});

describe('colour palettes', () => {
  it.each(PALETTE_NAMES)('%s: every text token reaches WCAG AA on every surface', (name) => {
    const palette = COLOR_PALETTES[name];
    const failures: string[] = [];
    for (const textKey of TEXT_COLOR_TOKEN_KEYS) {
      for (const surfaceKey of SURFACE_COLOR_TOKEN_KEYS) {
        const ratio = contrastRatio(palette[textKey], palette[surfaceKey]);
        if (ratio < 4.5) failures.push(`${textKey} on ${surfaceKey}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(PALETTE_NAMES)(
    '%s: text tokens also read on the solid glass tiers and the muted surface',
    (name) => {
      const p = COLOR_PALETTES[name];
      const extra = [p.glass.solid, p.glass.solidStrong, p.surfaceMuted];
      const failures: string[] = [];
      for (const textKey of TEXT_COLOR_TOKEN_KEYS) {
        for (const s of extra) {
          const ratio = contrastRatio(p[textKey], s);
          if (ratio < 4.5) failures.push(`${textKey} on ${s}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it.each(PALETTE_NAMES)(
    '%s: accent FILL tokens meet 3:1 on every surface and carry a 4.5:1 ink (never used as text)',
    (name) => {
      const p = COLOR_PALETTES[name];
      for (const fill of FILL_COLOR_TOKEN_KEYS) {
        for (const surfaceKey of SURFACE_COLOR_TOKEN_KEYS) {
          expect(
            contrastRatio(p[fill], p[surfaceKey]),
            `${fill} vs ${surfaceKey}`,
          ).toBeGreaterThanOrEqual(UI_COMPONENT_MIN_CONTRAST);
        }
        expect(
          contrastRatio(p[FILL_INK_TOKEN[fill]], p[fill]),
          `ink on ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // The three accent text tokens are distinct hues from each other.
      expect(new Set([p.accentText, p.amberText, p.cyanText]).size).toBe(3);
    },
  );

  it('dark is the reference palette and light is derived from the same hues (U2)', () => {
    expect(COLOR_PALETTES.dark.background).toBe('#0B0913');
    expect(COLOR_PALETTES.light.background).toBe('#F6F3FB');
    expect(COLOR_PALETTES.dark.lantern).toEqual([
      COLOR_PALETTES.dark.accent,
      COLOR_PALETTES.dark.cyan,
      COLOR_PALETTES.dark.amber,
    ]);
    // Speech states follow the lantern language: mic open = cyan, character = magenta.
    expect(COLOR_PALETTES.dark.speech.listening).toBe(COLOR_PALETTES.dark.cyanText);
    expect(COLOR_PALETTES.dark.speech.speaking).toBe(COLOR_PALETTES.dark.accentText);
  });

  it.each(PALETTE_NAMES)('%s: speech-state colours read as text on every surface', (name) => {
    const palette = COLOR_PALETTES[name];
    const failures: string[] = [];
    for (const [state, color] of Object.entries(palette.speech)) {
      for (const surfaceKey of SURFACE_COLOR_TOKEN_KEYS) {
        const ratio = contrastRatio(color, palette[surfaceKey]);
        if (ratio < 4.5) failures.push(`speech.${state} on ${surfaceKey}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(PALETTE_NAMES)(
    '%s: onAccent is readable on accent, focus ring and borders meet 3:1',
    (name) => {
      const p = COLOR_PALETTES[name];
      expect(contrastRatio(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.onAccent, p.accentStrong)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.focusRing, p.background)).toBeGreaterThanOrEqual(
        UI_COMPONENT_MIN_CONTRAST,
      );
      expect(contrastRatio(p.borderStrong, p.surface)).toBeGreaterThanOrEqual(
        UI_COMPONENT_MIN_CONTRAST,
      );
      // Text on tinted "soft" backgrounds (chips, callouts).
      expect(contrastRatio(p.success, p.successSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.warning, p.warningSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.error, p.errorSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.info, p.infoSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accentText, p.accentSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.amberText, p.warningSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.cyanText, p.infoSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.textPrimary, p.surfaceMuted)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(PALETTE_NAMES)(
    '%s: onScrim reads on the composited overlay scrim (and onAccent would not)',
    (name) => {
      const p = COLOR_PALETTES[name];
      // `overlay` is translucent and sits on arbitrary content (scene art, the canvas):
      // measure against what the eye sees once it is drawn over the canvas, the surface and
      // the worst cases, pure white and pure black. `sceneScrim` is the scrim *under glass*:
      // text there lives on the glass surface, which the text-token checks above cover.
      const backdrops = [p.background, p.surface, '#FFFFFF', '#000000'];
      const failures: string[] = [];
      for (const under of backdrops) {
        const seen = toHex(composite(parseColor(p.overlay), parseColor(under)));
        const ratio = contrastRatio(p.onScrim, seen);
        if (ratio < 4.5) failures.push(`onScrim on overlay over ${under}: ${ratio.toFixed(2)}`);
      }
      expect(failures).toEqual([]);
      // Regression guard for the review scenario caption: the dark scheme's accent ink is
      // dark, so it is NOT a valid colour for text on a scrim over the canvas.
      const overlayOnCanvas = toHex(composite(parseColor(p.overlay), parseColor(p.background)));
      if (name === 'dark' || name === 'highContrastDark') {
        expect(contrastRatio(p.onAccent, overlayOnCanvas)).toBeLessThan(4.5);
      }
    },
  );

  it('high-contrast palettes exceed AAA for primary text', () => {
    expect(
      contrastRatio(
        COLOR_PALETTES.highContrastLight.textPrimary,
        COLOR_PALETTES.highContrastLight.background,
      ),
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrastRatio(
        COLOR_PALETTES.highContrastDark.textPrimary,
        COLOR_PALETTES.highContrastDark.background,
      ),
    ).toBeGreaterThanOrEqual(7);
  });

  it('speech states are mutually distinguishable (not colour-only, but still distinct)', () => {
    for (const name of PALETTE_NAMES) {
      const s = COLOR_PALETTES[name].speech;
      expect(new Set([s.listening, s.speaking, s.thinking, s.reconnecting]).size).toBe(4);
    }
  });

  it('resolves palette names', () => {
    expect(paletteNameFor('light', false)).toBe('light');
    expect(paletteNameFor('dark', false)).toBe('dark');
    expect(paletteNameFor('light', true)).toBe('highContrastLight');
    expect(paletteNameFor('dark', true)).toBe('highContrastDark');
  });
});

describe('typography', () => {
  it('gives tall scripts more line-height than Latin', () => {
    for (const script of TALL_SCRIPTS) {
      expect(SCRIPT_TYPOGRAPHY[script].lineHeight).toBeGreaterThan(
        SCRIPT_TYPOGRAPHY.Latn.lineHeight,
      );
    }
    expect(SCRIPT_TYPOGRAPHY.Arab.direction).toBe('rtl');
    expect(SCRIPT_TYPOGRAPHY.Hebr.direction).toBe('rtl');
  });

  it('resolves roles with script and text scale', () => {
    const latin = resolveTextStyle('body');
    expect(latin.fontSize).toBe(TYPE_ROLES.body.fontSize);
    expect(latin.lineHeight).toBeGreaterThanOrEqual(latin.fontSize * TYPE_ROLES.body.lineHeight);
    expect(latin.fontFamily).toBeUndefined();

    const deva = resolveTextStyle('body', { script: 'Deva' });
    expect(deva.lineHeight / deva.fontSize).toBeGreaterThanOrEqual(1.7);
    expect(deva.fontFamily).toBeDefined();

    const big = resolveTextStyle('phrase', { textScale: 2 });
    expect(big.fontSize).toBe(TYPE_ROLES.phrase.fontSize * 2);
    const clamped = resolveTextStyle('body', { textScale: 10 });
    expect(clamped.fontSize).toBe(TYPE_ROLES.body.fontSize * 2);
    expect(clampTextScale(Number.NaN)).toBe(1);
    expect(clampTextScale(0.1)).toBe(0.8);
  });

  it('caps CJK weight at 700, drops Arabic tracking and gives Arabic +15 % (U2)', () => {
    expect(resolveTextStyle('heading').fontWeight).toBe('800');
    expect(resolveTextStyle('heading', { script: 'Jpan' }).fontWeight).toBe('700');
    expect(resolveTextStyle('eyebrow').letterSpacing).toBe(0.8);
    expect(resolveTextStyle('eyebrow').textTransform).toBe('uppercase');
    expect(resolveTextStyle('eyebrow', { script: 'Arab' }).letterSpacing).toBe(0);
    expect(resolveTextStyle('body', { script: 'Arab' }).fontSize).toBeCloseTo(15 * 1.15, 0);
    expect(TYPE_ROLES.body.fontSize).toBeGreaterThanOrEqual(15);
  });

  it('quotes multi-word families in the CSS stack', () => {
    expect(fontFamilyCss('Arab')).toContain('"Geeza Pro"');
    expect(fontFamilyCss('Latn')).toContain('sans-serif');
  });
});

describe('layout tokens', () => {
  it('zeros every duration under reduced motion except the 120 ms colour change (U2)', () => {
    const reduced = motionTokens(true);
    for (const [k, v] of Object.entries(reduced)) {
      if (typeof v !== 'number') continue;
      if (k === 'colorChange') expect(v).toBe(MOTION_DURATIONS.colorChange);
      else expect(v, k).toBe(0);
    }
    expect(reduced.reducedMotion).toBe(true);
    expect(reduced.lanternDriftEnabled).toBe(false);
    expect(reduced.glowAnimated).toBe(false);
    expect(motionTokens(false).base).toBe(MOTION_DURATIONS.base);
    expect(motionTokens(false).glowPulse).toBe(1600);
  });

  it('carries the U2 springs and easings, and disables lantern drift on low-end devices', () => {
    expect(MOTION_SPRINGS.press).toEqual({ damping: 14, stiffness: 180, mass: 1 });
    expect(motionTokens(false).springs.press.damping).toBe(14);
    expect(motionTokens(false).easings.standard).toEqual([0.2, 0.8, 0.2, 1]);
    const lowEnd = motionTokens(false, { lowEndDevice: true });
    expect(lowEnd.lanternDriftEnabled).toBe(false);
    expect(lowEnd.lanternDrift).toBe(0);
    expect(lowEnd.glowAnimated).toBe(true);
  });

  it('uses the U2 radii (cards 22, sheets 28)', () => {
    expect(RADII).toMatchObject({ sm: 10, md: 16, lg: 22, xl: 28, pill: 999 });
  });

  it('glass falls back to the solid tier without blur', () => {
    const g = COLOR_PALETTES.dark.glass;
    const blurred = glassStyle(1, g, COLOR_PALETTES.dark.background, false);
    expect(blurred.blur).toBe(20);
    expect(blurred.backgroundColor).toBe(g.fill);
    const strong = glassStyle(2, g, COLOR_PALETTES.dark.background, false);
    expect(strong.blur).toBe(24);
    const solid = glassStyle(2, g, COLOR_PALETTES.dark.background, true);
    expect(solid.blur).toBe(0);
    expect(solid.backgroundColor).toBe(g.solidStrong);
    expect(glassStyle(0, g, COLOR_PALETTES.dark.background, false).backgroundColor).toBe(
      COLOR_PALETTES.dark.background,
    );
  });

  it('glow is a 5 px ring at 28 % plus a 34 px bloom, scaled by intensity', () => {
    const full = glowStyle('#FF4FA3', 1);
    expect(full.ringWidth).toBe(GLOW.ringWidth);
    expect(full.ringColor).toBe('rgba(255, 79, 163, 0.28)');
    expect(full.shadowOpacity).toBeCloseTo(GLOW.bloomAlpha, 5);
    expect(full.boxShadow).toContain('34px');
    const off = glowStyle('#FF4FA3', 0);
    expect(off.shadowOpacity).toBe(0);
    expect(off.elevation).toBe(0);
  });

  it('builds elevation and focus ring styles', () => {
    expect(elevationStyle(0).shadowOpacity).toBe(0);
    expect(elevationStyle(3).elevation).toBeGreaterThan(elevationStyle(1).elevation);
    expect(focusRingTokens(true).width).toBeGreaterThan(focusRingTokens(false).width);
  });
});
