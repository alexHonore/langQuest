/**
 * Mission ↔ character casting (owner decision 2026-10-19: roles correlate with lesson content).
 *
 * A blueprint (or a seed mission) states who should naturally carry the conversation:
 *  - `preferredCharacterIntents` — curriculum intents the interlocutor's everyday life produces
 *    (the cast's `intents`, derived from its situation tags in `@langquest/ui`);
 *  - `preferredAgeBands` — a kid asks for an ice cream, an adult or elder gives directions;
 *  - `preferredRoles` — lowercase role words matched against the character's role text
 *    (`café`, `vendor`, `taxi`, `neighbour`…).
 *
 * `castForMission()` ranks a roster deterministically and returns the best fit — or `null`,
 * honestly, when nobody in the variety fits (no role word and fewer than half of the preferred
 * intents): the manifest then lists no character for the mission instead of a wrong one.
 *
 * The package does not depend on `@langquest/ui`: the roster is any list of {@link CastMember}
 * (`@langquest/db/seed/cast-roster` projects `CHARACTER_ROSTER` into that shape).
 */
import { z } from 'zod';
import { KeySchema } from '@langquest/contracts';
import { isIntentKey } from '../intents';
import type { MissionBlueprint } from './blueprint';

/** Casting age band (child 6–11, teen 12–17, adult, elder 65+) — mirrors `@langquest/ui` `AgeBand`. */
export const AGE_BAND_VALUES = ['child', 'teen', 'adult', 'elder'] as const;
export const AgeBandSchema = z.enum(AGE_BAND_VALUES);
export type AgeBand = z.infer<typeof AgeBandSchema>;

export const MissionCastingSchema = z.object({
  /** Intents the interlocutor should carry (curriculum intent keys). Empty = no intent preference. */
  preferredCharacterIntents: z.array(KeySchema).default([]),
  /** Age bands that fit the scene (first = most natural). Empty = any age. */
  preferredAgeBands: z.array(AgeBandSchema).default([]),
  /** Lowercase role words matched against the character's role text. Empty = any role. */
  preferredRoles: z.array(z.string().min(1)).default([]),
});
export type MissionCasting = z.infer<typeof MissionCastingSchema>;
export type MissionCastingInput = z.input<typeof MissionCastingSchema>;

/** Minimal roster entry the resolver needs (structural: `LangQuestCharacter` of `@langquest/ui` satisfies it). */
export interface CastMember {
  /** Roster slug (`characters.character_key`). */
  id: string;
  /** `characters.id` (deterministic uuid) when known. */
  characterId?: string;
  name?: string;
  role: string;
  varietyId: string;
  ageBand: AgeBand;
  genderPresentation?: 'feminine' | 'masculine';
  regionalOption?: string | null;
  /** Curriculum intent keys the character naturally produces. */
  intents: readonly string[];
  /** Free-text situation tags (documentation / reasons only). */
  situations?: readonly string[];
}

export type CastFit = 'pinned' | 'role' | 'intents' | 'fallback' | 'none';

export interface RankedCastMember {
  member: CastMember;
  score: number;
  fit: Exclude<CastFit, 'pinned' | 'none'>;
  /** Share of `preferredCharacterIntents` the member carries (0–1; 1 when none are preferred). */
  intentCoverage: number;
  roleMatched: boolean;
  ageMatched: boolean;
  reasons: string[];
}

export interface CastResult {
  /** The chosen character, or `null` when nobody fits and fallbacks are not allowed. */
  character: CastMember | null;
  fit: CastFit;
  /** The casting preferences that were applied (blueprint defaults merged with overrides). */
  casting: MissionCasting;
  ranked: RankedCastMember[];
  reasons: string[];
}

export interface CastOptions {
  /** Only members of this variety are considered (never cross a variety boundary). */
  varietyId?: string;
  /** Regional option of the enrollment / chapter; a matching character ranks slightly higher. */
  regionalOption?: string | null;
  /** Members already cast in the chapter; reused members are ranked lower so a chapter gets a varied cast. */
  alreadyCast?: ReadonlyMap<string, number> | ReadonlySet<string>;
  /** Explicit roster id (slug or uuid) that overrides ranking when it exists in the roster. */
  pinnedCharacterId?: string | null;
  /** When true, the best-ranked member is returned even without a role word / intent coverage (`fit: 'fallback'`). */
  allowFallback?: boolean;
}

/** Scoring weights (one place to tune; tests pin the ordering, not the numbers). */
export const CASTING_WEIGHTS = { role: 3, intents: 4, age: 2, region: 0.5, reusePenalty: 1 } as const;
/** Minimum share of preferred intents for an intent-only fit. */
export const CASTING_MIN_INTENT_COVERAGE = 0.5;

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Whether a role word matches a character's role text (diacritics- and case-insensitive, whole-word or prefix). */
export function roleMatches(roleText: string, roleWords: readonly string[]): string | null {
  const text = fold(roleText);
  for (const word of roleWords) {
    const w = fold(word).trim();
    if (!w) continue;
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (re.test(text)) return word;
  }
  return null;
}

/** Blueprint casting defaults merged with per-mission overrides (an override replaces the field it sets). */
export function missionCasting(bp: Pick<MissionBlueprint, 'preferredCharacterIntents' | 'preferredAgeBands' | 'preferredRoles'>, override?: Partial<MissionCastingInput> | null): MissionCasting {
  return MissionCastingSchema.parse({
    preferredCharacterIntents: override?.preferredCharacterIntents ?? bp.preferredCharacterIntents,
    preferredAgeBands: override?.preferredAgeBands ?? bp.preferredAgeBands,
    preferredRoles: override?.preferredRoles ?? bp.preferredRoles,
  });
}

/** Referential check of casting preferences; empty when valid. */
export function validateCasting(c: MissionCasting): string[] {
  const problems: string[] = [];
  for (const k of c.preferredCharacterIntents) if (!isIntentKey(k)) problems.push(`unknown preferred character intent ${k}`);
  return problems;
}

const reuseCount = (already: CastOptions['alreadyCast'], id: string): number => {
  if (!already) return 0;
  if (already instanceof Map) return already.get(id) ?? 0;
  return (already as ReadonlySet<string>).has(id) ? 1 : 0;
};

/** Rank every eligible roster member for the casting preferences. Deterministic (score, then roster order). */
export function rankCast(casting: MissionCasting, roster: readonly CastMember[], options: CastOptions = {}): RankedCastMember[] {
  const preferredIntents = new Set(casting.preferredCharacterIntents);
  const ranked: RankedCastMember[] = [];
  roster.forEach((member, index) => {
    if (options.varietyId && member.varietyId !== options.varietyId) return;
    const reasons: string[] = [];
    const roleWord = roleMatches(member.role, casting.preferredRoles);
    const roleMatched = roleWord !== null;
    if (roleMatched) reasons.push(`role "${member.role}" matches "${roleWord}"`);
    const carried = preferredIntents.size ? [...preferredIntents].filter((k) => member.intents.includes(k)) : [];
    const intentCoverage = preferredIntents.size ? carried.length / preferredIntents.size : 1;
    if (preferredIntents.size) reasons.push(`carries ${carried.length}/${preferredIntents.size} preferred intents`);
    const ageMatched = casting.preferredAgeBands.length === 0 || casting.preferredAgeBands.includes(member.ageBand);
    if (casting.preferredAgeBands.length) reasons.push(ageMatched ? `age band ${member.ageBand} fits` : `age band ${member.ageBand} outside ${casting.preferredAgeBands.join('/')}`);
    const regionMatched = Boolean(options.regionalOption && member.regionalOption === options.regionalOption);
    if (regionMatched) reasons.push(`regional option ${options.regionalOption}`);
    const reuse = reuseCount(options.alreadyCast, member.id);
    if (reuse) reasons.push(`already cast ${reuse}× in this chapter`);
    const ageOrder = casting.preferredAgeBands.indexOf(member.ageBand);
    const score =
      (roleMatched ? CASTING_WEIGHTS.role : 0) +
      CASTING_WEIGHTS.intents * intentCoverage +
      (ageMatched ? CASTING_WEIGHTS.age - (ageOrder > 0 ? 0.1 * ageOrder : 0) : -CASTING_WEIGHTS.age) +
      (regionMatched ? CASTING_WEIGHTS.region : 0) -
      CASTING_WEIGHTS.reusePenalty * reuse -
      index * 1e-6;
    const fit: RankedCastMember['fit'] = roleMatched ? 'role' : preferredIntents.size && intentCoverage >= CASTING_MIN_INTENT_COVERAGE ? 'intents' : 'fallback';
    ranked.push({ member, score: Math.round(score * 1e6) / 1e6, fit, intentCoverage, roleMatched, ageMatched, reasons });
  });
  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * Pick the character for a mission. `mission` is a blueprint (its casting defaults) or a
 * `{ blueprint, casting?, rosterCharacterId? }` seed-style request. Pure and deterministic.
 */
export function castForMission(
  mission: MissionBlueprint | { blueprint: MissionBlueprint; casting?: Partial<MissionCastingInput> | null; rosterCharacterId?: string | null },
  roster: readonly CastMember[],
  options: CastOptions = {},
): CastResult {
  const bp = 'blueprint' in mission ? mission.blueprint : mission;
  const override = 'blueprint' in mission ? (mission.casting ?? null) : null;
  const pinnedId = options.pinnedCharacterId ?? ('blueprint' in mission ? (mission.rosterCharacterId ?? null) : null);
  const casting = missionCasting(bp, override);
  const ranked = rankCast(casting, roster, options);
  if (pinnedId) {
    const pinned = ranked.find((r) => r.member.id === pinnedId || r.member.characterId === pinnedId);
    if (pinned) return { character: pinned.member, fit: 'pinned', casting, ranked, reasons: [`pinned to ${pinned.member.id}`, ...pinned.reasons] };
  }
  const best = ranked[0];
  if (!best) return { character: null, fit: 'none', casting, ranked, reasons: [options.varietyId ? `no character of variety ${options.varietyId} in the roster` : 'empty roster'] };
  if (best.fit === 'fallback' && !options.allowFallback) {
    return { character: null, fit: 'none', casting, ranked, reasons: [`nobody carries the scene (best: ${best.member.id} — ${best.reasons.join(', ') || 'no match'})`] };
  }
  return { character: best.member, fit: best.fit, casting, ranked, reasons: best.reasons };
}

export interface ChapterCastRequest {
  /** Mission key within the chapter (seed `SeedMission.key`). */
  key: string;
  blueprint: MissionBlueprint;
  casting?: Partial<MissionCastingInput> | null;
  rosterCharacterId?: string | null;
}

/**
 * Cast a whole chapter in mission order: each mission is resolved with the members already
 * cast ranked lower, so six missions get a varied cast when the variety has enough people
 * (a character may still recur when nobody else fits — honest, not random).
 */
export function castChapter(missions: readonly ChapterCastRequest[], roster: readonly CastMember[], options: Omit<CastOptions, 'alreadyCast' | 'pinnedCharacterId'> = {}): Map<string, CastResult> {
  const used = new Map<string, number>();
  const out = new Map<string, CastResult>();
  for (const m of missions) {
    const result = castForMission({ blueprint: m.blueprint, casting: m.casting ?? null, rosterCharacterId: m.rosterCharacterId ?? null }, roster, { ...options, alreadyCast: used });
    if (result.character) used.set(result.character.id, (used.get(result.character.id) ?? 0) + 1);
    out.set(m.key, result);
  }
  return out;
}
