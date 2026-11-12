/**
 * DRAFT chapter — English (target) with source overlays in French AND Russian (4 missions,
 * same blueprints, two overlays). A French-source learner gets French instructions and
 * English target speech; a Russian-source learner gets Russian — never English coaching
 * in the source language (§14.1 A05/A06).
 */
import type { Register } from '@langquest/contracts';
import { defineSeedChapter, type SeedChapter, type SeedExpressionInput } from './types';

interface EnSpec {
  key: string;
  intent: string;
  slot?: string | null;
  speaker?: 'learner' | 'character';
  en: string;
  fr: string;
  ru: string;
  frNote?: string;
  ruNote?: string;
  register?: Register;
}

const en = (s: EnSpec): SeedExpressionInput => ({
  key: s.key,
  intentKey: s.intent,
  slotId: s.slot ?? null,
  speaker: s.speaker ?? 'learner',
  targetText: s.en,
  forms: [{ script: 'Latn', transliterationScheme: null, text: s.en }],
  meanings: {
    fr: { meaning: s.fr, contextNote: s.frNote ?? null, literalGloss: null },
    ru: { meaning: s.ru, contextNote: s.ruNote ?? null, literalGloss: null },
  },
  register: s.register ?? 'polite',
  codeSwitchNote: null,
  pronunciationNote: null,
  nativeReviewed: false,
  reviewStatus: 'review_needed',
  provenance: 'ai_draft',
});

export const ENGLISH_CHAPTER_1: SeedChapter = defineSeedChapter({
  key: 'en_ch1_arrival_city',
  chapterIndex: 1,
  courseTrackId: 'english',
  targetVarietyId: 'en',
  sourceLanguages: ['fr', 'ru'],
  titles: { fr: 'Premiers jours en ville', ru: 'Первые дни в городе' },
  provenance: 'ai_draft',
  nativeReviewed: false,
  reviewStatus: 'review_needed',
  generatedBy: 'curriculum-seed/english@2026-10',
  notes: ['US-neutral phrasing; GB regional option may prefer "bill" → "the bill" vs US "check" — reviewer to add variants.', 'French overlays use vouvoiement with strangers; Russian overlays use «вы».'],
  characters: [
    { characterKey: 'en_maya_acquaintance', role: 'friendly local acquaintance', name: 'Maya', personality: 'easy-going, encouraging', homeRegion: 'US (neutral)', regionalOption: null, voice: 'female' },
    { characterKey: 'en_sam_barista', role: 'café server', name: 'Sam', personality: 'quick, friendly, asks follow-ups', homeRegion: 'US (neutral)', regionalOption: null, voice: 'male' },
    { characterKey: 'en_dana_passerby', role: 'passer-by', name: 'Dana', personality: 'helpful, talks fast', homeRegion: 'US (neutral)', regionalOption: null, voice: 'female' },
    { characterKey: 'en_ray_taxi', role: 'taxi driver', name: 'Ray', personality: 'chatty, practical', homeRegion: 'US (neutral)', regionalOption: null, voice: 'male' },
  ],
  missions: [
    {
      key: 'en_greet_and_introduce',
      blueprintKey: 'greet_and_introduce',
      characterKey: 'en_maya_acquaintance',
      titles: { fr: 'Saluer et se présenter', ru: 'Поздороваться и представиться' },
      sceneNotes: { fr: 'Le matin, devant l\'immeuble, une voisine vous salue.', ru: 'Утром у подъезда с вами здоровается соседка.' },
      expressions: [
        en({ key: 'hello', intent: 'greet_hello', slot: 'greeting', en: 'Hello!', fr: 'Bonjour !', ru: 'Здравствуйте!', frNote: '« Hi » est plus familier.', ruNote: '«Hi» — более неформально.', register: 'neutral' }),
        en({ key: 'how_are_you', intent: 'ask_how_are_you', slot: 'how_are_you', en: 'How are you?', fr: 'Comment ça va ?', ru: 'Как дела?', register: 'neutral' }),
        en({ key: 'fine_thanks', intent: 'reply_fine', slot: 'fine', en: "I'm fine, thanks. And you?", fr: 'Ça va bien, merci. Et vous ?', ru: 'Хорошо, спасибо. А у вас?', register: 'neutral' }),
        en({ key: 'my_name_is', intent: 'introduce_name', slot: 'my_name', en: 'My name is …', fr: 'Je m\'appelle …', ru: 'Меня зовут …', register: 'neutral' }),
        en({ key: 'whats_your_name', intent: 'ask_name', slot: 'your_name', en: "What's your name?", fr: 'Comment vous appelez-vous ?', ru: 'Как вас зовут?', register: 'neutral' }),
        en({ key: 'nice_to_meet_you', intent: 'say_nice_to_meet', slot: 'nice_to_meet', en: 'Nice to meet you.', fr: 'Enchanté(e).', ru: 'Приятно познакомиться.' }),
        en({ key: 'goodbye_good_day', intent: 'say_goodbye', slot: 'goodbye', en: 'Goodbye, have a good day!', fr: 'Au revoir, bonne journée !', ru: 'До свидания, хорошего дня!', register: 'neutral' }),
      ],
    },
    {
      key: 'en_cafe_order_drink',
      blueprintKey: 'cafe_order_drink',
      characterKey: 'en_sam_barista',
      titles: { fr: 'Commander au café', ru: 'Заказ в кафе' },
      sceneNotes: { fr: 'Un café de quartier, le barista pose une question sur la commande.', ru: 'Районное кафе; бариста уточняет заказ.' },
      expressions: [
        en({ key: 'good_morning', intent: 'greet_hello', slot: 'greeting', en: 'Good morning.', fr: 'Bonjour.', ru: 'Доброе утро.', register: 'neutral' }),
        en({ key: 'could_i_have_coffee', intent: 'request_drink', slot: 'order', en: 'Could I have a coffee, please?', fr: 'Je voudrais un café, s\'il vous plaît.', ru: 'Можно мне кофе, пожалуйста?' }),
        en({ key: 'milk_or_sugar', intent: 'offer_options', slot: 'options', speaker: 'character', en: 'Would you like milk or sugar?', fr: 'Vous voulez du lait ou du sucre ?', ru: 'Вам с молоком или с сахаром?', register: 'neutral' }),
        en({ key: 'with_milk', intent: 'choose_option', slot: 'choice', en: 'With milk, please.', fr: 'Avec du lait, s\'il vous plaît.', ru: 'С молоком, пожалуйста.' }),
        en({ key: 'the_bill', intent: 'ask_for_bill', slot: 'bill', en: 'Could I get the bill, please?', fr: 'L\'addition, s\'il vous plaît.', ru: 'Счёт, пожалуйста.', frNote: 'Aux États-Unis on dit plutôt « the check ».', ruNote: 'В США чаще говорят «the check».' }),
        en({ key: 'thank_you_very_much', intent: 'thank', slot: 'thanks', en: 'Thank you very much.', fr: 'Merci beaucoup.', ru: 'Большое спасибо.' }),
      ],
    },
    {
      key: 'en_ask_directions',
      blueprintKey: 'ask_directions',
      characterKey: 'en_dana_passerby',
      titles: { fr: 'Demander son chemin', ru: 'Спросить дорогу' },
      sceneNotes: { fr: 'Vous cherchez la gare ; la passante parle vite.', ru: 'Вы ищете вокзал; прохожая говорит быстро.' },
      expressions: [
        en({ key: 'excuse_me', intent: 'get_attention', slot: 'excuse_me', en: 'Excuse me,', fr: 'Excusez-moi,', ru: 'Извините,' }),
        en({ key: 'where_is_station', intent: 'ask_where_is', slot: 'where_is', en: 'where is the train station?', fr: 'où est la gare ?', ru: 'где вокзал?' }),
        en({ key: 'go_straight', intent: 'give_direction_straight', slot: 'straight', speaker: 'character', en: 'Go straight ahead.', fr: 'Allez tout droit.', ru: 'Идите прямо.', register: 'neutral' }),
        en({ key: 'turn_left', intent: 'give_direction_turn', slot: 'turn', speaker: 'character', en: 'Turn left at the lights.', fr: 'Tournez à gauche aux feux.', ru: 'Поверните налево у светофора.', register: 'neutral' }),
        en({ key: 'is_it_far', intent: 'ask_is_it_far', slot: 'far', en: 'Is it far?', fr: 'C\'est loin ?', ru: 'Это далеко?', register: 'neutral' }),
        en({ key: 'its_close', intent: 'say_it_is_near', slot: 'near', speaker: 'character', en: "It's close, about five minutes on foot.", fr: 'C\'est près, environ cinq minutes à pied.', ru: 'Это близко, около пяти минут пешком.', register: 'neutral' }),
        en({ key: 'say_again', intent: 'ask_repeat', slot: 'repeat', en: 'Could you say that again, please?', fr: 'Pouvez-vous répéter, s\'il vous plaît ?', ru: 'Повторите, пожалуйста.' }),
        en({ key: 'more_slowly', intent: 'ask_slow_down', slot: 'slower', en: 'Could you speak more slowly, please?', fr: 'Pouvez-vous parler plus lentement ?', ru: 'Говорите, пожалуйста, медленнее.' }),
        en({ key: 'dont_understand', intent: 'say_not_understood', en: "Sorry, I don't understand.", fr: 'Désolé(e), je ne comprends pas.', ru: 'Извините, я не понимаю.', register: 'neutral' }),
        en({ key: 'thanks_a_lot', intent: 'thank', slot: 'thanks', en: 'Thanks a lot!', fr: 'Merci beaucoup !', ru: 'Спасибо большое!' }),
      ],
    },
    {
      key: 'en_take_taxi',
      blueprintKey: 'take_taxi',
      characterKey: 'en_ray_taxi',
      titles: { fr: 'Prendre un taxi', ru: 'Поездка на такси' },
      sceneNotes: { fr: 'Un taxi en ville ; vous allez au centre puis à l\'aéroport.', ru: 'Городское такси; вы едете в центр, затем в аэропорт.' },
      expressions: [
        en({ key: 'taxi', intent: 'hail_taxi', slot: 'hail', en: 'Taxi!', fr: 'Taxi !', ru: 'Такси!', register: 'neutral' }),
        en({ key: 'where_to', intent: 'ask_destination', slot: 'where_to', speaker: 'character', en: 'Where to?', fr: 'Où allez-vous ?', ru: 'Куда едем?', register: 'neutral' }),
        en({ key: 'city_centre', intent: 'state_destination', slot: 'destination', en: 'To the city centre, please.', fr: 'Au centre-ville, s\'il vous plaît.', ru: 'В центр города, пожалуйста.' }),
        en({ key: 'use_meter', intent: 'ask_use_meter', slot: 'meter', en: 'Could you use the meter, please?', fr: 'Pouvez-vous mettre le compteur ?', ru: 'Включите счётчик, пожалуйста.' }),
        en({ key: 'how_much_airport', intent: 'ask_fare', slot: 'fare', en: 'How much is it to the airport?', fr: 'C\'est combien jusqu\'à l\'aéroport ?', ru: 'Сколько стоит до аэропорта?', register: 'neutral' }),
        en({ key: 'stop_here', intent: 'say_stop_here', slot: 'stop', en: 'Could you stop here, please?', fr: 'Arrêtez-vous ici, s\'il vous plaît.', ru: 'Остановите здесь, пожалуйста.' }),
        en({ key: 'have_change', intent: 'ask_for_change', slot: 'change', en: 'Do you have change?', fr: 'Vous avez de la monnaie ?', ru: 'У вас есть сдача?' }),
        en({ key: 'thanks_bye', intent: 'say_goodbye', slot: 'bye', en: 'Thanks, bye!', fr: 'Merci, au revoir !', ru: 'Спасибо, до свидания!', register: 'neutral' }),
      ],
    },
  ],
});
