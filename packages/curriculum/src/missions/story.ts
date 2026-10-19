/**
 * Story arcs and character relationship memory (§3.7, §3.8).
 *
 * Only *safe, concise* summaries are ever persisted: no raw transcripts, no contact
 * details, bounded length. Memory is per (enrollment, character) and updated from the
 * evaluator's `relationshipMemoryUpdate` / `summary` fields.
 */
import { z } from 'zod';
import { KeySchema, TimestamptzSchema, type EvaluatorOutput } from '@langquest/contracts';

// ---------------------------------------------------------------------------
// Story arcs
// ---------------------------------------------------------------------------

export const StoryMilestoneSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** Blueprint keys that must be completed (required objectives) to unlock. */
  requiresBlueprintKeys: z.array(KeySchema).min(1),
  /** Minimum mastery (as rank in MASTERY_ORDER) across `requiresSkillKeys`, if any. */
  requiresSkillKeys: z.array(KeySchema).default([]),
  minMasteryRank: z.number().int().min(0).max(4).default(2),
  /** Unlock key surfaced to the UI (`story.unlock.<key>`); purely cosmetic — no content is gated (§3.8). */
  unlockKey: z.string().min(1),
});
export type StoryMilestone = z.infer<typeof StoryMilestoneSchema>;

export const StoryChapterBlueprintSchema = z.object({
  key: KeySchema,
  titleKey: z.string().min(1),
  /** Ordered blueprint keys. */
  missionKeys: z.array(KeySchema).min(1),
  /** Character roles that recur through the chapter. */
  characterRoles: z.array(z.string()).min(1),
  milestone: StoryMilestoneSchema.nullable().default(null),
});
export type StoryChapterBlueprint = z.infer<typeof StoryChapterBlueprintSchema>;

export const StoryArcBlueprintSchema = z.object({
  key: KeySchema,
  titleKey: z.string().min(1),
  chapters: z.array(StoryChapterBlueprintSchema).min(1),
});
export type StoryArcBlueprint = z.infer<typeof StoryArcBlueprintSchema>;

/** The default first-arc structure every track instantiates (language-independent). */
export const DEFAULT_STORY_ARC: StoryArcBlueprint = StoryArcBlueprintSchema.parse({
  key: 'arrival',
  titleKey: 'story.arrival.title',
  chapters: [
    {
      key: 'arrival_first_days',
      titleKey: 'story.arrival.chapter1.title',
      missionKeys: ['greet_and_introduce', 'cafe_order_drink', 'market_ask_price', 'ask_directions', 'meet_neighbour', 'take_taxi'],
      characterRoles: ['friendly local acquaintance', 'café server', 'market vendor', 'passer-by', 'neighbour', 'taxi driver'],
      milestone: { id: 'settled_in', requiresBlueprintKeys: ['greet_and_introduce', 'cafe_order_drink', 'ask_directions'], requiresSkillKeys: ['greet_politely', 'request_item'], minMasteryRank: 2, unlockKey: 'neighbourhood_map' },
    },
    {
      key: 'arrival_settling_in',
      titleKey: 'story.arrival.chapter2.title',
      missionKeys: ['restaurant_order_meal', 'shop_for_clothes', 'buy_train_ticket', 'emergency_ask_help', 'talk_about_family', 'make_weekend_plans'],
      characterRoles: ['waiter', 'shop assistant', 'ticket clerk', 'helpful bystander', 'host', 'friend'],
      milestone: { id: 'local_friend', requiresBlueprintKeys: ['meet_neighbour', 'make_weekend_plans'], requiresSkillKeys: ['make_plans'], minMasteryRank: 2, unlockKey: 'weekend_scene' },
    },
    {
      key: 'arrival_finding_voice',
      titleKey: 'story.arrival.chapter3.title',
      missionKeys: ['describe_your_day', 'talk_about_work', 'friendly_debate', 'tell_a_story'],
      characterRoles: ['colleague', 'team lead', 'opinionated friend', 'curious friend'],
      milestone: { id: 'own_voice', requiresBlueprintKeys: ['friendly_debate', 'tell_a_story'], requiresSkillKeys: ['express_opinion', 'narrate_past_experience'], minMasteryRank: 3, unlockKey: 'city_panorama' },
    },
  ],
});

/** Evaluate which milestones are unlocked given completed blueprints and mastery ranks. */
export function unlockedMilestones(
  arc: StoryArcBlueprint,
  completedBlueprintKeys: ReadonlySet<string>,
  masteryRankBySkill: ReadonlyMap<string, number>,
): StoryMilestone[] {
  const out: StoryMilestone[] = [];
  for (const chapter of arc.chapters) {
    const m = chapter.milestone;
    if (!m) continue;
    const missionsDone = m.requiresBlueprintKeys.every((k) => completedBlueprintKeys.has(k));
    const skillsOk = m.requiresSkillKeys.every((k) => (masteryRankBySkill.get(k) ?? 0) >= m.minMasteryRank);
    if (missionsDone && skillsOk) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relationship memory
// ---------------------------------------------------------------------------

export const MAX_MEMORY_FACTS = 12;
export const MAX_FACT_LENGTH = 160;
export const MAX_SUMMARY_LENGTH = 400;

export const RelationshipMemorySchema = z.object({
  enrollmentId: z.string().min(1),
  characterKey: KeySchema,
  /** -1..1, moves slowly; never used to punish the learner. */
  rapport: z.number().min(-1).max(1),
  encounters: z.number().int().min(0),
  /** Short, learner-safe facts the character "remembers" (e.g. "learner is from Canada"). */
  facts: z.array(z.object({ text: z.string().max(MAX_FACT_LENGTH), learnedAt: TimestamptzSchema, source: z.enum(['evaluator', 'branch', 'editor']) })).max(MAX_MEMORY_FACTS),
  /** Last concise story summary (what happened, what is pending). */
  lastSummary: z.string().max(MAX_SUMMARY_LENGTH).nullable(),
  lastInteractionAt: TimestamptzSchema.nullable(),
});
export type RelationshipMemory = z.infer<typeof RelationshipMemorySchema>;

export const emptyRelationshipMemory = (enrollmentId: string, characterKey: string): RelationshipMemory => ({
  enrollmentId,
  characterKey,
  rapport: 0,
  encounters: 0,
  facts: [],
  lastSummary: null,
  lastInteractionAt: null,
});

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const URL = /https?:\/\/\S+/gi;
const LONG_NUMBER = /\b\d{6,}\b/g;
const QUOTED_TRANSCRIPT = /["“«][^"”»]{120,}["”»]/g;

/**
 * Make free text safe for persistence: strips contact details, long numbers, URLs and
 * long quoted passages (raw transcript leakage), collapses whitespace and bounds length.
 */
export function sanitizeForMemory(text: string, maxLength = MAX_SUMMARY_LENGTH): string {
  const cleaned = text
    .replace(URL, '[link]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[number]')
    .replace(LONG_NUMBER, '[number]')
    .replace(QUOTED_TRANSCRIPT, '[quote omitted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  const cut = cleaned.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface MemoryUpdateInput {
  evaluation: Pick<EvaluatorOutput, 'summary' | 'relationshipMemoryUpdate' | 'objectivesCompleted' | 'confidence'>;
  /** Memory notes emitted by branch rules that fired. */
  branchNotes?: readonly string[];
  /** Number of required objectives in the mission (for rapport delta). */
  requiredObjectiveCount: number;
  now: string;
}

/**
 * Apply a conversation's evaluation to relationship memory. Pure; returns a new object.
 * Rapport moves by at most ±0.15 per encounter and only on confident evaluations.
 */
export function applyRelationshipUpdate(memory: RelationshipMemory, input: MemoryUpdateInput): RelationshipMemory {
  const { evaluation, branchNotes = [], requiredObjectiveCount, now } = input;
  const facts = [...memory.facts];
  const push = (text: string, source: 'evaluator' | 'branch') => {
    const clean = sanitizeForMemory(text, MAX_FACT_LENGTH);
    if (!clean || facts.some((f) => f.text === clean)) return;
    facts.push({ text: clean, learnedAt: now, source });
  };
  if (evaluation.relationshipMemoryUpdate) push(evaluation.relationshipMemoryUpdate, 'evaluator');
  for (const n of branchNotes) push(n, 'branch');
  while (facts.length > MAX_MEMORY_FACTS) facts.shift();

  const completion = requiredObjectiveCount > 0 ? Math.min(1, evaluation.objectivesCompleted.length / requiredObjectiveCount) : 1;
  const confident = (evaluation.confidence ?? 0) >= 0.5;
  const delta = confident ? (completion - 0.5) * 0.3 : 0; // -0.15..+0.15
  return {
    ...memory,
    rapport: Math.max(-1, Math.min(1, memory.rapport + delta)),
    encounters: memory.encounters + 1,
    facts,
    lastSummary: sanitizeForMemory(evaluation.summary) || memory.lastSummary,
    lastInteractionAt: now,
  };
}

/** Concise, prompt-ready memory digest for the character agent (bounded, no transcripts). */
export function memoryDigest(memory: RelationshipMemory, maxFacts = 6): string {
  const tone = memory.rapport > 0.3 ? 'warm' : memory.rapport < -0.3 ? 'reserved' : 'neutral';
  const facts = memory.facts.slice(-maxFacts).map((f) => `- ${f.text}`);
  const lines = [`encounters: ${memory.encounters}; rapport: ${tone}`, ...facts];
  if (memory.lastSummary) lines.push(`last time: ${memory.lastSummary}`);
  return lines.join('\n');
}
