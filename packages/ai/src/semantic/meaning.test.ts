import { describe, expect, it } from 'vitest';
import { FakeReasoner, ctxFor } from '../test-support/fakes';
import { MeaningMatcher, contentTokens, normalizeForMeaning, scoreAgainstReference, scoreMeaningDeterministic, tokensMatch, type MeaningReference } from './meaning';

/** Per-variety fixtures: accepted paraphrases must match; wrong meanings must be rejected. */
const FIXTURES: Array<{ variety: Parameters<typeof scoreMeaningDeterministic>[2]; references: MeaningReference[]; accept: string[]; reject: string[] }> = [
  // A11 — beginner paraphrase in a café (Latin American Spanish)
  { variety: 'es-419', references: [{ text: 'Quiero un café, por favor.', intentId: 'order.coffee' }, { text: 'Me da un café, por favor.', intentId: 'order.coffee' }], accept: ['me da un café porfa', 'quiero un cafe por favor', 'Un café, por favor.'], reject: ['No quiero café.', 'Quiero un té, por favor.', '¿Dónde está el baño?'] },
  { variety: 'es-ES', references: [{ text: '¿Cuánto cuesta esto?', intentId: 'ask.price' }], accept: ['cuánto cuesta esto', '¿Cuánto cuesta esto, por favor?'], reject: ['¿Dónde está esto?'] },
  // A26-style Darija role-play: unscripted but equivalent wording is fine; wrong request is not
  { variety: 'ary', references: [{ text: 'بشحال هادا؟', intentId: 'ask.price' }, { text: 'شحال هاد الشي؟', intentId: 'ask.price' }], accept: ['بشحال هاد الشي عافاك', 'شحال هادا؟'], reject: ['فين الطوبيس؟', 'ماعرفتش'] },
  { variety: 'arz', references: [{ text: 'أنا عايز قهوة.', intentId: 'order.coffee' }], accept: ['عايز قهوه لو سمحت', 'انا عايز قهوة'], reject: ['أنا مش عايز قهوة.', 'عايز شاي.'] },
  { variety: 'fr', references: [{ text: 'Je voudrais un café, s’il vous plaît.', intentId: 'order.coffee' }], accept: ['je voudrais un café svp', 'Un café, s’il vous plaît.'], reject: ['Je ne veux pas de café.', 'Je voudrais un thé.'] },
  { variety: 'ht', references: [{ text: 'Mwen ta renmen yon kafe.', intentId: 'order.coffee' }], accept: ['mwen ta renmen yon kafe tanpri', 'Mwen ta renmen yon kafe, souple.'], reject: ['Mwen pa vle kafe.', 'Kote estasyon bis la?'] },
  { variety: 'yue', references: [{ text: '呢個幾多錢呀？', intentId: 'ask.price' }], accept: ['呢個幾多錢', '呢個幾錢呀'], reject: ['巴士站喺邊度呀？'] },
  { variety: 'cmn', references: [{ text: '这个多少钱？', intentId: 'ask.price' }], accept: ['这个多少钱', '这个多少钱啊？'], reject: ['公交车站在哪里？', '这个不是我的。'] },
  { variety: 'ja', references: [{ text: 'これはいくらですか？', intentId: 'ask.price' }], accept: ['これはいくらですか', 'これ、いくらですか？'], reject: ['バス停はどこですか？'] },
  { variety: 'pt-PT', references: [{ text: 'Queria um café sem açúcar.', intentId: 'order.coffee' }], accept: ['queria um café sem açucar', 'Queria um café sem açúcar, se faz favor.'], reject: ['Não queria café.', 'Queria um chá.'] },
  { variety: 'de', references: [{ text: 'Ich hätte gern einen Kaffee.', intentId: 'order.coffee' }], accept: ['ich hätte gern einen kaffee bitte', 'Ich hätte gerne einen Kaffee.'], reject: ['Ich möchte keinen Kaffee.', 'Wo ist die Bushaltestelle?'] },
  { variety: 'sw', references: [{ text: 'Nataka kahawa.', intentId: 'order.coffee' }], accept: ['nataka kahawa tafadhali'], reject: ['Sitaki kahawa.', 'Kituo cha basi kiko wapi?'] },
  { variety: 'ru', references: [{ text: 'Я хочу кофе.', intentId: 'order.coffee' }], accept: ['я хочу кофе, пожалуйста'], reject: ['Я не хочу кофе.', 'Где остановка?'] },
  { variety: 'ko', references: [{ text: '커피 한 잔 주세요.', intentId: 'order.coffee' }], accept: ['커피 한 잔 주세요', '커피 주세요.'], reject: ['커피 안 주세요.', '버스 정류장이 어디예요?'] },
  { variety: 'vi', references: [{ text: 'Cho tôi một cà phê.', intentId: 'order.coffee' }], accept: ['cho tôi một cà phê nhé'], reject: ['Tôi không uống cà phê.', 'Trạm xe buýt ở đâu?'] },
];

describe('deterministic meaning equivalence', () => {
  for (const f of FIXTURES) {
    it(`${f.variety}: accepts paraphrases, rejects wrong meanings`, () => {
      for (const u of f.accept) {
        const r = scoreMeaningDeterministic(u, f.references, f.variety);
        expect(r.matched, `${f.variety} should accept "${u}" (score ${r.score})`).toBe(true);
        expect(r.bestReference?.intentId).toBeTruthy();
      }
      for (const u of f.reject) {
        const r = scoreMeaningDeterministic(u, f.references, f.variety);
        expect(r.matched, `${f.variety} should reject "${u}" (score ${r.score})`).toBe(false);
      }
    });
  }

  it('normalises Arabic orthographic variants and caps negation mismatches', () => {
    expect(normalizeForMeaning('أَنَا عَايِز قَهْوَة', 'arz')).toBe(normalizeForMeaning('انا عايز قهوه', 'arz'));
    const neg = scoreAgainstReference('No quiero café', 'Quiero café', 'es-419');
    expect(neg.signals.negationMismatch).toBe(true);
    expect(neg.score).toBeLessThanOrEqual(0.25);
    expect(scoreAgainstReference('', 'Quiero café', 'es-419').score).toBe(0);
  });

  it('marks the uncertain band for synonym paraphrases (left to the LLM judge) instead of accepting or hard-rejecting them', () => {
    for (const [u, ref, v] of [
      ['¿Me podrías traer un cafecito?', 'Quiero un café, por favor.', 'es-419'],
      ['¿Cuánto vale esto?', '¿Cuánto cuesta esto?', 'es-ES'],
      ['Mwen vle yon kafe.', 'Mwen ta renmen yon kafe.', 'ht'],
    ] as const) {
      const r = scoreMeaningDeterministic(u, [{ text: ref }], v);
      expect(r.matched, u).toBe(false);
      expect(r.uncertain, u).toBe(true);
    }
  });

  it('strips politeness and subject pronouns, and matches Arabic clitic prefixes', () => {
    expect(contentTokens(normalizeForMeaning('Je voudrais un café, s’il vous plaît.', 'fr'), 'fr')).toEqual(['voudrais', 'un', 'café']);
    expect(contentTokens(normalizeForMeaning('عايز قهوة لو سمحت', 'arz'), 'ar')).toEqual(['عايز', 'قهوه']);
    expect(tokensMatch('بشحال', 'شحال', 'ar')).toBe(true);
    expect(tokensMatch('cafe', 'café', 'es')).toBe(true);
    expect(tokensMatch('té', 'café', 'es')).toBe(false);
  });
});

describe('MeaningMatcher (deterministic + LLM judge)', () => {
  const refs: MeaningReference[] = [{ text: 'Quiero un café, por favor.', intentId: 'order.coffee' }];
  it('short-circuits on a lexical match without calling the LLM', async () => {
    const reasoner = new FakeReasoner();
    const m = new MeaningMatcher({ reasoner });
    const r = await m.score({ utterance: 'quiero un café por favor', references: refs, language: ctxFor('spanish-latin-american', 'en') });
    expect(r).toMatchObject({ matched: true, method: 'deterministic', matchedIntentIds: ['order.coffee'] });
    expect(reasoner.calls).toHaveLength(0);
  });
  it('asks the LLM for paraphrases (A11) and accepts them', async () => {
    const reasoner = new FakeReasoner().on('meaning_assessment', { matched: true, confidence: 0.9, matchedIntentIds: ['order.coffee'], paraphrase: true, reason: 'Same request, friendlier wording.' });
    const m = new MeaningMatcher({ reasoner });
    const r = await m.score({ utterance: '¿Me podrías traer un cafecito?', references: refs, intentDescription: 'Order a coffee politely', language: ctxFor('spanish-latin-american', 'en') });
    expect(r).toMatchObject({ matched: true, method: 'llm', paraphrase: true, matchedIntentIds: ['order.coffee'] });
    expect(reasoner.calls[0]?.prompt.user).toContain('Order a coffee politely');
    expect(reasoner.calls[0]?.prompt.system).toMatch(/Accept paraphrases/);
  });
  it('does not call the LLM for negation mismatches and rejects', async () => {
    const reasoner = new FakeReasoner();
    const r = await new MeaningMatcher({ reasoner }).score({ utterance: 'No quiero café.', references: refs, language: ctxFor('spanish-latin-american', 'en') });
    expect(r.matched).toBe(false);
    expect(reasoner.calls).toHaveLength(0);
  });
  it('asks for clarification instead of judging low-confidence transcripts (§15)', async () => {
    const r = await new MeaningMatcher().score({ utterance: 'kero un kafé', references: refs, language: ctxFor('spanish-latin-american', 'en'), utteranceConfidence: 0.2 });
    expect(r.needsClarification).toBe(true);
    expect(r.matched).toBe(false);
  });
});
