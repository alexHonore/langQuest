import { describe, expect, it } from 'vitest';
import {
  COURSE_TRACKS,
  COURSE_TRACK_IDS,
  CourseTrackSchema,
  LANGUAGES,
  LANGUAGE_VARIETIES,
  LanguageSchema,
  LanguageVarietySchema,
  SOURCE_LANGUAGES,
  WRITING_SYSTEMS,
  WritingSystemSchema,
  findCourseTrack,
  getCourseTrack,
  getLanguage,
  getVariety,
  isCourseTrackId,
  isForbiddenSubstitution,
  isRtlTrack,
  isSourceLanguageCode,
  resolveAssetTrackId,
  tracksForLanguage,
  tracksForVariety,
} from './catalog';

/** Display names verbatim from spec §2 / CONVENTIONS §2.1, in order. */
const EXPECTED_DISPLAY_NAMES = [
  'Arabic (Eastern)',
  'Arabic (Moroccan)',
  'Arabic (Egyptian)',
  'Arabic (Modern Standard)',
  'Chinese (Cantonese)',
  'Chinese (Mandarin)',
  'Chinese (Simplified)',
  'English',
  'Danish',
  'French',
  'German',
  'Greek',
  'Haitian Creole',
  'Hebrew',
  'Hindi',
  'Italian',
  'Japanese',
  'Korean',
  'Portuguese (Brazilian)',
  'Portuguese (European)',
  'Romanian',
  'Russian',
  'Spanish (Latin American)',
  'Spanish (Spain-Castilian)',
  'Swahili',
  'Kinyarwanda',
  'Swedish',
  'Lingala',
  'Ukrainian',
  'Vietnamese',
];

describe('COURSE_TRACKS', () => {
  it('has exactly 30 tracks with unique ids in order 1..30', () => {
    expect(COURSE_TRACKS).toHaveLength(30);
    expect(COURSE_TRACK_IDS).toHaveLength(30);
    expect(new Set(COURSE_TRACKS.map((t) => t.id)).size).toBe(30);
    COURSE_TRACKS.forEach((t, i) => {
      expect(t.order).toBe(i + 1);
      expect(COURSE_TRACK_IDS[i]).toBe(t.id);
    });
  });

  it('display names match the spec table verbatim', () => {
    expect(COURSE_TRACKS.map((t) => t.displayName)).toEqual(EXPECTED_DISPLAY_NAMES);
  });

  it('every track validates and has variety, language, defaultLocale and scripts', () => {
    for (const track of COURSE_TRACKS) {
      expect(() => CourseTrackSchema.parse(track)).not.toThrow();
      const variety = getVariety(track.targetVarietyId);
      expect(variety.languageCode).toBe(track.languageCode);
      expect(getLanguage(track.languageCode).code).toBe(track.languageCode);
      expect(track.defaultLocale.length).toBeGreaterThan(1);
      expect(track.scripts.primary).toBeTruthy();
      expect(track.scriptModeOptions).toContain(track.defaultScriptMode);
      // Latin-script tracks never offer a transliteration mode.
      if (track.scripts.primary === 'Latn') expect(track.scriptModeOptions).toEqual(['native']);
      else expect(track.scripts.transliterations.length).toBeGreaterThan(0);
    }
  });

  it('matches the canonical (variety, locale) pairs of CONVENTIONS §2.1', () => {
    const pairs: Record<string, [string, string]> = {
      'arabic-eastern': ['ar-levant', 'ar-SY'],
      'arabic-moroccan': ['ary', 'ar-MA'],
      'arabic-egyptian': ['arz', 'ar-EG'],
      'arabic-msa': ['arb', 'ar'],
      'chinese-cantonese': ['yue', 'zh-HK'],
      'chinese-mandarin': ['cmn', 'zh-CN'],
      'chinese-simplified': ['cmn', 'zh-CN'],
      english: ['en', 'en-US'],
      french: ['fr', 'fr-FR'],
      'portuguese-brazilian': ['pt-BR', 'pt-BR'],
      'portuguese-european': ['pt-PT', 'pt-PT'],
      'spanish-latin-american': ['es-419', 'es-419'],
      'spanish-spain': ['es-ES', 'es-ES'],
      swahili: ['sw', 'sw-KE'],
      lingala: ['ln', 'ln-CD'],
      vietnamese: ['vi', 'vi-VN'],
    };
    for (const [id, [variety, locale]] of Object.entries(pairs)) {
      const track = findCourseTrack(id);
      expect(track, id).toBeDefined();
      expect(track?.targetVarietyId).toBe(variety);
      expect(track?.defaultLocale).toBe(locale);
    }
  });

  it('chinese-simplified shares assets with chinese-mandarin and focuses on Hans', () => {
    const simplified = getCourseTrack('chinese-simplified');
    expect(simplified.sharesAssetsWithTrackId).toBe('chinese-mandarin');
    expect(simplified.scriptFocus).toBe('Hans');
    expect(simplified.targetVarietyId).toBe('cmn');
    expect(resolveAssetTrackId('chinese-simplified')).toBe('chinese-mandarin');
    expect(resolveAssetTrackId('chinese-mandarin')).toBe('chinese-mandarin');
    expect(tracksForVariety('cmn').map((t) => t.id)).toEqual(['chinese-mandarin', 'chinese-simplified']);
    // Only the simplified track shares; nothing else does.
    expect(COURSE_TRACKS.filter((t) => t.sharesAssetsWithTrackId !== null).map((t) => t.id)).toEqual(['chinese-simplified']);
  });

  it('marks Arabic and Hebrew tracks RTL and everything else LTR', () => {
    const rtl = COURSE_TRACKS.filter((t) => isRtlTrack(t.id)).map((t) => t.id);
    expect(rtl).toEqual(['arabic-eastern', 'arabic-moroccan', 'arabic-egyptian', 'arabic-msa', 'hebrew']);
  });

  it('exposes regional selectors where the spec demands them', () => {
    expect(getCourseTrack('arabic-eastern').regionalOptions.map((o) => o.id)).toEqual(['SY', 'LB', 'PS', 'JO']);
    expect(getCourseTrack('swahili').regionalOptions.map((o) => o.id)).toEqual(['KE', 'TZ']);
    expect(getCourseTrack('vietnamese').regionalOptions.map((o) => o.id)).toEqual(['north', 'south']);
    expect(getCourseTrack('english').regionalOptions.map((o) => o.id)).toEqual(['US', 'GB']);
    expect(getCourseTrack('french').regionalOptions.map((o) => o.id)).toEqual(['FR', 'CA']);
    expect(getCourseTrack('arabic-eastern').assumptions.join(' ')).toMatch(/umbrella/i);
  });

  it('flags tonal tracks and uses transliteration schemes from the catalog', () => {
    expect(getCourseTrack('chinese-cantonese').tonal).toBe(true);
    expect(getCourseTrack('chinese-cantonese').scripts.transliterations).toEqual(['jyutping']);
    expect(getCourseTrack('chinese-mandarin').scripts.transliterations).toEqual(['pinyin']);
    expect(getCourseTrack('chinese-mandarin').scripts.alternatives).toEqual(['Hant']);
    expect(getCourseTrack('arabic-moroccan').scripts.transliterations).toEqual(['arabizi']);
    expect(getCourseTrack('japanese').scripts.transliterations).toEqual(['romaji', 'furigana']);
    expect(getCourseTrack('korean').scripts.transliterations).toEqual(['revised-romanization']);
    expect(getCourseTrack('vietnamese').tonal).toBe(true);
    expect(getCourseTrack('french').tonal).toBe(false);
  });

  it('never claims full automated scoring for low-resource or unverified varieties', () => {
    for (const id of ['arabic-moroccan', 'arabic-eastern', 'haitian-creole', 'kinyarwanda', 'lingala', 'swahili'] as const) {
      expect(getCourseTrack(id).automatedScoringSupport, id).toBe('limited');
    }
  });
});

describe('languages, varieties, writing systems', () => {
  it('all constants validate against their schemas', () => {
    LANGUAGES.forEach((l) => expect(() => LanguageSchema.parse(l)).not.toThrow());
    LANGUAGE_VARIETIES.forEach((v) => expect(() => LanguageVarietySchema.parse(v)).not.toThrow());
    WRITING_SYSTEMS.forEach((w) => expect(() => WritingSystemSchema.parse(w)).not.toThrow());
  });

  it('covers every language used by a track and every source language', () => {
    const codes = new Set(LANGUAGES.map((l) => l.code));
    COURSE_TRACKS.forEach((t) => expect(codes.has(t.languageCode)).toBe(true));
    expect(LANGUAGES).toHaveLength(23);
    expect(SOURCE_LANGUAGES).toHaveLength(23);
  });

  it('includes the 10 required scripts plus transliteration schemes', () => {
    const scripts = WRITING_SYSTEMS.filter((w) => w.kind === 'script').map((w) => w.id);
    expect(scripts).toEqual(['Arab', 'Latn', 'Hans', 'Hant', 'Cyrl', 'Grek', 'Hebr', 'Deva', 'Jpan', 'Kore']);
    expect(WRITING_SYSTEMS.some((w) => w.id === 'jyutping')).toBe(true);
    expect(WRITING_SYSTEMS.some((w) => w.id === 'arabizi')).toBe(true);
  });

  it('RTL flags are consistent between languages and scripts', () => {
    expect(getLanguage('ar').rtl).toBe(true);
    expect(getLanguage('he').rtl).toBe(true);
    expect(getLanguage('fr').rtl).toBe(false);
    expect(tracksForLanguage('ar')).toHaveLength(4);
  });

  it('source language priority tiers: en=1, fr=2, es/ru=3, others=4', () => {
    const tier = (c: string) => SOURCE_LANGUAGES.find((s) => s.code === c)?.priorityTier;
    expect(tier('en')).toBe(1);
    expect(tier('fr')).toBe(2);
    expect(tier('es')).toBe(3);
    expect(tier('ru')).toBe(3);
    expect(tier('de')).toBe(4);
    expect(tier('ht')).toBe(4);
  });

  it('forbids silent variety substitutions', () => {
    expect(isForbiddenSubstitution('ary', 'arb')).toBe(true);
    expect(isForbiddenSubstitution('yue', 'cmn')).toBe(true);
    expect(isForbiddenSubstitution('ht', 'fr')).toBe(true);
    expect(isForbiddenSubstitution('pt-BR', 'pt-PT')).toBe(true);
    expect(isForbiddenSubstitution('cmn', 'cmn')).toBe(false);
  });

  it('type guards reject unknown ids', () => {
    expect(isCourseTrackId('arabic-moroccan')).toBe(true);
    expect(isCourseTrackId('arabic-darija')).toBe(false);
    expect(isSourceLanguageCode('fr')).toBe(true);
    expect(isSourceLanguageCode('xx')).toBe(false);
    expect(() => getCourseTrack('nope' as never)).toThrow();
  });
});
