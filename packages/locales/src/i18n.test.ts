import { describe, expect, it, vi } from 'vitest';
import {
  BIDI,
  buildFallbackChain,
  createTranslator,
  detectTextDirection,
  hasMixedDirection,
  isRtlLocale,
  isolateBidi,
  joinBidiSegments,
  negotiateLocale,
  numeralOptions,
  parseLocale,
  pinTrailingPunctuation,
  stripBidiControls,
  textDirection,
} from './i18n';

describe('parseLocale / negotiateLocale', () => {
  it('parses regions, scripts and underscores', () => {
    expect(parseLocale('fr_CA')).toMatchObject({ language: 'fr', region: 'CA', tag: 'fr-CA' });
    expect(parseLocale('zh-hant-hk')).toMatchObject({ language: 'zh', script: 'Hant', region: 'HK', tag: 'zh-Hant-HK' });
    expect(parseLocale('ar-u-nu-arab')).toMatchObject({ language: 'ar', tag: 'ar' });
    expect(parseLocale('es-419').region).toBe('419');
  });

  it('collapses fr-CA onto fr and prefers exact matches', () => {
    expect(negotiateLocale(['fr-CA', 'en-US'])).toBe('fr');
    expect(negotiateLocale(['de-DE', 'ru-RU'])).toBe('ru');
    expect(negotiateLocale(['de-DE'])).toBe('en');
    expect(negotiateLocale(['fr-CA'], ['en', 'fr-CA', 'fr'])).toBe('fr-CA');
    expect(negotiateLocale([])).toBe('en');
  });

  it('builds fallback chains ending in en', () => {
    expect(buildFallbackChain('fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
    expect(buildFallbackChain('es')).toEqual(['es', 'en']);
    expect(buildFallbackChain('en')).toEqual(['en']);
    expect(buildFallbackChain('zh-Hant-HK')).toEqual(['zh-Hant-HK', 'en']);
  });
});

describe('createTranslator', () => {
  it('formats plurals, selects, numbers and dates', () => {
    const t = createTranslator('en');
    expect(t.t('common.minutes', { count: 1 })).toBe('1 minute');
    expect(t.t('common.minutes', { count: 7 })).toBe('7 minutes');
    expect(t.t('home.reviewDueCount', { count: 0 })).toBe('Nothing due right now');
    expect(t.t('onboarding.learnFrom', { target: 'Arabic (Moroccan)', source: 'French' })).toBe('Learn Arabic (Moroccan) from French');
    expect(t.t('common.percent', { value: 0.42 })).toBe('42%');
    expect(t.t('common.dateShort', { date: new Date(Date.UTC(2026, 0, 15, 12)) })).toMatch(/1\/15\/26/);
  });

  it('uses French plural rules and French copy', () => {
    const t = createTranslator('fr-CA');
    expect(t.fallbackChain).toEqual(['fr-CA', 'fr', 'en']);
    expect(t.t('common.minutes', { count: 1 })).toBe('1 minute');
    expect(t.t('onboarding.heroPromise')).toBe('Parlez dès le premier jour');
    expect(t.resolveLocaleFor('onboarding.heroPromise')).toBe('fr-CA');
  });

  it('uses Russian few/many plural forms', () => {
    const t = createTranslator('ru');
    expect(t.t('common.minutes', { count: 1 })).toBe('1 минута');
    expect(t.t('common.minutes', { count: 3 })).toBe('3 минуты');
    expect(t.t('common.minutes', { count: 5 })).toBe('5 минут');
    expect(t.t('common.minutes', { count: 21 })).toBe('21 минута');
  });

  it('falls back per key and reports missing keys without throwing', () => {
    const onMissing = vi.fn();
    const t = createTranslator('es', undefined, { onMissing });
    // es has no `home` namespace → falls through to en
    expect(t.t('home.welcomeBackAnonymous')).toBe('Welcome back!');
    expect(t.resolveLocaleFor('home.welcomeBackAnonymous')).toBe('en');
    expect(t.resolveLocaleFor('onboarding.heroPromise')).toBe('es');
    expect(t.t('does.not.exist')).toBe('does.not.exist');
    expect(t.t('does.not.exist')).toBe('does.not.exist');
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(t.missingKeys()).toEqual([{ key: 'does.not.exist', locale: 'es', triedLocales: ['es', 'en'] }]);
    expect(t.has('does.not.exist')).toBe(false);
  });

  it('strict mode throws on missing keys (tests only)', () => {
    const t = createTranslator('en', undefined, { strict: true });
    expect(() => t.t('nope')).toThrow(/Missing translation/);
  });

  it('survives malformed custom messages and reports the format error', () => {
    const onFormatError = vi.fn();
    const t = createTranslator('en', ['en'], { catalogs: { en: { x: { bad: '{count, plural, one {# thing}' } } }, onFormatError });
    expect(t.t('x.bad', { count: 1 })).toBe('{count, plural, one {# thing}');
    expect(onFormatError).toHaveBeenCalledTimes(1);
    expect(onFormatError.mock.calls[0]?.[0]).toMatchObject({ key: 'x.bad', locale: 'en' });
    // compiled-message cache: second call does not recompile/re-report
    t.t('x.bad', { count: 2 });
    expect(onFormatError).toHaveBeenCalledTimes(1);
  });

  it('accepts runtime catalogs for a regional override', () => {
    const t = createTranslator('fr-CA', undefined, { catalogs: { 'fr-CA': { common: { ok: 'Correct' } } } });
    expect(t.t('common.ok')).toBe('Correct');
    expect(t.t('common.cancel')).toBe('Annuler');
  });

  it('exposes direction and numeral options', () => {
    const ar = createTranslator('ar-MA', ['en'], { numerals: 'native' });
    expect(ar.isRtl).toBe(true);
    expect(ar.direction).toBe('rtl');
    expect(ar.numerals.numberingSystem).toBe('arab');
    expect(ar.formatNumber(1234)).toBe('١٬٢٣٤');
    const latn = createTranslator('ar', ['en']);
    expect(latn.numerals.numberingSystem).toBe('latn');
    expect(latn.formatNumber(1234)).toBe('1,234');
    expect(createTranslator('fr').formatPercent(0.5).replace(/\s/g, ' ')).toBe('50 %');
  });

  it('formats lists and relative times in the UI locale', () => {
    const t = createTranslator('fr');
    expect(t.formatList(['a', 'b', 'c'])).toBe('a, b et c');
    expect(t.formatRelativeTime(-1, 'day')).toBe('hier');
  });
});

describe('RTL and bidi helpers', () => {
  it('detects RTL locales and varieties', () => {
    for (const tag of ['ar', 'ar-MA', 'he-IL', 'ary', 'arz', 'arb', 'fa', 'ur', 'zh-Arab']) expect(isRtlLocale(tag), tag).toBe(true);
    for (const tag of ['en', 'fr-CA', 'ru', 'he-Latn', 'ja']) expect(isRtlLocale(tag), tag).toBe(false);
    expect(textDirection('he')).toBe('rtl');
    expect(textDirection('vi')).toBe('ltr');
  });

  it('detects text direction from the first strong character', () => {
    expect(detectTextDirection('مرحبا')).toBe('rtl');
    expect(detectTextDirection('שלום')).toBe('rtl');
    expect(detectTextDirection('salam')).toBe('ltr');
    expect(detectTextDirection('123 !')).toBeNull();
    expect(detectTextDirection('  (مرحبا)')).toBe('rtl');
  });

  it('isolates mixed Arabic/Latin runs', () => {
    const mixed = 'كنمشي ل café';
    expect(hasMixedDirection(mixed)).toBe(true);
    expect(hasMixedDirection('café')).toBe(false);
    expect(isolateBidi(mixed)).toBe(`${BIDI.FSI}${mixed}${BIDI.PDI}`);
    expect(isolateBidi('café', 'ltr')).toBe(`${BIDI.LRI}café${BIDI.PDI}`);
    expect(isolateBidi('')).toBe('');
    const joined = joinBidiSegments([
      { text: 'كيف داير؟', direction: 'rtl' },
      { text: 'kif dayer?', direction: 'ltr' },
      { text: '' },
    ]);
    expect(joined).toBe(`${BIDI.RLI}كيف داير؟${BIDI.PDI} ${BIDI.LRI}kif dayer?${BIDI.PDI}`);
    expect(stripBidiControls(joined)).toBe('كيف داير؟ kif dayer?');
  });

  it('pins trailing punctuation with a direction mark', () => {
    expect(pinTrailingPunctuation('كيف داير؟', 'rtl')).toBe(`كيف داير؟${BIDI.RLM}`);
    expect(pinTrailingPunctuation('hello', 'ltr')).toBe('hello');
  });

  it('resolves numeral options', () => {
    expect(numeralOptions('ar', 'latn')).toEqual({ numberingSystem: 'latn', formattingLocale: 'ar-u-nu-latn' });
    expect(numeralOptions('ar-EG', 'native').numberingSystem).toBe('arab');
    expect(numeralOptions('ary', 'native').numberingSystem).toBe('latn');
    expect(numeralOptions('fr', 'native').numberingSystem).toBe('latn');
    expect(numeralOptions('fr', 'auto')).toEqual({ numberingSystem: 'latn', formattingLocale: 'fr' });
  });
});
