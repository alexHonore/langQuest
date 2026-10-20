import { describe, expect, it } from 'vitest';
import { selectedUiLocale } from './ui-locale';

describe('selectedUiLocale (Account UI-language picker)', () => {
  it('maps a regional profile tag onto the offered base locale (fr-CA showed no selection on device)', () => {
    expect(selectedUiLocale('fr-CA', ['en', 'fr'])).toBe('fr');
    expect(selectedUiLocale('en-GB', ['en', 'fr'])).toBe('en');
  });
  it('keeps an exact match and falls back when nothing is stored or offered', () => {
    expect(selectedUiLocale('fr', ['en', 'fr'])).toBe('fr');
    expect(selectedUiLocale(null, ['en', 'fr'])).toBe('en');
    expect(selectedUiLocale('ja', ['en', 'fr'])).toBe('en');
  });
});
