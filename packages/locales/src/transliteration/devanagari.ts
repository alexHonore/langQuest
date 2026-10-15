/**
 * Devanagari → IAST (basic), with optional Hindi schwa deletion.
 *
 * LIMITATIONS:
 * - Strict IAST keeps the inherent `a` on every consonant (`नमस्ते` → `namaste`,
 *   `कमल` → `kamala`). Hindi speakers drop word-final schwa (`kamal`); enable
 *   `{ hindiSchwaDeletion: true }` for that. Medial schwa deletion (e.g. `समझना` →
 *   `samajhnā`) is NOT modelled; it needs a lexicon.
 * - Nukta forms: `क़` → `q`, `ख़` → `kh`, `ग़` → `ġ`, `ज़` → `z`, `ड़` → `ṛ`, `ढ़` → `ṛh`, `फ़` → `f`.
 * - Anusvara → `ṃ`, chandrabindu → `m̐`, visarga → `ḥ`, avagraha → `'`, danda → `.`.
 * - Devanagari digits map to ASCII digits.
 */

const INDEPENDENT_VOWELS: Readonly<Record<string, string>> = {
  अ: 'a', आ: 'ā', इ: 'i', ई: 'ī', उ: 'u', ऊ: 'ū', ऋ: 'ṛ', ॠ: 'ṝ', ऌ: 'ḷ', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'ŏ', ऍ: 'ĕ',
};

const MATRAS: Readonly<Record<string, string>> = {
  'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū', 'ृ': 'ṛ', 'ॄ': 'ṝ', 'ॢ': 'ḷ', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'ŏ', 'ॅ': 'ĕ',
};

const CONSONANTS: Readonly<Record<string, string>> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ṅ', च: 'c', छ: 'ch', ज: 'j', झ: 'jh', ञ: 'ñ', ट: 'ṭ', ठ: 'ṭh', ड: 'ḍ', ढ: 'ḍh', ण: 'ṇ',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'ś',
  ष: 'ṣ', स: 's', ह: 'h', ळ: 'ḻ',
  // precomposed nukta forms
  क़: 'q', ख़: 'kh', ग़: 'ġ', ज़: 'z', ड़: 'ṛ', ढ़: 'ṛh', फ़: 'f', य़: 'ẏ',
};

const NUKTA_FORMS: Readonly<Record<string, string>> = { क: 'q', ख: 'kh', ग: 'ġ', ज: 'z', ड: 'ṛ', ढ: 'ṛh', फ: 'f', य: 'ẏ' };

const VIRAMA = '्';
const NUKTA = '़';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';
const SIGNS: Readonly<Record<string, string>> = { [ANUSVARA]: 'ṃ', [CHANDRABINDU]: 'm̐', [VISARGA]: 'ḥ', 'ऽ': "'", '।': '.', '॥': '..' };

const isDeva = (ch: string): boolean => /[ऀ-ॿ]/.test(ch);

export interface DevanagariOptions {
  /** Drop the inherent `a` at the end of a word (Hindi pronunciation). Default false (strict IAST). */
  hindiSchwaDeletion?: boolean;
}

/** Transliterate Devanagari text to IAST. Non-Devanagari characters pass through. */
export function devanagariToIast(text: string, options: DevanagariOptions = {}): string {
  const chars = [...text.normalize('NFC')];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (!isDeva(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    if (/[०-९]/.test(ch)) {
      out += String(ch.charCodeAt(0) - 0x0966);
      i += 1;
      continue;
    }
    if (INDEPENDENT_VOWELS[ch] !== undefined) {
      out += INDEPENDENT_VOWELS[ch];
      i += 1;
      continue;
    }
    if (SIGNS[ch] !== undefined) {
      out += SIGNS[ch];
      i += 1;
      continue;
    }
    let consonant = CONSONANTS[ch];
    if (consonant !== undefined) {
      let j = i + 1;
      if (chars[j] === NUKTA) {
        consonant = NUKTA_FORMS[ch] ?? consonant;
        j += 1;
      }
      const next = chars[j] ?? '';
      if (next === VIRAMA) {
        out += consonant;
        i = j + 1;
        continue;
      }
      if (MATRAS[next] !== undefined) {
        out += consonant + MATRAS[next];
        i = j + 1;
        continue;
      }
      // inherent vowel
      const atWordEnd = next === '' || !isDeva(next) || SIGNS[next] !== undefined && next !== ANUSVARA && next !== CHANDRABINDU;
      const dropSchwa = options.hindiSchwaDeletion && atWordEnd && lastSyllableHadVowel(out);
      out += dropSchwa ? consonant : consonant + 'a';
      i = j;
      continue;
    }
    // stray matra / virama / nukta
    if (MATRAS[ch] !== undefined) out += MATRAS[ch];
    else if (ch !== VIRAMA && ch !== NUKTA) out += ch;
    i += 1;
  }
  return out;
}

/** Only drop a final schwa when the word already has a vowel (so `न` alone stays `na`). */
function lastSyllableHadVowel(out: string): boolean {
  const word = out.split(/[^A-Za-zāīūṛṝḷḹēōṃḥṅñṭḍṇśṣḻġẏŏĕ'̐]+/).pop() ?? '';
  return /[aeiouāīūṛṝḷŏĕ]/i.test(word);
}
