import type { MissionExpression } from '@langquest/contracts';
import { BIDI } from '@langquest/locales';
import { describe, expect, it } from 'vitest';
import { formsForScriptMode, isolateSourceText, sourceTextDirection, turnLayersForScriptMode } from './forms';

const darija: Pick<MissionExpression, 'canonicalText' | 'forms'> = {
  canonicalText: 'واش كاين شي قهوة؟',
  forms: [
    { text: 'واش كاين شي قهوة؟', script: 'Arab', transliterationScheme: null },
    { text: 'wach kayn chi qahwa?', script: 'Latn', transliterationScheme: 'arabizi' },
  ],
};

describe('formsForScriptMode', () => {
  it('honours the per-enrollment script mode (Arabizi-only learners never see the Arabic script forced)', () => {
    expect(formsForScriptMode(darija, 'Arab', 'latin').map((f) => f.text)).toEqual(['wach kayn chi qahwa?']);
    expect(formsForScriptMode(darija, 'Arab', 'native').map((f) => f.text)).toEqual(['واش كاين شي قهوة؟']);
    expect(formsForScriptMode(darija, 'Arab', 'both').map((f) => f.transliterationScheme)).toEqual([null, 'arabizi']);
  });

  it('never hides the phrase: latin mode without a transliteration falls back to the native form', () => {
    const noTranslit = { canonicalText: 'Bonjour', forms: [] };
    expect(formsForScriptMode(noTranslit, 'Latn', 'latin')).toEqual([{ text: 'Bonjour', script: 'Latn', transliterationScheme: null }]);
  });
});

describe('turnLayersForScriptMode', () => {
  it('shows the transliteration as the primary layer in latin mode', () => {
    expect(turnLayersForScriptMode({ text: 'שלום', transliteration: 'shalom' }, 'latin')).toEqual({ primary: 'shalom', secondary: null, primaryIsTransliteration: true });
    expect(turnLayersForScriptMode({ text: 'שלום', transliteration: 'shalom' }, 'native').secondary).toBeNull();
    expect(turnLayersForScriptMode({ text: 'שלום', transliteration: 'shalom' }, 'both').secondary).toBe('shalom');
  });
});

describe('source-language direction (spec §13: one Arabic RTL course)', () => {
  it('derives RTL for Arabic and Hebrew instruction languages and isolates mixed segments', () => {
    expect(sourceTextDirection('ar')).toBe('rtl');
    expect(sourceTextDirection('he')).toBe('rtl');
    expect(sourceTextDirection('fr')).toBe('ltr');
    expect(sourceTextDirection(null)).toBe('ltr');
    expect(isolateSourceText('اطلب قهوة', 'ar')).toBe(`${BIDI.RLI}اطلب قهوة${BIDI.PDI}`);
    expect(isolateSourceText('Commande un café', 'fr')).toBe(`${BIDI.LRI}Commande un café${BIDI.PDI}`);
  });
});
