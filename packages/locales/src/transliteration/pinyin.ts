/**
 * Hanyu Pinyin tone-number ↔ tone-mark conversion and syllable validation.
 *
 * Placement rules (standard): the mark goes on `a` or `e` if present; on `o` in `ou`;
 * otherwise on the last vowel. `v` and `u:` are accepted as `ü`. Tone 5/0 is neutral (no
 * mark). Input like `ni3hao3`, `ni3 hao3`, `Zhong1guo2` and `lv4` is supported.
 *
 * LIMITATIONS: the converter does not segment un-numbered run-together syllables, and
 * validation checks the syllable inventory only (no tone-sandhi, no erhua beyond a trailing `r`).
 */

const TONE_MARKS: Readonly<Record<string, readonly string[]>> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  A: ['Ā', 'Á', 'Ǎ', 'À'],
  E: ['Ē', 'É', 'Ě', 'È'],
  I: ['Ī', 'Í', 'Ǐ', 'Ì'],
  O: ['Ō', 'Ó', 'Ǒ', 'Ò'],
  U: ['Ū', 'Ú', 'Ǔ', 'Ù'],
  Ü: ['Ǖ', 'Ǘ', 'Ǚ', 'Ǜ'],
};

const MARK_TO_BASE: Readonly<Record<string, { base: string; tone: number }>> = Object.fromEntries(
  Object.entries(TONE_MARKS).flatMap(([base, marks]) => marks.map((m, i) => [m, { base, tone: i + 1 }])),
);

const INITIALS = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w', ''] as const;
const FINALS = [
  'a', 'o', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er',
  'ia', 'ie', 'iao', 'iu', 'iou', 'ian', 'in', 'iang', 'ing', 'iong',
  'ua', 'uo', 'uai', 'ui', 'uei', 'uan', 'un', 'uen', 'uang', 'ueng',
  'üe', 'üan', 'ün', 've', 'van', 'vn', 'v',
] as const;
const SYLLABLE_RE = new RegExp(`^(${INITIALS.filter(Boolean).join('|')})?(${[...FINALS].sort((a, b) => b.length - a.length).join('|')})r?$`);

/** Normalise `v` / `u:` to `ü`. */
export const normalizeUmlaut = (syllable: string): string => syllable.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü').replace(/V/g, 'Ü');

/** Place a tone mark on one syllable (without a tone number). Tone 0/5 returns the bare syllable. */
export function placeToneMark(syllable: string, tone: number): string {
  const s = normalizeUmlaut(syllable);
  if (tone < 1 || tone > 4) return s;
  const lower = s.toLowerCase();
  let idx = -1;
  if (lower.includes('a')) idx = lower.indexOf('a');
  else if (lower.includes('e')) idx = lower.indexOf('e');
  else if (lower.includes('ou')) idx = lower.indexOf('o');
  else {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('iouü'.includes(lower[i]!)) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return s;
  const vowel = s[idx]!;
  const marked = TONE_MARKS[vowel]?.[tone - 1];
  return marked ? s.slice(0, idx) + marked + s.slice(idx + 1) : s;
}

/** `ni3 hao3` / `ni3hao3` / `Zhong1guo2` → `nǐ hǎo` / `nǐhǎo` / `Zhōngguó`. */
export function toneNumbersToMarks(text: string): string {
  return text.replace(/([A-Za-zü:]+?)([0-5])/g, (_, syl: string, tone: string) => placeToneMark(syl, Number(tone)));
}

/** `nǐ hǎo` → `ni3 hao3`. Unmarked syllables stay unnumbered (caller decides neutral tone). */
export function toneMarksToNumbers(text: string): string {
  const chars = [...text];
  const isVowel = (c: string | undefined) => c !== undefined && /[aeiouüAEIOUÜ]/.test(MARK_TO_BASE[c]?.base ?? c);
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    const mark = MARK_TO_BASE[ch];
    if (!mark) {
      out += ch;
      i += 1;
      continue;
    }
    // marked vowel: emit base, then finish the syllable (remaining vowels, then a coda n/ng/r
    // that is not itself the onset of the next syllable) before writing the tone number.
    out += mark.base;
    i += 1;
    while (isVowel(chars[i]) && !MARK_TO_BASE[chars[i]!]) out += chars[i++]!;
    const c1 = chars[i]?.toLowerCase();
    const c2 = chars[i + 1]?.toLowerCase();
    const c3 = chars[i + 2];
    if (c1 === 'n' && c2 === 'g' && !isVowel(c3)) {
      out += chars[i]! + chars[i + 1]!;
      i += 2;
    } else if ((c1 === 'n' || c1 === 'r') && !isVowel(chars[i + 1])) {
      out += chars[i]!;
      i += 1;
    }
    out += String(mark.tone);
  }
  return out;
}

/** Validate a single pinyin syllable (tone marks or numbers allowed). */
export function isValidPinyinSyllable(syllable: string): boolean {
  const numbered = toneMarksToNumbers(normalizeUmlaut(syllable)).toLowerCase().replace(/[0-5]$/, '');
  return SYLLABLE_RE.test(numbered);
}

export interface PinyinValidation {
  valid: boolean;
  invalidSyllables: string[];
}

/** Validate whitespace/apostrophe separated pinyin. */
export function validatePinyin(text: string): PinyinValidation {
  const tokens = text.split(/[\s'’]+/).filter(Boolean);
  const invalidSyllables = tokens.filter((t) => !isValidPinyinSyllable(t.replace(/[,.!?;:]+$/, '')));
  return { valid: invalidSyllables.length === 0, invalidSyllables };
}
