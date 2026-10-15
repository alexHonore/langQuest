/**
 * Text hygiene for corpus imports (spec §9.2): safe Unicode normalisation that never strips
 * diacritics or breaks scripts, script detection, language sanity checks and a conservative
 * toxic/irrelevant filter. Everything here is pure and deterministic.
 */

/** Characters removed on normalisation: C0/C1 controls (except tab/newline handled separately), bidi controls, zero-width marks, BOM. */
const STRIP_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/**
 * NFC-normalise, drop invisible control characters and collapse whitespace. Keeps every
 * letter, diacritic (harakat, niqqud, tone marks…) and punctuation of every script.
 */
export function normalizeText(input: string): string {
  return input.normalize('NFC').replace(STRIP_RE, '').replace(/[\t\r\n ]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export type DetectedScript = 'Latn' | 'Arab' | 'Cyrl' | 'Grek' | 'Hebr' | 'Deva' | 'Jpan' | 'Hani' | 'Kore' | 'Thai' | 'other' | 'none';

const SCRIPT_RANGES: Array<[DetectedScript, RegExp]> = [
  ['Arab', /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g],
  ['Cyrl', /[Ѐ-ӿԀ-ԯ]/g],
  ['Grek', /[Ͱ-Ͽἀ-῿]/g],
  ['Hebr', /[֐-׿יִ-ﭏ]/g],
  ['Deva', /[ऀ-ॿ]/g],
  ['Jpan', /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/g],
  ['Hani', /[㐀-䶿一-鿿豈-﫿]/g],
  ['Kore', /[가-힯ᄀ-ᇿ㄰-㆏]/g],
  ['Thai', /[฀-๿]/g],
  ['Latn', /[A-Za-zÀ-ɏḀ-ỿ]/g],
];

export interface ScriptProfile {
  dominant: DetectedScript;
  counts: Partial<Record<DetectedScript, number>>;
  letters: number;
}

/** Count letters per script and name the dominant one. Kana + Han together read as `Jpan`. */
export function detectScript(text: string): ScriptProfile {
  const counts: Partial<Record<DetectedScript, number>> = {};
  let letters = 0;
  for (const [script, re] of SCRIPT_RANGES) {
    const n = (text.match(re) ?? []).length;
    if (n > 0) {
      counts[script] = n;
      letters += n;
    }
  }
  if (letters === 0) return { dominant: 'none', counts, letters };
  if ((counts.Jpan ?? 0) > 0 && (counts.Hani ?? 0) > 0) {
    counts.Jpan = (counts.Jpan ?? 0) + (counts.Hani ?? 0);
    delete counts.Hani;
  }
  let dominant: DetectedScript = 'other';
  let best = 0;
  for (const [s, n] of Object.entries(counts) as Array<[DetectedScript, number]>) {
    if (n > best) {
      best = n;
      dominant = s;
    }
  }
  return { dominant, counts, letters };
}

/** Expected dominant script for a Tatoeba ISO-639-3 code (or a LangQuest language code). */
export const EXPECTED_SCRIPT: Readonly<Record<string, DetectedScript[]>> = {
  eng: ['Latn'], en: ['Latn'],
  fra: ['Latn'], fr: ['Latn'],
  spa: ['Latn'], es: ['Latn'],
  por: ['Latn'], pt: ['Latn'],
  ita: ['Latn'], it: ['Latn'],
  deu: ['Latn'], de: ['Latn'],
  dan: ['Latn'], da: ['Latn'],
  swe: ['Latn'], sv: ['Latn'],
  ron: ['Latn'], ro: ['Latn'],
  hat: ['Latn'], ht: ['Latn'],
  swh: ['Latn'], sw: ['Latn'],
  kin: ['Latn'], rw: ['Latn'],
  lin: ['Latn'], ln: ['Latn'],
  vie: ['Latn'], vi: ['Latn'],
  rus: ['Cyrl'], ru: ['Cyrl'],
  ukr: ['Cyrl'], uk: ['Cyrl'],
  ell: ['Grek'], el: ['Grek'],
  heb: ['Hebr'], he: ['Hebr'],
  hin: ['Deva'], hi: ['Deva'],
  jpn: ['Jpan', 'Hani'], ja: ['Jpan', 'Hani'],
  kor: ['Kore'], ko: ['Kore'],
  cmn: ['Hani'], yue: ['Hani'], zh: ['Hani'],
  ara: ['Arab'], arz: ['Arab'], ary: ['Arab'], apc: ['Arab'], ar: ['Arab'],
};

/** Small function-word lists for Latin-script sanity checks (a sentence in the wrong language usually has none). */
const STOPWORDS: Readonly<Record<string, readonly string[]>> = {
  eng: ['the', 'is', 'are', 'you', 'i', 'to', 'and', 'it', 'of', 'a', 'in', 'that', 'do', 'have', 'not', 'my', 'me', 'we', 'this', 'what', 'can', 'please', 'thank', 'how', 'where'],
  fra: ['le', 'la', 'les', 'je', 'tu', 'vous', 'nous', 'est', 'et', 'un', 'une', 'des', 'de', 'du', 'pas', 'ne', 'que', 'qui', 'ce', 'il', 'elle', 'merci', 'bonjour', 'où', 'comment', "s'il", "c'est", "j'ai"],
  spa: ['el', 'la', 'los', 'las', 'es', 'y', 'un', 'una', 'de', 'que', 'no', 'me', 'te', 'se', 'por', 'para', 'con', 'yo', 'tú', 'usted', 'gracias', 'hola', 'dónde', 'cómo', 'qué', 'está', 'tengo', 'quiero'],
  por: ['o', 'a', 'os', 'as', 'é', 'e', 'um', 'uma', 'de', 'que', 'não', 'me', 'você', 'eu', 'com', 'para', 'por', 'obrigado', 'obrigada', 'olá', 'onde', 'como', 'está', 'tenho', 'quero'],
  ita: ['il', 'la', 'lo', 'gli', 'le', 'è', 'e', 'un', 'una', 'di', 'che', 'non', 'mi', 'ti', 'ho', 'sono', 'per', 'con', 'grazie', 'ciao', 'dove', 'come', 'cosa', 'vorrei'],
  deu: ['der', 'die', 'das', 'ist', 'und', 'ein', 'eine', 'ich', 'du', 'sie', 'wir', 'nicht', 'zu', 'mit', 'ja', 'nein', 'bitte', 'danke', 'wo', 'wie', 'was', 'habe', 'möchte'],
};
const SPANISH_ONLY = ['¿', '¡', 'ñ'];

export interface LanguageSanity {
  ok: boolean;
  reason: string | null;
  script: DetectedScript;
}

/**
 * Cheap sanity check that a sentence plausibly belongs to `lang` (ISO-639-3 or LangQuest code):
 * script must match; for Latin-script languages at least one function word (or a language-only
 * character) must be present once the sentence has three or more words.
 */
export function languageSanity(text: string, lang: string): LanguageSanity {
  const profile = detectScript(text);
  const expected = EXPECTED_SCRIPT[lang];
  if (!expected) return { ok: true, reason: null, script: profile.dominant };
  if (profile.dominant === 'none') return { ok: false, reason: 'no_letters', script: profile.dominant };
  if (!expected.includes(profile.dominant)) return { ok: false, reason: `script_${profile.dominant}_expected_${expected[0]}`, script: profile.dominant };
  const words = text.toLowerCase().split(/[\s,.;:!?¿¡"'«»()\-–—]+/).filter(Boolean);
  const list = STOPWORDS[lang] ?? STOPWORDS[iso3For(lang) ?? ''];
  if (list && words.length >= 3) {
    const hit = words.some((w) => list.includes(w)) || (lang === 'spa' && SPANISH_ONLY.some((c) => text.includes(c)));
    if (!hit) return { ok: false, reason: 'no_function_words', script: profile.dominant };
  }
  return { ok: true, reason: null, script: profile.dominant };
}

const ISO3_BY_CODE: Readonly<Record<string, string>> = { en: 'eng', fr: 'fra', es: 'spa', pt: 'por', it: 'ita', de: 'deu', ru: 'rus', ja: 'jpn', ar: 'ara' };
export const iso3For = (code: string): string | null => ISO3_BY_CODE[code] ?? null;

/**
 * Conservative multilingual slur/profanity stems. Matching is on whole words after lowercasing
 * and diacritic folding; the list is deliberately short (false positives are reviewed, false
 * negatives are caught by native review). Extend via `extraToxicTerms`.
 */
export const TOXIC_TERMS: readonly string[] = [
  // English
  'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'dick', 'cock', 'pussy', 'motherfucker',
  // French
  'merde', 'putain', 'salope', 'connard', 'connasse', 'enculé', 'enculé', 'pute', 'nègre', 'bougnoule', 'pédé', 'batard', 'bâtard', 'couilles', 'niquer', 'bite',
  // Spanish
  'mierda', 'puta', 'puto', 'cabrón', 'cabron', 'gilipollas', 'pendejo', 'coño', 'joder', 'maricón', 'maricon', 'chinga', 'chingar', 'culero', 'verga', 'pinche', 'zorra',
  // Portuguese
  'merda', 'porra', 'caralho', 'puta', 'viado', 'foda', 'foder', 'buceta', 'cu', 'otário', 'preto fedido',
  // Italian
  'cazzo', 'merda', 'puttana', 'stronzo', 'vaffanculo', 'troia', 'frocio', 'negro di merda', 'coglione',
  // German
  'scheiße', 'scheisse', 'fick', 'ficken', 'arschloch', 'hure', 'schlampe', 'fotze', 'wichser', 'schwuchtel', 'neger',
  // Russian (transliterated + Cyrillic)
  'блядь', 'бля', 'сука', 'хуй', 'пизда', 'ебать', 'ёбаный', 'ебаный', 'пидор', 'пидорас', 'хач', 'чурка', 'жид',
  // Arabic
  'كس', 'زب', 'شرموطة', 'خول', 'منيوك', 'عرص', 'كسمك', 'قحبة', 'زامل',
  // Japanese
  'くそ', 'クソ', 'ちくしょう', 'きちがい', 'キチガイ', 'ばか野郎',
];

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface ToxicityResult {
  toxic: boolean;
  matches: string[];
}

/** Whole-word toxic-term match (diacritic-insensitive for Latin). */
export function checkToxicity(text: string, extraToxicTerms: readonly string[] = []): ToxicityResult {
  const terms = [...TOXIC_TERMS, ...extraToxicTerms];
  const folded = fold(text);
  const matches: string[] = [];
  for (const term of terms) {
    const t = fold(term);
    if (/^[a-z0-9 ]+$/.test(t)) {
      const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (re.test(folded)) matches.push(term);
    } else if (folded.includes(t)) {
      // Non-Latin terms: substring match on the original script (Arabic/Cyrillic words are short; review catches edge cases).
      matches.push(term);
    }
  }
  return { toxic: matches.length > 0, matches };
}

export interface RelevanceResult {
  relevant: boolean;
  reasons: string[];
  wordCount: number;
}

export interface RelevanceOptions {
  /** Max words for a beginner expression (default 14). */
  maxWords?: number;
  minWords?: number;
}

const URL_RE = /https?:\/\/|www\.|@[a-z0-9]+\.[a-z]{2,}/i;

/**
 * Flags sentences that are poor beginner-expression material: too long, URLs/emails, mostly
 * digits, all caps shouting, unbalanced quotes, or the Tatoeba "Tom/Mary" corpus persona
 * (kept, but tagged so curators can down-rank).
 */
export function checkRelevance(text: string, options: RelevanceOptions = {}): RelevanceResult {
  const maxWords = options.maxWords ?? 14;
  const minWords = options.minWords ?? 1;
  const reasons: string[] = [];
  const script = detectScript(text);
  // CJK has no spaces: count characters as words there.
  const wordCount = script.dominant === 'Jpan' || script.dominant === 'Hani' ? text.replace(/[\s\p{P}]/gu, '').length / 2 : text.split(/\s+/).filter(Boolean).length;
  if (wordCount > maxWords) reasons.push('too_long');
  if (wordCount < minWords) reasons.push('too_short');
  if (URL_RE.test(text)) reasons.push('url_or_email');
  const digits = (text.match(/\d/g) ?? []).length;
  if (digits > 0 && digits / Math.max(1, text.replace(/\s/g, '').length) > 0.4) reasons.push('mostly_digits');
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 6 && letters === letters.toUpperCase()) reasons.push('all_caps');
  if (/\b(Tom|Mary|Marie|Maria|María|Том|Мэри|トム|メアリー|توم|ماري)\b/u.test(text)) reasons.push('corpus_persona_name');
  if (/\[|\]|\{|\}|<|>/.test(text)) reasons.push('markup');
  return { relevant: !reasons.some((r) => r !== 'corpus_persona_name'), reasons, wordCount };
}
