import { negotiateLocale } from '@langquest/locales';

/**
 * The UI-language choice to highlight. Profiles and devices carry regional tags (`fr-CA`, `en-GB`) while the
 * picker offers base locales (`fr`, `en`); device QA 2026-10-20 found Account → "Langue de l'application"
 * with nothing selected for a `fr-CA` profile. Negotiates the stored tag down to an offered option.
 */
export function selectedUiLocale(stored: string | null | undefined, offered: readonly string[], fallback = 'en'): string {
  return negotiateLocale(stored ? [stored] : [], offered, offered.includes(fallback) ? fallback : (offered[0] ?? fallback));
}
