/**
 * Canonical language catalog constants (CONVENTIONS §2.1–2.2, spec §2).
 *
 * IMPORTANT: nothing in this file claims that *content* exists for a track or a
 * (track, source) pair. Coverage and availability live in the database
 * (`course_source_localizations`) and are surfaced through the coverage API.
 * This file only fixes stable identifiers, display names and structural facts
 * (scripts, directionality, variety boundaries) that every package must agree on.
 */
import { z } from 'zod';
import { SCRIPT_MODE_VALUES, type ScriptMode } from './enums';

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/** Every language code that appears as a target or source language. */
export const LANGUAGE_CODES = [
  'ar', 'zh', 'en', 'da', 'fr', 'de', 'el', 'ht', 'he', 'hi', 'it', 'ja', 'ko', 'pt', 'ro', 'ru', 'es', 'sw', 'rw', 'sv', 'ln', 'uk', 'vi',
] as const;
export const LanguageCodeSchema = z.enum(LANGUAGE_CODES);
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

/** CLDR plural categories. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export const PluralCategorySchema = z.enum(PLURAL_CATEGORIES);
export type PluralCategory = z.infer<typeof PluralCategorySchema>;

// ---------------------------------------------------------------------------
// Writing systems and transliteration schemes
// ---------------------------------------------------------------------------

/** ISO 15924 script identifiers used by the product. */
export const SCRIPT_IDS = ['Arab', 'Latn', 'Hans', 'Hant', 'Cyrl', 'Grek', 'Hebr', 'Deva', 'Jpan', 'Kore'] as const;
export const ScriptIdSchema = z.enum(SCRIPT_IDS);
export type ScriptId = z.infer<typeof ScriptIdSchema>;

/** Romanization / annotation schemes that can be shown next to the primary script. */
export const TRANSLITERATION_SCHEME_IDS = [
  'translit-latn', // generic Latin transliteration (Arabic, Hebrew, Hindi, Cyrillic)
  'arabizi', // Moroccan Darija Latin chat alphabet (digits for emphatics)
  'jyutping', // Cantonese
  'pinyin', // Mandarin with tone marks
  'romaji', // Japanese
  'furigana', // Japanese kana annotation over kanji
  'revised-romanization', // Korean RR
  'niqqud', // Hebrew vowel points (annotation, not a Latin scheme)
] as const;
export const TransliterationSchemeIdSchema = z.enum(TRANSLITERATION_SCHEME_IDS);
export type TransliterationSchemeId = z.infer<typeof TransliterationSchemeIdSchema>;

export const WritingSystemSchema = z.object({
  id: z.union([ScriptIdSchema, TransliterationSchemeIdSchema]),
  kind: z.enum(['script', 'transliteration', 'annotation']),
  name: z.string(),
  direction: z.enum(['ltr', 'rtl']),
  /** Script the scheme renders (for transliterations/annotations) — `null` for primary scripts. */
  rendersScript: ScriptIdSchema.nullable(),
  /** Notes for renderers (e.g. tone marks, vowel points, mixed-direction rules). */
  rendererNotes: z.string(),
});
export type WritingSystem = z.infer<typeof WritingSystemSchema>;

export const WRITING_SYSTEMS: readonly WritingSystem[] = [
  { id: 'Arab', kind: 'script', name: 'Arabic', direction: 'rtl', rendersScript: null, rendererNotes: 'RTL; mixed Arabic/Latin segments need bidi isolation; Arabic-Indic vs Western numerals configurable.' },
  { id: 'Latn', kind: 'script', name: 'Latin', direction: 'ltr', rendersScript: null, rendererNotes: 'Diacritics required for Vietnamese, Haitian Creole, Romanian, Portuguese.' },
  { id: 'Hans', kind: 'script', name: 'Han (Simplified)', direction: 'ltr', rendersScript: null, rendererNotes: 'Use zh-Hans fonts; no spaces between words.' },
  { id: 'Hant', kind: 'script', name: 'Han (Traditional)', direction: 'ltr', rendersScript: null, rendererNotes: 'Use zh-Hant-HK fonts for Cantonese (HK glyph forms).' },
  { id: 'Cyrl', kind: 'script', name: 'Cyrillic', direction: 'ltr', rendersScript: null, rendererNotes: 'Russian stress marks are optional pedagogical annotations.' },
  { id: 'Grek', kind: 'script', name: 'Greek', direction: 'ltr', rendersScript: null, rendererNotes: 'Monotonic orthography.' },
  { id: 'Hebr', kind: 'script', name: 'Hebrew', direction: 'rtl', rendersScript: null, rendererNotes: 'RTL; niqqud optional; mixed Hebrew/Latin requires bidi isolation.' },
  { id: 'Deva', kind: 'script', name: 'Devanagari', direction: 'ltr', rendersScript: null, rendererNotes: 'Tall script; conjunct shaping required.' },
  { id: 'Jpan', kind: 'script', name: 'Japanese (kana + kanji)', direction: 'ltr', rendersScript: null, rendererNotes: 'Furigana via ruby annotations; no spaces.' },
  { id: 'Kore', kind: 'script', name: 'Korean (Hangul)', direction: 'ltr', rendersScript: null, rendererNotes: 'Hangul syllable blocks; spaces between words.' },
  { id: 'translit-latn', kind: 'transliteration', name: 'Latin transliteration', direction: 'ltr', rendersScript: 'Latn', rendererNotes: 'Scheme-neutral; variety-specific tables live in @langquest/locales.' },
  { id: 'arabizi', kind: 'transliteration', name: 'Arabizi (Darija chat alphabet)', direction: 'ltr', rendersScript: 'Latn', rendererNotes: 'Digits 3/7/9 for ع/ح/ق; French loanwords keep French spelling.' },
  { id: 'jyutping', kind: 'transliteration', name: 'Jyutping', direction: 'ltr', rendersScript: 'Latn', rendererNotes: 'Tone numbers 1–6.' },
  { id: 'pinyin', kind: 'transliteration', name: 'Hanyu Pinyin', direction: 'ltr', rendersScript: 'Latn', rendererNotes: 'Tone marks (not numbers) by default.' },
  { id: 'romaji', kind: 'transliteration', name: 'Rōmaji (Hepburn)', direction: 'ltr', rendersScript: 'Latn', rendererNotes: 'Macrons for long vowels.' },
  { id: 'furigana', kind: 'annotation', name: 'Furigana', direction: 'ltr', rendersScript: 'Jpan', rendererNotes: 'Ruby text above kanji; toggleable.' },
  { id: 'revised-romanization', kind: 'transliteration', name: 'Revised Romanization of Korean', direction: 'ltr', rendersScript: 'Latn', rendererNotes: 'Official RR (2000).' },
  { id: 'niqqud', kind: 'annotation', name: 'Niqqud (Hebrew vowel points)', direction: 'rtl', rendersScript: 'Hebr', rendererNotes: 'Shown only where pedagogically useful.' },
];

export const RTL_SCRIPTS = ['Arab', 'Hebr'] as const satisfies readonly ScriptId[];
export const isRtlScript = (script: ScriptId): boolean => (RTL_SCRIPTS as readonly ScriptId[]).includes(script);

// ---------------------------------------------------------------------------
// Language records
// ---------------------------------------------------------------------------

export const LanguageSchema = z.object({
  code: LanguageCodeSchema,
  englishName: z.string(),
  nativeName: z.string(),
  defaultScript: ScriptIdSchema,
  rtl: z.boolean(),
  /** CLDR cardinal plural categories (drives ICU message validation). */
  pluralCategories: z.array(PluralCategorySchema).min(1),
});
export type Language = z.infer<typeof LanguageSchema>;

export const LANGUAGES: readonly Language[] = [
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', defaultScript: 'Arab', rtl: true, pluralCategories: ['zero', 'one', 'two', 'few', 'many', 'other'] },
  { code: 'zh', englishName: 'Chinese', nativeName: '中文', defaultScript: 'Hans', rtl: false, pluralCategories: ['other'] },
  { code: 'en', englishName: 'English', nativeName: 'English', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'da', englishName: 'Danish', nativeName: 'Dansk', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'fr', englishName: 'French', nativeName: 'Français', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'many', 'other'] },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'el', englishName: 'Greek', nativeName: 'Ελληνικά', defaultScript: 'Grek', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'ht', englishName: 'Haitian Creole', nativeName: 'Kreyòl ayisyen', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'he', englishName: 'Hebrew', nativeName: 'עברית', defaultScript: 'Hebr', rtl: true, pluralCategories: ['one', 'two', 'other'] },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', defaultScript: 'Deva', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'it', englishName: 'Italian', nativeName: 'Italiano', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'many', 'other'] },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語', defaultScript: 'Jpan', rtl: false, pluralCategories: ['other'] },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어', defaultScript: 'Kore', rtl: false, pluralCategories: ['other'] },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'many', 'other'] },
  { code: 'ro', englishName: 'Romanian', nativeName: 'Română', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'few', 'other'] },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', defaultScript: 'Cyrl', rtl: false, pluralCategories: ['one', 'few', 'many', 'other'] },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'many', 'other'] },
  { code: 'sw', englishName: 'Swahili', nativeName: 'Kiswahili', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'rw', englishName: 'Kinyarwanda', nativeName: 'Ikinyarwanda', defaultScript: 'Latn', rtl: false, pluralCategories: ['other'] },
  { code: 'sv', englishName: 'Swedish', nativeName: 'Svenska', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'ln', englishName: 'Lingala', nativeName: 'Lingála', defaultScript: 'Latn', rtl: false, pluralCategories: ['one', 'other'] },
  { code: 'uk', englishName: 'Ukrainian', nativeName: 'Українська', defaultScript: 'Cyrl', rtl: false, pluralCategories: ['one', 'few', 'many', 'other'] },
  { code: 'vi', englishName: 'Vietnamese', nativeName: 'Tiếng Việt', defaultScript: 'Latn', rtl: false, pluralCategories: ['other'] },
];

// ---------------------------------------------------------------------------
// Varieties
// ---------------------------------------------------------------------------

/** Internal target-variety identifiers (CONVENTIONS §2.1 column `target_variety_id`). */
export const VARIETY_IDS = [
  'ar-levant', 'ary', 'arz', 'arb', 'yue', 'cmn', 'en', 'da', 'fr', 'de', 'el', 'ht', 'he', 'hi', 'it', 'ja', 'ko',
  'pt-BR', 'pt-PT', 'ro', 'ru', 'es-419', 'es-ES', 'sw', 'rw', 'sv', 'ln', 'uk', 'vi',
] as const;
export const VarietyIdSchema = z.enum(VARIETY_IDS);
export type VarietyId = z.infer<typeof VarietyIdSchema>;

export const LanguageVarietySchema = z.object({
  id: VarietyIdSchema,
  languageCode: LanguageCodeSchema,
  name: z.string(),
  /** BCP-47 mapping when one exists; `null` for umbrella varieties without an exact tag. */
  bcp47: z.string().nullable(),
  /** Tone-bearing variety (pronunciation coaching must be tone-aware where supported). */
  tonal: z.boolean(),
  alternativeNames: z.array(z.string()),
  regionalNotes: z.string(),
  codeSwitchNorms: z.string(),
  /** Varieties that must never be silently substituted for this one (§8.2, §14.2 confusion tests). */
  mustNotSubstitute: z.array(VarietyIdSchema),
});
export type LanguageVariety = z.infer<typeof LanguageVarietySchema>;

export const LANGUAGE_VARIETIES: readonly LanguageVariety[] = [
  { id: 'ar-levant', languageCode: 'ar', name: 'Levantine (Eastern) Arabic', bcp47: 'apc', tonal: false, alternativeNames: ['Eastern Arabic', 'Shami'], regionalNotes: 'Umbrella over Syrian, Lebanese, Palestinian and Jordanian; regional selector is editable.', codeSwitchNorms: 'English/French loanwords in urban speech.', mustNotSubstitute: ['arb', 'arz', 'ary'] },
  { id: 'ary', languageCode: 'ar', name: 'Moroccan Arabic (Darija)', bcp47: 'ary', tonal: false, alternativeNames: ['Darija', 'Maghrebi Arabic'], regionalNotes: 'Casablanca/Rabat urban baseline; Fes, Marrakech, northern variants noted.', codeSwitchNorms: 'Frequent natural French code-switching; teach it, never as excuse for wrong Arabic.', mustNotSubstitute: ['arb', 'arz', 'ar-levant'] },
  { id: 'arz', languageCode: 'ar', name: 'Egyptian Arabic', bcp47: 'arz', tonal: false, alternativeNames: ['Masri', 'Cairene'], regionalNotes: 'Cairene colloquial baseline.', codeSwitchNorms: 'Occasional English loanwords.', mustNotSubstitute: ['arb', 'ary', 'ar-levant'] },
  { id: 'arb', languageCode: 'ar', name: 'Modern Standard Arabic', bcp47: 'arb', tonal: false, alternativeNames: ['MSA', 'Fusha'], regionalNotes: 'Formal register; not a substitute for colloquial courses.', codeSwitchNorms: 'None expected.', mustNotSubstitute: ['ary', 'arz', 'ar-levant'] },
  { id: 'yue', languageCode: 'zh', name: 'Cantonese', bcp47: 'yue-HK', tonal: true, alternativeNames: ['Yue', 'Hong Kong Cantonese'], regionalNotes: 'Hong Kong baseline; Guangzhou variants noted.', codeSwitchNorms: 'English loanwords common in Hong Kong speech.', mustNotSubstitute: ['cmn'] },
  { id: 'cmn', languageCode: 'zh', name: 'Mandarin', bcp47: 'cmn', tonal: true, alternativeNames: ['Putonghua', 'Standard Chinese'], regionalNotes: 'Mainland standard baseline; Taiwan voice/script variants optional.', codeSwitchNorms: 'Minimal.', mustNotSubstitute: ['yue'] },
  { id: 'en', languageCode: 'en', name: 'English', bcp47: 'en', tonal: false, alternativeNames: [], regionalNotes: 'US default, GB selectable.', codeSwitchNorms: 'None.', mustNotSubstitute: [] },
  { id: 'da', languageCode: 'da', name: 'Danish', bcp47: 'da-DK', tonal: false, alternativeNames: [], regionalNotes: 'Standard Copenhagen baseline.', codeSwitchNorms: 'English loanwords.', mustNotSubstitute: ['sv'] },
  { id: 'fr', languageCode: 'fr', name: 'French', bcp47: 'fr', tonal: false, alternativeNames: [], regionalNotes: 'France default, Canadian option.', codeSwitchNorms: 'None.', mustNotSubstitute: ['ht'] },
  { id: 'de', languageCode: 'de', name: 'German', bcp47: 'de-DE', tonal: false, alternativeNames: [], regionalNotes: 'Standard German.', codeSwitchNorms: 'English loanwords.', mustNotSubstitute: [] },
  { id: 'el', languageCode: 'el', name: 'Greek', bcp47: 'el-GR', tonal: false, alternativeNames: [], regionalNotes: 'Standard Modern Greek.', codeSwitchNorms: 'None.', mustNotSubstitute: [] },
  { id: 'ht', languageCode: 'ht', name: 'Haitian Creole', bcp47: 'ht-HT', tonal: false, alternativeNames: ['Kreyòl'], regionalNotes: 'Official Haitian orthography; never replaced by French.', codeSwitchNorms: 'French borrowings exist but Kreyòl is the target.', mustNotSubstitute: ['fr'] },
  { id: 'he', languageCode: 'he', name: 'Hebrew', bcp47: 'he-IL', tonal: false, alternativeNames: ['Ivrit'], regionalNotes: 'Modern Israeli Hebrew.', codeSwitchNorms: 'English loanwords.', mustNotSubstitute: [] },
  { id: 'hi', languageCode: 'hi', name: 'Hindi', bcp47: 'hi-IN', tonal: false, alternativeNames: [], regionalNotes: 'Standard Hindi; Hinglish noted.', codeSwitchNorms: 'Frequent English code-switching in urban speech.', mustNotSubstitute: [] },
  { id: 'it', languageCode: 'it', name: 'Italian', bcp47: 'it-IT', tonal: false, alternativeNames: [], regionalNotes: 'Standard Italian.', codeSwitchNorms: 'None.', mustNotSubstitute: [] },
  { id: 'ja', languageCode: 'ja', name: 'Japanese', bcp47: 'ja-JP', tonal: false, alternativeNames: [], regionalNotes: 'Standard Tokyo Japanese; pitch accent noted.', codeSwitchNorms: 'Katakana loanwords.', mustNotSubstitute: [] },
  { id: 'ko', languageCode: 'ko', name: 'Korean', bcp47: 'ko-KR', tonal: false, alternativeNames: [], regionalNotes: 'Seoul standard.', codeSwitchNorms: 'English loanwords.', mustNotSubstitute: [] },
  { id: 'pt-BR', languageCode: 'pt', name: 'Brazilian Portuguese', bcp47: 'pt-BR', tonal: false, alternativeNames: [], regionalNotes: 'Brazilian voice, diction and lexicon.', codeSwitchNorms: 'None.', mustNotSubstitute: ['pt-PT'] },
  { id: 'pt-PT', languageCode: 'pt', name: 'European Portuguese', bcp47: 'pt-PT', tonal: false, alternativeNames: [], regionalNotes: 'European speech and lexicon.', codeSwitchNorms: 'None.', mustNotSubstitute: ['pt-BR'] },
  { id: 'ro', languageCode: 'ro', name: 'Romanian', bcp47: 'ro-RO', tonal: false, alternativeNames: [], regionalNotes: 'Standard Romanian.', codeSwitchNorms: 'None.', mustNotSubstitute: [] },
  { id: 'ru', languageCode: 'ru', name: 'Russian', bcp47: 'ru-RU', tonal: false, alternativeNames: [], regionalNotes: 'Standard Russian; stress handling in annotations.', codeSwitchNorms: 'None.', mustNotSubstitute: ['uk'] },
  { id: 'es-419', languageCode: 'es', name: 'Latin American Spanish', bcp47: 'es-419', tonal: false, alternativeNames: ['Español latinoamericano'], regionalNotes: 'Neutral pan-Latin American base; regional voice markers (es-MX, es-CO, es-AR...).', codeSwitchNorms: 'None.', mustNotSubstitute: ['es-ES'] },
  { id: 'es-ES', languageCode: 'es', name: 'Castilian Spanish', bcp47: 'es-ES', tonal: false, alternativeNames: ['Español de España'], regionalNotes: 'Castilian voice and lexicon (vosotros, distinción).', codeSwitchNorms: 'None.', mustNotSubstitute: ['es-419'] },
  { id: 'sw', languageCode: 'sw', name: 'Swahili', bcp47: 'sw', tonal: false, alternativeNames: ['Kiswahili'], regionalNotes: 'Kenyan vs Tanzanian usage selector.', codeSwitchNorms: 'Sheng/English mixing in Kenya noted.', mustNotSubstitute: [] },
  { id: 'rw', languageCode: 'rw', name: 'Kinyarwanda', bcp47: 'rw-RW', tonal: true, alternativeNames: [], regionalNotes: 'Native-validated speech required; limited automated scoring.', codeSwitchNorms: 'French/English loanwords.', mustNotSubstitute: [] },
  { id: 'sv', languageCode: 'sv', name: 'Swedish', bcp47: 'sv-SE', tonal: false, alternativeNames: [], regionalNotes: 'Standard Swedish; pitch accent noted.', codeSwitchNorms: 'English loanwords.', mustNotSubstitute: ['da'] },
  { id: 'ln', languageCode: 'ln', name: 'Lingala', bcp47: 'ln-CD', tonal: true, alternativeNames: [], regionalNotes: 'Kinshasa baseline with DRC/Congo regional option; limited automated scoring.', codeSwitchNorms: 'Frequent French mixing in Kinshasa speech.', mustNotSubstitute: ['fr'] },
  { id: 'uk', languageCode: 'uk', name: 'Ukrainian', bcp47: 'uk-UA', tonal: false, alternativeNames: [], regionalNotes: 'Standard Ukrainian.', codeSwitchNorms: 'None.', mustNotSubstitute: ['ru'] },
  { id: 'vi', languageCode: 'vi', name: 'Vietnamese', bcp47: 'vi-VN', tonal: true, alternativeNames: [], regionalNotes: 'Northern (Hanoi) and Southern (Ho Chi Minh City) voice variants.', codeSwitchNorms: 'None.', mustNotSubstitute: [] },
];

// ---------------------------------------------------------------------------
// Course tracks (exactly 30)
// ---------------------------------------------------------------------------

export const COURSE_TRACK_IDS = [
  'arabic-eastern',
  'arabic-moroccan',
  'arabic-egyptian',
  'arabic-msa',
  'chinese-cantonese',
  'chinese-mandarin',
  'chinese-simplified',
  'english',
  'danish',
  'french',
  'german',
  'greek',
  'haitian-creole',
  'hebrew',
  'hindi',
  'italian',
  'japanese',
  'korean',
  'portuguese-brazilian',
  'portuguese-european',
  'romanian',
  'russian',
  'spanish-latin-american',
  'spanish-spain',
  'swahili',
  'kinyarwanda',
  'swedish',
  'lingala',
  'ukrainian',
  'vietnamese',
] as const;
export const CourseTrackIdSchema = z.enum(COURSE_TRACK_IDS);
export type CourseTrackId = z.infer<typeof CourseTrackIdSchema>;

export const RegionalOptionSchema = z.object({
  /** Stable option id, e.g. `SY`, `north`, `GB`. */
  id: z.string(),
  label: z.string(),
  /** Locale used for voices/formatting when this option is chosen (if any). */
  locale: z.string().nullable(),
});
export type RegionalOption = z.infer<typeof RegionalOptionSchema>;

export const TrackScriptsSchema = z.object({
  primary: ScriptIdSchema,
  /** Alternative primary scripts the learner may switch to (e.g. Hant for Mandarin). */
  alternatives: z.array(ScriptIdSchema),
  transliterations: z.array(TransliterationSchemeIdSchema),
});
export type TrackScripts = z.infer<typeof TrackScriptsSchema>;

export const CourseTrackSchema = z.object({
  id: CourseTrackIdSchema,
  /** 1..30, matches the spec table order. */
  order: z.number().int().min(1).max(30),
  /** User-facing name, verbatim from the spec. Localized names live in @langquest/locales. */
  displayName: z.string(),
  targetVarietyId: VarietyIdSchema,
  languageCode: LanguageCodeSchema,
  defaultLocale: z.string(),
  regionalOptions: z.array(RegionalOptionSchema),
  scripts: TrackScriptsSchema,
  scriptModeOptions: z.array(z.enum(SCRIPT_MODE_VALUES)).min(1),
  defaultScriptMode: z.enum(SCRIPT_MODE_VALUES),
  /** When set, the track prioritises this script for reading/writing (`chinese-simplified`). */
  scriptFocus: ScriptIdSchema.nullable(),
  teachingFocus: z.string(),
  /** Track whose language/voice assets this track shares (`chinese-simplified` → `chinese-mandarin`). */
  sharesAssetsWithTrackId: CourseTrackIdSchema.nullable(),
  tonal: z.boolean(),
  /** Documented assumptions and caveats (e.g. the "Eastern" umbrella). */
  assumptions: z.array(z.string()),
  /** Expected ceiling for automated pronunciation scoring; the runtime capability registry decides per call. */
  automatedScoringSupport: z.enum(['full', 'partial', 'limited']),
});
export type CourseTrack = z.infer<typeof CourseTrackSchema>;

const latnOnly: TrackScripts = { primary: 'Latn', alternatives: [], transliterations: [] };
const nativeOnly: ScriptMode[] = ['native'];
const allModes: ScriptMode[] = ['native', 'latin', 'both'];

export const COURSE_TRACKS: readonly CourseTrack[] = [
  {
    id: 'arabic-eastern', order: 1, displayName: 'Arabic (Eastern)', targetVarietyId: 'ar-levant', languageCode: 'ar', defaultLocale: 'ar-SY',
    regionalOptions: [
      { id: 'SY', label: 'Syrian', locale: 'ar-SY' },
      { id: 'LB', label: 'Lebanese', locale: 'ar-LB' },
      { id: 'PS', label: 'Palestinian', locale: 'ar-PS' },
      { id: 'JO', label: 'Jordanian', locale: 'ar-JO' },
    ],
    scripts: { primary: 'Arab', alternatives: [], transliterations: ['translit-latn'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null,
    teachingFocus: 'Spoken Levantine for everyday situations; regional lexical and phonetic variation surfaced, never flattened.',
    sharesAssetsWithTrackId: null, tonal: false,
    assumptions: ['"Eastern" is not one precise dialect: modelled as a Levantine umbrella with an editable regional selector (SY/LB/PS/JO) rather than a single uniform accent.', 'MSA is never substituted as the spoken dialect.'],
    automatedScoringSupport: 'limited',
  },
  {
    id: 'arabic-moroccan', order: 2, displayName: 'Arabic (Moroccan)', targetVarietyId: 'ary', languageCode: 'ar', defaultLocale: 'ar-MA',
    regionalOptions: [
      { id: 'casablanca', label: 'Casablanca / Rabat', locale: 'ar-MA' },
      { id: 'fes', label: 'Fes / Meknes', locale: 'ar-MA' },
      { id: 'marrakech', label: 'Marrakech / South', locale: 'ar-MA' },
      { id: 'north', label: 'Tangier / North', locale: 'ar-MA' },
    ],
    scripts: { primary: 'Arab', alternatives: [], transliterations: ['arabizi'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null,
    teachingFocus: 'Darija as actually spoken, including natural French code-switching; Arabic and Arabizi both first-class.',
    sharesAssetsWithTrackId: null, tonal: false,
    assumptions: ['Native validation is mandatory; MSA fallback is forbidden.'],
    automatedScoringSupport: 'limited',
  },
  {
    id: 'arabic-egyptian', order: 3, displayName: 'Arabic (Egyptian)', targetVarietyId: 'arz', languageCode: 'ar', defaultLocale: 'ar-EG',
    regionalOptions: [{ id: 'cairo', label: 'Cairo', locale: 'ar-EG' }],
    scripts: { primary: 'Arab', alternatives: [], transliterations: ['translit-latn'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null,
    teachingFocus: 'Egyptian colloquial, not MSA.',
    sharesAssetsWithTrackId: null, tonal: false, assumptions: ['Colloquial Cairene baseline.'], automatedScoringSupport: 'full',
  },
  {
    id: 'arabic-msa', order: 4, displayName: 'Arabic (Modern Standard)', targetVarietyId: 'arb', languageCode: 'ar', defaultLocale: 'ar',
    regionalOptions: [],
    scripts: { primary: 'Arab', alternatives: [], transliterations: ['translit-latn'] }, scriptModeOptions: allModes, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'Formal modern register (media, writing, pan-Arab communication).',
    sharesAssetsWithTrackId: null, tonal: false,
    assumptions: ['Not a substitute for any colloquial course.'], automatedScoringSupport: 'partial',
  },
  {
    id: 'chinese-cantonese', order: 5, displayName: 'Chinese (Cantonese)', targetVarietyId: 'yue', languageCode: 'zh', defaultLocale: 'zh-HK',
    regionalOptions: [{ id: 'HK', label: 'Hong Kong', locale: 'zh-HK' }],
    scripts: { primary: 'Hant', alternatives: [], transliterations: ['jyutping'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null,
    teachingFocus: 'Spoken Cantonese with Traditional characters and optional Jyutping; tone-aware coaching.',
    sharesAssetsWithTrackId: null, tonal: true,
    assumptions: ['Cantonese is not Mandarin: no Mandarin voice or text substitution.'], automatedScoringSupport: 'full',
  },
  {
    id: 'chinese-mandarin', order: 6, displayName: 'Chinese (Mandarin)', targetVarietyId: 'cmn', languageCode: 'zh', defaultLocale: 'zh-CN',
    regionalOptions: [
      { id: 'CN', label: 'Mainland (Simplified)', locale: 'zh-CN' },
      { id: 'TW', label: 'Taiwan (Traditional)', locale: 'zh-TW' },
    ],
    scripts: { primary: 'Hans', alternatives: ['Hant'], transliterations: ['pinyin'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null,
    teachingFocus: 'Spoken Mandarin; Simplified by default, Traditional optional, Pinyin with tone marks.',
    sharesAssetsWithTrackId: null, tonal: true, assumptions: [], automatedScoringSupport: 'full',
  },
  {
    id: 'chinese-simplified', order: 7, displayName: 'Chinese (Simplified)', targetVarietyId: 'cmn', languageCode: 'zh', defaultLocale: 'zh-CN',
    regionalOptions: [{ id: 'CN', label: 'Mainland', locale: 'zh-CN' }],
    scripts: { primary: 'Hans', alternatives: [], transliterations: ['pinyin'] }, scriptModeOptions: allModes, defaultScriptMode: 'native', scriptFocus: 'Hans',
    teachingFocus: 'Reading and writing Simplified characters with Mandarin speech; shares Mandarin language/voice assets.',
    sharesAssetsWithTrackId: 'chinese-mandarin', tonal: true,
    assumptions: ['Simplified is a writing system, not a spoken language: kept as a separate selectable track per product requirement, backed by Mandarin assets.'],
    automatedScoringSupport: 'full',
  },
  {
    id: 'english', order: 8, displayName: 'English', targetVarietyId: 'en', languageCode: 'en', defaultLocale: 'en-US',
    regionalOptions: [
      { id: 'US', label: 'American', locale: 'en-US' },
      { id: 'GB', label: 'British', locale: 'en-GB' },
    ],
    scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'English taught FROM French, Spanish, Russian and other source languages; never English-only instructions.',
    sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full',
  },
  { id: 'danish', order: 9, displayName: 'Danish', targetVarietyId: 'da', languageCode: 'da', defaultLocale: 'da-DK', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Everyday spoken Danish.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full' },
  {
    id: 'french', order: 10, displayName: 'French', targetVarietyId: 'fr', languageCode: 'fr', defaultLocale: 'fr-FR',
    regionalOptions: [
      { id: 'FR', label: 'France', locale: 'fr-FR' },
      { id: 'CA', label: 'Canada (Québec)', locale: 'fr-CA' },
    ],
    scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'Everyday spoken French with regional pronunciation option.',
    sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full',
  },
  { id: 'german', order: 11, displayName: 'German', targetVarietyId: 'de', languageCode: 'de', defaultLocale: 'de-DE', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Everyday spoken German.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full' },
  { id: 'greek', order: 12, displayName: 'Greek', targetVarietyId: 'el', languageCode: 'el', defaultLocale: 'el-GR', regionalOptions: [], scripts: { primary: 'Grek', alternatives: [], transliterations: ['translit-latn'] }, scriptModeOptions: allModes, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Everyday spoken Modern Greek with script support.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'partial' },
  {
    id: 'haitian-creole', order: 13, displayName: 'Haitian Creole', targetVarietyId: 'ht', languageCode: 'ht', defaultLocale: 'ht-HT', regionalOptions: [],
    scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'Kreyòl with official Haitian orthography; never replaced by French.',
    sharesAssetsWithTrackId: null, tonal: false, assumptions: ['No French substitution for speech, text or coaching.'], automatedScoringSupport: 'limited',
  },
  { id: 'hebrew', order: 14, displayName: 'Hebrew', targetVarietyId: 'he', languageCode: 'he', defaultLocale: 'he-IL', regionalOptions: [], scripts: { primary: 'Hebr', alternatives: [], transliterations: ['translit-latn', 'niqqud'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null, teachingFocus: 'Spoken Modern Hebrew; transliteration and vowel points where pedagogically useful.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'partial' },
  { id: 'hindi', order: 15, displayName: 'Hindi', targetVarietyId: 'hi', languageCode: 'hi', defaultLocale: 'hi-IN', regionalOptions: [], scripts: { primary: 'Deva', alternatives: [], transliterations: ['translit-latn'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null, teachingFocus: 'Spoken Hindi with Devanagari and optional romanization.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'partial' },
  { id: 'italian', order: 16, displayName: 'Italian', targetVarietyId: 'it', languageCode: 'it', defaultLocale: 'it-IT', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Everyday spoken Italian.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full' },
  { id: 'japanese', order: 17, displayName: 'Japanese', targetVarietyId: 'ja', languageCode: 'ja', defaultLocale: 'ja-JP', regionalOptions: [], scripts: { primary: 'Jpan', alternatives: [], transliterations: ['romaji', 'furigana'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null, teachingFocus: 'Spoken Japanese; kana/kanji with optional romaji and furigana.', sharesAssetsWithTrackId: null, tonal: false, assumptions: ['Pitch accent surfaced as annotation, not scored unless supported.'], automatedScoringSupport: 'full' },
  { id: 'korean', order: 18, displayName: 'Korean', targetVarietyId: 'ko', languageCode: 'ko', defaultLocale: 'ko-KR', regionalOptions: [], scripts: { primary: 'Kore', alternatives: [], transliterations: ['revised-romanization'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null, teachingFocus: 'Spoken Korean; Hangul with optional Revised Romanization.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full' },
  { id: 'portuguese-brazilian', order: 19, displayName: 'Portuguese (Brazilian)', targetVarietyId: 'pt-BR', languageCode: 'pt', defaultLocale: 'pt-BR', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Brazilian voice, diction and lexicon.', sharesAssetsWithTrackId: null, tonal: false, assumptions: ['Distinct from European Portuguese; no cross-substitution.'], automatedScoringSupport: 'full' },
  { id: 'portuguese-european', order: 20, displayName: 'Portuguese (European)', targetVarietyId: 'pt-PT', languageCode: 'pt', defaultLocale: 'pt-PT', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'European Portuguese speech and lexicon.', sharesAssetsWithTrackId: null, tonal: false, assumptions: ['Distinct from Brazilian Portuguese; no cross-substitution.'], automatedScoringSupport: 'full' },
  { id: 'romanian', order: 21, displayName: 'Romanian', targetVarietyId: 'ro', languageCode: 'ro', defaultLocale: 'ro-RO', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Everyday spoken Romanian.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'partial' },
  { id: 'russian', order: 22, displayName: 'Russian', targetVarietyId: 'ru', languageCode: 'ru', defaultLocale: 'ru-RU', regionalOptions: [], scripts: { primary: 'Cyrl', alternatives: [], transliterations: ['translit-latn'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null, teachingFocus: 'Spoken Russian; Cyrillic with optional transliteration and stress marks.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full' },
  {
    id: 'spanish-latin-american', order: 23, displayName: 'Spanish (Latin American)', targetVarietyId: 'es-419', languageCode: 'es', defaultLocale: 'es-419',
    regionalOptions: [
      { id: 'MX', label: 'Mexico', locale: 'es-MX' },
      { id: 'CO', label: 'Colombia', locale: 'es-CO' },
      { id: 'AR', label: 'Argentina', locale: 'es-AR' },
      { id: 'PE', label: 'Peru', locale: 'es-PE' },
      { id: 'CL', label: 'Chile', locale: 'es-CL' },
    ],
    scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'Neutral pan-Latin American base with regional variation markers; not one universal accent.',
    sharesAssetsWithTrackId: null, tonal: false, assumptions: ['es-419 is an umbrella; regional voices are explicit options.'], automatedScoringSupport: 'full',
  },
  { id: 'spanish-spain', order: 24, displayName: 'Spanish (Spain-Castilian)', targetVarietyId: 'es-ES', languageCode: 'es', defaultLocale: 'es-ES', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Castilian voice and lexical preferences, distinguished from Latin American.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'full' },
  {
    id: 'swahili', order: 25, displayName: 'Swahili', targetVarietyId: 'sw', languageCode: 'sw', defaultLocale: 'sw-KE',
    regionalOptions: [
      { id: 'KE', label: 'Kenya', locale: 'sw-KE' },
      { id: 'TZ', label: 'Tanzania', locale: 'sw-TZ' },
    ],
    scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'Everyday Swahili with Kenyan/Tanzanian usage distinctions.',
    sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'limited',
  },
  { id: 'kinyarwanda', order: 26, displayName: 'Kinyarwanda', targetVarietyId: 'rw', languageCode: 'rw', defaultLocale: 'rw-RW', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Native-validated spoken Kinyarwanda.', sharesAssetsWithTrackId: null, tonal: true, assumptions: ['Limited automated scoring; capability-aware pronunciation feedback only.'], automatedScoringSupport: 'limited' },
  { id: 'swedish', order: 27, displayName: 'Swedish', targetVarietyId: 'sv', languageCode: 'sv', defaultLocale: 'sv-SE', regionalOptions: [], scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null, teachingFocus: 'Everyday spoken Swedish.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'partial' },
  {
    id: 'lingala', order: 28, displayName: 'Lingala', targetVarietyId: 'ln', languageCode: 'ln', defaultLocale: 'ln-CD',
    regionalOptions: [
      { id: 'CD', label: 'DR Congo (Kinshasa)', locale: 'ln-CD' },
      { id: 'CG', label: 'Congo (Brazzaville)', locale: 'ln-CG' },
    ],
    scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'Native-validated spoken Lingala with regional features.',
    sharesAssetsWithTrackId: null, tonal: true, assumptions: ['Limited automated scoring; French mixing is taught as natural, never substituted.'], automatedScoringSupport: 'limited',
  },
  { id: 'ukrainian', order: 29, displayName: 'Ukrainian', targetVarietyId: 'uk', languageCode: 'uk', defaultLocale: 'uk-UA', regionalOptions: [], scripts: { primary: 'Cyrl', alternatives: [], transliterations: ['translit-latn'] }, scriptModeOptions: allModes, defaultScriptMode: 'both', scriptFocus: null, teachingFocus: 'Spoken Ukrainian; Cyrillic with optional transliteration.', sharesAssetsWithTrackId: null, tonal: false, assumptions: [], automatedScoringSupport: 'partial' },
  {
    id: 'vietnamese', order: 30, displayName: 'Vietnamese', targetVarietyId: 'vi', languageCode: 'vi', defaultLocale: 'vi-VN',
    regionalOptions: [
      { id: 'north', label: 'Northern (Hanoi)', locale: 'vi-VN' },
      { id: 'south', label: 'Southern (Ho Chi Minh City)', locale: 'vi-VN' },
    ],
    scripts: latnOnly, scriptModeOptions: nativeOnly, defaultScriptMode: 'native', scriptFocus: null,
    teachingFocus: 'Tone-rich Vietnamese with northern/southern voice variants.',
    sharesAssetsWithTrackId: null, tonal: true, assumptions: [], automatedScoringSupport: 'partial',
  },
];

// ---------------------------------------------------------------------------
// Source languages
// ---------------------------------------------------------------------------

/** Production priority tier (§2.1): 1 = en, 2 = fr, 3 = es/ru, 4 = all other catalog languages. */
export const SourcePriorityTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type SourcePriorityTier = z.infer<typeof SourcePriorityTierSchema>;

export const SourceLanguageSchema = z.object({ code: LanguageCodeSchema, priorityTier: SourcePriorityTierSchema });
export type SourceLanguage = z.infer<typeof SourceLanguageSchema>;

export const SOURCE_LANGUAGE_CODES = LANGUAGE_CODES;
export const SourceLanguageCodeSchema = LanguageCodeSchema;
export type SourceLanguageCode = LanguageCode;

const SOURCE_PRIORITY: Readonly<Partial<Record<LanguageCode, SourcePriorityTier>>> = { en: 1, fr: 2, es: 3, ru: 3 };

export const SOURCE_LANGUAGES: readonly SourceLanguage[] = LANGUAGE_CODES.map((code) => ({
  code,
  priorityTier: SOURCE_PRIORITY[code] ?? 4,
}));

// ---------------------------------------------------------------------------
// Lookups and guards
// ---------------------------------------------------------------------------

const languageByCode = new Map<string, Language>(LANGUAGES.map((l) => [l.code, l]));
const varietyById = new Map<string, LanguageVariety>(LANGUAGE_VARIETIES.map((v) => [v.id, v]));
const trackById = new Map<string, CourseTrack>(COURSE_TRACKS.map((t) => [t.id, t]));
const writingSystemById = new Map<string, WritingSystem>(WRITING_SYSTEMS.map((w) => [w.id, w]));
const sourceByCode = new Map<string, SourceLanguage>(SOURCE_LANGUAGES.map((s) => [s.code, s]));

export const isLanguageCode = (value: unknown): value is LanguageCode => typeof value === 'string' && languageByCode.has(value);
export const isSourceLanguageCode = (value: unknown): value is SourceLanguageCode => typeof value === 'string' && sourceByCode.has(value);
export const isVarietyId = (value: unknown): value is VarietyId => typeof value === 'string' && varietyById.has(value);
export const isCourseTrackId = (value: unknown): value is CourseTrackId => typeof value === 'string' && trackById.has(value);
export const isScriptId = (value: unknown): value is ScriptId => typeof value === 'string' && (SCRIPT_IDS as readonly string[]).includes(value);

/** Returns the language record or throws for an unknown code. */
export function getLanguage(code: LanguageCode): Language {
  const found = languageByCode.get(code);
  if (!found) throw new Error(`Unknown language code: ${code}`);
  return found;
}
export const findLanguage = (code: string): Language | undefined => languageByCode.get(code);

export function getVariety(id: VarietyId): LanguageVariety {
  const found = varietyById.get(id);
  if (!found) throw new Error(`Unknown variety id: ${id}`);
  return found;
}
export const findVariety = (id: string): LanguageVariety | undefined => varietyById.get(id);

export function getCourseTrack(id: CourseTrackId): CourseTrack {
  const found = trackById.get(id);
  if (!found) throw new Error(`Unknown course track id: ${id}`);
  return found;
}
export const findCourseTrack = (id: string): CourseTrack | undefined => trackById.get(id);

export function getWritingSystem(id: ScriptId | TransliterationSchemeId): WritingSystem {
  const found = writingSystemById.get(id);
  if (!found) throw new Error(`Unknown writing system: ${id}`);
  return found;
}

export function getSourceLanguage(code: SourceLanguageCode): SourceLanguage {
  const found = sourceByCode.get(code);
  if (!found) throw new Error(`Unknown source language: ${code}`);
  return found;
}

/** All tracks whose target belongs to the given language (e.g. `ar` → 4 tracks). */
export const tracksForLanguage = (code: LanguageCode): readonly CourseTrack[] => COURSE_TRACKS.filter((t) => t.languageCode === code);

/** All tracks teaching the given variety (`cmn` → mandarin + simplified). */
export const tracksForVariety = (id: VarietyId): readonly CourseTrack[] => COURSE_TRACKS.filter((t) => t.targetVarietyId === id);

/** Whether a track's primary script is right-to-left. */
export const isRtlTrack = (id: CourseTrackId): boolean => isRtlScript(getCourseTrack(id).scripts.primary);

/** The track whose assets a given track consumes (itself when it does not share). */
export const resolveAssetTrackId = (id: CourseTrackId): CourseTrackId => getCourseTrack(id).sharesAssetsWithTrackId ?? id;

/**
 * True when assets/voices/content for `from` may be served to `to` without crossing a
 * variety boundary. Only identical varieties qualify (`cmn` ↔ `cmn`); `ary`→`arb`,
 * `yue`→`cmn`, `ht`→`fr` are always false.
 */
export const isSameVariety = (from: VarietyId, to: VarietyId): boolean => from === to;

/** True when substituting `candidate` for `requested` is explicitly forbidden by the catalog. */
export const isForbiddenSubstitution = (requested: VarietyId, candidate: VarietyId): boolean =>
  requested !== candidate && (getVariety(requested).mustNotSubstitute as readonly VarietyId[]).includes(candidate);
