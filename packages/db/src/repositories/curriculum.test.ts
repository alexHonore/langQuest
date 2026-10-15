import { describe, expect, it } from 'vitest';
import { resolveManifestTitle } from './curriculum';

describe('resolveManifestTitle (honest localization, §2.1)', () => {
  const titles = { en: 'At the café', fr: 'Au café', es: 'En el café' };

  it('returns the requested source language when present', () => {
    expect(resolveManifestTitle(titles, 'fr', null)).toEqual({
      title: 'Au café',
      titleLanguageCode: 'fr',
    });
    expect(resolveManifestTitle(titles, 'fr', 'en')).toEqual({
      title: 'Au café',
      titleLanguageCode: 'fr',
    });
  });

  it('never silently substitutes English (or any other language) when the source is missing', () => {
    expect(resolveManifestTitle(titles, 'ru', null)).toEqual({
      title: '',
      titleLanguageCode: null,
    });
    expect(resolveManifestTitle({ en: 'Only English' }, 'fr', null)).toEqual({
      title: '',
      titleLanguageCode: null,
    });
    // A declared fallback that itself has no title is not replaced by "first available".
    expect(resolveManifestTitle({ es: 'Sólo español' }, 'fr', 'en')).toEqual({
      title: '',
      titleLanguageCode: null,
    });
  });

  it('uses only the explicitly declared fallback language and says so', () => {
    expect(resolveManifestTitle(titles, 'ru', 'en')).toEqual({
      title: 'At the café',
      titleLanguageCode: 'en',
    });
    expect(resolveManifestTitle(titles, 'ru', 'es')).toEqual({
      title: 'En el café',
      titleLanguageCode: 'es',
    });
  });

  it('treats blank, non-string and malformed translation payloads as missing', () => {
    expect(resolveManifestTitle({ fr: '   ', en: 'x' }, 'fr', null)).toEqual({
      title: '',
      titleLanguageCode: null,
    });
    expect(resolveManifestTitle({ fr: 42 }, 'fr', null)).toEqual({
      title: '',
      titleLanguageCode: null,
    });
    expect(resolveManifestTitle(null, 'fr', 'en')).toEqual({ title: '', titleLanguageCode: null });
    expect(resolveManifestTitle(['fr'], 'fr', 'en')).toEqual({
      title: '',
      titleLanguageCode: null,
    });
  });
});
