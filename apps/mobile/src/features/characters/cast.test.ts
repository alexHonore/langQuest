import { describe, expect, it } from 'vitest';
import { castFromManifest, findCastCharacter, portraitKeyFor } from './cast';

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
