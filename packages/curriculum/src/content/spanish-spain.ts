/**
 * Flagship DRAFT chapter — Spanish (Spain-Castilian) from English. AI-authored drafts,
 * `nativeReviewed: false`, `reviewStatus: 'review_needed'`; Castilian forms only (never es-419).
 */
import type { Register } from '@langquest/contracts';
import { defineSeedChapter, withSourceOverlay, type SeedChapter, type SeedExpressionInput, type SourceOverlay } from './types';
import ES_FR from './overlays/es_es_ch1_arrival_madrid.fr.json';

interface EsSpec {
  key: string;
  intent: string;
  slot?: string | null;
  speaker?: 'learner' | 'character';
  es: string;
  en: string;
  note?: string;
  register?: Register;
  pron?: string;
}

const es = (s: EsSpec): SeedExpressionInput => ({
  key: s.key,
  intentKey: s.intent,
  slotId: s.slot ?? null,
  speaker: s.speaker ?? 'learner',
  targetText: s.es,
  forms: [{ script: 'Latn', transliterationScheme: null, text: s.es }],
  meanings: { en: { meaning: s.en, contextNote: s.note ?? null, literalGloss: null } },
  register: s.register ?? 'polite',
  codeSwitchNote: null,
  pronunciationNote: s.pron ?? null,
  nativeReviewed: false,
  reviewStatus: 'review_needed',
  provenance: 'ai_draft',
});

export const SPANISH_SPAIN_CHAPTER_1: SeedChapter = withSourceOverlay(
  defineSeedChapter({
    key: 'es_es_ch1_arrival_madrid',
    chapterIndex: 1,
    courseTrackId: 'spanish-spain',
    targetVarietyId: 'es-ES',
    sourceLanguages: ['en'],
    titles: { en: 'First days in Madrid' },
    provenance: 'ai_draft',
    nativeReviewed: false,
    reviewStatus: 'review_needed',
    generatedBy: 'curriculum-seed/spanish-spain@2026-10',
    notes: ['Castilian usage (tú/usted, "vale", "¿me cobras?") to be confirmed by a reviewer from Spain; no Latin American substitutions.', 'Gendered adjectives (encantado/a, el nuevo vecino / la nueva vecina) need feminine variants recorded.'],
    characters: [
      { characterKey: 'es_lucia_acquaintance', role: 'friendly local acquaintance', name: 'Lucía', personality: 'open, chatty, laughs easily', homeRegion: 'Madrid', regionalOption: null, voice: 'female' },
      { characterKey: 'es_javi_camarero', role: 'café server', name: 'Javi', personality: 'fast, informal, friendly', homeRegion: 'Madrid', regionalOption: null, voice: 'male' },
      { characterKey: 'es_paco_mercado', role: 'market vendor', name: 'Paco', personality: 'loud, generous, proud of his produce', homeRegion: 'Madrid', regionalOption: null, voice: 'male' },
      { characterKey: 'es_carmen_passerby', role: 'passer-by', name: 'Carmen', personality: 'helpful, precise with directions', homeRegion: 'Madrid', regionalOption: null, voice: 'female' },
      { characterKey: 'es_marta_vecina', role: 'neighbour', name: 'Marta', personality: 'curious, welcoming, offers help', homeRegion: 'Madrid', regionalOption: null, voice: 'female' },
      { characterKey: 'es_antonio_taxista', role: 'taxi driver', name: 'Antonio', personality: 'talkative, football fan', homeRegion: 'Madrid', regionalOption: null, voice: 'male' },
    ],
    missions: [
      {
        key: 'es_greet_and_introduce',
        blueprintKey: 'greet_and_introduce',
        characterKey: 'es_lucia_acquaintance',
        titles: { en: 'Greet and introduce yourself' },
        sceneNotes: { en: 'Morning in the street; a neighbour you have seen before stops to say hello.' },
        expressions: [
          es({ key: 'hola', intent: 'greet_hello', slot: 'greeting', es: 'Hola, buenos días.', en: 'Hello, good morning.', note: '"Buenas" alone is a very common casual greeting at any time of day.', register: 'neutral' }),
          es({ key: 'buenas_tardes', intent: 'greet_time_of_day', es: 'Buenas tardes.', en: 'Good afternoon / good evening.', register: 'neutral' }),
          es({ key: 'que_tal', intent: 'ask_how_are_you', slot: 'how_are_you', es: '¿Qué tal?', en: 'How are you? / How is it going?', register: 'neutral' }),
          es({ key: 'bien_gracias', intent: 'reply_fine', slot: 'fine', es: 'Bien, gracias. ¿Y tú?', en: 'Fine, thanks. And you?', note: 'Use "¿y usted?" with older strangers or in formal settings.', register: 'neutral' }),
          es({ key: 'me_llamo', intent: 'introduce_name', slot: 'my_name', es: 'Me llamo …', en: 'My name is …', register: 'neutral' }),
          es({ key: 'como_te_llamas', intent: 'ask_name', slot: 'your_name', es: '¿Cómo te llamas?', en: 'What\'s your name?', note: 'Formal: "¿Cómo se llama usted?".', register: 'neutral' }),
          es({ key: 'encantado', intent: 'say_nice_to_meet', slot: 'nice_to_meet', es: 'Encantado.', en: 'Nice to meet you.', note: 'A woman says "encantada".' }),
          es({ key: 'hasta_luego', intent: 'say_goodbye', slot: 'goodbye', es: 'Hasta luego.', en: 'See you later / bye.', note: 'The everyday goodbye in Spain; "adiós" sounds more final.', register: 'neutral' }),
        ],
      },
      {
        key: 'es_cafe_order_drink',
        blueprintKey: 'cafe_order_drink',
        characterKey: 'es_javi_camarero',
        titles: { en: 'Ordering at the bar' },
        sceneNotes: { en: 'A neighbourhood bar at breakfast time; the waiter is quick and informal.' },
        expressions: [
          es({ key: 'buenos_dias', intent: 'greet_hello', slot: 'greeting', es: 'Buenos días.', en: 'Good morning.', register: 'neutral' }),
          es({ key: 'cafe_con_leche', intent: 'request_drink', slot: 'order', es: 'Un café con leche, por favor.', en: 'A coffee with milk, please.', note: '"Ponme un café" is the normal casual way to order at a bar in Spain.' }),
          es({ key: 'solo_o_con_leche', intent: 'offer_options', slot: 'options', speaker: 'character', es: '¿Solo o con leche?', en: 'Black or with milk?', register: 'neutral' }),
          es({ key: 'con_leche', intent: 'choose_option', slot: 'choice', es: 'Con leche, por favor.', en: 'With milk, please.' }),
          es({ key: 'me_cobras', intent: 'ask_for_bill', slot: 'bill', es: '¿Me cobras, por favor?', en: 'Can I pay, please? (lit. "will you charge me?")', note: 'Very Spain-specific; "la cuenta, por favor" also works everywhere.' }),
          es({ key: 'la_cuenta', intent: 'ask_for_bill', es: 'La cuenta, por favor.', en: 'The bill, please.' }),
          es({ key: 'gracias', intent: 'thank', slot: 'thanks', es: 'Gracias.', en: 'Thank you.', register: 'neutral' }),
        ],
      },
      {
        key: 'es_market_ask_price',
        blueprintKey: 'market_ask_price',
        characterKey: 'es_paco_mercado',
        titles: { en: 'Asking the price at the market' },
        sceneNotes: { en: 'A fruit stall at a covered market; prices are per kilo and bargaining is unusual.' },
        expressions: [
          es({ key: 'hola_buenas', intent: 'greet_hello', slot: 'greeting', es: 'Hola, buenas.', en: 'Hello.', register: 'neutral' }),
          es({ key: 'cuanto_cuesta', intent: 'ask_price', slot: 'how_much', es: '¿Cuánto cuesta esto?', en: 'How much is this?', register: 'neutral' }),
          es({ key: 'tres_euros_kilo', intent: 'state_price', slot: 'price', speaker: 'character', es: 'Son tres euros el kilo.', en: 'It\'s three euros a kilo.', register: 'neutral' }),
          es({ key: 'que_caro', intent: 'say_too_expensive', slot: 'expensive', es: 'Uy, qué caro.', en: 'Oh, that\'s expensive.', note: 'Light comment; bargaining is not expected at Spanish markets.', register: 'casual' }),
          es({ key: 'mas_barato', intent: 'offer_lower_price', slot: 'lower', es: '¿Me lo dejas un poco más barato?', en: 'Could you give it to me a bit cheaper?', register: 'casual' }),
          es({ key: 'me_lo_llevo', intent: 'agree_to_price', slot: 'deal', es: 'Vale, me lo llevo.', en: 'OK, I\'ll take it.', register: 'neutral' }),
          es({ key: 'no_gracias', intent: 'decline_purchase', slot: 'no_thanks', es: 'No, gracias.', en: 'No, thank you.' }),
          es({ key: 'solo_mirando', intent: 'say_just_looking', es: 'Solo estoy mirando.', en: 'I\'m just looking.', register: 'neutral' }),
        ],
      },
      {
        key: 'es_ask_directions',
        blueprintKey: 'ask_directions',
        characterKey: 'es_carmen_passerby',
        titles: { en: 'Asking for directions' },
        sceneNotes: { en: 'Looking for the train station; the passer-by speaks quickly.' },
        expressions: [
          es({ key: 'perdone', intent: 'get_attention', slot: 'excuse_me', es: 'Perdone,', en: 'Excuse me,', note: 'Formal "perdone" with strangers; "perdona" with young people.' }),
          es({ key: 'donde_esta_estacion', intent: 'ask_where_is', slot: 'where_is', es: '¿dónde está la estación?', en: 'where is the station?' }),
          es({ key: 'todo_recto', intent: 'give_direction_straight', slot: 'straight', speaker: 'character', es: 'Siga todo recto.', en: 'Go straight ahead.', register: 'neutral' }),
          es({ key: 'gire_derecha', intent: 'give_direction_turn', slot: 'turn', speaker: 'character', es: 'Gire a la derecha.', en: 'Turn right.', note: '"a la izquierda" = to the left.', register: 'neutral' }),
          es({ key: 'esta_lejos', intent: 'ask_is_it_far', slot: 'far', es: '¿Está lejos?', en: 'Is it far?', register: 'neutral' }),
          es({ key: 'esta_cerca', intent: 'say_it_is_near', slot: 'near', speaker: 'character', es: 'Está cerca, a cinco minutos andando.', en: 'It\'s close, five minutes on foot.', register: 'neutral' }),
          es({ key: 'puede_repetir', intent: 'ask_repeat', slot: 'repeat', es: '¿Puede repetir, por favor?', en: 'Could you repeat, please?' }),
          es({ key: 'mas_despacio', intent: 'ask_slow_down', slot: 'slower', es: 'Más despacio, por favor.', en: 'Slower, please.' }),
          es({ key: 'no_entiendo', intent: 'say_not_understood', es: 'No entiendo.', en: 'I don\'t understand.', register: 'neutral' }),
          es({ key: 'muchas_gracias', intent: 'thank', slot: 'thanks', es: 'Muchas gracias.', en: 'Thank you very much.' }),
        ],
      },
      {
        key: 'es_meet_neighbour',
        blueprintKey: 'meet_neighbour',
        characterKey: 'es_marta_vecina',
        titles: { en: 'Meeting a neighbour' },
        sceneNotes: { en: 'In the stairwell; the neighbour carries shopping bags and is curious about the newcomer.' },
        expressions: [
          es({ key: 'nuevo_vecino', intent: 'say_new_neighbour', slot: 'new_neighbour', es: 'Soy el nuevo vecino.', en: 'I\'m the new neighbour.', note: 'Feminine: "la nueva vecina".', register: 'neutral' }),
          es({ key: 'bienvenido', intent: 'welcome_someone', slot: 'welcome', speaker: 'character', es: '¡Bienvenido!', en: 'Welcome!', note: 'Feminine: "¡Bienvenida!".', register: 'neutral' }),
          es({ key: 'de_donde_eres', intent: 'ask_where_from', slot: 'where_from_q', es: '¿De dónde eres?', en: 'Where are you from?', register: 'neutral' }),
          es({ key: 'soy_de_canada', intent: 'say_where_from', slot: 'from', es: 'Soy de Canadá.', en: 'I\'m from Canada.', register: 'neutral' }),
          es({ key: 'hablas_ingles', intent: 'ask_if_speaks_language', slot: 'speak_lang', es: '¿Hablas inglés?', en: 'Do you speak English?', register: 'neutral' }),
          es({ key: 'un_poco', intent: 'say_speak_little', slot: 'little', es: 'Un poco.', en: 'A little.', register: 'neutral' }),
          es({ key: 'si_necesitas_algo', intent: 'offer_help', slot: 'offer_help', es: 'Si necesitas algo, dímelo.', en: 'If you need anything, let me know.', register: 'neutral' }),
          es({ key: 'muy_amable', intent: 'thank', slot: 'thanks', es: 'Gracias, muy amable.', en: 'Thanks, that\'s very kind.' }),
        ],
      },
      {
        key: 'es_take_taxi',
        blueprintKey: 'take_taxi',
        characterKey: 'es_antonio_taxista',
        titles: { en: 'Taking a taxi' },
        sceneNotes: { en: 'A white Madrid taxi; the meter is always used, so asking for it is only a check.' },
        expressions: [
          es({ key: 'taxi', intent: 'hail_taxi', slot: 'hail', es: '¡Taxi!', en: 'Taxi!', register: 'neutral' }),
          es({ key: 'adonde_va', intent: 'ask_destination', slot: 'where_to', speaker: 'character', es: '¿Adónde va?', en: 'Where to?', register: 'neutral' }),
          es({ key: 'al_centro', intent: 'state_destination', slot: 'destination', es: 'Al centro, por favor.', en: 'To the centre, please.' }),
          es({ key: 'con_taximetro', intent: 'ask_use_meter', slot: 'meter', es: 'Con taxímetro, por favor.', en: 'With the meter, please.' }),
          es({ key: 'cuanto_aeropuerto', intent: 'ask_fare', slot: 'fare', es: '¿Cuánto cuesta hasta el aeropuerto?', en: 'How much is it to the airport?', register: 'neutral' }),
          es({ key: 'pare_aqui', intent: 'say_stop_here', slot: 'stop', es: 'Pare aquí, por favor.', en: 'Stop here, please.' }),
          es({ key: 'tiene_cambio', intent: 'ask_for_change', slot: 'change', es: '¿Tiene cambio?', en: 'Do you have change?' }),
          es({ key: 'gracias_adios', intent: 'say_goodbye', slot: 'bye', es: 'Gracias, adiós.', en: 'Thanks, goodbye.', register: 'neutral' }),
        ],
      },
    ],
  }),
  ES_FR as SourceOverlay,
);
