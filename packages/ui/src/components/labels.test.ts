/**
 * Integration-consistency checks between the component label vocabularies and
 * the `@langquest/locales` catalogs. The catalogs are read straight from disk so
 * this package does not take a runtime dependency on `@langquest/locales`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASSET_PICKER_LABELS,
  type LocalizedLabels,
  MISSION_FOCUS_VALUES,
  MISSION_LABELS,
  STORY_MAP_LABELS,
  mergeLabels,
} from './labels';

type Catalog = { readonly [key: string]: string | Catalog };

const here = dirname(fileURLToPath(import.meta.url));
const catalogsDir = resolve(here, '../../../locales/src/catalogs');

function loadCatalog(locale: 'en' | 'fr'): Catalog {
  return JSON.parse(readFileSync(resolve(catalogsDir, `${locale}.json`), 'utf8')) as Catalog;
}

function namespace(catalog: Catalog, path: string): Record<string, string> {
  const node = path
    .split('.')
    .reduce<Catalog | string | undefined>(
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

describe('mergeLabels / LocalizedLabels', () => {
  it('accepts plain localized strings without a cast and keeps formatters', () => {
    // `string` (not the literal) must be assignable — this is the cross-package gap.
    const start: string = ['Commencer'].join('');
    const overrides: LocalizedLabels<typeof MISSION_LABELS> = {
      start,
      minutes: (m) => `${m} min.`,
      focus: { tone: 'Tons' },
      status: { completed: 'Terminée' },
    };
    const L = mergeLabels(MISSION_LABELS, overrides);
    expect(L.start).toBe('Commencer');
    expect(L.continue).toBe(MISSION_LABELS.continue);
    expect(L.minutes(3)).toBe('3 min.');
    expect(L.focus).toEqual({ ...MISSION_LABELS.focus, tone: 'Tons' });
    expect(L.status).toEqual({ ...MISSION_LABELS.status, completed: 'Terminée' });
  });
  it('ignores undefined overrides and absent label sets', () => {
    const L = mergeLabels(STORY_MAP_LABELS, { listView: undefined, status: undefined });
    expect(L).toEqual(STORY_MAP_LABELS);
    expect(mergeLabels(ASSET_PICKER_LABELS, undefined)).toBe(ASSET_PICKER_LABELS);
    expect(mergeLabels(ASSET_PICKER_LABELS, null)).toBe(ASSET_PICKER_LABELS);
  });
  it('does not mutate the defaults', () => {
    const before = JSON.stringify(ASSET_PICKER_LABELS);
    mergeLabels(ASSET_PICKER_LABELS, { rights: { blocked: 'x' }, title: 'y' });
    expect(JSON.stringify(ASSET_PICKER_LABELS)).toBe(before);
  });
});
