/**
 * Hangul → Revised Romanization of Korean (RR, 2000), algorithmic.
 *
 * Each precomposed syllable (U+AC00–U+D7A3) is decomposed into initial (choseong), medial
 * (jungseong) and final (jongseong) jamo and mapped with the official RR tables.
 *
 * Sound-change rules implemented:
 * - Final consonant followed by a vowel-initial syllable is resyllabified (`한국어` → `hangugeo`,
 *   `밥이` → `babi`): the final is pronounced with its initial-position value.
 * - `ㄹ` + `ㄹ` → `ll`; final `ㄹ` before a vowel → `r`.
 * - Nasalisation of stops before `ㄴ`/`ㅁ` (`국물` → `gungmul`, `입니다` → `imnida`).
 * - `ㄴ`+`ㄹ` and `ㄹ`+`ㄴ` → `ll` (`신라` → `silla`).
 * - Aspiration with `ㅎ` (`좋다` → `jota`, `각하` → `gaka`).
 *
 * LIMITATIONS: palatalisation (`굳이` → `guji`), tensification and most compound-final
 * (겹받침) pronunciations beyond the dictionary-free rules are NOT modelled; proper-noun
 * hyphenation conventions are out of scope. Hangul compatibility jamo (ㄱ, ㅏ …) map to
 * their isolated values.
 */

const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'] as const;
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'] as const;
/** Final consonants as pronounced before a pause/consonant (index 0 = none). */
const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'] as const;
/** Final consonants re-syllabified before a vowel (the "initial-position" value). */
const FINALS_BEFORE_VOWEL = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'r', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'] as const;
/** Jongseong index → the sound class used by sound-change rules. */
const FINAL_CLASS: ReadonlyArray<'' | 'k' | 'n' | 't' | 'l' | 'm' | 'p' | 'ng' | 'h'> = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 'h',
];

const CH_N = 2;
const CH_R = 5;
const CH_M = 6;
const CH_SILENT = 11;
const CH_H = 18;
/** Plain stops that become aspirated after a ㅎ final: ㄱ→k, ㄷ→t, ㅈ→ch. */
const ASPIRATED_BY_H: Readonly<Record<number, string>> = { 0: 'k', 3: 't', 12: 'ch' };

const COMPAT_JAMO: Readonly<Record<string, string>> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp', ㅅ: 's', ㅆ: 'ss', ㅇ: 'ng', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
  ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae', ㅚ: 'oe', ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i',
};

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;

export interface HangulSyllable {
  initial: number;
  medial: number;
  final: number;
}

/** Decompose one precomposed Hangul syllable into jamo indices, or `null` for other characters. */
export function decomposeHangul(ch: string): HangulSyllable | null {
  const code = ch.codePointAt(0);
  if (code === undefined || code < HANGUL_BASE || code > HANGUL_END) return null;
  const offset = code - HANGUL_BASE;
  return { initial: Math.floor(offset / 588), medial: Math.floor((offset % 588) / 28), final: offset % 28 };
}

export const isHangulSyllable = (ch: string): boolean => decomposeHangul(ch) !== null;

/** Romanise a Korean string with Revised Romanization. Non-Hangul characters pass through. */
export function hangulToRevisedRomanization(text: string): string {
  const chars = [...text];
  const syllables = chars.map((ch) => decomposeHangul(ch));
  /** Initial consonant text forced by the previous syllable's sound-change rule. */
  const initialOverride: Array<string | null> = chars.map(() => null);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const syl = syllables[i];
    if (!syl) {
      out += COMPAT_JAMO[chars[i]!] ?? chars[i];
      continue;
    }
    const next = syllables[i + 1] ?? null;
    let initial: string = initialOverride[i] ?? INITIALS[syl.initial]!;
    const medial: string = MEDIALS[syl.medial]!;
    let final: string = FINALS[syl.final]!;
    const cls = FINAL_CLASS[syl.final]!;

    if (next) {
      const ni = next.initial;
      if (ni === CH_SILENT) {
        final = syl.final === 21 ? 'ng' : FINALS_BEFORE_VOWEL[syl.final]!;
      } else if (ni === CH_H && (cls === 'k' || cls === 't' || cls === 'p')) {
        // ㄱ/ㄷ/ㅂ + ㅎ → aspirated stop carried by the next syllable (각하 → gaka)
        final = '';
        initialOverride[i + 1] = cls;
      } else if (cls === 'h' && ASPIRATED_BY_H[ni] !== undefined) {
        // ㅎ + plain stop → aspirated stop (좋다 → jota)
        final = '';
        initialOverride[i + 1] = ASPIRATED_BY_H[ni]!;
      } else if ((ni === CH_N || ni === CH_M) && (cls === 'k' || cls === 't' || cls === 'p')) {
        final = cls === 'k' ? 'ng' : cls === 't' ? 'n' : 'm';
      } else if (cls === 'l' && ni === CH_N) {
        final = 'l';
        initialOverride[i + 1] = 'l';
      } else if (cls === 'n' && ni === CH_R) {
        final = 'l';
        initialOverride[i + 1] = 'l';
      } else if (cls === 'l' && ni === CH_R) {
        final = 'l';
        initialOverride[i + 1] = 'l';
      }
    }
    if (initialOverride[i] === null && syl.initial === CH_R && out.endsWith('l')) initial = 'l';
    out += initial + medial + final;
  }
  return out;
}

/** Capitalise the first letter of each whitespace-separated word (for names/titles). */
export const capitalizeWords = (romanized: string): string => romanized.replace(/(^|\s)(\p{L})/gu, (_, sp: string, l: string) => sp + l.toUpperCase());
