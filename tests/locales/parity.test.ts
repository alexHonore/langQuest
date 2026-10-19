/**
 * §10.1 / CONVENTIONS §6: `en` and `fr` catalogs are complete and identical in key sets; every ICU message compiles
 * in every locale; the partial locales (es, ru) cover the namespaces onboarding and enrollment management need and
 * never claim more; coverage metadata matches the catalogs; and no copy mentions paywalls, tiers or credits as
 * product concepts (§0.2).
 */
import { BASE_LOCALE, CATALOGS, CATALOG_NAMESPACES, COVERAGE_METADATA, REQUIRED_PARTIAL_NAMESPACES, SUPPORTED_UI_LOCALES, computeCatalogCoverage, createTranslator, findInvalidIcuMessages, getFlatCatalog, namespaceOfKey, uiCoveragePctByLanguage } from '@langquest/locales';
import { describe, expect, it } from 'vitest';

describe('en/fr parity and ICU validity', () => {
  const en = getFlatCatalog('en');
  const fr = getFlatCatalog('fr');

  it('en and fr expose exactly the same keys, all non-empty, in every namespace', () => {
    const enKeys = Object.keys(en).sort();
    const frKeys = Object.keys(fr).sort();
    expect(frKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(800);
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(fr)) expect(v.trim(), `fr ${k}`).not.toBe('');
    const namespaces = new Set(enKeys.map(namespaceOfKey));
    for (const ns of CATALOG_NAMESPACES) expect(namespaces.has(ns), `namespace ${ns} present`).toBe(true);
  });

  it('every message in every locale is valid ICU and uses the same placeholders as the base locale', () => {
    const placeholders = (msg: string) => [...new Set([...msg.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]!))].sort();
    for (const locale of SUPPORTED_UI_LOCALES) {
      const flat = getFlatCatalog(locale);
      expect(findInvalidIcuMessages(flat, locale), `invalid ICU in ${locale}`).toEqual([]);
      for (const [k, v] of Object.entries(flat)) {
        if (en[k] === undefined) continue;
        expect(placeholders(v), `${locale} ${k} placeholders`).toEqual(placeholders(en[k]!));
      }
    }
  });

  it('partial locales cover the namespaces onboarding and enrollment need and report themselves honestly', () => {
    const coverage = computeCatalogCoverage(CATALOGS, BASE_LOCALE);
    expect(coverage.en?.status).toBe('complete');
    expect(coverage.fr?.status).toBe('complete');
    for (const locale of ['es', 'ru'] as const) {
      const c = coverage[locale]!;
      expect(c.status).toBe('partial');
      expect(c.usable).toBe(true);
      for (const ns of REQUIRED_PARTIAL_NAMESPACES) expect(c.completeNamespaces, `${locale} ${ns}`).toContain(ns);
      expect(c.extraKeys, `${locale} has keys unknown to en`).toEqual([]);
      expect(c.pct).toBeGreaterThan(0);
      expect(c.pct).toBeLessThan(100);
    }
    const pct = uiCoveragePctByLanguage();
    expect(pct.en).toBe(100);
    expect(pct.fr).toBe(100);
    expect(pct.es).toBeLessThan(100);
    expect(pct.sw ?? 0).toBe(0);
  });

  it('checked-in coverage metadata agrees with the catalogs', () => {
    const coverage = computeCatalogCoverage(CATALOGS, BASE_LOCALE);
    expect(COVERAGE_METADATA.baseLocale).toBe('en');
    for (const locale of SUPPORTED_UI_LOCALES) {
      const meta = COVERAGE_METADATA.locales[locale];
      expect(meta, `metadata for ${locale}`).toBeDefined();
      expect(meta!.status).toBe(coverage[locale]!.status);
      expect(meta!.usable).toBe(coverage[locale]!.usable);
      expect([...meta!.namespaces].sort()).toEqual([...coverage[locale]!.completeNamespaces].sort());
    }
  });

  it('a translator never throws and reports fallbacks explicitly instead of serving English silently', () => {
    const t = createTranslator('es');
    expect(t.fallbackChain).toEqual(['es', 'en']);
    const missing = Object.keys(en).find((k) => !(k in getFlatCatalog('es')))!;
    expect(t.t(missing)).toBe(en[missing]);
    expect(t.resolveLocaleFor(missing)).toBe('en');
    const strict = createTranslator('es', ['es'], { strict: true });
    expect(() => strict.t(missing)).toThrow();
    const broken = createTranslator('en');
    expect(broken.t('definitely.missing.key')).toBe('definitely.missing.key');
    expect(broken.has('onboarding.heroPromise')).toBe(true);
    expect(broken.t('onboarding.learnFrom', { target: 'Darija', source: 'French' })).toBe('Learn Darija from French');
  });

  it('no copy sells anything: no premium, upgrade, subscription, credits or tiers as product concepts', () => {
    const forbidden = /\b(premium|upgrade to|pro plan|credits? (left|remaining)|subscribe now|unlock (premium|pro)|paid tier)\b/i;
    for (const locale of SUPPORTED_UI_LOCALES) {
      for (const [k, v] of Object.entries(getFlatCatalog(locale))) expect(v, `${locale} ${k}`).not.toMatch(forbidden);
    }
    expect(en['onboarding.noPaywall']).toMatch(/free/i);
  });
});
