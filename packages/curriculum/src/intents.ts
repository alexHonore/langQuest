/**
 * Language-independent communicative intents (spec §2.2, §9.5, §9.8).
 *
 * An intent is *what the learner means*, never a sentence. Target-language expressions
 * realise intents per variety; source-language overlays explain them. Equivalent ideas are
 * linked through `conceptId` (e.g. `request.drink`) so paraphrases and dialect-specific
 * variants are accepted semantically, never by text equality (§14.1 A11).
 */
import { z } from 'zod';
import { IntentPolaritySchema, IntentPolitenessSchema, KeySchema, type IntentPolarity, type IntentPoliteness } from '@langquest/contracts';
import { isSkillKey } from './skills';

// Polarity/politeness enums are owned by `@langquest/contracts` (same values as the
// `communicative_intents` DB CHECK constraints); re-exported here for existing importers.
export { IntentPolaritySchema, IntentPolitenessSchema, type IntentPolarity, type IntentPoliteness };

/** Social risk of producing this intent toward a stranger; the rubric rejects `offensive` and, in polite scenes, `rude`. */
export const SocialRiskSchema = z.enum(['none', 'blunt', 'rude', 'offensive']);
export type SocialRisk = z.infer<typeof SocialRiskSchema>;

export const ResponseConstraintsSchema = z.object({
  /** Whether the intent normally expects an addressee reply. */
  expectsReply: z.boolean(),
  /** Intents that are natural replies (used by the character agent and the evaluator). */
  replyIntentKeys: z.array(KeySchema),
  /** Semantic slots that must be present for the intent to count as complete (e.g. `item`). */
  requiredSlots: z.array(z.string()),
  /** Optional slots that enrich the intent (e.g. `quantity`, `size`). */
  optionalSlots: z.array(z.string()),
  /** Meanings an utterance must not carry to still count as this intent (e.g. a command when a request is expected). */
  mustNotImply: z.array(z.string()),
  /** Typical maximum length in words for beginner realisations (a hint for generation, not a rule for acceptance). */
  typicalMaxWords: z.number().int().positive(),
});
export type ResponseConstraints = z.infer<typeof ResponseConstraintsSchema>;

export const CommunicativeIntentSchema = z.object({
  /** Stable snake_case key (`communicative_intents.intent_key`). */
  intentKey: KeySchema,
  /** Dotted semantic concept id shared by paraphrase-equivalent intents across languages. */
  conceptId: z.string().regex(/^[a-z0-9]+(?:\.[a-z0-9_]+)+$/),
  description: z.string().min(1),
  /** What the act does socially (face, relationship, expectations). */
  socialMeaning: z.string().min(1),
  polarity: IntentPolaritySchema,
  politeness: IntentPolitenessSchema,
  socialRisk: SocialRiskSchema,
  responseConstraints: ResponseConstraintsSchema,
  /** Language-neutral descriptions of semantically acceptable variants (never target-text). */
  acceptableVariants: z.array(z.string().min(1)).min(1),
  /** More general intents that also satisfy this one when observed (e.g. `request_item` for `request_drink`). */
  broaderIntentKeys: z.array(KeySchema),
  /** Skills this intent gives evidence for. */
  skillKeys: z.array(KeySchema).min(1),
});
export type CommunicativeIntent = z.infer<typeof CommunicativeIntentSchema>;

interface IntentSpec {
  key: string;
  concept: string;
  description: string;
  social: string;
  polarity?: IntentPolarity;
  politeness?: IntentPoliteness;
  risk?: SocialRisk;
  expectsReply?: boolean;
  replies?: string[];
  slots?: string[];
  optionalSlots?: string[];
  mustNotImply?: string[];
  maxWords?: number;
  variants: string[];
  broader?: string[];
  skills: string[];
}

const intent = (s: IntentSpec): CommunicativeIntent => ({
  intentKey: s.key,
  conceptId: s.concept,
  description: s.description,
  socialMeaning: s.social,
  polarity: s.polarity ?? 'neutral',
  politeness: s.politeness ?? 'any',
  socialRisk: s.risk ?? 'none',
  responseConstraints: {
    expectsReply: s.expectsReply ?? true,
    replyIntentKeys: s.replies ?? [],
    requiredSlots: s.slots ?? [],
    optionalSlots: s.optionalSlots ?? [],
    mustNotImply: s.mustNotImply ?? [],
    typicalMaxWords: s.maxWords ?? 8,
  },
  acceptableVariants: s.variants,
  broaderIntentKeys: s.broader ?? [],
  skillKeys: s.skills,
});

/** All communicative intents. */
export const INTENTS: readonly CommunicativeIntent[] = [
  // --- greetings ------------------------------------------------------------
  intent({ key: 'greet_hello', concept: 'greet.hello', description: 'Open an encounter with a greeting.', social: 'Acknowledges the other person and opens the channel.', polarity: 'positive', replies: ['greet_hello', 'ask_how_are_you'], variants: ['generic hello', 'religious or regional greeting formula', 'time-of-day greeting'], skills: ['greet_politely'] }),
  intent({ key: 'greet_time_of_day', concept: 'greet.hello', description: 'Greet with a time-of-day formula (good morning/evening).', social: 'Marks politeness and the moment of the day.', polarity: 'positive', replies: ['greet_time_of_day', 'greet_hello'], variants: ['good morning', 'good evening', 'any locally natural time-bound greeting'], skills: ['greet_politely'] }),
  intent({ key: 'ask_how_are_you', concept: 'greet.wellbeing_question', description: 'Ask how the other person is.', social: 'Phatic: shows interest, expects a short formula back.', polarity: 'positive', replies: ['reply_fine', 'reply_not_great'], variants: ['how are you', 'everything fine?', 'how is it going', 'regional formulas'], skills: ['respond_to_greeting', 'greet_politely'] }),
  intent({ key: 'reply_fine', concept: 'greet.wellbeing_reply', description: 'Reply that one is fine.', social: 'Closes the phatic exchange positively; often returns the question.', polarity: 'positive', expectsReply: false, replies: ['ask_how_are_you'], variants: ['fine thanks', 'all good', 'thanks to God / religious formula', 'fine and you?'], skills: ['respond_to_greeting'] }),
  intent({ key: 'reply_not_great', concept: 'greet.wellbeing_reply', description: 'Reply that one is not doing great.', social: 'Honest but mild; invites a short follow-up.', polarity: 'negative', expectsReply: false, variants: ['so-so', 'a bit tired', 'not too bad'], skills: ['respond_to_greeting', 'express_feeling'] }),
  intent({ key: 'introduce_name', concept: 'intro.name', description: 'Say one\'s own name.', social: 'Offers identity; invites the other to do the same.', polarity: 'positive', slots: ['name'], replies: ['say_nice_to_meet', 'introduce_name'], variants: ['my name is X', 'I am X', 'they call me X'], skills: ['introduce_self'] }),
  intent({ key: 'ask_name', concept: 'intro.name_question', description: 'Ask the other person\'s name.', social: 'Shows interest; polite forms matter with strangers.', replies: ['introduce_name'], variants: ['what is your name', 'and you are?', 'may I ask your name'], skills: ['ask_name'] }),
  intent({ key: 'say_nice_to_meet', concept: 'intro.pleased', description: 'Express pleasure at meeting someone.', social: 'Ritual closure of an introduction.', polarity: 'positive', expectsReply: false, replies: ['say_nice_to_meet'], variants: ['nice to meet you', 'pleased / honoured', 'likewise'], skills: ['introduce_self'] }),
  intent({ key: 'say_where_from', concept: 'intro.origin', description: 'Say where one is from.', social: 'Shares background; common small-talk anchor.', slots: ['place'], replies: ['react_to_origin', 'ask_where_from'], variants: ['I am from COUNTRY', 'I come from CITY', 'I live in PLACE but I am from PLACE'], skills: ['say_where_from'] }),
  intent({ key: 'ask_where_from', concept: 'intro.origin_question', description: 'Ask where someone is from.', social: 'Curiosity; neutral to positive.', replies: ['say_where_from'], variants: ['where are you from', 'which country', 'are you from here?'], skills: ['ask_where_from'] }),
  intent({ key: 'react_to_origin', concept: 'intro.origin_reaction', description: 'React to hearing where someone is from.', social: 'Warmth; keeps the conversation going.', polarity: 'positive', expectsReply: false, variants: ['welcome', 'oh nice', 'I know that place'], skills: ['respond_to_unexpected_question', 'ask_where_from'] }),
  intent({ key: 'say_goodbye', concept: 'leave.goodbye', description: 'Close an encounter.', social: 'Ends the exchange without abruptness.', polarity: 'positive', expectsReply: false, replies: ['say_goodbye'], variants: ['goodbye', 'see you', 'go in peace / religious formula', 'have a good day'], skills: ['take_leave'] }),
  intent({ key: 'wish_good_day', concept: 'leave.goodbye', description: 'Wish the other person a good day/evening.', social: 'Warm closing.', polarity: 'positive', expectsReply: false, variants: ['have a nice day', 'enjoy your evening', 'good luck'], skills: ['take_leave'] }),
  intent({ key: 'welcome_someone', concept: 'greet.welcome', description: 'Welcome someone (to a place, a home, a country).', social: 'Hospitality; strongly positive.', polarity: 'positive', expectsReply: false, replies: ['thank'], variants: ['welcome', 'you are welcome here', 'make yourself at home'], skills: ['greet_politely', 'offer_help'] }),

  // --- thanks, apologies, attention ------------------------------------------
  intent({ key: 'thank', concept: 'thanks.thank', description: 'Thank someone.', social: 'Acknowledges a favour or service.', polarity: 'positive', expectsReply: false, replies: ['respond_to_thanks'], variants: ['thank you', 'thanks a lot', 'blessing formula used as thanks'], skills: ['thank_and_respond'] }),
  intent({ key: 'respond_to_thanks', concept: 'thanks.respond', description: 'Respond to thanks.', social: 'Minimises the favour.', polarity: 'positive', expectsReply: false, variants: ['you are welcome', 'no problem', 'it is nothing'], skills: ['thank_and_respond'] }),
  intent({ key: 'apologise', concept: 'apology.sorry', description: 'Apologise for a small mistake or inconvenience.', social: 'Repairs face.', polarity: 'negative', expectsReply: false, replies: ['accept_apology'], variants: ['sorry', 'excuse me (apology)', 'my mistake'], skills: ['apologise'] }),
  intent({ key: 'accept_apology', concept: 'apology.accept', description: 'Accept an apology.', social: 'Closes the repair.', polarity: 'positive', expectsReply: false, variants: ['no problem', 'it is fine', 'do not worry'], skills: ['apologise', 'thank_and_respond'] }),
  intent({ key: 'get_attention', concept: 'attention.request', description: 'Politely attract someone\'s attention before speaking.', social: 'Signals a coming request; essential with strangers and staff.', politeness: 'polite', expectsReply: false, variants: ['excuse me', 'please (as attention getter)', 'sir/madam'], skills: ['apologise', 'request_item'] }),

  // --- repair & meta -----------------------------------------------------------
  intent({ key: 'ask_repeat', concept: 'repair.repeat', description: 'Ask the speaker to repeat.', social: 'Keeps the conversation alive while admitting a gap.', replies: ['repeat_utterance'], variants: ['again please', 'can you repeat', 'sorry, what?'], skills: ['ask_to_repeat'] }),
  intent({ key: 'repeat_utterance', concept: 'repair.repeat_reply', description: 'Repeat what one said, possibly slower.', social: 'Cooperative repair.', expectsReply: false, variants: ['same content repeated', 'rephrased more simply'], skills: ['confirm_understanding'] }),
  intent({ key: 'ask_slow_down', concept: 'repair.slower', description: 'Ask the speaker to slow down.', social: 'Signals a processing need, not disinterest.', replies: ['repeat_utterance'], variants: ['slowly please', 'you speak fast, slower?', 'a bit slower'], skills: ['ask_to_slow_down'] }),
  intent({ key: 'say_not_understood', concept: 'repair.not_understood', description: 'Say one did not understand.', social: 'Invites simplification.', polarity: 'negative', replies: ['repeat_utterance', 'explain_meaning'], variants: ['I did not understand', 'I do not get it', 'what does that mean?'], skills: ['say_dont_understand'] }),
  intent({ key: 'ask_meaning_of_word', concept: 'repair.meaning', description: 'Ask what a word or phrase means.', social: 'Learning stance; well received.', slots: ['term'], replies: ['explain_meaning'], variants: ['what does X mean', 'X, what is that?', 'X means what?'], skills: ['ask_meaning'] }),
  intent({ key: 'explain_meaning', concept: 'repair.explain', description: 'Explain a word simply.', social: 'Cooperative teaching move.', expectsReply: false, variants: ['gives a synonym', 'gives an example', 'points at the object'], skills: ['repair_misunderstanding'] }),
  intent({ key: 'ask_how_to_say', concept: 'repair.how_to_say', description: 'Ask how to say something in the target language.', social: 'Learning stance.', slots: ['concept'], replies: ['explain_meaning'], variants: ['how do you say X', 'what is the word for X', 'X in your language?'], skills: ['ask_meaning'] }),
  intent({ key: 'confirm_understood', concept: 'repair.confirm', description: 'Confirm one has understood.', social: 'Closes a repair loop.', polarity: 'positive', expectsReply: false, variants: ['understood', 'ok, got it', 'repeats key info back'], skills: ['confirm_understanding'] }),
  intent({ key: 'check_comprehension', concept: 'repair.check', description: 'Check that the other person understood.', social: 'Considerate; also used by staff.', replies: ['confirm_understood', 'say_not_understood'], variants: ['ok?', 'you understand?', 'is that clear?'], skills: ['confirm_understanding'] }),
  intent({ key: 'ask_if_speaks_language', concept: 'repair.language_check', description: 'Ask whether someone speaks a given language.', social: 'Negotiates the medium; neutral.', slots: ['language'], replies: ['say_speak_little', 'confirm_understood'], variants: ['do you speak X', 'X ok?', 'can we speak X'], skills: ['handle_code_switch'] }),
  intent({ key: 'say_speak_little', concept: 'repair.language_ability', description: 'Say one speaks only a little.', social: 'Lowers expectations, invites patience.', expectsReply: false, variants: ['a little', 'I am learning', 'not much, slowly please'], skills: ['handle_code_switch', 'ask_to_slow_down'] }),
  intent({ key: 'correct_self', concept: 'repair.self_correction', description: 'Correct what one just said.', social: 'Shows monitoring; natural.', expectsReply: false, variants: ['no, I mean X', 'sorry, X not Y', 'restates correctly'], skills: ['repair_misunderstanding'] }),
  intent({ key: 'ask_clarification', concept: 'repair.clarify', description: 'Ask for clarification about what is wanted.', social: 'Cooperative; avoids guessing.', replies: ['explain_meaning', 'repeat_utterance'], variants: ['which one?', 'you mean X?', 'for now or later?'], skills: ['ask_clarifying_question'] }),
  intent({ key: 'say_dont_know', concept: 'meta.dont_know', description: 'Say one does not know.', social: 'Honest; keeps face when polite.', polarity: 'negative', expectsReply: false, variants: ['I do not know', 'no idea', 'I am not sure'], skills: ['respond_to_unexpected_question'] }),

  // --- cafe / restaurant -------------------------------------------------------
  intent({ key: 'request_drink', broader: ['request_item'], concept: 'request.drink', description: 'Ask for a drink.', social: 'Transactional request; politeness marker expected with staff.', politeness: 'polite', slots: ['drink'], optionalSlots: ['size', 'quantity', 'with_without'], mustNotImply: ['bare command without softener'], replies: ['offer_options', 'confirm_order'], variants: ['I would like a X please', 'a X please', 'can I have a X', 'for me a X'], skills: ['request_drink', 'request_item'] }),
  intent({ key: 'request_food', broader: ['request_item'], concept: 'request.food', description: 'Order a dish.', social: 'Transactional request.', politeness: 'polite', slots: ['dish'], optionalSlots: ['quantity', 'side', 'without'], mustNotImply: ['bare command without softener'], replies: ['offer_options', 'confirm_order'], variants: ['I will have X', 'the X please', 'can I get the X'], skills: ['order_food', 'request_item'] }),
  intent({ key: 'request_item', concept: 'request.item', description: 'Ask for a specific item.', social: 'Generic transactional request.', politeness: 'polite', slots: ['item'], optionalSlots: ['quantity'], replies: ['confirm_order', 'say_unavailable'], variants: ['I would like X', 'X please', 'do you have X?'], skills: ['request_item'] }),
  intent({ key: 'offer_options', concept: 'offer.options', description: 'Offer a choice between options (staff).', social: 'Service move; learner must understand it.', replies: ['choose_option', 'ask_recommendation'], variants: ['X or Y?', 'with or without X?', 'small or large?'], skills: ['request_drink', 'follow_directions'] }),
  intent({ key: 'choose_option', concept: 'request.choose', description: 'Choose one of the offered options.', social: 'Completes the order.', slots: ['choice'], expectsReply: false, replies: ['confirm_order'], variants: ['X please', 'the first one', 'without X'], skills: ['request_drink', 'express_preference'] }),
  intent({ key: 'specify_quantity', concept: 'request.quantity', description: 'Say how many or what size.', social: 'Completes a request.', slots: ['quantity'], expectsReply: false, variants: ['two', 'one of each', 'a large one', 'half a kilo'], skills: ['specify_quantity'] }),
  intent({ key: 'confirm_order', concept: 'offer.confirm', description: 'Confirm the order (staff or learner).', social: 'Closes the transaction stage.', polarity: 'positive', expectsReply: false, variants: ['ok, one X', 'coming right up', 'yes, that is right'], skills: ['confirm_understanding'] }),
  intent({ key: 'ask_recommendation', concept: 'request.recommendation', description: 'Ask what is good or recommended.', social: 'Shows trust; opens small talk.', replies: ['offer_options'], variants: ['what do you recommend', 'what is good here', 'what is the speciality'], skills: ['ask_recommendation'] }),
  intent({ key: 'ask_ingredients', concept: 'request.ingredients', description: 'Ask what is in a dish or whether it contains something.', social: 'Practical; may concern allergies.', slots: ['ingredient'], variants: ['is there X in it', 'what is in this', 'without meat?'], skills: ['order_food', 'ask_clarifying_question'] }),
  intent({ key: 'ask_for_bill', concept: 'pay.bill', description: 'Ask for the bill.', social: 'Signals end of the visit.', politeness: 'polite', replies: ['state_price'], variants: ['the bill please', 'how much do I owe', 'can we pay'], skills: ['ask_for_bill'] }),
  intent({ key: 'state_price', concept: 'pay.price_statement', description: 'State a price or total (staff/vendor).', social: 'Information; learner must understand numbers.', expectsReply: false, replies: ['pay', 'say_too_expensive'], variants: ['it is N', 'N total', 'that makes N'], skills: ['ask_price', 'ask_for_bill'] }),
  intent({ key: 'pay', concept: 'pay.pay', description: 'Hand over payment / say "here you are".', social: 'Completes the transaction.', expectsReply: false, replies: ['thank', 'give_change'], variants: ['here you are', 'by card?', 'keep the change'], skills: ['pay_and_check_change'] }),
  intent({ key: 'ask_payment_method', concept: 'pay.method', description: 'Ask whether card/cash is accepted.', social: 'Practical.', variants: ['card ok?', 'cash only?', 'can I pay by card'], skills: ['pay_and_check_change'] }),
  intent({ key: 'ask_for_change', concept: 'pay.change', description: 'Ask for change or check it.', social: 'Practical; polite tone expected.', replies: ['give_change'], variants: ['do you have change', 'the change please', 'that is not right (change)'], skills: ['pay_and_check_change'] }),
  intent({ key: 'give_change', concept: 'pay.change_reply', description: 'Give the change (vendor).', social: 'Service move.', expectsReply: false, variants: ['here is your change', 'N back'], skills: ['pay_and_check_change'] }),
  intent({ key: 'say_delicious', concept: 'evaluate.food_positive', description: 'Say the food/drink is good.', social: 'Compliment to host/staff.', polarity: 'positive', expectsReply: false, variants: ['delicious', 'very good', 'I like it a lot'], skills: ['compliment_and_respond', 'express_preference'] }),
  intent({ key: 'request_table', broader: ['ask_availability'], concept: 'request.table', description: 'Ask for a table for N people.', social: 'Opens a restaurant visit.', politeness: 'polite', slots: ['party_size'], replies: ['offer_options', 'say_unavailable'], variants: ['a table for two please', 'is there a table', 'we are three'], skills: ['ask_about_availability', 'specify_quantity'] }),
  intent({ key: 'say_unavailable', concept: 'offer.unavailable', description: 'Say something is not available (staff).', social: 'Service refusal; learner must react.', polarity: 'negative', expectsReply: false, replies: ['ask_alternative', 'accept_offer'], variants: ['we do not have X', 'it is finished', 'not today'], skills: ['respond_to_unexpected_question'] }),
  intent({ key: 'ask_alternative', concept: 'request.alternative', description: 'Ask for an alternative when something is unavailable.', social: 'Flexible, cooperative.', replies: ['offer_options'], variants: ['what else do you have', 'then a X', 'something similar?'], skills: ['respond_to_unexpected_question', 'ask_for_variant'] }),

  // --- shopping / market -------------------------------------------------------
  intent({ key: 'ask_price', concept: 'price.ask', description: 'Ask how much something costs.', social: 'Transactional; neutral.', slots: ['item'], replies: ['state_price'], variants: ['how much is this', 'what is the price of X', 'how much for two'], skills: ['ask_price'] }),
  intent({ key: 'say_too_expensive', concept: 'price.too_expensive', description: 'Say the price is too high.', social: 'Opens bargaining where appropriate; mild.', polarity: 'negative', replies: ['offer_lower_price', 'state_price'], variants: ['too expensive', 'that is a lot', 'expensive!'], skills: ['negotiate_price'] }),
  intent({ key: 'offer_lower_price', concept: 'price.counter', description: 'Propose a lower price.', social: 'Bargaining move; friendly tone expected.', slots: ['amount'], replies: ['agree_to_price', 'state_price'], variants: ['N and I take it', 'can you do N', 'a bit less please'], skills: ['negotiate_price'] }),
  intent({ key: 'ask_last_price', concept: 'price.last', description: 'Ask for the final/best price.', social: 'Signals readiness to buy.', replies: ['state_price'], variants: ['last price?', 'your best price', 'final?'], skills: ['negotiate_price'] }),
  intent({ key: 'agree_to_price', broader: ['accept_offer'], concept: 'price.agree', description: 'Agree to a price / decide to buy.', social: 'Closes bargaining positively.', polarity: 'positive', expectsReply: false, replies: ['thank', 'pay'], variants: ['ok, I take it', 'deal', 'fine, N'], skills: ['accept_offer', 'negotiate_price'] }),
  intent({ key: 'decline_purchase', broader: ['decline_offer'], concept: 'decline.purchase', description: 'Decline to buy.', social: 'Polite refusal.', polarity: 'negative', politeness: 'polite', expectsReply: false, variants: ['no thank you', 'maybe later', 'not today'], skills: ['decline_politely'] }),
  intent({ key: 'say_just_looking', concept: 'decline.just_looking', description: 'Say one is just looking.', social: 'Keeps the vendor at a distance politely.', expectsReply: false, variants: ['just looking', 'only browsing', 'I will come back'], skills: ['decline_politely'] }),
  intent({ key: 'ask_for_variant', concept: 'request.variant', description: 'Ask for another size, colour or kind.', social: 'Practical request.', slots: ['variant'], replies: ['offer_options', 'say_unavailable'], variants: ['do you have it in X', 'bigger?', 'another colour?'], skills: ['ask_for_variant'] }),
  intent({ key: 'accept_offer', concept: 'accept.generic', description: 'Accept an offer, suggestion or proposal.', social: 'Positive uptake.', polarity: 'positive', expectsReply: false, variants: ['yes please', 'ok', 'with pleasure'], skills: ['accept_offer'] }),
  intent({ key: 'decline_offer', concept: 'decline.generic', description: 'Decline an offer politely.', social: 'Refusal with softener.', polarity: 'negative', politeness: 'polite', expectsReply: false, variants: ['no thanks', 'I am fine, thank you', 'not for me'], skills: ['decline_politely'] }),

  // --- directions --------------------------------------------------------------
  intent({ key: 'ask_where_is', concept: 'directions.where', description: 'Ask where a place is.', social: 'Request for help; attention-getter expected first.', slots: ['place'], replies: ['give_direction_straight', 'give_direction_turn', 'say_it_is_far', 'say_it_is_near'], variants: ['where is X', 'is there a X near here', 'X, please?'], skills: ['ask_location'] }),
  intent({ key: 'ask_how_to_get', broader: ['ask_where_is'], concept: 'directions.how', description: 'Ask how to get somewhere.', social: 'Request for help.', slots: ['place'], replies: ['give_direction_straight', 'give_direction_turn'], variants: ['how do I get to X', 'which way to X', 'to go to X?'], skills: ['ask_location'] }),
  intent({ key: 'give_direction_straight', concept: 'directions.straight', description: 'Tell someone to go straight.', social: 'Helpful instruction.', expectsReply: false, replies: ['confirm_understood', 'ask_repeat'], variants: ['go straight', 'straight ahead', 'keep going'], skills: ['give_directions', 'follow_directions'] }),
  intent({ key: 'give_direction_turn', concept: 'directions.turn', description: 'Tell someone to turn left/right.', social: 'Helpful instruction.', slots: ['side'], expectsReply: false, replies: ['confirm_understood', 'ask_repeat'], variants: ['turn left', 'on the right', 'take the second left'], skills: ['give_directions', 'follow_directions'] }),
  intent({ key: 'ask_is_it_far', concept: 'directions.distance_question', description: 'Ask whether it is far or how long it takes.', social: 'Practical.', replies: ['say_it_is_far', 'say_it_is_near'], variants: ['is it far', 'how long on foot', 'how many minutes'], skills: ['ask_distance_or_time'] }),
  intent({ key: 'say_it_is_far', concept: 'directions.distance_reply', description: 'Say it is far.', social: 'Information; may suggest transport.', expectsReply: false, variants: ['it is far', 'take a taxi', 'twenty minutes'], skills: ['follow_directions'] }),
  intent({ key: 'say_it_is_near', concept: 'directions.distance_reply', description: 'Say it is near.', social: 'Reassuring information.', expectsReply: false, variants: ['very close', 'five minutes on foot', 'just there'], skills: ['follow_directions'] }),
  intent({ key: 'say_lost', concept: 'directions.lost', description: 'Say one is lost.', social: 'Request for help; vulnerability.', polarity: 'negative', replies: ['ask_where_is', 'give_direction_straight'], variants: ['I am lost', 'I cannot find X', 'where am I?'], skills: ['ask_location', 'report_problem'] }),
  intent({ key: 'ask_which_stop', concept: 'directions.stop', description: 'Ask which stop/station to get off at.', social: 'Practical transport request.', slots: ['place'], variants: ['which stop for X', 'where do I get off', 'is this the stop for X'], skills: ['buy_ticket', 'ask_location'] }),

  // --- transport ----------------------------------------------------------------
  intent({ key: 'hail_taxi', concept: 'transport.hail', description: 'Hail or call a taxi.', social: 'Attention request.', expectsReply: false, replies: ['ask_destination'], variants: ['taxi!', 'are you free', 'can you take me'], skills: ['use_taxi'] }),
  intent({ key: 'ask_destination', concept: 'transport.destination_question', description: 'Ask where the passenger wants to go (driver).', social: 'Service question the learner must understand.', replies: ['state_destination'], variants: ['where to', 'where are you going'], skills: ['use_taxi'] }),
  intent({ key: 'state_destination', concept: 'transport.destination', description: 'State the destination.', social: 'Core transactional move.', slots: ['place'], replies: ['state_price', 'confirm_order'], variants: ['to X please', 'X, please', 'take me to X'], skills: ['use_taxi'] }),
  intent({ key: 'ask_fare', concept: 'price.ask', description: 'Ask the fare.', social: 'Transactional; avoids surprises.', replies: ['state_price'], variants: ['how much to X', 'what is the fare', 'how much will it be'], skills: ['use_taxi', 'ask_price'] }),
  intent({ key: 'ask_use_meter', concept: 'transport.meter', description: 'Ask the driver to use the meter.', social: 'Assertive but polite; common local norm.', politeness: 'polite', expectsReply: false, replies: ['accept_offer', 'state_price'], variants: ['the meter please', 'can you put the meter on', 'with meter?'], skills: ['use_taxi'] }),
  intent({ key: 'say_stop_here', concept: 'transport.stop', description: 'Ask to stop here.', social: 'Instruction with softener.', politeness: 'polite', expectsReply: false, variants: ['stop here please', 'here is fine', 'just there'], skills: ['use_taxi'] }),
  intent({ key: 'buy_ticket', broader: ['request_item'], concept: 'request.ticket', description: 'Buy a ticket.', social: 'Transactional request.', politeness: 'polite', slots: ['destination'], optionalSlots: ['quantity', 'time', 'return'], replies: ['state_price', 'offer_options'], variants: ['one ticket to X', 'two to X please', 'a return to X'], skills: ['buy_ticket'] }),
  intent({ key: 'ask_departure_time', concept: 'time.departure', description: 'Ask when the next bus/train leaves.', social: 'Practical.', replies: ['tell_time'], variants: ['when is the next one', 'what time does it leave', 'next bus to X?'], skills: ['buy_ticket', 'tell_time'] }),

  // --- time ---------------------------------------------------------------------
  intent({ key: 'ask_time', concept: 'time.ask', description: 'Ask the time.', social: 'Neutral request to a stranger; attention-getter expected.', replies: ['tell_time'], variants: ['what time is it', 'do you have the time', 'the time please'], skills: ['tell_time'] }),
  intent({ key: 'tell_time', concept: 'time.tell', description: 'Say what time it is / when something happens.', social: 'Information.', slots: ['time'], expectsReply: false, variants: ['it is N', 'at N', 'around N'], skills: ['tell_time'] }),
  intent({ key: 'ask_opening_hours', concept: 'time.opening', description: 'Ask when a place opens/closes.', social: 'Practical.', replies: ['tell_time'], variants: ['what time do you open', 'are you open on Sunday', 'until when'], skills: ['ask_opening_hours'] }),

  // --- neighbours, invitations, plans ------------------------------------------
  intent({ key: 'say_new_neighbour', concept: 'intro.neighbour', description: 'Introduce oneself as a new neighbour.', social: 'Opens a long-term relationship; warmth matters.', polarity: 'positive', replies: ['welcome_someone', 'ask_name'], variants: ['I am your new neighbour', 'I just moved in', 'I live upstairs now'], skills: ['introduce_self', 'offer_help'] }),
  intent({ key: 'offer_help', concept: 'help.offer', description: 'Offer help.', social: 'Generous; typical neighbourly move.', polarity: 'positive', replies: ['accept_offer', 'decline_offer', 'thank'], variants: ['if you need anything, tell me', 'can I help', 'need a hand?'], skills: ['offer_help'] }),
  intent({ key: 'ask_small_favour', concept: 'help.request', description: 'Ask for a small favour.', social: 'Imposes lightly; softeners expected.', politeness: 'polite', slots: ['favour'], replies: ['accept_offer', 'decline_offer'], variants: ['could you X', 'would you mind X', 'can I borrow X'], skills: ['offer_help', 'request_item'] }),
  intent({ key: 'invite', concept: 'plans.invite', description: 'Invite someone (tea, meal, outing).', social: 'Hospitality / friendship move.', polarity: 'positive', slots: ['activity'], optionalSlots: ['time'], replies: ['accept_invitation', 'decline_invitation'], variants: ['come for tea', 'would you like to X', 'let us have X together'], skills: ['make_plans', 'offer_help'] }),
  intent({ key: 'accept_invitation', broader: ['accept_offer'], concept: 'plans.accept', description: 'Accept an invitation.', social: 'Warm uptake.', polarity: 'positive', expectsReply: false, replies: ['make_plan_time'], variants: ['with pleasure', 'yes, gladly', 'great idea'], skills: ['accept_decline_invitation'] }),
  intent({ key: 'decline_invitation', broader: ['decline_offer'], concept: 'plans.decline', description: 'Decline an invitation with a reason.', social: 'Refusal needs a softener and ideally a reason.', polarity: 'negative', politeness: 'polite', expectsReply: false, replies: ['suggest_other_time'], variants: ['sorry, I cannot, I work', 'another time?', 'thanks but not today'], skills: ['accept_decline_invitation'] }),
  intent({ key: 'suggest_activity', concept: 'plans.suggest', description: 'Suggest an activity.', social: 'Opens planning.', slots: ['activity'], replies: ['accept_offer', 'decline_offer', 'suggest_other_time'], variants: ['shall we X', 'how about X', 'let us X'], skills: ['make_plans'] }),
  intent({ key: 'make_plan_time', concept: 'plans.time', description: 'Propose or confirm a day/time.', social: 'Concretises a plan.', slots: ['time'], replies: ['confirm_plan', 'suggest_other_time'], variants: ['tomorrow at N?', 'Saturday is good', 'in the evening?'], skills: ['make_plans', 'tell_time'] }),
  intent({ key: 'suggest_other_time', concept: 'plans.reschedule', description: 'Propose another time.', social: 'Keeps the plan alive after a refusal.', slots: ['time'], replies: ['confirm_plan'], variants: ['what about Sunday', 'later maybe', 'next week?'], skills: ['make_plans', 'accept_decline_invitation'] }),
  intent({ key: 'confirm_plan', concept: 'plans.confirm', description: 'Confirm a plan.', social: 'Commits.', polarity: 'positive', expectsReply: false, variants: ['ok, see you then', 'agreed', 'perfect, Saturday'], skills: ['make_plans'] }),
  intent({ key: 'cancel_plan', broader: ['decline_invitation'], concept: 'plans.cancel', description: 'Cancel or postpone a plan with an apology.', social: 'Face-threatening; apology expected.', polarity: 'negative', politeness: 'polite', replies: ['accept_apology', 'suggest_other_time'], variants: ['sorry, I cannot come', 'can we postpone', 'something came up'], skills: ['accept_decline_invitation', 'apologise'] }),
  intent({ key: 'state_future_plan', concept: 'plans.future', description: 'Say what one is going to do.', social: 'Small talk / planning.', slots: ['activity'], expectsReply: false, variants: ['I will X', 'tomorrow I am going to X', 'next week I X'], skills: ['express_future_plan'] }),

  // --- family, work, routine ---------------------------------------------------
  intent({ key: 'ask_about_family', concept: 'family.ask', description: 'Ask about someone\'s family.', social: 'Warm interest; culturally central in many varieties.', replies: ['describe_family'], variants: ['do you have children', 'how is the family', 'brothers and sisters?'], skills: ['talk_about_family'] }),
  intent({ key: 'describe_family', concept: 'family.describe', description: 'Say who is in one\'s family.', social: 'Self-disclosure.', expectsReply: false, variants: ['I have two brothers', 'my parents live in X', 'I am married'], skills: ['talk_about_family'] }),
  intent({ key: 'ask_occupation', concept: 'work.ask', description: 'Ask what someone does.', social: 'Common introduction topic.', replies: ['describe_occupation'], variants: ['what do you do', 'where do you work', 'are you a student'], skills: ['describe_job'] }),
  intent({ key: 'describe_occupation', concept: 'work.describe', description: 'Say what one does for work or study.', social: 'Self-disclosure.', slots: ['occupation'], expectsReply: false, variants: ['I am a X', 'I work in X', 'I study X'], skills: ['describe_job'] }),
  intent({ key: 'describe_routine', concept: 'routine.describe', description: 'Describe a usual day.', social: 'Small talk; shows ability to sequence.', expectsReply: false, variants: ['I get up at N then X', 'in the morning I X', 'every day I X'], skills: ['describe_daily_routine'] }),

  // --- health & emergencies ------------------------------------------------------
  intent({ key: 'call_for_help', concept: 'emergency.help', description: 'Call for help urgently.', social: 'Urgent; politeness suspended.', polarity: 'negative', expectsReply: true, replies: ['ask_emergency_type'], variants: ['help!', 'somebody help', 'call an ambulance'], skills: ['ask_for_help_emergency'] }),
  intent({ key: 'ask_emergency_type', concept: 'emergency.type_question', description: 'Ask what happened (helper).', social: 'Helper move the learner must understand.', replies: ['say_emergency_type'], variants: ['what happened', 'what is wrong', 'are you hurt'], skills: ['ask_for_help_emergency'] }),
  intent({ key: 'say_emergency_type', concept: 'emergency.type', description: 'Say what kind of emergency it is.', social: 'Critical information.', slots: ['emergency'], expectsReply: false, variants: ['an accident', 'he is sick', 'there is a fire', 'I lost my bag'], skills: ['ask_for_help_emergency', 'report_problem'] }),
  intent({ key: 'ask_for_doctor_or_pharmacy', broader: ['ask_where_is'], concept: 'health.find_care', description: 'Ask for a doctor, pharmacy or hospital.', social: 'Request for help.', replies: ['give_direction_straight', 'give_direction_turn'], variants: ['is there a pharmacy near', 'I need a doctor', 'where is the hospital'], skills: ['describe_symptom', 'ask_location'] }),
  intent({ key: 'describe_pain', concept: 'health.symptom', description: 'Say where it hurts / what is wrong.', social: 'Self-report to helper.', slots: ['symptom'], expectsReply: false, variants: ['my head hurts', 'I have a fever', 'I feel sick'], skills: ['describe_symptom'] }),
  intent({ key: 'report_lost_item', concept: 'problem.lost', description: 'Report a lost item.', social: 'Request for help; needs details.', slots: ['item'], replies: ['ask_clarification'], variants: ['I lost my X', 'my X is gone', 'I cannot find my X'], skills: ['report_problem'] }),
  intent({ key: 'report_broken', concept: 'problem.broken', description: 'Report that something does not work.', social: 'Complaint with softener.', polarity: 'negative', slots: ['item'], replies: ['apologise', 'ask_clarification'], variants: ['the X does not work', 'X is broken', 'there is a problem with X'], skills: ['report_problem'] }),

  // --- opinions, feelings, preferences -------------------------------------------
  intent({ key: 'state_opinion', concept: 'opinion.state', description: 'State an opinion.', social: 'Positions oneself; hedging shows politeness.', slots: ['topic'], replies: ['agree', 'disagree_politely', 'ask_reason'], variants: ['I think X', 'in my view X', 'for me X is better'], skills: ['express_opinion'] }),
  intent({ key: 'ask_opinion', concept: 'opinion.ask', description: 'Ask someone\'s opinion.', social: 'Invites; respectful.', replies: ['state_opinion'], variants: ['what do you think', 'and you?', 'do you agree'], skills: ['express_opinion'] }),
  intent({ key: 'agree', concept: 'opinion.agree', description: 'Agree with someone.', social: 'Alignment.', polarity: 'positive', expectsReply: false, variants: ['I agree', 'exactly', 'you are right'], skills: ['agree_disagree'] }),
  intent({ key: 'disagree_politely', concept: 'opinion.disagree', description: 'Disagree politely.', social: 'Face-threatening; softener expected.', polarity: 'negative', politeness: 'polite', replies: ['give_reason', 'ask_reason'], variants: ['I am not sure about that', 'I see it differently', 'yes, but X'], skills: ['agree_disagree'] }),
  intent({ key: 'give_reason', concept: 'opinion.reason', description: 'Give a reason for an opinion.', social: 'Justifies; keeps the debate cooperative.', expectsReply: false, variants: ['because X', 'for example X', 'the reason is X'], skills: ['justify_opinion'] }),
  intent({ key: 'ask_reason', concept: 'opinion.reason_question', description: 'Ask why.', social: 'Probing; tone matters.', replies: ['give_reason'], variants: ['why', 'how come', 'why do you think so'], skills: ['justify_opinion', 'ask_clarifying_question'] }),
  intent({ key: 'express_like', concept: 'preference.like', description: 'Say one likes something.', social: 'Positive evaluation.', polarity: 'positive', slots: ['thing'], expectsReply: false, variants: ['I like X', 'I love X', 'X is great'], skills: ['express_preference'] }),
  intent({ key: 'express_dislike', concept: 'preference.dislike', description: 'Say one does not like something.', social: 'Negative evaluation; soften with hosts.', polarity: 'negative', slots: ['thing'], expectsReply: false, variants: ['I do not like X much', 'X is not my thing', 'I prefer Y'], skills: ['express_preference'] }),
  intent({ key: 'express_preference_between', concept: 'preference.choose', description: 'Say which of two one prefers.', social: 'Makes a choice.', slots: ['preferred'], expectsReply: false, variants: ['X rather than Y', 'I prefer X', 'X is better for me'], skills: ['express_preference'] }),
  intent({ key: 'express_feeling', concept: 'feeling.state', description: 'Say how one feels.', social: 'Self-disclosure; invites empathy.', slots: ['feeling'], expectsReply: false, replies: ['react_with_empathy'], variants: ['I am tired', 'I am happy today', 'I am a bit worried'], skills: ['express_feeling'] }),
  intent({ key: 'react_with_empathy', concept: 'feeling.react', description: 'React to someone\'s feeling.', social: 'Shows care.', polarity: 'positive', expectsReply: false, variants: ['oh, sorry to hear', 'great!', 'get some rest'], skills: ['express_feeling', 'respond_to_unexpected_question'] }),
  intent({ key: 'compliment', concept: 'compliment.give', description: 'Pay a compliment.', social: 'Positive face work; norms differ.', polarity: 'positive', replies: ['respond_to_compliment'], variants: ['nice X', 'you speak well', 'beautiful place'], skills: ['compliment_and_respond'] }),
  intent({ key: 'respond_to_compliment', concept: 'compliment.respond', description: 'Respond to a compliment.', social: 'Modesty or thanks depending on culture.', polarity: 'positive', expectsReply: false, variants: ['thank you', 'oh, not really', 'you too'], skills: ['compliment_and_respond'] }),
  intent({ key: 'small_talk_weather', concept: 'smalltalk.weather', description: 'Comment on the weather.', social: 'Safe phatic topic.', expectsReply: false, replies: ['agree', 'small_talk_weather'], variants: ['hot today', 'nice weather', 'it is raining a lot'], skills: ['make_small_talk_weather'] }),

  // --- narration & misc --------------------------------------------------------------
  intent({ key: 'narrate_past_event', concept: 'narrate.past', description: 'Tell what happened (short past narrative).', social: 'Shares experience; invites reaction.', expectsReply: true, replies: ['react_with_empathy', 'ask_reason'], variants: ['yesterday I X', 'last week we X', 'sequence of two or three past events'], skills: ['narrate_past_experience'] }),
  intent({ key: 'say_when_happened', concept: 'narrate.when', description: 'Say when something happened.', social: 'Anchors a narrative.', slots: ['time'], expectsReply: false, variants: ['yesterday', 'two days ago', 'last year'], skills: ['narrate_past_experience', 'tell_time'] }),
  intent({ key: 'ask_permission', concept: 'permission.ask', description: 'Ask permission.', social: 'Deferential; polite form expected.', politeness: 'polite', slots: ['action'], replies: ['grant_permission', 'refuse_permission'], variants: ['may I X', 'is it ok if I X', 'can I X?'], skills: ['use_appropriate_register', 'request_item'] }),
  intent({ key: 'grant_permission', concept: 'permission.grant', description: 'Grant permission.', social: 'Positive uptake.', polarity: 'positive', expectsReply: false, variants: ['of course', 'go ahead', 'no problem'], skills: ['accept_offer'] }),
  intent({ key: 'refuse_permission', concept: 'permission.refuse', description: 'Refuse permission politely.', social: 'Face-threatening; softener expected.', polarity: 'negative', politeness: 'polite', expectsReply: false, variants: ['sorry, not possible', 'better not', 'unfortunately no'], skills: ['decline_politely'] }),
  intent({ key: 'ask_availability', concept: 'availability.ask', description: 'Ask whether something is available (room, table, seat).', social: 'Transactional.', slots: ['thing'], replies: ['offer_options', 'say_unavailable'], variants: ['do you have a room for tonight', 'is this seat free', 'any tables?'], skills: ['ask_about_availability'] }),
  intent({ key: 'make_reservation', broader: ['ask_availability'], concept: 'availability.reserve', description: 'Make a reservation.', social: 'Transactional with details.', politeness: 'polite', slots: ['time', 'party_size'], replies: ['confirm_order', 'say_unavailable'], variants: ['a table for N at TIME', 'I would like to book X', 'reserve for DAY'], skills: ['reserve_or_book'] }),

  // --- intents that are recognised but rejected as learner targets -----------------
  intent({ key: 'bare_command', concept: 'request.item', description: 'A bare imperative request without any softener toward staff or strangers.', social: 'Sounds rude in most polite service contexts; recognised so the evaluator can flag register, never taught as a target.', politeness: 'casual', risk: 'rude', expectsReply: false, variants: ['give me X (no softener)', 'X! (shouted)'], skills: ['use_appropriate_register'] }),
  intent({ key: 'insult', concept: 'offence.insult', description: 'An insult or slur.', social: 'Destroys the interaction; never acceptable as a mission outcome.', polarity: 'negative', risk: 'offensive', expectsReply: false, variants: ['any insult', 'any slur'], skills: ['use_appropriate_register'] }),
];

export const INTENT_KEYS = INTENTS.map((i) => i.intentKey) as readonly string[];

const intentByKey = new Map(INTENTS.map((i) => [i.intentKey, i] as const));
const intentsByConcept = (() => {
  const m = new Map<string, CommunicativeIntent[]>();
  for (const i of INTENTS) m.set(i.conceptId, [...(m.get(i.conceptId) ?? []), i]);
  return m;
})();

/** Returns the intent for a key or throws when unknown. */
export function getIntent(intentKey: string): CommunicativeIntent {
  const found = intentByKey.get(intentKey);
  if (!found) throw new Error(`Unknown intent key: ${intentKey}`);
  return found;
}
export const findIntent = (intentKey: string): CommunicativeIntent | undefined => intentByKey.get(intentKey);
export const isIntentKey = (value: unknown): value is string => typeof value === 'string' && intentByKey.has(value);

/** All intents sharing a semantic concept id. */
export const intentsForConcept = (conceptId: string): readonly CommunicativeIntent[] => intentsByConcept.get(conceptId) ?? [];

/** Intents that give evidence for a skill. */
export const intentsForSkill = (skillKey: string): readonly CommunicativeIntent[] => INTENTS.filter((i) => i.skillKeys.includes(skillKey));

/**
 * True when an observed intent is a semantically acceptable realisation of an expected one:
 * same key; same concept with the same polarity; or a declared broader intent — always with
 * no higher social risk than `blunt`. (`request.item` paraphrased as `bare_command` is *not*
 * accepted: register matters, §3.4.)
 */
export function isAcceptableParaphrase(expectedIntentKey: string, observedIntentKey: string): boolean {
  if (expectedIntentKey === observedIntentKey) return true;
  const expected = findIntent(expectedIntentKey);
  const observed = findIntent(observedIntentKey);
  if (!expected || !observed) return false;
  if (observed.socialRisk === 'rude' || observed.socialRisk === 'offensive') return false;
  if (expected.broaderIntentKeys.includes(observedIntentKey)) return true;
  return expected.conceptId === observed.conceptId && expected.polarity === observed.polarity;
}

/** Validates referential integrity of the intent registry; returns problems (empty when valid). */
export function validateIntentRegistry(intents: readonly CommunicativeIntent[] = INTENTS): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const i of intents) {
    const parsed = CommunicativeIntentSchema.safeParse(i);
    if (!parsed.success) problems.push(`${i.intentKey}: ${parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
    if (keys.has(i.intentKey)) problems.push(`duplicate intent key ${i.intentKey}`);
    keys.add(i.intentKey);
  }
  for (const i of intents) {
    for (const r of i.responseConstraints.replyIntentKeys) if (!keys.has(r)) problems.push(`${i.intentKey}: unknown reply intent ${r}`);
    for (const b of i.broaderIntentKeys) if (!keys.has(b)) problems.push(`${i.intentKey}: unknown broader intent ${b}`);
    for (const s of i.skillKeys) if (!isSkillKey(s)) problems.push(`${i.intentKey}: unknown skill ${s}`);
  }
  return problems;
}
