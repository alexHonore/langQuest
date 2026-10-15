/**
 * Per-variety prompt packs (§8.4): native-style exemplars, explicit anti-substitution guards, script rules and
 * a native-reviewed recovery line. Exemplars are short, everyday and deliberately dialectal so the model has a
 * concrete register to imitate. Glosses exist in `en` and `fr` (priority source languages); other source
 * languages receive the `en` gloss plus an instruction to explain in their own language.
 *
 * REVIEW STATUS: drafted by engineering from documented dialect features; every pack must pass native review
 * (§14.2) before the "native-reviewed" label is claimed in the admin console.
 */
import { LANGUAGE_VARIETIES, VARIETY_IDS, findLanguage, getCourseTrack, getVariety, type CourseTrackId, type RegionalOption, type SourceLanguageCode, type VarietyId } from '@langquest/contracts';

/** Gloss keyed by source language; `en` is always present, `fr` is a priority gloss, others may be added per pack. */
export type ExemplarGloss = { en: string } & Partial<Record<SourceLanguageCode, string>>;

export interface PromptExemplar {
  target: string;
  transliteration: string | null;
  gloss: ExemplarGloss;
}

export interface GuardMarkerSet {
  /** Tokens/characters typical of the target variety (presence is positive evidence). */
  positive: readonly string[];
  /** Marker sets of varieties that must NOT appear (presence is negative evidence). */
  negative: ReadonlyArray<{ varietyId: VarietyId | 'other'; label: string; markers: readonly string[] }>;
}

export interface VarietyPromptPack {
  varietyId: VarietyId;
  name: string;
  styleNotes: readonly string[];
  exemplars: readonly PromptExemplar[];
  /** Explicit, model-facing statements of what must never be substituted. */
  antiSubstitution: readonly string[];
  scriptRules: string;
  /** Safe in-variety line used when generation fails the language guard twice ("sorry, say that again?"). */
  recoveryLine: { text: string; transliteration: string | null };
  guard: GuardMarkerSet;
  nativeReviewed: false;
}

const ex = (target: string, transliteration: string | null, en: string, fr: string): PromptExemplar => ({ target, transliteration, gloss: { en, fr } });

const MSA_MARKERS = ['هل', 'ماذا', 'لماذا', 'سوف', 'ليس', 'ليست', 'أين', 'كيف حالك', 'أريد', 'لا أعرف', 'حسناً', 'شكراً جزيلاً', 'إن شاء', 'هذا', 'هذه', 'الذي', 'التي', 'نحن', 'أنتم'];
const DARIJA_MARKERS = ['واش', 'كيداير', 'كيدايرة', 'لاباس', 'بزاف', 'شحال', 'بشحال', 'فين', 'دابا', 'غادي', 'بغيت', 'كاين', 'ماكاينش', 'زوين', 'ديال', 'علاش', 'كيفاش', 'شنو', 'صافي', 'وخا', 'عافاك'];
const MASRI_MARKERS = ['إزيك', 'ازيك', 'إزاي', 'ازاي', 'عامل إيه', 'عامل ايه', 'إيه', 'ايه', 'فين', 'دلوقتي', 'كده', 'كدة', 'عايز', 'عايزة', 'مش', 'ليه', 'النهارده', 'النهاردة', 'خالص', 'أوي', 'اوي', 'بتاع', 'يلا', 'ماشي'];
const SHAMI_MARKERS = ['كيفك', 'شو', 'ليش', 'وين', 'هلق', 'هلأ', 'بدي', 'بدك', 'كتير', 'منيح', 'منيحة', 'هيك', 'لسا', 'عم', 'رح', 'مو', 'شلونك', 'تكرم', 'يسلمو'];

const MANDARIN_MARKERS = ['的', '是', '不', '了', '他们', '她们', '我们', '你们', '这', '那', '在', '没有', '什么', '怎么', '很', '吗', '呢', '也', '说', '看'];
const CANTONESE_MARKERS = ['嘅', '唔', '係', '咗', '哋', '喺', '佢', '乜', '點', '點樣', '啲', '冇', '咁', '嗰', '呢', '睇', '講', '嘢', '畀', '唔該', '早晨', '而家', '好似', '仲', '先'];

const PT_BR_MARKERS = ['você', 'vocês', 'a gente', 'ônibus', 'trem', 'celular', 'legal', 'tá', 'cara', 'bonitinho', 'café da manhã', 'banheiro', 'ônibus', 'está fazendo', 'estou fazendo', 'tô', 'oi', 'beleza'];
const PT_PT_MARKERS = ['tu', 'estás', 'autocarro', 'comboio', 'telemóvel', 'fixe', 'pequeno-almoço', 'casa de banho', 'a fazer', 'está a', 'estou a', 'consigo', 'rapariga', 'miúdo', 'giro', 'gira', 'olá'];

const ES_ES_MARKERS = ['vosotros', 'vosotras', 'vale', 'coche', 'ordenador', 'móvil', 'zumo', 'patatas', 'vosotros', 'tío', 'guay', 'os ', 'tenéis', 'queréis', 'habéis', 'sois', 'podéis'];
const ES_419_MARKERS = ['ustedes', 'carro', 'computadora', 'celular', 'jugo', 'papas', 'plata', 'chévere', 'padre', 'qué onda', 'ahorita', 'manejar', 'bacán', 'che', 'vos'];

const FR_MARKERS = ['je', 'vous', 'est', 'les', 'des', 'une', 'nous', 'ils', 'elles', "c'est", 'avec', 'pour', 'dans', 'comment allez-vous', 'bonjour', 'merci beaucoup', "aujourd'hui", "s'il vous plaît", 'très'];
const HT_MARKERS = ['mwen', 'ou', 'li', 'nou', 'yo', 'se', 'nan', 'kijan', 'kòman', 'bonjou', 'mèsi', 'anpil', 'jodi a', 'tanpri', 'kote', 'konbyen', 'wi', 'non', 'sa a', 'ap', 'te', 'pa', 'genyen', 'vle', 'bezwen'];

const RU_MARKERS = ['привет', 'спасибо', 'пожалуйста', 'что', 'где', 'хорошо', 'сегодня', 'я хочу', 'есть', 'нет', 'да', 'как дела', 'это', 'очень'];
const UK_MARKERS = ['привіт', 'дякую', 'будь ласка', 'що', 'де', 'добре', 'сьогодні', 'я хочу', 'є', 'немає', 'так', 'як справи', 'це', 'дуже'];
const DA_MARKERS = ['hej', 'tak', 'hvad', 'hvor', 'jeg vil gerne', 'ikke', 'i dag', 'undskyld', 'godmorgen', 'hvordan', 'farvel'];
const SV_MARKERS = ['hej', 'tack', 'vad', 'var', 'jag vill', 'inte', 'idag', 'ursäkta', 'god morgon', 'hur', 'hej då'];

/** Extra English function words used for leak detection when the enrollment's source language is English. */
const EN_LEAK_EXTRA = ['the', 'and', 'thank', 'hello', 'i want'];

interface PackSeed {
  varietyId: VarietyId;
  styleNotes: string[];
  exemplars: PromptExemplar[];
  antiSubstitution: string[];
  scriptRules: string;
  recoveryLine: { text: string; transliteration: string | null };
  guard: GuardMarkerSet;
}

const seeds: PackSeed[] = [
  {
    varietyId: 'ary',
    styleNotes: ['Casablanca/Rabat urban Darija; natural French code-switching is normal (e.g. "normal", "déjà", "bonjour") but Arabic structure stays Darija.', 'Short sentences; use "واش" for yes/no questions, "شنو/علاش/فين/كيفاش" question words, "غادي" future, "كا-" present marker (كنشرب).'],
    exemplars: [
      ex('صباح الخير، لاباس عليك؟', 'sba7 l5ir, labas 3lik?', 'Good morning, how are you?', 'Bonjour, ça va ?'),
      ex('بشحال هاد الشي عافاك؟', 'bch7al had chi 3afak?', 'How much is this, please?', 'C’est combien, s’il te plaît ?'),
      ex('واش كاين شي طوبيس لمركز المدينة؟', 'wach kayn chi tobis l merkez lmdina?', 'Is there a bus to the city centre?', 'Y a-t-il un bus pour le centre-ville ?'),
      ex('بغيت قهوة بلا سكر، عافاك.', 'bghit qahwa bla sokkar, 3afak.', 'I’d like a coffee without sugar, please.', 'Je voudrais un café sans sucre, s’il te plaît.'),
      ex('ماعرفتش، عاود عافاك بشوية.', 'ma3reftch, 3awed 3afak bchwiya.', 'I didn’t get that, say it again slowly please.', 'Je n’ai pas compris, répète doucement s’il te plaît.'),
    ],
    antiSubstitution: ['NEVER answer in Modern Standard Arabic (Fusha): no هل / ماذا / لماذا / سوف / ليس / أريد / كيف حالك.', 'NEVER drift into Egyptian (إزيك، عايز، دلوقتي) or Levantine (كيفك، بدي، هلق) wording.', 'Darija is a full language for this learner; do not apologise for it or "correct" it toward MSA.'],
    scriptRules: 'Arabic script by default. When asked for a transliteration use Arabizi (3 = ع, 7 = ح, 9 = ق, kh = خ, gh = غ); French loanwords keep French spelling.',
    recoveryLine: { text: 'سمح ليا، ماسمعتكش مزيان. عاود عافاك؟', transliteration: 'sme7 liya, ma sme3tekch mezyan. 3awed 3afak?' },
    guard: { positive: DARIJA_MARKERS, negative: [{ varietyId: 'arb', label: 'Modern Standard Arabic', markers: MSA_MARKERS }, { varietyId: 'arz', label: 'Egyptian Arabic', markers: MASRI_MARKERS.filter((m) => !['فين', 'مش', 'ماشي', 'يلا'].includes(m)) }, { varietyId: 'ar-levant', label: 'Levantine Arabic', markers: SHAMI_MARKERS }] },
  },
  {
    varietyId: 'arz',
    styleNotes: ['Cairene colloquial; "إزيك/عامل إيه" greetings, "عايز" for want, "مش" negation, "دلوقتي" now, "ليه" why, "إيه" what, "فين" where.', 'Warm, playful register; frequent "يلا", "خالص", "أوي".'],
    exemplars: [
      ex('صباح الخير، عامل إيه النهارده؟', 'sabah el-kheir, 3amel eih en-naharda?', 'Good morning, how are you doing today?', 'Bonjour, comment ça va aujourd’hui ?'),
      ex('بكام ده لو سمحت؟', 'bikam da law sama7t?', 'How much is this, please?', 'C’est combien, s’il vous plaît ?'),
      ex('أنا عايز قهوة مظبوط.', 'ana 3ayez ahwa mazboot.', 'I want a medium-sweet coffee.', 'Je veux un café moyennement sucré.'),
      ex('المترو فين من هنا؟', 'el-metro fein min hena?', 'Where is the metro from here?', 'Où est le métro d’ici ?'),
      ex('مش فاهم، ممكن تقول تاني بالراحة؟', 'mish fahem, momken te2ool tani bel-raha?', 'I don’t understand, can you say it again slowly?', 'Je ne comprends pas, tu peux répéter doucement ?'),
    ],
    antiSubstitution: ['NEVER answer in Modern Standard Arabic: no هل / ماذا / لماذا / سوف / أريد / كيف حالك.', 'NEVER use Darija (واش، بغيت، كيداير) or Levantine (كيفك، بدي، هلق) forms.'],
    scriptRules: 'Arabic script; Latin transliteration uses Franco-Arabic conventions (3 = ع, 7 = ح, 2 = ء/ق glottal as pronounced in Cairo).',
    recoveryLine: { text: 'معلش، مش سامعك كويس. ممكن تقول تاني؟', transliteration: 'ma3lesh, mish sam3ak kwayyes. momken te2ool tani?' },
    guard: { positive: MASRI_MARKERS, negative: [{ varietyId: 'arb', label: 'Modern Standard Arabic', markers: MSA_MARKERS }, { varietyId: 'ary', label: 'Moroccan Darija', markers: DARIJA_MARKERS.filter((m) => m !== 'فين') }, { varietyId: 'ar-levant', label: 'Levantine Arabic', markers: SHAMI_MARKERS }] },
  },
  {
    varietyId: 'ar-levant',
    styleNotes: ['Spoken Levantine (Syrian baseline; Lebanese/Palestinian/Jordanian wording surfaced when the learner picked a region): "كيفك" how are you, "شو" what, "ليش" why, "وين" where, "بدي" I want, "هلق" now, "كتير" very, "منيح" good, "عم" progressive, "رح" future.'],
    exemplars: [
      ex('مرحبا، كيفك اليوم؟', 'marhaba, kifak el-yom?', 'Hi, how are you today?', 'Salut, comment vas-tu aujourd’hui ?'),
      ex('قديش هاد لو سمحت؟', 'addesh had law sama7t?', 'How much is this, please?', 'C’est combien, s’il vous plaît ?'),
      ex('بدي فنجان قهوة بلا سكر.', 'biddi finjan ahwe bala sukkar.', 'I’d like a cup of coffee without sugar.', 'Je voudrais une tasse de café sans sucre.'),
      ex('وين محطة الباص؟', 'wein mahattet el-bas?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('ما فهمت عليك، ممكن تعيد شوي شوي؟', 'ma fhemet 3aleik, mumken t3id shway shway?', 'I didn’t get you, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter doucement ?'),
    ],
    antiSubstitution: ['NEVER answer in Modern Standard Arabic (no هل / ماذا / سوف / أريد / كيف حالك).', 'NEVER use Egyptian (إزيك، عايز، دلوقتي) or Darija (واش، بغيت، كيداير) wording.'],
    scriptRules: 'Arabic script; Latin transliteration is a simple scheme (3 = ع, 7 = ح, kh = خ, gh = غ).',
    recoveryLine: { text: 'عفواً، ما سمعتك منيح. ممكن تعيد؟', transliteration: '3afwan, ma smi3tak mnih. mumken t3id?' },
    guard: { positive: SHAMI_MARKERS, negative: [{ varietyId: 'arb', label: 'Modern Standard Arabic', markers: MSA_MARKERS }, { varietyId: 'arz', label: 'Egyptian Arabic', markers: MASRI_MARKERS.filter((m) => !['فين', 'مش', 'ماشي', 'يلا'].includes(m)) }, { varietyId: 'ary', label: 'Moroccan Darija', markers: DARIJA_MARKERS.filter((m) => m !== 'فين') }] },
  },
  {
    varietyId: 'arb',
    styleNotes: ['Clear Modern Standard Arabic in a friendly spoken register (news/presentation style, not classical poetry).', 'Short declarative sentences; avoid rare vocabulary; use هل for yes/no questions.'],
    exemplars: [
      ex('صباح الخير، كيف حالك اليوم؟', 'sabah al-khayr, kayfa haluka al-yawm?', 'Good morning, how are you today?', 'Bonjour, comment allez-vous aujourd’hui ?'),
      ex('كم ثمن هذا من فضلك؟', 'kam thaman hadha min fadlik?', 'How much does this cost, please?', 'Combien coûte ceci, s’il vous plaît ?'),
      ex('أريد فنجان قهوة بدون سكر.', 'uridu finjan qahwa bidun sukkar.', 'I would like a cup of coffee without sugar.', 'Je voudrais une tasse de café sans sucre.'),
      ex('أين محطة الحافلات؟', 'ayna mahattat al-hafilat?', 'Where is the bus station?', 'Où est la gare routière ?'),
      ex('لم أفهم، هل يمكنك أن تعيد ببطء؟', 'lam afham, hal yumkinuka an tu3id bibut\'?', 'I did not understand, can you repeat slowly?', 'Je n’ai pas compris, pouvez-vous répéter lentement ?'),
    ],
    antiSubstitution: ['This course is Modern Standard Arabic: do NOT slip into Egyptian, Darija or Levantine colloquial forms.'],
    scriptRules: 'Arabic script with optional tashkeel on new words; Latin transliteration follows a simple academic scheme.',
    recoveryLine: { text: 'عذراً، لم أسمعك جيداً. هل يمكنك أن تعيد؟', transliteration: '3udhran, lam asma3ka jayyidan. hal yumkinuka an tu3id?' },
    guard: { positive: MSA_MARKERS, negative: [{ varietyId: 'arz', label: 'Egyptian Arabic', markers: MASRI_MARKERS }, { varietyId: 'ary', label: 'Moroccan Darija', markers: DARIJA_MARKERS }, { varietyId: 'ar-levant', label: 'Levantine Arabic', markers: SHAMI_MARKERS }] },
  },
  {
    varietyId: 'yue',
    styleNotes: ['Hong Kong Cantonese in Traditional characters with Cantonese-specific grammar: 嘅 (possessive), 唔 (not), 係 (is), 咗 (perfective), 哋 (plural), 喺 (at), 佢 (he/she), 乜嘢 (what), 點樣 (how), 邊度 (where).', 'Sentence-final particles (呀、啦、喎、㗎) are natural; English loanwords common.'],
    exemplars: [
      ex('早晨，你今日點呀？', 'zou2 san4, nei5 gam1 jat6 dim2 aa3?', 'Morning, how are you today?', 'Bonjour, comment ça va aujourd’hui ?'),
      ex('呢個幾多錢呀？', 'ni1 go3 gei2 do1 cin2 aa3?', 'How much is this?', 'C’est combien ?'),
      ex('唔該，我想要一杯咖啡，唔要糖。', 'm4 goi1, ngo5 soeng2 jiu3 jat1 bui1 gaa3 fe1, m4 jiu3 tong4.', 'Excuse me, I’d like a coffee, no sugar.', 'S’il vous plaît, je voudrais un café sans sucre.'),
      ex('巴士站喺邊度呀？', 'baa1 si2 zaam6 hai2 bin1 dou6 aa3?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('我唔明，可唔可以講慢啲？', 'ngo5 m4 ming4, ho2 m4 ho2 ji5 gong2 maan6 di1?', 'I don’t understand, can you speak slower?', 'Je ne comprends pas, tu peux parler plus lentement ?'),
    ],
    antiSubstitution: ['NEVER write Mandarin: no 的 / 是 / 不 / 了 / 他们 / 什么 / 怎么 / 在 / 没有 as grammar words. Use 嘅 / 係 / 唔 / 咗 / 佢哋 / 乜嘢 / 點樣 / 喺 / 冇.', 'NEVER use Simplified characters.'],
    scriptRules: 'Traditional Chinese (Hong Kong forms). Transliteration = Jyutping with tone numbers 1–6.',
    recoveryLine: { text: '唔好意思，我聽唔清楚。可唔可以再講一次？', transliteration: 'm4 hou2 ji3 si1, ngo5 teng1 m4 cing1 co2. ho2 m4 ho2 ji5 zoi3 gong2 jat1 ci3?' },
    guard: { positive: CANTONESE_MARKERS, negative: [{ varietyId: 'cmn', label: 'Mandarin', markers: MANDARIN_MARKERS }] },
  },
  {
    varietyId: 'cmn',
    styleNotes: ['Standard Mandarin (Putonghua), mainland baseline; Taiwan wording when the learner chose TW.', 'Natural spoken register with 吗/呢/吧 particles; avoid formal written 之/其/乃.'],
    exemplars: [
      ex('早上好，你今天怎么样？', 'zǎoshang hǎo, nǐ jīntiān zěnmeyàng?', 'Good morning, how are you today?', 'Bonjour, comment ça va aujourd’hui ?'),
      ex('这个多少钱？', 'zhège duōshao qián?', 'How much is this?', 'C’est combien ?'),
      ex('我想要一杯咖啡，不加糖。', 'wǒ xiǎng yào yì bēi kāfēi, bù jiā táng.', 'I’d like a coffee, no sugar.', 'Je voudrais un café, sans sucre.'),
      ex('公交车站在哪里？', 'gōngjiāochē zhàn zài nǎlǐ?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('我没听懂，可以说慢一点吗？', 'wǒ méi tīng dǒng, kěyǐ shuō màn yìdiǎn ma?', 'I didn’t catch that, can you speak slower?', 'Je n’ai pas compris, tu peux parler plus lentement ?'),
    ],
    antiSubstitution: ['NEVER write Cantonese grammar (嘅、唔、係、咗、哋、喺、乜嘢、點樣).'],
    scriptRules: 'Simplified characters by default; Traditional when the learner chose TW / Hant. Transliteration = Hanyu Pinyin with tone marks.',
    recoveryLine: { text: '不好意思，我没听清楚。可以再说一遍吗？', transliteration: 'bù hǎoyìsi, wǒ méi tīng qīngchu. kěyǐ zài shuō yí biàn ma?' },
    guard: { positive: MANDARIN_MARKERS, negative: [{ varietyId: 'yue', label: 'Cantonese', markers: CANTONESE_MARKERS }] },
  },
  {
    varietyId: 'ht',
    styleNotes: ['Haitian Creole (Kreyòl ayisyen) in the official orthography: mwen/ou/li/nou/yo pronouns, "ap" progressive, "te" past, "pa" negation, "se" copula, "nan" in/at.', 'Warm everyday register; French loanwords exist but structure and spelling are Kreyòl (e.g. "mèsi anpil", not "merci beaucoup").'],
    exemplars: [
      ex('Bonjou, kijan ou ye jodi a?', null, 'Hello, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'),
      ex('Konbyen sa a koute, tanpri?', null, 'How much does this cost, please?', 'Combien ça coûte, s’il te plaît ?'),
      ex('Mwen ta renmen yon kafe san sik.', null, 'I would like a coffee without sugar.', 'Je voudrais un café sans sucre.'),
      ex('Kote estasyon bis la ye?', null, 'Where is the bus station?', 'Où est la station de bus ?'),
      ex('Mwen pa konprann, ou ka repete dousman?', null, 'I don’t understand, can you repeat slowly?', 'Je ne comprends pas, tu peux répéter doucement ?'),
    ],
    antiSubstitution: ['NEVER answer in French. "Je / vous / est / les / comment allez-vous / s’il vous plaît" are French, not Kreyòl.', 'Do not "upgrade" Kreyòl spellings to French ones (bonjou ≠ bonjour, mèsi ≠ merci).'],
    scriptRules: 'Latin script, official Haitian orthography with diacritics (è, ò, à); no French spelling.',
    recoveryLine: { text: 'Eskize m, mwen pa t tande byen. Ou ka repete?', transliteration: null },
    guard: { positive: HT_MARKERS, negative: [{ varietyId: 'fr', label: 'French', markers: FR_MARKERS }] },
  },
  {
    varietyId: 'fr',
    styleNotes: ['Natural spoken French from France (Québec wording when the learner chose CA); use "tu" in casual scenes, "vous" in service scenes.', 'Keep sentences short; everyday vocabulary.'],
    exemplars: [
      ex('Bonjour, comment ça va aujourd’hui ?', null, 'Hello, how are you today?', 'Bonjour, comment ça va aujourd’hui ?'),
      ex('C’est combien, s’il vous plaît ?', null, 'How much is it, please?', 'C’est combien, s’il vous plaît ?'),
      ex('Je voudrais un café sans sucre.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'),
      ex('Où est l’arrêt de bus ?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('Je n’ai pas compris, vous pouvez répéter lentement ?', null, 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, vous pouvez répéter lentement ?'),
    ],
    antiSubstitution: ['NEVER answer in English; NEVER substitute Haitian Creole.'],
    scriptRules: 'Latin script with full French accents and typographic apostrophes allowed.',
    recoveryLine: { text: 'Pardon, je n’ai pas bien entendu. Tu peux répéter ?', transliteration: null },
    guard: { positive: FR_MARKERS, negative: [{ varietyId: 'ht', label: 'Haitian Creole', markers: ['mwen', 'kijan', 'bonjou', 'mèsi', 'tanpri', 'konprann'] }] },
  },
  {
    varietyId: 'pt-BR',
    styleNotes: ['Brazilian Portuguese: "você/a gente", gerund progressive (estou fazendo), Brazilian lexicon (ônibus, trem, celular, café da manhã, banheiro, legal).'],
    exemplars: [
      ex('Bom dia, como você está hoje?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'),
      ex('Quanto custa isso, por favor?', null, 'How much is this, please?', 'C’est combien, s’il vous plaît ?'),
      ex('Eu queria um café sem açúcar.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'),
      ex('Onde fica o ponto de ônibus?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('Não entendi, você pode repetir devagar?', null, 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter doucement ?'),
    ],
    antiSubstitution: ['NEVER use European Portuguese forms: no "tu estás", "autocarro", "comboio", "telemóvel", "pequeno-almoço", "estou a fazer".'],
    scriptRules: 'Latin script with Brazilian spelling (Acordo Ortográfico).',
    recoveryLine: { text: 'Desculpa, não ouvi direito. Pode repetir?', transliteration: null },
    guard: { positive: PT_BR_MARKERS, negative: [{ varietyId: 'pt-PT', label: 'European Portuguese', markers: PT_PT_MARKERS }] },
  },
  {
    varietyId: 'pt-PT',
    styleNotes: ['European Portuguese: "tu" with 2nd-person verb forms in casual scenes, "você/o senhor" in formal ones, "estar a + infinitivo" progressive, lexicon (autocarro, comboio, telemóvel, pequeno-almoço, casa de banho, fixe).'],
    exemplars: [
      ex('Bom dia, está tudo bem consigo?', null, 'Good morning, is everything fine with you?', 'Bonjour, tout va bien ?'),
      ex('Quanto custa isto, se faz favor?', null, 'How much is this, please?', 'C’est combien, s’il vous plaît ?'),
      ex('Queria um café sem açúcar.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'),
      ex('Onde é a paragem do autocarro?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('Não percebi, podes repetir devagar?', null, 'I didn’t get it, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter doucement ?'),
    ],
    antiSubstitution: ['NEVER use Brazilian forms: no "você está fazendo", "ônibus", "trem", "celular", "café da manhã", "legal", "a gente".'],
    scriptRules: 'Latin script with European spelling conventions.',
    recoveryLine: { text: 'Desculpa, não ouvi bem. Podes repetir?', transliteration: null },
    guard: { positive: PT_PT_MARKERS, negative: [{ varietyId: 'pt-BR', label: 'Brazilian Portuguese', markers: PT_BR_MARKERS }] },
  },
  {
    varietyId: 'es-ES',
    styleNotes: ['Castilian Spanish: vosotros forms, "vale", "coche", "ordenador", "móvil", "zumo", "patatas", distinción (c/z vs s) reflected in spelling only.'],
    exemplars: [
      ex('Buenos días, ¿qué tal estás hoy?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'),
      ex('¿Cuánto cuesta esto, por favor?', null, 'How much is this, please?', 'C’est combien, s’il vous plaît ?'),
      ex('Quería un café sin azúcar.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'),
      ex('¿Dónde está la parada del autobús?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('No lo he entendido, ¿puedes repetirlo despacio?', null, 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter doucement ?'),
    ],
    antiSubstitution: ['NEVER use Latin American wording: no "ustedes" for informal plural, "carro", "computadora", "celular", "jugo", "papas", "ahorita", "vos".'],
    scriptRules: 'Latin script, Spanish punctuation (¿ ¡).',
    recoveryLine: { text: 'Perdona, no te he oído bien. ¿Puedes repetir?', transliteration: null },
    guard: { positive: ES_ES_MARKERS, negative: [{ varietyId: 'es-419', label: 'Latin American Spanish', markers: ES_419_MARKERS }] },
  },
  {
    varietyId: 'es-419',
    styleNotes: ['Neutral Latin American Spanish: "ustedes" plural, "carro/computadora/celular/jugo/papas"; regional colour (MX/CO/AR/PE/CL) when the learner chose a region, otherwise pan-regional neutral.'],
    exemplars: [
      ex('Buenos días, ¿cómo estás hoy?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'),
      ex('¿Cuánto cuesta esto, por favor?', null, 'How much is this, please?', 'C’est combien, s’il vous plaît ?'),
      ex('Quiero un café sin azúcar, por favor.', null, 'I want a coffee without sugar, please.', 'Je veux un café sans sucre, s’il vous plaît.'),
      ex('¿Dónde está la parada del bus?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('No entendí, ¿puedes repetir más despacio?', null, 'I didn’t understand, can you repeat more slowly?', 'Je n’ai pas compris, tu peux répéter plus lentement ?'),
    ],
    antiSubstitution: ['NEVER use Castilian-only forms: no "vosotros/vosotras", "vale", "coche", "ordenador", "zumo", "tío".'],
    scriptRules: 'Latin script, Spanish punctuation (¿ ¡).',
    recoveryLine: { text: 'Perdón, no te escuché bien. ¿Puedes repetir?', transliteration: null },
    guard: { positive: ES_419_MARKERS, negative: [{ varietyId: 'es-ES', label: 'Castilian Spanish', markers: ES_ES_MARKERS }] },
  },
  {
    varietyId: 'uk',
    styleNotes: ['Standard Ukrainian; avoid Russian loan-grammar and Russian words.'],
    exemplars: [
      ex('Привіт, як справи сьогодні?', 'pryvit, yak spravy sohodni?', 'Hi, how are things today?', 'Salut, comment ça va aujourd’hui ?'),
      ex('Скільки це коштує?', 'skilky tse koshtuie?', 'How much does this cost?', 'Combien ça coûte ?'),
      ex('Я хочу каву без цукру, будь ласка.', 'ya khochu kavu bez tsukru, bud laska.', 'I’d like a coffee without sugar, please.', 'Je voudrais un café sans sucre, s’il vous plaît.'),
      ex('Де зупинка автобуса?', 'de zupynka avtobusa?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('Я не зрозумів, можете повторити повільніше?', 'ya ne zrozumiv, mozhete povtoryty povilnishe?', 'I didn’t understand, can you repeat slower?', 'Je n’ai pas compris, pouvez-vous répéter plus lentement ?'),
    ],
    antiSubstitution: ['NEVER answer in Russian (привет, спасибо, пожалуйста, хорошо, сегодня are Russian).'],
    scriptRules: 'Ukrainian Cyrillic (і, ї, є, ґ); transliteration per the official 2010 scheme.',
    recoveryLine: { text: 'Вибачте, я не розчув. Можете повторити?', transliteration: 'vybachte, ya ne rozchuv. mozhete povtoryty?' },
    guard: { positive: UK_MARKERS, negative: [{ varietyId: 'ru', label: 'Russian', markers: RU_MARKERS }] },
  },
  {
    varietyId: 'ru',
    styleNotes: ['Standard Russian, friendly spoken register; stress marks only as optional annotation.'],
    exemplars: [
      ex('Привет, как дела сегодня?', 'privet, kak dela segodnya?', 'Hi, how are things today?', 'Salut, comment ça va aujourd’hui ?'),
      ex('Сколько это стоит?', 'skolko eto stoit?', 'How much does this cost?', 'Combien ça coûte ?'),
      ex('Я хочу кофе без сахара, пожалуйста.', 'ya khochu kofe bez sakhara, pozhaluysta.', 'I’d like a coffee without sugar, please.', 'Je voudrais un café sans sucre, s’il vous plaît.'),
      ex('Где автобусная остановка?', 'gde avtobusnaya ostanovka?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('Я не понял, можете повторить медленнее?', 'ya ne ponyal, mozhete povtorit medlennee?', 'I didn’t understand, can you repeat slower?', 'Je n’ai pas compris, pouvez-vous répéter plus lentement ?'),
    ],
    antiSubstitution: ['NEVER answer in Ukrainian.'],
    scriptRules: 'Russian Cyrillic; ё written where helpful for learners.',
    recoveryLine: { text: 'Извините, я не расслышал. Можете повторить?', transliteration: 'izvinite, ya ne rasslyshal. mozhete povtorit?' },
    guard: { positive: RU_MARKERS, negative: [{ varietyId: 'uk', label: 'Ukrainian', markers: UK_MARKERS }] },
  },
  {
    varietyId: 'da',
    styleNotes: ['Standard Danish (Copenhagen); informal "du" in most everyday scenes.'],
    exemplars: [
      ex('Hej, hvordan går det i dag?', null, 'Hi, how is it going today?', 'Salut, comment ça va aujourd’hui ?'),
      ex('Hvad koster den her?', null, 'How much is this one?', 'Combien coûte celui-ci ?'),
      ex('Jeg vil gerne have en kaffe uden sukker.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'),
      ex('Hvor er busstoppestedet?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('Jeg forstod det ikke, kan du gentage langsomt?', null, 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, peux-tu répéter lentement ?'),
    ],
    antiSubstitution: ['NEVER answer in Swedish or Norwegian.'],
    scriptRules: 'Latin script with æ, ø, å.',
    recoveryLine: { text: 'Undskyld, jeg hørte det ikke helt. Kan du sige det igen?', transliteration: null },
    guard: { positive: DA_MARKERS, negative: [{ varietyId: 'sv', label: 'Swedish', markers: ['inte', 'ursäkta', 'jag vill', 'idag', 'hej då'] }] },
  },
  {
    varietyId: 'sv',
    styleNotes: ['Standard Swedish; "du" everywhere; pitch accent noted only in pronunciation tips.'],
    exemplars: [
      ex('Hej, hur mår du idag?', null, 'Hi, how are you today?', 'Salut, comment vas-tu aujourd’hui ?'),
      ex('Vad kostar den här?', null, 'How much is this one?', 'Combien coûte celui-ci ?'),
      ex('Jag vill ha en kaffe utan socker, tack.', null, 'I’d like a coffee without sugar, please.', 'Je voudrais un café sans sucre, s’il vous plaît.'),
      ex('Var är busshållplatsen?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'),
      ex('Jag förstod inte, kan du säga det långsammare?', null, 'I didn’t understand, can you say it slower?', 'Je n’ai pas compris, peux-tu le dire plus lentement ?'),
    ],
    antiSubstitution: ['NEVER answer in Danish or Norwegian.'],
    scriptRules: 'Latin script with å, ä, ö.',
    recoveryLine: { text: 'Förlåt, jag hörde inte riktigt. Kan du säga det igen?', transliteration: null },
    guard: { positive: SV_MARKERS, negative: [{ varietyId: 'da', label: 'Danish', markers: ['ikke', 'undskyld', 'jeg vil gerne', 'i dag', 'farvel'] }] },
  },
];

const generic = (varietyId: VarietyId, exemplars: PromptExemplar[], recovery: { text: string; transliteration: string | null }, scriptRules: string, positive: string[], notes: string[] = []): PackSeed => ({
  varietyId,
  styleNotes: [`Natural, everyday spoken ${getVariety(varietyId).name}; short sentences; friendly register.`, ...notes],
  exemplars,
  antiSubstitution: [`Answer only in ${getVariety(varietyId).name}; never switch to the learner's instruction language for the character's own lines.`],
  scriptRules,
  recoveryLine: recovery,
  guard: { positive, negative: [] },
});

seeds.push(
  generic('en', [ex('Good morning, how are you today?', null, 'Good morning, how are you today?', 'Bonjour, comment ça va aujourd’hui ?'), ex('How much is this, please?', null, 'How much is this, please?', 'C’est combien, s’il vous plaît ?'), ex('I’d like a coffee with no sugar.', null, 'I’d like a coffee with no sugar.', 'Je voudrais un café sans sucre.'), ex('Where’s the bus stop?', null, 'Where’s the bus stop?', 'Où est l’arrêt de bus ?'), ex('Sorry, I didn’t catch that — could you say it again slowly?', null, 'Sorry, I didn’t catch that — could you say it again slowly?', 'Désolé, je n’ai pas compris — tu peux répéter lentement ?')], { text: 'Sorry, I didn’t quite hear that. Could you say it again?', transliteration: null }, 'Latin script; US spelling by default, GB when chosen.', ['the', 'you', 'please', 'thanks', 'how are you', 'where', 'what', 'sorry', 'could you', 'morning']),
  generic('de', [ex('Guten Morgen, wie geht es dir heute?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('Was kostet das, bitte?', null, 'How much is this, please?', 'C’est combien, s’il vous plaît ?'), ex('Ich hätte gern einen Kaffee ohne Zucker.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'), ex('Wo ist die Bushaltestelle?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Das habe ich nicht verstanden, kannst du das langsam wiederholen?', null, 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter lentement ?')], { text: 'Entschuldigung, ich habe dich nicht richtig verstanden. Kannst du das wiederholen?', transliteration: null }, 'Latin script with ä, ö, ü, ß.', ['ich', 'nicht', 'bitte', 'danke', 'wie geht', 'wo ist', 'was', 'heute', 'gern', 'kannst du']),
  generic('el', [ex('Καλημέρα, τι κάνεις σήμερα;', 'kaliméra, ti kánis símera?', 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('Πόσο κάνει αυτό, παρακαλώ;', 'póso káni aftó, parakaló?', 'How much is this, please?', 'C’est combien, s’il vous plaît ?'), ex('Θα ήθελα έναν καφέ χωρίς ζάχαρη.', 'tha íthela énan kafé chorís záchari.', 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'), ex('Πού είναι η στάση του λεωφορείου;', 'pou íne i stási tou leoforíou?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Δεν κατάλαβα, μπορείς να το πεις πιο αργά;', 'den katálava, borís na to pis pio argá?', 'I didn’t understand, can you say it more slowly?', 'Je n’ai pas compris, tu peux le dire plus lentement ?')], { text: 'Συγγνώμη, δεν σε άκουσα καλά. Μπορείς να το ξαναπείς;', transliteration: 'signómi, den se ákousa kalá. borís na to xanapís?' }, 'Greek script (monotonic).', ['καλημέρα', 'ευχαριστώ', 'παρακαλώ', 'τι', 'πού', 'δεν', 'σήμερα', 'θέλω', 'ναι', 'όχι']),
  generic('he', [ex('בוקר טוב, מה שלומך היום?', 'boker tov, ma shlomkha hayom?', 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('כמה זה עולה, בבקשה?', 'kama ze ole, bevakasha?', 'How much does this cost, please?', 'Combien ça coûte, s’il te plaît ?'), ex('אני רוצה קפה בלי סוכר.', 'ani rotse kafe bli sukar.', 'I want a coffee without sugar.', 'Je veux un café sans sucre.'), ex('איפה תחנת האוטובוס?', 'eifo takhanat ha-otobus?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('לא הבנתי, אפשר לחזור לאט?', 'lo hevanti, efshar lakhzor le’at?', 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter lentement ?')], { text: 'סליחה, לא שמעתי טוב. אפשר לחזור?', transliteration: 'slikha, lo shamati tov. efshar lakhzor?' }, 'Hebrew script; niqqud only where pedagogically useful.', ['שלום', 'תודה', 'בבקשה', 'מה', 'איפה', 'לא', 'היום', 'אני רוצה', 'כן', 'בוקר טוב']),
  generic('hi', [ex('सुप्रभात, आज आप कैसे हैं?', 'suprabhaat, aaj aap kaise hain?', 'Good morning, how are you today?', 'Bonjour, comment allez-vous aujourd’hui ?'), ex('यह कितने का है?', 'yah kitne ka hai?', 'How much is this?', 'C’est combien ?'), ex('मुझे बिना चीनी की एक कॉफ़ी चाहिए।', 'mujhe bina cheeni ki ek coffee chaahiye.', 'I want a coffee without sugar.', 'Je veux un café sans sucre.'), ex('बस स्टॉप कहाँ है?', 'bus stop kahaan hai?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('मैं समझा नहीं, क्या आप धीरे से दोहरा सकते हैं?', 'main samjha nahin, kya aap dheere se dohra sakte hain?', 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, pouvez-vous répéter lentement ?')], { text: 'माफ़ कीजिए, मैंने ठीक से नहीं सुना। क्या आप दोहरा सकते हैं?', transliteration: 'maaf keejiye, maine theek se nahin suna. kya aap dohra sakte hain?' }, 'Devanagari; Hinglish loanwords (coffee, bus) are natural.', ['नमस्ते', 'धन्यवाद', 'कृपया', 'क्या', 'कहाँ', 'नहीं', 'आज', 'मुझे', 'हाँ', 'कैसे'], ['Urban Hinglish mixing is natural; keep the sentence frame Hindi.']),
  generic('it', [ex('Buongiorno, come stai oggi?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('Quanto costa questo, per favore?', null, 'How much is this, please?', 'C’est combien, s’il vous plaît ?'), ex('Vorrei un caffè senza zucchero.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'), ex('Dov’è la fermata dell’autobus?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Non ho capito, puoi ripetere lentamente?', null, 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter lentement ?')], { text: 'Scusa, non ho sentito bene. Puoi ripetere?', transliteration: null }, 'Latin script with accents (è, à, ù).', ['ciao', 'grazie', 'per favore', 'cosa', 'dove', 'non', 'oggi', 'vorrei', 'sì', 'come stai']),
  generic('ja', [ex('おはようございます。今日は元気ですか？', 'ohayō gozaimasu. kyō wa genki desu ka?', 'Good morning. How are you today?', 'Bonjour. Comment allez-vous aujourd’hui ?'), ex('これはいくらですか？', 'kore wa ikura desu ka?', 'How much is this?', 'C’est combien ?'), ex('砂糖なしのコーヒーをお願いします。', 'satō nashi no kōhī o onegai shimasu.', 'A coffee without sugar, please.', 'Un café sans sucre, s’il vous plaît.'), ex('バス停はどこですか？', 'basutei wa doko desu ka?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('すみません、わかりませんでした。ゆっくり言ってもらえますか？', 'sumimasen, wakarimasen deshita. yukkuri itte moraemasu ka?', 'Sorry, I didn’t understand. Could you say it slowly?', 'Désolé, je n’ai pas compris. Pouvez-vous le dire lentement ?')], { text: 'すみません、よく聞こえませんでした。もう一度お願いします。', transliteration: 'sumimasen, yoku kikoemasen deshita. mō ichido onegai shimasu.' }, 'Kana + kanji; furigana on request; rōmaji (Hepburn) for transliteration.', ['です', 'ます', 'か', 'は', 'を', 'ください', 'すみません', 'ありがとう', 'どこ', 'いくら'], ['Polite (です/ます) register by default; casual only when the scene says so.']),
  generic('ko', [ex('좋은 아침이에요, 오늘 어때요?', 'joeun achimieyo, oneul eottaeyo?', 'Good morning, how are you today?', 'Bonjour, comment ça va aujourd’hui ?'), ex('이거 얼마예요?', 'igeo eolmayeyo?', 'How much is this?', 'C’est combien ?'), ex('설탕 없는 커피 한 잔 주세요.', 'seoltang eomneun keopi han jan juseyo.', 'One coffee without sugar, please.', 'Un café sans sucre, s’il vous plaît.'), ex('버스 정류장이 어디예요?', 'beoseu jeongnyujangi eodiyeyo?', 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('잘 못 알아들었어요. 천천히 다시 말해 주세요.', 'jal mot aradeureosseoyo. cheoncheonhi dasi malhae juseyo.', 'I didn’t catch that. Please say it again slowly.', 'Je n’ai pas compris. Répétez lentement, s’il vous plaît.')], { text: '죄송해요, 잘 못 들었어요. 다시 말해 주시겠어요?', transliteration: 'joesonghaeyo, jal mot deureosseoyo. dasi malhae jusigesseoyo?' }, 'Hangul; Revised Romanization for transliteration.', ['요', '주세요', '어디', '얼마', '감사합니다', '죄송', '네', '아니요', '오늘', '저는'], ['Polite 해요체 by default.']),
  generic('ro', [ex('Bună dimineața, ce mai faci azi?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('Cât costă asta, te rog?', null, 'How much is this, please?', 'C’est combien, s’il te plaît ?'), ex('Aș vrea o cafea fără zahăr.', null, 'I’d like a coffee without sugar.', 'Je voudrais un café sans sucre.'), ex('Unde este stația de autobuz?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Nu am înțeles, poți repeta mai rar?', null, 'I didn’t understand, can you repeat more slowly?', 'Je n’ai pas compris, tu peux répéter plus lentement ?')], { text: 'Scuze, nu am auzit bine. Poți repeta?', transliteration: null }, 'Latin script with ă, â, î, ș, ț (comma-below forms).', ['bună', 'mulțumesc', 'te rog', 'ce', 'unde', 'nu', 'azi', 'aș vrea', 'da', 'cum']),
  generic('sw', [ex('Habari ya asubuhi, u hali gani leo?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('Hii ni bei gani, tafadhali?', null, 'How much is this, please?', 'C’est combien, s’il te plaît ?'), ex('Nataka kahawa bila sukari.', null, 'I want a coffee without sugar.', 'Je veux un café sans sucre.'), ex('Kituo cha basi kiko wapi?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Sijaelewa, unaweza kurudia polepole?', null, 'I didn’t understand, can you repeat slowly?', 'Je n’ai pas compris, tu peux répéter lentement ?')], { text: 'Samahani, sikusikia vizuri. Unaweza kurudia?', transliteration: null }, 'Latin script; Kenyan or Tanzanian usage per the learner’s selector.', ['habari', 'asante', 'tafadhali', 'nini', 'wapi', 'si', 'leo', 'nataka', 'ndiyo', 'hapana'], ['Kenyan Sheng/English mixing only when the learner chose KE and the scene is casual.']),
  generic('rw', [ex('Mwaramutse, amakuru yawe uyu munsi?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('Iki ni angahe, nyabuneka?', null, 'How much is this, please?', 'C’est combien, s’il te plaît ?'), ex('Nshaka ikawa idafite isukari.', null, 'I want a coffee without sugar.', 'Je veux un café sans sucre.'), ex('Aho bisi zihagarara ni hehe?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Sinumvise, washobora kubisubiramo buhoro?', null, 'I didn’t understand, could you repeat slowly?', 'Je n’ai pas compris, tu peux répéter lentement ?')], { text: 'Mbabarira, sinakumvise neza. Washobora kubisubiramo?', transliteration: null }, 'Latin script; standard Kinyarwanda orthography.', ['mwaramutse', 'murakoze', 'nyabuneka', 'iki', 'hehe', 'nta', 'uyu munsi', 'nshaka', 'yego', 'oya'], ['Native validation required before claiming quality (§9.6).']),
  generic('ln', [ex('Mbote, ozali malamu lelo?', null, 'Hello, are you well today?', 'Bonjour, tu vas bien aujourd’hui ?'), ex('Oyo ezali mbongo boni?', null, 'How much is this?', 'C’est combien ?'), ex('Nalingi kafe na sukali te.', null, 'I want a coffee without sugar.', 'Je veux un café sans sucre.'), ex('Esika bisi etelemaka ezali wapi?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Nayoki te, okoki koloba lisusu malembe?', null, 'I didn’t understand, can you say it again slowly?', 'Je n’ai pas compris, tu peux redire lentement ?')], { text: 'Limbisa ngai, nayoki malamu te. Okoki koloba lisusu?', transliteration: null }, 'Latin script; Kinshasa usage; French mixing is natural in casual speech but the frame stays Lingala.', ['mbote', 'melesi', 'nalingi', 'wapi', 'nini', 'te', 'lelo', 'malamu', 'ee', 'ozali'], ['NEVER answer in French; French loanwords only inside Lingala sentences.']),
  generic('vi', [ex('Chào buổi sáng, hôm nay bạn thế nào?', null, 'Good morning, how are you today?', 'Bonjour, comment vas-tu aujourd’hui ?'), ex('Cái này bao nhiêu tiền?', null, 'How much is this?', 'C’est combien ?'), ex('Cho tôi một cà phê không đường.', null, 'A coffee without sugar for me, please.', 'Un café sans sucre pour moi.'), ex('Trạm xe buýt ở đâu?', null, 'Where is the bus stop?', 'Où est l’arrêt de bus ?'), ex('Tôi không hiểu, bạn nói chậm lại được không?', null, 'I don’t understand, can you speak slower?', 'Je ne comprends pas, tu peux parler plus lentement ?')], { text: 'Xin lỗi, tôi nghe không rõ. Bạn nói lại được không?', transliteration: null }, 'Latin script with full Vietnamese diacritics (never stripped).', ['chào', 'cảm ơn', 'xin', 'gì', 'đâu', 'không', 'hôm nay', 'tôi', 'vâng', 'bạn'], ['Northern (Hanoi) wording by default, Southern when chosen.']),
);

export const PROMPT_PACKS: Readonly<Record<VarietyId, VarietyPromptPack>> = Object.fromEntries(
  seeds.map((s) => [s.varietyId, { ...s, name: getVariety(s.varietyId).name, nativeReviewed: false as const }]),
) as unknown as Record<VarietyId, VarietyPromptPack>;

for (const id of VARIETY_IDS) if (!PROMPT_PACKS[id]) throw new Error(`Missing prompt pack for variety ${id}`);

export const getPromptPack = (variety: VarietyId): VarietyPromptPack => PROMPT_PACKS[variety];

/**
 * Explanations, glosses and hints are ALWAYS written in the enrollment's source language — never defaulted to
 * English. An unknown code is a programming error (the enrollment carries a validated `source_language_code`),
 * so it throws instead of silently instructing English coaching.
 */
export function coachingLanguageInstruction(source: SourceLanguageCode): string {
  const lang = findLanguage(source);
  if (!lang) throw new Error(`Unknown source language code "${source}": refusing to default coaching to English`);
  const name = `${lang.englishName} (${lang.nativeName}, code ${lang.code})`;
  return `All explanations, translations, glosses, hints and corrections for the learner MUST be written in ${name}. Do not use English for coaching unless the source language is English. The character's own spoken lines stay in the target variety.`;
}

/** Gloss for an exemplar in the learner's source language, falling back to the English reference gloss. */
export const exemplarGloss = (exemplar: PromptExemplar, source: SourceLanguageCode): { text: string; inSource: boolean } => {
  const own = exemplar.gloss[source];
  return own ? { text: own, inSource: true } : { text: exemplar.gloss.en, inSource: false };
};

/** Model-facing guard block for a variety pack; exemplar glosses are written in the enrollment's source language. */
export function varietyGuardInstruction(pack: VarietyPromptPack, source: SourceLanguageCode): string {
  const glosses = pack.exemplars.map((e) => exemplarGloss(e, source));
  const fallback = glosses.some((g) => !g.inSource) && source !== 'en';
  return [
    `TARGET VARIETY: ${pack.name} (id ${pack.varietyId}).`,
    ...pack.styleNotes.map((n) => `- ${n}`),
    `SCRIPT: ${pack.scriptRules}`,
    'HARD RULES:',
    ...pack.antiSubstitution.map((a) => `- ${a}`),
    `EXEMPLARS of the expected register (gloss in ${fallback ? `English for reference only — coaching stays in ${source}` : source}):`,
    ...pack.exemplars.map((e, i) => `- ${e.target}${e.transliteration ? ` (${e.transliteration})` : ''} — ${glosses[i]?.text ?? e.gloss.en}`),
  ].join('\n');
}

const leakMarkerCache = new Map<SourceLanguageCode, readonly string[]>();

/**
 * Marker words of a source (instruction) language, used by the language guard to detect the character
 * answering in the learner's own language. Derived from the positive marker sets of every variety of that
 * language (plus a few English function words), so the guard is keyed by the enrollment's source language and
 * never hard-codes English.
 */
export function sourceLeakMarkers(source: SourceLanguageCode): readonly string[] {
  const cached = leakMarkerCache.get(source);
  if (cached) return cached;
  const set = new Set<string>();
  for (const v of LANGUAGE_VARIETIES) {
    if (v.languageCode !== source) continue;
    for (const m of PROMPT_PACKS[v.id].guard.positive) set.add(m);
  }
  if (source === 'en') for (const m of EN_LEAK_EXTRA) set.add(m);
  const markers = Object.freeze([...set]);
  leakMarkerCache.set(source, markers);
  return markers;
}

export interface ResolvedRegion {
  /** Catalog option when the preference matched one (by id or locale); null for a free-text preference. */
  option: RegionalOption | null;
  /** Sanitised human label for prompts, e.g. `Lebanese (ar-LB)` or the raw preference trimmed to 40 chars. */
  label: string;
  /** Label of the track's default regional option (the baseline when the chosen one has no special wording). */
  baseline: string | null;
}

/**
 * Resolve an enrollment's `regionalPreference` against the track's catalog options. Returns null when no
 * preference was chosen, so prompts carry nothing region-specific in that case.
 */
export function resolveRegionalPreference(track: CourseTrackId, preference: string | null | undefined): ResolvedRegion | null {
  if (!preference) return null;
  const t = getCourseTrack(track);
  const option = t.regionalOptions.find((o) => o.id === preference || (o.locale ?? '').toLowerCase() === preference.toLowerCase()) ?? null;
  const base = t.regionalOptions.find((o) => (o.locale ?? '').toLowerCase() === t.defaultLocale.toLowerCase()) ?? null;
  const label = option ? `${option.label}${option.locale ? ` (${option.locale})` : ''}` : preference.replace(/["`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return { option, label, baseline: base && base.id !== option?.id ? base.label : null };
}
