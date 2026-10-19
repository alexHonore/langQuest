/**
 * CONVENTIONS §2.1: the 30 course tracks keep their verbatim display names and stable slugs; every script-mode,
 * coverage and mascot label the UI needs exists in both complete locales; source-language instruction copy is
 * honest about which of the 23 source languages actually has a catalog (never silent English).
 */
import { COURSE_TRACKS, COURSE_TRACK_IDS, COVERAGE_STATUS_VALUES, MASCOT_STATE_VALUES, SOURCE_LANGUAGES, getCourseTrack } from '@langquest/contracts';
import { createTranslator, getFlatCatalog, scriptModeOptionsForTrack, sourceLanguageTranslator } from '@langquest/locales';
import { describe, expect, it } from 'vitest';

const EXPECTED: Array<[string, string, string]> = [
  ['arabic-eastern', 'Arabic (Eastern)', 'ar-levant'],
  ['arabic-moroccan', 'Arabic (Moroccan)', 'ary'],
  ['arabic-egyptian', 'Arabic (Egyptian)', 'arz'],
  ['arabic-msa', 'Arabic (Modern Standard)', 'arb'],
  ['chinese-cantonese', 'Chinese (Cantonese)', 'yue'],
  ['chinese-mandarin', 'Chinese (Mandarin)', 'cmn'],
  ['chinese-simplified', 'Chinese (Simplified)', 'cmn'],
  ['english', 'English', 'en'],
  ['danish', 'Danish', 'da'],
  ['french', 'French', 'fr'],
  ['german', 'German', 'de'],
  ['greek', 'Greek', 'el'],
  ['haitian-creole', 'Haitian Creole', 'ht'],
  ['hebrew', 'Hebrew', 'he'],
  ['hindi', 'Hindi', 'hi'],
  ['italian', 'Italian', 'it'],
  ['japanese', 'Japanese', 'ja'],
  ['korean', 'Korean', 'ko'],
  ['portuguese-brazilian', 'Portuguese (Brazilian)', 'pt-BR'],
  ['portuguese-european', 'Portuguese (European)', 'pt-PT'],
  ['romanian', 'Romanian', 'ro'],
  ['russian', 'Russian', 'ru'],
  ['spanish-latin-american', 'Spanish (Latin American)', 'es-419'],
  ['spanish-spain', 'Spanish (Spain-Castilian)', 'es-ES'],
  ['swahili', 'Swahili', 'sw'],
  ['kinyarwanda', 'Kinyarwanda', 'rw'],
  ['swedish', 'Swedish', 'sv'],
  ['lingala', 'Lingala', 'ln'],
  ['ukrainian', 'Ukrainian', 'uk'],
  ['vietnamese', 'Vietnamese', 'vi'],
];

describe('30-track labels and per-track UI keys', () => {
  const en = getFlatCatalog('en');
  const fr = getFlatCatalog('fr');

  it('the catalog carries exactly the 30 tracks of CONVENTIONS §2.1, in order, with verbatim display names', () => {
    expect(COURSE_TRACK_IDS).toHaveLength(30);
    expect([...COURSE_TRACKS].map((t) => t.id)).toEqual(EXPECTED.map(([id]) => id));
    for (const [i, [id, name, variety]] of EXPECTED.entries()) {
      const track = getCourseTrack(id as never);
      expect(track.displayName, id).toBe(name);
      expect(track.targetVarietyId, id).toBe(variety);
      expect(track.order).toBe(i + 1);
    }
  });

  it('every track renders "Learn {target} from {source}" in en and fr without leftover braces', () => {
    const tEn = createTranslator('en');
    const tFr = createTranslator('fr');
    for (const track of COURSE_TRACKS) {
      for (const [t, source] of [[tEn, 'French'], [tFr, 'français']] as const) {
        const text = t.t('onboarding.learnFrom', { target: track.displayName, source });
        expect(text, track.id).toContain(track.displayName);
        expect(text).toContain(source);
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });

  it('script-mode labels exist in both locales for every script mode offered by every track', () => {
    for (const track of COURSE_TRACKS) {
      const options = scriptModeOptionsForTrack(track.id);
      expect(options.map((o) => o.mode).sort()).toEqual([...track.scriptModeOptions].sort());
      expect(options.filter((o) => o.isDefault).map((o) => o.mode)).toEqual([track.defaultScriptMode]);
      for (const o of options) {
        expect(en[o.labelKey], `${track.id} ${o.labelKey} (en)`).toBeTruthy();
        expect(fr[o.labelKey], `${track.id} ${o.labelKey} (fr)`).toBeTruthy();
      }
    }
  });

  it('coverage, scoring-support and mascot state labels exist for every enum value', () => {
    for (const status of COVERAGE_STATUS_VALUES) {
      for (const flat of [en, fr]) {
        expect(flat[`catalog.coverage.${status}`], status).toBeTruthy();
        expect(flat[`enrollment.coverage.${status}`], status).toBeTruthy();
        expect(flat[`enrollment.coverage.detail.${status}`], status).toBeTruthy();
      }
    }
    for (const support of ['full', 'partial', 'limited'] as const) expect(en[`catalog.scoringSupport.${support}`]).toBeTruthy();
    for (const state of MASCOT_STATE_VALUES) {
      expect(en[`mascot.state.${state}`], state).toBeTruthy();
      expect(fr[`mascot.a11yState.${state}`], state).toBeTruthy();
    }
    for (const tab of ['home', 'missions', 'audio', 'speak', 'progress']) expect(fr[`common.tabs.${tab}`]).toBeTruthy();
  });

  it('instruction copy is honest about which of the 23 source languages has a catalog', () => {
    expect(SOURCE_LANGUAGES).toHaveLength(23);
    for (const { code } of SOURCE_LANGUAGES) {
      const st = sourceLanguageTranslator({ sourceLanguage: code });
      const covered = ['en', 'fr', 'es', 'ru'].includes(code);
      expect(st.sourceCovered, code).toBe(covered);
      expect(st.usesFallback, code).toBe(false); // nothing opted in: never a silent fallback
      const resolved = st.resolve('onboarding.heroPromise');
      if (covered) {
        expect(resolved.language).toBe(code);
        expect(resolved.isFallback).toBe(false);
        expect(resolved.missing).toBe(false);
      } else {
        expect(resolved.missing).toBe(true);
        expect(resolved.language).toBeNull();
        expect(st.effectiveLanguage).toBeNull();
      }
    }
    // Opting into a fallback is explicit and labelled per message.
    const swWithEnglish = sourceLanguageTranslator({ sourceLanguage: 'sw' }, { optedInFallbackLanguage: 'en' });
    expect(swWithEnglish.usesFallback).toBe(true);
    expect(swWithEnglish.resolve('onboarding.heroPromise')).toMatchObject({ language: 'en', isFallback: true, missing: false });
  });
});
