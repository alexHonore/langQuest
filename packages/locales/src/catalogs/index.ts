/**
 * Bundled ICU message catalogs.
 *
 * Catalogs are nested JSON objects: top-level keys are namespaces, leaves are ICU
 * MessageFormat strings. `flattenCatalog` turns them into dot-separated keys
 * (`onboarding.learnFrom`) which is what the translator and the coverage tools use.
 *
 * `en` and `fr` are complete; `es` and `ru` carry only the namespaces needed to
 * onboard and manage enrollments (see `coverage.json` and `coverage.ts`).
 */
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import ru from './ru.json';

/** Nested catalog shape as authored in JSON. */
export type MessageCatalog = { readonly [key: string]: string | MessageCatalog };
/** Flat `namespace.path.key` → ICU message. */
export type FlatCatalog = Readonly<Record<string, string>>;

/** UI locales that ship with a catalog, in production-priority order (CONVENTIONS §2.2). */
export const SUPPORTED_UI_LOCALES = ['en', 'fr', 'es', 'ru'] as const;
export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

/** The locale every fallback chain ends with; its catalog is the reference key set. */
export const BASE_LOCALE: SupportedUiLocale = 'en';

/** Namespaces every complete catalog must contain (the `en` top-level keys, fixed here so tests fail loudly on drift). */
export const CATALOG_NAMESPACES = [
  'common',
  'onboarding',
  'home',
  'catalog',
  'missions',
  'lesson',
  'speak',
  'pronunciation',
  'audio',
  'progress',
  'account',
  'enrollment',
  'errors',
  'mascot',
  'admin',
  'legal',
] as const;
export type CatalogNamespace = (typeof CATALOG_NAMESPACES)[number];

/** Namespaces that a partially translated locale must still provide to be usable. */
export const REQUIRED_PARTIAL_NAMESPACES = ['common', 'onboarding', 'enrollment'] as const satisfies readonly CatalogNamespace[];

export const CATALOGS: Readonly<Record<SupportedUiLocale, MessageCatalog>> = {
  en: en as MessageCatalog,
  fr: fr as MessageCatalog,
  es: es as MessageCatalog,
  ru: ru as MessageCatalog,
};

/** Flatten a nested catalog into `a.b.c` keys. Leaves must be strings; anything else is ignored. */
export function flattenCatalog(catalog: MessageCatalog, prefix = ''): FlatCatalog {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value && typeof value === 'object') Object.assign(out, flattenCatalog(value, path));
  }
  return out;
}

const flatCache = new Map<string, FlatCatalog>();

/** Flattened bundled catalog for a supported locale (memoised). */
export function getFlatCatalog(locale: SupportedUiLocale): FlatCatalog {
  let flat = flatCache.get(locale);
  if (!flat) {
    flat = flattenCatalog(CATALOGS[locale]);
    flatCache.set(locale, flat);
  }
  return flat;
}

export const isSupportedUiLocale = (value: unknown): value is SupportedUiLocale =>
  typeof value === 'string' && (SUPPORTED_UI_LOCALES as readonly string[]).includes(value);

/** Namespace part of a flat key (`onboarding.level.title` → `onboarding`). */
export const namespaceOfKey = (key: string): string => key.split('.', 1)[0] ?? key;
