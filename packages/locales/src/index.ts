/**
 * @langquest/locales — ICU message catalogs (en, fr complete; es, ru partial), translator,
 * locale negotiation, RTL/bidi helpers, script metadata and transliteration utilities.
 *
 * `LanguageContext` itself lives in `@langquest/contracts` (CONVENTIONS §2.3); this package
 * consumes it (`translatorForContext`, `sourceLanguageTranslator`) rather than redefining it.
 */
export * from './catalogs';
export * from './i18n';
export * from './scripts';
export * from './coverage';
export * from './transliteration';

import type { LanguageContext, SourceLanguageCode } from '@langquest/contracts';
import { isSupportedUiLocale, type FlatCatalog, type MessageCatalog } from './catalogs';
import { createTranslator, parseLocale, type MessageValues, type Translator, type TranslatorOptions } from './i18n';

/**
 * Translator for the UI locale of a `LanguageContext`. UI copy follows `uiLocale`; the
 * enrollment's `sourceLanguage` is **not** used for chrome strings (spec §10.1: three
 * independent variables). Chrome falls back to `en` so the app shell is always complete.
 * Use `sourceLanguageTranslator` for instruction/hint copy, which must never do that silently.
 */
export const translatorForContext = (ctx: Pick<LanguageContext, 'uiLocale'>, options?: TranslatorOptions): Translator =>
  createTranslator(ctx.uiLocale, undefined, options);

export interface SourceLanguageTranslatorOptions extends TranslatorOptions {
  /**
   * Fallback instruction language the learner **explicitly opted into** for this enrollment:
   * the `fallback_source_language_code` of its `course_source_localizations` row, accepted
   * through `enrollment.coverage.optInFallback` (spec §2.1). Without it, no language other
   * than `sourceLanguage` is consulted, so copy can never be served in an unexpected language.
   */
  optedInFallbackLanguage?: SourceLanguageCode | string | null;
}

/** One instruction-copy lookup with its provenance (which language actually answered). */
export interface ResolvedSourceMessage {
  /** Formatted message, or the key itself when `missing`. */
  text: string;
  /** Language whose catalog provided the message; `null` when `missing`. */
  language: string | null;
  /**
   * True when the message came from the opted-in fallback instead of the source language.
   * Render `enrollment.coverage.fallbackLabel` next to it (spec §2.1: never silent).
   */
  isFallback: boolean;
  /** True when neither the source language nor the opted-in fallback has the key. */
  missing: boolean;
}

/**
 * Result of `sourceLanguageTranslator`: a translator restricted to the enrollment's source
 * language (plus an explicit opt-in fallback) and the flags the UI needs to render the
 * editorial-status banner instead of silently emitting English.
 */
export interface SourceLanguageTranslation {
  /** Translator whose chain is `[sourceLanguage]` or `[sourceLanguage, fallbackLanguage]`; never an implicit `en`. */
  translator: Translator;
  /** Normalised source language tag from the context. */
  sourceLanguage: string;
  /**
   * Language whose catalog answers first: the source language when it is covered, else the
   * opted-in fallback, else `null` (nothing can be served; show `enrollment.coverage.detail.planned`).
   */
  effectiveLanguage: string | null;
  /** A catalog exists for the source language (a partial catalog still counts; see `resolve`). */
  sourceCovered: boolean;
  /** Opted-in fallback actually consulted (has a catalog and differs from the source), else `null`. */
  fallbackLanguage: string | null;
  /**
   * Single flag for the UI: true whenever some copy may be served in `fallbackLanguage`
   * rather than `sourceLanguage`. When true, render `enrollment.coverage.fallbackLabel`
   * (and per-message labels from `resolve`).
   */
  usesFallback: boolean;
  /** Translate `key` and report which language answered, so each hint can be labelled individually. */
  resolve(key: string, values?: MessageValues): ResolvedSourceMessage;
}

const hasCatalog = (tag: string, catalogs?: Readonly<Record<string, MessageCatalog | FlatCatalog>>): boolean => {
  if (catalogs?.[tag]) return true;
  if (isSupportedUiLocale(tag)) return true;
  const language = parseLocale(tag).language;
  return language !== tag && (Boolean(catalogs?.[language]) || isSupportedUiLocale(language));
};

/**
 * Translator for learner-facing instruction copy (hints, mascot speech, lesson prompts),
 * which follows the enrollment's `sourceLanguage` rather than the UI locale (spec §10.2A item 6).
 *
 * Unlike `translatorForContext`, this never appends `en` on its own (spec §2.1: "do not
 * silently fall back to English while claiming to teach from French"). The chain is the
 * source language alone, or the source language followed by the learner's opted-in fallback
 * (`options.optedInFallbackLanguage`, from the enrollment's coverage row). A source language
 * without a catalog and without an opt-in yields `sourceCovered: false`, `effectiveLanguage: null`
 * and missing keys (reported through `onMissing`), which the UI must turn into the editorial
 * status banner and the opt-in control, not into English copy.
 */
export function sourceLanguageTranslator(
  ctx: Pick<LanguageContext, 'sourceLanguage'>,
  options: SourceLanguageTranslatorOptions = {},
): SourceLanguageTranslation {
  const { optedInFallbackLanguage, ...translatorOptions } = options;
  const sourceLanguage = parseLocale(ctx.sourceLanguage).tag;
  const sourceCovered = hasCatalog(sourceLanguage, options.catalogs);

  const fallbackTag = optedInFallbackLanguage ? parseLocale(optedInFallbackLanguage).tag : null;
  const fallbackLanguage = fallbackTag && fallbackTag !== sourceLanguage && hasCatalog(fallbackTag, options.catalogs) ? fallbackTag : null;

  const chain = fallbackLanguage ? [sourceLanguage, fallbackLanguage] : [sourceLanguage];
  const translator = createTranslator(sourceLanguage, chain, translatorOptions);
  const effectiveLanguage = sourceCovered ? sourceLanguage : fallbackLanguage;

  return {
    translator,
    sourceLanguage,
    effectiveLanguage,
    sourceCovered,
    fallbackLanguage,
    usesFallback: fallbackLanguage !== null,
    resolve: (key, values) => {
      const language = translator.resolveLocaleFor(key);
      return {
        text: translator.t(key, values),
        language,
        isFallback: language !== null && language !== sourceLanguage,
        missing: language === null,
      };
    },
  };
}
