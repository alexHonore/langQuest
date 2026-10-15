/**
 * Jyutping (LSHK Cantonese romanisation) validation.
 *
 * A syllable is `initial? final tone` with tone 1–6. Syllabic nasals `m` and `ng` are
 * valid finals on their own (`m4`, `ng5`). We validate against the LSHK inventory; we do
 * NOT generate readings from characters (that needs a dictionary and native review).
 */

export const JYUTPING_INITIALS = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'ng', 'h', 'gw', 'kw', 'w', 'z', 'c', 's', 'j'] as const;

export const JYUTPING_FINALS = [
  'aa', 'aai', 'aau', 'aam', 'aan', 'aang', 'aap', 'aat', 'aak',
  'a', 'ai', 'au', 'am', 'an', 'ang', 'ap', 'at', 'ak',
  'e', 'ei', 'eu', 'em', 'en', 'eng', 'ep', 'et', 'ek',
  'i', 'iu', 'im', 'in', 'ing', 'ip', 'it', 'ik',
  'o', 'oi', 'ou', 'on', 'ong', 'ot', 'ok',
  'u', 'ui', 'un', 'ung', 'ut', 'uk',
  'oe', 'oeng', 'oet', 'oek',
  'eoi', 'eon', 'eot',
  'yu', 'yun', 'yut',
  'm', 'ng',
] as const;

const INITIALS_SORTED = [...JYUTPING_INITIALS].sort((a, b) => b.length - a.length);
const FINALS_SORTED = [...JYUTPING_FINALS].sort((a, b) => b.length - a.length);
const SYLLABLE_RE = new RegExp(`^(${INITIALS_SORTED.join('|')})?(${FINALS_SORTED.join('|')})([1-6])$`);

export interface JyutpingSyllable {
  initial: string;
  final: string;
  tone: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Parse one syllable (`gwong2`) or return `null` when invalid. */
export function parseJyutpingSyllable(syllable: string): JyutpingSyllable | null {
  const m = SYLLABLE_RE.exec(syllable.toLowerCase());
  if (!m) return null;
  const initial = m[1] ?? '';
  const final = m[2]!;
  // "m" / "ng" alone are syllabic nasals, never initial + empty final
  if ((final === 'm' || final === 'ng') && initial !== '') return null;
  return { initial, final, tone: Number(m[3]) as JyutpingSyllable['tone'] };
}

export const isValidJyutpingSyllable = (syllable: string): boolean => parseJyutpingSyllable(syllable) !== null;

export interface JyutpingValidation {
  valid: boolean;
  syllables: JyutpingSyllable[];
  invalidTokens: string[];
}

/** Validate space-separated Jyutping (`nei5 hou2`). Punctuation at token end is ignored. */
export function validateJyutping(text: string): JyutpingValidation {
  const tokens = text.split(/\s+/).filter(Boolean);
  const syllables: JyutpingSyllable[] = [];
  const invalidTokens: string[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/[,.!?;:，。！？]+$/, '');
    const parsed = parseJyutpingSyllable(token);
    if (parsed) syllables.push(parsed);
    else invalidTokens.push(raw);
  }
  return { valid: invalidTokens.length === 0, syllables, invalidTokens };
}
