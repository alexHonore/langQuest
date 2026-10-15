/**
 * UI localisation (§10.1): the chrome follows `ui_locale` (device locale
 * negotiated against the catalogs, overridable in settings); instruction copy
 * follows each enrollment's `source_language_code` through
 * `sourceLanguageTranslator` and is never silently served in English.
 */
import type { SourceLanguageCode } from '@langquest/contracts';
import {
  SUPPORTED_UI_LOCALES,
  buildFallbackChain,
  createTranslator,
  isRtlLocale,
  negotiateLocale,
  sourceLanguageTranslator,
  type MessageValues,
  type SourceLanguageTranslation,
  type Translator,
} from '@langquest/locales';
import { getLocales } from 'expo-localization';
import React, { createContext, useContext, useMemo } from 'react';
import { usePrefs } from '@/state/prefs';

export interface I18n {
  locale: string;
  translator: Translator;
  t: (key: string, values?: MessageValues) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18n | null>(null);

/** Device locale negotiated to a supported UI locale (fr-CA → fr, unknown → en). */
export function deviceUiLocale(): string {
  const tags = getLocales().map((l) => l.languageTag);
  return negotiateLocale(tags, SUPPORTED_UI_LOCALES, 'en');
}

export function buildI18n(locale: string): I18n {
  const translator = createTranslator(locale, buildFallbackChain(locale), {
    onMissing: (report) => {
      if (__DEV__) console.warn(`[i18n] missing ${report.key} for ${report.locale}`);
    },
  });
  return { locale, translator, t: (key, values) => translator.t(key, values), isRtl: isRtlLocale(locale) };
}

export function I18nProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const override = usePrefs((s) => s.uiLocale);
  const locale = override ?? deviceUiLocale();
  const value = useMemo(() => buildI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) return buildI18n('en');
  return ctx;
}

export const useT = (): I18n['t'] => useI18n().t;

/**
 * Instruction-language translator for one enrollment (mascot speech, hints).
 * `usesFallback` / `resolve()` tell the UI when a line comes from the opted-in
 * fallback language so it can be labelled (§2.1).
 */
export function useSourceTranslator(sourceLanguage: SourceLanguageCode | string | null | undefined, optedInFallback?: string | null): SourceLanguageTranslation | null {
  return useMemo(() => {
    if (!sourceLanguage) return null;
    return sourceLanguageTranslator({ sourceLanguage: sourceLanguage as SourceLanguageCode }, { optedInFallbackLanguage: optedInFallback ?? null });
  }, [sourceLanguage, optedInFallback]);
}

/** Localised display names for UI-locale rendering, falling back to the catalog English names. */
export function useLanguageNames(): (code: string) => string {
  const { locale } = useI18n();
  return useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames([locale, 'en'], { type: 'language' }) : null;
    } catch {
      dn = null;
    }
    return (code: string): string => {
      try {
        const name = dn?.of(code);
        if (name && name !== code) return name;
      } catch {
        /* unsupported code */
      }
      return code;
    };
  }, [locale]);
}
