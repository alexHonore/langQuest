/**
 * Kana → rōmaji (Hepburn), tables for hiragana and katakana.
 *
 * Rules: yōon digraphs (きゃ → kya), sokuon っ doubles the next consonant (っち → tchi),
 * katakana long-vowel mark ー repeats the previous vowel (or a macron with
 * `{ macrons: true }`), ん → `n'` before vowels/y, otherwise `n` (modified Hepburn keeps
 * `n` before b/m/p; `{ traditional: true }` writes `m`).
 *
 * LIMITATIONS:
 * - Kanji are NOT read: callers must supply kana (from furigana data) first. Characters
 *   outside kana pass through unchanged and `containsKanji` tells you so.
 * - Long vowels written in hiragana (おう, えい) are kept as `ou`/`ei` (word-level
 * knowledge decides whether they are long; Hepburn macrons are opt-in via `macrons`
 * only for ー and for おお/おう when `collapseLongVowels` is on).
 * - Particles は/へ/を are romanised as `ha`/`he`/`wo` by default; set `{ particles: true }`
 *   when the input is a standalone particle to get `wa`/`e`/`o`.
 */

const HIRAGANA: Readonly<Record<string, string>> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo', ん: 'n',
  ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  // yōon
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  // extended (loanword) combos
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', しぇ: 'she', じぇ: 'je', ちぇ: 'che', つぁ: 'tsa', つぇ: 'tse', つぉ: 'tso',
};

const SOKUON = new Set(['っ', 'ッ']);
const KANA_N = new Set(['ん', 'ン']);
const CHOONPU = 'ー';

/** Build the katakana table by shifting each hiragana code point by 0x60. */
function buildKatakana(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [kana, romaji] of Object.entries(HIRAGANA)) {
    const kata = [...kana].map((c) => String.fromCodePoint(c.codePointAt(0)! + 0x60)).join('');
    out[kata] = romaji;
  }
  return out;
}
const KATAKANA = buildKatakana();

const MACRON: Readonly<Record<string, string>> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

export interface RomajiOptions {
  /** Write ー as a macron instead of repeating the vowel. Default false (`ラーメン` → `raamen`). */
  macrons?: boolean;
  /** Traditional Hepburn `m` before b/m/p (`しんぶん` → `shimbun`). Default false (`shinbun`). */
  traditional?: boolean;
  /** Treat the whole input as a particle (は → wa, へ → e, を → o). Default false. */
  particles?: boolean;
}

const isKana = (ch: string): boolean => /[ぁ-ゟ゠-ヿ]/.test(ch);
/** True when the text contains CJK ideographs the kana converter cannot read. */
export const containsKanji = (text: string): boolean => /[一-鿿㐀-䶿]/.test(text);

/** Convert hiragana/katakana to Hepburn rōmaji. Kanji and other characters pass through. */
export function kanaToRomaji(text: string, options: RomajiOptions = {}): string {
  if (options.particles) {
    const particle: Record<string, string> = { は: 'wa', へ: 'e', を: 'o' };
    if (particle[text] !== undefined) return particle[text]!;
  }
  const chars = [...text];
  let out = '';
  let pendingSokuon = false;
  let pendingN = false;

  const flushN = (nextRomaji: string): void => {
    if (!pendingN) return;
    const first = nextRomaji[0] ?? '';
    if (/[aiueoy]/.test(first)) out += "n'";
    else if (options.traditional && /[bmp]/.test(first)) out += 'm';
    else out += 'n';
    pendingN = false;
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (SOKUON.has(ch)) {
      flushN('');
      pendingSokuon = true;
      continue;
    }
    if (KANA_N.has(ch)) {
      flushN('');
      pendingN = true;
      continue;
    }
    if (ch === CHOONPU) {
      flushN('');
      const last = out.slice(-1);
      if (MACRON[last] !== undefined) out = options.macrons ? out.slice(0, -1) + MACRON[last] : out + last;
      else out += '-';
      continue;
    }
    const table = /[゠-ヿ]/.test(ch) ? KATAKANA : HIRAGANA;
    const pair = ch + (chars[i + 1] ?? '');
    let romaji = table[pair];
    if (romaji !== undefined) i += 1;
    else romaji = table[ch];
    if (romaji === undefined) {
      flushN('');
      if (pendingSokuon) {
        out += isKana(ch) ? '' : 'っ';
        pendingSokuon = false;
      }
      out += ch;
      continue;
    }
    flushN(romaji);
    if (pendingSokuon) {
      const c = romaji[0]!;
      out += romaji.startsWith('ch') ? 't' : /[aiueo]/.test(c) ? '' : c;
      pendingSokuon = false;
    }
    out += romaji;
  }
  flushN('');
  if (pendingSokuon) out += 'ッ';
  return out;
}

/** Convert katakana to hiragana (for lookup normalisation). */
export const katakanaToHiragana = (text: string): string =>
  [...text].map((c) => (/[ァ-ヶ]/.test(c) ? String.fromCodePoint(c.codePointAt(0)! - 0x60) : c)).join('');

export const KANA_TABLES = { hiragana: HIRAGANA, katakana: KATAKANA } as const;
