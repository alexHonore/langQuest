/**
 * Modern Greek → Latin (ELOT 743 / UN-style, simplified).
 *
 * LIMITATIONS:
 * - `αυ`/`ευ`/`ηυ` become `av`/`ev`/`iv` before vowels and voiced consonants, `af`/`ef`/`if`
 *   before voiceless consonants (θ κ ξ π σ τ φ χ ψ) and at word end.
 * - `μπ` → `b` word-initially, `mp` elsewhere; `ντ` → `d` initially, `nt` elsewhere;
 *   `γκ` → `gk`; `γγ` → `ng`; `γξ` → `nx`; `γχ` → `nch`.
 * - `η` → `i`, `υ` → `y`, `ω` → `o`, `ου` → `ou`, `αι` → `ai`, `ει` → `ei`, `οι` → `oi`.
 * - Tonos (acute) is dropped; dialytika is respected only by not merging the digraph
 *   (`αϊ` → `ai`, `όι` not treated as `οι`).
 */

const VOWELS = 'αεηιουωάέήίόύώϊϋΐΰ';
const VOICELESS = new Set(['θ', 'κ', 'ξ', 'π', 'σ', 'ς', 'τ', 'φ', 'χ', 'ψ']);

const SINGLE: Readonly<Record<string, string>> = {
  α: 'a', ά: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', έ: 'e', ζ: 'z', η: 'i', ή: 'i', θ: 'th', ι: 'i', ί: 'i', ϊ: 'i', ΐ: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', ό: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', ύ: 'y', ϋ: 'y', ΰ: 'y',
  φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o', ώ: 'o',
};

const isGreek = (ch: string): boolean => /[Ͱ-Ͽἀ-῿]/.test(ch);
const isVowel = (ch: string): boolean => VOWELS.includes(ch);
const stripTonos = (ch: string): string => ch.normalize('NFD').replace(/́/g, '').normalize('NFC');

/** Romanise Modern Greek. Non-Greek characters pass through unchanged. */
export function romanizeGreek(text: string): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const raw = chars[i]!;
    const ch = raw.toLowerCase();
    const base = stripTonos(ch);
    const nextRaw = chars[i + 1] ?? '';
    const next = stripTonos(nextRaw.toLowerCase());
    const prev = chars[i - 1] ?? '';
    const wordInitial = prev === '' || !isGreek(prev);
    const hasDialytika = ['ϊ', 'ϋ', 'ΐ', 'ΰ'].includes(nextRaw.toLowerCase());
    let mapped: string | undefined;
    let consumed = 1;

    if (!hasDialytika && (base === 'α' || base === 'ε' || base === 'η') && next === 'υ') {
      const after = stripTonos((chars[i + 2] ?? '').toLowerCase());
      const voiced = after !== '' && isGreek(after) && !VOICELESS.has(after);
      const vowel = base === 'α' ? 'a' : base === 'ε' ? 'e' : 'i';
      mapped = vowel + (voiced || (after !== '' && isVowel(after)) ? 'v' : 'f');
      consumed = 2;
    } else if (!hasDialytika && base === 'ο' && next === 'υ') {
      mapped = 'ou';
      consumed = 2;
    } else if (!hasDialytika && base === 'α' && next === 'ι') {
      mapped = 'ai';
      consumed = 2;
    } else if (!hasDialytika && base === 'ε' && next === 'ι') {
      mapped = 'ei';
      consumed = 2;
    } else if (!hasDialytika && base === 'ο' && next === 'ι') {
      mapped = 'oi';
      consumed = 2;
    } else if (base === 'μ' && next === 'π') {
      mapped = wordInitial ? 'b' : 'mp';
      consumed = 2;
    } else if (base === 'ν' && next === 'τ') {
      mapped = wordInitial ? 'd' : 'nt';
      consumed = 2;
    } else if (base === 'γ' && next === 'γ') {
      mapped = 'ng';
      consumed = 2;
    } else if (base === 'γ' && next === 'κ') {
      mapped = 'gk';
      consumed = 2;
    } else if (base === 'γ' && next === 'ξ') {
      mapped = 'nx';
      consumed = 2;
    } else if (base === 'γ' && next === 'χ') {
      mapped = 'nch';
      consumed = 2;
    } else {
      mapped = SINGLE[ch] ?? SINGLE[base];
    }

    if (mapped === undefined) {
      out += raw;
      continue;
    }
    const isUpper = raw !== ch;
    if (isUpper) {
      const neighbourUpper = (c: string) => c !== '' && isGreek(c) && c !== c.toLowerCase();
      mapped = neighbourUpper(nextRaw) || neighbourUpper(prev) ? mapped.toUpperCase() : mapped[0]!.toUpperCase() + mapped.slice(1);
    }
    out += mapped;
    i += consumed - 1;
  }
  return out;
}
