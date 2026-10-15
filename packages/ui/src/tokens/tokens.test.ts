import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTES,
  PALETTE_NAMES,
  SURFACE_COLOR_TOKEN_KEYS,
  TEXT_COLOR_TOKEN_KEYS,
  paletteNameFor,
} from './color';
import {
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
import { elevationStyle, focusRingTokens, motionTokens, MOTION_DURATIONS } from './layout';
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
      expect(contrastRatio(p.accent, p.accentSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.textPrimary, p.surfaceMuted)).toBeGreaterThanOrEqual(4.5);
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

  it('quotes multi-word families in the CSS stack', () => {
    expect(fontFamilyCss('Arab')).toContain('"Geeza Pro"');
    expect(fontFamilyCss('Latn')).toContain('sans-serif');
  });
});

describe('layout tokens', () => {
  it('zeros every duration under reduced motion', () => {
    const reduced = motionTokens(true);
    for (const [k, v] of Object.entries(reduced)) {
      if (k !== 'reducedMotion') expect(v).toBe(0);
    }
    expect(reduced.reducedMotion).toBe(true);
    expect(motionTokens(false).base).toBe(MOTION_DURATIONS.base);
  });

  it('builds elevation and focus ring styles', () => {
    expect(elevationStyle(0).shadowOpacity).toBe(0);
    expect(elevationStyle(3).elevation).toBeGreaterThan(elevationStyle(1).elevation);
    expect(focusRingTokens(true).width).toBeGreaterThan(focusRingTokens(false).width);
  });
});
