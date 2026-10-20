import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Simulate the Hermes runtime found on device (2026-10-20): no PluralRules, Locale or DisplayNames.
const saved = { PluralRules: Intl.PluralRules, Locale: Intl.Locale, DisplayNames: Intl.DisplayNames };
type Mutable = Record<string, unknown>;

describe('intl-polyfills (Hermes lacks Intl.PluralRules / Locale / DisplayNames)', () => {
  beforeAll(() => {
    delete (Intl as unknown as Mutable).PluralRules;
    delete (Intl as unknown as Mutable).Locale;
    delete (Intl as unknown as Mutable).DisplayNames;
    vi.resetModules();
  });
  afterAll(() => {
    Object.assign(Intl as unknown as Mutable, saved);
  });

  it('installs the missing constructors with UI-locale data', async () => {
    const { intlCapabilities } = await import('./intl-polyfills');
    expect(intlCapabilities()).toEqual({ pluralRules: true, displayNames: true, locale: true });
    expect(new Intl.PluralRules('fr').select(2)).toBe('other');
    expect(new Intl.PluralRules('ru').select(3)).toBe('few');
    expect(new Intl.DisplayNames(['fr'], { type: 'language' }).of('fr')).toBe('français');
  });

  it('lets ICU plurals format instead of printing their source (Progress showed "{count, plural, …}")', async () => {
    await import('./intl-polyfills');
    const { createTranslator } = await import('@langquest/locales');
    const t = createTranslator('fr');
    const line = t.t('home.speakingSummary', { count: 3 });
    expect(line).not.toContain('{count');
    expect(line).toContain('3');
  });
});
