/**
 * The conversational cast of a course, taken from the course manifest the API serves (never from a
 * locally derived roster): `id` is the `characters` row uuid that `POST /v1/ai/conversation/session`
 * looks up, so a character the learner can see is always one the server can start a session with.
 *
 * The manifest is non-personal and cached per (track, source), so ranking by the enrollment's
 * regional preference happens here (same rule as the API's `rankCharactersForRegion`: matching
 * regional option first, then characters without one, then the rest; stable otherwise).
 */
import type { VarietyId } from '@langquest/contracts';
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

/**
 * The cast of one mission: the manifest's `characterIds` resolved against the course cast, in
 * manifest order. Ids the cast does not carry are dropped (never a placeholder, CONVENTIONS §8).
 */
export function missionCast(characterIds: readonly string[], cast: readonly CastCharacter[]): CastCharacter[] {
  const byId = new Map(cast.map((c) => [c.id, c] as const));
  return characterIds.map((id) => byId.get(id)).filter((c): c is CastCharacter => Boolean(c));
}
