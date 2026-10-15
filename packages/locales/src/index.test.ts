import { describe, expect, it, vi } from 'vitest';
import { sourceLanguageTranslator, translatorForContext } from './index';

describe('translatorForContext (UI chrome)', () => {
  it('follows uiLocale and may fall back to en for chrome strings', () => {
    const t = translatorForContext({ uiLocale: 'fr-CA' });
    expect(t.fallbackChain).toEqual(['fr-CA', 'fr', 'en']);
    expect(t.t('onboarding.heroPromise')).toBe('Parlez dès le premier jour');
  });
});

describe('sourceLanguageTranslator (instruction copy, spec §2.1)', () => {
  it('serves a covered source language from its own catalog only', () => {
    const s = sourceLanguageTranslator({ sourceLanguage: 'fr' });
    expect(s.sourceLanguage).toBe('fr');
    expect(s.sourceCovered).toBe(true);
    expect(s.effectiveLanguage).toBe('fr');
    expect(s.usesFallback).toBe(false);
    expect(s.fallbackLanguage).toBeNull();
    expect(s.translator.fallbackChain).toEqual(['fr']);
    expect(s.resolve('onboarding.heroPromise')).toEqual({
      text: 'Parlez dès le premier jour',
      language: 'fr',
      isFallback: false,
      missing: false,
    });
  });

  it('never falls back to English on its own for a source language without a catalog', () => {
    const onMissing = vi.fn();
    const s = sourceLanguageTranslator({ sourceLanguage: 'ar' }, { onMissing });
    expect(s.sourceCovered).toBe(false);
    expect(s.effectiveLanguage).toBeNull();
    expect(s.usesFallback).toBe(false);
    expect(s.translator.fallbackChain).toEqual(['ar']);
    expect(s.translator.t('lesson.hint')).toBe('lesson.hint');
    const resolved = s.resolve('lesson.hint');
    expect(resolved).toEqual({ text: 'lesson.hint', language: null, isFallback: false, missing: true });
    expect(onMissing).toHaveBeenCalledWith(expect.objectContaining({ key: 'lesson.hint', locale: 'ar', triedLocales: ['ar'] }));
    expect(s.translator.t('onboarding.heroPromise')).not.toBe('Start speaking from day one');
  });

  it('uses an opted-in fallback and flags every message that comes from it', () => {
    const s = sourceLanguageTranslator({ sourceLanguage: 'ar' }, { optedInFallbackLanguage: 'en' });
    expect(s.sourceCovered).toBe(false);
    expect(s.effectiveLanguage).toBe('en');
    expect(s.fallbackLanguage).toBe('en');
    expect(s.usesFallback).toBe(true);
    expect(s.translator.fallbackChain).toEqual(['ar', 'en']);
    expect(s.resolve('onboarding.heroPromise')).toEqual({
      text: 'Start speaking from day one',
      language: 'en',
      isFallback: true,
      missing: false,
    });
  });

  it('labels per-key fallbacks for a partially translated source language', () => {
    const noOptIn = sourceLanguageTranslator({ sourceLanguage: 'es' });
    expect(noOptIn.sourceCovered).toBe(true);
    expect(noOptIn.effectiveLanguage).toBe('es');
    expect(noOptIn.usesFallback).toBe(false);
    expect(noOptIn.resolve('onboarding.heroPromise').language).toBe('es');
    // `lesson.*` is not in the Spanish catalog: without an opt-in it is missing, not English.
    expect(noOptIn.resolve('lesson.hint')).toMatchObject({ language: null, missing: true });

    const optedIn = sourceLanguageTranslator({ sourceLanguage: 'es' }, { optedInFallbackLanguage: 'en' });
    expect(optedIn.usesFallback).toBe(true);
    expect(optedIn.resolve('onboarding.heroPromise')).toMatchObject({ language: 'es', isFallback: false });
    expect(optedIn.resolve('lesson.hint')).toMatchObject({ language: 'en', isFallback: true, missing: false });
  });

  it('ignores an opt-in that equals the source or has no catalog', () => {
    expect(sourceLanguageTranslator({ sourceLanguage: 'fr' }, { optedInFallbackLanguage: 'fr' }).usesFallback).toBe(false);
    const s = sourceLanguageTranslator({ sourceLanguage: 'ht' }, { optedInFallbackLanguage: 'de' });
    expect(s.usesFallback).toBe(false);
    expect(s.fallbackLanguage).toBeNull();
    expect(s.effectiveLanguage).toBeNull();
    expect(s.translator.fallbackChain).toEqual(['ht']);
  });

  it('treats a runtime-loaded catalog as coverage for its language', () => {
    const s = sourceLanguageTranslator({ sourceLanguage: 'de' }, { catalogs: { de: { lesson: { hint: 'Brauchst du einen Tipp?' } } } });
    expect(s.sourceCovered).toBe(true);
    expect(s.effectiveLanguage).toBe('de');
    expect(s.resolve('lesson.hint')).toEqual({ text: 'Brauchst du einen Tipp?', language: 'de', isFallback: false, missing: false });
    expect(s.resolve('lesson.replay')).toMatchObject({ missing: true, language: null });
  });
});
