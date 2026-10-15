/**
 * Admin i18n: `@langquest/locales` catalogs (en + fr complete) merged with the admin-only
 * extras. Works on the server (cookie-selected locale) and in the browser (provider).
 */
import { CATALOGS, createTranslator, type MessageCatalog, type Translator } from '@langquest/locales';
import { ADMIN_EXTRA_EN, ADMIN_EXTRA_FR } from './extra';

export const ADMIN_LOCALES = ['en', 'fr'] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];
export const DEFAULT_ADMIN_LOCALE: AdminLocale = 'en';
export const LOCALE_COOKIE = 'lq_admin_locale';

export const isAdminLocale = (value: unknown): value is AdminLocale =>
  typeof value === 'string' && (ADMIN_LOCALES as readonly string[]).includes(value);

function deepMerge(base: MessageCatalog, extra: MessageCatalog): MessageCatalog {
  const out: Record<string, string | MessageCatalog> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = out[key];
    if (typeof value === 'object' && value && typeof existing === 'object' && existing) out[key] = deepMerge(existing, value);
    else out[key] = value;
  }
  return out;
}

/** Catalogs with the admin extras merged in (memoised once per process). */
export const ADMIN_CATALOGS: Readonly<Record<AdminLocale, MessageCatalog>> = {
  en: deepMerge(CATALOGS.en, ADMIN_EXTRA_EN as unknown as MessageCatalog),
  fr: deepMerge(CATALOGS.fr, ADMIN_EXTRA_FR as unknown as MessageCatalog),
};

const translators = new Map<AdminLocale, Translator>();

/** Translator for an admin locale; `fr` falls back to `en` per key. */
export function getTranslator(locale: AdminLocale): Translator {
  const cached = translators.get(locale);
  if (cached) return cached;
  const t = createTranslator(locale, locale === 'en' ? ['en'] : [locale, 'en'], { catalogs: ADMIN_CATALOGS });
  translators.set(locale, t);
  return t;
}

/** Translation-key helper for content states / job states / roles from the shared catalog. */
export const contentStateKey = (state: string) => `admin.publish.state.${state}`;
export const jobStateKey = (state: string) => `admin.jobs.state.${state}`;
export const roleKey = (role: string) => `admin.roles.${role}`;
export const sectionKey = (section: string) => `admin.sections.${section}`;
export const coverageKey = (status: string) => `enrollment.coverage.${status}`;
