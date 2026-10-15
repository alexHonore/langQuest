import { describe, expect, it } from 'vitest';
import { checkRelevance, checkToxicity, detectScript, languageSanity, normalizeText } from './text';

describe('normalizeText', () => {
  it('NFC-normalises, strips bidi/zero-width controls and collapses whitespace without touching diacritics', () => {
    const decomposed = 'été'; // été in NFD
    expect(normalizeText(decomposed)).toBe('été');
    expect(normalizeText('‫سلام‬  عليكم​')).toBe('سلام عليكم');
    expect(normalizeText('  a \t b\n c ')).toBe('a b c');
    expect(normalizeText('مَرْحَبًا')).toBe('مَرْحَبًا'); // harakat kept
    expect(normalizeText('שָׁלוֹם')).toBe('שָׁלוֹם'); // niqqud kept
  });
});

describe('detectScript / languageSanity', () => {
  it('detects the dominant script', () => {
    expect(detectScript('Hola, ¿qué tal?').dominant).toBe('Latn');
    expect(detectScript('واش كاين شي قهوة؟').dominant).toBe('Arab');
    expect(detectScript('Привет, как дела?').dominant).toBe('Cyrl');
    expect(detectScript('こんにちは、元気ですか？').dominant).toBe('Jpan');
    expect(detectScript('你好嗎').dominant).toBe('Hani');
    expect(detectScript('123 !!!').dominant).toBe('none');
  });

  it('flags wrong-script and function-word-less sentences for Latin languages', () => {
    expect(languageSanity('¿Dónde está la estación?', 'spa').ok).toBe(true);
    expect(languageSanity('Where is the station?', 'spa').ok).toBe(false);
    expect(languageSanity('Where is the station?', 'spa').reason).toBe('no_function_words');
    expect(languageSanity('¿Qué estás haciendo?', 'spa').ok).toBe(true);
    expect(languageSanity('Привет', 'spa').reason).toMatch(/script_Cyrl_expected_Latn/);
    expect(languageSanity('متى أنشئت هذه الجامعة؟', 'ara').ok).toBe(true);
    expect(languageSanity('Hello there', 'ara').ok).toBe(false);
    expect(languageSanity('Merci.', 'fra').ok).toBe(true); // short sentences are not stopword-checked
  });
});

describe('checkToxicity', () => {
  it('matches whole words diacritic-insensitively and keeps clean sentences', () => {
    expect(checkToxicity('Mierda, qué día.').toxic).toBe(true);
    expect(checkToxicity('Quisiera un café, por favor.').toxic).toBe(false);
    expect(checkToxicity('The ship sails at dawn.').toxic).toBe(false); // "ship" is not "shit"
    expect(checkToxicity('Это сука холодно').toxic).toBe(true);
    expect(checkToxicity('nothing wrong', ['wrong']).matches).toEqual(['wrong']);
  });
});

describe('checkRelevance', () => {
  it('rejects long, url, digit-heavy and markup sentences; tags corpus persona names', () => {
    expect(checkRelevance('Quisiera un café, por favor.')).toMatchObject({ relevant: true, reasons: [] });
    expect(checkRelevance('Esta frase es extremadamente larga y contiene muchísimas palabras para que el filtro la rechace sin dudar.', { maxWords: 12 }).reasons).toContain('too_long');
    expect(checkRelevance('Visita http://example.com ahora.').reasons).toContain('url_or_email');
    expect(checkRelevance('1234 5678 90').reasons).toContain('mostly_digits');
    expect(checkRelevance('Tom quiere un café.')).toMatchObject({ relevant: true, reasons: ['corpus_persona_name'] });
    expect(checkRelevance('<b>hola</b>').reasons).toContain('markup');
    expect(checkRelevance('こんにちは、元気ですか？').wordCount).toBeLessThan(8);
  });
});
