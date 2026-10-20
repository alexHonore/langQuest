/**
 * The art roster (`@langquest/ui` `CHARACTER_ROSTER`) projected into the casting shape
 * `@langquest/curriculum` understands (`CastMember`), so the curriculum seed can cast a roster
 * character per mission (`castForMission`) without `@langquest/curriculum` depending on the UI
 * package. `characterId` is the deterministic `characters.id` of the seeded row (migration 140).
 */
import { CHARACTER_ROSTER, type LangQuestCharacter } from '@langquest/ui/art/web';
import { characterUuid } from '../character-uuid';

/**
 * Structural mirror of `@langquest/curriculum` `CastMember` (this package does not depend on the
 * curriculum package; `scripts/src/seed-curriculum.ts` passes these rows to `castForMission`, and
 * `cast-roster.test.ts` guards the shape).
 */
export interface RosterCastMember {
  /** Roster slug (`characters.character_key`). */
  id: string;
  /** `characters.id` (uuid v5 of the slug, migration 140). */
  characterId: string;
  name: string;
  role: string;
  varietyId: string;
  trackIds: readonly string[];
  city: string;
  region: string;
  ageBand: 'child' | 'teen' | 'adult' | 'elder';
  genderPresentation: 'feminine' | 'masculine';
  regionalOption: string | null;
  /** Curriculum intent keys the character naturally produces (derived from its situation tags). */
  intents: readonly string[];
  situations: readonly string[];
}

/** Casting view of one roster character. Pure. */
export function toCastMember(c: LangQuestCharacter): RosterCastMember {
  return {
    id: c.id,
    characterId: characterUuid(c.id),
    name: c.name,
    role: c.role,
    varietyId: c.varietyId,
    trackIds: c.trackIds,
    city: c.city,
    region: c.region,
    ageBand: c.ageBand,
    genderPresentation: c.genderPresentation,
    regionalOption: c.regionalOption,
    intents: c.intents,
    situations: c.situations,
  };
}

/** Every roster character as a cast member, in roster order (legacy 16 first). */
export const CAST_ROSTER: readonly RosterCastMember[] = CHARACTER_ROSTER.map(toCastMember);

/** Cast members of one variety (never crosses a variety boundary). */
export const castRosterForVariety = (varietyId: string): RosterCastMember[] => CAST_ROSTER.filter((c) => c.varietyId === varietyId);
