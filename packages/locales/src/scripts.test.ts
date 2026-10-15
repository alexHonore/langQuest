import { COURSE_TRACKS, SCRIPT_IDS, TRANSLITERATION_SCHEME_IDS } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import {
  SCHEMES_WITH_METADATA,
  SCRIPTS_WITH_METADATA,
  SCRIPT_METADATA,
  TRANSLITERATION_SCHEME_METADATA,
  displayLayersForMode,
  fontFamilyCssForScript,
  fontStackForScript,
  lineHeightForScript,
  scriptMetadataForTrack,
  scriptModeOptionsForTrack,
} from './scripts';

describe('script metadata', () => {
  it('covers every script and transliteration scheme from contracts', () => {
    expect(SCRIPTS_WITH_METADATA).toEqual([...SCRIPT_IDS]);
    expect(SCHEMES_WITH_METADATA).toEqual([...TRANSLITERATION_SCHEME_IDS]);
  });

  it('uses system font stacks only and tall-script line heights', () => {
    for (const meta of Object.values(SCRIPT_METADATA)) {
      expect(meta.fontStack.length).toBeGreaterThan(1);
      expect(meta.fontStack.at(-1)).toBe('sans-serif');
      expect(meta.fontStack.join(' ')).not.toMatch(/\.(ttf|otf|woff)/);
    }
    expect(lineHeightForScript('Deva')).toBeGreaterThan(lineHeightForScript('Latn'));
    expect(lineHeightForScript('Kore')).toBeGreaterThan(lineHeightForScript('Latn'));
    expect(lineHeightForScript('Hans')).toBeGreaterThan(lineHeightForScript('Latn'));
    expect(lineHeightForScript('Arab')).toBeGreaterThan(lineHeightForScript('Latn'));
    expect(SCRIPT_METADATA.Arab.direction).toBe('rtl');
    expect(SCRIPT_METADATA.Hebr.direction).toBe('rtl');
    expect(fontStackForScript('Hant')[0]).toMatch(/HK/);
    expect(fontFamilyCssForScript('Jpan')).toContain('"Hiragino Sans"');
    expect(fontFamilyCssForScript('Latn')).toMatch(/sans-serif$/);
  });

  it('marks furigana and niqqud as annotations', () => {
    expect(TRANSLITERATION_SCHEME_METADATA.furigana.kind).toBe('annotation');
    expect(TRANSLITERATION_SCHEME_METADATA.niqqud.kind).toBe('annotation');
    expect(TRANSLITERATION_SCHEME_METADATA.pinyin.kind).toBe('romanization');
  });
});

describe('scriptModeOptionsForTrack', () => {
  it('offers native/latin/both for Darija with Arabic first and Arabizi second', () => {
    const options = scriptModeOptionsForTrack('arabic-moroccan');
    expect(options.map((o) => o.mode)).toEqual(['native', 'latin', 'both']);
    expect(options.find((o) => o.isDefault)?.mode).toBe('both');
    const both = options.find((o) => o.mode === 'both')!;
    expect(both.layers.map((l) => [l.kind, l.script, l.scheme ?? null, l.direction, l.order])).toEqual([
      ['native', 'Arab', null, 'rtl', 0],
      ['transliteration', 'Latn', 'arabizi', 'ltr', 1],
    ]);
    expect(both.labelKey).toBe('lesson.scriptMode.both');
  });

  it('only offers native for Latin-script tracks', () => {
    const options = scriptModeOptionsForTrack('french');
    expect(options.map((o) => o.mode)).toEqual(['native']);
    expect(options[0]!.layers).toHaveLength(1);
    expect(options[0]!.layers[0]!.script).toBe('Latn');
  });

  it('attaches annotation schemes to the native layer (Japanese furigana, Hebrew niqqud)', () => {
    const ja = displayLayersForMode('japanese', 'both');
    expect(ja[0]).toMatchObject({ kind: 'native', script: 'Jpan', annotations: ['furigana'] });
    expect(ja[1]).toMatchObject({ kind: 'transliteration', scheme: 'romaji' });
    const he = displayLayersForMode('hebrew', 'latin');
    expect(he).toHaveLength(1);
    expect(he[0]).toMatchObject({ kind: 'transliteration', scheme: 'translit-latn', script: 'Latn' });
    expect(displayLayersForMode('hebrew', 'native')[0]!.annotations).toEqual(['niqqud']);
  });

  it('resolves the Simplified track to Hans and Cantonese to Hant', () => {
    expect(scriptMetadataForTrack('chinese-simplified').id).toBe('Hans');
    expect(scriptMetadataForTrack('chinese-cantonese').id).toBe('Hant');
    expect(displayLayersForMode('chinese-cantonese', 'both')[1]!.scheme).toBe('jyutping');
  });

  it('never returns an empty layer list for any track/mode', () => {
    for (const track of COURSE_TRACKS) {
      for (const option of scriptModeOptionsForTrack(track.id)) {
        expect(option.layers.length, `${track.id}/${option.mode}`).toBeGreaterThan(0);
        expect(option.layers[0]!.order).toBeLessThanOrEqual(option.layers.at(-1)!.order);
      }
    }
  });
});
