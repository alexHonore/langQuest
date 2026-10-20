import { describe, expect, it } from 'vitest';
import { isIntentKey } from '../intents';
import { validateBlueprint } from './blueprint';
import { CASTING_MIN_INTENT_COVERAGE, MissionCastingSchema, castChapter, castForMission, missionCasting, rankCast, roleMatches, type CastMember } from './casting';
import { SITUATIONAL_BLUEPRINTS, getBlueprint } from './scenarios';
import { DEFAULT_STORY_ARC } from './story';

/** A small fictional roster in the shape `@langquest/db/seed/cast-roster` produces (one variety unless stated). */
const member = (id: string, role: string, ageBand: CastMember['ageBand'], intents: string[], extra: Partial<CastMember> = {}): CastMember => ({ id, characterId: `uuid-${id}`, name: id, role, varietyId: 'ary', ageBand, regionalOption: null, intents, situations: [], ...extra });

const ROSTER: CastMember[] = [
  member('nadia', 'Café staff', 'adult', ['greet_hello', 'ask_how_are_you', 'introduce_name', 'ask_name', 'say_where_from', 'request_drink', 'offer_options', 'confirm_order', 'ask_for_bill', 'ask_payment_method', 'state_price']),
  member('youssef', 'Neighbour', 'elder', ['give_direction_straight', 'give_direction_turn', 'say_it_is_far', 'say_it_is_near', 'ask_where_is', 'say_new_neighbour', 'welcome_someone', 'offer_help', 'greet_hello', 'narrate_past_event']),
  member('salma', 'Schoolgirl', 'child', ['request_food', 'choose_option', 'say_delicious', 'express_like', 'ask_permission', 'greet_hello']),
  member('omar', 'High-school student', 'teen', ['invite', 'suggest_activity', 'make_plan_time', 'confirm_plan', 'ask_which_stop']),
  member('rima', 'Shopkeeper', 'adult', ['state_price', 'offer_lower_price', 'ask_last_price', 'agree_to_price', 'say_too_expensive'], { varietyId: 'ar-levant' }),
];

describe('blueprint casting preferences', () => {
  it('every blueprint declares real intents and at least one role word or age band', () => {
    for (const bp of SITUATIONAL_BLUEPRINTS) {
      expect(validateBlueprint(bp), bp.key).toEqual([]);
      expect(bp.preferredCharacterIntents.every(isIntentKey), bp.key).toBe(true);
      expect(bp.preferredCharacterIntents.length, bp.key).toBeGreaterThanOrEqual(3);
      expect(bp.preferredRoles.length + bp.preferredAgeBands.length, bp.key).toBeGreaterThan(0);
    }
  });

  it('encodes the owner correlations: kid ↔ ice cream, adult/elder ↔ directions, adults ↔ taxi / café / clothes', () => {
    expect(getBlueprint('buy_ice_cream').preferredAgeBands[0]).toBe('child');
    expect(getBlueprint('ask_directions').preferredAgeBands).toEqual(['elder', 'adult']);
    expect(getBlueprint('take_taxi').preferredAgeBands).toEqual(['adult']);
    expect(getBlueprint('cafe_order_drink').preferredRoles).toContain('café');
    expect(getBlueprint('shop_for_clothes').preferredRoles).toEqual(expect.arrayContaining(['tailor', 'shop assistant']));
    expect(DEFAULT_STORY_ARC.chapters[0]!.missionKeys).toContain('buy_ice_cream');
    expect(DEFAULT_STORY_ARC.chapters[0]!.characterRoles).toHaveLength(DEFAULT_STORY_ARC.chapters[0]!.missionKeys.length);
  });

  it('missionCasting merges overrides per field and rejects unknown age bands', () => {
    const bp = getBlueprint('cafe_order_drink');
    const merged = missionCasting(bp, { preferredAgeBands: ['elder'] });
    expect(merged.preferredAgeBands).toEqual(['elder']);
    expect(merged.preferredRoles).toEqual(bp.preferredRoles);
    expect(merged.preferredCharacterIntents).toEqual(bp.preferredCharacterIntents);
    expect(() => MissionCastingSchema.parse({ preferredAgeBands: ['baby'] })).toThrow();
    expect(MissionCastingSchema.parse({})).toEqual({ preferredCharacterIntents: [], preferredAgeBands: [], preferredRoles: [] });
  });
});

describe('roleMatches', () => {
  it('matches role words case- and diacritics-insensitively on word boundaries', () => {
    expect(roleMatches('Café staff', ['cafe'])).toBe('cafe');
    expect(roleMatches('Matatu conductor', ['conductor'])).toBe('conductor');
    expect(roleMatches('Schoolgirl', ['girl'])).toBeNull();
    expect(roleMatches('Taxi driver', ['taxi', 'driver'])).toBe('taxi');
    expect(roleMatches('Retired teacher', ['teacher'])).toBe('teacher');
    expect(roleMatches('Anything', [])).toBeNull();
  });
});

describe('castForMission', () => {
  it('casts the café server for the café mission (role word + intents) and the child for the ice cream', () => {
    const cafe = castForMission(getBlueprint('cafe_order_drink'), ROSTER, { varietyId: 'ary' });
    expect(cafe.character?.id).toBe('nadia');
    expect(cafe.fit).toBe('role');
    expect(cafe.reasons.join(' ')).toMatch(/matches "caf/);
    const ice = castForMission(getBlueprint('buy_ice_cream'), ROSTER, { varietyId: 'ary' });
    expect(ice.character?.id).toBe('salma');
    expect(ice.character?.ageBand).toBe('child');
  });

  it('gives directions to the elder, never to the child, and never crosses a variety boundary', () => {
    const directions = castForMission(getBlueprint('ask_directions'), ROSTER, { varietyId: 'ary' });
    expect(directions.character?.id).toBe('youssef');
    expect(directions.character?.ageBand).toBe('elder');
    expect(directions.ranked.every((r) => r.member.varietyId === 'ary')).toBe(true);
    const market = castForMission(getBlueprint('market_ask_price'), ROSTER, { varietyId: 'ary' });
    // Rima (ar-levant) carries every bargaining intent but is not Darija: nobody fits → null, honestly.
    expect(market.character).toBeNull();
    expect(market.fit).toBe('none');
    expect(castForMission(getBlueprint('market_ask_price'), ROSTER, { varietyId: 'ar-levant' }).character?.id).toBe('rima');
  });

  it('returns null rather than a wrong character when nobody carries the scene, unless fallbacks are allowed', () => {
    const taxi = castForMission(getBlueprint('take_taxi'), ROSTER, { varietyId: 'ary' });
    expect(taxi.character).toBeNull();
    expect(taxi.reasons[0]).toMatch(/nobody carries the scene/);
    const ranked = rankCast(taxi.casting, ROSTER, { varietyId: 'ary' });
    expect(ranked.every((r) => r.fit === 'fallback' && r.intentCoverage < CASTING_MIN_INTENT_COVERAGE)).toBe(true);
    const fallback = castForMission(getBlueprint('take_taxi'), ROSTER, { varietyId: 'ary', allowFallback: true });
    expect(fallback.fit).toBe('fallback');
    expect(fallback.character?.ageBand).not.toBe('child');
    expect(castForMission(getBlueprint('take_taxi'), [], {}).fit).toBe('none');
  });

  it('honours a pinned roster id (slug or uuid) when it exists in the variety, and ignores it otherwise', () => {
    const pinned = castForMission({ blueprint: getBlueprint('greet_and_introduce'), rosterCharacterId: 'omar' }, ROSTER, { varietyId: 'ary' });
    expect(pinned.character?.id).toBe('omar');
    expect(pinned.fit).toBe('pinned');
    expect(castForMission({ blueprint: getBlueprint('greet_and_introduce') }, ROSTER, { varietyId: 'ary', pinnedCharacterId: 'uuid-youssef' }).character?.id).toBe('youssef');
    const foreign = castForMission({ blueprint: getBlueprint('greet_and_introduce'), rosterCharacterId: 'rima' }, ROSTER, { varietyId: 'ary' });
    expect(foreign.fit).not.toBe('pinned');
    expect(foreign.character?.varietyId).toBe('ary');
  });

  it('applies per-mission overrides and a regional preference deterministically', () => {
    const elderGreeter = castForMission({ blueprint: getBlueprint('greet_and_introduce'), casting: { preferredRoles: ['neighbour'], preferredCharacterIntents: ['greet_hello'] } }, ROSTER, { varietyId: 'ary' });
    expect(elderGreeter.character?.id).toBe('youssef');
    const regional = [member('a', 'Café staff', 'adult', ['request_drink'], { regionalOption: 'rabat' }), member('b', 'Café staff', 'adult', ['request_drink'], { regionalOption: 'casablanca' })];
    expect(castForMission(getBlueprint('cafe_order_drink'), regional, { regionalOption: 'casablanca' }).character?.id).toBe('b');
    expect(castForMission(getBlueprint('cafe_order_drink'), regional, {}).character?.id).toBe('a');
    const once = castForMission(getBlueprint('cafe_order_drink'), ROSTER, { varietyId: 'ary' });
    expect(castForMission(getBlueprint('cafe_order_drink'), ROSTER, { varietyId: 'ary' })).toEqual(once);
  });
});

describe('castChapter', () => {
  it('casts chapter 1 in order, varying the cast and reporting uncast missions honestly', () => {
    const missions = DEFAULT_STORY_ARC.chapters[0]!.missionKeys.map((key) => ({ key, blueprint: getBlueprint(key) }));
    const results = castChapter(missions, ROSTER, { varietyId: 'ary' });
    expect([...results.keys()]).toEqual(DEFAULT_STORY_ARC.chapters[0]!.missionKeys);
    expect(results.get('cafe_order_drink')!.character?.id).toBe('nadia');
    expect(results.get('ask_directions')!.character?.id).toBe('youssef');
    expect(results.get('buy_ice_cream')!.character?.id).toBe('salma');
    expect(results.get('meet_neighbour')!.character?.id).toBe('youssef');
    expect(results.get('meet_neighbour')!.reasons.join(' ')).toMatch(/already cast/);
    expect(results.get('take_taxi')!.character).toBeNull();
    expect(results.get('market_ask_price')!.character).toBeNull();
    for (const r of results.values()) if (r.character) expect(r.character.varietyId).toBe('ary');
  });
});
