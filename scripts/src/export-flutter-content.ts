#!/usr/bin/env tsx
/**
 * export-flutter-content — writes the offline content bundle of the Flutter learner app
 * (`apps/mobile_flutter/assets/content/`) from the shared packages, so the Flutter app teaches the same
 * honestly-labelled draft curriculum as the API and never carries hand-copied content of its own.
 *
 * Sources, in order of authority:
 * - `COURSE_TRACKS` / `LANGUAGE_VARIETIES` (`@langquest/contracts`): ids, names, scripts, regional options, variety
 *   boundaries (`mustNotSubstitute`).
 * - `COVER_RECIPES` (`@langquest/ui/art/web`): the per-course hues the U2 "Night Market" accent is derived from.
 * - `packages/locales/src/catalogs/fr.json` (`catalog.cover.<slug>`): the French course names (the only place they exist).
 * - `DRAFT_CHAPTERS` + blueprints (`@langquest/curriculum`): chapters, missions, expressions, characters. Every
 *   chapter is an AI draft with `nativeReviewed: false`; the app discloses that before enrolling.
 *
 * Output is deterministic (no timestamps): `catalog.json` (30 tracks) and `chapters.json` (draft chapters). Expression
 * ids are `seedExpressionId()` (`<chapter>:<mission>:<expression>`), the same keys the database seed derives from.
 *
 * Usage: pnpm --filter @langquest/scripts export-flutter-content [-- --check] [-- --dry-run]
 */
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { COURSE_TRACKS, LANGUAGE_VARIETIES, type CourseTrack, type CourseTrackId } from '@langquest/contracts';
import { DRAFT_CHAPTERS, findBlueprint, seedExpressionId, type SeedChapter, type SeedExpression, type SeedMission } from '@langquest/curriculum';
import { COVER_RECIPES } from '@langquest/ui/art/web';
import { flagBool, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { fileExists, repoRoot, writeTextFileSync } from './lib/io';

export const BUNDLE_DIR = 'apps/mobile_flutter/assets/content';
export const BUNDLE_SCHEMA_VERSION = 1;

/**
 * Native-script course names shown under the course name. Not in `@langquest/contracts` (its `LANGUAGES` table is
 * per language, not per variety), so they are kept here, next to the only consumer.
 */
export const NATIVE_TRACK_NAMES: Readonly<Record<CourseTrackId, string>> = {
  'arabic-eastern': 'العربية (الشامية)',
  'arabic-moroccan': 'الدارجة المغربية',
  'arabic-egyptian': 'العامية المصرية',
  'arabic-msa': 'العربية الفصحى',
  'chinese-cantonese': '廣東話',
  'chinese-mandarin': '普通话',
  'chinese-simplified': '简体中文',
  english: 'English',
  danish: 'Dansk',
  french: 'Français',
  german: 'Deutsch',
  greek: 'Ελληνικά',
  'haitian-creole': 'Kreyòl ayisyen',
  hebrew: 'עברית',
  hindi: 'हिन्दी',
  italian: 'Italiano',
  japanese: '日本語',
  korean: '한국어',
  'portuguese-brazilian': 'Português do Brasil',
  'portuguese-european': 'Português Europeu',
  romanian: 'Română',
  russian: 'Русский',
  'spanish-latin-american': 'Español latinoamericano',
  'spanish-spain': 'Español de España',
  swahili: 'Kiswahili',
  kinyarwanda: 'Ikinyarwanda',
  swedish: 'Svenska',
  lingala: 'Lingála',
  ukrainian: 'Українська',
  vietnamese: 'Tiếng Việt',
};

/**
 * Colloquial Arabic varieties have no on-device voice: phone Arabic voices speak Modern Standard Arabic, and MSA must
 * never stand in for a dialect (`mustNotSubstitute`, ADR-006 §variety boundary). Their courses get no device voice.
 */
const NO_DEVICE_VOICE_VARIETIES: ReadonlySet<string> = new Set(['ar-levant', 'ary', 'arz']);

/** The French course name, read from the cover alt text `Couverture du cours d’<name> : …` (all 30 parse). */
export function frenchTrackName(frCatalog: { catalog?: { cover?: Record<string, string> } }, trackId: CourseTrackId): string {
  const alt = frCatalog.catalog?.cover?.[trackId.replace(/-/g, '_')];
  const match = alt?.match(/cours (?:d’|d'|de |du )(.+?) :/);
  if (!match?.[1]) throw new Error(`no French course name for ${trackId} in packages/locales fr.json catalog.cover`);
  return match[1].charAt(0).toLocaleUpperCase('fr') + match[1].slice(1);
}

function trackEntry(track: CourseTrack, frCatalog: Parameters<typeof frenchTrackName>[0]) {
  const recipe = COVER_RECIPES.find((r) => r.trackId === track.id);
  if (!recipe) throw new Error(`no cover recipe for ${track.id}`);
  const variety = LANGUAGE_VARIETIES.find((v) => v.id === track.targetVarietyId);
  if (!variety) throw new Error(`no variety ${track.targetVarietyId}`);
  return {
    id: track.id,
    order: track.order,
    names: { en: track.displayName, fr: frenchTrackName(frCatalog, track.id) },
    nativeName: NATIVE_TRACK_NAMES[track.id],
    languageCode: track.languageCode,
    targetVarietyId: track.targetVarietyId,
    varietyName: variety.name,
    mustNotSubstitute: variety.mustNotSubstitute,
    defaultLocale: track.defaultLocale,
    /** BCP-47 tag for the phone's speech synthesizer, or null when no device voice may speak this variety. */
    voiceLocale: NO_DEVICE_VOICE_VARIETIES.has(track.targetVarietyId) ? null : track.defaultLocale,
    primaryScript: track.scripts.primary,
    transliterations: track.scripts.transliterations,
    defaultScriptMode: track.defaultScriptMode,
    tonal: track.tonal,
    teachingFocus: track.teachingFocus,
    regionalOptions: track.regionalOptions,
    automatedScoringSupport: track.automatedScoringSupport,
    cover: { hue: recipe.hue, hue2: recipe.hue2, motif: recipe.motif, variant: recipe.variant },
  };
}

function expressionEntry(chapter: SeedChapter, mission: SeedMission, e: SeedExpression) {
  return {
    id: seedExpressionId(chapter, mission, e),
    key: e.key,
    intentKey: e.intentKey,
    slotId: e.slotId,
    speaker: e.speaker,
    text: e.targetText,
    forms: e.forms.map((f) => ({ script: f.script, scheme: f.transliterationScheme, text: f.text })),
    meanings: Object.fromEntries(
      Object.entries(e.meanings).map(([lang, m]) => [lang, { meaning: m!.meaning, note: m!.contextNote, literal: m!.literalGloss }]),
    ),
    register: e.register,
    codeSwitchNote: e.codeSwitchNote,
    pronunciationNote: e.pronunciationNote,
  };
}

function missionEntry(chapter: SeedChapter, mission: SeedMission) {
  const bp = findBlueprint(mission.blueprintKey);
  if (!bp) throw new Error(`unknown blueprint ${mission.blueprintKey} in ${mission.key}`);
  return {
    key: mission.key,
    blueprintKey: mission.blueprintKey,
    missionType: bp.missionType,
    level: bp.level,
    situation: bp.situation,
    characterKey: mission.characterKey,
    titles: mission.titles,
    sceneNotes: mission.sceneNotes,
    slots: bp.slots.map((s) => ({ slotId: s.slotId, speaker: s.speaker })),
    expressions: mission.expressions.filter((e) => e.targetText !== null).map((e) => expressionEntry(chapter, mission, e)),
  };
}

function chapterEntry(chapter: SeedChapter) {
  return {
    key: chapter.key,
    chapterIndex: chapter.chapterIndex,
    courseTrackId: chapter.courseTrackId,
    targetVarietyId: chapter.targetVarietyId,
    sourceLanguages: chapter.sourceLanguages,
    titles: chapter.titles,
    provenance: chapter.provenance,
    nativeReviewed: chapter.nativeReviewed,
    reviewStatus: chapter.reviewStatus,
    generatedBy: chapter.generatedBy,
    notes: chapter.notes,
    characters: chapter.characters.map((c) => ({ key: c.characterKey, name: c.name, role: c.role, personality: c.personality, homeRegion: c.homeRegion, ageBand: c.ageBand })),
    missions: chapter.missions.map((m) => missionEntry(chapter, m)),
  };
}

/** The two bundle files, keyed by file name, as the exact text written to disk. Pure. */
export function buildFlutterBundle(root: string): Record<string, string> {
  const frCatalog = JSON.parse(readFileSync(resolve(root, 'packages/locales/src/catalogs/fr.json'), 'utf8')) as Parameters<typeof frenchTrackName>[0];
  const header = { schemaVersion: BUNDLE_SCHEMA_VERSION, generatedBy: 'scripts/src/export-flutter-content.ts' };
  const catalog = { ...header, tracks: [...COURSE_TRACKS].sort((a, b) => a.order - b.order).map((t) => trackEntry(t, frCatalog)) };
  const chapters = { ...header, chapters: DRAFT_CHAPTERS.map(chapterEntry) };
  return {
    'catalog.json': `${JSON.stringify(catalog, null, 2)}\n`,
    'chapters.json': `${JSON.stringify(chapters, null, 2)}\n`,
  };
}

export const spec: CliSpec = {
  name: 'export-flutter-content',
  summary: 'Writes the Flutter app content bundle (catalog + draft chapters) from contracts, ui and curriculum.',
  flags: [{ name: 'check', type: 'boolean', description: 'Do not write; exit 1 when a bundle file differs from a fresh export.' }],
  examples: ['export-flutter-content', 'export-flutter-content -- --check'],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const files = buildFlutterBundle(root);
  const chapters = JSON.parse(files['chapters.json']!) as { chapters: { missions: { expressions: unknown[] }[] }[] };
  const missions = chapters.chapters.flatMap((c) => c.missions);
  io.log(`flutter bundle: ${COURSE_TRACKS.length} tracks, ${chapters.chapters.length} draft chapters, ${missions.length} missions, ${missions.reduce((n, m) => n + m.expressions.length, 0)} expressions`);
  let stale = 0;
  for (const [name, text] of Object.entries(files)) {
    const out = resolve(root, BUNDLE_DIR, name);
    if (flagBool(args, 'check')) {
      const current = fileExists(out) ? readFileSync(out, 'utf8') : '';
      if (current !== text) {
        io.error(`${relative(root, out)} is stale; regenerate with: pnpm --filter @langquest/scripts export-flutter-content`);
        stale += 1;
      } else {
        io.log(`${relative(root, out)} is up to date`);
      }
    } else if (args.dryRun) {
      io.log(`dry-run: would write ${relative(root, out)} (${text.length} bytes)`);
    } else {
      writeTextFileSync(out, text);
      io.log(`wrote ${relative(root, out)}`);
    }
  }
  return stale > 0 ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
