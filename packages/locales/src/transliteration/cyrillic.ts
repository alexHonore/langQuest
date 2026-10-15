/**
 * Cyrillic → Latin romanisation for Russian and Ukrainian (BGN/PCGN-style, simplified).
 *
 * LIMITATIONS:
 * - Russian: `е` is always `e` (BGN/PCGN writes `ye` word-initially and after vowels/ь/ъ;
 *   we apply that rule), `ё` → `yo`, `ь` → `'`, `ъ` → `"`, `щ` → `shch`, `х` → `kh`,
 *   `ц` → `ts`, `й` → `y`, `ы` → `y`, `э` → `e`. No stress marks are produced; a
 *   combining acute (U+0301) in the input is preserved after the vowel.
 * - Ukrainian: follows the 2010 Cabinet of Ministers national system (`г` → `h`, `ґ` → `g`,
 *   `и` → `y`, `і` → `i`, `ї` → `yi` / `i`, `є` → `ye` / `ie`, `ю` → `yu` / `iu`,
 *   `я` → `ya` / `ia`, `й` → `y` / `i`, `ь` and apostrophe dropped, `зг` → `zgh`).
 * - Case is preserved: `Ш` → `Sh`, `ШКОЛА` → `SHKOLA`.
 */
import { mapWithTable } from './util';

export type CyrillicLanguage = 'ru' | 'uk';

const RU_TABLE: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '"', ы: 'y', ь: "'", э: 'e', ю: 'yu', я: 'ya',
};

const UK_TABLE: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', "'": '', '’': '', 'зг': 'zgh',
};

/** Word-initial forms in the Ukrainian national system. */
const UK_INITIAL: Readonly<Record<string, string>> = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };

const RU_VOWELS = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я', 'й', 'ь', 'ъ']);

const isCyrillic = (ch: string): boolean => /[Ѐ-ӿ]/.test(ch);

/** Romanise Russian or Ukrainian Cyrillic text. Non-Cyrillic characters pass through. */
export function romanizeCyrillic(text: string, language: CyrillicLanguage): string {
  if (language === 'uk') return romanizeUkrainian(text);
  return romanizeRussian(text);
}

function romanizeRussian(text: string): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const lower = ch.toLowerCase();
    const prev = chars[i - 1]?.toLowerCase() ?? '';
    const next = chars[i + 1] ?? '';
    const wordInitial = prev === '' || !isCyrillic(prev);
    let mapped: string | undefined;
    if (lower === 'е' && (wordInitial || RU_VOWELS.has(prev))) mapped = 'ye';
    else mapped = RU_TABLE[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    out += applyCase(ch, mapped, next, chars[i - 1] ?? '');
  }
  return out;
}

function romanizeUkrainian(text: string): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const lower = ch.toLowerCase();
    const prev = chars[i - 1] ?? '';
    const next = chars[i + 1] ?? '';
    const wordInitial = prev === '' || (!isCyrillic(prev) && !/['’]/.test(prev));
    if (lower === 'з' && next.toLowerCase() === 'г') {
      out += applyCase(ch, 'zgh', chars[i + 2] ?? '', prev);
      i += 1;
      continue;
    }
    const mapped = wordInitial && UK_INITIAL[lower] !== undefined ? UK_INITIAL[lower] : UK_TABLE[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    out += applyCase(ch, mapped, next, prev);
  }
  return out;
}

function applyCase(source: string, mapped: string, next: string, prev: string): string {
  const isUpper = source !== source.toLowerCase();
  if (!isUpper || !mapped) return mapped;
  const upperNeighbour = (c: string) => c !== '' && isCyrillic(c) && c !== c.toLowerCase();
  if (upperNeighbour(next) || upperNeighbour(prev)) return mapped.toUpperCase();
  return mapped[0]!.toUpperCase() + mapped.slice(1);
}

/** Simple table-only variant (no context rules) for callers that want the raw mapping. */
export const romanizeCyrillicTableOnly = (text: string, language: CyrillicLanguage): string =>
  mapWithTable(text, language === 'uk' ? UK_TABLE : RU_TABLE, { preserveCase: true });

export const CYRILLIC_TABLES = { ru: RU_TABLE, uk: UK_TABLE } as const;
