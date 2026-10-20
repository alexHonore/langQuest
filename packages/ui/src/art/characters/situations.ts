/**
 * Situation catalogue — the bridge between the cast and the curriculum.
 *
 * A character carries a few free-text *situation tags* (a kid asks for ice cream, an
 * elder gives directions, a tailor talks about a suit…). Each tag maps to the
 * language-independent communicative intents of `@langquest/curriculum`
 * (`packages/curriculum/src/intents.ts`), so `charactersForIntent(varietyId, intentKey)`
 * can pick the interlocutor whose everyday life naturally produces a lesson's intent.
 *
 * `@langquest/ui` does not depend on the curriculum package (it must stay loadable on
 * React Native without the registries); the intent keys below are a mirrored string
 * union and `characters.test.ts` asserts every one of them exists in the curriculum.
 */
import type { AgeBand } from './types';

/** Intent keys of `@langquest/curriculum` used by the situation catalogue (mirrored, test-verified). */
export type CurriculumIntentKey =
  | 'greet_hello'
  | 'greet_time_of_day'
  | 'ask_how_are_you'
  | 'reply_fine'
  | 'reply_not_great'
  | 'introduce_name'
  | 'ask_name'
  | 'say_nice_to_meet'
  | 'say_where_from'
  | 'ask_where_from'
  | 'react_to_origin'
  | 'say_goodbye'
  | 'wish_good_day'
  | 'welcome_someone'
  | 'thank'
  | 'respond_to_thanks'
  | 'apologise'
  | 'accept_apology'
  | 'get_attention'
  | 'ask_repeat'
  | 'repeat_utterance'
  | 'ask_slow_down'
  | 'say_not_understood'
  | 'ask_meaning_of_word'
  | 'explain_meaning'
  | 'ask_how_to_say'
  | 'confirm_understood'
  | 'check_comprehension'
  | 'ask_if_speaks_language'
  | 'say_speak_little'
  | 'correct_self'
  | 'ask_clarification'
  | 'say_dont_know'
  | 'request_drink'
  | 'request_food'
  | 'request_item'
  | 'offer_options'
  | 'choose_option'
  | 'specify_quantity'
  | 'confirm_order'
  | 'ask_recommendation'
  | 'ask_ingredients'
  | 'ask_for_bill'
  | 'state_price'
  | 'pay'
  | 'ask_payment_method'
  | 'ask_for_change'
  | 'give_change'
  | 'say_delicious'
  | 'request_table'
  | 'say_unavailable'
  | 'ask_alternative'
  | 'ask_price'
  | 'say_too_expensive'
  | 'offer_lower_price'
  | 'ask_last_price'
  | 'agree_to_price'
  | 'decline_purchase'
  | 'say_just_looking'
  | 'ask_for_variant'
  | 'accept_offer'
  | 'decline_offer'
  | 'ask_where_is'
  | 'ask_how_to_get'
  | 'give_direction_straight'
  | 'give_direction_turn'
  | 'ask_is_it_far'
  | 'say_it_is_far'
  | 'say_it_is_near'
  | 'say_lost'
  | 'ask_which_stop'
  | 'hail_taxi'
  | 'ask_destination'
  | 'state_destination'
  | 'ask_fare'
  | 'ask_use_meter'
  | 'say_stop_here'
  | 'buy_ticket'
  | 'ask_departure_time'
  | 'ask_time'
  | 'tell_time'
  | 'ask_opening_hours'
  | 'say_new_neighbour'
  | 'offer_help'
  | 'ask_small_favour'
  | 'invite'
  | 'accept_invitation'
  | 'decline_invitation'
  | 'suggest_activity'
  | 'make_plan_time'
  | 'suggest_other_time'
  | 'confirm_plan'
  | 'cancel_plan'
  | 'state_future_plan'
  | 'ask_about_family'
  | 'describe_family'
  | 'ask_occupation'
  | 'describe_occupation'
  | 'describe_routine'
  | 'call_for_help'
  | 'ask_emergency_type'
  | 'say_emergency_type'
  | 'ask_for_doctor_or_pharmacy'
  | 'describe_pain'
  | 'report_lost_item'
  | 'report_broken'
  | 'state_opinion'
  | 'ask_opinion'
  | 'agree'
  | 'disagree_politely'
  | 'give_reason'
  | 'ask_reason'
  | 'express_like'
  | 'express_dislike'
  | 'express_preference_between'
  | 'express_feeling'
  | 'react_with_empathy'
  | 'compliment'
  | 'respond_to_compliment'
  | 'small_talk_weather'
  | 'narrate_past_event'
  | 'say_when_happened'
  | 'ask_permission'
  | 'grant_permission'
  | 'refuse_permission'
  | 'ask_availability'
  | 'make_reservation';

export interface CharacterSituation {
  /** Short human label (English, documentation only — never rendered in the apps). */
  label: string;
  /** Youngest age band that can plausibly *carry* this situation as the interlocutor. */
  minAgeBand: AgeBand;
  /** Curriculum intents this situation produces, in teaching order. */
  intents: readonly CurriculumIntentKey[];
}

const situation = (
  label: string,
  minAgeBand: AgeBand,
  intents: readonly CurriculumIntentKey[],
): CharacterSituation => ({ label, minAgeBand, intents });

/**
 * Situation tags ↔ curriculum intents. Keys are the free-text tags stored on
 * `LangQuestCharacter.situations`; keep them stable (they appear in the casting doc).
 */
export const CHARACTER_SITUATIONS = {
  greet_and_introduce: situation('Greetings and introductions', 'child', [
    'greet_hello',
    'greet_time_of_day',
    'ask_how_are_you',
    'reply_fine',
    'reply_not_great',
    'introduce_name',
    'ask_name',
    'say_nice_to_meet',
    'say_where_from',
    'ask_where_from',
    'react_to_origin',
    'say_goodbye',
    'wish_good_day',
  ]),
  language_help: situation('Asking for repetition, meaning and help', 'child', [
    'ask_repeat',
    'repeat_utterance',
    'ask_slow_down',
    'say_not_understood',
    'ask_meaning_of_word',
    'explain_meaning',
    'ask_how_to_say',
    'confirm_understood',
    'check_comprehension',
    'ask_if_speaks_language',
    'say_speak_little',
    'correct_self',
    'ask_clarification',
    'say_dont_know',
  ]),
  ask_for_ice_cream: situation('Buying an ice cream or a treat', 'child', [
    'request_food',
    'choose_option',
    'specify_quantity',
    'ask_price',
    'state_price',
    'pay',
    'say_delicious',
    'thank',
    'express_like',
  ]),
  playground: situation('Making friends at the playground', 'child', [
    'greet_hello',
    'introduce_name',
    'ask_name',
    'invite',
    'suggest_activity',
    'accept_invitation',
    'express_like',
    'express_dislike',
    'ask_permission',
    'grant_permission',
    'refuse_permission',
  ]),
  school_day: situation('A day at school', 'child', [
    'describe_routine',
    'ask_time',
    'tell_time',
    'ask_how_to_say',
    'ask_meaning_of_word',
    'say_dont_know',
    'state_future_plan',
  ]),
  family_stories: situation('Family and stories from the past', 'child', [
    'ask_about_family',
    'describe_family',
    'narrate_past_event',
    'say_when_happened',
    'react_with_empathy',
    'express_feeling',
  ]),
  ask_directions: situation('Asking for and giving directions', 'child', [
    'get_attention',
    'ask_where_is',
    'ask_how_to_get',
    'give_direction_straight',
    'give_direction_turn',
    'ask_is_it_far',
    'say_it_is_far',
    'say_it_is_near',
    'say_lost',
    'thank',
  ]),
  order_drink: situation('Ordering a drink at a café', 'child', [
    'greet_hello',
    'request_drink',
    'offer_options',
    'choose_option',
    'confirm_order',
    'ask_for_bill',
    'pay',
    'ask_payment_method',
    'thank',
    'respond_to_thanks',
  ]),
  restaurant: situation('Eating out', 'teen', [
    'request_table',
    'request_food',
    'ask_recommendation',
    'ask_ingredients',
    'confirm_order',
    'say_delicious',
    'ask_for_bill',
    'state_price',
    'pay',
  ]),
  market_bargain: situation('Bargaining at the market', 'teen', [
    'request_item',
    'specify_quantity',
    'ask_price',
    'state_price',
    'say_too_expensive',
    'offer_lower_price',
    'ask_last_price',
    'agree_to_price',
    'decline_purchase',
    'say_just_looking',
  ]),
  groceries: situation('Buying groceries', 'teen', [
    'request_item',
    'specify_quantity',
    'ask_price',
    'state_price',
    'pay',
    'ask_payment_method',
    'ask_for_change',
    'give_change',
    'say_unavailable',
    'ask_alternative',
  ]),
  clothing_skirt: situation('Choosing clothes (a skirt, a size, a colour)', 'teen', [
    'ask_for_variant',
    'choose_option',
    'express_preference_between',
    'ask_price',
    'say_too_expensive',
    'compliment',
    'respond_to_compliment',
    'decline_purchase',
    'say_just_looking',
    'ask_alternative',
  ]),
  tailor_suit: situation('At the tailor (a suit, a fitting)', 'adult', [
    'ask_for_variant',
    'make_reservation',
    'ask_availability',
    'make_plan_time',
    'confirm_plan',
    'ask_price',
    'agree_to_price',
    'state_opinion',
    'compliment',
  ]),
  pharmacy: situation('At the pharmacy', 'adult', [
    'ask_for_doctor_or_pharmacy',
    'describe_pain',
    'ask_recommendation',
    'say_unavailable',
    'ask_alternative',
    'state_price',
    'pay',
    'ask_opening_hours',
  ]),
  clinic_symptoms: situation('Describing symptoms at a clinic', 'adult', [
    'describe_pain',
    'ask_emergency_type',
    'say_emergency_type',
    'call_for_help',
    'make_reservation',
    'ask_availability',
    'react_with_empathy',
    'confirm_understood',
  ]),
  taxi_destination: situation('Taking a taxi', 'adult', [
    'hail_taxi',
    'ask_destination',
    'state_destination',
    'ask_fare',
    'ask_use_meter',
    'say_stop_here',
    'ask_is_it_far',
    'small_talk_weather',
  ]),
  bus_and_transit: situation('Buses, trams and the metro', 'teen', [
    'ask_which_stop',
    'buy_ticket',
    'ask_departure_time',
    'ask_time',
    'tell_time',
    'ask_how_to_get',
    'say_lost',
  ]),
  train_station: situation('At the station', 'teen', [
    'buy_ticket',
    'ask_departure_time',
    'ask_which_stop',
    'ask_time',
    'tell_time',
    'report_lost_item',
  ]),
  office_meeting: situation('Meetings and opinions at work', 'adult', [
    'ask_opinion',
    'state_opinion',
    'agree',
    'disagree_politely',
    'give_reason',
    'ask_reason',
    'make_plan_time',
    'suggest_other_time',
    'confirm_plan',
    'ask_availability',
  ]),
  new_neighbour: situation('Meeting the neighbours', 'child', [
    'greet_hello',
    'say_new_neighbour',
    'welcome_someone',
    'offer_help',
    'ask_small_favour',
    'small_talk_weather',
    'invite',
    'thank',
  ]),
  hosting_at_home: situation('Being a guest or a host', 'child', [
    'greet_hello',
    'welcome_someone',
    'offer_options',
    'accept_offer',
    'decline_offer',
    'say_delicious',
    'thank',
    'respond_to_thanks',
    'ask_permission',
  ]),
  plans_with_friends: situation('Making plans with friends', 'teen', [
    'invite',
    'accept_invitation',
    'decline_invitation',
    'suggest_activity',
    'make_plan_time',
    'suggest_other_time',
    'confirm_plan',
    'cancel_plan',
    'state_future_plan',
  ]),
  work_and_routine: situation('Work and daily routine', 'teen', [
    'ask_occupation',
    'describe_occupation',
    'describe_routine',
    'ask_time',
    'tell_time',
    'express_like',
  ]),
  opinions_and_feelings: situation('Opinions and feelings', 'child', [
    'state_opinion',
    'ask_opinion',
    'agree',
    'disagree_politely',
    'give_reason',
    'express_feeling',
    'react_with_empathy',
    'express_like',
    'express_dislike',
  ]),
  music_and_hobbies: situation('Music and hobbies', 'child', [
    'express_like',
    'express_dislike',
    'express_preference_between',
    'invite',
    'suggest_activity',
    'ask_opinion',
    'compliment',
  ]),
  sports_talk: situation('Talking about sport', 'child', [
    'express_like',
    'express_preference_between',
    'state_opinion',
    'narrate_past_event',
    'say_when_happened',
    'invite',
    'suggest_activity',
  ]),
  city_tour: situation('Showing someone around the city', 'teen', [
    'ask_where_is',
    'ask_opening_hours',
    'ask_recommendation',
    'narrate_past_event',
    'ask_reason',
    'give_reason',
    'ask_is_it_far',
    'say_it_is_near',
  ]),
  lost_and_broken: situation('Something lost or broken', 'child', [
    'report_lost_item',
    'report_broken',
    'apologise',
    'accept_apology',
    'ask_small_favour',
    'offer_help',
  ]),
  apologies_and_thanks: situation('Apologising and thanking', 'child', [
    'apologise',
    'accept_apology',
    'thank',
    'respond_to_thanks',
    'get_attention',
  ]),
  library_and_reading: situation('At the library', 'child', [
    'ask_where_is',
    'ask_opening_hours',
    'ask_permission',
    'grant_permission',
    'refuse_permission',
    'ask_meaning_of_word',
    'explain_meaning',
  ]),
  hair_salon: situation('At the hairdresser', 'teen', [
    'make_reservation',
    'ask_availability',
    'choose_option',
    'ask_for_variant',
    'state_opinion',
    'compliment',
    'ask_price',
  ]),
  delivery_and_errands: situation('Deliveries and errands', 'teen', [
    'ask_where_is',
    'give_direction_turn',
    'give_direction_straight',
    'state_destination',
    'report_broken',
    'apologise',
    'thank',
  ]),
  weather_small_talk: situation('Small talk about the weather', 'child', [
    'small_talk_weather',
    'express_feeling',
    'agree',
    'state_opinion',
  ]),
} as const satisfies Record<string, CharacterSituation>;

export type SituationTag = keyof typeof CHARACTER_SITUATIONS;

/** Every situation tag, in catalogue order. */
export const SITUATION_TAGS = Object.keys(CHARACTER_SITUATIONS) as SituationTag[];

export const isSituationTag = (value: unknown): value is SituationTag =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHARACTER_SITUATIONS, value);

const AGE_ORDER: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2, elder: 3 };

/** True when a character of `ageBand` can plausibly carry the situation. */
export function situationFitsAge(tag: SituationTag, ageBand: AgeBand): boolean {
  return AGE_ORDER[ageBand] >= AGE_ORDER[CHARACTER_SITUATIONS[tag].minAgeBand];
}

/** Deduplicated intent keys of a list of situation tags (catalogue order preserved). */
export function intentsForSituations(tags: readonly SituationTag[]): CurriculumIntentKey[] {
  const seen = new Set<CurriculumIntentKey>();
  const out: CurriculumIntentKey[] = [];
  for (const tag of tags) {
    for (const key of CHARACTER_SITUATIONS[tag].intents) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
