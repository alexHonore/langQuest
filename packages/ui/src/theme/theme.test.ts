import { describe, expect, it } from 'vitest';
import { COLOR_PALETTES } from '../tokens/color';
import { DEFAULT_THEME, resolveDirection, resolveTheme } from './resolve';

describe('resolveTheme', () => {
  it('defaults to light, LTR, motion on, mascot on', () => {
    expect(DEFAULT_THEME.scheme).toBe('light');
    expect(DEFAULT_THEME.paletteName).toBe('light');
    expect(DEFAULT_THEME.reducedMotion).toBe(false);
    expect(DEFAULT_THEME.mascotEnabled).toBe(true);
    expect(DEFAULT_THEME.direction.rtl).toBe(false);
    expect(DEFAULT_THEME.motion.base).toBeGreaterThan(0);
  });

  it('follows the system scheme when asked and ignores it otherwise', () => {
    expect(resolveTheme({ scheme: 'system', systemScheme: 'dark' }).scheme).toBe('dark');
    expect(resolveTheme({ scheme: 'system', systemScheme: null }).scheme).toBe('light');
    expect(resolveTheme({ scheme: 'light', systemScheme: 'dark' }).scheme).toBe('light');
  });

  it('selects high-contrast palettes per scheme', () => {
    expect(resolveTheme({ scheme: 'light', highContrast: true }).colors).toBe(
      COLOR_PALETTES.highContrastLight,
    );
    expect(resolveTheme({ scheme: 'dark', highContrast: true }).colors).toBe(
      COLOR_PALETTES.highContrastDark,
    );
    expect(resolveTheme({ scheme: 'dark', highContrast: true }).focusRing.width).toBe(3);
    expect(resolveTheme({ scheme: 'dark' }).artTheme).toBe('dark');
  });

  it('zeros motion when the learner or the OS asks for reduced motion', () => {
    expect(resolveTheme({ reducedMotion: true }).motion.celebrate).toBe(0);
    expect(resolveTheme({ reducedMotion: 'system', systemReducedMotion: true }).reducedMotion).toBe(
      true,
    );
    expect(resolveTheme({ reducedMotion: false, systemReducedMotion: true }).reducedMotion).toBe(
      false,
    );
  });

  it('clamps text scale and scales text styles', () => {
    const t = resolveTheme({ textScale: 3 });
    expect(t.textScale).toBe(2);
    expect(t.text('body').fontSize).toBe(DEFAULT_THEME.text('body').fontSize * 2);
    expect(t.text('body', 'Arab').lineHeight).toBeGreaterThan(t.text('body').lineHeight);
    // memoised per role/script
    expect(t.text('body')).toBe(t.text('body'));
  });

  it('resolves direction honestly against the native layout engine', () => {
    expect(resolveDirection(false, false)).toMatchObject({
      row: 'row',
      mirrorRows: false,
      textAlign: undefined,
    });
    // RTL locale on a natively mirrored RN app: engine already flips rows.
    expect(resolveDirection(true, true)).toMatchObject({
      row: 'row',
      mirrorRows: false,
      iconScaleX: -1,
    });
    // RTL locale on web / non-mirrored engine: components flip rows themselves.
    expect(resolveDirection(true, false)).toMatchObject({
      row: 'row-reverse',
      mirrorRows: true,
      textAlign: 'right',
    });
    // LTR locale while the native engine is mirrored (rare, e.g. system RTL but English UI).
    expect(resolveDirection(false, true)).toMatchObject({ row: 'row-reverse', textAlign: 'left' });
    expect(resolveTheme({ rtl: 'auto', nativeRtl: true }).direction.rtl).toBe(true);
    expect(resolveTheme({ rtl: false, nativeRtl: true }).direction.mirrorRows).toBe(true);
  });

  it('keeps the mascot and haptics preferences', () => {
    const t = resolveTheme({ mascotEnabled: false, hapticsEnabled: false });
    expect(t.mascotEnabled).toBe(false);
    expect(t.hapticsEnabled).toBe(false);
  });

  it('is frozen and tints elevation by scheme', () => {
    expect(Object.isFrozen(DEFAULT_THEME)).toBe(true);
    expect(resolveTheme({ scheme: 'dark' }).elevation(2).shadowColor).toBe('#000000');
    expect(resolveTheme({ scheme: 'light' }).elevation(2).shadowColor).toBe(
      COLOR_PALETTES.light.textPrimary,
    );
    expect(resolveTheme().elevation(9 as 0).elevation).toBe(0);
  });
});
