/**
 * Hebrew → Latin, basic.
 *
 * LIMITATIONS:
 * - Unpointed Hebrew omits most vowels. Without niqqud the output is a consonant skeleton
 *   (`שלום` → `shlvm`-style readings are NOT invented; we output `shlom` only when niqqud is
 *   present, otherwise `shlwm`). Use content-provided transliterations for learners; this
 *   module exists for editor hints and search normalisation.
 * - With niqqud: patach/qamats → `a`, segol/tsere → `e`, hiriq → `i`, holam → `o`,
 *   qubuts/shuruk → `u`, shva is dropped, dagesh distinguishes `b/v`, `k/kh`, `p/f`.
 * - `ו` → `v` (consonant) or `o`/`u` when carrying holam/shuruk; `י` → `y` (or `i` after a
 *   consonant with no vowel when `treatYodAsVowel` is on).
 * - Final forms (ך ם ן ף ץ) map like their regular counterparts. Geresh/gershayim loan
 *   sounds: `ג׳` → `j`, `ז׳` → `zh`, `צ׳` → `ch`.
 */

const CONSONANTS: Readonly<Record<string, string>> = {
  א: '', ב: 'v', ג: 'g', ד: 'd', ה: 'h', ו: 'v', ז: 'z', ח: 'ch', ט: 't', י: 'y', כ: 'kh', ך: 'kh', ל: 'l', מ: 'm', ם: 'm',
  נ: 'n', ן: 'n', ס: 's', ע: '', פ: 'f', ף: 'f', צ: 'ts', ץ: 'ts', ק: 'k', ר: 'r', ש: 'sh', ת: 't',
};

const WITH_DAGESH: Readonly<Record<string, string>> = { ב: 'b', כ: 'k', ך: 'k', פ: 'p', ף: 'p', ו: 'u' };
const WITH_GERESH: Readonly<Record<string, string>> = { ג: 'j', ז: 'zh', צ: 'ch', ץ: 'ch', ת: 'th', ד: 'dh' };

const DAGESH = 'ּ';
const SHIN_DOT = 'ׁ';
const SIN_DOT = 'ׂ';
const HOLAM = 'ֹ';
const HOLAM_HASER = 'ֺ';
const SHVA = 'ְ';
const GERESH = /[׳']/;

const VOWEL_POINTS: Readonly<Record<string, string>> = {
  'ַ': 'a', // patach
  'ָ': 'a', // qamats
  'ֲ': 'a', // hataf patach
  'ֳ': 'o', // hataf qamats
  'ֶ': 'e', // segol
  'ֵ': 'e', // tsere
  'ֱ': 'e', // hataf segol
  'ִ': 'i', // hiriq
  [HOLAM]: 'o',
  [HOLAM_HASER]: 'o',
  'ֻ': 'u', // qubuts
  [SHVA]: '',
};

const isHebrewLetter = (ch: string): boolean => /[א-ת]/.test(ch);
const isPoint = (ch: string): boolean => /[ְ-ׇ]/.test(ch);

export interface HebrewRomanizeOptions {
  /** Treat a bare `י` after a consonant as the vowel `i` (helps unpointed words like `דין` → `din`). Default true. */
  treatYodAsVowel?: boolean;
  /** Treat a bare `ו` between consonants as `o` (common unpointed reading). Default true. */
  treatVavAsVowel?: boolean;
}

/** Romanise Hebrew. Works best with niqqud; unpointed text yields a readable skeleton. */
export function romanizeHebrew(text: string, options: HebrewRomanizeOptions = {}): string {
  const treatYod = options.treatYodAsVowel ?? true;
  const treatVav = options.treatVavAsVowel ?? true;
  const chars = [...text.normalize('NFD')];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (!isHebrewLetter(ch)) {
      if (!isPoint(ch) && ch !== SHIN_DOT && ch !== SIN_DOT) out += ch === '־' ? '-' : ch; // maqaf
      i += 1;
      continue;
    }
    // collect marks attached to this letter
    let j = i + 1;
    let dagesh = false;
    let sinDot = false;
    let vowel: string | null = null;
    let geresh = false;
    while (j < chars.length) {
      const m = chars[j]!;
      if (m === DAGESH) dagesh = true;
      else if (m === SIN_DOT) sinDot = true;
      else if (m === SHIN_DOT) {
        /* default shin */
      } else if (VOWEL_POINTS[m] !== undefined) vowel = VOWEL_POINTS[m]!;
      else if (GERESH.test(m)) geresh = true;
      else if (!isPoint(m)) break;
      j += 1;
    }
    const prevLetter: string = out.length > 0 ? out.charAt(out.length - 1) : '';
    const nextLetterIdx = j;
    const next = chars[nextLetterIdx] ?? '';
    const pointed = vowel !== null || dagesh;

    let mapped: string;
    if (geresh && WITH_GERESH[ch] !== undefined) mapped = WITH_GERESH[ch]!;
    else if (ch === 'ש' && sinDot) mapped = 's';
    else if (ch === 'ו') {
      if (dagesh && vowel === null) mapped = 'u';
      else if (vowel === 'o') {
        mapped = 'o';
        vowel = null;
      } else if (!pointed && treatVav && isHebrewLetter(next) && prevLetter !== '' && /[a-z]/i.test(prevLetter) && !/[aeiou]/i.test(prevLetter)) mapped = 'o';
      else mapped = 'v';
    } else if (ch === 'י' && !pointed && treatYod && prevLetter !== '' && /[a-z]/i.test(prevLetter) && !/[aeiou]/i.test(prevLetter)) mapped = 'i';
    else if (dagesh && WITH_DAGESH[ch] !== undefined) mapped = WITH_DAGESH[ch]!;
    else mapped = CONSONANTS[ch] ?? ch;

    // Final-he after a vowel is silent (`תודה` → `toda`); pointed he keeps its sound.
    if (ch === 'ה' && !pointed && !isHebrewLetter(next) && /[aeiou]$/i.test(out)) mapped = '';

    out += mapped + (vowel ?? '');
    i = j;
  }
  return out;
}

/** True when the text carries any niqqud (vowel points or dagesh). */
export const hasNiqqud = (text: string): boolean => /[ְ-ׇֽֿׁׂ]/.test(text.normalize('NFD'));

/** Remove niqqud and cantillation marks (for search / comparison). */
export const stripNiqqud = (text: string): string => text.normalize('NFD').replace(/[֑-ֽֿ-ׇ]/g, '').normalize('NFC');
