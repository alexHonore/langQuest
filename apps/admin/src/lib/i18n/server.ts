import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_ADMIN_LOCALE, LOCALE_COOKIE, getTranslator, isAdminLocale, type AdminLocale } from './index';

/** Locale chosen through the switcher (cookie), defaulting to English. */
export async function currentLocale(): Promise<AdminLocale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isAdminLocale(value) ? value : DEFAULT_ADMIN_LOCALE;
}

/** Translator for the current request (server components / route handlers). */
export async function serverTranslator() {
  const locale = await currentLocale();
  const translator = getTranslator(locale);
  return { locale, t: translator.t, translator };
}
