/**
 * Conversation characters (§5.2 / §10.2A). Learner clients only see `published` rows (RLS);
 * the service/editor clients see every state.
 *
 * Ids are deterministic (`characterUuid(rosterId)` in `../character-uuid`), so the art roster in
 * `@langquest/ui` and `public.characters` agree without a lookup table.
 */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { Row } from '../types';

/**
 * Orders characters for an enrollment: those whose `regional_option` matches the learner's regional
 * preference first, then variety-wide characters (`regional_option` null), then the rest. Stable
 * (keeps the incoming order inside each group). Pure; exported for the manifest builder and tests.
 */
export function rankCharactersForRegion<T extends { regional_option: string | null }>(
  characters: readonly T[],
  regionalPreference: string | null | undefined,
): T[] {
  const rank = (c: T): number => {
    if (regionalPreference && c.regional_option === regionalPreference) return 0;
    if (c.regional_option === null) return 1;
    return 2;
  };
  return characters
    .map((c, index) => ({ c, index, rank: rank(c) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.c);
}

export interface CharactersRepository {
  /**
   * Published characters speaking `targetVarietyId` (never another variety), ordered by regional
   * match when `regionalPreference` is given (see {@link rankCharactersForRegion}), then by name.
   */
  listPublishedForVariety(targetVarietyId: string, regionalPreference?: string | null): Promise<Row<'characters'>[]>;
  /** One character by id (any state the client is allowed to see), or null. */
  getById(id: string): Promise<Row<'characters'> | null>;
  /** One character by its stable `character_key` (the art roster slug), or null. */
  getByKey(characterKey: string): Promise<Row<'characters'> | null>;
}

export function charactersRepository(db: DbClient): CharactersRepository {
  return {
    async listPublishedForVariety(targetVarietyId, regionalPreference) {
      const rows = unwrap(
        await db
          .from('characters')
          .select('*')
          .eq('target_variety_id', targetVarietyId)
          .eq('state', 'published')
          .order('name'),
        'characters.listPublishedForVariety',
      );
      return rankCharactersForRegion(rows, regionalPreference);
    },
    async getById(id) {
      return unwrapMaybe(await db.from('characters').select('*').eq('id', id).maybeSingle(), 'characters.getById');
    },
    async getByKey(characterKey) {
      return unwrapMaybe(
        await db.from('characters').select('*').eq('character_key', characterKey).maybeSingle(),
        'characters.getByKey',
      );
    },
  };
}
