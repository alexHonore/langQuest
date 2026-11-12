/**
 * Chapters written in a compact form (`content/authored/chapter-2/<track>.json`) and expanded here into seed
 * chapters: one short record per line of a mission instead of the full expression object, so a chapter stays
 * readable and reviewable. Drafts like every other chapter: `ai_draft`, `review_needed`, never native-reviewed.
 *
 * A mission is a conversation. Its lines are, in order: the blueprint's slots (`slot` = the slot id), the lines
 * the blueprint has no slot for but the conversation needs — what the character says before the learner answers
 * (`slot: "+"`) — and extra ways to say a line (`slot: null`: taught on a card, not part of the conversation).
 *
 * `checkAuthoredChapter` holds a chapter to what the apps rely on (every slot filled by its own line, the course's
 * script and transliterations, learner text in every source language, a conversation with someone to answer,
 * enough distinct phrases to practise with); `content/authored.test.ts` runs it on every authored chapter.
 */
import { z } from 'zod';
import { CourseTrackIdSchema, KeySchema, RegisterSchema, buildLanguageContext, getCourseTrack, type CourseTrackId, type SourceLanguageCode } from '@langquest/contracts';
import { isIntentKey } from '../intents';
import { realise } from '../missions/realise';
import { findBlueprint } from '../missions/scenarios';
import { DEFAULT_STORY_ARC } from '../missions/story';
import { defineSeedChapter, seedExpressionsToCandidates, type SeedChapter, type SeedChapterInput, type SeedExpressionInput } from './types';

/** What a learner taught from one language reads about a line: its meaning, a short note, the phrase word for word. */
export const AuthoredMeaningSchema = z.object({
  m: z.string().min(1),
  n: z.string().nullable().default(null),
  l: z.string().nullable().default(null),
});

export const AuthoredLineSchema = z.object({
  /** Unique within the mission (a slot's line takes the slot's id). */
  key: KeySchema,
  /** The blueprint slot this line fills; `"+"` for a line of the conversation the blueprint has no slot for; `null` for another way to say a line. */
  slot: z.string().nullable(),
  by: z.enum(['learner', 'character']),
  intent: KeySchema,
  register: RegisterSchema,
  /** The line in the course's script. */
  text: z.string().min(1),
  /** The line in each of the course's transliteration schemes (`romaji`, `pinyin`, `translit-latn`…). */
  forms: z.record(z.string(), z.string().min(1)).default({}),
  en: AuthoredMeaningSchema.optional(),
  fr: AuthoredMeaningSchema.optional(),
  /** A pronunciation tip for learners taught from English (the French one is part of the French note). */
  pron: z.string().nullable().default(null),
  difficulty: z.number().min(0).max(1).default(0.3),
});
export type AuthoredLine = z.infer<typeof AuthoredLineSchema>;

export const AuthoredChapterSchema = z.object({
  track: CourseTrackIdSchema,
  titles: z.object({ en: z.string().min(1).optional(), fr: z.string().min(1).optional() }),
  characters: z.array(
    z.object({
      /** `name_role`, unique in the chapter. */
      id: KeySchema,
      /** The blueprint's character role (`waiter`, `ticket clerk`…). */
      role: z.string().min(1),
      name: z.string().min(1),
      voice: z.enum(['female', 'male']),
      personality: z.string().min(1),
      homeRegion: z.string().min(1),
    }),
  ),
  /** What a native reviewer should look at first. */
  notes: z.array(z.string()).default([]),
  missions: z.array(
    z.object({
      blueprint: KeySchema,
      character: KeySchema,
      titles: z.object({ en: z.string().min(1).optional(), fr: z.string().min(1).optional() }),
      scene: z.object({ en: z.string().min(1).optional(), fr: z.string().min(1).optional() }),
      lines: z.array(AuthoredLineSchema).min(1),
    }),
  ),
});
export type AuthoredChapter = z.infer<typeof AuthoredChapterSchema>;
export type AuthoredChapterInput = z.input<typeof AuthoredChapterSchema>;

/** The blueprints of chapter [chapterIndex] everywhere (the story arc's), in order. */
export function chapterBlueprintKeys(chapterIndex: number): readonly string[] {
  const chapter = DEFAULT_STORY_ARC.chapters[chapterIndex - 1];
  if (!chapter) throw new Error(`the story arc has no chapter ${chapterIndex}`);
  return chapter.missionKeys;
}

/** The chapters written in the authored format (chapter 1 came from the content factory and the hand-written drafts). */
export const AUTHORED_CHAPTER_INDEXES = [2, 3, 4] as const;

/** The blueprints of chapter 2 everywhere (story arc chapter 2), in order. */
export const CHAPTER_2_BLUEPRINT_KEYS: readonly string[] = chapterBlueprintKeys(2);

/** Mission keys keep the prefix chapter 1 gave each course (`es_…`, `ja_…`; the track's own name elsewhere). */
const MISSION_PREFIX: Partial<Record<CourseTrackId, string>> = { 'spanish-spain': 'es', japanese: 'ja', 'arabic-moroccan': 'ary', english: 'en' };

const slug = (track: CourseTrackId): string => track.replace(/-/g, '_');
const missionPrefix = (track: CourseTrackId): string => MISSION_PREFIX[track] ?? slug(track);

/** The instruction languages a track's authored chapters are written for (French from English, English from French). */
export const authoredSources = (track: CourseTrackId): SourceLanguageCode[] => (track === 'french' ? ['en'] : track === 'english' ? ['fr'] : ['en', 'fr']);

/** The script of a transliteration scheme's text (kana readings and pointed Hebrew stay in their own script). */
const schemeScript = (scheme: string, primary: string): string => (scheme === 'furigana' || scheme === 'niqqud' ? primary : 'Latn');

export const AUTHORED_GENERATED_BY = 'authored draft (AI-assisted), chapter 2, 2026-11';

/** The provenance line of an authored chapter. */
export const authoredGeneratedBy = (chapterIndex: number): string => (chapterIndex === 2 ? AUTHORED_GENERATED_BY : `authored draft (AI-assisted), chapter ${chapterIndex}, 2026-11`);

/** A character's key: chapter 2 kept the course's prefix alone; later chapters add theirs, so a "friend" of chapter 3 is
 * never chapter 2's friend by accident. */
const characterKey = (prefix: string, chapterIndex: number, id: string): string => (chapterIndex <= 2 ? `${prefix}_${id}` : `${prefix}_ch${chapterIndex}_${id}`);

/** The slot id a line of the conversation carries: the blueprint's, or its own key when the blueprint has none for it. */
const slotIdOf = (line: Pick<AuthoredLine, 'slot' | 'key'>): string | null => (line.slot === '+' ? line.key : line.slot);

/** Expand a compact chapter into a seed chapter (validated by `defineSeedChapter`: throws on honesty violations). */
export function expandAuthoredChapter(input: AuthoredChapterInput, chapterIndex = 2): SeedChapter {
  const chapter = AuthoredChapterSchema.parse(input);
  const track = getCourseTrack(chapter.track);
  const sources = authoredSources(chapter.track);
  const primary = track.scriptFocus ?? track.scripts.primary;
  const prefix = missionPrefix(chapter.track);
  const titlesFor = (titles: { en?: string; fr?: string }) => Object.fromEntries(sources.filter((s) => titles[s as 'en' | 'fr']).map((s) => [s, titles[s as 'en' | 'fr']!]));
  const seed: SeedChapterInput = {
    key: `${slug(chapter.track)}_ch${chapterIndex}`,
    chapterIndex,
    courseTrackId: chapter.track,
    targetVarietyId: track.targetVarietyId,
    sourceLanguages: sources,
    titles: titlesFor(chapter.titles),
    characters: chapter.characters.map((c) => ({ characterKey: characterKey(prefix, chapterIndex, c.id), role: c.role, name: c.name, personality: c.personality, homeRegion: c.homeRegion, regionalOption: null, voice: c.voice })),
    missions: chapter.missions.map((m) => ({
      key: `${prefix}_${m.blueprint}`,
      blueprintKey: m.blueprint,
      characterKey: characterKey(prefix, chapterIndex, m.character),
      titles: titlesFor(m.titles),
      sceneNotes: titlesFor(m.scene),
      expressions: m.lines.map(
        (line): SeedExpressionInput => ({
          key: line.key,
          intentKey: line.intent,
          slotId: slotIdOf(line),
          speaker: line.by,
          targetText: line.text,
          forms: [
            { script: primary, transliterationScheme: null, text: line.text },
            ...track.scripts.transliterations.filter((scheme) => line.forms[scheme]).map((scheme) => ({ script: schemeScript(scheme, primary), transliterationScheme: scheme, text: line.forms[scheme]! })),
          ] as SeedExpressionInput['forms'],
          meanings: Object.fromEntries(
            sources.filter((s) => line[s as 'en' | 'fr']).map((s) => {
              const meaning = line[s as 'en' | 'fr']!;
              return [s, { meaning: meaning.m, contextNote: meaning.n, literalGloss: meaning.l }];
            }),
          ),
          register: line.register,
          codeSwitchNote: null,
          pronunciationNote: line.pron,
          nativeReviewed: false,
          reviewStatus: 'review_needed',
          provenance: 'ai_draft',
          difficulty: line.difficulty,
        }),
      ),
    })),
    provenance: 'ai_draft',
    nativeReviewed: false,
    reviewStatus: 'review_needed',
    generatedBy: authoredGeneratedBy(chapterIndex),
    notes: [`AI-assisted draft of chapter ${chapterIndex} for ${track.displayName} (${track.targetVarietyId}); native review required before publishing.`, ...chapter.notes],
  };
  return defineSeedChapter(seed);
}

/** The same chapter for a track that shares another's language assets (Chinese Simplified ← Mandarin). */
export const authoredChapterFor = (track: CourseTrackId, source: AuthoredChapterInput): AuthoredChapterInput => ({ ...source, track });

// --- Checks ---------------------------------------------------------------------------------------------------------

const SCRIPT_PATTERN: Record<string, RegExp> = {
  Arab: /[؀-ۿ]/u,
  Cyrl: /[Ѐ-ӿ]/u,
  Grek: /[Ͱ-Ͽἀ-῿]/u,
  Hebr: /[֐-׿]/u,
  Deva: /[ऀ-ॿ]/u,
  Kore: /[가-힯]/u,
  Hans: /[一-鿿]/u,
  Hant: /[一-鿿]/u,
  Jpan: /[぀-ヿ一-鿿]/u,
};
const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{M}\p{Sm}\p{Sc}]+$/u;
const KANJI = /[一-鿿]/u;
const NIQQUD = /[ְ-ׇ]/u;
const PLACEHOLDER = /…|\.\.\.|\bXXX\b|\[[^\]]*\]|<[^>]*>/u;

const tokens = (text: string): string[] =>
  text
    .split(/\s+/)
    .map((w) => w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter(Boolean);
const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The longest a line, a meaning or a note may be for the screens that show them. */
export const AUTHORED_LIMITS = { text: 70, meaning: 90, note: 240, literal: 110, title: 48, scene: 190 } as const;

/**
 * What is wrong with an authored chapter, as sentences a writer can act on (empty: nothing). Checked: the six
 * blueprints of the chapter in order; every slot given a line with the slot's intent and speaker; valid
 * intents; the course's script and every transliteration; learner text in every source language, the French written
 * as French; no placeholders; a conversation with a character to answer; enough distinct phrases for the practice
 * session, one of them long enough to be rebuilt word by word; and that the chapter realises completely.
 */
export function checkAuthoredChapter(input: unknown, chapterIndex = 2, blueprintKeys: readonly string[] = chapterBlueprintKeys(chapterIndex)): string[] {
  const parsed = AuthoredChapterSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const chapter = parsed.data;
  const problems: string[] = [];
  const track = getCourseTrack(chapter.track);
  const sources = authoredSources(chapter.track) as ('en' | 'fr')[];
  const primary = track.scriptFocus ?? track.scripts.primary;
  const schemes = track.scripts.transliterations;
  const latinScheme = schemes.find((s) => schemeScript(s, primary) === 'Latn') ?? null;
  const say = (where: string, what: string) => problems.push(`${where}: ${what}`);

  for (const s of sources) if (!chapter.titles[s]) say('titles', `missing the ${s} chapter title`);
  for (const [lang, title] of Object.entries(chapter.titles)) if (title && title.length > AUTHORED_LIMITS.title) say(`titles.${lang}`, `longer than ${AUTHORED_LIMITS.title} characters`);
  if (chapter.missions.map((m) => m.blueprint).join() !== blueprintKeys.join()) say('missions', `expected the blueprints ${blueprintKeys.join(', ')} in this order, got ${chapter.missions.map((m) => m.blueprint).join(', ')}`);
  const characterIds = new Set(chapter.characters.map((c) => c.id));
  if (characterIds.size !== chapter.characters.length) say('characters', 'two characters share an id');

  for (const mission of chapter.missions) {
    const at = mission.blueprint;
    const bp = findBlueprint(mission.blueprint);
    if (!bp) {
      say(at, 'unknown blueprint');
      continue;
    }
    if (!characterIds.has(mission.character)) say(at, `unknown character "${mission.character}"`);
    for (const s of sources) {
      if (!mission.titles[s]) say(at, `missing the ${s} title`);
      else if (mission.titles[s]!.length > AUTHORED_LIMITS.title) say(at, `${s} title longer than ${AUTHORED_LIMITS.title} characters`);
      if (!mission.scene[s]) say(at, `missing the ${s} scene note`);
      else if (mission.scene[s]!.length > AUTHORED_LIMITS.scene) say(at, `${s} scene note longer than ${AUTHORED_LIMITS.scene} characters`);
    }
    if (mission.titles.en && mission.titles.fr && mission.titles.en === mission.titles.fr) say(at, 'the French title is the English one');

    const keys = new Set<string>();
    const slotIds = new Set(bp.slots.map((s) => s.slotId));
    const learnerSlotIntents = new Set(bp.slots.filter((s) => s.speaker === 'learner').map((s) => s.intentKey));
    for (const line of mission.lines) {
      const where = `${at}/${line.key}`;
      if (keys.has(line.key)) say(where, 'duplicate key');
      keys.add(line.key);
      if (!isIntentKey(line.intent)) say(where, `unknown intent "${line.intent}"`);
      if (line.slot !== null && line.slot !== '+') {
        const slot = bp.slots.find((s) => s.slotId === line.slot);
        if (!slot) say(where, `"${line.slot}" is not a slot of ${at} (slots: ${[...slotIds].join(', ')}; use "+" for another line of the conversation)`);
        else {
          if (slot.intentKey !== line.intent) say(where, `slot ${slot.slotId} has the intent ${slot.intentKey}, not ${line.intent}`);
          if (slot.speaker !== line.by) say(where, `slot ${slot.slotId} is said by the ${slot.speaker}`);
          if (line.key !== slot.slotId) say(where, `a slot's line takes the slot's id as its key ("${slot.slotId}")`);
        }
      } else if (line.slot === '+') {
        if (slotIds.has(line.key)) say(where, 'the key of a "+" line must not be a slot id');
      } else if (!learnerSlotIntents.has(line.intent)) say(where, `a variant (slot: null) says one of the learner's slot lines another way: its intent must be one of ${[...learnerSlotIntents].join(', ')}`);
      else if (line.by !== 'learner') say(where, 'variants are learner lines');

      // The course's script and transliterations.
      if (line.text.length > AUTHORED_LIMITS.text) say(where, `text longer than ${AUTHORED_LIMITS.text} characters`);
      if (PLACEHOLDER.test(line.text)) say(where, 'the text has a placeholder (write a concrete example instead)');
      const pattern = SCRIPT_PATTERN[primary];
      if (pattern ? !pattern.test(line.text) : !LATIN_ONLY.test(line.text)) say(where, `the text is not written in ${primary}`);
      for (const scheme of schemes) {
        const form = line.forms[scheme];
        if (!form) say(where, `missing the ${scheme} form`);
        else if (schemeScript(scheme, primary) === 'Latn' && !LATIN_ONLY.test(form)) say(where, `the ${scheme} form must be in Latin letters`);
        else if (scheme === 'furigana' && KANJI.test(form)) say(where, 'the furigana form must be kana only');
        else if (scheme === 'niqqud' && !NIQQUD.test(form)) say(where, 'the niqqud form has no vowel points');
      }
      for (const scheme of Object.keys(line.forms)) if (!schemes.includes(scheme as never)) say(where, `"${scheme}" is not a transliteration of this course (${schemes.join(', ') || 'none'})`);

      // Learner text in every source language.
      for (const s of sources) {
        const meaning = line[s];
        if (!meaning) {
          say(where, `missing the ${s} meaning`);
          continue;
        }
        if (meaning.m.length > AUTHORED_LIMITS.meaning) say(where, `${s} meaning longer than ${AUTHORED_LIMITS.meaning} characters`);
        if (meaning.n && meaning.n.length > AUTHORED_LIMITS.note) say(where, `${s} note longer than ${AUTHORED_LIMITS.note} characters`);
        if (meaning.l && meaning.l.length > AUTHORED_LIMITS.literal) say(where, `${s} literal gloss longer than ${AUTHORED_LIMITS.literal} characters`);
        if (PLACEHOLDER.test(meaning.m)) say(where, `the ${s} meaning has a placeholder`);
      }
      for (const s of ['en', 'fr'] as const) if (line[s] && !sources.includes(s)) say(where, `this course is not taught from ${s}: remove "${s}"`);
      if (line.en && line.fr) {
        if (line.en.m === line.fr.m && tokens(line.en.m).length > 1) say(where, 'the French meaning is the English one');
        if (line.en.n && line.en.n === line.fr.n) say(where, 'the French note is the English one');
      }
      if (line.pron && !sources.includes('en')) say(where, '"pron" is for learners taught from English: put the tip in the French note');
    }

    // Every slot has its line (optional ones too: they are what the mission teaches).
    for (const slot of bp.slots) if (!mission.lines.some((l) => l.slot === slot.slotId)) say(at, `no line for the slot "${slot.slotId}" (${slot.intentKey}, said by the ${slot.speaker})`);

    // A conversation, with someone to answer and enough to practise.
    const dialogue = mission.lines.filter((l) => l.slot !== null);
    const learner = dialogue.filter((l) => l.by === 'learner');
    const character = dialogue.filter((l) => l.by === 'character');
    if (character.length < 2) say(at, `the conversation needs at least 2 lines said by the character (it has ${character.length}); add "+" lines`);
    if (dialogue.length > 12) say(at, `the conversation has ${dialogue.length} lines: keep it to 12 at most`);
    if (character.length > learner.length) say(at, 'the character says more than the learner: the mission is the learner\'s to speak');
    const cued = dialogue.filter((l, i) => l.by === 'learner' && i > 0 && dialogue[i - 1]!.by === 'character').length;
    if (cued < 2) say(at, 'at least 2 learner lines should answer a line of the character (put the character\'s line right before)');
    for (const s of sources) {
      const meanings = new Set(mission.lines.filter((l) => l.by === 'learner' && l[s]).map((l) => normalize(l[s]!.m)));
      if (meanings.size < 4) say(at, `fewer than 4 learner lines with distinct ${s} meanings (the practice session needs them)`);
    }
    const texts = mission.lines.map((l) => normalize(l.text));
    if (new Set(texts).size !== texts.length) say(at, 'two lines have the same text');
    const buildable = learner.filter((l) => {
      const words = tokens(latinScheme ? (l.forms[latinScheme] ?? '') : l.text).length;
      return words >= 3 && words <= 7;
    });
    if (primary === 'Latn' || latinScheme) {
      if (buildable.length < 2) say(at, 'at least 2 learner lines of the conversation must be 3 to 7 words long (they are rebuilt word by word)');
    }
  }
  if (problems.length > 0) return problems;

  // The chapter as the apps get it: valid seed, every slot realised by its own line.
  let seed: SeedChapter;
  try {
    seed = expandAuthoredChapter(chapter, chapterIndex);
  } catch (e) {
    return [`does not make a valid chapter: ${e instanceof Error ? e.message : String(e)}`];
  }
  for (const source of seed.sourceLanguages) {
    const ctx = buildLanguageContext({ uiLocale: source === 'fr' ? 'fr-FR' : 'en-US', enrollmentId: '00000000-0000-4000-8000-000000000001', sourceLanguageCode: source, courseTrackId: seed.courseTrackId });
    for (const mission of seed.missions) {
      const bp = findBlueprint(mission.blueprintKey)!;
      const realised = realise(bp, ctx, seedExpressionsToCandidates(seed, mission));
      for (const missing of realised.missingSlots) say(mission.blueprintKey, `slot "${missing}" is not filled for learners from ${source}`);
      for (const rejected of realised.rejectedCandidates.filter((r) => r.reason !== 'unused_intent')) say(mission.blueprintKey, `${rejected.expressionId} was rejected (${rejected.reason})`);
      // A slot is filled by intent (closest register, then lowest difficulty): a line of the other speaker with
      // the same intent must never take it.
      for (const step of realised.steps) {
        for (const bound of step.expressions) {
          const line = mission.expressions.find((e) => bound.id.endsWith(`:${mission.key}:${e.key}`));
          const slot = bp.slots.find((s) => s.slotId === bound.slotId);
          if (line && slot && line.speaker !== slot.speaker) {
            say(mission.blueprintKey, `the ${slot.speaker}'s slot "${slot.slotId}" (${slot.intentKey}, register ${slot.register}) would be filled by the ${line.speaker}'s line "${line.key}": give that line another intent, or give the slot's own line the slot's register and a lower difficulty`);
          }
          // …and nor must a variant of the same speaker: the conversation is the slots' own lines.
          else if (line && slot && line.key !== slot.slotId) {
            say(
              mission.blueprintKey,
              `slot "${slot.slotId}" (${slot.intentKey}, register ${slot.register}) would be filled by "${line.key}" instead of its own line: give "${line.key}" a higher difficulty than "${slot.slotId}" (or keep "${slot.slotId}" at the slot's register)`,
            );
          }
        }
      }
    }
  }
  return [...new Set(problems)];
}
