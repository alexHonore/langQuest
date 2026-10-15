import { describe, expect, it } from 'vitest';
import { LanguageContextSchema, buildLanguageContext, deriveScriptOptions, isRtlContext, languageContextCacheKey, resolveScriptMode } from './language-context';

const base = {
  uiLocale: 'fr-CA',
  enrollmentId: '2d2c1c5a-6a1b-4d2d-9c7e-0c8f0b8e1a11',
  sourceLanguage: 'fr',
  targetTrack: 'arabic-moroccan',
  targetVariety: 'ary',
  targetScriptMode: 'both',
  regionalPreference: 'Casablanca',
  learnerLevel: 'beginner',
} as const;

describe('LanguageContextSchema', () => {
  it('accepts the CONVENTIONS §2.3 example', () => {
    expect(LanguageContextSchema.parse(base)).toEqual(base);
  });

  it('rejects a variety that does not belong to the track (no MSA for Darija)', () => {
    const result = LanguageContextSchema.safeParse({ ...base, targetVariety: 'arb' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['targetVariety']);
  });

  it('rejects a script mode the track does not offer', () => {
    const result = LanguageContextSchema.safeParse({ ...base, targetTrack: 'french', targetVariety: 'fr', targetScriptMode: 'latin' });
    expect(result.success).toBe(false);
  });

  it('requires sourceLanguage', () => {
    const { sourceLanguage: _omit, ...rest } = base;
    expect(LanguageContextSchema.safeParse(rest).success).toBe(false);
  });
});

describe('helpers', () => {
  it('deriveScriptOptions reflects the catalog', () => {
    const opts = deriveScriptOptions('chinese-mandarin');
    expect(opts.primaryScript).toBe('Hans');
    expect(opts.alternativeScripts).toEqual(['Hant']);
    expect(opts.transliterations).toEqual(['pinyin']);
    expect(opts.hasTransliteration).toBe(true);
    expect(opts.rtl).toBe(false);
    expect(deriveScriptOptions('hebrew').rtl).toBe(true);
    expect(deriveScriptOptions('german').scriptModeOptions).toEqual(['native']);
  });

  it('isRtlContext is true for Arabic/Hebrew only', () => {
    expect(isRtlContext(base)).toBe(true);
    expect(isRtlContext({ targetTrack: 'hebrew' })).toBe(true);
    expect(isRtlContext({ targetTrack: 'japanese' })).toBe(false);
  });

  it('resolveScriptMode falls back to the track default', () => {
    expect(resolveScriptMode('french', 'latin')).toBe('native');
    expect(resolveScriptMode('russian', 'latin')).toBe('latin');
    expect(resolveScriptMode('russian', null)).toBe('both');
  });

  it('buildLanguageContext always takes the variety from the catalog', () => {
    const ctx = buildLanguageContext({ uiLocale: 'en-US', enrollmentId: base.enrollmentId, sourceLanguageCode: 'ru', courseTrackId: 'english', scriptMode: 'both' });
    expect(ctx.targetVariety).toBe('en');
    expect(ctx.targetScriptMode).toBe('native');
    expect(ctx.sourceLanguage).toBe('ru');
    expect(ctx.learnerLevel).toBe('beginner');
    expect(languageContextCacheKey(ctx)).toBe('english|en|ru|native|-|beginner');
  });
});
