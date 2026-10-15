/**
 * Registry of reusable communicative skills (spec §3.4, §2.2).
 *
 * Skills are language-independent units of "can do" ability such as `greet_politely`
 * or `repair_misunderstanding`. Every course track realises the same skills with its
 * own expressions; mastery (see `mastery/`) is tracked per (enrollment, skill).
 *
 * CEFR alignment is descriptive only — the product never claims certification.
 */
import { z } from 'zod';
import { CefrLevelSchema, KeySchema, UnitIntervalSchema, type CefrLevel } from '@langquest/contracts';

/** Situational tags used to group skills, intents, scenarios and missions. */
export const SITUATION_TAG_VALUES = [
  'introductions',
  'small_talk',
  'cafe',
  'restaurant',
  'shopping',
  'market',
  'directions',
  'transport',
  'travel',
  'housing',
  'neighbours',
  'family',
  'work',
  'plans',
  'daily_life',
  'health',
  'emergencies',
  'phone',
  'numbers_time',
  'feelings',
  'opinions',
  'debates',
  'story',
  'repair_misunderstanding',
  'ask_to_slow_down',
  'politeness',
] as const;
export const SituationTagSchema = z.enum(SITUATION_TAG_VALUES);
export type SituationTag = z.infer<typeof SituationTagSchema>;

/** Evidence dimensions a skill is primarily judged on (§3.4). */
export const SKILL_EVIDENCE_FOCUS_VALUES = ['listening', 'production', 'semantic', 'register', 'repair', 'narration'] as const;
export const SkillEvidenceFocusSchema = z.enum(SKILL_EVIDENCE_FOCUS_VALUES);
export type SkillEvidenceFocus = z.infer<typeof SkillEvidenceFocusSchema>;

export const SkillSchema = z.object({
  /** Stable snake_case key, never renamed (`skills.skill_key`). */
  skillKey: KeySchema,
  /** Short English descriptor for editors; learner-facing text lives in locale catalogs under `skill.<key>`. */
  descriptor: z.string().min(1),
  /** CEFR can-do band this skill aligns with (descriptive, not a certification). */
  cefrCanDo: CefrLevelSchema,
  /** Can-do statement in the style of the CEFR descriptors. */
  canDoStatement: z.string().min(1),
  /** 0..1 relative difficulty used by the planner and the scheduler's initial difficulty. */
  difficulty: UnitIntervalSchema,
  /** Skills that should normally be at least `practiced` before this one is introduced. */
  prerequisites: z.array(KeySchema),
  situations: z.array(SituationTagSchema).min(1),
  evidenceFocus: z.array(SkillEvidenceFocusSchema).min(1),
});
export type Skill = z.infer<typeof SkillSchema>;

const cefrDifficultyFloor: Record<CefrLevel, number> = { A1: 0.05, A2: 0.3, B1: 0.5, B2: 0.7, C1: 0.85, C2: 0.95 };

const skill = (
  skillKey: string,
  descriptor: string,
  cefrCanDo: CefrLevel,
  canDoStatement: string,
  situations: SituationTag[],
  options: { difficulty?: number; prerequisites?: string[]; evidenceFocus?: SkillEvidenceFocus[] } = {},
): Skill => ({
  skillKey,
  descriptor,
  cefrCanDo,
  canDoStatement,
  difficulty: options.difficulty ?? cefrDifficultyFloor[cefrCanDo] + 0.1,
  prerequisites: options.prerequisites ?? [],
  situations,
  evidenceFocus: options.evidenceFocus ?? ['production', 'semantic'],
});

/** All reusable communicative skills. Order is editorial (roughly by introduction order). */
export const SKILLS: readonly Skill[] = [
  // --- greetings & introductions -------------------------------------------
  skill('greet_politely', 'Greet someone politely', 'A1', 'Can greet people appropriately for the time of day and setting.', ['introductions', 'politeness'], { difficulty: 0.05, evidenceFocus: ['production', 'register'] }),
  skill('respond_to_greeting', 'Respond to a greeting', 'A1', 'Can return a greeting and answer "how are you" with a short formula.', ['introductions', 'small_talk'], { difficulty: 0.08, prerequisites: ['greet_politely'], evidenceFocus: ['listening', 'production'] }),
  skill('introduce_self', 'Introduce yourself', 'A1', 'Can say their name and one or two basic facts about themselves.', ['introductions'], { difficulty: 0.1, prerequisites: ['greet_politely'] }),
  skill('ask_name', 'Ask someone their name', 'A1', 'Can ask a new acquaintance their name and react to the answer.', ['introductions'], { difficulty: 0.1, prerequisites: ['introduce_self'] }),
  skill('say_where_from', 'Say where you are from', 'A1', 'Can say which country or city they come from.', ['introductions', 'small_talk'], { difficulty: 0.12 }),
  skill('ask_where_from', 'Ask where someone is from', 'A1', 'Can ask where someone is from and understand a short answer.', ['introductions', 'small_talk'], { difficulty: 0.14, prerequisites: ['say_where_from'], evidenceFocus: ['listening', 'production'] }),
  skill('take_leave', 'Say goodbye appropriately', 'A1', 'Can end an encounter with a suitable leave-taking formula.', ['introductions', 'politeness'], { difficulty: 0.08 }),
  skill('thank_and_respond', 'Thank someone and respond to thanks', 'A1', 'Can thank people and reply when thanked.', ['politeness', 'cafe', 'shopping'], { difficulty: 0.06, evidenceFocus: ['production', 'register'] }),
  skill('apologise', 'Apologise or get attention politely', 'A1', 'Can apologise and attract attention politely ("excuse me").', ['politeness', 'daily_life'], { difficulty: 0.1 }),
  skill('use_appropriate_register', 'Choose polite vs casual forms', 'A2', 'Can choose between polite and casual forms depending on the person addressed.', ['politeness', 'introductions', 'work'], { difficulty: 0.35, prerequisites: ['greet_politely', 'thank_and_respond'], evidenceFocus: ['register'] }),

  // --- repair & meta-communication ----------------------------------------
  skill('ask_to_repeat', 'Ask someone to repeat', 'A1', 'Can ask a speaker to repeat what they said.', ['repair_misunderstanding'], { difficulty: 0.1, evidenceFocus: ['repair', 'production'] }),
  skill('ask_to_slow_down', 'Ask someone to speak more slowly', 'A1', 'Can ask a speaker to slow down.', ['ask_to_slow_down', 'repair_misunderstanding'], { difficulty: 0.1, evidenceFocus: ['repair', 'production'] }),
  skill('say_dont_understand', 'Say you did not understand', 'A1', 'Can signal non-understanding without ending the conversation.', ['repair_misunderstanding'], { difficulty: 0.1, evidenceFocus: ['repair'] }),
  skill('ask_meaning', 'Ask what a word means', 'A1', 'Can ask what a word or phrase means and how to say something.', ['repair_misunderstanding'], { difficulty: 0.15, prerequisites: ['say_dont_understand'], evidenceFocus: ['repair'] }),
  skill('confirm_understanding', 'Confirm you understood', 'A2', 'Can confirm understanding by repeating back or paraphrasing key information.', ['repair_misunderstanding', 'directions'], { difficulty: 0.3, prerequisites: ['ask_to_repeat'], evidenceFocus: ['listening', 'repair'] }),
  skill('repair_misunderstanding', 'Repair a misunderstanding', 'A2', 'Can notice and fix a misunderstanding by rephrasing or correcting.', ['repair_misunderstanding'], { difficulty: 0.4, prerequisites: ['say_dont_understand', 'ask_meaning'], evidenceFocus: ['repair', 'semantic'] }),
  skill('ask_clarifying_question', 'Ask a clarifying question', 'A2', 'Can ask a short question to clarify what is wanted or meant.', ['repair_misunderstanding', 'work'], { difficulty: 0.38, prerequisites: ['confirm_understanding'], evidenceFocus: ['repair', 'listening'] }),
  skill('respond_to_unexpected_question', 'Handle an unexpected question', 'A2', 'Can react to a question they did not anticipate, even with a partial answer or a request for clarification.', ['small_talk', 'repair_misunderstanding'], { difficulty: 0.42, prerequisites: ['ask_clarifying_question'], evidenceFocus: ['listening', 'production', 'repair'] }),
  skill('handle_code_switch', 'Handle natural code-switching', 'A2', 'Can follow and use culturally natural mixing of languages where the target variety does so.', ['daily_life', 'small_talk'], { difficulty: 0.4, prerequisites: ['say_dont_understand'], evidenceFocus: ['listening', 'register'] }),

  // --- cafe / restaurant ---------------------------------------------------
  skill('request_item', 'Request an item politely', 'A1', 'Can ask for a specific item using a polite request form.', ['cafe', 'shopping', 'restaurant'], { difficulty: 0.12, prerequisites: ['greet_politely'] }),
  skill('request_drink', 'Order a drink', 'A1', 'Can order a drink and choose between simple options.', ['cafe', 'restaurant'], { difficulty: 0.14, prerequisites: ['request_item'] }),
  skill('order_food', 'Order food', 'A1', 'Can order a dish and answer simple questions about the order.', ['restaurant'], { difficulty: 0.2, prerequisites: ['request_item'] }),
  skill('specify_quantity', 'Specify a quantity or size', 'A1', 'Can say how many or what size they want.', ['cafe', 'shopping', 'market', 'numbers_time'], { difficulty: 0.18, prerequisites: ['request_item'] }),
  skill('express_preference', 'Express a simple preference', 'A1', 'Can say what they like, prefer or would rather have.', ['cafe', 'restaurant', 'small_talk'], { difficulty: 0.2 }),
  skill('ask_for_bill', 'Ask for the bill', 'A1', 'Can ask for the bill and understand the amount.', ['cafe', 'restaurant', 'numbers_time'], { difficulty: 0.18, prerequisites: ['request_item'], evidenceFocus: ['production', 'listening'] }),
  skill('pay_and_check_change', 'Pay and check change', 'A2', 'Can handle paying, asking about payment methods and checking change.', ['cafe', 'shopping', 'transport', 'numbers_time'], { difficulty: 0.32, prerequisites: ['ask_for_bill', 'specify_quantity'], evidenceFocus: ['listening', 'production'] }),
  skill('ask_recommendation', 'Ask for a recommendation', 'A2', 'Can ask what is good or recommended and react to the suggestion.', ['cafe', 'restaurant', 'shopping'], { difficulty: 0.34, prerequisites: ['request_item'] }),

  // --- shopping / market ---------------------------------------------------
  skill('ask_price', 'Ask the price', 'A1', 'Can ask how much something costs and understand a price.', ['shopping', 'market', 'numbers_time'], { difficulty: 0.14, evidenceFocus: ['production', 'listening'] }),
  skill('negotiate_price', 'Negotiate a price', 'A2', 'Can comment that something is expensive and propose a lower price where culturally appropriate.', ['market', 'shopping'], { difficulty: 0.4, prerequisites: ['ask_price', 'decline_politely'], evidenceFocus: ['production', 'register'] }),
  skill('decline_politely', 'Decline politely', 'A1', 'Can refuse an offer or item without being rude.', ['shopping', 'market', 'cafe', 'politeness'], { difficulty: 0.16, evidenceFocus: ['production', 'register'] }),
  skill('accept_offer', 'Accept an offer', 'A1', 'Can accept an offer, suggestion or price.', ['shopping', 'market', 'plans'], { difficulty: 0.12 }),
  skill('ask_for_variant', 'Ask for another size, colour or kind', 'A2', 'Can ask whether something exists in another size, colour or type.', ['shopping'], { difficulty: 0.33, prerequisites: ['request_item', 'ask_price'] }),

  // --- directions / transport ---------------------------------------------
  skill('ask_location', 'Ask where something is', 'A1', 'Can ask where a place is.', ['directions', 'travel'], { difficulty: 0.14, prerequisites: ['apologise'] }),
  skill('follow_directions', 'Follow simple directions', 'A1', 'Can understand short directions such as straight, left, right, near, far.', ['directions'], { difficulty: 0.2, prerequisites: ['ask_location'], evidenceFocus: ['listening'] }),
  skill('give_directions', 'Give simple directions', 'A2', 'Can tell someone how to get to a nearby place.', ['directions', 'neighbours'], { difficulty: 0.36, prerequisites: ['follow_directions'] }),
  skill('ask_distance_or_time', 'Ask how far or how long', 'A1', 'Can ask how far a place is or how long it takes to get there.', ['directions', 'transport', 'numbers_time'], { difficulty: 0.2, prerequisites: ['ask_location'] }),
  skill('use_taxi', 'Take a taxi', 'A2', 'Can hail a taxi, state a destination, ask the fare and ask to stop.', ['transport', 'travel'], { difficulty: 0.3, prerequisites: ['ask_price', 'ask_location'] }),
  skill('buy_ticket', 'Buy a ticket', 'A2', 'Can buy a ticket, specifying destination, number and time.', ['transport', 'travel', 'numbers_time'], { difficulty: 0.32, prerequisites: ['request_item', 'specify_quantity'] }),
  skill('ask_opening_hours', 'Ask about opening hours', 'A2', 'Can ask when a place opens or closes and understand clock times.', ['shopping', 'travel', 'numbers_time'], { difficulty: 0.3, prerequisites: ['tell_time'], evidenceFocus: ['listening', 'production'] }),
  skill('tell_time', 'Tell and ask the time', 'A1', 'Can ask and say what time it is.', ['numbers_time', 'daily_life'], { difficulty: 0.18 }),

  // --- social: neighbours, plans, family, work ----------------------------
  skill('make_plans', 'Make simple plans', 'A2', 'Can suggest an activity, propose a time and confirm a plan.', ['plans', 'neighbours', 'small_talk'], { difficulty: 0.36, prerequisites: ['tell_time', 'accept_offer'] }),
  skill('accept_decline_invitation', 'Accept or decline an invitation', 'A2', 'Can accept an invitation warmly or decline it with a reason.', ['plans', 'neighbours', 'politeness'], { difficulty: 0.32, prerequisites: ['decline_politely', 'accept_offer'], evidenceFocus: ['production', 'register'] }),
  skill('offer_help', 'Offer or ask for small help', 'A2', 'Can offer help to a neighbour or ask for a small favour.', ['neighbours', 'housing', 'daily_life'], { difficulty: 0.3, prerequisites: ['introduce_self'] }),
  skill('describe_daily_routine', 'Describe a daily routine', 'A2', 'Can describe what they usually do during the day.', ['daily_life', 'small_talk'], { difficulty: 0.34, prerequisites: ['tell_time'], evidenceFocus: ['production', 'narration'] }),
  skill('talk_about_family', 'Talk about family', 'A2', 'Can say who is in their family and ask about someone else\'s.', ['family', 'small_talk'], { difficulty: 0.3, prerequisites: ['introduce_self'] }),
  skill('describe_job', 'Talk about work or study', 'A2', 'Can say what they do and ask about someone\'s occupation.', ['work', 'introductions'], { difficulty: 0.3, prerequisites: ['introduce_self'] }),
  skill('make_small_talk_weather', 'Make small talk about the weather', 'A1', 'Can comment on the weather and react to a comment.', ['small_talk'], { difficulty: 0.16 }),
  skill('compliment_and_respond', 'Give and receive a compliment', 'A2', 'Can pay a simple compliment and respond to one appropriately.', ['small_talk', 'politeness'], { difficulty: 0.32, prerequisites: ['thank_and_respond'], evidenceFocus: ['production', 'register'] }),
  skill('ask_about_availability', 'Ask whether something is available', 'A2', 'Can ask whether a table, room or item is available.', ['restaurant', 'travel', 'housing'], { difficulty: 0.3, prerequisites: ['request_item'] }),
  skill('reserve_or_book', 'Make a reservation', 'A2', 'Can book a table or room, giving a day, time and number of people.', ['restaurant', 'travel', 'phone'], { difficulty: 0.4, prerequisites: ['ask_about_availability', 'tell_time'] }),

  // --- feelings, opinions, debates ----------------------------------------
  skill('express_feeling', 'Express how you feel', 'A2', 'Can say how they feel (tired, happy, worried) and ask others.', ['feelings', 'small_talk'], { difficulty: 0.3 }),
  skill('express_opinion', 'Express an opinion', 'B1', 'Can state an opinion on a familiar topic.', ['opinions', 'debates'], { difficulty: 0.55, prerequisites: ['express_preference'] }),
  skill('agree_disagree', 'Agree or disagree politely', 'B1', 'Can agree or disagree with someone without causing offence.', ['opinions', 'debates', 'politeness'], { difficulty: 0.55, prerequisites: ['express_opinion'], evidenceFocus: ['production', 'register'] }),
  skill('justify_opinion', 'Justify an opinion', 'B1', 'Can give a reason or example that supports their opinion.', ['debates', 'opinions'], { difficulty: 0.62, prerequisites: ['express_opinion'], evidenceFocus: ['production', 'narration'] }),
  skill('narrate_past_experience', 'Narrate a past experience', 'B1', 'Can tell a short story about something that happened to them.', ['story', 'small_talk'], { difficulty: 0.6, prerequisites: ['describe_daily_routine'], evidenceFocus: ['narration', 'production'] }),
  skill('express_future_plan', 'Talk about future plans', 'A2', 'Can say what they are going to do and ask about others\' plans.', ['plans', 'small_talk'], { difficulty: 0.38, prerequisites: ['make_plans'] }),

  // --- health & emergencies -----------------------------------------------
  skill('ask_for_help_emergency', 'Ask for help in an emergency', 'A1', 'Can call for help and say what kind of help is needed.', ['emergencies'], { difficulty: 0.2, evidenceFocus: ['production'] }),
  skill('describe_symptom', 'Describe a simple symptom', 'A2', 'Can say where it hurts or what is wrong and ask for a pharmacy or doctor.', ['health', 'emergencies'], { difficulty: 0.36, prerequisites: ['ask_for_help_emergency', 'ask_location'] }),
  skill('report_problem', 'Report a problem or lost item', 'A2', 'Can report a problem (lost item, broken thing) and answer simple questions about it.', ['emergencies', 'travel', 'housing'], { difficulty: 0.4, prerequisites: ['say_dont_understand', 'describe_symptom'] }),
];

export const SKILL_KEYS = SKILLS.map((s) => s.skillKey) as readonly string[];

const skillByKey = new Map(SKILLS.map((s) => [s.skillKey, s] as const));

/** Returns the skill for a key or throws when unknown. */
export function getSkill(skillKey: string): Skill {
  const found = skillByKey.get(skillKey);
  if (!found) throw new Error(`Unknown skill key: ${skillKey}`);
  return found;
}

/** Returns the skill for a key or `undefined`. */
export const findSkill = (skillKey: string): Skill | undefined => skillByKey.get(skillKey);

export const isSkillKey = (value: unknown): value is string => typeof value === 'string' && skillByKey.has(value);

/** Skills tagged with a situation (e.g. all `restaurant` skills). */
export const skillsForSituation = (tag: SituationTag): readonly Skill[] => SKILLS.filter((s) => s.situations.includes(tag));

/** Skills at or below a CEFR band. */
export const skillsUpToCefr = (level: CefrLevel): readonly Skill[] => {
  const order: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const max = order.indexOf(level);
  return SKILLS.filter((s) => order.indexOf(s.cefrCanDo) <= max);
};

/**
 * Transitive prerequisites of a skill (excluding itself), in dependency order.
 * Throws on unknown keys; cycles are impossible by registry test.
 */
export function prerequisiteClosure(skillKey: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (key: string) => {
    for (const p of getSkill(key).prerequisites) {
      if (!seen.has(p)) {
        seen.add(p);
        visit(p);
        out.push(p);
      }
    }
  };
  visit(skillKey);
  return out;
}

/** Validates referential integrity and acyclicity of the registry; returns problems (empty when valid). */
export function validateSkillRegistry(skills: readonly Skill[] = SKILLS): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const s of skills) {
    const parsed = SkillSchema.safeParse(s);
    if (!parsed.success) problems.push(`${s.skillKey}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    if (keys.has(s.skillKey)) problems.push(`duplicate skill key ${s.skillKey}`);
    keys.add(s.skillKey);
  }
  for (const s of skills) {
    for (const p of s.prerequisites) if (!keys.has(p)) problems.push(`${s.skillKey}: unknown prerequisite ${p}`);
  }
  // cycle detection (DFS with colours)
  const colour = new Map<string, 'grey' | 'black'>();
  const byKey = new Map(skills.map((s) => [s.skillKey, s] as const));
  const visit = (key: string, path: string[]): void => {
    const c = colour.get(key);
    if (c === 'black') return;
    if (c === 'grey') {
      problems.push(`prerequisite cycle: ${[...path, key].join(' -> ')}`);
      return;
    }
    colour.set(key, 'grey');
    for (const p of byKey.get(key)?.prerequisites ?? []) if (byKey.has(p)) visit(p, [...path, key]);
    colour.set(key, 'black');
  };
  for (const s of skills) visit(s.skillKey, []);
  return problems;
}
