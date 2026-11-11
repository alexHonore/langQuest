/**
 * Flagship DRAFT chapter — Arabic (Moroccan) / Darija, source overlays in French and English.
 *
 * Every expression is an AI-authored draft (`provenance: 'ai_draft'`, `nativeReviewed: false`,
 * `reviewStatus: 'review_needed'`). Nothing here may be published before a Moroccan native
 * reviewer signs it off (§9.8, §9.9). Arabic script + Arabizi are both first-class (§2.1 #02).
 */
import type { Register } from '@langquest/contracts';
import { defineSeedChapter, type SeedChapter, type SeedExpressionInput } from './types';

interface DarijaSpec {
  key: string;
  intent: string;
  slot?: string | null;
  speaker?: 'learner' | 'character';
  arab: string;
  arabizi: string;
  fr: string;
  en: string;
  frNote?: string;
  enNote?: string;
  register?: Register;
  codeSwitch?: string;
  pron?: string;
}

const ary = (s: DarijaSpec): SeedExpressionInput => ({
  key: s.key,
  intentKey: s.intent,
  slotId: s.slot ?? null,
  speaker: s.speaker ?? 'learner',
  targetText: s.arab,
  forms: [
    { script: 'Arab', transliterationScheme: null, text: s.arab },
    { script: 'Latn', transliterationScheme: 'arabizi', text: s.arabizi },
  ],
  meanings: {
    fr: { meaning: s.fr, contextNote: s.frNote ?? null, literalGloss: null },
    en: { meaning: s.en, contextNote: s.enNote ?? null, literalGloss: null },
  },
  register: s.register ?? 'polite',
  codeSwitchNote: s.codeSwitch ?? null,
  pronunciationNote: s.pron ?? null,
  nativeReviewed: false,
  reviewStatus: 'review_needed',
  provenance: 'ai_draft',
});

export const ARABIC_MOROCCAN_CHAPTER_1: SeedChapter = defineSeedChapter({
  key: 'ary_ch1_arrival_casablanca',
  chapterIndex: 1,
  courseTrackId: 'arabic-moroccan',
  targetVarietyId: 'ary',
  sourceLanguages: ['fr', 'en'],
  titles: { fr: 'Premiers jours à Casablanca', en: 'First days in Casablanca' },
  provenance: 'ai_draft',
  nativeReviewed: false,
  reviewStatus: 'review_needed',
  generatedBy: 'curriculum-seed/arabic-moroccan@2026-10',
  notes: [
    'Draft authored without a native reviewer: Arabic spelling of Darija is not standardised; reviewer should confirm Casablanca/Rabat forms.',
    'Gender agreement (m/f) of learner lines must be verified and a feminine variant recorded where marked.',
    'Arabizi follows common Moroccan chat conventions (3 = ع, 7 = ح, 9 = ق, kh = خ, gh = غ).',
    'French code-switching is noted where it is natural (café, taxi); it is never a substitute for the Darija form.',
    'Ice-cream mission: flavour words (chocolat, fraise, boule) are French loans in everyday Darija; reviewer should confirm the spelling of « غلاص » and whether « بول » is written or only spoken.',
  ],
  characters: [
    { characterKey: 'ary_sara_acquaintance', role: 'friendly local acquaintance', name: 'Sara', personality: 'warm, curious, patient with learners', homeRegion: 'Casablanca', regionalOption: 'casablanca', voice: 'female' },
    { characterKey: 'ary_youssef_cafe', role: 'café server', name: 'Youssef', personality: 'quick, cheerful, likes to joke', homeRegion: 'Casablanca', regionalOption: 'casablanca', voice: 'male' },
    { characterKey: 'ary_lalla_fatima_souk', role: 'market vendor', name: 'Lalla Fatima', personality: 'sharp bargainer with a soft heart', homeRegion: 'Casablanca', regionalOption: 'casablanca', voice: 'female' },
    { characterKey: 'ary_omar_passerby', role: 'passer-by', name: 'Omar', personality: 'helpful, speaks fast, slows down when asked', homeRegion: 'Casablanca', regionalOption: 'casablanca', voice: 'male' },
    { characterKey: 'ary_nadia_neighbour', role: 'neighbour', name: 'Nadia', personality: 'hospitable, chatty, insists on tea', homeRegion: 'Casablanca', regionalOption: 'casablanca', voice: 'female' },
    { characterKey: 'ary_hamid_taxi', role: 'taxi driver', name: 'Hamid', personality: 'talkative, knows every street', homeRegion: 'Casablanca', regionalOption: 'casablanca', voice: 'male' },
    { characterKey: 'ary_salma_kid', role: 'child at the ice-cream stand', name: 'Salma', personality: 'nine years old, decisive about flavours, negotiates for a second scoop', homeRegion: 'Casablanca', regionalOption: 'casablanca', ageBand: 'child', voice: 'female' },
  ],
  missions: [
    {
      key: 'ary_greet_and_introduce',
      blueprintKey: 'greet_and_introduce',
      characterKey: 'ary_sara_acquaintance',
      titles: { fr: 'Saluer et se présenter', en: 'Greet and introduce yourself' },
      sceneNotes: { fr: 'Dans la rue, le matin, vous croisez une voisine.', en: 'On the street in the morning you run into a neighbour.' },
      expressions: [
        ary({ key: 'salam', intent: 'greet_hello', slot: 'greeting', arab: 'السلام عليكم', arabizi: 'salam 3likom', fr: 'Bonjour (litt. « que la paix soit sur vous »).', en: 'Hello (lit. "peace be upon you").', frNote: 'Salutation universelle ; on répond « wa 3likom ssalam ».', enNote: 'Universal greeting; the reply is "wa 3likom ssalam".' }),
        ary({ key: 'salam_reply', intent: 'greet_hello', speaker: 'character', arab: 'وعليكم السلام', arabizi: 'wa 3likom ssalam', fr: 'Bonjour (réponse à « salam 3likom »).', en: 'Hello (reply to "salam 3likom").' }),
        ary({ key: 'labas_q', intent: 'ask_how_are_you', slot: 'how_are_you', arab: 'لاباس؟', arabizi: 'labas?', fr: 'Ça va ?', en: 'How are you?', frNote: 'Litt. « pas de mal ? » ; la même forme sert de réponse.', enNote: 'Lit. "no harm?"; the same word is also the answer.', register: 'neutral' }),
        ary({ key: 'labas_reply', intent: 'reply_fine', slot: 'fine', arab: 'لاباس، الحمد لله', arabizi: 'labas, l7amdullah', fr: 'Ça va, Dieu merci.', en: 'Fine, thank God.', frNote: '« l7amdullah » est attendu même dans un contexte non religieux.', enNote: '"l7amdullah" is expected even in non-religious contexts.', register: 'neutral' }),
        ary({ key: 'smiti', intent: 'introduce_name', slot: 'my_name', arab: 'سميتي …', arabizi: 'smiti …', fr: 'Je m\'appelle …', en: 'My name is …', register: 'neutral' }),
        ary({ key: 'chno_smitek', intent: 'ask_name', slot: 'your_name', arab: 'شنو سميتك؟', arabizi: 'chno smitek?', fr: 'Comment tu t\'appelles ?', en: 'What\'s your name?', frNote: 'Le tutoiement est la norme en darija.', enNote: 'Darija addresses almost everyone informally.', register: 'neutral' }),
        ary({ key: 'metcharfin', intent: 'say_nice_to_meet', slot: 'nice_to_meet', arab: 'متشرفين', arabizi: 'metcharfin', fr: 'Enchanté(e).', en: 'Nice to meet you.' }),
        ary({ key: 'bslama', intent: 'say_goodbye', slot: 'goodbye', arab: 'بسلامة', arabizi: 'bslama', fr: 'Au revoir.', en: 'Goodbye.', frNote: 'Litt. « avec sécurité ».', enNote: 'Lit. "with safety".', register: 'neutral' }),
      ],
    },
    {
      key: 'ary_cafe_order_drink',
      blueprintKey: 'cafe_order_drink',
      characterKey: 'ary_youssef_cafe',
      titles: { fr: 'Commander au café', en: 'Ordering at the café' },
      sceneNotes: { fr: 'Terrasse d\'un café de quartier, le serveur est pressé mais souriant.', en: 'Terrace of a neighbourhood café; the server is busy but smiling.' },
      expressions: [
        ary({ key: 'salam_short', intent: 'greet_hello', slot: 'greeting', arab: 'سلام', arabizi: 'salam', fr: 'Salut / Bonjour.', en: 'Hi / Hello.', register: 'neutral' }),
        ary({ key: 'bghit_qahwa', intent: 'request_drink', slot: 'order', arab: 'عافاك، بغيت واحد القهوة', arabizi: '3afak, bghit wa7ed l9ahwa', fr: 'S\'il vous plaît, je voudrais un café.', en: 'Please, I\'d like a coffee.', frNote: '« bghit » (litt. « j\'ai voulu ») est la forme polie courante pour commander.', enNote: '"bghit" (lit. "I wanted") is the everyday polite way to order.', codeSwitch: 'Many speakers say "un café s\'il vous plaît" in French at cafés; both are natural.', pron: 'ق is pronounced as a deep "q"; "9" in Arabizi.' }),
        ary({ key: 'k7la_wla_nessness', intent: 'offer_options', slot: 'options', speaker: 'character', arab: 'قهوة كحلة ولا نص نص؟', arabizi: '9ahwa k7la wla ness ness?', fr: 'Un café noir ou un « noss-noss » (moitié café, moitié lait) ?', en: 'Black coffee or a "ness-ness" (half coffee, half milk)?', register: 'neutral' }),
        ary({ key: 'nessness_3afak', intent: 'choose_option', slot: 'choice', arab: 'نص نص عافاك', arabizi: 'ness ness 3afak', fr: 'Un noss-noss, s\'il vous plaît.', en: 'A ness-ness, please.' }),
        ary({ key: 'ch7al_l7sab', intent: 'ask_for_bill', slot: 'bill', arab: 'شحال الحساب عافاك؟', arabizi: 'ch7al l7sab 3afak?', fr: 'L\'addition, s\'il vous plaît ? (litt. « combien, le compte ? »)', en: 'How much is the bill, please?' }),
        ary({ key: 'llah_y3tik_se77a', intent: 'thank', slot: 'thanks', arab: 'الله يعطيك الصحة', arabizi: 'llah y3tik sse77a', fr: 'Merci (litt. « que Dieu te donne la santé ») — se dit à quelqu\'un qui a travaillé pour vous.', en: 'Thank you (lit. "may God give you health") — said to someone who served you.', codeSwitch: '"merci" alone is also completely natural.' }),
        ary({ key: 'chokran', intent: 'thank', arab: 'شكرا', arabizi: 'chokran', fr: 'Merci.', en: 'Thank you.', register: 'neutral' }),
      ],
    },
    {
      key: 'ary_market_ask_price',
      blueprintKey: 'market_ask_price',
      characterKey: 'ary_lalla_fatima_souk',
      titles: { fr: 'Demander le prix au souk', en: 'Asking the price at the souk' },
      sceneNotes: { fr: 'Étal de fruits au souk ; on négocie un peu, avec le sourire.', en: 'Fruit stall at the souk; light bargaining, with a smile.' },
      expressions: [
        ary({ key: 'salam_souk', intent: 'greet_hello', slot: 'greeting', arab: 'السلام عليكم', arabizi: 'salam 3likom', fr: 'Bonjour.', en: 'Hello.' }),
        ary({ key: 'bch7al_hada', intent: 'ask_price', slot: 'how_much', arab: 'بشحال هادا؟', arabizi: 'bch7al hada?', fr: 'C\'est combien, ça ?', en: 'How much is this?', frNote: '« hadi » pour un nom féminin.', enNote: '"hadi" for a feminine noun.', register: 'neutral' }),
        ary({ key: 'b3echrin_derhem', intent: 'state_price', slot: 'price', speaker: 'character', arab: 'بعشرين درهم', arabizi: 'b 3echrin derhem', fr: 'Vingt dirhams.', en: 'Twenty dirhams.', register: 'neutral' }),
        ary({ key: 'ghali_bzzaf', intent: 'say_too_expensive', slot: 'expensive', arab: 'غالي بزاف!', arabizi: 'ghali bzzaf!', fr: 'C\'est trop cher !', en: 'That\'s too expensive!', register: 'neutral' }),
        ary({ key: 'n9es_chwiya', intent: 'offer_lower_price', slot: 'lower', arab: 'نقص شوية عافاك', arabizi: 'n9es chwiya 3afak', fr: 'Baisse un peu, s\'il te plaît.', en: 'Lower it a bit, please.' }),
        ary({ key: 'wakha_nchri', intent: 'agree_to_price', slot: 'deal', arab: 'واخا، نشري', arabizi: 'wakha, nchri', fr: 'D\'accord, je prends.', en: 'OK, I\'ll take it.', register: 'neutral', frNote: '« wakha » = d\'accord, très fréquent.', enNote: '"wakha" = OK, extremely common.' }),
        ary({ key: 'la_chokran', intent: 'decline_purchase', slot: 'no_thanks', arab: 'لا، شكرا', arabizi: 'la, chokran', fr: 'Non, merci.', en: 'No, thank you.' }),
        ary({ key: 'ghir_kantferrej', intent: 'say_just_looking', arab: 'غير كنتفرج', arabizi: 'ghir kantferrej', fr: 'Je regarde seulement.', en: 'I\'m just looking.', register: 'neutral' }),
      ],
    },
    {
      key: 'ary_ask_directions',
      blueprintKey: 'ask_directions',
      characterKey: 'ary_omar_passerby',
      titles: { fr: 'Demander son chemin', en: 'Asking for directions' },
      sceneNotes: { fr: 'Vous cherchez la gare ; le passant parle vite.', en: 'You are looking for the station; the passer-by speaks fast.' },
      expressions: [
        ary({ key: 'sme7_liya', intent: 'get_attention', slot: 'excuse_me', arab: 'سمح ليا', arabizi: 'sme7 liya', fr: 'Excusez-moi.', en: 'Excuse me.' }),
        ary({ key: 'fin_lma7atta', intent: 'ask_where_is', slot: 'where_is', arab: 'فين كاينة المحطة؟', arabizi: 'fin kayna lma7atta?', fr: 'Où est la gare ?', en: 'Where is the station?', frNote: '« kayna » s\'accorde au féminin (la gare).', enNote: '"kayna" agrees with the feminine noun (station).' }),
        ary({ key: 'sir_nichan', intent: 'give_direction_straight', slot: 'straight', speaker: 'character', arab: 'سير نيشان', arabizi: 'sir nichan', fr: 'Va tout droit.', en: 'Go straight.', register: 'neutral' }),
        ary({ key: 'dor_3la_limen', intent: 'give_direction_turn', slot: 'turn', speaker: 'character', arab: 'دور عل ليمن', arabizi: 'dor 3la limen', fr: 'Tourne à droite.', en: 'Turn right.', frNote: '« 3la liser » = à gauche.', enNote: '"3la liser" = to the left.', register: 'neutral' }),
        ary({ key: 'wach_b3ida', intent: 'ask_is_it_far', slot: 'far', arab: 'واش بعيدة؟', arabizi: 'wach b3ida?', fr: 'C\'est loin ?', en: 'Is it far?', register: 'neutral' }),
        ary({ key: '9riba_khams_d9ay9', intent: 'say_it_is_near', slot: 'near', speaker: 'character', arab: 'قريبة، خمس دقايق على رجليك', arabizi: '9riba, khams d9ay9 3la rejlik', fr: 'C\'est près, cinq minutes à pied.', en: 'It\'s close, five minutes on foot.', register: 'neutral' }),
        ary({ key: '3awed_3afak', intent: 'ask_repeat', slot: 'repeat', arab: 'عاود عافاك', arabizi: '3awed 3afak', fr: 'Répète, s\'il te plaît.', en: 'Say it again, please.' }),
        ary({ key: 'bchwiya_3afak', intent: 'ask_slow_down', slot: 'slower', arab: 'بشوية عافاك', arabizi: 'bchwiya 3afak', fr: 'Plus lentement, s\'il te plaît.', en: 'Slower, please.' }),
        ary({ key: 'ma_fhemtch', intent: 'say_not_understood', arab: 'ما فهمتش', arabizi: 'ma fhemtch', fr: 'Je n\'ai pas compris.', en: 'I didn\'t understand.', register: 'neutral' }),
        ary({ key: 'chokran_bzzaf', intent: 'thank', slot: 'thanks', arab: 'شكرا بزاف', arabizi: 'chokran bzzaf', fr: 'Merci beaucoup.', en: 'Thanks a lot.' }),
      ],
    },
    {
      key: 'ary_meet_neighbour',
      blueprintKey: 'meet_neighbour',
      characterKey: 'ary_nadia_neighbour',
      titles: { fr: 'Rencontrer une voisine', en: 'Meeting a neighbour' },
      sceneNotes: { fr: 'Dans l\'escalier de l\'immeuble ; la voisine porte des courses.', en: 'In the building stairwell; the neighbour carries shopping bags.' },
      expressions: [
        ary({ key: 'ana_ljar_jdid', intent: 'say_new_neighbour', slot: 'new_neighbour', arab: 'أنا الجار الجديد', arabizi: 'ana ljar jdid', fr: 'Je suis le nouveau voisin.', en: 'I\'m the new neighbour.', frNote: 'Au féminin : « ana ljara jdida ».', enNote: 'Feminine: "ana ljara jdida".', register: 'neutral' }),
        ary({ key: 'mer7ba_bik', intent: 'welcome_someone', slot: 'welcome', speaker: 'character', arab: 'مرحبا بيك', arabizi: 'mer7ba bik', fr: 'Bienvenue !', en: 'Welcome!', register: 'neutral' }),
        ary({ key: 'mnin_nta', intent: 'ask_where_from', slot: 'where_from_q', arab: 'منين نتا؟', arabizi: 'mnin nta?', fr: 'Tu es d\'où ? (à un homme)', en: 'Where are you from? (to a man)', frNote: 'À une femme : « mnin nti ? ».', enNote: 'To a woman: "mnin nti?".', register: 'neutral' }),
        ary({ key: 'ana_men_kanada', intent: 'say_where_from', slot: 'from', arab: 'أنا من كندا', arabizi: 'ana men kanada', fr: 'Je viens du Canada.', en: 'I\'m from Canada.', register: 'neutral' }),
        ary({ key: 'wach_kathder_fransawiya', intent: 'ask_if_speaks_language', slot: 'speak_lang', arab: 'واش كتهضر الفرنساوية؟', arabizi: 'wach kathder lfransawiya?', fr: 'Tu parles français ?', en: 'Do you speak French?', codeSwitch: 'In Casablanca many conversations switch to French mid-sentence; this question is a natural bridge, not a replacement for Darija.', register: 'neutral' }),
        ary({ key: 'chwiya', intent: 'say_speak_little', slot: 'little', arab: 'شوية', arabizi: 'chwiya', fr: 'Un peu.', en: 'A little.', register: 'neutral' }),
        ary({ key: 'ila_7tajiti', intent: 'offer_help', slot: 'offer_help', arab: 'إلى حتاجيتي شي حاجة، قول ليا', arabizi: 'ila 7tajiti chi 7aja, goul liya', fr: 'Si tu as besoin de quelque chose, dis-le-moi.', en: 'If you need anything, tell me.', register: 'neutral' }),
        ary({ key: 'chokran_llah_ykhellik', intent: 'thank', slot: 'thanks', arab: 'شكرا، الله يخليك', arabizi: 'chokran, llah ykhellik', fr: 'Merci, c\'est gentil (litt. « que Dieu te garde »).', en: 'Thanks, that\'s kind (lit. "may God keep you").' }),
      ],
    },
    {
      key: 'ary_take_taxi',
      blueprintKey: 'take_taxi',
      characterKey: 'ary_hamid_taxi',
      titles: { fr: 'Prendre un petit taxi', en: 'Taking a petit taxi' },
      sceneNotes: { fr: 'Petit taxi rouge de Casablanca ; demander le compteur est normal.', en: 'Red Casablanca petit taxi; asking for the meter is normal.' },
      expressions: [
        ary({ key: 'taxi', intent: 'hail_taxi', slot: 'hail', arab: 'الطاكسي!', arabizi: 'taxi!', fr: 'Taxi !', en: 'Taxi!', codeSwitch: '"taxi" is the everyday word (French origin).', register: 'neutral' }),
        ary({ key: 'fin_ghadi', intent: 'ask_destination', slot: 'where_to', speaker: 'character', arab: 'فين غادي؟', arabizi: 'fin ghadi?', fr: 'Tu vas où ?', en: 'Where are you going?', register: 'neutral' }),
        ary({ key: 'l_lmdina_l9dima', intent: 'state_destination', slot: 'destination', arab: 'للمدينة القديمة عافاك', arabizi: 'l lmdina l9dima 3afak', fr: 'À la vieille médina, s\'il vous plaît.', en: 'To the old medina, please.' }),
        ary({ key: 'khdem_lkontour', intent: 'ask_use_meter', slot: 'meter', arab: 'خدم الكونطور عافاك', arabizi: 'khdem lkontour 3afak', fr: 'Mettez le compteur, s\'il vous plaît.', en: 'Please use the meter.', codeSwitch: '"kontour" comes from French "compteur" and is the only word used.' }),
        ary({ key: 'bch7al_7ta_lmatar', intent: 'ask_fare', slot: 'fare', arab: 'بشحال حتى المطار؟', arabizi: 'bch7al 7ta lmatar?', fr: 'C\'est combien jusqu\'à l\'aéroport ?', en: 'How much to the airport?', register: 'neutral' }),
        ary({ key: 'w9ef_hna', intent: 'say_stop_here', slot: 'stop', arab: 'وقف هنا عافاك', arabizi: 'w9ef hna 3afak', fr: 'Arrêtez ici, s\'il vous plaît.', en: 'Stop here, please.' }),
        ary({ key: '3ndek_sserf', intent: 'ask_for_change', slot: 'change', arab: 'عندك الصرف؟', arabizi: '3ndek sserf?', fr: 'Vous avez de la monnaie ?', en: 'Do you have change?', register: 'neutral' }),
        ary({ key: 'chokran_bslama', intent: 'say_goodbye', slot: 'bye', arab: 'شكرا، بسلامة', arabizi: 'chokran, bslama', fr: 'Merci, au revoir.', en: 'Thanks, goodbye.', register: 'neutral' }),
      ],
    },
    {
      key: 'ary_buy_ice_cream',
      blueprintKey: 'buy_ice_cream',
      characterKey: 'ary_salma_kid',
      // Cast the roster's schoolgirl (owner decision: a kid asks for the ice cream).
      rosterCharacterId: 'ary-schoolgirl-salma',
      titles: { fr: 'Une glace avec Salma', en: 'An ice cream with Salma' },
      sceneNotes: { fr: 'Devant le marchand de glaces, à la sortie de l\'école ; Salma veut deux boules, vous dites non gentiment.', en: 'At the ice-cream cart after school; Salma wants two scoops and you say no kindly.' },
      expressions: [
        ary({ key: 'bghit_glas', intent: 'request_food', slot: 'wants', speaker: 'character', arab: 'بغيت غلاص!', arabizi: 'bghit glas!', fr: 'Je veux une glace !', en: 'I want an ice cream!', frNote: '« glas » vient du français « glace » ; c\'est le mot courant.', enNote: '"glas" is borrowed from French "glace" and is the everyday word.', codeSwitch: 'Flavour and dessert words are mostly French loans (glace, chocolat, fraise); both pronunciations are natural.', register: 'casual' }),
        ary({ key: 'chocolat_wla_fraise', intent: 'offer_options', slot: 'which_flavour', arab: 'شوكولا ولا فريز؟', arabizi: 'chocolat wla fraise?', fr: 'Chocolat ou fraise ?', en: 'Chocolate or strawberry?', frNote: '« wla » = « ou » ; les parfums gardent leur nom français.', enNote: '"wla" = "or"; flavour names keep their French form.', register: 'casual' }),
        ary({ key: 'chocolat', intent: 'choose_option', slot: 'picks', speaker: 'character', arab: 'شوكولا!', arabizi: 'chocolat!', fr: 'Chocolat !', en: 'Chocolate!', register: 'casual' }),
        ary({ key: 'wa7ed_lboule', intent: 'specify_quantity', slot: 'scoop', arab: 'واحد البول ديال الشوكولا عافاك', arabizi: 'wa7ed lboule dyal chocolat 3afak', fr: 'Une boule de chocolat, s\'il vous plaît.', en: 'One scoop of chocolate, please.', frNote: 'Dit au marchand ; « boule » est un emprunt au français.', enNote: 'Said to the vendor; "boule" (scoop) is a French loan.', pron: 'ديال (dyal) marks possession/“of”; the ل is light.' }),
        ary({ key: 'wakha_jouj', intent: 'ask_permission', slot: 'asks_two', speaker: 'character', arab: 'واخا جوج؟', arabizi: 'wakha jouj?', fr: 'Je peux en avoir deux ?', en: 'Can I have two?', frNote: 'Litt. « d\'accord, deux ? » ; « wakha » sert aussi de « oui ».', enNote: 'Lit. "okay, two?"; "wakha" also means "okay / yes".', register: 'casual' }),
        ary({ key: 'la_wa7ed_safi', intent: 'refuse_permission', slot: 'just_one', arab: 'لا، واحد صافي', arabizi: 'la, wa7ed safi', fr: 'Non, une seule, c\'est tout.', en: 'No, just one, that\'s it.', frNote: '« safi » clôt la discussion gentiment (« c\'est bon, ça suffit »).', enNote: '"safi" closes the matter kindly ("that\'s enough / done").', register: 'casual' }),
        ary({ key: 'wakha', intent: 'grant_permission', slot: 'okay', arab: 'واخا', arabizi: 'wakha', fr: 'D\'accord.', en: 'Okay.', register: 'casual' }),
        ary({ key: 'bnin_bzzaf', intent: 'say_delicious', slot: 'yummy', speaker: 'character', arab: 'بنين بزاف!', arabizi: 'bnin bzzaf!', fr: 'C\'est trop bon !', en: 'It\'s so good!', frNote: '« bnin » = délicieux ; « bzzaf » = beaucoup / très.', enNote: '"bnin" = tasty; "bzzaf" = a lot / very.', register: 'casual' }),
        ary({ key: '7ta_ana_chocolat', intent: 'express_like', slot: 'me_too', arab: 'حتى أنا كنبغي الشوكولا', arabizi: '7ta ana kanbghi chocolat', fr: 'Moi aussi j\'aime le chocolat.', en: 'I like chocolate too.', frNote: '« kanbghi » = j\'aime (présent habituel en ka-).', enNote: '"kanbghi" = I like (habitual present with ka-).', register: 'casual' }),
        ary({ key: 'chokran_kid', intent: 'thank', slot: 'thanks', speaker: 'character', arab: 'شكرا!', arabizi: 'chokran!', fr: 'Merci !', en: 'Thanks!', register: 'casual' }),
        ary({ key: 'bla_jmil', intent: 'respond_to_thanks', slot: 'welcome', arab: 'بلا جميل', arabizi: 'bla jmil', fr: 'De rien.', en: 'You\'re welcome.', frNote: 'Litt. « sans faveur ».', enNote: 'Lit. "no favour (owed)".', register: 'casual' }),
      ],
    },
  ],
});
