import { describe, expect, it } from 'vitest';
import { COLOR_PALETTES, contrastRatio, courseAccent } from '@langquest/ui/tokens';
import { COURSE_TRACK_IDS } from '@langquest/contracts';
import { courseAccentVars, paletteVars, themeCss } from './theme';

describe('studio theme (token-driven)', () => {
  it('emits every palette token as a CSS variable, light on :root and dark behind data-theme', () => {
    const css = themeCss();
    expect(css).toContain(`:root{--bg:${COLOR_PALETTES.light.background};`);
    expect(css).toContain(`:root[data-theme='dark']{--bg:${COLOR_PALETTES.dark.background};`);
    expect(css).toContain(`--accent-text:${COLOR_PALETTES.light.accentText};`);
    expect(css).toContain('color-scheme:dark;');
    expect(paletteVars('dark')['--lantern-2']).toBe(COLOR_PALETTES.dark.lantern[1]);
  });

  it('accent variables follow the active course and stay readable', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const trackId of COURSE_TRACK_IDS) {
        const vars = courseAccentVars(trackId, null, scheme);
        const surfaces = [COLOR_PALETTES[scheme].background, COLOR_PALETTES[scheme].surface, COLOR_PALETTES[scheme].elevated];
        for (const s of surfaces) expect(contrastRatio(vars['--accent-text'], s)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(vars['--on-accent'], vars['--accent'])).toBeGreaterThanOrEqual(4.5);
        expect(vars['--lantern-1']).toBe(courseAccent(trackId, scheme).lantern[0]);
      }
    }
  });

  it('falls back to the default lanterns without a course and shifts them with the lesson', () => {
    const none = courseAccentVars(null, null, 'light');
    expect(none['--accent']).toBe(COLOR_PALETTES.light.accent);
    expect(none['--lantern-1']).toBe(COLOR_PALETTES.light.lantern[0]);
    const story = courseAccentVars('arabic-moroccan', 'story', 'light');
    const plain = courseAccentVars('arabic-moroccan', null, 'light');
    expect(story['--lantern-1']).not.toBe(plain['--lantern-1']);
  });
});
