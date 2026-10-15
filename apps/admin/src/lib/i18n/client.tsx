'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Translator } from '@langquest/locales';
import { getTranslator, type AdminLocale } from './index';

interface I18nContextValue {
  locale: AdminLocale;
  /** Translate function (`t(key, values)`). */
  t: Translator['t'];
  /** Full translator (formatting helpers, direction). */
  translator: Translator;
}
const I18nContext = createContext<I18nContextValue | null>(null);

/** Provides the admin translator to client components. */
export function I18nProvider({ locale, children }: { locale: AdminLocale; children: ReactNode }) {
  const value = useMemo(() => {
    const translator = getTranslator(locale);
    return { locale, t: translator.t, translator };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translator hook; falls back to English outside a provider (tests, isolated renders). */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const translator = getTranslator('en');
  return { locale: 'en', t: translator.t, translator };
}

/** Shorthand returning `t` only. */
export function useT(): Translator['t'] {
  return useI18n().t;
}
