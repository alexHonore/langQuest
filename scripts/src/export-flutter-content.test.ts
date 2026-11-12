/**
 * export-flutter-content: the checked-in Flutter bundle matches a fresh export (so a curriculum edit without a
 * re-export fails here), every track has names, a cover and a native name, colloquial Arabic never gets a device
 * voice, every course's chapters are in a file of their own and the catalog says what each course is taught from,
 * every exported expression keeps its seed id and draft honesty, and every skill the API may report has an English
 * and a French name. Offline: reads source files only.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COURSE_TRACKS, LANGUAGE_VARIETIES } from '@langquest/contracts';
import { ALL_SKILL_KEYS, DRAFT_CHAPTERS, type SeedChapter } from '@langquest/curriculum';
import { describe, expect, it } from 'vitest';
import { BUNDLE_DIR, NATIVE_TRACK_NAMES, buildFlutterBundle, castRoles, courseSources, frenchTrackName, main, skillName, spec, staleChapterFiles } from './export-flutter-content';
import { memoryIo, runCli } from './lib/cli';
import { bundleChapterFiles, chaptersFileOf } from './lib/flutter-bundle';
import { repoRoot } from './lib/io';

type ExportedChapter = {
  key: string;
  courseTrackId: string;
  sourceLanguages: string[];
  nativeReviewed: boolean;
  missions: { key: string; situation: string; slots: unknown[]; expressions: { id: string; text: string; meanings: Record<string, { meaning: string }> }[] }[];
};

const root = repoRoot();
const files = buildFlutterBundle(root);
const catalog = JSON.parse(files['catalog.json']!) as {
  tracks: {
    id: string;
    names: { en: string; fr: string };
    nativeName: string;
    voiceLocale: string | null;
    targetVarietyId: string;
    cover: { hue: number };
    sources: string[];
    missionCounts: Record<string, number>;
  }[];
};
const courseFiles = Object.keys(files).filter((name) => name.startsWith('chapters/'));
const courses = new Map(courseFiles.map((name) => [name, JSON.parse(files[name]!) as { schemaVersion: number; courseTrackId: string; chapters: ExportedChapter[] }]));
const chapters = { chapters: [...courses.values()].flatMap((c) => c.chapters) };
const skills = JSON.parse(files['skills.json']!) as { skills: { key: string; cefr: string; names: { en: string; fr: string }; system: boolean }[] };
const cast = JSON.parse(files['cast.json']!) as { roles: Record<string, { en: string; fr: string }> };

describe('export-flutter-content', () => {
  it('the checked-in bundle is current (regenerate with `pnpm --filter @langquest/scripts export-flutter-content`)', () => {
    for (const [name, text] of Object.entries(files)) {
      expect(readFileSync(resolve(root, BUNDLE_DIR, name), 'utf8'), name).toBe(text);
    }
  });

  it('--check passes on the checked-in bundle', async () => {
    const io = memoryIo();
    expect(await runCli(spec, ['--check'], main, io)).toBe(0);
  });

  it('writes no monolithic chapters file and leaves no chapter file of a course without chapters', () => {
    expect(Object.keys(files)).not.toContain('chapters.json');
    expect(bundleChapterFiles(root)).toEqual([...courseFiles].sort());
    expect(staleChapterFiles(root, files)).toEqual([]);
    const scratch = mkdtempSync(join(tmpdir(), 'flutter-bundle-'));
    mkdirSync(join(scratch, BUNDLE_DIR, 'chapters'), { recursive: true });
    for (const name of ['spanish-spain.json', 'klingon.json', 'notes.txt']) writeFileSync(join(scratch, BUNDLE_DIR, 'chapters', name), '{}');
    expect(staleChapterFiles(scratch, files)).toEqual(['chapters/klingon.json']);
  });

  it('puts each course\'s chapters, in curriculum order, in a file of its own', () => {
    for (const [name, course] of courses) {
      expect(name).toBe(chaptersFileOf(course.courseTrackId));
      expect(course.schemaVersion).toBe(1);
      expect(course.chapters.map((c) => c.key)).toEqual(DRAFT_CHAPTERS.filter((c) => c.courseTrackId === course.courseTrackId).map((c) => c.key));
      for (const c of course.chapters) expect(c.courseTrackId, c.key).toBe(course.courseTrackId);
    }
    expect(new Set(chapters.chapters.map((c) => c.courseTrackId))).toEqual(new Set(DRAFT_CHAPTERS.map((c) => c.courseTrackId)));
  });

  it('lists in the catalog what each course is taught from and its missions there, so the app needs no chapters to offer it', () => {
    for (const t of catalog.tracks) {
      const own = chapters.chapters.filter((c) => c.courseTrackId === t.id);
      const expected = [...new Set(own.filter((c) => c.missions.length > 0).flatMap((c) => c.sourceLanguages))].sort();
      expect(t.sources, t.id).toEqual(expected);
      expect(Object.keys(t.missionCounts), t.id).toEqual(expected);
      for (const s of expected) expect(t.missionCounts[s], `${t.id} ${s}`).toBe(own.filter((c) => c.sourceLanguages.includes(s)).reduce((n, c) => n + c.missions.length, 0));
      expect(courses.has(chaptersFileOf(t.id)), t.id).toBe(own.length > 0);
    }
    expect(catalog.tracks.find((t) => t.id === 'english')?.sources).toEqual(['fr', 'ru']);
    expect(catalog.tracks.find((t) => t.id === 'french')?.sources).toEqual(['en']);
    // A chapter without missions makes no course of its instruction language.
    const empty: SeedChapter = { ...DRAFT_CHAPTERS[0]!, courseTrackId: 'japanese', sourceLanguages: ['de'], missions: [] };
    expect(courseSources([...DRAFT_CHAPTERS, empty], 'japanese').sources).not.toContain('de');
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
