import { describe, expect, it } from 'vitest';
import { ARABIC_TO_ARABIZI, ARABIZI_TO_ARABIC, arabiziToArabicHints, looksLikeArabizi, romanizeArabicDarija, stripTashkeel } from './arabizi';
import { romanizeCyrillic } from './cyrillic';
import { devanagariToIast } from './devanagari';
import { romanizeGreek } from './greek';
import { hasNiqqud, romanizeHebrew, stripNiqqud } from './hebrew';
import { containsKanji, kanaToRomaji, katakanaToHiragana } from './japanese';
import { isValidJyutpingSyllable, parseJyutpingSyllable, validateJyutping } from './jyutping';
import { decomposeHangul, hangulToRevisedRomanization } from './korean';
import { isValidPinyinSyllable, placeToneMark, toneMarksToNumbers, toneNumbersToMarks, validatePinyin } from './pinyin';
import { transliterateForTrack } from './index';

describe('Arabizi (Darija)', () => {
  it('maps the characteristic digits both ways', () => {
    expect(ARABIC_TO_ARABIZI['ع']).toBe('3');
    expect(ARABIC_TO_ARABIZI['ح']).toBe('7');
    expect(ARABIC_TO_ARABIZI['ق']).toBe('9');
    expect(ARABIZI_TO_ARABIC['3']).toEqual(['ع']);
    expect(ARABIZI_TO_ARABIC['7']).toEqual(['ح']);
    expect(ARABIZI_TO_ARABIC['9']?.[0]).toBe('ق');
  });

  it('romanises Darija best-effort and keeps French loanwords', () => {
    expect(romanizeArabicDarija('سلام')).toBe('slam');
    expect(romanizeArabicDarija('شكرا')).toBe('chkra');
    expect(romanizeArabicDarija('عافاك')).toBe('3afak');
    expect(romanizeArabicDarija('بغيت قهوة')).toBe('bghyt 9hwa');
    expect(romanizeArabicDarija('الحمد لله')).toBe('al7md llh');
    expect(romanizeArabicDarija('واخا, merci')).toBe('wakha, merci');
    expect(romanizeArabicDarija('كيف داير؟')).toBe('kyf dayr?');
  });

  it('honours harakat and shadda when present', () => {
    expect(romanizeArabicDarija('مَرحَبا')).toBe('mar7aba');
    expect(romanizeArabicDarija('شدّ')).toBe('chdd');
    expect(stripTashkeel('مَرحَبا')).toBe('مرحبا');
  });

  it('produces hints for Arabizi input', () => {
    const hints = arabiziToArabicHints('3afak');
    expect(hints.map((h) => h.token)).toEqual(['3', 'a', 'f', 'a', 'k']);
    expect(hints[0]!.candidates).toEqual(['ع']);
    expect(arabiziToArabicHints('kh').map((h) => h.token)).toEqual(['kh']);
    expect(looksLikeArabizi('3afak')).toBe(true);
    expect(looksLikeArabizi('merci')).toBe(false);
    expect(looksLikeArabizi('عافاك')).toBe(false);
  });
});

describe('Cyrillic', () => {
  it('romanises Russian (BGN/PCGN-style)', () => {
    expect(romanizeCyrillic('Привет', 'ru')).toBe('Privet');
    expect(romanizeCyrillic('щи', 'ru')).toBe('shchi');
    expect(romanizeCyrillic('Ехать', 'ru')).toBe('Yekhat\'');
    expect(romanizeCyrillic('ёлка', 'ru')).toBe('yolka');
    expect(romanizeCyrillic('объект', 'ru')).toBe('ob"yekt');
    expect(romanizeCyrillic('Москва', 'ru')).toBe('Moskva');
    expect(romanizeCyrillic('ШКОЛА', 'ru')).toBe('SHKOLA');
    expect(romanizeCyrillic('Шура', 'ru')).toBe('Shura');
    expect(romanizeCyrillic('да, ok', 'ru')).toBe('da, ok');
  });

  it('romanises Ukrainian with the national system', () => {
    expect(romanizeCyrillic('Київ', 'uk')).toBe('Kyiv');
    expect(romanizeCyrillic('Згорани', 'uk')).toBe('Zghorany');
    expect(romanizeCyrillic('Їжак', 'uk')).toBe('Yizhak');
    expect(romanizeCyrillic('Запоріжжя', 'uk')).toBe('Zaporizhzhia');
    expect(romanizeCyrillic('Юрій', 'uk')).toBe('Yurii');
    expect(romanizeCyrillic('Ґалаґан', 'uk')).toBe('Galagan');
    expect(romanizeCyrillic("Знам'янка", 'uk')).toBe('Znamianka');
    expect(romanizeCyrillic('Львів', 'uk')).toBe('Lviv');
  });
});

describe('Greek', () => {
  it('handles digraphs, voiced/voiceless υ and initial μπ/ντ', () => {
    expect(romanizeGreek('Αθήνα')).toBe('Athina');
    expect(romanizeGreek('ευχαριστώ')).toBe('efcharisto');
    expect(romanizeGreek('αυγό')).toBe('avgo');
    expect(romanizeGreek('μπύρα')).toBe('byra');
    expect(romanizeGreek('ντομάτα')).toBe('domata');
    expect(romanizeGreek('κάμπος')).toBe('kampos');
    expect(romanizeGreek('άγγελος')).toBe('angelos');
    expect(romanizeGreek('ουρανός')).toBe('ouranos');
    expect(romanizeGreek('και')).toBe('kai');
    expect(romanizeGreek('Γεια σου')).toBe('Geia sou');
    expect(romanizeGreek('ΕΛΛΑΣ')).toBe('ELLAS');
  });
});

describe('Hebrew', () => {
  it('romanises pointed text with vowels', () => {
    expect(romanizeHebrew('שָׁלוֹם')).toBe('shalom');
    expect(romanizeHebrew('תּוֹדָה')).toBe('toda');
    expect(romanizeHebrew('בֹּקֶר')).toBe('boker');
    expect(hasNiqqud('שָׁלוֹם')).toBe(true);
    expect(stripNiqqud('שָׁלוֹם')).toBe('שלום');
  });

  it('gives an honest skeleton for unpointed text', () => {
    expect(hasNiqqud('שלום')).toBe(false);
    expect(romanizeHebrew('שלום')).toBe('shlom');
    expect(romanizeHebrew('דין')).toBe('din');
    expect(romanizeHebrew('ישראל')).toBe('yshrl'); // alef is silent; vowels are not invented
    expect(romanizeHebrew("ג'ינס")).toBe('jins');
    expect(romanizeHebrew('מלך')).toBe('mlkh');
  });
});

describe('Devanagari → IAST', () => {
  it('applies strict IAST by default', () => {
    expect(devanagariToIast('नमस्ते')).toBe('namaste');
    expect(devanagariToIast('भारत')).toBe('bhārata');
    expect(devanagariToIast('कमल')).toBe('kamala');
    expect(devanagariToIast('हिन्दी')).toBe('hindī');
    expect(devanagariToIast('संस्कृत')).toBe('saṃskṛta');
    expect(devanagariToIast('क़िला')).toBe('qilā');
    expect(devanagariToIast('२०२६')).toBe('2026');
    expect(devanagariToIast('अच्छा।')).toBe('acchā.');
  });

  it('drops word-final schwa for Hindi when asked', () => {
    expect(devanagariToIast('कमल', { hindiSchwaDeletion: true })).toBe('kamal');
    expect(devanagariToIast('भारत', { hindiSchwaDeletion: true })).toBe('bhārat');
    expect(devanagariToIast('नमस्ते', { hindiSchwaDeletion: true })).toBe('namaste');
    expect(devanagariToIast('न', { hindiSchwaDeletion: true })).toBe('na');
  });
});

describe('Korean Revised Romanization', () => {
  it('decomposes syllables', () => {
    expect(decomposeHangul('한')).toEqual({ initial: 18, medial: 0, final: 4 });
    expect(decomposeHangul('a')).toBeNull();
  });

  it('romanises common words with resyllabification and sound changes', () => {
    expect(hangulToRevisedRomanization('한국어')).toBe('hangugeo');
    expect(hangulToRevisedRomanization('안녕하세요')).toBe('annyeonghaseyo');
    expect(hangulToRevisedRomanization('감사합니다')).toBe('gamsahamnida');
    expect(hangulToRevisedRomanization('서울')).toBe('seoul');
    expect(hangulToRevisedRomanization('밥이')).toBe('babi');
    expect(hangulToRevisedRomanization('국물')).toBe('gungmul');
    expect(hangulToRevisedRomanization('신라')).toBe('silla');
    expect(hangulToRevisedRomanization('설악')).toBe('seorak');
    expect(hangulToRevisedRomanization('좋다')).toBe('jota');
    expect(hangulToRevisedRomanization('각하')).toBe('gaka');
    expect(hangulToRevisedRomanization('빨리')).toBe('ppalli');
    expect(hangulToRevisedRomanization('김치, ok')).toBe('gimchi, ok');
    expect(hangulToRevisedRomanization('ㅎ')).toBe('h');
  });
});

describe('Japanese kana → rōmaji', () => {
  it('handles digraphs, sokuon, ん and long vowels', () => {
    expect(kanaToRomaji('こんにちは')).toBe('konnichiha');
    expect(kanaToRomaji('は', { particles: true })).toBe('wa');
    expect(kanaToRomaji('きょうと')).toBe('kyouto');
    expect(kanaToRomaji('がっこう')).toBe('gakkou');
    expect(kanaToRomaji('まっちゃ')).toBe('matcha');
    expect(kanaToRomaji('ざっし')).toBe('zasshi');
    expect(kanaToRomaji('しんぶん')).toBe('shinbun');
    expect(kanaToRomaji('しんぶん', { traditional: true })).toBe('shimbun');
    expect(kanaToRomaji('きんえん')).toBe("kin'en");
    expect(kanaToRomaji('ほんや')).toBe("hon'ya");
    expect(kanaToRomaji('ラーメン')).toBe('raamen');
    expect(kanaToRomaji('ラーメン', { macrons: true })).toBe('rāmen');
    expect(kanaToRomaji('パーティー', { macrons: true })).toBe('pātī');
    expect(kanaToRomaji('ふぁ')).toBe('fa');
    expect(kanaToRomaji('ヴァイオリン')).toBe('vaiorin');
  });

  it('leaves kanji untouched and reports them', () => {
    expect(containsKanji('日本')).toBe(true);
    expect(containsKanji('にほん')).toBe(false);
    expect(kanaToRomaji('日本ご')).toBe('日本go');
    expect(katakanaToHiragana('カタカナ')).toBe('かたかな');
  });
});

describe('Pinyin tones', () => {
  it('converts tone numbers to marks with correct placement', () => {
    expect(toneNumbersToMarks('ni3 hao3')).toBe('nǐ hǎo');
    expect(toneNumbersToMarks('ni3hao3')).toBe('nǐhǎo');
    expect(toneNumbersToMarks('Zhong1guo2')).toBe('Zhōngguó');
    expect(toneNumbersToMarks('lv4')).toBe('lǜ');
    expect(toneNumbersToMarks('nu:3')).toBe('nǚ');
    expect(toneNumbersToMarks('liu2')).toBe('liú');
    expect(toneNumbersToMarks('gui4')).toBe('guì');
    expect(toneNumbersToMarks('xie4xie5')).toBe('xièxie');
    expect(toneNumbersToMarks('ou1')).toBe('ōu');
    expect(toneNumbersToMarks('er2')).toBe('ér');
    expect(placeToneMark('hao', 3)).toBe('hǎo');
  });

  it('converts marks back to numbers and validates syllables', () => {
    expect(toneMarksToNumbers('nǐ hǎo')).toBe('ni3 hao3');
    expect(toneMarksToNumbers('Zhōngguó')).toBe('Zhong1guo2');
    expect(toneMarksToNumbers('ma')).toBe('ma');
    expect(isValidPinyinSyllable('zhuāng')).toBe(true);
    expect(isValidPinyinSyllable('xie4')).toBe(true);
    expect(isValidPinyinSyllable('r')).toBe(false);
    expect(isValidPinyinSyllable('xyz')).toBe(false);
    expect(isValidPinyinSyllable('bia')).toBe(true); // inventory-level check only (documented limitation)
    expect(isValidPinyinSyllable('huar2')).toBe(true);
    expect(validatePinyin('nǐ hǎo ma?')).toEqual({ valid: true, invalidSyllables: [] });
    expect(validatePinyin('nǐ hallo')).toEqual({ valid: false, invalidSyllables: ['hallo'] });
  });
});

describe('Jyutping', () => {
  it('parses and validates syllables', () => {
    expect(parseJyutpingSyllable('nei5')).toEqual({ initial: 'n', final: 'ei', tone: 5 });
    expect(parseJyutpingSyllable('gwong2')).toEqual({ initial: 'gw', final: 'ong', tone: 2 });
    expect(parseJyutpingSyllable('m4')).toEqual({ initial: '', final: 'm', tone: 4 });
    expect(parseJyutpingSyllable('ng5')).toEqual({ initial: '', final: 'ng', tone: 5 });
    expect(isValidJyutpingSyllable('zoeng1')).toBe(true);
    expect(isValidJyutpingSyllable('nei')).toBe(false);
    expect(isValidJyutpingSyllable('nei7')).toBe(false);
    expect(isValidJyutpingSyllable('ni1')).toBe(true); // 呢
    expect(isValidJyutpingSyllable('hao3')).toBe(false);
    expect(validateJyutping('nei5 hou2 maa3?')).toMatchObject({ valid: true, invalidTokens: [] });
    expect(validateJyutping('nei5 hao3').invalidTokens).toEqual(['hao3']);
  });
});

describe('transliterateForTrack', () => {
  it('labels generated output as best-effort and returns null for reading-dependent schemes', () => {
    expect(transliterateForTrack('arabic-moroccan', 'سلام')).toMatchObject({ text: 'slam', scheme: 'arabizi', quality: 'best-effort' });
    expect(transliterateForTrack('korean', '한국어')).toMatchObject({ text: 'hangugeo', scheme: 'revised-romanization' });
    expect(transliterateForTrack('hindi', 'भारत')?.text).toBe('bhārat');
    expect(transliterateForTrack('chinese-mandarin', '你好')).toBeNull();
    expect(transliterateForTrack('chinese-cantonese', '你好')).toBeNull();
    expect(transliterateForTrack('french', 'bonjour')).toBeNull();
  });
});
