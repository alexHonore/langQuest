import { findCharacter } from '@langquest/ui/art/web';
import { describe, expect, it } from 'vitest';
import { castFromManifest, castMatchesMission, findCastCharacter, missionAgeFloor, missionCast, missionIntentKeys, portraitKeyFor, rankCastForMission } from './cast';

const nadia = { id: '0f7f3a72-6a7b-5a2b-9f6c-1d2e3f4a5b6c', name: 'Nadia', role: 'Café staff', varietyId: 'ary' as const, portrait: null, syntheticVoice: true, characterKey: 'ary-cafe-staff-nadia', region: 'Casablanca, Morocco', regionalOption: 'casablanca', portraitKey: 'ary-cafe-staff-nadia' };
const driss = { id: '1a2b3c4d-5e6f-5a7b-8c9d-0e1f2a3b4c5d', name: 'Driss', role: 'Taxi driver', varietyId: 'ary' as const, portrait: null, syntheticVoice: true, characterKey: 'ary-taxi-driss', region: 'Marrakech, Morocco', regionalOption: 'marrakech', portraitKey: 'ary-taxi-driss' };
const anyRegion = { id: '2b3c4d5e-6f7a-5b8c-9d0e-1f2a3b4c5d6e', name: 'Test', role: 'Tester', varietyId: 'ary' as const, portrait: null, syntheticVoice: true };
const stranger = { id: '3c4d5e6f-7a8b-5c9d-0e1f-2a3b4c5d6e7f', name: 'Youssef', role: 'Clerk', varietyId: 'arz' as const, portrait: null, syntheticVoice: false, characterKey: 'arz-clerk-youssef' };

describe('castFromManifest', () => {
  it('keeps the API uuid as the id and resolves the portrait key from the extension fields', () => {
    const cast = castFromManifest({ targetVarietyId: 'ary', characters: [nadia] }, null);
    expect(cast).toHaveLength(1);
    expect(cast[0]).toMatchObject({ id: nadia.id, portraitKey: 'ary-cafe-staff-nadia', characterKey: 'ary-cafe-staff-nadia', region: 'Casablanca, Morocco', regionalOption: 'casablanca', syntheticVoice: true, regionalMatch: false });
  });

  it('falls back to characterKey, then the uuid, when the manifest was parsed without the extension', () => {
    expect(portraitKeyFor({ id: 'u', characterKey: 'k', portraitKey: undefined })).toBe('k');
    expect(portraitKeyFor({ id: 'u', characterKey: undefined, portraitKey: undefined })).toBe('u');
    const cast = castFromManifest({ targetVarietyId: 'ary', characters: [anyRegion] }, 'casablanca');
    expect(cast[0]).toMatchObject({ portraitKey: anyRegion.id, characterKey: null, region: null, regionalOption: null });
  });

  it('never crosses a variety boundary', () => {
    const cast = castFromManifest({ targetVarietyId: 'ary', characters: [stranger, nadia] }, null);
    expect(cast.map((c) => c.name)).toEqual(['Nadia']);
  });

  it('ranks the preferred regional option first, then characters without one, keeping order otherwise', () => {
    const ordered = castFromManifest({ targetVarietyId: 'ary', characters: [driss, anyRegion, nadia] }, 'casablanca');
    expect(ordered.map((c) => c.name)).toEqual(['Nadia', 'Test', 'Driss']);
    expect(ordered[0]?.regionalMatch).toBe(true);
    expect(ordered[2]?.regionalMatch).toBe(false);
    const noPref = castFromManifest({ targetVarietyId: 'ary', characters: [driss, anyRegion, nadia] }, null);
    expect(noPref.map((c) => c.name)).toEqual(['Test', 'Driss', 'Nadia']);
    expect(noPref.every((c) => !c.regionalMatch)).toBe(true);
  });

  it('returns an empty cast without a manifest', () => {
    expect(castFromManifest(null, 'casablanca')).toEqual([]);
    expect(castFromManifest(undefined, null)).toEqual([]);
  });
});

describe('findCastCharacter', () => {
  const cast = castFromManifest({ targetVarietyId: 'ary', characters: [nadia, driss] }, null);
  it('finds by uuid, roster key or portrait key', () => {
    expect(findCastCharacter(cast, nadia.id)?.name).toBe('Nadia');
    expect(findCastCharacter(cast, 'ary-taxi-driss')?.name).toBe('Driss');
    expect(findCastCharacter(cast, 'missing')).toBeNull();
    expect(findCastCharacter(cast, undefined)).toBeNull();
  });
});

describe('missionCast', () => {
  const cast = castFromManifest({ targetVarietyId: 'ary', characters: [nadia, driss] }, null);
  it('resolves the manifest character ids in order and drops ids the cast does not carry', () => {
    expect(missionCast([driss.id, 'not-in-cast', nadia.id], cast).map((c) => c.name)).toEqual(['Driss', 'Nadia']);
  });
  it('is empty for a mission without a cast (no placeholder)', () => {
    expect(missionCast([], cast)).toEqual([]);
    expect(missionCast([nadia.id], [])).toEqual([]);
  });
  it('keeps the manifest order when no mission fit is given (backward compatible)', () => {
    expect(missionCast([nadia.id, driss.id], cast, null).map((c) => c.name)).toEqual(['Nadia', 'Driss']);
  });
});

/* Real roster characters (uuid + slug), the way the API manifest carries them. */
const roster = (slug: string) => {
  const c = findCharacter(slug);
  if (!c) throw new Error(`roster character missing: ${slug}`);
  return { id: c.characterId, name: c.name, role: c.role, varietyId: c.varietyId, portrait: null, syntheticVoice: true, characterKey: c.id, portraitKey: c.id, region: c.city, regionalOption: c.regionalOption };
};
const samir = roster('arz-taxi-driver-samir'); // adult, taxi_destination + ask_directions
const hoda = roster('arz-grandmother-hoda'); // elder, market_bargain + family_stories
const karim = roster('arz-schoolboy-karim'); // child
const youssef = roster('ary-neighbour-youssef'); // elder, ask_directions
const salma = roster('ary-schoolgirl-salma'); // child
const omar = roster('ary-student-omar'); // teen, bus_and_transit
const arz = castFromManifest({ targetVarietyId: 'arz', characters: [karim, hoda, samir] }, null);
const ary = castFromManifest({ targetVarietyId: 'ary', characters: [salma, omar, nadia, youssef] }, null);

describe('mission fit (roles must match missions)', () => {
  it('maps a mission’s skill keys to curriculum intents (intent keys pass through)', () => {
    expect(missionIntentKeys(['hail_taxi'])).toContain('hail_taxi');
    expect(missionIntentKeys([])).toEqual([]);
    expect(missionIntentKeys(['no_such_skill'])).toEqual([]);
    const taxi = missionIntentKeys(['hail_taxi', 'ask_fare']);
    expect(new Set(taxi).size).toBe(taxi.length);
  });

  it('derives the youngest age band that can carry the mission', () => {
    expect(missionAgeFloor({ skillKeys: ['hail_taxi', 'greet_hello'] })).toBe('adult');
    expect(missionAgeFloor({ skillKeys: ['greet_hello'], sceneId: 'office' })).toBe('adult');
    expect(missionAgeFloor({ skillKeys: ['give_direction_turn'] })).toBe('child');
    expect(missionAgeFloor({ skillKeys: ['market_bargain_nope'], sceneId: 'market' })).toBe('teen');
    expect(missionAgeFloor({ skillKeys: [], sceneId: 'unknown-scene' })).toBeNull();
    expect(missionAgeFloor({})).toBeNull();
  });

  it('castMatchesMission: a child cannot carry a taxi or an office mission; unknown characters stay eligible', () => {
    const child = findCharacter('arz-schoolboy-karim')!;
    const driver = findCharacter('arz-taxi-driver-samir')!;
    expect(castMatchesMission(child, { skillKeys: ['hail_taxi', 'state_destination'] }).eligible).toBe(false);
    expect(castMatchesMission(child, { skillKeys: ['ask_opinion'], sceneId: 'office' }).eligible).toBe(false);
    expect(castMatchesMission(child, { skillKeys: ['request_food'], sceneId: 'park' })).toMatchObject({ eligible: true, sceneMatch: true });
    expect(castMatchesMission(driver, { skillKeys: ['hail_taxi', 'ask_fare'] })).toMatchObject({ eligible: true, matchedIntents: 2 });
    expect(castMatchesMission(null, { skillKeys: ['hail_taxi'] })).toEqual({ eligible: true, matchedIntents: 0, sceneMatch: false });
  });

  it('never casts the child on a taxi mission and puts the taxi driver first', () => {
    const names = missionCast([karim.id, hoda.id, samir.id], arz, { skillKeys: ['hail_taxi', 'state_destination', 'ask_fare'], sceneId: 'street' }).map((c) => c.name);
    expect(names[0]).toBe(samir.name);
    expect(names).not.toContain(karim.name);
    expect(names).toContain(hoda.name);
  });

  it('never casts the child on an office mission', () => {
    const names = missionCast([karim.id, hoda.id, samir.id], arz, { skillKeys: ['ask_opinion', 'disagree_politely'], sceneId: 'office' }).map((c) => c.name);
    expect(names).not.toContain(karim.name);
    expect(names.length).toBeGreaterThan(0);
  });

  it('ranks the elder who gives directions first on a directions mission', () => {
    const ranked = missionCast([salma.id, omar.id, nadia.id, youssef.id], ary, { skillKeys: ['ask_where_is', 'give_direction_turn', 'say_it_is_far'], sceneId: 'street' });
    expect(ranked[0]?.name).toBe(youssef.name);
    const band = findCharacter(ranked[0]!.characterKey!)?.ageBand;
    expect(band === 'elder' || band === 'adult').toBe(true);
  });

  it('prefers the character whose everyday life carries the scene (café staff at the café)', () => {
    const ranked = missionCast([youssef.id, salma.id, nadia.id], ary, { skillKeys: ['request_drink', 'ask_for_bill'], sceneId: 'cafe' });
    expect(ranked[0]?.name).toBe(nadia.name);
  });

  it('falls back to the manifest order when the check would leave nobody', () => {
    const onlyChild = castFromManifest({ targetVarietyId: 'arz', characters: [karim] }, null);
    expect(missionCast([karim.id], onlyChild, { skillKeys: ['hail_taxi'] }).map((c) => c.name)).toEqual([karim.name]);
    expect(rankCastForMission([], { skillKeys: ['hail_taxi'] })).toEqual([]);
  });

  it('keeps characters the roster does not know (manifest-only cast) in manifest order', () => {
    const names = missionCast([anyRegion.id, driss.id], castFromManifest({ targetVarietyId: 'ary', characters: [anyRegion, driss] }, null), { skillKeys: ['hail_taxi'] }).map((c) => c.name);
    expect(names).toEqual(['Test', 'Driss']);
  });
});
