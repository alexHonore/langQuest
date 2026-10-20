import {
  COURSE_TRACKS,
  LESSON_TYPE_VALUES,
  MISSION_STEP_TYPE_VALUES,
  MISSION_TYPE_VALUES,
} from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_TRACK_IDS,
  LESSON_ACCENTS,
  LESSON_ACCENT_KEYS,
  courseAccent,
  lessonAccent,
  resolveAccents,
} from './accent';
import { COLOR_PALETTES, PALETTE_NAMES, SURFACE_COLOR_TOKEN_KEYS } from './color';
import { UI_COMPONENT_MIN_CONTRAST, contrastRatio } from './contrast';

describe('courseAccent (lantern glow per course)', () => {
  it('covers all 30 tracks', () => {
    expect(ACCENT_TRACK_IDS).toHaveLength(30);
    expect([...ACCENT_TRACK_IDS].sort()).toEqual(COURSE_TRACKS.map((t) => t.id).sort());
  });

  it.each(['dark', 'light'] as const)(
    '%s: lanterns and primaries are distinct across the 30 tracks',
    (scheme) => {
      const lanterns = new Set<string>();
      const primaries = new Set<string>();
      for (const id of ACCENT_TRACK_IDS) {
        const a = courseAccent(id, scheme);
        expect(a.tinted).toBe(true);
        expect(a.trackId).toBe(id);
        lanterns.add(a.lantern.join(','));
        primaries.add(a.primary);
      }
      expect(lanterns.size).toBe(30);
      // Primaries derive from the cover hue; near-identical hues may share a fill but never a lantern set.
      expect(primaries.size).toBeGreaterThanOrEqual(24);
    },
  );

  it.each(PALETTE_NAMES)(
    '%s: every track keeps AA text and a 4.5:1 ink on its primary',
    (scheme) => {
      const palette = COLOR_PALETTES[scheme];
      const failures: string[] = [];
      for (const id of ACCENT_TRACK_IDS) {
        const a = courseAccent(id, scheme);
        if (contrastRatio(a.onPrimary, a.primary) < 4.5) failures.push(`${id}: ink on primary`);
        if (contrastRatio(a.onPrimary, a.primaryStrong) < 4.5)
          failures.push(`${id}: ink on primaryStrong`);
        if (contrastRatio(a.primaryText, a.primarySoft) < 4.5) failures.push(`${id}: text on soft`);
        for (const s of SURFACE_COLOR_TOKEN_KEYS) {
          if (contrastRatio(a.primaryText, palette[s]) < 4.5) failures.push(`${id}: text on ${s}`);
          if (contrastRatio(a.primary, palette[s]) < UI_COMPONENT_MIN_CONTRAST)
            failures.push(`${id}: fill on ${s}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it('high contrast keeps the fixed accent (only the lanterns follow the course)', () => {
    const a = courseAccent('japanese', 'highContrastDark');
    expect(a.tinted).toBe(false);
    expect(a.primary).toBe(COLOR_PALETTES.highContrastDark.accent);
    expect(a.lantern).not.toEqual(COLOR_PALETTES.highContrastDark.lantern);
  });

  it('falls back to the direction defaults for unknown or missing tracks', () => {
    expect(courseAccent(null, 'dark').primary).toBe(COLOR_PALETTES.dark.accent);
    expect(courseAccent('not-a-track', 'light').lantern).toEqual(COLOR_PALETTES.light.lantern);
    expect(courseAccent(undefined).tinted).toBe(false);
  });

  it('is memoised per track and scheme', () => {
    expect(courseAccent('french', 'dark')).toBe(courseAccent('french', 'dark'));
    expect(courseAccent('french', 'dark')).not.toBe(courseAccent('french', 'light'));
  });
});

describe('lessonAccent (lantern glow per lesson)', () => {
  it('has an explicit modulation for every mission, step and lesson type', () => {
    for (const k of [...MISSION_TYPE_VALUES, ...MISSION_STEP_TYPE_VALUES, ...LESSON_TYPE_VALUES]) {
      expect(LESSON_ACCENTS[k], k).toBeDefined();
      expect(lessonAccent(k).key).toBe(k);
      expect(lessonAccent(k).glowIntensity).toBeGreaterThan(0);
      expect(lessonAccent(k).glowIntensity).toBeLessThanOrEqual(1);
    }
    expect(LESSON_ACCENT_KEYS.length).toBe(new Set(LESSON_ACCENT_KEYS).size);
  });

  it('is neutral for unknown keys and leads with the mic (cool) on pronunciation', () => {
    expect(lessonAccent(null).key).toBeNull();
    expect(lessonAccent('whatever').hueShift).toBe(0);
    expect(lessonAccent('pronunciation_drill').hueShift).toBeLessThan(0);
    expect(lessonAccent('pronunciation_drill').glowTarget).toBe('both');
    expect(lessonAccent('story').hueShift).toBeGreaterThan(0);
    expect(lessonAccent('free_conversation').glowIntensity).toBe(1);
  });

  it.each([null, 'japanese', 'arabic-moroccan'] as const)(
    'track %s: every mission type has its own lantern triple, none equal to the neutral lesson',
    (trackId) => {
      for (const scheme of ['dark', 'light'] as const) {
        const neutral = resolveAccents(trackId, null, { scheme }).lantern.join(',');
        const seen = new Map<string, string>();
        for (const type of MISSION_TYPE_VALUES) {
          const triple = resolveAccents(trackId, type, { scheme }).lantern.join(',');
          expect(triple, `${scheme}: ${type} equals the no-lesson lanterns`).not.toBe(neutral);
          const clash = seen.get(triple);
          expect(clash, `${scheme}: ${type} shares lanterns with ${clash ?? ''}`).toBeUndefined();
          seen.set(triple, type);
        }
      }
    },
  );

  it('the live conversation step and a standard mission do not look like Home', () => {
    for (const trackId of [null, 'french'] as const) {
      const home = resolveAccents(trackId, null, { scheme: 'dark' }).lantern;
      expect(resolveAccents(trackId, 'character_conversation', { scheme: 'dark' }).lantern).not.toEqual(
        home,
      );
      expect(resolveAccents(trackId, 'standard', { scheme: 'dark' }).lantern).not.toEqual(home);
      expect(resolveAccents(trackId, 'free_conversation', { scheme: 'dark' }).lantern).not.toEqual(
        home,
      );
    }
  });

  it('modulates the course lanterns without touching the AA text/ink tokens', () => {
    const base = resolveAccents('arabic-moroccan', null, { scheme: 'dark' });
    const drill = resolveAccents('arabic-moroccan', 'pronunciation_drill', { scheme: 'dark' });
    expect(drill.lantern).not.toEqual(base.lantern);
    expect(drill.primary).toBe(base.primary);
    expect(drill.primaryText).toBe(base.primaryText);
    expect(drill.onPrimary).toBe(base.onPrimary);
    expect(drill.glowIntensity).toBe(1);
    expect(base.lanternOpacity).toBeGreaterThan(0);
    expect(
      resolveAccents('arabic-moroccan', null, { scheme: 'dark', lanterns: false }).lanternOpacity,
    ).toBe(0);
    expect(
      resolveAccents('arabic-moroccan', 'story', { scheme: 'highContrastLight' }).lanternOpacity,
    ).toBe(0);
    expect(
      resolveAccents('arabic-moroccan', 'story', { scheme: 'highContrastLight' }).glowIntensity,
    ).toBe(0);
    // No course + neutral lesson = the direction's own lanterns.
    expect(resolveAccents(null, null, { scheme: 'dark' }).lantern).toEqual(
      COLOR_PALETTES.dark.lantern,
    );
  });
});
