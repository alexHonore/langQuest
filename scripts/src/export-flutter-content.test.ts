/**
 * export-flutter-content: the checked-in Flutter bundle matches a fresh export (so a curriculum edit without a
 * re-export fails here), every track has names, a cover and a native name, colloquial Arabic never gets a device
 * voice, every exported expression keeps its seed id and draft honesty, and every skill the API may report has an
 * English and a French name. Offline: reads source files only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COURSE_TRACKS, LANGUAGE_VARIETIES } from '@langquest/contracts';
import { ALL_SKILL_KEYS, DRAFT_CHAPTERS } from '@langquest/curriculum';
import { describe, expect, it } from 'vitest';
import { BUNDLE_DIR, LEGACY_CHAPTERS_FILE, NATIVE_TRACK_NAMES, buildFlutterBundle, castRoles, chaptersFileOf, frenchTrackName, main, skillName, spec } from './export-flutter-content';
import { memoryIo, runCli } from './lib/cli';
import { repoRoot } from './lib/io';

const root = repoRoot();
const files = buildFlutterBundle(root);
const catalog = JSON.parse(files['catalog.json']!) as {
  tracks: { id: string; names: { en: string; fr: string }; nativeName: string; voiceLocale: string | null; targetVarietyId: string; cover: { hue: number }; sources: string[]; missionCounts: Record<string, number>; draft: boolean }[];
};
type BundleChapter = { key: string; courseTrackId: string; sourceLanguages: string[]; nativeReviewed: boolean; missions: { key: string; situation: string; slots: unknown[]; expressions: { id: string; text: string; meanings: Record<string, { meaning: string }> }[] }[] };
/** Every course's chapters file (`chapters/<track>.json`), in catalog order. */
const courseFiles = catalog.tracks.filter((t) => files[chaptersFileOf(t.id)]).map((t) => ({ trackId: t.id, ...(JSON.parse(files[chaptersFileOf(t.id)]!) as { courseTrackId: string; chapters: BundleChapter[] }) }));
const chapters = { chapters: courseFiles.flatMap((f) => f.chapters) };
const skills = JSON.parse(files['skills.json']!) as { skills: { key: string; cefr: string; names: { en: string; fr: string }; system: boolean }[] };
const cast = JSON.parse(files['cast.json']!) as { roles: Record<string, { en: string; fr: string }> };

describe('export-flutter-content', () => {
  it('the checked-in bundle is current (regenerate with `pnpm --filter @langquest/scripts export-flutter-content`)', () => {
    for (const [name, text] of Object.entries(files)) {
      expect(readFileSync(resolve(root, BUNDLE_DIR, name), 'utf8'), name).toBe(text);
    }
  });

  it('one chapters file per course, holding only that course; the catalog says what each course offers before it is loaded', () => {
    expect(files[LEGACY_CHAPTERS_FILE]).toBeUndefined();
    expect(existsSync(resolve(root, BUNDLE_DIR, LEGACY_CHAPTERS_FILE))).toBe(false);
    expect(courseFiles).toHaveLength(30);
    for (const f of courseFiles) {
      expect(f.courseTrackId).toBe(f.trackId);
      expect(f.chapters.every((c) => c.courseTrackId === f.trackId), f.trackId).toBe(true);
      const t = catalog.tracks.find((x) => x.id === f.trackId)!;
      expect(t.sources, f.trackId).toEqual([...new Set(f.chapters.flatMap((c) => c.sourceLanguages))].sort());
      for (const s of t.sources) expect(t.missionCounts[s], `${f.trackId} ${s}`).toBe(f.chapters.filter((c) => c.sourceLanguages.includes(s)).reduce((n, c) => n + c.missions.length, 0));
      expect(t.draft, f.trackId).toBe(f.chapters.some((c) => !c.nativeReviewed));
    }
    expect(catalog.tracks.find((t) => t.id === 'russian')).toMatchObject({ sources: ['en', 'fr'], missionCounts: { en: 7, fr: 7 }, draft: true });
    expect(catalog.tracks.find((t) => t.id === 'english')?.sources).toEqual(['fr', 'ru']);
  });

  it('--check passes on the checked-in bundle', async () => {
    const io = memoryIo();
    expect(await runCli(spec, ['--check'], main, io)).toBe(0);
  });

  it('exports all 30 tracks with English and French names, a native name and a cover hue', () => {
    expect(catalog.tracks.map((t) => t.id)).toEqual([...COURSE_TRACKS].sort((a, b) => a.order - b.order).map((t) => t.id));
    for (const t of catalog.tracks) {
      expect(t.names.en.length, t.id).toBeGreaterThan(1);
      expect(t.names.fr.length, t.id).toBeGreaterThan(1);
      expect(t.nativeName, t.id).toBe(NATIVE_TRACK_NAMES[t.id as keyof typeof NATIVE_TRACK_NAMES]);
      expect(t.cover.hue, t.id).toBeGreaterThanOrEqual(0);
    }
    expect(catalog.tracks.find((t) => t.id === 'arabic-moroccan')?.names.fr).toBe('Arabe (marocain)');
    expect(catalog.tracks.find((t) => t.id === 'hebrew')?.nativeName).toBe('עברית');
  });

  it('never gives a colloquial Arabic course a device voice (phone Arabic voices speak MSA)', () => {
    for (const t of catalog.tracks) {
      const variety = LANGUAGE_VARIETIES.find((v) => v.id === t.targetVarietyId)!;
      if (variety.mustNotSubstitute.includes('arb')) expect(t.voiceLocale, t.id).toBeNull();
    }
    expect(catalog.tracks.find((t) => t.id === 'spanish-spain')?.voiceLocale).toBe('es-ES');
  });

  it('exports every draft chapter, mission and expression with its seed id, situation and meanings', () => {
    expect(chapters.chapters.map((c) => c.key).sort()).toEqual(DRAFT_CHAPTERS.map((c) => c.key).sort());
    for (const chapter of chapters.chapters) {
      const seed = DRAFT_CHAPTERS.find((c) => c.key === chapter.key)!;
      expect(chapter.nativeReviewed).toBe(false);
      for (const [mi, mission] of chapter.missions.entries()) {
        expect(mission.situation.length, mission.key).toBeGreaterThan(0);
        expect(mission.slots.length, mission.key).toBeGreaterThan(0);
        expect(mission.expressions.length, mission.key).toBe(seed.missions[mi]!.expressions.length);
        for (const e of mission.expressions) {
          expect(e.id.startsWith(`${chapter.key}:${mission.key}:`), e.id).toBe(true);
          expect(e.text.length, e.id).toBeGreaterThan(0);
          for (const src of seed.sourceLanguages) expect(e.meanings[src]?.meaning, `${e.id} ${src}`).toBeTruthy();
        }
      }
    }
  });

  it('refuses a catalog without a parsable French name', () => {
    expect(() => frenchTrackName({ catalog: { cover: {} } }, 'japanese')).toThrow(/no French course name/);
  });

  it('exports every skill the API may report, with its CEFR band and English and French names', () => {
    expect(skills.skills.map((s) => s.key)).toEqual([...ALL_SKILL_KEYS]);
    for (const s of skills.skills) {
      expect(s.cefr, s.key).toMatch(/^[ABC][12]$/);
      expect(s.names.en.length, s.key).toBeGreaterThan(1);
      expect(s.names.fr.length, s.key).toBeGreaterThan(1);
    }
    const byKey = new Map(skills.skills.map((s) => [s.key, s]));
    expect(byKey.get('greet_politely')?.names).toEqual({ en: 'Greet someone politely', fr: 'Saluer poliment' });
    expect(byKey.get('speaking.intelligibility')).toMatchObject({ system: true, names: { en: 'Be understood when speaking' } });
    expect(byKey.get('greet_politely')?.system).toBe(false);
  });

  it('exports the cast\'s roles in English and French, keyed by roster id', () => {
    expect(cast.roles['ary-cafe-staff-nadia']).toEqual({ en: 'Café staff', fr: 'Employée de café' });
    expect(cast.roles['ja-neighbour-haruka']?.fr).toBe('Voisine');
    expect(Object.keys(cast.roles).length).toBeGreaterThanOrEqual(14);
    expect(() => castRoles({ en: { cast: { role: { no_such_character: 'X' } } }, fr: {} })).toThrow(/names no roster character/);
    expect(() => castRoles({ en: { cast: { role: { es_es_schoolboy_pablo: 'Schoolboy' } } }, fr: { cast: { role: {} } } })).toThrow(/needs an English and a French role/);
  });

  it('refuses a skill without a learner-facing name (dotted keys nest)', () => {
    expect(skillName({ progress: { skill: { speaking: { intelligibility: 'Be understood' } } } }, 'speaking.intelligibility')).toBe('Be understood');
    expect(() => skillName({ progress: { skill: {} } }, 'greet_politely')).toThrow(/no learner-facing name for skill greet_politely/);
  });
});
