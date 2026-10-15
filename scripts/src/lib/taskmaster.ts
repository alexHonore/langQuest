/**
 * Taskmaster-1 (2019, CC BY 4.0) pattern extraction (spec §9.3).
 *
 * We extract *structure*, never text to publish: per domain, the distribution of turn counts,
 * the order in which slots get filled, abstract dialogue-act sequences (request → offer →
 * choose → confirm…), clarification/revision/unavailability rates. The result is a scenario
 * skeleton that the content factory and native writers use as a brief for new in-dialect
 * dialogues (§9.3: never mechanically translate English dialogues).
 *
 * Raw utterance text stays in `data/raw/`; only act labels, slot names and counts leave here.
 */
import { z } from 'zod';
import { INTENTS, findBlueprint } from '@langquest/curriculum';

export interface TmUtterance {
  index: number;
  speaker: 'USER' | 'ASSISTANT';
  text: string;
  segments?: Array<{ start_index: number; end_index: number; text: string; annotations: Array<{ name: string }> }>;
}
export interface TmDialog {
  conversation_id: string;
  instruction_id: string;
  utterances: TmUtterance[];
}

export const TmDialogSchema = z.object({
  conversation_id: z.string(),
  instruction_id: z.string(),
  utterances: z.array(
    z.object({
      index: z.number(),
      speaker: z.enum(['USER', 'ASSISTANT']),
      text: z.string(),
      segments: z.array(z.object({ start_index: z.number(), end_index: z.number(), text: z.string(), annotations: z.array(z.object({ name: z.string() })) })).optional(),
    }),
  ),
});

/** Canonical Taskmaster domain ids. */
export const TM_DOMAINS = ['coffee-ordering', 'restaurant-table', 'pizza-ordering', 'uber-lyft', 'movie-tickets', 'auto-repair-appt'] as const;
export type TmDomain = (typeof TM_DOMAINS)[number];

const DOMAIN_ALIASES: Readonly<Record<string, TmDomain>> = {
  'coffee-ordering': 'coffee-ordering',
  coffee: 'coffee-ordering',
  'restaurant-table': 'restaurant-table',
  restaurant: 'restaurant-table',
  'pizza-ordering': 'pizza-ordering',
  pizza: 'pizza-ordering',
  'uber-lyft': 'uber-lyft',
  'uber_lyft': 'uber-lyft',
  uber: 'uber-lyft',
  'movie-tickets': 'movie-tickets',
  'movie-ticket': 'movie-tickets',
  movie: 'movie-tickets',
  'auto-repair-appt': 'auto-repair-appt',
  'auto-repair': 'auto-repair-appt',
  auto: 'auto-repair-appt',
};

/** `movie-tickets-2` → `movie-tickets`; unknown → null. */
export function domainOf(instructionId: string): TmDomain | null {
  const base = instructionId.replace(/[-_ ]?\d+$/, '').toLowerCase();
  return DOMAIN_ALIASES[base] ?? null;
}

/** How a Taskmaster domain relates to LangQuest blueprints/intents (language-neutral). */
export interface DomainMapping {
  domain: TmDomain;
  blueprintKey: string | null;
  situation: string;
  intentKeys: string[];
  note: string;
}

export const DOMAIN_MAPPINGS: readonly DomainMapping[] = [
  { domain: 'coffee-ordering', blueprintKey: 'cafe_order_drink', situation: 'cafe', intentKeys: ['greet_hello', 'request_drink', 'offer_options', 'choose_option', 'specify_quantity', 'confirm_order', 'state_price', 'pay', 'thank'], note: 'Drink + size + customisation slots; staff offer options the learner must answer.' },
  { domain: 'restaurant-table', blueprintKey: 'restaurant_order_meal', situation: 'restaurant', intentKeys: ['greet_hello', 'make_reservation', 'request_table', 'ask_availability', 'make_plan_time', 'suggest_other_time', 'confirm_plan', 'thank'], note: 'Reservation flow: party size, time, unavailability → alternative time.' },
  { domain: 'pizza-ordering', blueprintKey: 'restaurant_order_meal', situation: 'restaurant', intentKeys: ['request_food', 'choose_option', 'specify_quantity', 'ask_price', 'ask_ingredients', 'confirm_order', 'say_unavailable', 'ask_alternative'], note: 'Multi-item order with sizes/toppings; unavailable item → alternative.' },
  { domain: 'uber-lyft', blueprintKey: 'take_taxi', situation: 'transport', intentKeys: ['hail_taxi', 'state_destination', 'ask_fare', 'ask_is_it_far', 'make_plan_time', 'confirm_plan', 'thank'], note: 'Pickup/destination/ride type; price and duration estimates offered by the service.' },
  { domain: 'movie-tickets', blueprintKey: 'buy_train_ticket', situation: 'travel', intentKeys: ['buy_ticket', 'specify_quantity', 'ask_time', 'tell_time', 'choose_option', 'ask_price', 'confirm_order', 'say_unavailable'], note: 'Ticket purchase: title/venue/time/quantity; closest LangQuest blueprint is the ticket-counter mission.' },
  { domain: 'auto-repair-appt', blueprintKey: null, situation: 'daily_life', intentKeys: ['report_broken', 'make_reservation', 'ask_availability', 'make_plan_time', 'suggest_other_time', 'confirm_plan', 'ask_price'], note: 'Service appointment: problem description + scheduling; no chapter-1 blueprint yet (chapter-3 candidate).' },
];

export type DialogAct =
  | 'user.greet' | 'user.request' | 'user.provide_slot' | 'user.ask' | 'user.accept' | 'user.reject' | 'user.revise' | 'user.ack' | 'user.thank' | 'user.say'
  | 'assistant.greet' | 'assistant.ask' | 'assistant.offer' | 'assistant.unavailable' | 'assistant.confirm' | 'assistant.ack' | 'assistant.say';

const GREET_RE = /^(hi|hello|hey|good (morning|afternoon|evening))\b/i;
const THANK_RE = /\b(thank you|thanks)\b/i;
const REVISE_RE = /\b(actually|wait|instead|change (that|it|my)|never ?mind|scratch that|on second thought)\b/i;
const UNAVAILABLE_RE = /\b(sorry|unfortunately|not available|sold out|don't have|do not have|no longer|fully booked|isn't available|is not available)\b/i;
const CONFIRM_RE = /\b(confirmed|all set|you're all set|booked|placed|your order|order is|reservation is|has been (placed|booked|made|confirmed)|i've (booked|placed|confirmed))\b/i;
const ACK_RE = /^(ok(ay)?|sure|yes|yeah|yep|great|perfect|alright|all right|sounds good|got it|no problem)[.!,]?\s*$/i;
const REQUEST_RE = /\b(i('d| would) like|i want|can i (get|have)|could i (get|have)|i need|book|order|reserve)\b/i;

/** Normalise an annotation name: strip the domain prefix and accept/reject suffix. */
export function parseAnnotation(name: string): { slot: string; act: 'accept' | 'reject' | null } {
  const parts = name.split('.');
  let act: 'accept' | 'reject' | null = null;
  const last = parts[parts.length - 1];
  if (last === 'accept' || last === 'reject') {
    act = last;
    parts.pop();
  }
  // First segment is the domain (`movie_ticket`, `coffee_order`...).
  const slot = parts.length > 1 ? parts.slice(1).join('.') : parts.join('.');
  return { slot, act };
}

/** Abstract one utterance into a dialogue act + the slots it mentions. Text never leaves. */
export function actOf(u: TmUtterance): { act: DialogAct; slots: string[] } {
  const slots: string[] = [];
  let accept = false;
  let reject = false;
  for (const seg of u.segments ?? []) for (const ann of seg.annotations) {
    const { slot, act } = parseAnnotation(ann.name);
    if (slot && !slots.includes(slot)) slots.push(slot);
    if (act === 'accept') accept = true;
    if (act === 'reject') reject = true;
  }
  const text = u.text.trim();
  const isQuestion = text.endsWith('?');
  if (u.speaker === 'USER') {
    if (REVISE_RE.test(text)) return { act: 'user.revise', slots };
    if (reject) return { act: 'user.reject', slots };
    if (accept) return { act: 'user.accept', slots };
    if (THANK_RE.test(text) && text.split(/\s+/).length <= 6) return { act: 'user.thank', slots };
    if (GREET_RE.test(text) && text.split(/\s+/).length <= 8) return { act: 'user.greet', slots };
    if (isQuestion) return { act: 'user.ask', slots };
    if (REQUEST_RE.test(text) && slots.length) return { act: 'user.request', slots };
    if (slots.length) return { act: 'user.provide_slot', slots };
    if (ACK_RE.test(text)) return { act: 'user.ack', slots };
    return { act: 'user.say', slots };
  }
  if (UNAVAILABLE_RE.test(text)) return { act: 'assistant.unavailable', slots };
  if (CONFIRM_RE.test(text)) return { act: 'assistant.confirm', slots };
  if (GREET_RE.test(text) && text.split(/\s+/).length <= 10) return { act: 'assistant.greet', slots };
  if (isQuestion) return { act: 'assistant.ask', slots };
  if (slots.length) return { act: 'assistant.offer', slots };
  if (ACK_RE.test(text)) return { act: 'assistant.ack', slots };
  return { act: 'assistant.say', slots };
}

export interface DialogPattern {
  domain: TmDomain;
  turnCount: number;
  acts: DialogAct[];
  /** Slots in order of first mention. */
  slotOrder: string[];
  revisions: number;
  unavailable: number;
  clarifications: number;
}

/** Extract the pattern of one dialogue. */
export function extractPattern(dialog: TmDialog): DialogPattern | null {
  const domain = domainOf(dialog.instruction_id);
  if (!domain) return null;
  const acts: DialogAct[] = [];
  const slotOrder: string[] = [];
  let revisions = 0;
  let unavailable = 0;
  let clarifications = 0;
  const sorted = [...dialog.utterances].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i += 1) {
    const u = sorted[i]!;
    const { act, slots } = actOf(u);
    acts.push(act);
    for (const s of slots) if (!slotOrder.includes(s)) slotOrder.push(s);
    if (act === 'user.revise') revisions += 1;
    if (act === 'assistant.unavailable') unavailable += 1;
    if (act === 'user.ask' && (sorted[i - 1] ? actOf(sorted[i - 1]!).act.startsWith('assistant.offer') || actOf(sorted[i - 1]!).act === 'assistant.ask' : false)) clarifications += 1;
  }
  return { domain, turnCount: sorted.length, acts, slotOrder, revisions, unavailable, clarifications };
}

/** Collapse consecutive duplicates and cut to `max` acts for readable sequence patterns. */
export function condenseActs(acts: readonly DialogAct[], max = 12): string {
  const out: DialogAct[] = [];
  for (const a of acts) if (out[out.length - 1] !== a) out.push(a);
  return out.slice(0, max).join(' > ');
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const percentile = (sorted: number[], q: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0);

export const ScenarioSkeletonSchema = z.object({
  domain: z.enum(TM_DOMAINS),
  blueprintKey: z.string().nullable(),
  situation: z.string(),
  intentKeys: z.array(z.string()),
  note: z.string(),
  sampleSize: z.number().int(),
  turnCount: z.object({ min: z.number(), p50: z.number(), mean: z.number(), p90: z.number(), max: z.number() }),
  slots: z.object({ required: z.array(z.string()), optional: z.array(z.string()), mentionRatePct: z.record(z.string(), z.number()) }),
  slotOrderPatterns: z.array(z.object({ order: z.array(z.string()), count: z.number() })),
  actSequencePatterns: z.array(z.object({ sequence: z.string(), count: z.number() })),
  rates: z.object({ revisionPct: z.number(), unavailablePct: z.number(), clarificationPct: z.number(), userQuestionPct: z.number() }),
  /** Language-neutral writing brief derived from the patterns. */
  brief: z.array(z.string()),
});
export type ScenarioSkeleton = z.infer<typeof ScenarioSkeletonSchema>;

export interface Ontology {
  [key: string]: { id: string; vertical: string; required: string[]; optional: string[] };
}

/** Aggregate per-domain skeletons from extracted patterns + the ontology. */
export function buildSkeletons(patterns: readonly DialogPattern[], ontology: Ontology | null, topN = 8): ScenarioSkeleton[] {
  const skeletons: ScenarioSkeleton[] = [];
  for (const mapping of DOMAIN_MAPPINGS) {
    const rows = patterns.filter((p) => p.domain === mapping.domain);
    if (!rows.length) continue;
    const turns = rows.map((r) => r.turnCount).sort((a, b) => a - b);
    const onto = ontology ? Object.entries(ontology).find(([key, o]) => DOMAIN_ALIASES[key] === mapping.domain || DOMAIN_ALIASES[o.id] === mapping.domain || DOMAIN_ALIASES[o.id.replace(/_/g, '-')] === mapping.domain)?.[1] ?? null : null;
    const slotMentions = new Map<string, number>();
    const orderCounts = new Map<string, number>();
    const seqCounts = new Map<string, number>();
    let userTurns = 0;
    let userQuestions = 0;
    for (const r of rows) {
      for (const s of r.slotOrder) slotMentions.set(s, (slotMentions.get(s) ?? 0) + 1);
      const orderKey = r.slotOrder.slice(0, 5).join('|');
      if (orderKey) orderCounts.set(orderKey, (orderCounts.get(orderKey) ?? 0) + 1);
      const seq = condenseActs(r.acts);
      seqCounts.set(seq, (seqCounts.get(seq) ?? 0) + 1);
      for (const a of r.acts) {
        if (a.startsWith('user.')) userTurns += 1;
        if (a === 'user.ask') userQuestions += 1;
      }
    }
    const top = <T,>(m: Map<string, number>, f: (k: string, c: number) => T): T[] => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k, c]) => f(k, c));
    const rates = {
      revisionPct: pct(rows.filter((r) => r.revisions > 0).length, rows.length),
      unavailablePct: pct(rows.filter((r) => r.unavailable > 0).length, rows.length),
      clarificationPct: pct(rows.filter((r) => r.clarifications > 0).length, rows.length),
      userQuestionPct: pct(userQuestions, userTurns),
    };
    const mentionRatePct: Record<string, number> = {};
    for (const [s, n] of [...slotMentions.entries()].sort((a, b) => b[1] - a[1])) mentionRatePct[s] = pct(n, rows.length);
    const mean = Math.round((turns.reduce((a, b) => a + b, 0) / turns.length) * 10) / 10;
    const bp = mapping.blueprintKey ? findBlueprint(mapping.blueprintKey) : null;
    const brief = [
      `Write ${Math.max(4, Math.round(percentile(turns, 0.5) / 2))}–${Math.max(6, Math.round(percentile(turns, 0.9) / 2))} exchanges; real ${mapping.domain.replace(/-/g, ' ')} dialogues run ${percentile(turns, 0.5)} turns at the median.`,
      `Fill slots in a natural order (most common: ${[...orderCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.replace(/\|/g, ' → ') ?? 'n/a'}); the staff character asks for missing ones.`,
      `${rates.unavailablePct}% of dialogues hit something unavailable → the character must offer an alternative, the learner must choose or decline.`,
      `${rates.revisionPct}% contain a learner revision ("actually…"); include at least one twist where the learner changes a slot.`,
      `${rates.clarificationPct}% contain a clarification question after an offer; keep the character's offers short enough to answer.`,
      bp ? `LangQuest blueprint ${bp.key}: objectives ${bp.objectives.map((o) => o.id).join(', ')}; learner role "${bp.learnerRole}", character role "${bp.characterRole}".` : 'No chapter-1 blueprint mapped; use as a chapter-3 scenario brief.',
      'Do not translate Taskmaster turns. Generate or commission native-language turns from this structure and have a native reviewer judge naturalness (§9.3).',
    ];
    skeletons.push({
      domain: mapping.domain,
      blueprintKey: mapping.blueprintKey,
      situation: mapping.situation,
      intentKeys: mapping.intentKeys.filter((k) => INTENTS.some((i) => i.intentKey === k)),
      note: mapping.note,
      sampleSize: rows.length,
      turnCount: { min: turns[0] ?? 0, p50: percentile(turns, 0.5), mean, p90: percentile(turns, 0.9), max: turns[turns.length - 1] ?? 0 },
      slots: { required: onto?.required ?? [], optional: onto?.optional ?? [], mentionRatePct },
      slotOrderPatterns: top(orderCounts, (k, c) => ({ order: k.split('|'), count: c })),
      actSequencePatterns: top(seqCounts, (k, c) => ({ sequence: k, count: c })),
      rates,
      brief,
    });
  }
  return skeletons;
}

/** CC BY 4.0 attribution record for Taskmaster-1 (README copyright notice). */
export const TASKMASTER_ATTRIBUTION = {
  dataset: 'Taskmaster-1 (TM-1-2019)',
  publisher: 'Google LLC (google-research-datasets/Taskmaster)',
  authors: ['Bill Byrne', 'Karthik Krishnamoorthi', 'Chinnadhurai Sankar', 'Arvind Neelakantan', 'Amit Dubey', 'Kyu-Young Kim', 'Andy Cedilnik'],
  licenseId: 'CC-BY',
  licenseVersion: '4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  sourceUrl: 'https://github.com/google-research-datasets/Taskmaster',
  citation: 'Byrne et al., "Taskmaster-1: Toward a Realistic and Diverse Dialog Dataset", EMNLP-IJCNLP 2019, Hong Kong.',
  usage: 'Dialogue structure patterns only (turn counts, slot order, abstract dialogue acts). No utterance text is redistributed. Attribution must accompany any derived scenario skeleton.',
  commercialRedistribution: true,
  attributionRequired: true,
  attributionText: 'Dialogue structure patterns derived from Taskmaster-1 (Byrne et al., 2019), Google LLC, CC BY 4.0.',
} as const;
