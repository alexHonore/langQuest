/**
 * Translator, locale negotiation and bidi/numeral helpers (spec §10.1, §2.3, §10.3).
 *
 * - ICU MessageFormat via `intl-messageformat` (plural, select, selectordinal, date, number, skeletons).
 * - Compiled messages are cached per (locale, key).
 * - Missing keys and syntax errors never throw: they are reported through `onMissing` /
 *   `onFormatError` and the translator returns a safe placeholder (the key, or the raw message).
 * - Locale negotiation collapses regional tags onto shipped catalogs (`fr-CA` → `fr`).
 * - RTL detection, bidi isolation for mixed Arabic/Latin runs, and numeral-system options.
 */
import IntlMessageFormat, { type Formats } from 'intl-messageformat';
import {
  BASE_LOCALE,
  SUPPORTED_UI_LOCALES,
  flattenCatalog,
  getFlatCatalog,
  isSupportedUiLocale,
  type FlatCatalog,
  type MessageCatalog,
} from './catalogs';

export type { FlatCatalog, MessageCatalog } from './catalogs';
export { BASE_LOCALE, SUPPORTED_UI_LOCALES, isSupportedUiLocale } from './catalogs';

// ---------------------------------------------------------------------------
// Locale tags
// ---------------------------------------------------------------------------

export interface ParsedLocale {
  /** Lower-case language subtag (`fr`). */
  language: string;
  /** Title-case script subtag when present (`Arab`). */
  script: string | null;
  /** Upper-case region subtag when present (`CA`, `419`). */
  region: string | null;
  /** Normalised tag without extensions (`fr-CA`). */
  tag: string;
}

/** Lenient BCP-47 parser: accepts `fr_CA`, `fr-ca`, `zh-Hant-HK`, `ar-u-nu-arab`. Never throws. */
export function parseLocale(input: string): ParsedLocale {
  const parts = String(input ?? '')
    .trim()
    .replace(/_/g, '-')
    .split('-')
    .filter(Boolean);
  const language = (parts[0] ?? 'und').toLowerCase();
  let script: string | null = null;
  let region: string | null = null;
  for (const raw of parts.slice(1)) {
    if (raw.length === 1) break; // extension / private-use singleton
    if (!script && /^[a-z]{4}$/i.test(raw)) script = raw[0]!.toUpperCase() + raw.slice(1).toLowerCase();
    else if (!region && (/^[a-z]{2}$/i.test(raw) || /^\d{3}$/.test(raw))) region = raw.toUpperCase();
  }
  const tag = [language, script, region].filter(Boolean).join('-');
  return { language, script, region, tag };
}

/**
 * Pick the best supported locale for a list of device locales (most preferred first).
 * Exact tag match wins, then language-only match (`fr-CA` → `fr`), then `fallback`.
 */
export function negotiateLocale(
  requested: readonly string[],
  supported: readonly string[] = SUPPORTED_UI_LOCALES,
  fallback: string = BASE_LOCALE,
): string {
  const supportedParsed = supported.map((s) => ({ raw: s, parsed: parseLocale(s) }));
  for (const candidate of requested) {
    const c = parseLocale(candidate);
    const exact = supportedParsed.find((s) => s.parsed.tag.toLowerCase() === c.tag.toLowerCase());
    if (exact) return exact.raw;
  }
  for (const candidate of requested) {
    const c = parseLocale(candidate);
    const byLanguage = supportedParsed.find((s) => s.parsed.language === c.language);
    if (byLanguage) return byLanguage.raw;
  }
  return fallback;
}

/**
 * Fallback chain for a locale: `fr-CA` → `['fr-CA', 'fr', 'en']`.
 * Only locales with a catalog are kept (the requested tag is always first so a caller
 * can register its own catalog for it).
 */
export function buildFallbackChain(locale: string, supported: readonly string[] = SUPPORTED_UI_LOCALES, base: string = BASE_LOCALE): string[] {
  const parsed = parseLocale(locale);
  const chain: string[] = [parsed.tag];
  if (parsed.script && parsed.region) chain.push(`${parsed.language}-${parsed.script}`);
  if (parsed.language !== parsed.tag) chain.push(parsed.language);
  const filtered = chain.filter((tag, i) => i === 0 || supported.includes(tag));
  if (!filtered.includes(base)) filtered.push(base);
  return [...new Set(filtered)];
}

// ---------------------------------------------------------------------------
// Direction / bidi
// ---------------------------------------------------------------------------

export type TextDirection = 'ltr' | 'rtl';

/** Languages written right-to-left by default. */
export const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'dv', 'ckb', 'arc', 'syr'] as const;
/** Script subtags that force RTL regardless of language. */
export const RTL_SCRIPT_SUBTAGS = ['Arab', 'Hebr', 'Syrc', 'Thaa', 'Nkoo', 'Adlm'] as const;

/** True for `ar`, `ar-MA`, `he-IL`, `ary`, `arz`, `arb`, `zh-Arab` … */
export function isRtlLocale(locale: string): boolean {
  const p = parseLocale(locale);
  if (p.script) return (RTL_SCRIPT_SUBTAGS as readonly string[]).includes(p.script);
  if ((RTL_LANGUAGES as readonly string[]).includes(p.language)) return true;
  // Arabic variety codes used as internal ids (ary, arz, arb).
  return ['ary', 'arz', 'arb', 'apc', 'ajp'].includes(p.language);
}

export const textDirection = (locale: string): TextDirection => (isRtlLocale(locale) ? 'rtl' : 'ltr');

/** Unicode bidi control characters. */
export const BIDI = {
  LRM: '‎',
  RLM: '‏',
  LRI: '⁦',
  RLI: '⁧',
  FSI: '⁨',
  PDI: '⁩',
  LRE: '‪',
  RLE: '‫',
  PDF: '‬',
  LRO: '‭',
  RLO: '‮',
} as const;

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;
const STRONG_LTR_CHAR = /\p{L}/u;
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/**
 * Direction of the first strong character in `text` (`null` when the text has none,
 * e.g. digits or punctuation only). Mirrors the behaviour of `dir="auto"`.
 */
export function detectTextDirection(text: string): TextDirection | null {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (STRONG_LTR_CHAR.test(ch)) return 'ltr';
  }
  return null;
}

/** True when the text mixes RTL and LTR strong characters (e.g. Darija with a French loanword). */
export function hasMixedDirection(text: string): boolean {
  let sawRtl = false;
  let sawLtr = false;
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) sawRtl = true;
    else if (STRONG_LTR_CHAR.test(ch)) sawLtr = true;
    if (sawRtl && sawLtr) return true;
  }
  return false;
}

/**
 * Wrap `text` in a bidi isolate so it cannot reorder its surroundings
 * (`FSI…PDI` for auto, `RLI`/`LRI` for an explicit direction). Empty text is returned as-is.
 */
export function isolateBidi(text: string, direction: TextDirection | 'auto' = 'auto'): string {
  if (!text) return text;
  const open = direction === 'rtl' ? BIDI.RLI : direction === 'ltr' ? BIDI.LRI : BIDI.FSI;
  return `${open}${text}${BIDI.PDI}`;
}

export interface BidiSegment {
  text: string;
  /** Explicit direction; `auto` detects from the first strong character. */
  direction?: TextDirection | 'auto';
}

/**
 * Join segments of possibly different directions into one string where every segment is
 * isolated: safe for "Arabic sentence + Latin transliteration + French loanword" rows.
 */
export function joinBidiSegments(segments: readonly BidiSegment[], separator = ' '): string {
  return segments
    .filter((s) => s.text.length > 0)
    .map((s) => isolateBidi(s.text, s.direction ?? 'auto'))
    .join(separator);
}

/** Remove bidi control characters (before storing user input or measuring text). */
export const stripBidiControls = (text: string): string => text.replace(BIDI_CONTROLS, '');

/**
 * Keep punctuation attached to an RTL phrase when it is embedded in LTR UI
 * (adds an RLM after trailing punctuation so `؟` or `!` renders on the correct side).
 */
export function pinTrailingPunctuation(text: string, direction: TextDirection): string {
  if (!/[\p{P}]$/u.test(text)) return text;
  return text + (direction === 'rtl' ? BIDI.RLM : BIDI.LRM);
}

// ---------------------------------------------------------------------------
// Numerals
// ---------------------------------------------------------------------------

/** How digits should be rendered for a locale. */
export type NumeralPreference = 'auto' | 'latn' | 'native';

/** Native numbering systems we may offer; everything else stays `latn`. */
export const NATIVE_NUMBERING_SYSTEMS: Readonly<Record<string, string>> = {
  ar: 'arab',
  ary: 'latn', // Moroccan Darija uses Western digits
  arz: 'arab',
  arb: 'arab',
  fa: 'arabext',
  ur: 'arabext',
  hi: 'deva',
  bn: 'beng',
};

export interface NumeralOptions {
  /** `Intl` numbering system to request (`latn`, `arab`, `deva`, …). */
  numberingSystem: string;
  /** Locale tag with the `-u-nu-` extension applied; pass to `Intl.NumberFormat` / `IntlMessageFormat`. */
  formattingLocale: string;
}

/**
 * Resolve numeral options. `auto` = whatever ICU/CLDR picks for the locale, `latn` forces
 * Western digits (what most learners expect in a mixed-script UI), `native` asks for the
 * locale's native digits where we know them.
 */
export function numeralOptions(locale: string, preference: NumeralPreference = 'latn'): NumeralOptions {
  const parsed = parseLocale(locale);
  if (preference === 'auto') {
    let ns = 'latn';
    try {
      ns = new Intl.NumberFormat(parsed.tag).resolvedOptions().numberingSystem;
    } catch {
      /* unknown locale: keep latn */
    }
    return { numberingSystem: ns, formattingLocale: parsed.tag };
  }
  const ns = preference === 'native' ? (NATIVE_NUMBERING_SYSTEMS[parsed.language] ?? 'latn') : 'latn';
  return { numberingSystem: ns, formattingLocale: `${parsed.tag}-u-nu-${ns}` };
}

// ---------------------------------------------------------------------------
// Translator
// ---------------------------------------------------------------------------

export type MessageValues = Record<string, string | number | boolean | Date | null | undefined>;

export interface MissingKeyReport {
  key: string;
  /** Locale the translator was created for. */
  locale: string;
  /** Every locale that was searched, in order. */
  triedLocales: readonly string[];
}

export interface FormatErrorReport {
  key: string;
  locale: string;
  message: string;
  error: unknown;
}

export interface TranslatorOptions {
  /**
   * Catalogs by locale tag. Defaults to the bundled catalogs; supplying this lets apps
   * add runtime-loaded catalogs (e.g. a `fr-CA` override) or test fixtures.
   */
  catalogs?: Readonly<Record<string, MessageCatalog | FlatCatalog>>;
  /** Called at most once per missing key (per translator). */
  onMissing?: (report: MissingKeyReport) => void;
  /** Called when a message fails to compile or format. */
  onFormatError?: (report: FormatErrorReport) => void;
  /** Digits preference for `number`/`plural` arguments and `formatNumber`. Default `latn`. */
  numerals?: NumeralPreference;
  /** Extra ICU formats (named number/date/time styles). */
  formats?: Partial<Formats>;
  /**
   * When true, missing keys throw instead of returning the key. Use only in tests or
   * dev tooling; production callers must leave this off.
   */
  strict?: boolean;
}

export interface Translator {
  readonly locale: string;
  readonly fallbackChain: readonly string[];
  readonly direction: TextDirection;
  readonly isRtl: boolean;
  readonly numerals: NumeralOptions;
  /** Translate `key` with ICU `values`. Never throws unless `strict`. */
  t(key: string, values?: MessageValues): string;
  /** True when some locale in the chain has the key. */
  has(key: string): boolean;
  /** Locale that actually provides `key`, or `null`. */
  resolveLocaleFor(key: string): string | null;
  /** Raw (uncompiled) message for `key` or `null`. */
  raw(key: string): string | null;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatPercent(value: number, fractionDigits?: number): string;
  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
  formatList(items: readonly string[], options?: Intl.ListFormatOptions): string;
  /** Missing keys reported so far (deduplicated). */
  missingKeys(): readonly MissingKeyReport[];
}

function toFlat(catalog: MessageCatalog | FlatCatalog): FlatCatalog {
  // A flat catalog has only string values; a nested one has at least one object. Both flatten safely.
  return flattenCatalog(catalog as MessageCatalog);
}

function stringifyFormatted(result: unknown): string {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.map((part) => (typeof part === 'string' ? part : String(part))).join('');
  return result == null ? '' : String(result);
}

/**
 * Create a translator for `locale`. `fallbackChain` defaults to
 * `buildFallbackChain(locale)` (e.g. `fr-CA` → `fr` → `en`). The chain always ends with
 * `en` so a complete UI is guaranteed; partially translated locales (es, ru) fall through
 * to French/English per key and report what was missing so coverage can be tracked.
 */
export function createTranslator(locale: string, fallbackChain?: readonly string[], options: TranslatorOptions = {}): Translator {
  const parsed = parseLocale(locale);
  const chain = fallbackChain && fallbackChain.length > 0 ? [...new Set([parsed.tag, ...fallbackChain])] : buildFallbackChain(parsed.tag);

  const flatByLocale = new Map<string, FlatCatalog>();
  for (const tag of chain) {
    const custom = options.catalogs?.[tag];
    if (custom) flatByLocale.set(tag, toFlat(custom));
    else if (isSupportedUiLocale(tag)) flatByLocale.set(tag, getFlatCatalog(tag));
    else {
      // `fr-CA` without its own catalog resolves to `fr` (language-only) when available.
      const lang = parseLocale(tag).language;
      const langCustom = options.catalogs?.[lang];
      if (langCustom) flatByLocale.set(tag, toFlat(langCustom));
      else if (isSupportedUiLocale(lang)) flatByLocale.set(tag, getFlatCatalog(lang));
    }
  }

  const numerals = numeralOptions(parsed.tag, options.numerals ?? 'latn');
  const compiled = new Map<string, IntlMessageFormat | null>();
  const missing = new Map<string, MissingKeyReport>();
  const direction = textDirection(parsed.tag);

  const lookup = (key: string): { locale: string; message: string } | null => {
    for (const tag of chain) {
      const message = flatByLocale.get(tag)?.[key];
      if (typeof message === 'string') return { locale: tag, message };
    }
    return null;
  };

  const compile = (tag: string, key: string, message: string): IntlMessageFormat | null => {
    const cacheKey = `${tag}\u0000${key}`;
    if (compiled.has(cacheKey)) return compiled.get(cacheKey) ?? null;
    let mf: IntlMessageFormat | null = null;
    try {
      // Use the catalog locale for plural rules, but our numeral extension for digits.
      const formattingLocale = numerals.formattingLocale.startsWith(parseLocale(tag).language)
        ? numerals.formattingLocale
        : `${tag}-u-nu-${numerals.numberingSystem}`;
      mf = new IntlMessageFormat(message, formattingLocale, options.formats, { ignoreTag: true });
    } catch (error) {
      options.onFormatError?.({ key, locale: tag, message, error });
      mf = null;
    }
    compiled.set(cacheKey, mf);
    return mf;
  };

  const reportMissing = (key: string): void => {
    if (missing.has(key)) return;
    const report: MissingKeyReport = { key, locale: parsed.tag, triedLocales: chain };
    missing.set(key, report);
    options.onMissing?.(report);
  };

  const t = (key: string, values?: MessageValues): string => {
    const found = lookup(key);
    if (!found) {
      reportMissing(key);
      if (options.strict) throw new Error(`Missing translation for "${key}" (tried ${chain.join(' → ')})`);
      return key;
    }
    const mf = compile(found.locale, key, found.message);
    if (!mf) return found.message;
    try {
      return stringifyFormatted(mf.format(values as Record<string, unknown> | undefined));
    } catch (error) {
      options.onFormatError?.({ key, locale: found.locale, message: found.message, error });
      return found.message;
    }
  };

  const nf = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(numerals.formattingLocale, opts);
  const df = (opts?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(numerals.formattingLocale, opts);

  return {
    locale: parsed.tag,
    fallbackChain: chain,
    direction,
    isRtl: direction === 'rtl',
    numerals,
    t,
    has: (key) => lookup(key) !== null,
    resolveLocaleFor: (key) => lookup(key)?.locale ?? null,
    raw: (key) => lookup(key)?.message ?? null,
    formatNumber: (value, opts) => nf(opts).format(value),
    formatPercent: (value, fractionDigits = 0) =>
      nf({ style: 'percent', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value),
    formatDate: (value, opts) => df(opts ?? { dateStyle: 'medium' }).format(value),
    formatRelativeTime: (value, unit, opts) => new Intl.RelativeTimeFormat(parsed.tag, { numeric: 'auto', ...opts }).format(value, unit),
    formatList: (items, opts) => new Intl.ListFormat(parsed.tag, opts).format(items),
    missingKeys: () => [...missing.values()],
  };
}

/**
 * Compile every message of a flat catalog once; returns the keys whose ICU syntax is invalid.
 * Used by catalog tests and by the admin "Languages / Locales" coverage view.
 */
export function findInvalidIcuMessages(catalog: FlatCatalog, locale: string): Array<{ key: string; error: string }> {
  const invalid: Array<{ key: string; error: string }> = [];
  for (const [key, message] of Object.entries(catalog)) {
    try {
      new IntlMessageFormat(message, locale, undefined, { ignoreTag: true });
    } catch (error) {
      invalid.push({ key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return invalid;
}
