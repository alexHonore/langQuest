/**
 * The conversational cast of a course, taken from the course manifest the API serves (never from a
 * locally derived roster): `id` is the `characters` row uuid that `POST /v1/ai/conversation/session`
 * looks up, so a character the learner can see is always one the server can start a session with.
 *
 * The manifest is non-personal and cached per (track, source), so ranking by the enrollment's
 * regional preference happens here (same rule as the API's `rankCharactersForRegion`: matching
 * regional option first, then characters without one, then the rest; stable otherwise).
 *
 * Mission casts are additionally checked against the mission (`docs/design/character-casting.md`
 * §3): the roster's situation catalogue says which age band can carry a situation and which
 * intents a character's everyday life produces, so a child is never shown on a taxi or office
 * mission and the interlocutor who actually carries the mission's intents (the elder who gives
 * directions, the taxi driver) comes first. Characters the roster does not know stay eligible,
 * and when nobody fits the manifest order is kept (graceful fallback, never an empty row).
 */
import type { VarietyId } from '@langquest/contracts';
import { intentsForSkill, isIntentKey } from '@langquest/curriculum';
import { CHARACTER_SITUATIONS, findCharacter, isSituationTag, type AgeBand, type LangQuestCharacter, type SituationTag } from '@langquest/ui/art/web';
import type { LearnerManifest, LearnerManifestCharacter } from '@/lib/api/manifest-schema';

export interface CastCharacter {
  /** Database uuid — the `characterId` sent when starting a conversation. */
  id: string;
  name: string;
  role: string;
  varietyId: VarietyId;
  /** Every published character so far has a synthetic voice; the UI must say so (§8.6). */
  syntheticVoice: boolean;
  /**
   * Key for the in-code portrait art (`findCharacter` in `@langquest/ui` accepts the roster slug or
   * the stable uuid): `portraitKey`, else `characterKey`, else the uuid itself.
   */
  portraitKey: string;
  characterKey: string | null;
  region: string | null;
  regionalOption: string | null;
  /** True when the character speaks the regional option the enrollment prefers. */
  regionalMatch: boolean;
}

export type CastSource = Pick<LearnerManifest, 'characters' | 'targetVarietyId'>;

export function portraitKeyFor(c: Pick<LearnerManifestCharacter, 'id' | 'characterKey' | 'portraitKey'>): string {
  return c.portraitKey ?? c.characterKey ?? c.id;
}

/** Characters of the manifest's own variety (never another one), ranked for the regional preference. */
export function castFromManifest(manifest: CastSource | null | undefined, regionalPreference: string | null | undefined): CastCharacter[] {
  if (!manifest) return [];
  const pref = regionalPreference ?? null;
  const rank = (c: CastCharacter): number => (pref && c.regionalOption === pref ? 0 : c.regionalOption === null ? 1 : 2);
  return manifest.characters
    .filter((c) => c.varietyId === manifest.targetVarietyId)
    .map(
      (c): CastCharacter => ({
        id: c.id,
        name: c.name,
        role: c.role,
        varietyId: c.varietyId,
        syntheticVoice: c.syntheticVoice,
        portraitKey: portraitKeyFor(c),
        characterKey: c.characterKey ?? null,
        region: c.region ?? null,
        regionalOption: c.regionalOption ?? null,
        regionalMatch: Boolean(pref) && c.regionalOption === pref,
      }),
    )
    .map((c, index) => ({ c, index, rank: rank(c) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.c);
}

/** Find by uuid first, then by roster key (older links and the portrait key share the slug). */
export function findCastCharacter(cast: readonly CastCharacter[], ref: string | null | undefined): CastCharacter | null {
  if (!ref) return null;
  return cast.find((c) => c.id === ref) ?? cast.find((c) => c.characterKey === ref || c.portraitKey === ref) ?? null;
}

/* ------------------------------------------------------------ mission fit --- */

/** What a mission asks of its interlocutors (both fields come straight from the manifest mission). */
export interface MissionFit {
  /** `ManifestMission.skillKeys` (skill keys, or intent keys for older manifests). */
  skillKeys?: readonly string[] | null;
  /** `ManifestMission.sceneId` (`cafe`, `office`, `clinic`…). */
  sceneId?: string | null;
}

const AGE_ORDER: readonly AgeBand[] = ['child', 'teen', 'adult', 'elder'];
const ageIndex = (band: AgeBand): number => AGE_ORDER.indexOf(band);

/**
 * Editorial scenes (`SCENE_IDS` in `@langquest/ui`) → the situations an interlocutor plausibly
 * carries there. Scenes without a natural situation (`airport`, `street` as a bare backdrop) map
 * to the directions / transit situations a passer-by could carry; unknown scenes add nothing.
 */
const SCENE_SITUATIONS: Readonly<Record<string, readonly SituationTag[]>> = {
  cafe: ['order_drink', 'restaurant'],
  restaurant: ['restaurant', 'order_drink'],
  market: ['market_bargain', 'groceries'],
  street: ['ask_directions'],
  transit: ['bus_and_transit'],
  station: ['train_station', 'bus_and_transit'],
  airport: ['train_station'],
  office: ['office_meeting'],
  home: ['hosting_at_home', 'family_stories'],
  gathering: ['plans_with_friends', 'hosting_at_home'],
  park: ['playground', 'sports_talk'],
  clinic: ['clinic_symptoms', 'pharmacy'],
};

const SITUATION_TAGS = Object.keys(CHARACTER_SITUATIONS).filter(isSituationTag);

/** Curriculum intent keys a mission exercises: its skill keys mapped through the intent registry (or taken as-is when they already are intent keys). */
export function missionIntentKeys(skillKeys: readonly string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const key of skillKeys ?? []) {
    if (isIntentKey(key)) out.add(key);
    for (const intent of intentsForSkill(key)) out.add(intent.intentKey);
  }
  return [...out];
}

/** Situations whose everyday life produces at least one of the intents. */
function situationsProducing(intentKeys: readonly string[]): SituationTag[] {
  return SITUATION_TAGS.filter((tag) => (CHARACTER_SITUATIONS[tag].intents as readonly string[]).some((i) => intentKeys.includes(i)));
}

/**
 * Youngest age band that can carry the mission as the interlocutor: for every intent, the youngest
 * band among the situations that produce it; the mission needs the strictest of those, and at
 * least the youngest band of the scene's situations. `null` when nothing constrains the cast.
 */
export function missionAgeFloor(fit: MissionFit): AgeBand | null {
  let floor = -1;
  for (const intent of missionIntentKeys(fit.skillKeys)) {
    const bands = SITUATION_TAGS.filter((tag) => (CHARACTER_SITUATIONS[tag].intents as readonly string[]).includes(intent)).map((tag) => ageIndex(CHARACTER_SITUATIONS[tag].minAgeBand));
    if (bands.length === 0) continue;
    floor = Math.max(floor, Math.min(...bands));
  }
  const scene = fit.sceneId ? (SCENE_SITUATIONS[fit.sceneId] ?? []) : [];
  if (scene.length > 0) floor = Math.max(floor, Math.min(...scene.map((tag) => ageIndex(CHARACTER_SITUATIONS[tag].minAgeBand))));
  return floor < 0 ? null : AGE_ORDER[floor]!;
}

export interface CastFit {
  /** False only for a roster character whose age band cannot carry the mission (a child on a taxi mission). */
  eligible: boolean;
  /** Mission intents the character's everyday life produces (0 for unknown characters). */
  matchedIntents: number;
  /** True when the character carries a situation of the mission's scene. */
  sceneMatch: boolean;
}

/** How well one roster character fits a mission (the local counterpart of a future `castMatchesMission` in `@langquest/ui`). */
export function castMatchesMission(character: Pick<LangQuestCharacter, 'ageBand' | 'intents' | 'situations'> | null | undefined, fit: MissionFit): CastFit {
  if (!character) return { eligible: true, matchedIntents: 0, sceneMatch: false };
  const floor = missionAgeFloor(fit);
  const eligible = floor === null || ageIndex(character.ageBand) >= ageIndex(floor);
  const intents = missionIntentKeys(fit.skillKeys);
  const matchedIntents = intents.filter((i) => character.intents.includes(i)).length;
  const scene = fit.sceneId ? (SCENE_SITUATIONS[fit.sceneId] ?? []) : [];
  const sceneMatch = scene.some((tag) => character.situations.includes(tag));
  return { eligible, matchedIntents, sceneMatch };
}

/** Roster entry behind a cast character (uuid first, then the slug the portrait key carries). */
export function rosterCharacterFor(c: Pick<CastCharacter, 'id' | 'characterKey' | 'portraitKey'>): LangQuestCharacter | undefined {
  return findCharacter(c.id) ?? (c.characterKey ? findCharacter(c.characterKey) : undefined) ?? findCharacter(c.portraitKey);
}

/**
 * Rank a cast for a mission: ineligible roster characters are dropped, the rest are ordered by how
 * many mission intents they carry (scene situation first on ties), manifest order otherwise. When
 * the check would leave nobody, the input order is returned unchanged (never an empty row because
 * of a heuristic; CONVENTIONS §8).
 */
export function rankCastForMission(cast: readonly CastCharacter[], fit: MissionFit): CastCharacter[] {
  const situationsOfMission = situationsProducing(missionIntentKeys(fit.skillKeys));
  const scored = cast.map((c, index) => {
    const roster = rosterCharacterFor(c);
    const f = castMatchesMission(roster, fit);
    const situationMatch = roster ? situationsOfMission.some((tag) => roster.situations.includes(tag)) : false;
    return { c, index, f, situationMatch };
  });
  const eligible = scored.filter((s) => s.f.eligible);
  if (eligible.length === 0) return [...cast];
  return eligible
    .sort((a, b) => Number(b.f.sceneMatch) - Number(a.f.sceneMatch) || b.f.matchedIntents - a.f.matchedIntents || Number(b.situationMatch) - Number(a.situationMatch) || a.index - b.index)
    .map((s) => s.c);
}

/**
 * The cast of one mission: the manifest's `characterIds` resolved against the course cast, in
 * manifest order. Ids the cast does not carry are dropped (never a placeholder, CONVENTIONS §8).
 * With `fit`, the result is checked and ranked against the mission (`rankCastForMission`).
 */
export function missionCast(characterIds: readonly string[], cast: readonly CastCharacter[], fit?: MissionFit | null): CastCharacter[] {
  const byId = new Map(cast.map((c) => [c.id, c] as const));
  const members = characterIds.map((id) => byId.get(id)).filter((c): c is CastCharacter => Boolean(c));
  return fit ? rankCastForMission(members, fit) : members;
}
