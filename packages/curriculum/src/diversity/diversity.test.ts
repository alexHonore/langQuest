import { describe, expect, it } from 'vitest';
import { DEFAULT_DIVERSITY_THRESHOLDS, MISSION_DIVERSITY_THRESHOLDS, REPAIR_INTENT_KEYS, diversityRegenerationScopes, diversityTokens, distinctN, isQuestionText, normalizeForDiversity, scoreDialogueDiversity, tokenJaccard, type DialogueSetInput, type DiversityDialogue } from './index';

const L = (text: string, extra: Partial<DiversityDialogue['turns'][number]> = {}) => ({ speaker: 'learner' as const, text, ...extra });
const C = (text: string, extra: Partial<DiversityDialogue['turns'][number]> = {}) => ({ speaker: 'character' as const, text, ...extra });

// --- Darija (Arabic script + Arabizi) -------------------------------------------------------
const darijaGood: DialogueSetInput = {
  intents: [
    { intentKey: 'request_drink', phrasings: ['بغيت قهوة عافاك', 'عطيني واحد القهوة', 'واش ممكن نشرب أتاي؟', 'جيب ليا كاس ديال الحليب'] },
    { intentKey: 'thank', phrasings: ['شكرا بزاف', 'الله يخليك', 'بارك الله فيك'] },
    { intentKey: 'ask_price', phrasings: ['بشحال هادي؟', 'شحال خاصني نخلص؟', 'كم الثمن ديالها؟'] },
  ],
  dialogues: [
    { id: 'd0', turns: [C('سلام، شنو بغيتي؟'), L('بغيت قهوة عافاك'), C('كحلة ولا نص نص؟'), L('عاود عافاك؟', { act: 'misunderstanding', intentKey: 'ask_repeat' }), C('قهوة كحلة ولا بالحليب؟', { act: 'repair' }), L('نص نص، شكرا')] },
    { id: 'd1', turns: [L('سلام! واش كاين أتاي؟'), C('ما بقاش، سالا.', { act: 'unexpected' }), L('واخا، عطيني قهوة'), C('مرحبا.')] },
    { id: 'd2', turns: [C('مرحبا بيك'), C('شنو نجيب ليك؟'), L('بشحال الحليب؟'), C('خمسة دراهم'), L('غالي شوية...', { act: 'refusal' }), C('ربعة دراهم، صافي؟'), L('صافي، شكرا')] },
    { id: 'd3', turns: [L('سمح ليا، فين كاين الطوبيس؟'), C('شنو؟ ما فهمتكش', { act: 'misunderstanding' }), L('الطوبيس، الكار', { act: 'repair' }), C('آه، تما على اليمين')] },
  ],
};

const darijaQuiz: DialogueSetInput = {
  intents: [
    // the vocalised copy and the punctuated copy collapse into the first phrasing
    { intentKey: 'request_drink', phrasings: ['بغيت قهوة عافاك', 'بْغِيتْ قَهْوَة عافاك', 'بغيت قهوة عافاك.'] },
    { intentKey: 'thank', phrasings: ['شكرا بزاف'] },
  ],
  dialogues: Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, turns: [C('شنو بغيتي؟'), L('بغيت قهوة عافاك'), C('شحال بغيتي؟'), L('وحدة')] })),
};

// --- Japanese (no spaces) ---------------------------------------------------------------------
const japaneseGood: DialogueSetInput = {
  intents: [
    { intentKey: 'request_drink', phrasings: ['コーヒーをください', 'ホットコーヒー一つお願いします', 'アイスティーにします', '何か冷たいものありますか？'] },
    { intentKey: 'ask_repeat', phrasings: ['もう一度お願いします', 'すみません、何ですか？', 'ゆっくり言ってもらえますか'] },
  ],
  dialogues: [
    { id: 'j0', turns: [C('いらっしゃいませ！'), L('コーヒーをください'), C('サイズは？'), L('え？', { act: 'misunderstanding', intentKey: 'say_not_understood' }), C('大きさです、SかMか', { act: 'repair' }), L('Mで')] },
    { id: 'j1', turns: [L('すみません、トイレはどこですか？'), C('あちらです。'), L('ありがとう')] },
    { id: 'j2', turns: [C('今日は寒いね'), L('うん、本当に'), C('温かいお茶飲む？'), L('いや、大丈夫', { act: 'refusal' })] },
  ],
};

const japaneseQuiz: DialogueSetInput = {
  intents: [{ intentKey: 'request_drink', phrasings: ['コーヒーをください', 'コーヒーをください。', 'コーヒーを ください'] }],
  dialogues: Array.from({ length: 3 }, (_, i) => ({ id: `jq${i}`, turns: [C('何を飲みますか？'), L('コーヒーです'), C('いくつですか？'), L('一つです')] })),
};

// --- Spanish (Latin script) --------------------------------------------------------------------
const spanishGood: DialogueSetInput = {
  intents: [{ intentKey: 'request_drink', phrasings: ['¿Me pones un café, por favor?', 'Un cortado, porfa.', 'Quería un café con leche.'] }],
  dialogues: [
    { id: 's0', turns: [C('¡Buenas! ¿Qué te pongo?'), L('Un cortado, porfa.'), C('Vale.')] },
    { id: 's1', turns: [L('Perdona, ¿tienes leche de avena?'), C('No, lo siento.', { act: 'unexpected' }), L('¿Cómo? Habla más despacio, por favor.', { act: 'misunderstanding', intentKey: 'ask_slow_down' }), C('Que no tenemos, ¿te va bien de soja?', { act: 'repair' }), L('Sí, perfecto.')] },
    { id: 's2', turns: [C('¿Algo más?'), L('No, nada más. ¿Cuánto es?'), C('Dos euros.'), L('Aquí tienes.')] },
  ],
};
const spanishOneAnswer: DialogueSetInput = { intents: [{ intentKey: 'request_drink', phrasings: ['Un café, por favor.', 'un CAFÉ por favor!', 'Un café, por favor'] }], dialogues: [] };

describe('script-aware tokenisation', () => {
  it('splits spaced scripts into words and keeps Arabizi digits inside words', () => {
    expect(diversityTokens('Bghit qahwa 3afak!')).toEqual(['bghit', 'qahwa', '3afak']);
    expect(diversityTokens('¿Me pones un café, por favor?')).toEqual(['me', 'pones', 'un', 'café', 'por', 'favor']);
    expect(diversityTokens("S'il vous plaît")).toEqual(["s'il", 'vous', 'plaît']);
    expect(diversityTokens('Τι κάνεις;')).toEqual(['τι', 'κάνεις']);
  });

  it('segments CJK runs into character bigrams instead of one whitespace token per sentence', () => {
    const ja = diversityTokens('コーヒーをください');
    expect('コーヒーをください'.split(/\s+/)).toHaveLength(1); // what a whitespace tokenizer would see
    expect(ja).toEqual(['コー', 'ーヒ', 'ヒー', 'ーを', 'をく', 'くだ', 'ださ', 'さい']);
    expect(diversityTokens('我想要一杯咖啡')).toEqual(['我想', '想要', '要一', '一杯', '杯咖', '咖啡']);
    expect(diversityTokens('茶')).toEqual(['茶']);
    // mixed run: Latin brand name + kana are tokenised per run
    expect(diversityTokens('Mサイズでお願い')).toEqual(['m', 'サイ', 'イズ', 'ズで', 'でお', 'お願', '願い']);
    // fullwidth Latin folds to ASCII (NFKC)
    expect(diversityTokens('ＯＫです')).toEqual(['ok', 'です']);
    // CJK phrasings that share a frame overlap partially, not all-or-nothing
    const j = tokenJaccard(diversityTokens('コーヒーをください'), diversityTokens('お茶をください'));
    expect(j).toBeGreaterThan(0.2);
    expect(j).toBeLessThan(0.8);
  });

  it('ignores optional Arabic vowel marks and spelling variants, and Hebrew niqqud, when comparing', () => {
    expect(normalizeForDiversity('بْغِيتْ قَهْوَة')).toBe('بغيت قهوه');
    expect(diversityTokens('أنا مـــرتاح')).toEqual(diversityTokens('انا مرتاح'));
    expect(diversityTokens('שָׁלוֹם')).toEqual(diversityTokens('שלום'));
    expect(tokenJaccard(diversityTokens('بغيت قهوة عافاك'), diversityTokens('بْغِيتْ قَهْوَة عافاك'))).toBe(1);
  });

  it('computes Jaccard and distinct-n', () => {
    expect(tokenJaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(tokenJaccard([], [])).toBe(1);
    expect(tokenJaccard(['a'], [])).toBe(0);
    expect(distinctN([['a', 'b', 'a', 'b']], 2)).toEqual({ distinct: 2, total: 3, ratio: 2 / 3 });
    expect(distinctN([['a']], 2).ratio).toBeNull();
  });

  it('detects questions by script-specific punctuation', () => {
    expect(isQuestionText('واش كاين أتاي؟')).toBe(true);
    expect(isQuestionText('何ですか？')).toBe(true);
    expect(isQuestionText('Ça va ?')).toBe(true);
    expect(isQuestionText('¿Qué tal')).toBe(true);
    expect(isQuestionText('Τι κάνεις;')).toBe(true);
    expect(isQuestionText('Hola; adiós')).toBe(false);
    expect(isQuestionText('شكرا بزاف')).toBe(false);
  });
});

describe('scoreDialogueDiversity', () => {
  it('passes diverse Darija, Japanese and Spanish sets', () => {
    for (const set of [darijaGood, japaneseGood, spanishGood]) {
      const r = scoreDialogueDiversity(set);
      expect(r.reasons).toEqual([]);
      expect(r.verdict).toBe('diverse');
      expect(r.score).toBeGreaterThanOrEqual(DEFAULT_DIVERSITY_THRESHOLDS.minScore);
      expect(r.intents.every((i) => i.distinctPhrasings >= 3)).toBe(true);
      expect(r.flags.filter((f) => f.code === 'quiz_shaped_dialogue')).toEqual([]);
    }
    const d = scoreDialogueDiversity(darijaGood);
    expect(d.dialogues.filter((x) => x.hasRepair).map((x) => x.id)).toEqual(['d0', 'd3']);
    expect(new Set(d.dialogues.map((x) => x.signature)).size).toBe(4);
    // signatures come from the text: speaker + whether the turn asks something ("شنو؟ ما فهمتكش" asks)
    expect(d.dialogues[0]!.signature).toBe('C? L. C? L? C? L.');
    expect(d.dialogues[3]!.signature).toBe('L? C? L. C.');
    expect(d.dialogueOverlap).toMatchObject({ distinctDialogues: 4, nearDuplicatePairs: [] });
    expect(d.dialogueOverlap!.meanPairwiseJaccard).toBeLessThan(0.2);
  });

  it('flags a Darija question → answer drill with near-duplicate alternatives as one-correct-answer', () => {
    const r = scoreDialogueDiversity(darijaQuiz);
    expect(r.verdict).toBe('needs_regeneration');
    const drink = r.intents.find((i) => i.intentKey === 'request_drink')!;
    expect(drink).toMatchObject({ phrasings: 3, distinctPhrasings: 1, nearDuplicatePairs: [[0, 1], [0, 2]] });
    expect(r.reasons).toEqual(expect.arrayContaining(['single_phrasing:request_drink', 'single_phrasing:thank', 'uniform_turn_structure:0.25', 'no_repair_turns', 'quiz_shaped_set:1', 'repeated_dialogues:0.75', 'high_overlap_dialogues:1']));
    expect(r.flags.filter((f) => f.code === 'quiz_shaped_dialogue')).toHaveLength(4);
    expect(r.dialogues.map((x) => x.nearDuplicateOf)).toEqual([null, 'q0', 'q0', 'q0']);
    expect(r.components.quiz).toBe(0);
    expect(r.score).toBeLessThan(0.3);
    expect(diversityRegenerationScopes(r)).toEqual(['dialogues', 'intents']);
  });

  it('flags Japanese near duplicates that differ only in punctuation or spacing, and quiz-shaped dialogues', () => {
    const r = scoreDialogueDiversity(japaneseQuiz);
    expect(r.intents[0]).toMatchObject({ phrasings: 3, distinctPhrasings: 1 });
    expect(r.verdict).toBe('needs_regeneration');
    expect(r.reasons).toEqual(expect.arrayContaining(['single_phrasing:request_drink', 'no_repair_turns', 'quiz_shaped_set:1']));
  });

  it('flags a Latin one-answer intent and high overlap between alternatives', () => {
    const one = scoreDialogueDiversity(spanishOneAnswer);
    expect(one.intents[0]!.distinctPhrasings).toBe(1);
    expect(one.reasons).toContain('single_phrasing:request_drink');
    expect(one.components.structure).toBeNull();
    const overlap = scoreDialogueDiversity({ intents: [{ intentKey: 'request_drink', phrasings: ['Quiero un café con leche, por favor', 'Quiero un café solo, por favor', 'Quiero un café cortado, por favor'] }], dialogues: [] });
    expect(overlap.intents[0]!.distinctPhrasings).toBe(3);
    expect(overlap.flags.map((f) => f.code)).toContain('high_overlap_alternatives');
    expect(overlap.verdict).toBe('needs_regeneration');
    expect(overlap.reasons).toEqual(['high_overlap_alternatives:request_drink']);
    expect(diversityRegenerationScopes(overlap)).toEqual(['intents']);
    // the same overlap only warns inside a blueprint mission
    expect(scoreDialogueDiversity({ intents: [{ intentKey: 'request_drink', phrasings: ['Quiero un café con leche, por favor', 'Quiero un café solo, por favor'] }], dialogues: [] }, MISSION_DIVERSITY_THRESHOLDS).verdict).toBe('diverse');
  });

  it('sends a set back when only the weighted score is too low, regenerating the weaker side', () => {
    const strict = scoreDialogueDiversity(spanishGood, { minScore: 0.99 });
    expect(strict.verdict).toBe('needs_regeneration');
    expect(strict.reasons).toEqual([`score_below_threshold:${strict.score}`]);
    expect(diversityRegenerationScopes(strict).length).toBeGreaterThan(0);
    expect(diversityRegenerationScopes(scoreDialogueDiversity(spanishGood))).toEqual([]);
  });

  it('is deterministic and reports an empty set honestly', () => {
    expect(scoreDialogueDiversity(darijaGood)).toEqual(scoreDialogueDiversity(darijaGood));
    const empty = scoreDialogueDiversity({ intents: [], dialogues: [] });
    expect(empty).toMatchObject({ verdict: 'needs_regeneration', score: 0, reasons: ['empty_set'] });
  });

  it('uses relaxed coverage for blueprint missions but still blocks a mission without any alternative', () => {
    const some = scoreDialogueDiversity({ intents: [{ intentKey: 'greet_hello', phrasings: ['سلام'] }, { intentKey: 'request_drink', phrasings: ['بغيت قهوة عافاك', 'عطيني واحد القهوة'] }, { intentKey: 'thank', phrasings: ['شكرا'] }, { intentKey: 'ask_for_bill', phrasings: ['الحساب عافاك'] }], dialogues: [] }, MISSION_DIVERSITY_THRESHOLDS);
    expect(some.verdict).toBe('diverse');
    expect(some.flags.filter((f) => f.code === 'single_phrasing').every((f) => f.severity === 'warn')).toBe(true);
    const none = scoreDialogueDiversity({ intents: [{ intentKey: 'greet_hello', phrasings: ['سلام'] }, { intentKey: 'thank', phrasings: ['شكرا'] }], dialogues: [] }, MISSION_DIVERSITY_THRESHOLDS);
    expect(none.verdict).toBe('needs_regeneration');
    expect(none.reasons).toEqual(['low_alternative_coverage:0']);
  });

  it('counts a repair only as a sequence: a trouble turn answered by the other speaker', () => {
    expect(REPAIR_INTENT_KEYS).toEqual(expect.arrayContaining(['ask_repeat', 'say_not_understood', 'ask_slow_down', 'ask_clarification']));
    const repairOf = (turns: DiversityDialogue['turns']): boolean => scoreDialogueDiversity({ intents: [], dialogues: [{ id: 'x', turns }] }).dialogues[0]!.hasRepair;
    // a repair-intent request answered by the other speaker
    expect(repairOf([C('Bonjour'), L('Pardon ?', { intentKey: 'ask_repeat' }), C('Je disais : bonjour !')])).toBe(true);
    // a labelled misunderstanding repaired by the other speaker
    expect(repairOf([L('Un café'), C('Un thé ?', { act: 'misunderstanding' }), L('Non, un café.', { act: 'repair' })])).toBe(true);
    // lone labels, an unanswered request, a same-speaker "repair" or an echo do not count
    expect(repairOf([C('Bonjour'), L('Pardon ?', { intentKey: 'ask_repeat' })])).toBe(false);
    expect(repairOf([C('Bonjour'), L('Bonjour', { act: 'repair' })])).toBe(false);
    expect(repairOf([C('Un thé ?', { act: 'misunderstanding' }), C('Ah, un café.', { act: 'repair' })])).toBe(false);
    expect(repairOf([C('Un thé ?', { act: 'misunderstanding' }), L('Un café')])).toBe(false);
    expect(repairOf([L('Pardon ?', { intentKey: 'ask_repeat' }), C('Pardon ?')])).toBe(false);
    expect(repairOf([C('Bonjour'), L('Pardon ?')])).toBe(false);
  });

  it('does not let self-reported turn labels flip the verdict of a drill set', () => {
    const drill = (id: string, drink: string): DiversityDialogue => ({ id, turns: [C('شنو بغيتي؟'), L(`بغيت ${drink} عافاك`), C('شحال بغيتي؟'), L('وحدة')] });
    const copies: DialogueSetInput = { intents: [], dialogues: ['q0', 'q1', 'q2', 'q3'].map((id) => drill(id, 'قهوة')) };
    const base = scoreDialogueDiversity(copies);
    expect(base.verdict).toBe('needs_regeneration');
    // review repro: label turn i of dialogue i as "repair", same text
    const relabelled: DialogueSetInput = { intents: [], dialogues: copies.dialogues.map((d, i) => ({ ...d, turns: d.turns.map((t, j) => (j === i ? { ...t, act: 'repair' as const } : t)) })) };
    const r = scoreDialogueDiversity(relabelled);
    expect(r.verdict).toBe('needs_regeneration');
    expect(r.dialogues.map((d) => d.signature)).toEqual(base.dialogues.map((d) => d.signature));
    expect(r.components).toEqual(base.components);
    expect(r.reasons).toEqual(base.reasons);
    expect(r.reasons).toEqual(expect.arrayContaining(['repeated_dialogues:0.75', 'high_overlap_dialogues:1', 'uniform_turn_structure:0.25', 'no_repair_turns', 'quiz_shaped_set:1']));
    // a full misunderstanding → repair label pair on every copy: counted as repair, but the copies still block
    const paired: DialogueSetInput = { intents: [], dialogues: copies.dialogues.map((d) => ({ ...d, turns: d.turns.map((t, j) => (j === 1 ? { ...t, act: 'misunderstanding' as const } : j === 2 ? { ...t, act: 'repair' as const } : t)) })) };
    const p = scoreDialogueDiversity(paired);
    expect(p.dialogues.every((d) => d.hasRepair)).toBe(true);
    expect(p.verdict).toBe('needs_regeneration');
    expect(p.reasons).toEqual(expect.arrayContaining(['repeated_dialogues:0.75', 'high_overlap_dialogues:1', 'uniform_turn_structure:0.25']));
    // the same drill with one noun swapped per dialogue: not a near copy, but still one script and one structure
    const swapped: DialogueSetInput = { intents: [], dialogues: [drill('s0', 'قهوة'), drill('s1', 'أتاي'), drill('s2', 'الما'), drill('s3', 'العصير')].map((d) => ({ ...d, turns: d.turns.map((t, j) => (j === 1 ? { ...t, act: 'misunderstanding' as const } : j === 2 ? { ...t, act: 'repair' as const } : t)) })) };
    const s = scoreDialogueDiversity(swapped);
    expect(s.dialogueOverlap!.distinctDialogues).toBe(4);
    expect(s.verdict).toBe('needs_regeneration');
    expect(s.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^high_overlap_dialogues:/), 'uniform_turn_structure:0.25']));
    expect(diversityRegenerationScopes(s)).toEqual(['dialogues']);
  });
});
