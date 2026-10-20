/**
 * The character roster — 97 original, fictional interlocutors across the 30 course
 * tracks (≥ 3 per track), diverse in age, gender presentation and skin tone, with
 * roles that correlate with lesson situations. Casting rules live in
 * `docs/design/character-casting.md`.
 *
 * Order: the 16 characters of the first roster keep their original positions (the
 * database seed and the asset manifest are generated in roster order), then the
 * 2026-10-19 expansion grouped by region.
 */
import type { CourseTrackId, VarietyId } from '@langquest/contracts';
import { AFRICA_CAST } from './roster/africa';
import { AMERICAS_CAST } from './roster/americas';
import { ASIA_CAST } from './roster/asia';
import { EUROPE_CAST } from './roster/europe';
import { MENA_CAST } from './roster/mena';
import { type SituationTag, isSituationTag } from './situations';
import type { LangQuestCharacter } from './types';

/** Ids of the first (2026-10-14) roster, in their original order; their uuids never change. */
export const LEGACY_ROSTER_IDS: readonly string[] = [
  'ary-cafe-staff-nadia',
  'ary-neighbour-youssef',
  'es-es-coworker-marta',
  'es-419-market-vendor-rafael',
  'ja-neighbour-haruka',
  'ko-classmate-minjun',
  'uk-friend-oksana',
  'pt-br-host-thiago',
  'pt-pt-pharmacist-ines',
  'arz-taxi-driver-samir',
  'ar-levant-shopkeeper-rima',
  'yue-teahouse-staff-ka-yan',
  'ht-teacher-manouchka',
  'sw-matatu-conductor-brian',
  'rw-guide-aline',
  'ln-musician-didier',
];

const ALL_CAST: readonly LangQuestCharacter[] = [
  ...MENA_CAST,
  ...ASIA_CAST,
  ...EUROPE_CAST,
  ...AMERICAS_CAST,
  ...AFRICA_CAST,
];

const bySlug = new Map(ALL_CAST.map((c) => [c.id, c] as const));
const legacy = new Set(LEGACY_ROSTER_IDS);

/** The character roster (legacy order first, then the expansion by region). */
export const CHARACTER_ROSTER: readonly LangQuestCharacter[] = [
  ...LEGACY_ROSTER_IDS.map((id) => {
    const c = bySlug.get(id);
    if (!c) throw new Error(`Legacy roster character missing: ${id}`);
    return c;
  }),
  ...ALL_CAST.filter((c) => !legacy.has(c.id)),
];

const rosterById = new Map<string, LangQuestCharacter>();
for (const c of CHARACTER_ROSTER) {
  rosterById.set(c.id, c);
  rosterById.set(c.characterId, c);
}

/** Look up a character by slug id or by its stable UUID. */
export function findCharacter(characterId: string): LangQuestCharacter | undefined {
  return rosterById.get(characterId);
}

/** Characters whose variety matches (never crosses variety boundaries). */
export function charactersForVariety(varietyId: VarietyId): LangQuestCharacter[] {
  return CHARACTER_ROSTER.filter((c) => c.varietyId === varietyId);
}

/** Characters cast for a course track (a track's cast is its variety's cast). */
export function charactersForTrack(trackId: CourseTrackId): LangQuestCharacter[] {
  return CHARACTER_ROSTER.filter((c) => c.trackIds.includes(trackId));
}

/**
 * Characters of one variety whose everyday situations naturally produce a curriculum
 * intent (`@langquest/curriculum` intent key). Never crosses variety boundaries; returns
 * `[]` when nobody in the variety carries the intent (the caller falls back to
 * `charactersForVariety`).
 */
export function charactersForIntent(varietyId: VarietyId, intentId: string): LangQuestCharacter[] {
  return CHARACTER_ROSTER.filter((c) => c.varietyId === varietyId && c.intents.includes(intentId));
}

/** Characters of one variety carrying a situation tag (unknown tags yield `[]`). */
export function charactersForSituation(varietyId: VarietyId, tag: string): LangQuestCharacter[] {
  if (!isSituationTag(tag)) return [];
  const t: SituationTag = tag;
  return CHARACTER_ROSTER.filter((c) => c.varietyId === varietyId && c.situations.includes(t));
}

/* ------------------------------------------------- Mission ↔ cast matching --- */

/** A character reference accepted by the mission helpers: roster entry, slug id or stable uuid. */
export type CharacterRef = LangQuestCharacter | string;

function resolveCharacter(ref: CharacterRef): LangQuestCharacter | undefined {
  return typeof ref === 'string' ? findCharacter(ref) : ref;
}

/**
 * The mission's intents this character's everyday situations produce, in mission order
 * (duplicates in the mission list are kept once). `[]` for an unknown character.
 */
export function missionIntentsCovered(
  missionIntents: readonly string[],
  character: CharacterRef,
): string[] {
  const c = resolveCharacter(character);
  if (!c) return [];
  const carried = new Set(c.intents);
  const out: string[] = [];
  for (const key of missionIntents) if (carried.has(key) && !out.includes(key)) out.push(key);
  return out;
}

/**
 * Does the character's role match the mission ("cast roles must match missions")?
 *
 * True when at least one of the mission's intent keys (`steps[].validIntentIds`, flattened
 * with {@link missionIntentKeys}) is produced by the character's situations. A mission that
 * declares no intents constrains nobody (true for any known character); an unknown
 * character (id not in the roster) never matches.
 */
export function castMatchesMission(
  missionIntents: readonly string[],
  character: CharacterRef,
): boolean {
  const c = resolveCharacter(character);
  if (!c) return false;
  if (missionIntents.length === 0) return true;
  return missionIntents.some((key) => c.intents.includes(key));
}

/** Unique intent keys of a mission's steps, in step order (`validIntentIds` of each step). */
export function missionIntentKeys(
  mission: { steps: ReadonlyArray<{ validIntentIds?: readonly string[] }> } | null | undefined,
): string[] {
  const out: string[] = [];
  for (const step of mission?.steps ?? [])
    for (const key of step.validIntentIds ?? []) if (!out.includes(key)) out.push(key);
  return out;
}

/**
 * Characters of one variety ranked for a mission: those producing the most of its intents
 * first, roster order as the tie-break. Characters producing none are left out, so an empty
 * result means nobody in the variety fits (the caller falls back to `charactersForVariety`).
 * With no mission intents everybody in the variety is returned in roster order.
 */
export function charactersForMission(
  varietyId: VarietyId,
  missionIntents: readonly string[],
): LangQuestCharacter[] {
  const variety = charactersForVariety(varietyId);
  if (missionIntents.length === 0) return variety;
  return variety
    .map((c, index) => ({ c, index, hits: missionIntentsCovered(missionIntents, c).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map((x) => x.c);
}
