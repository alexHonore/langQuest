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
 * - `ALL_SKILLS` (`@langquest/curriculum`) + `packages/locales/src/catalogs/{en,fr}.json` (`progress.skill.<key>`): the
 *   skills the API reports mastery for (`GET /v1/me/skills`), with their learner-facing names.
 * - `CHARACTER_ROSTER` (`@langquest/ui/art/web`) + the catalogs' `cast.role.<roster id>`: the cast's roles in English and
 *   French (the server's characters carry an English role only).
 *
 * Output is deterministic (no timestamps): `catalog.json` (30 tracks, each with the instruction languages it is taught
 * from and its mission count in each), `chapters/<trackId>.json` (the draft chapters of one course: the app loads only
 * the courses the learner takes, not every course at start-up), `skills.json` (skill names) and `cast.json` (character
 * roles). Expression ids are `seedExpressionId()` (`<chapter>:<mission>:<expression>`), the same keys the database
 * seed derives from. A chapter file no course needs any more is removed (`--check` reports it).
 *
 * Usage: pnpm --filter @langquest/scripts export-flutter-content [-- --check] [-- --dry-run]
 */
import { readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { COURSE_TRACKS, LANGUAGE_VARIETIES, type CourseTrack, type CourseTrackId } from '@langquest/contracts';
import { ALL_SKILLS, DRAFT_CHAPTERS, SYSTEM_SKILL_KEYS, findBlueprint, seedExpressionId, skillNameKey, type SeedChapter, type SeedExpression, type SeedMission, type Skill } from '@langquest/curriculum';
import { CHARACTER_ROSTER, COVER_RECIPES } from '@langquest/ui/art/web';
import { flagBool, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { BUNDLE_DIR, CHAPTERS_SUBDIR, bundleChapterFiles, chaptersFileOf, voicesFileOf } from './lib/flutter-bundle';
import { fileExists, repoRoot, writeTextFileSync } from './lib/io';

export { BUNDLE_DIR };
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

/**
 * The instruction languages a track is taught from (those with at least one mission, sorted) and its mission count in
 * each: what the app's course picker shows without loading the course's chapters.
 */
export function courseSources(chapters: readonly SeedChapter[], trackId: CourseTrackId): { sources: string[]; missionCounts: Record<string, number> } {
  const counts = new Map<string, number>();
  for (const chapter of chapters) {
    if (chapter.courseTrackId !== trackId) continue;
    for (const source of chapter.sourceLanguages) counts.set(source, (counts.get(source) ?? 0) + chapter.missions.length);
  }
  const sources = [...counts.entries()].filter(([, n]) => n > 0).map(([source]) => source).sort();
  return { sources, missionCounts: Object.fromEntries(sources.map((source) => [source, counts.get(source)!])) };
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
    ...courseSources(DRAFT_CHAPTERS, track.id),
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
    characters: chapter.characters.map((c) => ({ key: c.characterKey, name: c.name, role: c.role, personality: c.personality, homeRegion: c.homeRegion, ageBand: c.ageBand, voice: c.voice })),
    missions: chapter.missions.map((m) => missionEntry(chapter, m)),
  };
}

/** A skill's learner-facing name in a locale catalog (`progress.skill.<key>`; dotted skill keys nest). */
export function skillName(catalog: Record<string, unknown>, skillKey: string): string {
  let node: unknown = catalog;
  for (const part of skillNameKey(skillKey).split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  if (typeof node !== 'string' || !node.trim()) throw new Error(`no learner-facing name for skill ${skillKey} in a packages/locales catalog (${skillNameKey(skillKey)})`);
  return node;
}

function skillEntry(skill: Skill, catalogs: { en: Record<string, unknown>; fr: Record<string, unknown> }) {
  return {
    key: skill.skillKey,
    cefr: skill.cefrCanDo,
    names: { en: skillName(catalogs.en, skill.skillKey), fr: skillName(catalogs.fr, skill.skillKey) },
    /** An evidence dimension the API records outside mission goals (e.g. `speaking.intelligibility`), not a can-do skill. */
    system: SYSTEM_SKILL_KEYS.includes(skill.skillKey),
  };
}

/**
 * The cast's learner-facing roles (`cast.role.<roster id>` in the catalogs, hyphens written as underscores), keyed by
 * roster id. Every entry must name a roster character and have both an English and a French role.
 */
export function castRoles(catalogs: { en: Record<string, unknown>; fr: Record<string, unknown> }): Record<string, { en: string; fr: string }> {
  const rolesOf = (catalog: Record<string, unknown>): Record<string, unknown> => {
    const cast = catalog.cast as { role?: Record<string, unknown> } | undefined;
    return cast?.role ?? {};
  };
  const en = rolesOf(catalogs.en);
  const fr = rolesOf(catalogs.fr);
  const roster = new Set(CHARACTER_ROSTER.map((c) => c.id));
  const out: Record<string, { en: string; fr: string }> = {};
  for (const slug of Object.keys(en).sort()) {
    const id = slug.replace(/_/g, '-');
    if (!roster.has(id)) throw new Error(`cast.role.${slug} names no roster character (${id})`);
    const enRole = en[slug];
    const frRole = fr[slug];
    if (typeof enRole !== 'string' || !enRole.trim() || typeof frRole !== 'string' || !frRole.trim()) throw new Error(`cast.role.${slug} needs an English and a French role`);
    out[id] = { en: enRole, fr: frRole };
  }
  return out;
}

/**
 * Each course's voices, split from the `voices.json` that synthesize-bundle-audio writes, keyed by path relative to
 * {@link BUNDLE_DIR}: the app reads only the learner's courses' (a course without any clip yet has no file).
 */
export function buildVoiceFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const allVoices = readVoices(root);
  if (!allVoices) return files;
  for (const track of COURSE_TRACKS) {
    const ids = new Set(DRAFT_CHAPTERS.filter((c) => c.courseTrackId === track.id).flatMap((c) => c.missions.flatMap((m) => m.expressions.map((e) => seedExpressionId(c, m, e)))));
    const lines = Object.fromEntries(Object.entries(allVoices.lines).filter(([id]) => ids.has(id)).sort(([a], [b]) => a.localeCompare(b)));
    if (Object.keys(lines).length === 0) continue;
    const used = new Set(Object.values(lines).map((l) => l.voice));
    const voices = Object.fromEntries(Object.entries(allVoices.voices).filter(([id]) => used.has(id)));
    // The instruction languages whose narration is recorded for this course (`synthesize-narration`): the app reads
    // `narration/<lang>/<track>.json` only for these, so it never asks for a file that does not exist.
    const narration = ['en', 'fr'].filter((lang) => fileExists(resolve(root, BUNDLE_DIR, 'narration', lang, `${track.id}.json`)));
    files[voicesFileOf(track.id)] = `${JSON.stringify({ schemaVersion: 1, generatedBy: 'scripts/src/export-flutter-content.ts (from voices.json)', synthetic: true, courseTrackId: track.id, voices, lines, ...(narration.length ? { narration } : {}) }, null, 2)}\n`;
  }
  return files;
}

/** Every course's clips (`voices.json`, written by synthesize-bundle-audio), or null before any was recorded. */
function readVoices(root: string): { voices: Record<string, unknown>; lines: Record<string, { file: string; voice: string }> } | null {
  const path = resolve(root, BUNDLE_DIR, 'voices.json');
  if (!fileExists(path)) return null;
  const json = JSON.parse(readFileSync(path, 'utf8')) as { voices?: Record<string, unknown>; lines?: Record<string, { file: string; voice: string }> };
  return { voices: json.voices ?? {}, lines: json.lines ?? {} };
}

/** The bundle files, keyed by path relative to {@link BUNDLE_DIR}, as the exact text written to disk. Pure. */
export function buildFlutterBundle(root: string): Record<string, string> {
  const readCatalog = (lang: 'en' | 'fr') => JSON.parse(readFileSync(resolve(root, `packages/locales/src/catalogs/${lang}.json`), 'utf8')) as Record<string, unknown>;
  const enCatalog = readCatalog('en');
  const frCatalog = readCatalog('fr');
  const header = { schemaVersion: BUNDLE_SCHEMA_VERSION, generatedBy: 'scripts/src/export-flutter-content.ts' };
  const tracks = [...COURSE_TRACKS].sort((a, b) => a.order - b.order);
  const catalog = { ...header, tracks: tracks.map((t) => trackEntry(t, frCatalog as Parameters<typeof frenchTrackName>[0])) };
  const skills = { ...header, skills: ALL_SKILLS.map((sk) => skillEntry(sk, { en: enCatalog, fr: frCatalog })) };
  const cast = { ...header, roles: castRoles({ en: enCatalog, fr: frCatalog }) };
  const files: Record<string, string> = {
    'catalog.json': `${JSON.stringify(catalog, null, 2)}\n`,
    'skills.json': `${JSON.stringify(skills, null, 2)}\n`,
    'cast.json': `${JSON.stringify(cast, null, 2)}\n`,
  };
  // One file per course with chapters, in catalog order; its chapters in curriculum order.
  for (const track of tracks) {
    const own = DRAFT_CHAPTERS.filter((c) => c.courseTrackId === track.id);
    if (own.length === 0) continue;
    files[chaptersFileOf(track.id)] = `${JSON.stringify({ ...header, courseTrackId: track.id, chapters: own.map(chapterEntry) }, null, 2)}\n`;
  }
  Object.assign(files, buildVoiceFiles(root));
  return files;
}

/** Chapter files on disk that the bundle no longer has (a course without chapters any more), relative to BUNDLE_DIR. */
export function staleChapterFiles(root: string, files: Record<string, string>): string[] {
  return bundleChapterFiles(root).filter((file) => !(file in files));
}

export const spec: CliSpec = {
  name: 'export-flutter-content',
  summary: 'Writes the Flutter app content bundle (catalog, one draft-chapter file per course, skill names, cast roles) from contracts, ui, curriculum and locales.',
  flags: [{ name: 'check', type: 'boolean', description: 'Do not write; exit 1 when a bundle file differs from a fresh export.' }],
  examples: ['export-flutter-content', 'export-flutter-content -- --check'],
};

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const files = buildFlutterBundle(root);
  const courseFiles = Object.keys(files).filter((name) => name.startsWith(`${CHAPTERS_SUBDIR}/`));
  const chapters = courseFiles.flatMap((name) => (JSON.parse(files[name]!) as { chapters: { missions: { expressions: unknown[] }[] }[] }).chapters);
  const missions = chapters.flatMap((c) => c.missions);
  io.log(
    `flutter bundle: ${COURSE_TRACKS.length} tracks, ${courseFiles.length} course files, ${chapters.length} draft chapters, ${missions.length} missions, ${missions.reduce((n, m) => n + m.expressions.length, 0)} expressions, ${ALL_SKILLS.length} skills`,
  );
  let stale = 0;
  for (const name of staleChapterFiles(root, files)) {
    const out = resolve(root, BUNDLE_DIR, name);
    if (flagBool(args, 'check')) {
      io.error(`${relative(root, out)} is no longer part of the bundle; regenerate with: pnpm --filter @langquest/scripts export-flutter-content`);
      stale += 1;
    } else if (args.dryRun) {
      io.log(`dry-run: would remove ${relative(root, out)}`);
    } else {
      rmSync(out);
      io.log(`removed ${relative(root, out)}`);
    }
  }
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
