/**
 * Moroccan Darija ↔ Arabizi (Latin chat alphabet) hints.
 *
 * LIMITATIONS (read before relying on this):
 * - Arabic script usually omits short vowels. `romanizeArabicDarija` therefore produces a
 *   consonant skeleton plus long vowels; it is a *best-effort hint*, not a pronunciation
 *   guide. Reviewed Arabizi must come from content authored by native speakers.
 * - Arabizi has no single standard. We use the most common Moroccan conventions
 *   (3 = ع, 7 = ح, 9 = ق, kh = خ, gh = غ, ch = ش). Egyptian/Levantine conventions differ.
 * - French loanwords written in Latin script are passed through unchanged (code-switching
 *   is part of Darija, spec §2.3).
 * - Reverse mapping (Arabizi → Arabic) is ambiguous for vowels; `arabiziToArabicHints`
 *   returns candidate letters per token for an editor UI, never a finished Arabic string.
 */

/** Arabic letter → Arabizi, Moroccan conventions. */
export const ARABIC_TO_ARABIZI: Readonly<Record<string, string>> = {
  'ا': 'a',
  'أ': 'a',
  'إ': 'i',
  'آ': 'a',
  'ٱ': 'a',
  'ب': 'b',
  'پ': 'p',
  'ت': 't',
  'ث': 'th',
  'ج': 'j',
  'ح': '7',
  'خ': 'kh',
  'د': 'd',
  'ذ': 'd',
  'ر': 'r',
  'ز': 'z',
  'س': 's',
  'ش': 'ch',
  'ص': 's',
  'ض': 'd',
  'ط': 't',
  'ظ': 'd',
  'ع': '3',
  'غ': 'gh',
  'ف': 'f',
  'ڤ': 'v',
  'ق': '9',
  'ك': 'k',
  'گ': 'g',
  'ل': 'l',
  'م': 'm',
  'ن': 'n',
  'ه': 'h',
  'و': 'w',
  'ي': 'y',
  'ى': 'a',
  'ة': 'a',
  'ء': "'",
  'ؤ': "'",
  'ئ': "'",
  'ﻻ': 'la',
  'لا': 'la',
};

/** Arabizi token → candidate Arabic letters (first candidate is the most common reading). */
export const ARABIZI_TO_ARABIC: Readonly<Record<string, readonly string[]>> = {
  '2': ['ء', 'أ'],
  '3': ['ع'],
  '5': ['خ'],
  '6': ['ط'],
  '7': ['ح'],
  '8': ['غ', 'ق'],
  '9': ['ق', 'ص'],
  "3'": ['غ'],
  "7'": ['خ'],
  "9'": ['ض'],
  a: ['ا', 'ة'],
  b: ['ب'],
  ch: ['ش'],
  sh: ['ش'],
  d: ['د', 'ض', 'ذ'],
  dh: ['ذ', 'ظ'],
  e: ['ا', 'ي'],
  f: ['ف'],
  g: ['گ', 'ق'],
  gh: ['غ'],
  h: ['ه', 'ح'],
  i: ['ي', 'إ'],
  j: ['ج'],
  k: ['ك'],
  kh: ['خ'],
  l: ['ل'],
  m: ['م'],
  n: ['ن'],
  o: ['و'],
  ou: ['و'],
  p: ['پ', 'ب'],
  q: ['ق'],
  r: ['ر'],
  s: ['س', 'ص'],
  t: ['ت', 'ط'],
  th: ['ث'],
  u: ['و'],
  v: ['ڤ', 'ف'],
  w: ['و'],
  y: ['ي'],
  z: ['ز', 'ظ'],
};

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const SHADDA = 'ّ';
const FATHA = 'َ';
const DAMMA = 'ُ';
const KASRA = 'ِ';
const SUKUN = 'ْ';

const SHORT_VOWELS: Readonly<Record<string, string>> = { [FATHA]: 'a', [DAMMA]: 'u', [KASRA]: 'i' };

/** Strip harakat / tashkeel marks (keeps letters). */
export const stripTashkeel = (text: string): string => text.replace(TASHKEEL, '');

/** True when the text contains at least one Arabic-script letter. */
export const containsArabicScript = (text: string): boolean => /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(text);

/**
 * Best-effort romanisation of Darija written in Arabic script into Arabizi.
 * Honours harakat when present (fatha/damma/kasra → a/u/i, shadda doubles), drops
 * other marks, maps letters with the Moroccan table, and leaves Latin runs untouched.
 */
export function romanizeArabicDarija(text: string): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1];
    if (ch === 'ل' && next === 'ا') {
      out += 'la';
      i += 1;
      continue;
    }
    const base = ARABIC_TO_ARABIZI[ch];
    if (base !== undefined) {
      // Word-final taa marbuta is "a"; medial (rare, before a suffix) is "t".
      const after = chars[i + 1];
      const atWordEnd = after === undefined || /\s|\p{P}/u.test(after) || after === SHADDA && (chars[i + 2] === undefined);
      out += ch === 'ة' && !atWordEnd ? 't' : base;
      continue;
    }
    if (ch === SHADDA) {
      const last = out.slice(-1);
      if (last && !/\s/.test(last)) out += last;
      continue;
    }
    const vowel = SHORT_VOWELS[ch];
    if (vowel !== undefined) {
      out += vowel;
      continue;
    }
    if (ch === SUKUN || TASHKEEL.test(ch)) {
      TASHKEEL.lastIndex = 0;
      continue;
    }
    TASHKEEL.lastIndex = 0;
    if (ch === '؟') out += '?';
    else if (ch === '،') out += ',';
    else if (ch === '؛') out += ';';
    else if (/[٠-٩]/.test(ch)) out += String(ch.charCodeAt(0) - 0x0660);
    else out += ch;
  }
  return out;
}

export interface ArabiziHint {
  token: string;
  candidates: readonly string[];
}

/**
 * Tokenise an Arabizi string into the digraphs/digits the table knows and return the
 * candidate Arabic letters for each token (for an editor hint UI). Unknown characters
 * are returned with an empty candidate list.
 */
export function arabiziToArabicHints(text: string): ArabiziHint[] {
  const lower = text.toLowerCase();
  const keys = Object.keys(ARABIZI_TO_ARABIC).sort((a, b) => b.length - a.length);
  const hints: ArabiziHint[] = [];
  let i = 0;
  while (i < lower.length) {
    const ch = lower[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const key = keys.find((k) => lower.startsWith(k, i));
    if (key) {
      hints.push({ token: key, candidates: ARABIZI_TO_ARABIC[key]! });
      i += key.length;
    } else {
      hints.push({ token: ch, candidates: [] });
      i += 1;
    }
  }
  return hints;
}

/** True when the text looks like Arabizi (Latin letters mixed with the characteristic digits). */
export function looksLikeArabizi(text: string): boolean {
  return /[a-z]/i.test(text) && /[23579]/.test(text) && !containsArabicScript(text);
}
