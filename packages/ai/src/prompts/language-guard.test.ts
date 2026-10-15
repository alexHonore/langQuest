import { describe, expect, it } from 'vitest';
import { VARIETY_IDS } from '@langquest/contracts';
import { FakeReasoner, ctxFor } from '../test-support/fakes';
import { LanguageGuard, MemoryQualityIncidentSink, detectHanVariant, detectScript } from './language-guard';
import { PROMPT_PACKS, coachingLanguageInstruction, getPromptPack, sourceLeakMarkers, varietyGuardInstruction } from './packs';

describe('prompt packs', () => {
  it('exist for all 29 varieties with exemplars, anti-substitution guards and a recovery line', () => {
    for (const v of VARIETY_IDS) {
      const p = PROMPT_PACKS[v];
      expect(p.exemplars.length).toBeGreaterThanOrEqual(5);
      expect(p.antiSubstitution.length).toBeGreaterThan(0);
      expect(p.recoveryLine.text.length).toBeGreaterThan(3);
      expect(p.guard.positive.length).toBeGreaterThan(3);
      expect(p.nativeReviewed).toBe(false);
      for (const e of p.exemplars) {
        expect(e.gloss.en).toBeTruthy();
        expect(e.gloss.fr).toBeTruthy();
      }
    }
  });
  it('encodes the explicit confusion pairs (§14.2)', () => {
    expect(getPromptPack('ary').antiSubstitution.join(' ')).toMatch(/Modern Standard Arabic/);
    expect(getPromptPack('yue').antiSubstitution.join(' ')).toMatch(/Mandarin/);
    expect(getPromptPack('ht').antiSubstitution.join(' ')).toMatch(/French/);
    expect(getPromptPack('pt-PT').antiSubstitution.join(' ')).toMatch(/Brazilian/);
    expect(getPromptPack('es-ES').antiSubstitution.join(' ')).toMatch(/Latin American/);
    expect(varietyGuardInstruction(getPromptPack('arz'), 'en')).toContain('HARD RULES');
    expect(getPromptPack('de').guard.negative.every((n) => n.varietyId !== 'other')).toBe(true); // no hard-coded English leak set
  });
  it('coaching language is always the enrollment source language, never defaulted to English', () => {
    expect(coachingLanguageInstruction('fr')).toMatch(/French \(Français, code fr\)/);
    expect(coachingLanguageInstruction('ru')).toMatch(/Russian/);
    expect(coachingLanguageInstruction('en')).toMatch(/English/);
    expect(() => coachingLanguageInstruction('xx' as never)).toThrow(/Unknown source language/);
  });
  it('exemplar glosses follow the source language (fr) and fall back to English with an explicit note', () => {
    const fr = varietyGuardInstruction(getPromptPack('ja'), 'fr');
    expect(fr).toContain('これはいくらですか？ (kore wa ikura desu ka?) — C’est combien ?');
    expect(fr).not.toContain('— How much is this?');
    expect(fr).toContain('gloss in fr');
    const ru = varietyGuardInstruction(getPromptPack('ja'), 'ru');
    expect(ru).toContain('— How much is this?');
    expect(ru).toMatch(/English for reference only — coaching stays in ru/);
    expect(varietyGuardInstruction(getPromptPack('ja'), 'en')).toContain('gloss in en');
  });
  it('derives source-leak markers for every source language from the packs', () => {
    expect(sourceLeakMarkers('fr')).toContain('bonjour');
    expect(sourceLeakMarkers('ru')).toContain('спасибо');
    expect(sourceLeakMarkers('es')).toEqual(expect.arrayContaining(['ustedes', 'vosotros']));
    expect(sourceLeakMarkers('en')).toEqual(expect.arrayContaining(['the', 'please', 'hello']));
    expect(sourceLeakMarkers('ar')).toContain('كيفك');
  });
  it('recovery lines pass their own guard', () => {
    const guard = new LanguageGuard();
    for (const v of VARIETY_IDS) expect(guard.checkHeuristic(PROMPT_PACKS[v].recoveryLine.text, v).ok, v).toBe(true);
  });
});

describe('script detection', () => {
  it('detects dominant scripts and Han variants', () => {
    expect(detectScript('صباح الخير').dominant).toBe('Arab');
    expect(detectScript('Bonjour, ça va ?').dominant).toBe('Latn');
    expect(detectScript('早晨，你今日點呀？').dominant).toBe('Han');
    expect(detectScript('おはようございます。今日は元気ですか？').dominant).toBe('Jpan');
    expect(detectScript('좋은 아침이에요').dominant).toBe('Kore');
    expect(detectScript('Привіт').dominant).toBe('Cyrl');
    expect(detectScript('שלום').dominant).toBe('Hebr');
    expect(detectScript('Καλημέρα').dominant).toBe('Grek');
    expect(detectScript('नमस्ते').dominant).toBe('Deva');
    expect(detectScript('...').dominant).toBe('none');
    expect(detectHanVariant('这个多少钱')).toBe('Hans');
    expect(detectHanVariant('這個幾多錢')).toBe('Hant');
  });
});

describe('LanguageGuard heuristics (confusion pairs)', () => {
  const guard = new LanguageGuard();
  it('MSA vs Darija', () => {
    expect(guard.checkHeuristic('صباح الخير، لاباس عليك؟ واش بغيتي قهوة؟', 'ary').ok).toBe(true);
    const msa = guard.checkHeuristic('هل تريد أن تشرب القهوة؟ ماذا تفضل؟', 'ary');
    expect(msa.ok).toBe(false);
    expect(msa.issues[0]).toMatchObject({ kind: 'wrong_variety', suspectedVariety: 'arb' });
    expect(guard.checkHeuristic('هل تريد أن تشرب القهوة؟ ماذا تفضل؟', 'arb').ok).toBe(true);
    expect(guard.checkHeuristic('إزيك؟ عايز قهوة؟ دلوقتي ولا بعدين؟', 'ary').ok).toBe(false);
    expect(guard.checkHeuristic('إزيك؟ عايز قهوة؟ دلوقتي ولا بعدين؟', 'arz').ok).toBe(true);
    expect(guard.checkHeuristic('كيفك؟ شو بدك تشرب؟ هلق ولا بعدين؟', 'ar-levant').ok).toBe(true);
    expect(guard.checkHeuristic('كيفك؟ شو بدك تشرب؟ هلق ولا بعدين؟', 'arz').ok).toBe(false);
  });
  it('Cantonese vs Mandarin (grammar words + Han variant)', () => {
    expect(guard.checkHeuristic('早晨，你今日點呀？唔該，我想要一杯咖啡。', 'yue').ok).toBe(true);
    const mandarin = guard.checkHeuristic('早上好，你今天怎么样？我想要一杯咖啡，不加糖。', 'yue');
    expect(mandarin.ok).toBe(false);
    expect(mandarin.issues.map((i) => i.kind)).toContain('wrong_han_variant');
    expect(guard.checkHeuristic('早上好，你今天怎么样？我想要一杯咖啡。', 'cmn').ok).toBe(true);
    expect(guard.checkHeuristic('你係唔係想飲咖啡呀？佢哋喺邊度？', 'cmn').ok).toBe(false);
  });
  it('French vs Haitian Creole', () => {
    expect(guard.checkHeuristic('Bonjou, kijan ou ye jodi a? Ou vle yon kafe?', 'ht').ok).toBe(true);
    const fr = guard.checkHeuristic('Bonjour, comment allez-vous aujourd’hui ? Je vous sers un café avec les croissants.', 'ht');
    expect(fr.ok).toBe(false);
    expect(fr.issues[0]?.suspectedVariety).toBe('fr');
    expect(guard.checkHeuristic('Bonjour, comment allez-vous aujourd’hui ? Je vous sers un café.', 'fr').ok).toBe(true);
  });
  it('European vs Brazilian Portuguese', () => {
    expect(guard.checkHeuristic('Olá! Estás a tomar o pequeno-almoço? O autocarro chega já.', 'pt-PT').ok).toBe(true);
    expect(guard.checkHeuristic('Oi! Você está tomando café da manhã? O ônibus tá chegando, legal.', 'pt-PT').ok).toBe(false);
    expect(guard.checkHeuristic('Oi! Você está tomando café da manhã? O ônibus tá chegando.', 'pt-BR').ok).toBe(true);
    expect(guard.checkHeuristic('Estás a tomar o pequeno-almoço? O autocarro chega já, fixe.', 'pt-BR').ok).toBe(false);
  });
  it('Castilian vs Latin American Spanish', () => {
    expect(guard.checkHeuristic('¿Vosotros queréis un zumo? Vale, el coche está fuera.', 'es-ES').ok).toBe(true);
    expect(guard.checkHeuristic('¿Ustedes quieren un jugo? El carro está afuera, ahorita vengo.', 'es-ES').ok).toBe(false);
    expect(guard.checkHeuristic('¿Ustedes quieren un jugo? El carro está afuera.', 'es-419').ok).toBe(true);
    expect(guard.checkHeuristic('¿Vosotros queréis un zumo? Vale, tío, el ordenador.', 'es-419').ok).toBe(false);
  });
  it('script mismatch and source-language leaks', () => {
    const latin = guard.checkHeuristic('sbah lkhir, labas 3lik?', 'ary');
    expect(latin.ok).toBe(false);
    expect(latin.issues[0]?.kind).toBe('wrong_script');
    expect(guard.checkHeuristic('sbah lkhir, labas 3lik?', 'ary', 'latin').ok).toBe(true);
    expect(guard.checkHeuristic('Hello, how are you? Thank you please.', 'de', 'native', { sourceLanguage: 'en' }).issues[0]?.kind).toBe('source_language_leak');
    expect(guard.checkHeuristic('', 'fr').issues[0]?.kind).toBe('empty');
  });
  it('source-language leaks are keyed by the enrollment source language, not hard-coded to English', () => {
    const french = 'Bonjour ! Je voudrais vous dire que c’est très bien pour nous aujourd’hui.';
    // French-source learner of Japanese: a French line is a source leak (and a script mismatch).
    const ja = guard.checkHeuristic(french, 'ja', 'native', { sourceLanguage: 'fr' });
    expect(ja.ok).toBe(false);
    expect(ja.issues.map((i) => i.kind)).toContain('source_language_leak');
    expect(ja.issues.find((i) => i.kind === 'source_language_leak')?.detail).toMatch(/French \(source language fr\) leak/);
    // Same line for a French-source learner of German (same script): still a leak.
    expect(guard.checkHeuristic(french, 'de', 'native', { sourceLanguage: 'fr' }).issues[0]?.kind).toBe('source_language_leak');
    // Russian-source learner of Ukrainian: Russian is already a confusable variety → reported once as wrong_variety, not twice.
    const ru = guard.checkHeuristic('Привет, спасибо, пожалуйста, как дела сегодня?', 'uk', 'native', { sourceLanguage: 'ru' });
    expect(ru.issues.map((i) => i.kind)).toEqual(['wrong_variety']);
    // English is NOT the source here, so an English line for a French-source learner of German is not a "source leak".
    expect(guard.checkHeuristic('Hello, how are you? Thank you please.', 'de', 'native', { sourceLanguage: 'fr' }).issues.map((i) => i.kind)).not.toContain('source_language_leak');
    // Source language == target language (English taught from English, Spanish from Spanish): nothing to leak.
    expect(guard.checkHeuristic('Hello, how are you? Thank you please.', 'en', 'native', { sourceLanguage: 'en' }).ok).toBe(true);
    expect(guard.checkHeuristic('¿Vosotros queréis un zumo? Vale.', 'es-ES', 'native', { sourceLanguage: 'es' }).ok).toBe(true);
    // Without a source language the heuristic has no leak set at all.
    expect(guard.checkHeuristic(french, 'de').ok).toBe(true);
  });
  it('Mandarin Han variant follows the learner’s regional choice; Cantonese always requires Traditional', () => {
    const traditionalMandarin = '這個多少錢？我們沒有時間，你們說什麼？';
    const simplifiedMandarin = '这个多少钱？我们没有时间，你们说什么？';
    // No regional choice: both scripts are Mandarin.
    expect(guard.checkHeuristic(traditionalMandarin, 'cmn').ok).toBe(true);
    expect(guard.checkHeuristic(simplifiedMandarin, 'cmn').ok).toBe(true);
    // Taiwan / Traditional chosen: Traditional passes, Simplified is a script issue — never a Cantonese suspicion.
    expect(guard.checkHeuristic(traditionalMandarin, 'cmn', 'native', { regionalPreference: 'TW', track: 'chinese-mandarin' }).ok).toBe(true);
    const simplifiedForTw = guard.checkHeuristic(simplifiedMandarin, 'cmn', 'native', { regionalPreference: 'TW', track: 'chinese-mandarin' });
    expect(simplifiedForTw.ok).toBe(false);
    expect(simplifiedForTw.issues).toEqual([{ kind: 'wrong_han_variant', detail: 'Expected Hant characters, detected Hans', suspectedVariety: null }]);
    expect(guard.checkHeuristic(traditionalMandarin, 'cmn', 'native', { regionalPreference: 'zh-TW', track: 'chinese-mandarin' }).ok).toBe(true);
    // Mainland chosen, or the Simplified-focus track: Traditional is a script issue (still not Cantonese).
    const tradForCn = guard.checkHeuristic(traditionalMandarin, 'cmn', 'native', { regionalPreference: 'CN', track: 'chinese-mandarin' });
    expect(tradForCn.issues).toEqual([{ kind: 'wrong_han_variant', detail: 'Expected Hans characters, detected Hant', suspectedVariety: null }]);
    expect(guard.checkHeuristic(traditionalMandarin, 'cmn', 'native', { track: 'chinese-simplified' }).ok).toBe(false);
    // Cantonese: Simplified characters are flagged and point at Mandarin substitution.
    const yueSimplified = guard.checkHeuristic('早上好，你今天怎么样？我想要一杯咖啡，不加糖。', 'yue');
    expect(yueSimplified.issues.find((i) => i.kind === 'wrong_han_variant')?.suspectedVariety).toBe('cmn');
    expect(guard.checkHeuristic('早晨，你今日點呀？唔該，我想要一杯咖啡。', 'yue').ok).toBe(true);
  });
});

describe('LanguageGuard with LLM verifier + incidents', () => {
  it('records incidents and lets the verifier overturn a heuristic variety verdict', async () => {
    const incidents = new MemoryQualityIncidentSink();
    const reasoner = new FakeReasoner().on('language_quality_check', { isTargetVariety: true, detectedVariety: 'ary', confidence: 0.9, reason: 'Darija with a couple of shared words' });
    const guard = new LanguageGuard({ reasoner, incidents });
    // "فين" is shared; two Egyptian markers but the verifier says Darija
    const res = await guard.check('إزيك؟ عايز قهوة؟', ctxFor('arabic-moroccan'), { task: 'character_dialogue' });
    expect(res.verifiedByLlm).toBe(true);
    expect(res.ok).toBe(true);
    expect(incidents.incidents).toHaveLength(0);
    const guard2 = new LanguageGuard({ reasoner: new FakeReasoner().on('language_quality_check', { isTargetVariety: false, detectedVariety: 'arb', confidence: 0.95, reason: 'MSA' }), incidents });
    const bad = await guard2.check('صباح الخير يا صديقي، كيف الحال؟', ctxFor('arabic-moroccan'), { task: 'character_dialogue', verifyWithLlm: true, model: 'm' });
    expect(bad.ok).toBe(false);
    expect(incidents.incidents[0]).toMatchObject({ kind: 'wrong_variety', varietyId: 'ary', task: 'character_dialogue', model: 'm' });
    expect(incidents.incidents[0]?.textFingerprint).not.toContain('صباح');
  });
  it('check() threads source language, region and track from the LanguageContext', async () => {
    const incidents = new MemoryQualityIncidentSink();
    const guard = new LanguageGuard({ incidents });
    const tw = { ...ctxFor('chinese-mandarin', 'fr'), regionalPreference: 'TW' };
    expect((await guard.check('這個多少錢？我們沒有時間。', tw, { task: 'character_dialogue' })).ok).toBe(true);
    const leak = await guard.check('Bonjour ! Je voudrais vous dire que c’est très bien pour nous.', ctxFor('japanese', 'fr'), { task: 'character_dialogue' });
    expect(leak.ok).toBe(false);
    expect(incidents.incidents.map((i) => i.kind)).toContain('source_language_leak');
    const reasoner = new FakeReasoner().on('language_quality_check', { isTargetVariety: true, detectedVariety: 'ar-levant', confidence: 0.9, reason: 'Lebanese Levantine' });
    const lb = { ...ctxFor('arabic-eastern', 'fr'), regionalPreference: 'LB' };
    await new LanguageGuard({ reasoner }).check('كيفك؟ شو بدك تشرب؟', lb, { task: 'character_dialogue', verifyWithLlm: true });
    expect(reasoner.calls[0]?.prompt.system).toContain('Lebanese (ar-LB)');
    expect(reasoner.calls[0]?.prompt.system).toContain('French (source language fr) leak');
  });
  it('keeps the heuristic verdict when the verifier fails', async () => {
    const guard = new LanguageGuard({ reasoner: new FakeReasoner() });
    const res = await guard.check('صباح الخير، لاباس عليك؟', ctxFor('arabic-moroccan'), { task: 'character_dialogue', verifyWithLlm: true });
    expect(res.ok).toBe(true);
    expect(res.verifiedByLlm).toBe(false);
  });
});
