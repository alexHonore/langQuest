#!/usr/bin/env tsx
/**
 * import-factory-chapters — turns content-factory chapter drafts (chapter 1, written from English) into the curriculum's
 * generated chapters, and gives English-only hand-authored chapters their French learner-facing text.
 *
 * For each draft (`<track>-en-chapter-*.json` written by `content-factory --source en`):
 *  - one model call per mission (`content_generation`) adds the French text a learner from French reads: the meaning of
 *    each phrase (translated from the target phrase itself, the English only as a guide), a short context note (folding
 *    in the pronunciation tip, which is English-only on the expression), a literal gloss when the English has one, the
 *    mission title and scene note — and the voice (female/male) of the mission's character, for the bundled voices;
 *  - the chapter is written to `packages/curriculum/src/content/generated/<track>.json` with sources `en` + `fr`
 *    (`en` only for the French course), still `ai_draft` / `review_needed` / `nativeReviewed: false`;
 *  - `--copy chinese-simplified=chinese-mandarin` reuses a chapter for a track that shares its assets.
 * With `--overlay <track,…>`, the hand-authored chapter of each track gets the same French pass, written to
 * `packages/curriculum/src/content/overlays/<chapter key>.fr.json` (merged by the chapter's module).
 *
 * The target-language phrases are never changed here. Paid calls only with `--live` (or LANGQUEST_LIVE_TESTS=1), capped
 * by `--max-usd`.
 *
 * Usage: pnpm --filter @langquest/scripts import-factory-chapters -- --drafts <dir> [--tracks russian,…] [--overlay spanish-spain,japanese] [--copy chinese-simplified=chinese-mandarin] --live
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { COURSE_TRACK_IDS, getCourseTrack, type CourseTrackId, type TextReasoner } from '@langquest/contracts';
import { DRAFT_CHAPTERS, defineSeedChapter, type SeedChapter, type SeedChapterInput, type SeedMission } from '@langquest/curriculum';
import { MemoryAiRequestSink, ModelProfileRegistry, OpenRouterClient } from '@langquest/ai';
import { flagBool, flagList, flagNumber, flagString, isDirectRun, runCli, CliUsageError, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { resolveTarget } from './lib/content-factory';
import { ScriptsTextReasoner } from './lib/reasoner';
import { loadRootEnv, repoRoot } from './lib/io';

export const spec: CliSpec = {
  name: 'import-factory-chapters',
  summary: 'Import content-factory chapter drafts into the curriculum with French learner text; French overlays for English-only chapters.',
  flags: [
    { name: 'drafts', type: 'string', description: 'Directory of content-factory chapter drafts (<track>-en-chapter-*.json).' },
    { name: 'tracks', type: 'list', description: 'Tracks to import (default: every draft found).' },
    { name: 'overlay', type: 'list', description: 'Tracks whose hand-authored chapter gets a French overlay.' },
    { name: 'copy', type: 'list', description: 'target=source pairs: write the source track chapter for the target track (shared assets).' },
    { name: 'live', type: 'boolean', description: 'Allow paid model calls (also LANGQUEST_LIVE_TESTS=1).', default: false },
    { name: 'max-usd', type: 'number', description: 'Hard spend cap for the run.', default: 4 },
    { name: 'model', type: 'string', description: 'Override the model for the French pass.' },
    { name: 'concurrency', type: 'number', description: 'Chapters translated at once.', default: 4 },
  ],
  examples: ['import-factory-chapters -- --drafts data/drafts/content-factory --dry-run', 'import-factory-chapters -- --drafts data/drafts/content-factory --tracks russian --live', 'import-factory-chapters -- --overlay spanish-spain,japanese --live'],
};

export const GENERATED_DIR = 'packages/curriculum/src/content/generated';
export const OVERLAY_DIR = 'packages/curriculum/src/content/overlays';
const FR_TEMPLATE_VERSION = '2026-11-11.1';

export const MissionFrSchema = z.object({
  title: z.string().min(1),
  sceneNote: z.string().min(1),
  characterVoice: z.enum(['female', 'male']),
  expressions: z.array(z.object({ key: z.string(), meaning: z.string().min(1), contextNote: z.string().nullable(), literalGloss: z.string().nullable() })),
});
export type MissionFr = z.infer<typeof MissionFrSchema>;

export const ChapterTitleSchema = z.object({ en: z.string().min(1), fr: z.string().min(1) });
export type ChapterTitles = z.infer<typeof ChapterTitleSchema>;

/** The chapter's title in English and French (the drafts carry the story arc's title key, which no screen can show). */
export async function chapterTitles(reasoner: TextReasoner, chapter: SeedChapter): Promise<ChapterTitles> {
  const places = [...new Set(chapter.characters.map((c) => c.homeRegion.split(',')[0]!.trim()).filter(Boolean))].slice(0, 3);
  const system = 'You name chapters of a conversation-first language app. Return only JSON {"en": …, "fr": …}: the same short title (at most 5 words) in English and in natural French. No quotes, no chapter number.';
  const user = `Chapter 1 of the ${languageName(chapter.courseTrackId)} course: the learner's first days in ${places.join(' / ') || 'a city where the language is spoken'} — greeting people, ordering a drink, asking prices and directions, meeting a neighbour, taking a taxi. Example style: "First days in Tokyo" / "Premiers jours à Tokyo".`;
  return reasoner.generateStructured('content_generation', resolveTarget(chapter.courseTrackId, 'fr').context, { templateId: 'import.chapter_title', templateVersion: FR_TEMPLATE_VERSION, system, user }, ChapterTitleSchema);
}

export const CharacterVoicesSchema = z.object({ voices: z.array(z.object({ characterKey: z.string(), voice: z.enum(['female', 'male']) })) });

/** The voice of each character (for a chapter that gets no French pass, which otherwise decides it per mission). */
export async function characterVoices(reasoner: TextReasoner, chapter: SeedChapter): Promise<Record<string, 'female' | 'male'>> {
  const system = 'Return only JSON {"voices": [{"characterKey", "voice"}]}: for each character, "female" or "male", from the name and role. One entry per character given.';
  const user = JSON.stringify(chapter.characters.map((c) => ({ characterKey: c.characterKey, name: c.name, role: c.role })));
  const out = await reasoner.generateStructured('content_generation', resolveTarget(chapter.courseTrackId, 'en').context, { templateId: 'import.character_voices', templateVersion: FR_TEMPLATE_VERSION, system, user }, CharacterVoicesSchema);
  return Object.fromEntries(out.voices.filter((v) => chapter.characters.some((c) => c.characterKey === v.characterKey)).map((v) => [v.characterKey, v.voice]));
}

/** French text for one mission: what `withSourceOverlay` merges (and the generated chapters carry inline). */
export interface MissionOverlay {
  title: string;
  sceneNote: string;
  expressions: Record<string, { meaning: string; contextNote: string | null; literalGloss: string | null }>;
}
export interface ChapterOverlay {
  source: 'fr';
  /** The chapter title in French (set for overlays of hand-authored chapters). */
  title?: string;
  generatedBy: string;
  missions: Record<string, MissionOverlay>;
}

const languageName = (track: CourseTrackId): string => getCourseTrack(track).displayName;

export function buildFrPrompt(chapter: SeedChapter, mission: SeedMission): { system: string; user: string } {
  const character = chapter.characters.find((c) => c.characterKey === mission.characterKey);
  const name = languageName(chapter.courseTrackId);
  const system = [
    `You localise the learner-facing notes of a conversation-first language app from English into natural, concise French (France), for a French-speaking beginner learning ${name} (${chapter.targetVarietyId}).`,
    `For each phrase you get the ${name} text, its transliteration when there is one, and the English notes. Translate the MEANING from the ${name} phrase itself; the English is only a guide. Use idiomatic French in the same register as the phrase (tu/vous matching its politeness).`,
    '"contextNote": one short French note combining the English context note and pronunciation tip when they add something useful, else null. Never mention English or English words.',
    '"literalGloss": a word-by-word French gloss only when the English has one, else null.',
    `Never translate, correct or rewrite the ${name} phrases. "title": the mission title, at most 6 words. "sceneNote": one sentence that sets the scene for the learner (vouvoiement). "characterVoice": "female" or "male", from the character's name and role.`,
    'Return only JSON matching the schema, with exactly one entry per phrase key given, in the same order.',
  ].join('\n');
  const user = JSON.stringify({
    title: mission.titles.en,
    sceneNote: mission.sceneNotes.en ?? null,
    character: character ? { name: character.name, role: character.role, homeRegion: character.homeRegion } : null,
    phrases: mission.expressions.map((e) => ({
      key: e.key,
      speaker: e.speaker,
      text: e.targetText,
      transliteration: e.forms.find((f) => f.transliterationScheme && f.transliterationScheme !== 'furigana')?.text ?? null,
      register: e.register,
      meaning: e.meanings.en?.meaning ?? null,
      contextNote: e.meanings.en?.contextNote ?? null,
      literalGloss: e.meanings.en?.literalGloss ?? null,
      pronunciationTip: e.pronunciationNote,
    })),
  });
  return { system, user };
}

/** Checks a French reply covers exactly the mission's phrase keys. */
export function checkMissionFr(mission: SeedMission, fr: MissionFr): string[] {
  const want = mission.expressions.map((e) => e.key);
  const got = fr.expressions.map((e) => e.key);
  const missing = want.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !want.includes(k));
  return [...missing.map((k) => `missing ${k}`), ...extra.map((k) => `unexpected ${k}`)];
}

export async function translateMission(reasoner: TextReasoner, chapter: SeedChapter, mission: SeedMission): Promise<MissionFr> {
  const { system, user } = buildFrPrompt(chapter, mission);
  const context = resolveTarget(chapter.courseTrackId, 'fr').context;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fr = await reasoner.generateStructured('content_generation', context, { templateId: 'import.fr_overlay', templateVersion: FR_TEMPLATE_VERSION, system, user }, MissionFrSchema);
    const problems = checkMissionFr(mission, fr);
    if (problems.length === 0) return fr;
    if (attempt === 1) throw new Error(`${mission.key}: French text does not match the phrases (${problems.join(', ')})`);
  }
  throw new Error('unreachable');
}

export function overlayFromFr(missions: ReadonlyArray<{ mission: SeedMission; fr: MissionFr }>, generatedBy: string): ChapterOverlay {
  return {
    source: 'fr',
    generatedBy,
    missions: Object.fromEntries(
      missions.map(({ mission, fr }) => [
        mission.key,
        { title: fr.title.trim(), sceneNote: fr.sceneNote.trim(), expressions: Object.fromEntries(fr.expressions.map((e) => [e.key, { meaning: e.meaning.trim(), contextNote: e.contextNote?.trim() || null, literalGloss: e.literalGloss?.trim() || null }])) },
      ]),
    ),
  };
}

/** The draft chapter as the curriculum stores it: stable key, sources en(+fr), the French text and character voices merged. */
export function curriculumChapter(draft: SeedChapter, overlay: ChapterOverlay | null, voices: Record<string, 'female' | 'male'>, generatedBy: string, titles: ChapterTitles): SeedChapterInput {
  const slug = draft.courseTrackId.replace(/-/g, '_');
  const sources = overlay ? (['en', 'fr'] as const) : (['en'] as const);
  const chapter: SeedChapterInput = {
    ...draft,
    key: `${slug}_ch1`,
    sourceLanguages: [...sources],
    titles: Object.fromEntries(sources.map((s) => [s, titles[s]])),
    characters: draft.characters.map((c) => ({ ...c, voice: voices[c.characterKey] ?? c.voice ?? null })),
    missions: draft.missions.map((m) => {
      const o = overlay?.missions[m.key];
      return {
        ...m,
        titles: { ...m.titles, ...(o ? { fr: o.title } : {}) },
        sceneNotes: { ...m.sceneNotes, ...(o ? { fr: o.sceneNote } : {}) },
        expressions: m.expressions.map((e) => ({ ...e, meanings: { ...e.meanings, ...(o?.expressions[e.key] ? { fr: o.expressions[e.key]! } : {}) } })),
      };
    }),
    generatedBy,
    notes: [...draft.notes, ...(overlay ? [`French learner text translated from the target phrases by ${overlay.generatedBy}; to review with the target text.`] : [])],
  };
  defineSeedChapter(chapter); // throws when a source language lacks a title or meaning
  return chapter;
}

/** A track that shares its assets reuses the source chapter under its own keys. */
export function copyChapter(chapter: SeedChapterInput, target: CourseTrackId): SeedChapterInput {
  const from = chapter.courseTrackId.replace(/-/g, '_');
  const to = target.replace(/-/g, '_');
  const rename = (k: string): string => (k.startsWith(from) ? to + k.slice(from.length) : k);
  const copy: SeedChapterInput = {
    ...chapter,
    key: rename(chapter.key),
    courseTrackId: target,
    characters: chapter.characters.map((c) => ({ ...c, characterKey: rename(c.characterKey) })),
    missions: chapter.missions.map((m) => ({ ...m, key: rename(m.key), characterKey: rename(m.characterKey) })),
    notes: [...(chapter.notes ?? []), `Shares the ${chapter.courseTrackId} chapter (same variety and script).`],
  };
  defineSeedChapter(copy);
  return copy;
}

const latestDraft = (dir: string, track: string): string | null => {
  const files = readdirSync(dir).filter((f) => f.startsWith(`${track}-en-chapter-`) && f.endsWith('.json')).sort();
  return files.length ? join(dir, files[files.length - 1]!) : null;
};

const json = (v: unknown): string => JSON.stringify(v, null, 1) + '\n';

const camel = (track: string): string => track.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `generated/index.ts`: every generated chapter JSON, validated by `defineSeedChapter`, in catalog order. */
export function generatedIndexSource(tracks: readonly string[]): string {
  const ordered = (COURSE_TRACK_IDS as readonly string[]).filter((t) => tracks.includes(t));
  return [
    '/**',
    ' * AI-drafted chapter 1 of the tracks the hand-authored drafts do not cover: content-factory drafts (from English) with',
    ' * the French learner text added by `import-factory-chapters`. Drafts like the others: `review_needed`, never',
    ' * native-reviewed. GENERATED by scripts/src/import-factory-chapters.ts; do not hand-edit (re-run the script).',
    ' */',
    "import { defineSeedChapter, type SeedChapter, type SeedChapterInput } from '../types';",
    ...ordered.map((t) => `import ${camel(t)} from './${t}.json';`),
    '',
    `export const GENERATED_CHAPTERS: readonly SeedChapter[] = ([${ordered.map(camel).join(', ')}] as unknown as SeedChapterInput[]).map((c) => defineSeedChapter(c));`,
    '',
  ].join('\n');
}

function writeGeneratedIndex(root: string): void {
  const tracks = readdirSync(resolve(root, GENERATED_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  writeFileSync(resolve(root, GENERATED_DIR, 'index.ts'), generatedIndexSource(tracks));
}

async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  loadRootEnv();
  const root = repoRoot();
  const live = flagBool(args, 'live') || process.env.LANGQUEST_LIVE_TESTS === '1';
  const maxUsd = flagNumber(args, 'max-usd') ?? 4;
  const draftsDir = flagString(args, 'drafts');
  const overlayTracks = flagList(args, 'overlay');
  const copies = flagList(args, 'copy').map((p) => p.split('=') as [CourseTrackId, CourseTrackId]);
  if (!draftsDir && overlayTracks.length === 0 && copies.length === 0) throw new CliUsageError('Pass --drafts, --overlay or --copy.');
  if (args.dryRun) {
    const dir = draftsDir ? resolve(root, draftsDir) : null;
    const found = dir ? [...new Set(readdirSync(dir).filter((f) => f.includes('-en-chapter-') && f.endsWith('.json')).map((f) => f.split('-en-chapter-')[0]!))] : [];
    const wanted = flagList(args, 'tracks').length ? flagList(args, 'tracks') : found;
    io.log(`dry-run: would import ${wanted.filter((t) => found.includes(t)).join(', ') || 'no draft'} into ${GENERATED_DIR} (one French call per mission, the French course excepted), copy ${copies.map((c) => c.join('←')).join(', ') || 'nothing'}, and write French overlays for ${overlayTracks.join(', ') || 'no track'}; no model call made`);
    return 0;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!live || !apiKey) throw new CliUsageError('The French pass needs --live and OPENROUTER_API_KEY.');

  const sink = new MemoryAiRequestSink();
  const client = new OpenRouterClient({ apiKey, appName: 'LangQuest import-factory-chapters', defaultTimeoutMs: 180_000 });
  const reasoner = new ScriptsTextReasoner({ client, profiles: new ModelProfileRegistry(), sink, maxOutputTokens: 8000, modelOverride: flagString(args, 'model') ?? null });
  const spent = (): number => sink.records.reduce((a, r) => a + (r.estimatedCostUsd ?? 0), 0);
  const model = (): string => [...new Set(sink.records.filter((r) => r.success).map((r) => r.model))].join(', ') || 'unknown';

  const frFor = async (chapter: SeedChapter): Promise<{ overlay: ChapterOverlay; voices: Record<string, 'female' | 'male'> }> => {
    const done: Array<{ mission: SeedMission; fr: MissionFr }> = [];
    const voices: Record<string, 'female' | 'male'> = {};
    for (const mission of chapter.missions) {
      if (spent() > maxUsd) throw new Error(`spend cap $${maxUsd} reached`);
      const fr = await translateMission(reasoner, chapter, mission);
      done.push({ mission, fr });
      voices[mission.characterKey] ??= fr.characterVoice;
    }
    return { overlay: overlayFromFr(done, `${model()} (import ${FR_TEMPLATE_VERSION})`), voices };
  };

  const written: string[] = [];
  if (draftsDir) {
    const dir = resolve(root, draftsDir);
    const tracks = (flagList(args, 'tracks').length ? flagList(args, 'tracks') : [...new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.split('-en-chapter-')[0]!))]).filter((t) => (COURSE_TRACK_IDS as readonly string[]).includes(t)) as CourseTrackId[];
    mkdirSync(resolve(root, GENERATED_DIR), { recursive: true });
    await pool(tracks, flagNumber(args, 'concurrency') ?? 4, async (track) => {
      const file = latestDraft(dir, track);
      if (!file) return io.warn(`${track}: no draft`);
      const record = JSON.parse(readFileSync(file, 'utf8')) as { chapter: SeedChapterInput; generation?: { models?: string[] } };
      const draft = defineSeedChapter(record.chapter);
      const drafter = `content-factory (${(record.generation?.models ?? []).join(', ') || 'model'})`;
      const fr = track === 'french' ? null : await frFor(draft);
      const titles = await chapterTitles(reasoner, draft);
      const voices = fr?.voices ?? (await characterVoices(reasoner, draft));
      const chapter = curriculumChapter(draft, fr?.overlay ?? null, voices, fr ? `${drafter}; French text: ${fr.overlay.generatedBy}` : drafter, titles);
      writeFileSync(resolve(root, GENERATED_DIR, `${track}.json`), json(chapter));
      written.push(track);
      io.log(`${track}: ${chapter.missions.length} missions, ${chapter.missions.reduce((a, m) => a + m.expressions.length, 0)} phrases, sources ${chapter.sourceLanguages.join('+')} (spent so far $${spent().toFixed(3)})`);
    });
  }
  for (const [target, source] of copies) {
    const chapter = JSON.parse(readFileSync(resolve(root, GENERATED_DIR, `${source}.json`), 'utf8')) as SeedChapterInput;
    writeFileSync(resolve(root, GENERATED_DIR, `${target}.json`), json(copyChapter(chapter, target)));
    written.push(target);
    io.log(`${target}: copied from ${source}`);
  }
  if (written.length) writeGeneratedIndex(root);
  if (overlayTracks.length) mkdirSync(resolve(root, OVERLAY_DIR), { recursive: true });
  for (const track of overlayTracks) {
    const chapter = DRAFT_CHAPTERS.find((c) => c.courseTrackId === track && c.sourceLanguages.includes('en') && !c.sourceLanguages.includes('fr'));
    if (!chapter) {
      io.warn(`${track}: no English-only hand-authored chapter`);
      continue;
    }
    const { overlay, voices } = await frFor(chapter);
    const title = (await chapterTitles(reasoner, chapter)).fr;
    writeFileSync(resolve(root, OVERLAY_DIR, `${chapter.key}.fr.json`), json({ source: overlay.source, title, generatedBy: overlay.generatedBy, missions: overlay.missions }));
    io.log(`${track}: French overlay for ${chapter.key} (${Object.keys(overlay.missions).length} missions; character voices ${JSON.stringify(voices)})`);
  }
  io.log(`model calls: ${sink.records.length} (${sink.records.filter((r) => !r.success).length} failed) models=${model()} est. cost $${spent().toFixed(4)}; wrote ${written.length} chapter(s)`);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
