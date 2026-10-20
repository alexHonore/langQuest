/**
 * Script-aware tokenisation for the dialogue diversity metric (spec §9.8 "generate diverse
 * dialogues, not a rigid one-correct-answer quiz").
 *
 * Pure and deterministic (no `Intl.Segmenter`, whose dictionary segmentation differs between ICU
 * builds and is missing on Hermes):
 *  - scripts written with spaces (Latin incl. Arabizi digits, Cyrillic, Greek, Arabic, Hebrew,
 *    Devanagari, Hangul…) split into word tokens on anything that is not a letter, mark or digit;
 *  - scripts written without spaces (Han, Hiragana, Katakana, Thai, Lao, Khmer, Myanmar) are
 *    segmented into overlapping character bigrams per run, the usual unit for CJK similarity;
 *  - comparison normalisation folds width/compatibility forms (NFKC), case, optional Arabic
 *    harakat/tatweel and Hebrew niqqud, and Arabic alef/yeh/teh-marbuta spelling variants, so two
 *    phrasings do not look "different" only because one is vocalised.
 */

/** Characters of scripts written without spaces between words. */
const UNSPACED_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}々ーｰ]/u;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
/** Apostrophes that join a word when they sit between two letters (s'il, м'ясо). */
const APOSTROPHE = /['’ʼ]/u;
const ARABIC_OPTIONAL_MARKS = /[ً-ٰٟـ]/g;
const HEBREW_POINTS = /[֑-ׇֽֿׁׂׅׄ]/g;

/** Normalise a phrasing for comparison (never for display). */
export function normalizeForDiversity(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(ARABIC_OPTIONAL_MARKS, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(HEBREW_POINTS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the character belongs to a script written without spaces. */
export const isUnspacedScriptChar = (ch: string): boolean => UNSPACED_CHAR.test(ch);

/**
 * Tokens used for overlap measures: word tokens for spaced scripts, character bigrams for runs of
 * unspaced scripts (a single-character run yields that character). Mixed text (Japanese with
 * Latin brand names, Arabizi with digits) is handled run by run.
 */
export function diversityTokens(text: string): string[] {
  const chars = [...normalizeForDiversity(text)];
  const out: string[] = [];
  let word = '';
  let run: string[] = [];
  const flushWord = (): void => {
    if (word) out.push(word);
    word = '';
  };
  const flushRun = (): void => {
    if (run.length === 1) out.push(run[0]!);
    else for (let i = 0; i + 1 < run.length; i += 1) out.push(run[i]! + run[i + 1]!);
    run = [];
  };
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (UNSPACED_CHAR.test(ch)) {
      flushWord();
      run.push(ch);
      continue;
    }
    const next = chars[i + 1];
    const joinsWord = APOSTROPHE.test(ch) && word !== '' && next !== undefined && WORD_CHAR.test(next) && !UNSPACED_CHAR.test(next);
    if (WORD_CHAR.test(ch) || joinsWord) {
      flushRun();
      word += ch;
      continue;
    }
    flushWord();
    flushRun();
  }
  flushWord();
  flushRun();
  return out;
}

/** Set Jaccard similarity of two token lists (1 = same token set, 0 = disjoint; two empty lists are identical). */
export function tokenJaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** Distinct-n: unique n-grams / all n-grams over several token lists (n-grams never cross lists). */
export function distinctN(lists: ReadonlyArray<readonly string[]>, n: number): { distinct: number; total: number; ratio: number | null } {
  const seen = new Set<string>();
  let total = 0;
  for (const tokens of lists) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      seen.add(tokens.slice(i, i + n).join('\u0001'));
      total += 1;
    }
  }
  return { distinct: seen.size, total, ratio: total ? seen.size / total : null };
}

/** Question detection by script-specific punctuation (?, Arabic ؟, fullwidth ？, Greek ;, Spanish ¿). */
export function isQuestionText(text: string): boolean {
  const t = text.normalize('NFKC').trim();
  if (!t) return false;
  if (t.startsWith('¿')) return true;
  const last = t.replace(/["'»”’)\]\s]+$/u, '').slice(-1);
  if (last === '?' || last === '؟' || last === '⸮') return true;
  // NFKC folds the Greek question mark (U+037E) into ';'.
  return last === ';' && /\p{Script=Greek}/u.test(t);
}
