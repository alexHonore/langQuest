/** Shared helpers for transliteration tables. */

/** Apply `upper` casing to a mapped output while preserving the input's case shape. */
export function matchCase(source: string, mapped: string, nextIsUpper: boolean): string {
  if (!mapped) return mapped;
  const isUpper = source !== source.toLowerCase() && source === source.toUpperCase();
  if (!isUpper) return mapped;
  // "Ш" in an all-caps run → "SH"; at the start of a capitalised word → "Sh".
  return nextIsUpper ? mapped.toUpperCase() : mapped[0]!.toUpperCase() + mapped.slice(1);
}

/**
 * Walk `text` and map characters with a table, trying the longest key first.
 * Unknown characters are passed through unchanged.
 */
export function mapWithTable(
  text: string,
  table: Readonly<Record<string, string>>,
  options: { maxKeyLength?: number; caseSensitive?: boolean; preserveCase?: boolean } = {},
): string {
  const maxKey = options.maxKeyLength ?? Math.max(1, ...Object.keys(table).map((k) => k.length));
  const chars = [...text];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    let matched = false;
    for (let len = Math.min(maxKey, chars.length - i); len >= 1; len--) {
      const slice = chars.slice(i, i + len).join('');
      const key = options.caseSensitive ? slice : slice.toLowerCase();
      const mapped = table[key];
      if (mapped !== undefined) {
        if (options.preserveCase) {
          const next = chars[i + len] ?? '';
          const nextIsUpper = next !== '' && next !== next.toLowerCase() && next === next.toUpperCase();
          const prev = chars[i - 1] ?? '';
          const prevIsUpper = prev !== '' && prev !== prev.toLowerCase() && prev === prev.toUpperCase();
          out += matchCase(slice, mapped, nextIsUpper || prevIsUpper);
        } else out += mapped;
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += chars[i];
      i += 1;
    }
  }
  return out;
}

export const isVowelLatin = (ch: string): boolean => /^[aeiouāēīōūáéíóúàèìòùâêîôûäëïöüǎěǐǒǔ]$/i.test(ch);
