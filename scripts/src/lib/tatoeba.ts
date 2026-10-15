/**
 * Tatoeba import pipeline (spec §9.2): stream per-language exports, join translation links,
 * preserve per-row license/author/source plus the snapshot id and SHA-256 of every input,
 * normalise Unicode safely, sanity-check language/script, filter toxic or irrelevant rows,
 * curate candidate expressions by communicative intent and emit `ExpressionDraft` records.
 *
 * Export formats handled (https://tatoeba.org/en/downloads):
 *  - `<lang>_sentences.tsv`           id ⇥ lang ⇥ text
 *  - `<lang>_sentences_detailed.tsv`  id ⇥ lang ⇥ text ⇥ username ⇥ date_added ⇥ date_modified
 *  - `<lang>-<other>_links.tsv`       sentence_id ⇥ translation_id
 *  - `<lang>_sentences_with_audio.tsv` sentence_id ⇥ audio_id ⇥ username ⇥ license ⇥ attribution_url
 *  - `sentences_CC0.tsv` (optional)   id ⇥ lang ⇥ text ⇥ date_last_modified  → marks CC0 rows
 *
 * Sentence text is CC BY 2.0 FR unless listed in the CC0 export; audio carries a per-recording
 * license chosen by the contributor and an empty license means "not reusable outside Tatoeba".
 */
import { resolve } from 'node:path';
import { VARIETY_IDS, type VarietyId } from '@langquest/contracts';
import type { CliIo } from './cli';
import { classifyLicense, type ExpressionDraft, type InputFileHash, type RightsRecord } from './drafts';
import { guessIntents, scenarioTagsForIntent } from './intent-heuristics';
import { fileExists, nowStamp, readLines, sha256File } from './io';
import { checkRelevance, checkToxicity, detectScript, languageSanity, normalizeText } from './text';

export const TATOEBA_TEXT_LICENSE = 'CC BY 2.0 FR';
export const TATOEBA_TERMS_URL = 'https://tatoeba.org/en/terms_of_use';
export const TATOEBA_DOWNLOADS_URL = 'https://tatoeba.org/en/downloads';

export interface TatoebaLanguage {
  iso3: string;
  languageCode: string;
  /** Varieties this corpus language could feed. One entry = unambiguous; several = operator must choose. */
  varieties: readonly VarietyId[];
  note: string;
}

/** Corpus languages we hold locally, mapped to LangQuest varieties. Ambiguity is explicit, never guessed. */
export const TATOEBA_LANGUAGES: Readonly<Record<string, TatoebaLanguage>> = {
  eng: { iso3: 'eng', languageCode: 'en', varieties: ['en'], note: 'US/GB not distinguished by Tatoeba; the English track treats both as one variety.' },
  fra: { iso3: 'fra', languageCode: 'fr', varieties: ['fr'], note: 'fr-FR/fr-CA not distinguished; regional wording needs review.' },
  spa: { iso3: 'spa', languageCode: 'es', varieties: ['es-ES', 'es-419'], note: 'Tatoeba does not tag Spain vs Latin American Spanish; pass --variety and let reviewers reject cross-variety rows.' },
  por: { iso3: 'por', languageCode: 'pt', varieties: ['pt-BR', 'pt-PT'], note: 'Tatoeba does not tag Brazilian vs European Portuguese; pass --variety.' },
  ara: { iso3: 'ara', languageCode: 'ar', varieties: ['arb', 'ary', 'arz', 'ar-levant'], note: '`ara` is overwhelmingly Modern Standard Arabic; dialect rows exist under separate codes (ary, arz, apc). Pass --variety arb unless you verified otherwise.' },
  ary: { iso3: 'ary', languageCode: 'ar', varieties: ['ary'], note: 'Moroccan Arabic export (small).' },
  arz: { iso3: 'arz', languageCode: 'ar', varieties: ['arz'], note: 'Egyptian Arabic export (small).' },
  apc: { iso3: 'apc', languageCode: 'ar', varieties: ['ar-levant'], note: 'Levantine Arabic export (small).' },
  jpn: { iso3: 'jpn', languageCode: 'ja', varieties: ['ja'], note: 'Kanji/kana as written by contributors; furigana/romaji must be generated and reviewed.' },
  rus: { iso3: 'rus', languageCode: 'ru', varieties: ['ru'], note: '' },
  ita: { iso3: 'ita', languageCode: 'it', varieties: ['it'], note: '' },
  deu: { iso3: 'deu', languageCode: 'de', varieties: ['de'], note: '' },
  ukr: { iso3: 'ukr', languageCode: 'uk', varieties: ['uk'], note: '' },
  ell: { iso3: 'ell', languageCode: 'el', varieties: ['el'], note: '' },
  heb: { iso3: 'heb', languageCode: 'he', varieties: ['he'], note: 'Unpointed Hebrew; niqqud must be added for beginner display.' },
  hin: { iso3: 'hin', languageCode: 'hi', varieties: ['hi'], note: '' },
  kor: { iso3: 'kor', languageCode: 'ko', varieties: ['ko'], note: '' },
  dan: { iso3: 'dan', languageCode: 'da', varieties: ['da'], note: '' },
  swe: { iso3: 'swe', languageCode: 'sv', varieties: ['sv'], note: '' },
  ron: { iso3: 'ron', languageCode: 'ro', varieties: ['ro'], note: '' },
  vie: { iso3: 'vie', languageCode: 'vi', varieties: ['vi'], note: 'North/South not distinguished.' },
  swh: { iso3: 'swh', languageCode: 'sw', varieties: ['sw'], note: '' },
  kin: { iso3: 'kin', languageCode: 'rw', varieties: ['rw'], note: '' },
  lin: { iso3: 'lin', languageCode: 'ln', varieties: ['ln'], note: '' },
  hat: { iso3: 'hat', languageCode: 'ht', varieties: ['ht'], note: '' },
  cmn: { iso3: 'cmn', languageCode: 'zh', varieties: ['cmn'], note: 'Simplified and Traditional both appear; script is detected per row.' },
  yue: { iso3: 'yue', languageCode: 'zh', varieties: ['yue'], note: '' },
};

/** Source (instruction) languages that can be joined through links, by Tatoeba code. */
export const SOURCE_ISO3: Readonly<Record<string, string>> = { eng: 'en', fra: 'fr', spa: 'es', rus: 'ru', deu: 'de', ita: 'it', por: 'pt', jpn: 'ja', ara: 'ar' };

export interface TatoebaSentence {
  id: string;
  lang: string;
  text: string;
  username: string | null;
}

export interface TatoebaAudio {
  sentenceId: string;
  audioId: string;
  username: string | null;
  license: string | null;
  attributionUrl: string | null;
}

/** Parse one TSV line of a sentences export (plain or detailed). Returns null for malformed lines. */
export function parseSentenceLine(line: string): TatoebaSentence | null {
  const cols = line.split('\t');
  if (cols.length < 3) return null;
  const [id, lang, text] = cols;
  if (!id || !lang || text === undefined || !/^\d+$/.test(id)) return null;
  const username = cols.length >= 4 && cols[3] && cols[3] !== '\\N' ? cols[3] : null;
  return { id, lang, text, username };
}

export function parseLinkLine(line: string): { sentenceId: string; translationId: string } | null {
  const [a, b] = line.split('\t');
  if (!a || !b || !/^\d+$/.test(a) || !/^\d+$/.test(b.trim())) return null;
  return { sentenceId: a, translationId: b.trim() };
}

export function parseAudioLine(line: string): TatoebaAudio | null {
  const cols = line.split('\t');
  if (cols.length < 2) return null;
  const [sentenceId, audioId, username, license, attributionUrl] = cols;
  if (!sentenceId || !audioId || !/^\d+$/.test(sentenceId)) return null;
  const clean = (v: string | undefined): string | null => (v && v !== '\\N' && v.trim() ? v.trim() : null);
  return { sentenceId, audioId, username: clean(username), license: clean(license), attributionUrl: clean(attributionUrl) };
}

export interface TatoebaFiles {
  dir: string;
  sentences: string;
  sentencesDetailed: string | null;
  audio: string | null;
  cc0: string | null;
  links: Record<string, string>;
  sourceSentences: Record<string, string>;
  snapshotFile: string | null;
}

const firstExisting = (...paths: string[]): string | null => paths.find((p) => fileExists(p)) ?? null;

/** Locate the export files for a target language + source languages inside `dir` (bz2 or plain). */
export function locateTatoebaFiles(dir: string, target: string, sources: readonly string[]): TatoebaFiles {
  const pick = (base: string): string | null => firstExisting(resolve(dir, `${base}.tsv.bz2`), resolve(dir, `${base}.tsv`));
  const detailed = pick(`${target}_sentences_detailed`);
  const plain = pick(`${target}_sentences`);
  const sentences = detailed ?? plain;
  if (!sentences) throw new Error(`No ${target}_sentences(.tsv|.tsv.bz2) in ${dir}`);
  const links: Record<string, string> = {};
  const sourceSentences: Record<string, string> = {};
  for (const src of sources) {
    const link = pick(`${target}-${src}_links`) ?? pick(`${src}-${target}_links`);
    const srcFile = pick(`${src}_sentences_detailed`) ?? pick(`${src}_sentences`);
    if (link && srcFile) {
      links[src] = link;
      sourceSentences[src] = srcFile;
    }
  }
  return {
    dir,
    sentences,
    sentencesDetailed: detailed,
    audio: pick(`${target}_sentences_with_audio`),
    cc0: pick('sentences_CC0'),
    links,
    sourceSentences,
    snapshotFile: firstExisting(resolve(dir, 'SNAPSHOT_DATE.txt')),
  };
}

export interface ImportTatoebaOptions {
  dir: string;
  target: string;
  sources: readonly string[];
  /** Operator-declared variety for ambiguous corpus languages. */
  variety: VarietyId | null;
  /** Max candidate sentences kept after filtering (bounds memory). */
  maxCandidates: number;
  /** Max sentences scanned from the target export (0 = all). */
  scanLimit: number;
  /** Max drafts emitted. */
  limit: number;
  minIntentConfidence: number;
  /** Keep sentences without a confident intent (tagged `intent_unmatched`). */
  keepUnmatched: boolean;
  maxWords: number;
  /** Only keep sentences that have at least one translation into a requested source language. */
  requireTranslation: boolean;
  extraToxicTerms?: readonly string[];
  now?: Date;
}

export interface ImportTatoebaResult {
  drafts: ExpressionDraft[];
  summary: {
    target: string;
    varietyId: VarietyId | null;
    varietyAssignment: ExpressionDraft['target']['varietyAssignment'];
    snapshotId: string;
    inputs: InputFileHash[];
    scanned: number;
    rejected: Record<string, number>;
    candidates: number;
    linked: number;
    withAudio: number;
    audioRedistributable: number;
    intentMatched: number;
    emitted: number;
    byIntent: Record<string, number>;
    notes: string[];
  };
}

/** Resolve the variety assignment honestly: corpus-unambiguous, operator-declared, or unresolved. */
export function resolveVariety(target: string, declared: VarietyId | null): { varietyId: VarietyId | null; assignment: ExpressionDraft['target']['varietyAssignment']; note: string | null } {
  const lang = TATOEBA_LANGUAGES[target];
  if (!lang) throw new Error(`Unsupported Tatoeba language "${target}". Known: ${Object.keys(TATOEBA_LANGUAGES).join(', ')}`);
  if (declared) {
    if (!VARIETY_IDS.includes(declared)) throw new Error(`Unknown variety ${declared}`);
    if (!lang.varieties.includes(declared)) throw new Error(`Variety ${declared} is not a ${target} variety (allowed: ${lang.varieties.join(', ')}). Dialect boundaries are never crossed.`);
    return { varietyId: declared, assignment: lang.varieties.length === 1 ? 'corpus' : 'operator_declared', note: lang.varieties.length === 1 ? null : `Variety ${declared} declared by operator for corpus language ${target}; ${lang.note}` };
  }
  if (lang.varieties.length === 1) return { varietyId: lang.varieties[0]!, assignment: 'corpus', note: null };
  return { varietyId: null, assignment: 'unresolved', note: `Corpus language ${target} maps to several varieties (${lang.varieties.join(', ')}); pass --variety to declare one. ${lang.note}` };
}

/** Attribution sentence for a Tatoeba sentence, per the terms of use. */
export const tatoebaAttribution = (id: string, username: string | null, license = TATOEBA_TEXT_LICENSE): string =>
  `Sentence #${id}${username ? ` by ${username}` : ''} from Tatoeba (https://tatoeba.org/sentences/show/${id}), ${license}`;

export function sentenceRights(sentence: TatoebaSentence, cc0: boolean): RightsRecord {
  const lic = classifyLicense(cc0 ? 'CC0 1.0' : TATOEBA_TEXT_LICENSE);
  return {
    licenseId: lic.licenseId,
    licenseVersion: lic.licenseVersion,
    licenseSource: cc0 ? 'per_row' : 'export_default',
    authors: sentence.username ? [sentence.username] : [],
    originUrl: `https://tatoeba.org/sentences/show/${sentence.id}`,
    attributionRequired: lic.attributionRequired,
    attributionText: cc0 ? null : tatoebaAttribution(sentence.id, sentence.username),
    commercialRedistribution: lic.commercialRedistribution,
    alterationsPermitted: lic.alterationsPermitted,
    aiProcessingPermitted: lic.aiProcessingPermitted,
    verified: false,
    notes: [
      sentence.username ? 'Author from sentences_detailed export.' : 'Author unknown: plain sentences export has no username column; use sentences_detailed.tsv to attribute per contributor.',
      'Sentence text license per Tatoeba terms of use (CC BY 2.0 FR unless listed in sentences_CC0).',
    ],
  };
}

export function audioRights(a: TatoebaAudio): ExpressionDraft['audio'][number] {
  const lic = classifyLicense(a.license);
  const permitted = a.license !== null && lic.known && lic.commercialRedistribution && lic.alterationsPermitted;
  return {
    upstreamId: a.audioId,
    locator: `https://tatoeba.org/audio/download/${a.audioId}`,
    speaker: a.username,
    licenseId: a.license ? lic.licenseId : null,
    attributionUrl: a.attributionUrl,
    redistributionPermitted: permitted,
    note: a.license === null ? 'No license recorded: audio may not be reused outside Tatoeba.' : permitted ? null : `License ${lic.licenseId} restricts commercial redistribution or derivatives; reference/evaluation only.`,
  };
}

/** Build one draft from a curated sentence. Pure. */
export function buildDraft(input: {
  sentence: TatoebaSentence;
  text: string;
  varietyId: VarietyId | null;
  varietyAssignment: ExpressionDraft['target']['varietyAssignment'];
  translations: Array<{ sentence: TatoebaSentence; sourceLanguageCode: string; cc0: boolean }>;
  audio: TatoebaAudio[];
  cc0: boolean;
  provenance: ExpressionDraft['provenance'];
  checks: ExpressionDraft['checks'];
  wordCount: number;
  minIntentConfidence: number;
}): ExpressionDraft {
  const english = input.translations.find((t) => t.sourceLanguageCode === 'en');
  const guesses = guessIntents({ text: input.text, lang: input.sentence.lang }, english ? { text: english.sentence.text } : null);
  const best = guesses[0] && guesses[0].confidence >= input.minIntentConfidence ? guesses[0] : null;
  const flags: string[] = [];
  if (!best) flags.push('intent_unmatched');
  if (input.varietyAssignment !== 'corpus') flags.push(`variety_${input.varietyAssignment}`);
  if (input.checks.relevance.reasons.includes('corpus_persona_name')) flags.push('corpus_persona_name');
  if (!input.translations.length) flags.push('no_source_translation');
  const lang = TATOEBA_LANGUAGES[input.sentence.lang];
  return {
    formatVersion: 1,
    kind: 'expression_draft',
    draftId: `tatoeba:${input.sentence.lang}:${input.sentence.id}`,
    status: 'review_needed',
    nativeReviewed: false,
    provenance: input.provenance,
    target: {
      languageCode: lang?.languageCode ?? input.sentence.lang,
      varietyId: input.varietyId,
      varietyAssignment: input.varietyAssignment,
      upstreamId: input.sentence.id,
      rawText: input.sentence.text,
      text: input.text,
      script: detectScript(input.text).dominant,
    },
    forms: [],
    translations: input.translations.map((t) => ({
      sourceLanguageCode: t.sourceLanguageCode as ExpressionDraft['translations'][number]['sourceLanguageCode'],
      text: normalizeText(t.sentence.text),
      contextNote: null,
      literalGloss: null,
      upstreamId: t.sentence.id,
      rights: sentenceRights(t.sentence, t.cc0),
      qaState: 'needs_review',
    })),
    audio: input.audio.map(audioRights),
    rights: sentenceRights(input.sentence, input.cc0),
    curation: {
      intentKey: best?.intentKey ?? null,
      intentConfidence: best?.confidence ?? 0,
      alternativeIntentKeys: guesses.slice(best ? 1 : 0, 4).map((g) => g.intentKey),
      scenarioTags: best ? scenarioTagsForIntent(best.intentKey) : [],
      register: 'neutral',
      difficulty: Math.min(1, Math.max(0.1, input.wordCount / 12)),
      wordCount: input.wordCount,
      flags,
    },
    checks: input.checks,
  };
}

/** Run the full pipeline. Streams every file; memory is bounded by `maxCandidates`. */
export async function importTatoeba(options: ImportTatoebaOptions, io: CliIo): Promise<ImportTatoebaResult> {
  const files = locateTatoebaFiles(options.dir, options.target, options.sources);
  const { varietyId, assignment, note } = resolveVariety(options.target, options.variety);
  const notes: string[] = [];
  if (note) notes.push(note);
  const snapshotId = files.snapshotFile ? (await readFirstLine(files.snapshotFile)).trim() : 'unknown';
  if (snapshotId === 'unknown') notes.push('No SNAPSHOT_DATE.txt next to the exports; record the download date for reproducibility.');
  const missingSources = options.sources.filter((s) => !files.links[s]);
  if (missingSources.length) notes.push(`No links/sentences for source language(s) ${missingSources.join(', ')} in ${options.dir}; those overlays are skipped.`);

  const inputPaths = [files.sentences, files.audio, files.cc0, ...Object.values(files.links), ...Object.values(files.sourceSentences)].filter((p): p is string => !!p);
  const inputs: InputFileHash[] = [];
  for (const path of inputPaths) {
    const h = await sha256File(path);
    inputs.push({ file: path.replace(options.dir + '/', ''), sha256: h.sha256, byteLength: h.byteLength });
  }
  const provenance: ExpressionDraft['provenance'] = {
    dataset: 'tatoeba',
    snapshotId,
    inputs,
    evidence: [TATOEBA_TERMS_URL, TATOEBA_DOWNLOADS_URL, 'data/raw/evidence/tatoeba-terms-of-use.html', 'data/raw/evidence/tatoeba-downloads.html'],
    importedAt: nowStamp(false, options.now),
    importer: 'scripts/import-tatoeba@1',
  };

  // CC0 ids (optional export).
  const cc0Ids = new Set<string>();
  if (files.cc0) for await (const line of readLines(files.cc0)) {
    const s = parseSentenceLine(line);
    if (s) cc0Ids.add(s.id);
  }

  // Stage 0 (when translations are required): target ids that have at least one link into a requested
  // source language. Links files are small, so this keeps the candidate pool useful instead of filling the
  // cap with untranslated sentences.
  let linkedIds: Set<string> | null = null;
  if (options.requireTranslation && Object.keys(files.links).length) {
    linkedIds = new Set<string>();
    for (const linkFile of Object.values(files.links)) for await (const line of readLines(linkFile)) {
      const l = parseLinkLine(line);
      if (l) linkedIds.add(l.sentenceId);
    }
  }

  // Stage 1: scan target sentences, filter, keep candidates.
  const rejected: Record<string, number> = {};
  const reject = (reason: string): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const candidates = new Map<string, { sentence: TatoebaSentence; text: string; checks: ExpressionDraft['checks']; wordCount: number }>();
  let scanned = 0;
  for await (const line of readLines(files.sentences)) {
    if (options.scanLimit > 0 && scanned >= options.scanLimit) break;
    const s = parseSentenceLine(line);
    if (!s) continue;
    scanned += 1;
    if (s.lang !== options.target) {
      reject('wrong_language_column');
      continue;
    }
    if (linkedIds && !linkedIds.has(s.id)) {
      reject('no_source_translation');
      continue;
    }
    const text = normalizeText(s.text);
    if (!text) {
      reject('empty');
      continue;
    }
    const sanity = languageSanity(text, s.lang);
    if (!sanity.ok) {
      reject(`sanity_${sanity.reason}`);
      continue;
    }
    const toxicity = checkToxicity(text, options.extraToxicTerms);
    if (toxicity.toxic) {
      reject('toxic');
      continue;
    }
    const relevance = checkRelevance(text, { maxWords: options.maxWords });
    if (!relevance.relevant) {
      for (const r of relevance.reasons.filter((x) => x !== 'corpus_persona_name')) reject(`irrelevant_${r}`);
      continue;
    }
    candidates.set(s.id, { sentence: s, text, wordCount: relevance.wordCount, checks: { languageSanity: { ok: true, reason: null }, toxicity: { toxic: false, matches: [] }, relevance: { relevant: true, reasons: relevance.reasons } } });
    if (candidates.size >= options.maxCandidates) {
      notes.push(`Candidate cap ${options.maxCandidates} reached after scanning ${scanned} sentences; raise --max-candidates to go further.`);
      break;
    }
  }
  io.log(`scanned ${scanned} ${options.target} sentences → ${candidates.size} candidates`);

  // Stage 2: links → needed translation ids per source.
  const linksByCandidate = new Map<string, Array<{ src: string; id: string }>>();
  const neededBySource = new Map<string, Set<string>>();
  for (const [src, linkFile] of Object.entries(files.links)) {
    const needed = new Set<string>();
    for await (const line of readLines(linkFile)) {
      const l = parseLinkLine(line);
      if (!l || !candidates.has(l.sentenceId)) continue;
      needed.add(l.translationId);
      const arr = linksByCandidate.get(l.sentenceId) ?? [];
      arr.push({ src, id: l.translationId });
      linksByCandidate.set(l.sentenceId, arr);
    }
    neededBySource.set(src, needed);
  }

  // Stage 3: load only the needed source sentences.
  const sourceSentences = new Map<string, TatoebaSentence>();
  for (const [src, file] of Object.entries(files.sourceSentences)) {
    const needed = neededBySource.get(src);
    if (!needed || needed.size === 0) continue;
    for await (const line of readLines(file)) {
      const s = parseSentenceLine(line);
      if (s && needed.has(s.id)) sourceSentences.set(s.id, s);
    }
  }

  // Stage 4: audio for candidates.
  const audioByCandidate = new Map<string, TatoebaAudio[]>();
  if (files.audio) for await (const line of readLines(files.audio)) {
    const a = parseAudioLine(line);
    if (!a || !candidates.has(a.sentenceId)) continue;
    const arr = audioByCandidate.get(a.sentenceId) ?? [];
    arr.push(a);
    audioByCandidate.set(a.sentenceId, arr);
  }

  // Stage 5: curate + emit.
  const drafts: ExpressionDraft[] = [];
  const byIntent: Record<string, number> = {};
  let linked = 0;
  let withAudio = 0;
  let audioRedistributable = 0;
  let intentMatched = 0;
  for (const [id, c] of candidates) {
    const translations = (linksByCandidate.get(id) ?? [])
      .map((l) => {
        const s = sourceSentences.get(l.id);
        const code = SOURCE_ISO3[l.src];
        return s && code ? { sentence: { ...s, text: s.text }, sourceLanguageCode: code, cc0: cc0Ids.has(s.id) } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .filter((t) => normalizeText(t.sentence.text).length > 0);
    if (translations.length) linked += 1;
    if (options.requireTranslation && !translations.length) {
      reject('no_source_translation');
      continue;
    }
    const audio = audioByCandidate.get(id) ?? [];
    const draft = buildDraft({ sentence: c.sentence, text: c.text, varietyId, varietyAssignment: assignment, translations, audio, cc0: cc0Ids.has(id), provenance, checks: c.checks, wordCount: c.wordCount, minIntentConfidence: options.minIntentConfidence });
    if (!draft.curation.intentKey && !options.keepUnmatched) {
      reject('intent_unmatched');
      continue;
    }
    if (draft.curation.intentKey) {
      intentMatched += 1;
      byIntent[draft.curation.intentKey] = (byIntent[draft.curation.intentKey] ?? 0) + 1;
    }
    if (audio.length) withAudio += 1;
    if (draft.audio.some((a) => a.redistributionPermitted)) audioRedistributable += 1;
    drafts.push(draft);
    if (drafts.length >= options.limit) break;
  }

  return {
    drafts,
    summary: { target: options.target, varietyId, varietyAssignment: assignment, snapshotId, inputs, scanned, rejected, candidates: candidates.size, linked, withAudio, audioRedistributable, intentMatched, emitted: drafts.length, byIntent, notes },
  };
}

async function readFirstLine(path: string): Promise<string> {
  for await (const line of readLines(path)) return line;
  return '';
}
