/**
 * DRAFT chapter — Japanese from English (4 missions). Kana/kanji primary text, with a
 * `furigana` (all-kana reading) form and a `romaji` form. AI-authored drafts awaiting a
 * native reviewer (`nativeReviewed: false`, `reviewStatus: 'review_needed'`).
 */
import type { Register } from '@langquest/contracts';
import { defineSeedChapter, type SeedChapter, type SeedExpressionInput } from './types';

interface JaSpec {
  key: string;
  intent: string;
  slot?: string | null;
  speaker?: 'learner' | 'character';
  ja: string;
  kana: string;
  romaji: string;
  en: string;
  note?: string;
  register?: Register;
  pron?: string;
}

const ja = (s: JaSpec): SeedExpressionInput => ({
  key: s.key,
  intentKey: s.intent,
  slotId: s.slot ?? null,
  speaker: s.speaker ?? 'learner',
  targetText: s.ja,
  forms: [
    { script: 'Jpan', transliterationScheme: null, text: s.ja },
    { script: 'Jpan', transliterationScheme: 'furigana', text: s.kana },
    { script: 'Latn', transliterationScheme: 'romaji', text: s.romaji },
  ],
  meanings: { en: { meaning: s.en, contextNote: s.note ?? null, literalGloss: null } },
  register: s.register ?? 'polite',
  codeSwitchNote: null,
  pronunciationNote: s.pron ?? null,
  nativeReviewed: false,
  reviewStatus: 'review_needed',
  provenance: 'ai_draft',
});

export const JAPANESE_CHAPTER_1: SeedChapter = defineSeedChapter({
  key: 'ja_ch1_arrival_tokyo',
  chapterIndex: 1,
  courseTrackId: 'japanese',
  targetVarietyId: 'ja',
  sourceLanguages: ['en'],
  titles: { en: 'First days in Tokyo' },
  provenance: 'ai_draft',
  nativeReviewed: false,
  reviewStatus: 'review_needed',
  generatedBy: 'curriculum-seed/japanese@2026-10',
  notes: ['Polite (desu/masu) register throughout, as appropriate for strangers; casual forms are deliberately absent from chapter 1.', 'Pitch accent is not annotated; a reviewer should flag words where accent matters for intelligibility.', 'Furigana forms are full-kana readings (not ruby markup).'],
  characters: [
    { characterKey: 'ja_aoi_acquaintance', role: 'friendly local acquaintance', name: 'Aoi', personality: 'polite, gently curious, encouraging', homeRegion: 'Tokyo', regionalOption: null, voice: 'female' },
    { characterKey: 'ja_kenta_cafe', role: 'café server', name: 'Kenta', personality: 'efficient, courteous, uses set phrases', homeRegion: 'Tokyo', regionalOption: null, voice: 'male' },
    { characterKey: 'ja_sato_passerby', role: 'passer-by', name: 'Satō-san', personality: 'helpful office worker, slightly hurried', homeRegion: 'Tokyo', regionalOption: null, voice: 'female' },
    { characterKey: 'ja_tanaka_taxi', role: 'taxi driver', name: 'Tanaka-san', personality: 'formal, calm, knows the city', homeRegion: 'Tokyo', regionalOption: null, voice: 'male' },
  ],
  missions: [
    {
      key: 'ja_greet_and_introduce',
      blueprintKey: 'greet_and_introduce',
      characterKey: 'ja_aoi_acquaintance',
      titles: { en: 'Greet and introduce yourself' },
      sceneNotes: { en: 'A neighbour greets you outside the apartment building in the afternoon.' },
      expressions: [
        ja({ key: 'konnichiwa', intent: 'greet_hello', slot: 'greeting', ja: 'こんにちは', kana: 'こんにちは', romaji: 'konnichiwa', en: 'Hello / good afternoon.', note: 'Morning: "ohayou gozaimasu"; evening: "konbanwa".', register: 'neutral' }),
        ja({ key: 'ohayou', intent: 'greet_time_of_day', ja: 'おはようございます', kana: 'おはようございます', romaji: 'ohayou gozaimasu', en: 'Good morning.' }),
        ja({ key: 'ogenki_desu_ka', intent: 'ask_how_are_you', slot: 'how_are_you', ja: 'お元気ですか', kana: 'おげんきですか', romaji: 'ogenki desu ka', en: 'How are you?', note: 'Used with people you already know; not a routine opener with strangers.' }),
        ja({ key: 'genki_desu', intent: 'reply_fine', slot: 'fine', ja: '元気です', kana: 'げんきです', romaji: 'genki desu', en: 'I\'m fine.' }),
        ja({ key: 'watashi_wa_desu', intent: 'introduce_name', slot: 'my_name', ja: '私は…です', kana: 'わたしは…です', romaji: 'watashi wa … desu', en: 'I am …', note: 'More formal: "… to moushimasu".' }),
        ja({ key: 'onamae_wa', intent: 'ask_name', slot: 'your_name', ja: 'お名前は何ですか', kana: 'おなまえはなんですか', romaji: 'onamae wa nan desu ka', en: 'What is your name?' }),
        ja({ key: 'hajimemashite', intent: 'say_nice_to_meet', slot: 'nice_to_meet', ja: 'はじめまして、よろしくお願いします', kana: 'はじめまして、よろしくおねがいします', romaji: 'hajimemashite, yoroshiku onegaishimasu', en: 'Nice to meet you (lit. "first time; please treat me well").' }),
        ja({ key: 'shitsurei_shimasu', intent: 'say_goodbye', slot: 'goodbye', ja: '失礼します', kana: 'しつれいします', romaji: 'shitsurei shimasu', en: 'Goodbye (polite, when leaving).', note: '"sayounara" is rarer and sounds final.' }),
      ],
    },
    {
      key: 'ja_cafe_order_drink',
      blueprintKey: 'cafe_order_drink',
      characterKey: 'ja_kenta_cafe',
      titles: { en: 'Ordering at a café' },
      sceneNotes: { en: 'A small café; the server uses formal set phrases.' },
      expressions: [
        ja({ key: 'konnichiwa_cafe', intent: 'greet_hello', slot: 'greeting', ja: 'こんにちは', kana: 'こんにちは', romaji: 'konnichiwa', en: 'Hello.', register: 'neutral' }),
        ja({ key: 'koohii_onegaishimasu', intent: 'request_drink', slot: 'order', ja: 'コーヒーをお願いします', kana: 'コーヒーをおねがいします', romaji: 'koohii o onegaishimasu', en: 'A coffee, please.' }),
        ja({ key: 'hotto_aisu', intent: 'offer_options', slot: 'options', speaker: 'character', ja: 'ホットとアイス、どちらにしますか', kana: 'ホットとアイス、どちらにしますか', romaji: 'hotto to aisu, dochira ni shimasu ka', en: 'Hot or iced, which would you like?' }),
        ja({ key: 'hotto_de', intent: 'choose_option', slot: 'choice', ja: 'ホットでお願いします', kana: 'ホットでおねがいします', romaji: 'hotto de onegaishimasu', en: 'Hot, please.' }),
        ja({ key: 'okaikei', intent: 'ask_for_bill', slot: 'bill', ja: 'お会計をお願いします', kana: 'おかいけいをおねがいします', romaji: 'okaikei o onegaishimasu', en: 'The bill, please.' }),
        ja({ key: 'arigatou_gozaimasu', intent: 'thank', slot: 'thanks', ja: 'ありがとうございます', kana: 'ありがとうございます', romaji: 'arigatou gozaimasu', en: 'Thank you.' }),
      ],
    },
    {
      key: 'ja_ask_directions',
      blueprintKey: 'ask_directions',
      characterKey: 'ja_sato_passerby',
      titles: { en: 'Asking for directions' },
      sceneNotes: { en: 'Looking for the station near a busy crossing.' },
      expressions: [
        ja({ key: 'sumimasen', intent: 'get_attention', slot: 'excuse_me', ja: 'すみません', kana: 'すみません', romaji: 'sumimasen', en: 'Excuse me.' }),
        ja({ key: 'eki_wa_doko', intent: 'ask_where_is', slot: 'where_is', ja: '駅はどこですか', kana: 'えきはどこですか', romaji: 'eki wa doko desu ka', en: 'Where is the station?' }),
        ja({ key: 'massugu', intent: 'give_direction_straight', slot: 'straight', speaker: 'character', ja: 'まっすぐ行ってください', kana: 'まっすぐいってください', romaji: 'massugu itte kudasai', en: 'Go straight.' }),
        ja({ key: 'migi_ni', intent: 'give_direction_turn', slot: 'turn', speaker: 'character', ja: '右に曲がってください', kana: 'みぎにまがってください', romaji: 'migi ni magatte kudasai', en: 'Turn right.', note: '"hidari" = left.' }),
        ja({ key: 'tooi_desu_ka', intent: 'ask_is_it_far', slot: 'far', ja: '遠いですか', kana: 'とおいですか', romaji: 'tooi desu ka', en: 'Is it far?' }),
        ja({ key: 'chikai_desu', intent: 'say_it_is_near', slot: 'near', speaker: 'character', ja: '近いですよ。歩いて五分です', kana: 'ちかいですよ。あるいてごふんです', romaji: 'chikai desu yo. aruite gofun desu', en: 'It\'s close. Five minutes on foot.' }),
        ja({ key: 'mou_ichido', intent: 'ask_repeat', slot: 'repeat', ja: 'もう一度お願いします', kana: 'もういちどおねがいします', romaji: 'mou ichido onegaishimasu', en: 'Once more, please.' }),
        ja({ key: 'yukkuri', intent: 'ask_slow_down', slot: 'slower', ja: 'ゆっくり話してください', kana: 'ゆっくりはなしてください', romaji: 'yukkuri hanashite kudasai', en: 'Please speak slowly.' }),
        ja({ key: 'wakarimasen', intent: 'say_not_understood', ja: 'わかりません', kana: 'わかりません', romaji: 'wakarimasen', en: 'I don\'t understand.' }),
        ja({ key: 'arigatou_gozaimashita', intent: 'thank', slot: 'thanks', ja: 'ありがとうございました', kana: 'ありがとうございました', romaji: 'arigatou gozaimashita', en: 'Thank you (for what you just did).' }),
      ],
    },
    {
      key: 'ja_take_taxi',
      blueprintKey: 'take_taxi',
      characterKey: 'ja_tanaka_taxi',
      titles: { en: 'Taking a taxi' },
      sceneNotes: { en: 'Tokyo taxi; the meter is always on and doors open automatically.' },
      expressions: [
        ja({ key: 'takushii', intent: 'hail_taxi', slot: 'hail', ja: 'タクシー！', kana: 'タクシー！', romaji: 'takushii!', en: 'Taxi!', note: 'In Japan you usually raise a hand rather than call out.', register: 'neutral' }),
        ja({ key: 'dochira_made', intent: 'ask_destination', slot: 'where_to', speaker: 'character', ja: 'どちらまでですか', kana: 'どちらまでですか', romaji: 'dochira made desu ka', en: 'Where to?' }),
        ja({ key: 'toukyou_eki_made', intent: 'state_destination', slot: 'destination', ja: '東京駅までお願いします', kana: 'とうきょうえきまでおねがいします', romaji: 'toukyou eki made onegaishimasu', en: 'To Tokyo Station, please.' }),
        ja({ key: 'kuukou_made_ikura', intent: 'ask_fare', slot: 'fare', ja: '空港までいくらですか', kana: 'くうこうまでいくらですか', romaji: 'kuukou made ikura desu ka', en: 'How much is it to the airport?' }),
        ja({ key: 'koko_de_tomete', intent: 'say_stop_here', slot: 'stop', ja: 'ここで止めてください', kana: 'ここでとめてください', romaji: 'koko de tomete kudasai', en: 'Please stop here.' }),
        ja({ key: 'arigatou_taxi', intent: 'say_goodbye', slot: 'bye', ja: 'ありがとうございました', kana: 'ありがとうございました', romaji: 'arigatou gozaimashita', en: 'Thank you (goodbye).', note: 'Thanks doubles as the leave-taking here.' }),
      ],
    },
  ],
});
