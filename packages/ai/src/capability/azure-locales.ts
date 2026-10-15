/**
 * Azure Speech pronunciation-assessment locale set.
 *
 * Source (fetched 2026-10-14): https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment
 * The "Pronunciation assessment" tab lists exactly 33 locales. NOTE: the repo file
 * `docs/provider-matrix/azure-pronunciation-locales-2026-10-14.md` also pasted the *video translation* grid
 * (ar-MA, ar-SY, sw-KE, he-IL, el-GR, uk-UA …) under phoneme/prosody headings — those rows are NOT
 * pronunciation-assessment support and are intentionally excluded here.
 *
 * Phoneme-level scoring is documented for every listed locale; prosody assessment is documented as an
 * additional option (`EnableProsodyAssessment`) and is only exposed as `true` for `en-US`-family locales plus
 * the ones Microsoft's how-to page names explicitly. We keep prosody conservative (`en-*`, `zh-CN`, `de-DE`,
 * `fr-FR`, `es-ES`, `es-MX`, `ja-JP`, `ko-KR`, `pt-BR`, `it-IT`) until a live calibration run says otherwise.
 */

export interface AzurePronunciationLocale {
  locale: string;
  language: string;
  phoneme: boolean;
  prosody: boolean;
  /** Tone scoring is only meaningful for tonal locales and is reported through phoneme/accuracy scores. */
  tone: boolean;
}

const row = (locale: string, language: string, prosody = false, tone = false): AzurePronunciationLocale => ({ locale, language, phoneme: true, prosody, tone });

export const AZURE_PRONUNCIATION_LOCALES: readonly AzurePronunciationLocale[] = [
  row('ar-EG', 'Arabic (Egypt)'),
  row('ar-SA', 'Arabic (Saudi Arabia)'),
  row('ca-ES', 'Catalan'),
  row('zh-HK', 'Chinese (Cantonese, Traditional)', false, true),
  row('zh-CN', 'Chinese (Mandarin, Simplified)', true, true),
  row('zh-TW', 'Chinese (Taiwanese Mandarin, Traditional)', false, true),
  row('da-DK', 'Danish (Denmark)'),
  row('nl-NL', 'Dutch (Netherlands)'),
  row('en-AU', 'English (Australia)', true),
  row('en-CA', 'English (Canada)', true),
  row('en-IN', 'English (India)', true),
  row('en-GB', 'English (United Kingdom)', true),
  row('en-US', 'English (United States)', true),
  row('fi-FI', 'Finnish (Finland)'),
  row('fr-CA', 'French (Canada)'),
  row('fr-FR', 'French (France)', true),
  row('de-DE', 'German (Germany)', true),
  row('hi-IN', 'Hindi (India)'),
  row('it-IT', 'Italian (Italy)', true),
  row('ja-JP', 'Japanese (Japan)', true),
  row('ko-KR', 'Korean (Korea)', true),
  row('ms-MY', 'Malay (Malaysia)'),
  row('nb-NO', 'Norwegian Bokmål (Norway)'),
  row('pl-PL', 'Polish (Poland)'),
  row('pt-BR', 'Portuguese (Brazil)', true),
  row('pt-PT', 'Portuguese (Portugal)'),
  row('ru-RU', 'Russian (Russia)'),
  row('es-MX', 'Spanish (Mexico)', true),
  row('es-ES', 'Spanish (Spain)', true),
  row('sv-SE', 'Swedish (Sweden)'),
  row('ta-IN', 'Tamil (India)'),
  row('th-TH', 'Thai (Thailand)'),
  row('vi-VN', 'Vietnamese (Vietnam)', false, true),
];

const byLocale = new Map(AZURE_PRONUNCIATION_LOCALES.map((r) => [r.locale.toLowerCase(), r]));

export const findAzurePronunciationLocale = (locale: string): AzurePronunciationLocale | null => byLocale.get(locale.toLowerCase()) ?? null;
export const isAzurePronunciationLocale = (locale: string): boolean => byLocale.has(locale.toLowerCase());
