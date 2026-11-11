import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tatoebaCodeFor } from '../attach-tatoeba-examples';
import { containsPhrase, findExamples, matchKey, ownScriptOnly, pickExamples, searchable, usableAudio, type ExampleSentence } from './tatoeba-examples';

const FIXTURES = resolve(__dirname, '../fixtures/tatoeba');

const sentence = (id: string, text: string, over: Partial<ExampleSentence> = {}): ExampleSentence => ({ id, text, author: null, translations: {}, audio: null, ...over });

describe('Tatoeba examples for the app\'s phrases', () => {
  it('compares texts without punctuation, case or ellipses, keeping every script\'s letters', () => {
    expect(matchKey('¿Cómo te llamas?', 'spa')).toBe('cómo te llamas');
    expect(matchKey('Me llamo …', 'spa')).toBe('me llamo');
    expect(matchKey('はじめまして、よろしくお願いします', 'jpn')).toBe('はじめましてよろしくお願いします');
    expect(matchKey('لاباس، الحمد لله', 'ary')).toBe('لاباس الحمد لله');
  });

  it('finds a phrase as whole words (as a substring in languages written without spaces)', () => {
    expect(containsPhrase('no gracias ya comí', 'gracias', 'spa')).toBe(true);
    expect(containsPhrase('desgraciadamente', 'gracias', 'spa')).toBe(false);
    expect(containsPhrase('南駅はどこですか', '駅はどこですか', 'jpn')).toBe(true);
    expect(searchable('y', 'spa')).toBe(false);
    expect(searchable('は', 'jpn')).toBe(false);
  });

  it('keeps only sentences written in their language\'s own script (Arabizi too for Darija)', () => {
    expect(ownScriptOnly('My name is 王明.', 'eng')).toBe(false);
    expect(ownScriptOnly('My name is Tom.', 'eng')).toBe(true);
    expect(ownScriptOnly('駅はどこですか。', 'jpn')).toBe(true);
    expect(ownScriptOnly('ch7al hadi f s-sa3a شحال هادي ف الساعة', 'ary')).toBe(true);
    expect(ownScriptOnly('Где станция?', 'rus')).toBe(true);
  });

  it('uses a recording only when its own license allows redistribution', () => {
    const row = (license: string | null) => ({ sentenceId: '1', audioId: '9', username: 'u', license, attributionUrl: null });
    expect(usableAudio(row('CC BY 4.0'))).toMatchObject({ id: '9', license: 'CC BY 4.0' });
    expect(usableAudio(row('CC BY-SA 4.0'))).not.toBeNull();
    expect(usableAudio(row('CC BY-NC 4.0'))).toBeNull();
    expect(usableAudio(row('CC BY-NC-ND 3.0'))).toBeNull();
    expect(usableAudio(row(null))).toBeNull();
  });

  it('prefers examples translated into the course\'s languages, then recorded, then short; no near-duplicates', () => {
    const picked = pickExamples(
      [
        sentence('1', 'Un café, por favor, y rápido.', { translations: { en: { id: 'a', text: 'x', author: null } } }),
        sentence('2', 'Un café, por favor.', {}),
        sentence('3', 'Quiero un café, por favor.', { translations: { en: { id: 'b', text: 'x', author: null } }, audio: { id: '7', author: null, license: 'CC BY 4.0', attributionUrl: null } }),
        sentence('4', 'Quiero un café por favor', { translations: { en: { id: 'c', text: 'x', author: null } } }),
      ],
      ['en'],
      'spa',
      3,
    );
    expect(picked.map((s) => s.id)).toEqual(['3', '1', '2']);
  });

  it('maps a course variety to its Tatoeba export (the dialect\'s own export when there is one)', () => {
    expect(tatoebaCodeFor('ary')).toBe('ary');
    expect(tatoebaCodeFor('ja')).toBe('jpn');
    expect(tatoebaCodeFor('es-ES')).toBe('spa');
    expect(tatoebaCodeFor('en')).toBe('eng');
  });

  it('from the exports: the attested phrase with its translation and licensed recording, examples using a phrase, nothing toxic', async () => {
    const result = await findExamples({
      dir: FIXTURES,
      target: 'spa',
      perPhrase: 2,
      maxWords: 9,
      phrases: [
        { id: 'thanks', text: 'Muchas gracias.', sources: ['en'] },
        { id: 'coffee', text: 'un café, por favor', sources: ['en'] },
        { id: 'price', text: '¿Cuánto cuesta esto?', sources: ['en'] },
        { id: 'rude', text: 'Mierda', sources: ['en'] },
      ],
    });
    expect(result.byPhrase.thanks?.attested).toMatchObject({ id: '3002', translations: { en: { text: 'Thank you very much.' } }, audio: { id: '9002', author: 'arh', license: 'CC BY 4.0' } });
    expect(result.byPhrase.coffee?.examples.map((e) => [e.text, e.translations.en?.text])).toEqual([
      ['Quisiera un café, por favor.', 'I would like a coffee, please.'],
      ['Tom quiere un café, por favor.', 'Tom wants a coffee, please.'],
    ]);
    expect(result.byPhrase.price?.attested?.audio, 'a non-commercial recording is not used').toBeNull();
    expect(result.byPhrase.rude).toBeUndefined();
    expect(result.inputs.map((i) => i.file)).toContain('spa_sentences.tsv');
    expect(result.summary).toMatchObject({ phrases: 4, attested: 2, withExamples: 1, examples: 2, recordings: 1 });
  });
});
