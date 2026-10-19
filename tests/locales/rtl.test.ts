/**
 * §10.3 / A32: RTL and bidi helpers for Arabic and Hebrew tracks — direction detection, isolation of mixed
 * segments (Arabic + Arabizi/Latin), punctuation pinning, numeral systems, and the script/display layers used
 * to render Darija with both Arabic and Latin forms legibly.
 */
import { COURSE_TRACKS, isRtlTrack } from '@langquest/contracts';
import { BIDI, createTranslator, detectTextDirection, displayLayersForMode, hasMixedDirection, isRtlLocale, isolateBidi, joinBidiSegments, numeralOptions, pinTrailingPunctuation, scriptMetadataForTrack, stripBidiControls, textDirection, translatorForContext } from '@langquest/locales';
import { describe, expect, it } from 'vitest';

describe('RTL rendering helpers', () => {
  it('knows which locales, tracks and scripts are right-to-left', () => {
    for (const tag of ['ar', 'ar-MA', 'ary', 'arz', 'arb', 'he', 'he-IL', 'fa', 'ur']) expect(isRtlLocale(tag), tag).toBe(true);
    for (const tag of ['en', 'fr-CA', 'ja', 'ru', 'ht', 'sw', 'zh-HK']) expect(isRtlLocale(tag), tag).toBe(false);
    expect(textDirection('ar-MA')).toBe('rtl');
    expect(textDirection('fr')).toBe('ltr');
    const rtlTracks = COURSE_TRACKS.filter((t) => isRtlTrack(t.id)).map((t) => t.id).sort();
    expect(rtlTracks).toEqual(['arabic-eastern', 'arabic-egyptian', 'arabic-moroccan', 'arabic-msa', 'hebrew']);
    for (const id of rtlTracks) expect(scriptMetadataForTrack(id).direction).toBe('rtl');
    expect(scriptMetadataForTrack('japanese').direction).toBe('ltr');
  });

  it('detects direction of Arabic, Hebrew, Latin and mixed text', () => {
    expect(detectTextDirection('بغيت أتاي عافاك')).toBe('rtl');
    expect(detectTextDirection('שלום, מה שלומך?')).toBe('rtl');
    expect(detectTextDirection('bghit atay 3afak')).toBe('ltr');
    expect(detectTextDirection('123 !?')).toBeNull();
    expect(hasMixedDirection('بغيت atay عافاك')).toBe(true);
    expect(hasMixedDirection('بغيت أتاي')).toBe(false);
  });

  it('isolates and joins mixed-direction segments so Arabic + Arabizi stay legible', () => {
    const isolated = isolateBidi('bghit atay', 'ltr');
    expect(isolated.startsWith(BIDI.LRI)).toBe(true);
    expect(isolated.endsWith(BIDI.PDI)).toBe(true);
    const auto = isolateBidi('بغيت أتاي');
    expect(auto.startsWith(BIDI.FSI) || auto.startsWith(BIDI.RLI)).toBe(true);
    const joined = joinBidiSegments([{ text: 'بغيت أتاي عافاك', direction: 'rtl' }, { text: '(bghit atay 3afak)', direction: 'ltr' }], ' ');
    expect(stripBidiControls(joined)).toBe('بغيت أتاي عافاك (bghit atay 3afak)');
    expect(joined).not.toBe(stripBidiControls(joined));
    expect(stripBidiControls(isolated)).toBe('bghit atay');
  });

  it('pins trailing punctuation to the paragraph direction', () => {
    const pinned = pinTrailingPunctuation('واش بغيتي أتاي?', 'rtl');
    expect(stripBidiControls(pinned)).toBe('واش بغيتي أتاي?');
    expect(pinned.length).toBeGreaterThan('واش بغيتي أتاي?'.length);
    const ltr = pinTrailingPunctuation('Hello!', 'ltr');
    expect(stripBidiControls(ltr)).toBe('Hello!');
    expect(pinTrailingPunctuation('Hello', 'ltr')).toBe('Hello'); // nothing to pin
  });

  it('numeral options follow the learner preference and never force native digits silently', () => {
    expect(numeralOptions('ar-MA', 'latn').numberingSystem).toBe('latn');
    expect(numeralOptions('ar-EG', 'native').numberingSystem).toBe('arab');
    expect(numeralOptions('ar-EG', 'native').formattingLocale).toContain('-u-nu-arab');
    expect(numeralOptions('fr-CA', 'native').numberingSystem).toBe('latn');
    const t = createTranslator('ar', ['ar', 'en'], { numerals: 'latn' });
    expect(t.direction).toBe('rtl');
    expect(t.isRtl).toBe(true);
    expect(t.formatNumber(1234)).toMatch(/1[,.  ]?234/);
  });

  it('display layers for Darija/Hebrew put the native RTL layer first and the romanization second', () => {
    const both = displayLayersForMode('arabic-moroccan', 'both');
    expect(both.map((l) => l.kind)).toEqual(['native', 'transliteration']);
    expect(both[0]).toMatchObject({ script: 'Arab', direction: 'rtl', order: 0 });
    expect(both[1]).toMatchObject({ scheme: 'arabizi', direction: 'ltr', order: 1 });
    expect(displayLayersForMode('arabic-moroccan', 'native').map((l) => l.kind)).toEqual(['native']);
    expect(displayLayersForMode('arabic-moroccan', 'latin').map((l) => l.kind)).toEqual(['transliteration']);
    const hebrew = displayLayersForMode('hebrew', 'both');
    expect(hebrew[0]).toMatchObject({ script: 'Hebr', direction: 'rtl' });
    expect(hebrew[0]!.annotations).toContain('niqqud');
  });

  it('UI chrome follows uiLocale; an RTL UI locale yields an RTL translator even for an LTR course', () => {
    const t = translatorForContext({ uiLocale: 'ar-MA' });
    expect(t.isRtl).toBe(true);
    expect(t.t('onboarding.heroPromise')).toBeTruthy(); // falls back to en chrome (ar UI catalog not shipped yet), never throws
    expect(translatorForContext({ uiLocale: 'fr-CA' }).isRtl).toBe(false);
  });
});
