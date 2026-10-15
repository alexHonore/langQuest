/**
 * Integration-consistency checks between the component label vocabularies and
 * the `@langquest/locales` catalogs. The catalogs are read straight from disk so
 * this package does not take a runtime dependency on `@langquest/locales`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MISSION_FOCUS_VALUES, MISSION_LABELS } from './labels';

type Catalog = { readonly [key: string]: string | Catalog };

const here = dirname(fileURLToPath(import.meta.url));
const catalogsDir = resolve(here, '../../../locales/src/catalogs');

function loadCatalog(locale: 'en' | 'fr'): Catalog {
  return JSON.parse(readFileSync(resolve(catalogsDir, `${locale}.json`), 'utf8')) as Catalog;
}

function namespace(catalog: Catalog, path: string): Record<string, string> {
  const node = path.split('.').reduce<Catalog | string | undefined>(
    (acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined),
    catalog,
  );
  if (!node || typeof node !== 'object') throw new Error(`Missing catalog namespace ${path}`);
  return node as Record<string, string>;
}

describe('MISSION_LABELS.focus ↔ locales missions.focus', () => {
  for (const locale of ['en', 'fr'] as const) {
    it(`uses exactly the ${locale} catalog's missions.focus keys`, () => {
      const catalogKeys = Object.keys(namespace(loadCatalog(locale), 'missions.focus')).sort();
      expect(Object.keys(MISSION_LABELS.focus).sort()).toEqual(catalogKeys);
      expect([...MISSION_FOCUS_VALUES].sort()).toEqual(catalogKeys);
    });
  }
});
