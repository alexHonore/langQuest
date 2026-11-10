/**
 * export-flutter-content: the checked-in Flutter bundle matches a fresh export (so a curriculum edit without a
 * re-export fails here), every track has names, a cover and a native name, colloquial Arabic never gets a device
 * voice, and every exported expression keeps its seed id and draft honesty. Offline: reads source files only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COURSE_TRACKS, LANGUAGE_VARIETIES } from '@langquest/contracts';
import { DRAFT_CHAPTERS } from '@langquest/curriculum';
import { describe, expect, it } from 'vitest';
import { BUNDLE_DIR, NATIVE_TRACK_NAMES, buildFlutterBundle, frenchTrackName, main, spec } from './export-flutter-content';
import { memoryIo, runCli } from './lib/cli';
import { repoRoot } from './lib/io';

const root = repoRoot();
const files = buildFlutterBundle(root);
const catalog = JSON.parse(files['catalog.json']!) as {
  tracks: { id: string; names: { en: string; fr: string }; nativeName: string; voiceLocale: string | null; targetVarietyId: string; cover: { hue: number } }[];
};
const chapters = JSON.parse(files['chapters.json']!) as {
  chapters: { key: string; nativeReviewed: boolean; missions: { key: string; situation: string; slots: unknown[]; expressions: { id: string; text: string; meanings: Record<string, { meaning: string }> }[] }[] }[];
};

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
    expect(chapters.chapters.map((c) => c.key)).toEqual(DRAFT_CHAPTERS.map((c) => c.key));
    for (const [ci, chapter] of chapters.chapters.entries()) {
      const seed = DRAFT_CHAPTERS[ci]!;
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
});
