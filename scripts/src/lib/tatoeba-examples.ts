/**
 * Real examples for the Flutter app's phrases, from Tatoeba (spec §9.1/§9.2): sentences written by native
 * contributors that use each taught phrase, with their translations in the course's instruction languages, the
 * sentence that *is* the phrase when one exists ("attested"), and native recordings where the recording's own
 * license allows redistribution (CC BY / CC BY-SA / CC0; never NC or an unlicensed recording).
 *
 * Rights: sentence text is CC BY 2.0 FR (Tatoeba terms of use), attributed per sentence (id + contributor); each
 * recording keeps its own license and contributor. Tatoeba does not tag Spain vs Latin American Spanish, so a
 * Spanish example may come from any region: the app says so.
 */
import type { CliIo } from './cli';
import { classifyLicense, type InputFileHash } from './drafts';
import { readLines, sha256File } from './io';
import { TATOEBA_TEXT_LICENSE, locateTatoebaFiles, parseAudioLine, parseLinkLine, parseSentenceLine, type TatoebaAudio } from './tatoeba';
import { EXPECTED_SCRIPT, checkToxicity, detectScript, normalizeText, type DetectedScript } from './text';

/** Languages written without spaces between words: a phrase matches inside a sentence as a plain substring. */
const UNSPACED = new Set(['jpn', 'cmn', 'yue']);

/** Instruction languages the app narrates and translates into, by Tatoeba code. */
export const EXAMPLE_SOURCES: Readonly<Record<string, string>> = { en: 'eng', fr: 'fra', ru: 'rus', es: 'spa' };

/**
 * The comparison key of a text: NFC, lower case, punctuation and ellipses removed, spaces collapsed (no spaces at all
 * for languages written without them). Letters and diacritics of every script are kept.
 */
export function matchKey(text: string, lang: string): string {
  const base = normalizeText(text)
    .toLowerCase()
    .replace(/[……]/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return UNSPACED.has(lang) ? base.replace(/ /g, '') : base;
}

/** Whether [phraseKey] occurs in [sentenceKey] as whole words (as a substring for unspaced languages). */
export function containsPhrase(sentenceKey: string, phraseKey: string, lang: string): boolean {
  if (!phraseKey) return false;
  if (UNSPACED.has(lang)) return sentenceKey.includes(phraseKey);
  return ` ${sentenceKey} `.includes(` ${phraseKey} `);
}

/** Colloquial Arabic is also written in Latin letters (Arabizi). */
const ALSO_WRITTEN_IN: Readonly<Record<string, readonly DetectedScript[]>> = { ary: ['Latn'], arz: ['Latn'], apc: ['Latn'] };

/**
 * Whether every letter of [text] is in a script of [lang] ("My name is 王明." is not an English example: its course
 * would draw characters it has no font for, and a learner could not read them).
 */
export function ownScriptOnly(text: string, lang: string): boolean {
  const expected = [...(EXPECTED_SCRIPT[lang] ?? []), ...(ALSO_WRITTEN_IN[lang] ?? [])];
  if (!expected.length) return true;
  return (Object.keys(detectScript(text).counts) as DetectedScript[]).every((s) => expected.includes(s));
}

/** A phrase too short to find meaningfully inside sentences ("y", "は") gets no examples, only attestation. */
export function searchable(phraseKey: string, lang: string): boolean {
  return UNSPACED.has(lang) ? phraseKey.length >= 2 : phraseKey.replace(/ /g, '').length >= 3;
}

export interface ExampleTranslation {
  id: string;
  text: string;
  author: string | null;
}

export interface ExampleAudio {
  /** Tatoeba's audio id: the recording is `https://tatoeba.org/audio/download/<id>`. */
  id: string;
  author: string | null;
  license: string;
  attributionUrl: string | null;
}

export interface ExampleSentence {
  id: string;
  text: string;
  author: string | null;
  translations: Record<string, ExampleTranslation>;
  audio: ExampleAudio | null;
}

export interface PhraseExamples {
  /** A Tatoeba sentence that is this very phrase (same words), with its translations and recording if any. */
  attested: ExampleSentence | null;
  /** Up to `perPhrase` short sentences using the phrase. */
  examples: ExampleSentence[];
}

export interface PhraseQuery {
  /** The bundle's expression id. */
  id: string;
  text: string;
  /** The instruction languages the course teaches from (ISO 639-1). */
  sources: readonly string[];
}

/** Only a recording whose own license allows redistribution is used (no NC, no unlicensed recording). */
export function usableAudio(a: TatoebaAudio): ExampleAudio | null {
  if (!a.license) return null;
  const lic = classifyLicense(a.license);
  if (!lic.known || !lic.commercialRedistribution) return null;
  return { id: a.audioId, author: a.username, license: a.license, attributionUrl: a.attributionUrl };
}

/** Rank candidates: translated into more of the course's languages, then with a usable recording, then shorter. */
export function rankExamples(candidates: readonly ExampleSentence[], sources: readonly string[]): ExampleSentence[] {
  const covered = (s: ExampleSentence) => sources.filter((l) => s.translations[l]).length;
  return [...candidates].sort((a, b) => covered(b) - covered(a) || Number(!!b.audio) - Number(!!a.audio) || a.text.length - b.text.length || Number(a.id) - Number(b.id));
}

/** The best [count] examples, skipping ones that differ from a kept one only by punctuation or case. */
export function pickExamples(candidates: readonly ExampleSentence[], sources: readonly string[], lang: string, count: number): ExampleSentence[] {
  const kept: ExampleSentence[] = [];
  const keys = new Set<string>();
  for (const c of rankExamples(candidates, sources)) {
    const key = matchKey(c.text, lang);
    if (keys.has(key)) continue;
    keys.add(key);
    kept.push(c);
    if (kept.length >= count) break;
  }
  return kept;
}

export interface FindExamplesOptions {
  dir: string;
  /** Tatoeba code of the course's target language (`spa`, `jpn`, `ary`, `eng`…). */
  target: string;
  phrases: readonly PhraseQuery[];
  perPhrase: number;
  /** Longest example, in words (characters / 2.5 for unspaced languages). */
  maxWords: number;
}

export interface FindExamplesResult {
  byPhrase: Record<string, PhraseExamples>;
  inputs: InputFileHash[];
  summary: { phrases: number; attested: number; withExamples: number; examples: number; recordings: number; withoutTranslation: number };
}

const wordsOf = (text: string, lang: string): number => (UNSPACED.has(lang) ? Math.ceil(text.length / 2.5) : text.split(/\s+/).filter(Boolean).length);

/**
 * Stream the target export once to collect candidate sentences for every phrase, then join the links and the
 * instruction-language sentences only for the ids kept (the large English/French exports are read once each).
 */
export async function findExamples(options: FindExamplesOptions, io?: CliIo): Promise<FindExamplesResult> {
  const { target } = options;
  const sources = [...new Set(options.phrases.flatMap((p) => p.sources))].filter((s) => EXAMPLE_SOURCES[s] && EXAMPLE_SOURCES[s] !== target);
  const files = locateTatoebaFiles(options.dir, target, sources.map((s) => EXAMPLE_SOURCES[s]!));
  const phraseKeys = options.phrases.map((p) => ({ ...p, key: matchKey(p.text, target) }));
  // Candidate pools per phrase (bounded: the shortest sentences win in the end, so keep the shortest seen).
  const POOL = 400;
  const exact = new Map<string, { id: string; text: string; author: string | null }>();
  const pools = new Map<string, { id: string; text: string; author: string | null }[]>();
  for await (const line of readLines(files.sentences)) {
    const s = parseSentenceLine(line);
    if (!s || s.lang !== target) continue;
    const text = normalizeText(s.text);
    if (!text || wordsOf(text, target) > options.maxWords || checkToxicity(text).toxic || !ownScriptOnly(text, target)) continue;
    const key = matchKey(text, target);
    for (const p of phraseKeys) {
      if (!p.key) continue;
      if (key === p.key) {
        const prev = exact.get(p.id);
        if (!prev || Number(s.id) < Number(prev.id)) exact.set(p.id, { id: s.id, text, author: s.username });
        continue;
      }
      if (!searchable(p.key, target) || !containsPhrase(key, p.key, target)) continue;
      const pool = pools.get(p.id) ?? [];
      pool.push({ id: s.id, text, author: s.username });
      if (pool.length > POOL * 2) {
        pool.sort((a, b) => a.text.length - b.text.length || Number(a.id) - Number(b.id));
        pool.length = POOL;
      }
      pools.set(p.id, pool);
    }
  }
  const wanted = new Set<string>([...exact.values()].map((s) => s.id));
  for (const pool of pools.values()) for (const s of pool) wanted.add(s.id);
  io?.log(`  ${target}: ${exact.size} phrases attested, ${wanted.size} candidate sentences`);

  // Links → translation ids, per instruction language; then the translations' text and authors.
  const translationIds: Record<string, Map<string, string[]>> = {};
  const needed: Record<string, Set<string>> = {};
  for (const src of sources) {
    const iso3 = EXAMPLE_SOURCES[src]!;
    const linkFile = files.links[iso3];
    if (!linkFile) continue;
    const map = new Map<string, string[]>();
    const want = new Set<string>();
    // Link files are either target-source or source-target; both columns are tried.
    for await (const line of readLines(linkFile)) {
      const l = parseLinkLine(line);
      if (!l) continue;
      const [ours, theirs] = wanted.has(l.sentenceId) ? [l.sentenceId, l.translationId] : wanted.has(l.translationId) ? [l.translationId, l.sentenceId] : [null, null];
      if (!ours || !theirs) continue;
      map.set(ours, [...(map.get(ours) ?? []), theirs]);
      want.add(theirs);
    }
    translationIds[src] = map;
    needed[src] = want;
  }
  const translations: Record<string, Map<string, ExampleTranslation>> = {};
  for (const src of sources) {
    const iso3 = EXAMPLE_SOURCES[src]!;
    const file = files.sourceSentences[iso3];
    const want = needed[src];
    if (!file || !want?.size) continue;
    const map = new Map<string, ExampleTranslation>();
    for await (const line of readLines(file)) {
      const s = parseSentenceLine(line);
      if (!s || !want.has(s.id)) continue;
      const text = normalizeText(s.text);
      if (text && !checkToxicity(text).toxic && ownScriptOnly(text, iso3)) map.set(s.id, { id: s.id, text, author: s.username });
    }
    translations[src] = map;
  }
  const audio = new Map<string, ExampleAudio>();
  if (files.audio) {
    for await (const line of readLines(files.audio)) {
      const a = parseAudioLine(line);
      if (!a || !wanted.has(a.sentenceId) || audio.has(a.sentenceId)) continue;
      const usable = usableAudio(a);
      if (usable) audio.set(a.sentenceId, usable);
    }
  }

  const sentence = (s: { id: string; text: string; author: string | null }): ExampleSentence => {
    const t: Record<string, ExampleTranslation> = {};
    for (const src of sources) {
      const ids = translationIds[src]?.get(s.id) ?? [];
      const options = ids.map((id) => translations[src]?.get(id)).filter((x): x is ExampleTranslation => !!x);
      // The oldest translation is usually the plain, canonical one ("Good morning." before "Mornin'!").
      options.sort((a, b) => Number(a.id) - Number(b.id));
      if (options[0]) t[src] = options[0];
    }
    return { id: s.id, text: s.text, author: s.author, translations: t, audio: audio.get(s.id) ?? null };
  };

  const byPhrase: Record<string, PhraseExamples> = {};
  let attested = 0;
  let withExamples = 0;
  let examples = 0;
  let recordings = 0;
  let withoutTranslation = 0;
  for (const p of options.phrases) {
    const hit = exact.get(p.id);
    const att = hit ? sentence(hit) : null;
    const translated = (s: ExampleSentence) => p.sources.some((l) => s.translations[l]);
    const pool = (pools.get(p.id) ?? []).map(sentence);
    withoutTranslation += pool.filter((s) => !translated(s)).length;
    const picked = pickExamples(
      pool.filter(translated).map((s) => ({ ...s, translations: Object.fromEntries(Object.entries(s.translations).filter(([l]) => p.sources.includes(l))) })),
      p.sources,
      target,
      options.perPhrase,
    );
    const entry: PhraseExamples = { attested: att && { ...att, translations: Object.fromEntries(Object.entries(att.translations).filter(([l]) => p.sources.includes(l))) }, examples: picked };
    if (!entry.attested && !entry.examples.length) continue;
    byPhrase[p.id] = entry;
    if (entry.attested) attested += 1;
    if (entry.examples.length) withExamples += 1;
    examples += entry.examples.length;
    recordings += entry.examples.filter((e) => e.audio).length + (entry.attested?.audio ? 1 : 0);
  }

  const inputs: InputFileHash[] = [];
  for (const path of [files.sentences, ...Object.values(files.links), ...Object.values(files.sourceSentences), ...(files.audio ? [files.audio] : [])]) {
    const h = await sha256File(path);
    inputs.push({ file: path.split('/').pop()!, sha256: h.sha256, byteLength: h.byteLength });
  }
  return { byPhrase, inputs, summary: { phrases: options.phrases.length, attested, withExamples, examples, recordings, withoutTranslation } };
}

export { TATOEBA_TEXT_LICENSE };
