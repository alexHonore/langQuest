/**
 * ECMA-402 polyfills for Hermes (iOS / Android). Imported FIRST by `src/app/_layout.tsx`.
 *
 * The Hermes build shipped with Expo SDK 57 / React Native 0.86 has `Intl.NumberFormat` and
 * `Intl.DateTimeFormat` but no `Intl.PluralRules`, `Intl.Locale` or `Intl.DisplayNames`
 * (device QA 2026-10-20). Without them:
 * - every ICU plural in `@langquest/locales` (intl-messageformat) rendered its raw source on device,
 *   e.g. Progress showed "{count, plural, one {# min de parole} …}";
 * - `useLanguageNames()` fell back to the bare code, so the course header read "à partir du fr".
 * Web and Node have these natively; each `polyfill` entry is a no-op there, and the locale data only
 * registers on a polyfilled constructor. Locale data covers the UI locales (`SUPPORTED_UI_LOCALES`);
 * language NAMES are rendered in the UI locale, so en/fr/es/ru data is all the display names need.
 * Order matters: getCanonicalLocales → Locale → PluralRules → DisplayNames.
 */
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/fr.js';
import '@formatjs/intl-pluralrules/locale-data/es.js';
import '@formatjs/intl-pluralrules/locale-data/ru.js';
import '@formatjs/intl-displaynames/polyfill.js';
import '@formatjs/intl-displaynames/locale-data/en.js';
import '@formatjs/intl-displaynames/locale-data/fr.js';
import '@formatjs/intl-displaynames/locale-data/es.js';
import '@formatjs/intl-displaynames/locale-data/ru.js';

/** The Intl constructors the app's i18n depends on (for diagnostics and tests). */
export function intlCapabilities(): { pluralRules: boolean; displayNames: boolean; locale: boolean } {
  return {
    pluralRules: typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function',
    displayNames: typeof Intl !== 'undefined' && typeof (Intl as { DisplayNames?: unknown }).DisplayNames === 'function',
    locale: typeof Intl !== 'undefined' && typeof (Intl as { Locale?: unknown }).Locale === 'function',
  };
}
