/**
 * Script metadata and display helpers (spec §2.3, §10.3 linguistic accessibility).
 *
 * - Font-stack hints use **system fonts only** (no bundled commercial fonts, spec §10.2A).
 * - Line-height multipliers compensate for tall scripts (Devanagari), syllable blocks (Hangul)
 *   and dense CJK glyphs.
 * - `scriptModeOptionsForTrack` turns the catalog's `scriptModeOptions` into renderable layers,
 *   always ordered native script first, transliteration second.
 */
import {
  SCRIPT_IDS,
  TRANSLITERATION_SCHEME_IDS,
  deriveScriptOptions,
  getCourseTrack,
  isRtlScript,
  type CourseTrackId,
  type ScriptId,
  type ScriptMode,
  type TransliterationSchemeId,
} from '@langquest/contracts';

export interface ScriptMetadata {
  id: ScriptId;
  /** English display name; UI labels come from the `lesson.scriptMode` catalog keys. */
  name: string;
  direction: 'ltr' | 'rtl';
  /** Ordered system font families (first available wins). */
  fontStack: readonly string[];
  /** Multiplier applied to the body line-height for text in this script. */
  lineHeight: number;
  /** Relative size adjustment so x-heights look even next to Latin (1 = none). */
  sizeAdjust: number;
  /** Whether words are separated by spaces (affects wrapping and word-help segmentation). */
  spacesBetweenWords: boolean;
  /** Short native sample for pickers and font-availability checks. */
  sample: string;
  /** `true` when combining marks/diacritics are optional pedagogical annotations (niqqud, harakat, stress). */
  optionalDiacritics: boolean;
}

const SYSTEM_SANS = ['-apple-system', 'BlinkMacSystemFont', 'Roboto', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'] as const;

export const SCRIPT_METADATA: Readonly<Record<ScriptId, ScriptMetadata>> = {
  Latn: { id: 'Latn', name: 'Latin', direction: 'ltr', fontStack: SYSTEM_SANS, lineHeight: 1.4, sizeAdjust: 1, spacesBetweenWords: true, sample: 'Bonjour', optionalDiacritics: false },
  Cyrl: { id: 'Cyrl', name: 'Cyrillic', direction: 'ltr', fontStack: SYSTEM_SANS, lineHeight: 1.45, sizeAdjust: 1, spacesBetweenWords: true, sample: 'Привет', optionalDiacritics: true },
  Grek: { id: 'Grek', name: 'Greek', direction: 'ltr', fontStack: SYSTEM_SANS, lineHeight: 1.45, sizeAdjust: 1, spacesBetweenWords: true, sample: 'Γεια σου', optionalDiacritics: false },
  Arab: {
    id: 'Arab',
    name: 'Arabic',
    direction: 'rtl',
    fontStack: ['Geeza Pro', 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
    lineHeight: 1.75,
    sizeAdjust: 1.1,
    spacesBetweenWords: true,
    sample: 'مرحبا',
    optionalDiacritics: true,
  },
  Hebr: {
    id: 'Hebr',
    name: 'Hebrew',
    direction: 'rtl',
    fontStack: ['Arial Hebrew', 'Noto Sans Hebrew', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
    lineHeight: 1.55,
    sizeAdjust: 1.05,
    spacesBetweenWords: true,
    sample: 'שלום',
    optionalDiacritics: true,
  },
  Deva: {
    id: 'Deva',
    name: 'Devanagari',
    direction: 'ltr',
    fontStack: ['Kohinoor Devanagari', 'Devanagari Sangam MN', 'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', 'sans-serif'],
    lineHeight: 1.75,
    sizeAdjust: 1.05,
    spacesBetweenWords: true,
    sample: 'नमस्ते',
    optionalDiacritics: false,
  },
  Hans: {
    id: 'Hans',
    name: 'Han (Simplified)',
    direction: 'ltr',
    fontStack: ['PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei', 'sans-serif'],
    lineHeight: 1.65,
    sizeAdjust: 1.05,
    spacesBetweenWords: false,
    sample: '你好',
    optionalDiacritics: false,
  },
  Hant: {
    id: 'Hant',
    name: 'Han (Traditional)',
    direction: 'ltr',
    fontStack: ['PingFang HK', 'PingFang TC', 'Noto Sans CJK TC', 'Noto Sans HK', 'Microsoft JhengHei', 'sans-serif'],
    lineHeight: 1.65,
    sizeAdjust: 1.05,
    spacesBetweenWords: false,
    sample: '你好',
    optionalDiacritics: false,
  },
  Jpan: {
    id: 'Jpan',
    name: 'Japanese',
    direction: 'ltr',
    fontStack: ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans CJK JP', 'Noto Sans JP', 'Yu Gothic', 'Meiryo', 'sans-serif'],
    lineHeight: 1.7,
    sizeAdjust: 1.05,
    spacesBetweenWords: false,
    sample: 'こんにちは',
    optionalDiacritics: false,
  },
  Kore: {
    id: 'Kore',
    name: 'Korean',
    direction: 'ltr',
    fontStack: ['Apple SD Gothic Neo', 'Noto Sans CJK KR', 'Noto Sans KR', 'Malgun Gothic', 'sans-serif'],
    lineHeight: 1.6,
    sizeAdjust: 1,
    spacesBetweenWords: true,
    sample: '안녕하세요',
    optionalDiacritics: false,
  },
};

export interface TransliterationSchemeMetadata {
  id: TransliterationSchemeId;
  name: string;
  /** `annotation` schemes (furigana, niqqud) decorate the native script instead of replacing it. */
  kind: 'romanization' | 'annotation';
  /** Script the output is rendered in. */
  rendersScript: ScriptId;
  /** Transliteration module in this package that implements it, if any. */
  implementedBy: string | null;
  notes: string;
}

export const TRANSLITERATION_SCHEME_METADATA: Readonly<Record<TransliterationSchemeId, TransliterationSchemeMetadata>> = {
  'translit-latn': { id: 'translit-latn', name: 'Latin transliteration', kind: 'romanization', rendersScript: 'Latn', implementedBy: 'transliteration/{cyrillic,greek,hebrew,devanagari}', notes: 'Scheme depends on the source script: BGN/PCGN-style for Cyrillic, ELOT-style for Greek, basic consonantal for Hebrew, IAST for Devanagari.' },
  arabizi: { id: 'arabizi', name: 'Arabizi', kind: 'romanization', rendersScript: 'Latn', implementedBy: 'transliteration/arabizi', notes: 'Darija chat alphabet: 3=ع, 7=ح, 9=ق, 8=غ/ق; French loanwords keep French spelling.' },
  jyutping: { id: 'jyutping', name: 'Jyutping', kind: 'romanization', rendersScript: 'Latn', implementedBy: 'transliteration/jyutping', notes: 'Validation only; Cantonese readings must come from a dictionary or reviewer.' },
  pinyin: { id: 'pinyin', name: 'Pinyin', kind: 'romanization', rendersScript: 'Latn', implementedBy: 'transliteration/pinyin', notes: 'Tone numbers ↔ tone marks; readings come from content, not from characters.' },
  romaji: { id: 'romaji', name: 'Rōmaji (Hepburn)', kind: 'romanization', rendersScript: 'Latn', implementedBy: 'transliteration/japanese', notes: 'Kana only; kanji readings must be provided as kana first.' },
  furigana: { id: 'furigana', name: 'Furigana', kind: 'annotation', rendersScript: 'Jpan', implementedBy: null, notes: 'Ruby annotation over kanji; readings come from content.' },
  'revised-romanization': { id: 'revised-romanization', name: 'Revised Romanization', kind: 'romanization', rendersScript: 'Latn', implementedBy: 'transliteration/korean', notes: 'Algorithmic jamo decomposition; a subset of sound-change rules.' },
  niqqud: { id: 'niqqud', name: 'Niqqud', kind: 'annotation', rendersScript: 'Hebr', implementedBy: null, notes: 'Vowel points over Hebrew consonants; content-provided.' },
};

/** One renderable text layer of a target phrase. */
export interface DisplayLayer {
  kind: 'native' | 'transliteration';
  script: ScriptId;
  /** Present for transliteration layers. */
  scheme?: TransliterationSchemeId;
  /** Annotation schemes applied on top of this layer (furigana on native Japanese, niqqud on Hebrew). */
  annotations: readonly TransliterationSchemeId[];
  direction: 'ltr' | 'rtl';
  /** Render order: 0 = native (top / first), 1 = transliteration. */
  order: number;
}

export interface ScriptModeOption {
  mode: ScriptMode;
  /** Catalog key for the option label (`lesson.scriptMode.native` …); pass `{script}`. */
  labelKey: `lesson.scriptMode.${ScriptMode}`;
  isDefault: boolean;
  layers: readonly DisplayLayer[];
}

/** Layers for a track in a given mode: native first, transliteration second (spec §2.3 display order). */
export function displayLayersForMode(trackId: CourseTrackId, mode: ScriptMode): DisplayLayer[] {
  const options = deriveScriptOptions(trackId);
  const annotations = options.transliterations.filter((s) => TRANSLITERATION_SCHEME_METADATA[s].kind === 'annotation');
  const romanizations = options.transliterations.filter((s) => TRANSLITERATION_SCHEME_METADATA[s].kind === 'romanization');
  const native: DisplayLayer = {
    kind: 'native',
    script: options.primaryScript,
    annotations,
    direction: isRtlScript(options.primaryScript) ? 'rtl' : 'ltr',
    order: 0,
  };
  const translit: DisplayLayer[] = romanizations.map((scheme) => ({
    kind: 'transliteration',
    script: TRANSLITERATION_SCHEME_METADATA[scheme].rendersScript,
    scheme,
    annotations: [],
    direction: 'ltr',
    order: 1,
  }));
  // A track whose only "transliteration" is an annotation (none today) would still show native text in latin mode.
  if (mode === 'native' || translit.length === 0) return [native];
  if (mode === 'latin') return translit;
  return [native, ...translit];
}

/** Script-mode choices a UI may offer for a track, with the layers each one renders. */
export function scriptModeOptionsForTrack(trackId: CourseTrackId): ScriptModeOption[] {
  const track = getCourseTrack(trackId);
  return track.scriptModeOptions.map((mode) => ({
    mode,
    labelKey: `lesson.scriptMode.${mode}`,
    isDefault: mode === track.defaultScriptMode,
    layers: displayLayersForMode(trackId, mode),
  }));
}

export const fontStackForScript = (script: ScriptId): readonly string[] => SCRIPT_METADATA[script].fontStack;
export const lineHeightForScript = (script: ScriptId): number => SCRIPT_METADATA[script].lineHeight;
/** CSS `font-family` value for a script (quotes families with spaces). */
export const fontFamilyCssForScript = (script: ScriptId): string =>
  SCRIPT_METADATA[script].fontStack.map((f) => (/[\s]/.test(f) ? `"${f}"` : f)).join(', ');

/** Primary-script metadata for a track (the Simplified track resolves to Hans, Cantonese to Hant). */
export function scriptMetadataForTrack(trackId: CourseTrackId): ScriptMetadata {
  return SCRIPT_METADATA[getCourseTrack(trackId).scripts.primary];
}

/** Every script id with metadata, in catalog order; guards against the contracts list drifting. */
export const SCRIPTS_WITH_METADATA: readonly ScriptId[] = SCRIPT_IDS.filter((id) => id in SCRIPT_METADATA);
export const SCHEMES_WITH_METADATA: readonly TransliterationSchemeId[] = TRANSLITERATION_SCHEME_IDS.filter((id) => id in TRANSLITERATION_SCHEME_METADATA);
