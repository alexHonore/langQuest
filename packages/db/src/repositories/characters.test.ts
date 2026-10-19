import { describe, expect, it } from 'vitest';
import { rankCharactersForRegion } from './characters';

describe('rankCharactersForRegion', () => {
  const rows = [
    { name: 'Aline', regional_option: null },
    { name: 'Brian', regional_option: 'KE' },
    { name: 'Chausiku', regional_option: 'TZ' },
    { name: 'Daudi', regional_option: null },
  ];
  it('puts the regional match first, then variety-wide, then other regions; stable inside groups', () => {
    expect(rankCharactersForRegion(rows, 'TZ').map((r) => r.name)).toEqual(['Chausiku', 'Aline', 'Daudi', 'Brian']);
    expect(rankCharactersForRegion(rows, 'KE').map((r) => r.name)).toEqual(['Brian', 'Aline', 'Daudi', 'Chausiku']);
  });
  it('without a preference keeps variety-wide characters ahead of regional ones', () => {
    expect(rankCharactersForRegion(rows, null).map((r) => r.name)).toEqual(['Aline', 'Daudi', 'Brian', 'Chausiku']);
    expect(rankCharactersForRegion(rows, undefined).map((r) => r.name)).toEqual(['Aline', 'Daudi', 'Brian', 'Chausiku']);
  });
  it('does not mutate its input', () => {
    const copy = [...rows];
    rankCharactersForRegion(rows, 'TZ');
    expect(rows).toEqual(copy);
  });
});
