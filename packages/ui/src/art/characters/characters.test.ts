/**
 * Cast + clay portrait tests: every roster entry renders the 9 expressions in both
 * levels of detail, the diversity invariants hold per track, situation intents resolve
 * to real curriculum keys, and the 16 legacy uuids never move.
 */
import {
  CHARACTER_EXPRESSION_VALUES,
  COURSE_TRACKS,
  COURSE_TRACK_IDS,
  CharacterVisualProfileSchema,
  LANGUAGE_VARIETIES,
} from '@langquest/contracts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countNodes } from '../svg-node';
import { cast, skinToneFamily } from './cast';
import { RIM_COLOR } from './clay';
import { CHARACTER_EXPRESSIONS } from './expressions';
import {
  PORTRAIT_FLAT_MAX_SIZE,
  buildPortraitNodes,
  portraitDetailForSize,
  portraitSvgString,
} from './portrait';
import {
  CHARACTER_ROSTER,
  LEGACY_ROSTER_IDS,
  castMatchesMission,
  charactersForIntent,
  charactersForMission,
  charactersForSituation,
  charactersForTrack,
  charactersForVariety,
  findCharacter,
  missionIntentKeys,
  missionIntentsCovered,
} from './roster';
import {
  CHARACTER_SITUATIONS,
  SITUATION_TAGS,
  type SituationTag,
  intentsForSituations,
  situationFitsAge,
} from './situations';
import { stableCharacterUuid } from './uuid';

const KB = 1024;
const isSvg = (s: string): boolean =>
  s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && s.endsWith('</svg>');

// The curriculum registry is loaded through a computed path on purpose: `@langquest/ui`
// must not depend on `@langquest/curriculum` (React Native bundle, package rootDir), but
// the intent keys mirrored in `situations.ts` must exist there.
const here = dirname(fileURLToPath(import.meta.url));
const curriculumIntentsPath = resolve(here, '../../../../curriculum/src/intents.ts');
const curriculum = (await import(/* @vite-ignore */ curriculumIntentsPath)) as {
  INTENT_KEYS: readonly string[];
};
const INTENT_KEYS = curriculum.INTENT_KEYS;

/** The uuids seeded in migration 130 — pinned so the roster expansion can never move them. */
const LEGACY_UUIDS: ReadonlyArray<readonly [string, string]> = [
  ['ary-cafe-staff-nadia', '58835d74-6c1e-5735-a386-62b6af2dd06b'],
  ['ary-neighbour-youssef', 'c89e9332-3491-5c7a-8977-e566d97f5934'],
  ['es-es-coworker-marta', 'bec50499-3670-592a-a6a6-aa59f1df83da'],
  ['es-419-market-vendor-rafael', '36b627a1-ab69-53fd-942f-5a99e532d8ca'],
  ['ja-neighbour-haruka', 'a6566bd8-cb6e-5b49-a9e0-07e924bc41e8'],
  ['ko-classmate-minjun', 'cc745b20-95e9-54e5-9a8e-538833a81d05'],
  ['uk-friend-oksana', '7e7fefbc-85fb-5350-b67a-69884b9eabc2'],
  ['pt-br-host-thiago', 'a7707ed8-e7fb-547f-bea1-71f2d4e7b32f'],
  ['pt-pt-pharmacist-ines', 'ae1ed086-9d6a-5575-a81c-4fcd95a021f8'],
  ['arz-taxi-driver-samir', '403f696f-d013-5eb2-ace8-bf5c96241753'],
  ['ar-levant-shopkeeper-rima', 'f5e8d1c4-14a8-5c1d-b90f-321d1a5d2dcf'],
  ['yue-teahouse-staff-ka-yan', 'c895becb-25e1-5a15-8f0d-8b621acadf40'],
  ['ht-teacher-manouchka', 'cf3b79ef-d0f0-54ac-9d59-216f8522b9df'],
  ['sw-matatu-conductor-brian', '97d2cc5a-4925-5c54-824c-2c98c5a4094f'],
  ['rw-guide-aline', 'fb1e454e-965e-5d51-a145-516264346024'],
  ['ln-musician-didier', 'a283519a-f0a8-5d93-955f-45b7b56d1834'],
];

/** Varieties whose names are normally written in a non-Latin script. */
const NON_LATIN_VARIETIES = new Set([
  'ar-levant',
  'ary',
  'arz',
  'arb',
  'yue',
  'cmn',
  'ja',
  'ko',
  'he',
  'hi',
  'el',
  'ru',
  'uk',
]);

describe('roster integrity', () => {
  it('has at least 90 characters with unique ids, uuids and names per variety', () => {
    expect(CHARACTER_ROSTER.length).toBeGreaterThanOrEqual(90);
    expect(new Set(CHARACTER_ROSTER.map((c) => c.id)).size).toBe(CHARACTER_ROSTER.length);
    expect(new Set(CHARACTER_ROSTER.map((c) => c.characterId)).size).toBe(CHARACTER_ROSTER.length);
    const names = new Set<string>();
    for (const c of CHARACTER_ROSTER) {
      const key = `${c.varietyId}:${c.name}`;
      expect(names.has(key), key).toBe(false);
      names.add(key);
    }
  });

  it('keeps the 16 legacy characters first with their seeded uuids', () => {
    expect(CHARACTER_ROSTER.slice(0, 16).map((c) => c.id)).toEqual([...LEGACY_ROSTER_IDS]);
    for (const [id, uuid] of LEGACY_UUIDS) {
      expect(stableCharacterUuid(id)).toBe(uuid);
      expect(findCharacter(id)?.characterId).toBe(uuid);
      expect(findCharacter(uuid)?.id).toBe(id);
    }
  });

  it('every entry is contract-valid, honest about review status and well formed', () => {
    const varieties = new Set(LANGUAGE_VARIETIES.map((v) => v.id));
    for (const c of CHARACTER_ROSTER) {
      const parsed = CharacterVisualProfileSchema.safeParse(c);
      expect(parsed.success, `${c.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(c.complete).toBe(false);
      expect(c.reviewStatus).toBe('review_needed');
      expect(c.id.startsWith(`${c.varietyId.toLowerCase()}-`), c.id).toBe(true);
      expect(c.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(varieties.has(c.varietyId), c.id).toBe(true);
      expect(c.trackIds.length).toBeGreaterThan(0);
      for (const t of c.trackIds) {
        const track = COURSE_TRACKS.find((x) => x.id === t);
        expect(track, `${c.id} track ${t}`).toBeDefined();
        expect(track!.targetVarietyId, `${c.id} track ${t}`).toBe(c.varietyId);
      }
      if (c.regionalOption) {
        const tracks = c.trackIds.map((t) => COURSE_TRACKS.find((x) => x.id === t)!);
        expect(
          tracks.some((t) => t.regionalOptions.some((o) => o.id === c.regionalOption)),
          `${c.id} regionalOption ${c.regionalOption}`,
        ).toBe(true);
      }
      expect(c.regionalOption).toBe(c.voice.regionalOption);
      expect(c.altText.length).toBeGreaterThan(20);
      expect(c.silhouetteNotes.length).toBeGreaterThan(10);
      expect(c.personality.length).toBeGreaterThan(10);
      expect(c.lifeContext.length).toBeGreaterThan(10);
      expect(c.voice.notes.length).toBeGreaterThan(10);
      expect(c.skinFamily).toBe(skinToneFamily(c.look.skin));
      expect(c.situations.length).toBeGreaterThanOrEqual(3);
      expect(c.intents.length).toBeGreaterThanOrEqual(5);
      if (NON_LATIN_VARIETIES.has(c.varietyId)) expect(c.nameNative, c.id).toBeTruthy();
      // Legacy art rule: no text, flags or logos — the look is only palette enums.
      expect(c.palette.length).toBe(5);
    }
  });

  it('every track has at least 3 characters', () => {
    for (const trackId of COURSE_TRACK_IDS) {
      expect(charactersForTrack(trackId).length, trackId).toBeGreaterThanOrEqual(3);
    }
  });

  it('never crosses variety boundaries', () => {
    expect(charactersForVariety('ary').map((c) => c.id)).toContain('ary-cafe-staff-nadia');
    expect(charactersForVariety('ary').every((c) => c.varietyId === 'ary')).toBe(true);
    expect(charactersForVariety('arb').some((c) => c.varietyId === 'ary')).toBe(false);
    expect(charactersForVariety('arb').length).toBeGreaterThanOrEqual(3);
  });
});

describe('diversity invariants (per track)', () => {
  it.each(COURSE_TRACK_IDS)(
    '%s: young + elder, both gender presentations, ≥ 2 skin families',
    (trackId) => {
      const cast = charactersForTrack(trackId);
      expect(cast.some((c) => c.ageBand === 'child' || c.ageBand === 'teen')).toBe(true);
      expect(cast.some((c) => c.ageBand === 'elder')).toBe(true);
      expect(new Set(cast.map((c) => c.genderPresentation)).size).toBe(2);
      expect(new Set(cast.map((c) => c.skinFamily)).size).toBeGreaterThanOrEqual(2);
    },
  );

  it('the whole cast spans all four age bands, both presentations and all four skin families', () => {
    expect(new Set(CHARACTER_ROSTER.map((c) => c.ageBand)).size).toBe(4);
    expect(new Set(CHARACTER_ROSTER.map((c) => c.genderPresentation)).size).toBe(2);
    expect(new Set(CHARACTER_ROSTER.map((c) => c.skinFamily)).size).toBe(4);
    const children = CHARACTER_ROSTER.filter((c) => c.ageBand === 'child');
    expect(children.length).toBeGreaterThanOrEqual(25);
    expect(new Set(children.map((c) => c.genderPresentation)).size).toBe(2);
  });
});

describe('situations ↔ curriculum intents', () => {
  const curriculumKeys = new Set<string>(INTENT_KEYS);

  it('every intent in the catalogue is a real curriculum intent key', () => {
    for (const tag of SITUATION_TAGS) {
      const s = CHARACTER_SITUATIONS[tag];
      expect(s.intents.length).toBeGreaterThanOrEqual(4);
      for (const key of s.intents) expect(curriculumKeys.has(key), `${tag}: ${key}`).toBe(true);
    }
  });

  it('every character intent resolves to the curriculum and derives from its situations', () => {
    for (const c of CHARACTER_ROSTER) {
      for (const key of c.intents) expect(curriculumKeys.has(key), `${c.id}: ${key}`).toBe(true);
      expect(c.intents).toEqual(intentsForSituations(c.situations));
      for (const tag of c.situations)
        expect(situationFitsAge(tag, c.ageBand), `${c.id}: ${tag}`).toBe(true);
    }
  });

  it('roles correlate with lesson situations (kids → ice cream, elders → directions, …)', () => {
    const children = CHARACTER_ROSTER.filter((c) => c.ageBand === 'child');
    expect(children.every((c) => c.situations.includes('ask_for_ice_cream'))).toBe(true);
    expect(children.every((c) => c.situations.includes('playground'))).toBe(true);
    expect(children.some((c) => c.situations.includes('office_meeting'))).toBe(false);
    expect(children.some((c) => c.situations.includes('taxi_destination'))).toBe(false);
    const elders = CHARACTER_ROSTER.filter((c) => c.ageBand === 'elder');
    expect(
      elders.filter((c) => c.situations.includes('ask_directions')).length,
    ).toBeGreaterThanOrEqual(15);
    expect(elders.every((c) => c.situations.includes('family_stories'))).toBe(true);
    const tailors = CHARACTER_ROSTER.filter((c) => c.situations.includes('tailor_suit'));
    expect(tailors.length).toBeGreaterThanOrEqual(5);
    expect(tailors.every((c) => c.ageBand === 'adult' || c.ageBand === 'elder')).toBe(true);
    const skirts = CHARACTER_ROSTER.filter((c) => c.situations.includes('clothing_skirt'));
    expect(skirts.length).toBeGreaterThanOrEqual(5);
    expect(skirts.some((c) => c.genderPresentation === 'feminine')).toBe(true);
    const taxis = CHARACTER_ROSTER.filter((c) => c.situations.includes('taxi_destination'));
    expect(taxis.every((c) => /taxi/i.test(c.role))).toBe(true);
    expect(taxis.length).toBeGreaterThanOrEqual(4);
  });

  it('charactersForIntent / charactersForSituation stay inside the variety', () => {
    const iceCream = charactersForIntent('ary', 'request_food');
    expect(iceCream.map((c) => c.id)).toContain('ary-schoolgirl-salma');
    expect(iceCream.every((c) => c.varietyId === 'ary')).toBe(true);
    expect(charactersForIntent('ary', 'hail_taxi')).toEqual([]);
    expect(charactersForIntent('arz', 'hail_taxi').map((c) => c.id)).toEqual([
      'arz-taxi-driver-samir',
    ]);
    expect(charactersForIntent('ja', 'no_such_intent')).toEqual([]);
    expect(charactersForSituation('fr', 'tailor_suit').map((c) => c.id)).toEqual([
      'fr-tailor-moussa',
    ]);
    expect(charactersForSituation('fr', 'not_a_tag')).toEqual([]);
    for (const v of LANGUAGE_VARIETIES) {
      // Every variety has someone who can give directions and someone who orders / sells.
      expect(charactersForIntent(v.id, 'ask_where_is').length, v.id).toBeGreaterThan(0);
      expect(charactersForIntent(v.id, 'greet_hello').length, v.id).toBeGreaterThan(0);
    }
  });
});

describe('mission ↔ cast matching', () => {
  const taxiMission = {
    steps: [
      { validIntentIds: ['hail_taxi', 'state_destination'] },
      { validIntentIds: ['ask_fare', 'hail_taxi', 'say_stop_here'] },
      { validIntentIds: [] },
    ],
  };

  it("flattens a mission's step intents once, in step order", () => {
    expect(missionIntentKeys(taxiMission)).toEqual([
      'hail_taxi',
      'state_destination',
      'ask_fare',
      'say_stop_here',
    ]);
    expect(missionIntentKeys(null)).toEqual([]);
    expect(missionIntentKeys({ steps: [{}] })).toEqual([]);
  });

  it('matches a character by roster entry, slug id or stable uuid', () => {
    const intents = missionIntentKeys(taxiMission);
    const samir = findCharacter('arz-taxi-driver-samir')!;
    expect(castMatchesMission(intents, samir)).toBe(true);
    expect(castMatchesMission(intents, samir.id)).toBe(true);
    expect(castMatchesMission(intents, samir.characterId)).toBe(true);
    expect(missionIntentsCovered(intents, samir)).toEqual(intents);
    // Salma (a schoolgirl) does not hail taxis.
    expect(castMatchesMission(intents, 'ary-schoolgirl-salma')).toBe(false);
    expect(missionIntentsCovered(intents, 'ary-schoolgirl-salma')).toEqual([]);
    // Partial coverage is still a match, reported in mission order.
    expect(missionIntentsCovered(['greet_hello', 'hail_taxi', 'greet_hello'], 'ary-schoolgirl-salma')).toEqual(['greet_hello']);
    expect(castMatchesMission(['greet_hello', 'hail_taxi'], 'ary-schoolgirl-salma')).toBe(true);
  });

  it('a mission without intents constrains nobody; an unknown character never matches', () => {
    expect(castMatchesMission([], 'ary-schoolgirl-salma')).toBe(true);
    expect(castMatchesMission([], 'no-such-character')).toBe(false);
    expect(castMatchesMission(['greet_hello'], 'no-such-character')).toBe(false);
    expect(missionIntentsCovered(['greet_hello'], 'no-such-character')).toEqual([]);
  });

  it("ranks a variety's cast by intent coverage and never crosses the variety", () => {
    const intents = missionIntentKeys(taxiMission);
    expect(charactersForMission('arz', intents).map((c) => c.id)).toEqual(['arz-taxi-driver-samir']);
    expect(charactersForMission('ary', intents)).toEqual([]);
    const everyone = charactersForMission('ary', []);
    expect(everyone).toEqual(charactersForVariety('ary'));
    const greet = charactersForMission('ary', ['greet_hello', 'request_food', 'ask_where_is']);
    expect(greet.length).toBeGreaterThan(0);
    expect(greet.every((c) => c.varietyId === 'ary')).toBe(true);
    const hits = greet.map((c) => missionIntentsCovered(['greet_hello', 'request_food', 'ask_where_is'], c).length);
    expect([...hits].sort((a, b) => b - a)).toEqual(hits);
    expect(hits.every((h) => h > 0)).toBe(true);
    // Every mission-declared character in the roster matches its mission by construction of the
    // situation catalogue: each variety has someone for the basics.
    for (const v of LANGUAGE_VARIETIES)
      expect(charactersForMission(v.id, ['greet_hello']).length, v.id).toBeGreaterThan(0);
  });
});

describe('clay portraits', () => {
  it.each(CHARACTER_ROSTER.map((c) => c.id))(
    '%s renders 9 distinct expressions in both themes',
    (id) => {
      const c = findCharacter(id)!;
      const variants = new Set<string>();
      for (const e of CHARACTER_EXPRESSIONS) {
        const svg = portraitSvgString(c, e, { size: 120 });
        expect(isSvg(svg)).toBe(true);
        expect(svg).toContain(`<title>${c.name}, `);
        expect(svg).not.toContain('<text');
        expect(svg).not.toContain('<filter');
        expect(svg.length).toBeLessThan(16 * KB);
        // C2 recipe: focal gradients + clipped rim light, no hard outlines.
        expect(svg).toContain('<radialGradient');
        expect(svg).toContain(RIM_COLOR);
        expect(svg).toContain('clip-path="url(#');
        expect(svg).not.toContain('stroke="#2B2522"');
        variants.add(svg);
      }
      expect(variants.size).toBe(CHARACTER_EXPRESSIONS.length);
      const dark = portraitSvgString(c, 'neutral', { theme: 'dark' });
      expect(isSvg(dark)).toBe(true);
      expect(dark).not.toEqual(portraitSvgString(c, 'neutral'));
      expect(dark).toContain('-d-skin');
    },
  );

  it('exposes exactly the 9 contract expressions', () => {
    expect(CHARACTER_EXPRESSIONS).toEqual(CHARACTER_EXPRESSION_VALUES);
  });

  it('switches to the flat two-value level of detail at or below 48 px', () => {
    expect(PORTRAIT_FLAT_MAX_SIZE).toBe(48);
    expect(portraitDetailForSize(48)).toBe('flat');
    expect(portraitDetailForSize(24)).toBe('flat');
    expect(portraitDetailForSize(49)).toBe('full');
    expect(portraitDetailForSize(undefined)).toBe('full');
    for (const c of CHARACTER_ROSTER) {
      for (const e of CHARACTER_EXPRESSIONS) {
        const flat = portraitSvgString(c, e, { size: 32 });
        expect(isSvg(flat)).toBe(true);
        expect(flat).toContain('width="32" height="32"');
        expect(flat).not.toContain('Gradient');
        expect(flat).not.toContain(RIM_COLOR);
        expect(flat.length).toBeLessThan(6 * KB);
        expect(countNodes(buildPortraitNodes(c, e, { detail: 'flat' }))).toBeLessThan(
          countNodes(buildPortraitNodes(c, e, { detail: 'full' })) / 2,
        );
      }
      // Explicit detail wins over size.
      expect(portraitSvgString(c, 'neutral', { size: 200, detail: 'flat' })).not.toContain(
        'Gradient',
      );
      expect(portraitSvgString(c, 'neutral', { size: 24, detail: 'full' })).toContain('Gradient');
    }
  });

  it('gradient ids are namespaced per character so portraits can share a DOM', () => {
    const a = portraitSvgString(findCharacter('ary-cafe-staff-nadia')!, 'neutral');
    const b = portraitSvgString(findCharacter('ary-schoolgirl-salma')!, 'neutral');
    expect(a).toContain('id="ary-cafe-staff-nadia-skin"');
    expect(b).toContain('id="ary-schoolgirl-salma-skin"');
    expect(a).not.toContain('ary-schoolgirl-salma');
  });

  it('children render with child proportions, elders with age lines', () => {
    const child = portraitSvgString(findCharacter('ary-schoolgirl-salma')!, 'neutral');
    const adult = portraitSvgString(findCharacter('ary-cafe-staff-nadia')!, 'neutral');
    expect(child).toContain('scale(1.1)');
    expect(child).toContain('scale(0.8 1)');
    expect(adult).toContain('scale(1)');
    expect(adult).not.toContain('scale(0.8 1)');
  });
});

describe('cast()', () => {
  it('derives tracks, intents, alt text and family from a compact sheet', () => {
    const c = cast({
      id: 'cmn-test-person',
      name: 'Test',
      role: 'Baker',
      city: 'Xi’an',
      region: 'China',
      varietyId: 'cmn',
      ageBand: 'elder',
      gender: 'feminine',
      personality: 'Kind and precise.',
      lifeContext: 'Bakes at dawn.',
      voice: { pitch: 'mid', pace: 'relaxed', warmth: 'warm', notes: 'Standard Mandarin.' },
      look: {
        skin: 's4',
        hair: 'bun',
        hairColor: 'grey',
        clothing: 'apron',
        clothColor: 'olive',
        clothAccent: 'sand',
      },
      situations: ['market_bargain', 'family_stories'],
    });
    expect(c.trackIds).toEqual(['chinese-mandarin', 'chinese-simplified']);
    expect(c.skinFamily).toBe('medium');
    expect(c.look.age).toBe('senior');
    expect(c.look.stature).toBe('adult');
    expect(c.intents).toEqual(intentsForSituations(['market_bargain', 'family_stories']));
    expect(c.altText).toBe(
      'Test, an older adult from Xi’an (baker) with grey hair in a bun, wearing an olive apron.',
    );
    expect(c.silhouetteNotes).toContain('hair in a bun');
    expect(c.characterId).toBe(stableCharacterUuid('cmn-test-person'));
    expect(CharacterVisualProfileSchema.safeParse(c).success).toBe(true);
    const tags: SituationTag[] = c.situations;
    expect(tags).toEqual(['market_bargain', 'family_stories']);
  });
});
