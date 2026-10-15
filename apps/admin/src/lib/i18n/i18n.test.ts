import { describe, expect, it } from 'vitest';
import { flattenCatalog, findInvalidIcuMessages } from '@langquest/locales';
import { ADMIN_EXTRA_EN, ADMIN_EXTRA_FR } from './extra';
import { getTranslator } from './index';

describe('admin i18n extras', () => {
  it('fr covers every en key', () => {
    const en = Object.keys(flattenCatalog(ADMIN_EXTRA_EN));
    const fr = new Set(Object.keys(flattenCatalog(ADMIN_EXTRA_FR)));
    const missing = en.filter((k) => !fr.has(k));
    expect(missing).toEqual([]);
  });

  it('every extra message is valid ICU', () => {
    expect(findInvalidIcuMessages(flattenCatalog(ADMIN_EXTRA_EN), 'en')).toEqual([]);
    expect(findInvalidIcuMessages(flattenCatalog(ADMIN_EXTRA_FR), 'fr')).toEqual([]);
  });

  it('merges extras with the shared admin namespace', () => {
    const en = getTranslator('en');
    expect(en.t('admin.sections.uploads')).toBe('Uploads');
    expect(en.t('admin.ui.upFiles', { count: 2 })).toBe('2 files');
    const fr = getTranslator('fr');
    expect(fr.t('admin.ui.signIn')).toBe('Se connecter');
    expect(fr.t('admin.publish.state.published')).not.toBe('admin.publish.state.published');
  });
});
