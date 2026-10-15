/**
 * Per-variety TTS voice registry (§8.6): model + provider voice id + response format, with an explicit
 * `synthetic: true` flag surfaced to learners, and explicit `unsupported` entries where no provider is
 * documented. Verified voices were exercised live on 2026-10-14; others come from the live OpenRouter
 * model catalog (`supported_voices`) or vendor language lists.
 */
import type { AudioEncoding, VarietyId } from '@langquest/contracts';
import type { SupportStatus } from '../capability/matrix';

export type VoiceGender = 'female' | 'male' | 'neutral';

export interface VoiceEntry {
  /** Stable LangQuest voice id (what the API/mobile reference). */
  voiceId: string;
  varietyId: VarietyId;
  model: string;
  /** Provider voice name exactly as OpenRouter expects it. */
  providerVoice: string;
  /**
   * Locale the voice is served as. INVARIANT: `resolveVariety(locale) === varietyId` — a voice may never declare
   * a locale that the capability registry maps to another variety (no MSA/Egyptian locale under a Levantine or
   * Darija voice). For dialect-instructed multilingual voices this is the track/regional locale, not the
   * vendor's catalogue language; `evidence` states how far the accent is established.
   */
  locale: string;
  gender: VoiceGender;
  /** Response format to request from OpenRouter (Gemini TTS only supports `pcm`). */
  responseFormat: 'pcm' | 'mp3';
  encoding: AudioEncoding;
  sampleRateHz: number;
  /** Always true for TTS (§8.6: reflect when a speaker is synthetic). */
  synthetic: true;
  status: SupportStatus;
  /** Optional regional option id this voice matches (e.g. `TW`, `CA`, `south`). */
  regionalOptionId: string | null;
  /** Delivery instruction passed to models that honour it (Gemini); keeps dialect intent explicit. */
  instructions: string | null;
  evidence: string;
}

const GEMINI = 'google/gemini-3.8-flash-lite-tts';
const ELEVEN = 'elevenlabs/eleven-flash-v2.5';
const ELEVEN_V3 = 'elevenlabs/eleven-v3';
const MAI = 'microsoft/mai-voice-2.1-flash';
const KOKORO = 'hexgrad/kokoro-82m';

const gemini = (varietyId: VarietyId, voiceId: string, providerVoice: string, locale: string, gender: VoiceGender, status: SupportStatus, instructions: string, evidence: string, regionalOptionId: string | null = null): VoiceEntry => ({
  voiceId, varietyId, model: GEMINI, providerVoice, locale, gender, responseFormat: 'pcm', encoding: 'pcm16', sampleRateHz: 24_000, synthetic: true, status, regionalOptionId, instructions, evidence,
});
const mai = (varietyId: VarietyId, voiceId: string, providerVoice: string, locale: string, gender: VoiceGender, status: SupportStatus, evidence: string, regionalOptionId: string | null = null): VoiceEntry => ({
  voiceId, varietyId, model: MAI, providerVoice: `${providerVoice}:MAI-Voice-2.1-Flash`, locale, gender, responseFormat: 'mp3', encoding: 'mp3', sampleRateHz: 24_000, synthetic: true, status, regionalOptionId, instructions: null, evidence,
});
const eleven = (varietyId: VarietyId, voiceId: string, providerVoice: string, locale: string, gender: VoiceGender, status: SupportStatus, evidence: string, model: string = ELEVEN): VoiceEntry => ({
  voiceId, varietyId, model, providerVoice, locale, gender, responseFormat: 'mp3', encoding: 'mp3', sampleRateHz: 44_100, synthetic: true, status, regionalOptionId: null, instructions: null, evidence,
});
const kokoro = (varietyId: VarietyId, voiceId: string, providerVoice: string, locale: string, gender: VoiceGender, status: SupportStatus, evidence: string): VoiceEntry => ({
  voiceId, varietyId, model: KOKORO, providerVoice, locale, gender, responseFormat: 'mp3', encoding: 'mp3', sampleRateHz: 24_000, synthetic: true, status, regionalOptionId: null, instructions: null, evidence,
});

const MAI_CATALOG = 'listed in the live OpenRouter catalog for microsoft/mai-voice-2.1-flash on 2026-10-14';
const ELEVEN_DOC = 'ElevenLabs flash v2.5 documents this language (32-language list); multilingual voice reads the text; not native-reviewed';
const GEMINI_DOC = 'Gemini TTS documents this locale; voice name from the live catalog; not native-reviewed';

/** `unsupported` entries are explicit so that nothing silently picks a neighbouring language's voice. */
export const VOICE_REGISTRY: Readonly<Record<VarietyId, readonly VoiceEntry[] | 'unsupported'>> = {
  // ElevenLabs has no dialect-instruction channel, so its generic-Arabic voice (catalogue locale `ar` = MSA) is
  // NOT listed under Levantine or Darija: that would be an MSA voice serving a colloquial course.
  'ar-levant': [
    gemini('ar-levant', 'ar-levant-f-1', 'Kore', 'ar-SY', 'female', 'limited', 'Speak in natural Levantine (Syrian/Lebanese) Arabic, not Modern Standard Arabic.', 'No provider documents Levantine; Gemini is dialect-instructed and reads Arabic-script Levantine text with its Arabic voice. Accent unverified; not native-reviewed.', 'SY'),
    gemini('ar-levant', 'ar-levant-m-1', 'Charon', 'ar-SY', 'male', 'limited', 'Speak in natural Levantine (Syrian/Lebanese) Arabic, not Modern Standard Arabic.', 'No provider documents Levantine; Gemini is dialect-instructed. Accent unverified; not native-reviewed.', 'SY'),
  ],
  ary: [
    gemini('ary', 'ary-f-1', 'Kore', 'ar-MA', 'female', 'limited', 'Speak in Moroccan Darija as spoken in Casablanca, never Modern Standard Arabic.', 'Live 2026-10-14: synthesised Darija text; Whisper read it back with one lexical error. Not native-reviewed.'),
    gemini('ary', 'ary-m-1', 'Charon', 'ar-MA', 'male', 'limited', 'Speak in Moroccan Darija as spoken in Casablanca, never Modern Standard Arabic.', 'Gemini is dialect-instructed; male Darija voice unverified; not native-reviewed.'),
  ],
  arz: [
    gemini('arz', 'arz-f-1', 'Kore', 'ar-EG', 'female', 'vendor_documented', 'Speak in Egyptian (Cairene) Arabic.', 'Gemini TTS documents ar-EG; live 2026-10-14 smoke synthesis succeeded.'),
    gemini('arz', 'arz-m-1', 'Charon', 'ar-EG', 'male', 'vendor_documented', 'Speak in Egyptian (Cairene) Arabic.', GEMINI_DOC),
  ],
  arb: [
    eleven('arb', 'arb-m-1', 'george', 'ar', 'male', 'vendor_documented', ELEVEN_DOC),
    gemini('arb', 'arb-f-1', 'Kore', 'ar', 'female', 'limited', 'Read in careful Modern Standard Arabic (Fusha).', 'Gemini TTS documents its Arabic voice as ar-EG; served here as MSA (locale ar) under instruction. MSA reading is plausible but unverified.'),
  ],
  yue: [
    gemini('yue', 'yue-f-1', 'Kore', 'zh-HK', 'female', 'limited', 'Speak in Hong Kong Cantonese (廣東話), not Mandarin.', 'Live 2026-10-14: Cantonese text synthesised and transcribed back exactly by Whisper(yue). Not documented by vendor; not native-reviewed.'),
  ],
  cmn: [
    mai('cmn', 'cmn-f-1', 'zh-CN-Mei', 'zh-CN', 'female', 'vendor_documented', MAI_CATALOG, 'CN'),
    mai('cmn', 'cmn-m-1', 'zh-CN-Wei', 'zh-CN', 'male', 'vendor_documented', MAI_CATALOG, 'CN'),
    kokoro('cmn', 'cmn-f-2', 'zf_xiaoxiao', 'zh-CN', 'female', 'vendor_documented', 'Kokoro documents Chinese (Mandarin) voices.'),
    gemini('cmn', 'cmn-tw-f-1', 'Kore', 'zh-TW', 'female', 'limited', 'Speak in Taiwanese Mandarin.', 'No MAI zh-TW voice; Gemini reads Traditional text. Unverified.', 'TW'),
  ],
  en: [
    mai('en', 'en-us-f-1', 'en-US-Harper', 'en-US', 'female', 'vendor_documented', MAI_CATALOG, 'US'),
    mai('en', 'en-us-m-1', 'en-US-Ethan', 'en-US', 'male', 'vendor_documented', MAI_CATALOG, 'US'),
    mai('en', 'en-gb-f-1', 'en-GB-Emily', 'en-GB', 'female', 'vendor_documented', MAI_CATALOG, 'GB'),
    mai('en', 'en-gb-m-1', 'en-GB-Harry', 'en-GB', 'male', 'vendor_documented', MAI_CATALOG, 'GB'),
  ],
  da: [mai('da', 'da-f-1', 'da-DK-Harper', 'da-DK', 'female', 'vendor_documented', MAI_CATALOG), mai('da', 'da-m-1', 'da-DK-Grant', 'da-DK', 'male', 'vendor_documented', MAI_CATALOG)],
  fr: [
    mai('fr', 'fr-fr-f-1', 'fr-FR-Soleil', 'fr-FR', 'female', 'vendor_documented', MAI_CATALOG, 'FR'),
    mai('fr', 'fr-fr-m-1', 'fr-FR-Marc', 'fr-FR', 'male', 'vendor_documented', MAI_CATALOG, 'FR'),
    gemini('fr', 'fr-fr-f-2', 'Kore', 'fr-FR', 'female', 'verified', 'Speak in natural French from France.', 'Live 2026-10-14: synthesised "Bonjour, comment ça va aujourd\'hui ?" (pcm 24 kHz); three STT engines transcribed it exactly.', 'FR'),
    kokoro('fr', 'fr-fr-f-3', 'ff_siwis', 'fr-FR', 'female', 'verified', 'Live 2026-10-14: Kokoro ff_siwis mp3 synthesis transcribed exactly by Scribe v2.'),
    gemini('fr', 'fr-ca-f-1', 'Kore', 'fr-CA', 'female', 'limited', 'Speak in Québec French.', 'No provider offers a Québec voice; Gemini instruction-based accent is unverified.', 'CA'),
  ],
  de: [mai('de', 'de-f-1', 'de-DE-Mia', 'de-DE', 'female', 'vendor_documented', MAI_CATALOG), mai('de', 'de-m-1', 'de-DE-Klaus', 'de-DE', 'male', 'vendor_documented', MAI_CATALOG)],
  el: [eleven('el', 'el-f-1', 'sarah', 'el', 'female', 'vendor_documented', ELEVEN_DOC), eleven('el', 'el-m-1', 'george', 'el', 'male', 'vendor_documented', ELEVEN_DOC)],
  ht: [
    gemini('ht', 'ht-f-1', 'Kore', 'ht-HT', 'female', 'limited', 'Speak in Haitian Creole (Kreyòl ayisyen) with Haitian pronunciation. This is not French.', 'Live 2026-10-14: synthesised Kreyòl text; Whisper(ht) recognised most words. No vendor documents Haitian Creole; not native-reviewed.'),
  ],
  he: [eleven('he', 'he-f-1', 'sarah', 'he', 'female', 'limited', 'Hebrew is absent from the flash v2.5 list; eleven-v3 (70+ languages) is expected to cover it. Unverified.', ELEVEN_V3)],
  hi: [mai('hi', 'hi-f-1', 'hi-IN-Kavya', 'hi-IN', 'female', 'vendor_documented', MAI_CATALOG), mai('hi', 'hi-m-1', 'hi-IN-Arjun', 'hi-IN', 'male', 'vendor_documented', MAI_CATALOG)],
  it: [mai('it', 'it-f-1', 'it-IT-Rosa', 'it-IT', 'female', 'vendor_documented', MAI_CATALOG), mai('it', 'it-m-1', 'it-IT-Luca', 'it-IT', 'male', 'vendor_documented', MAI_CATALOG)],
  ja: [gemini('ja', 'ja-f-1', 'Kore', 'ja-JP', 'female', 'vendor_documented', 'Speak in natural Tokyo Japanese.', GEMINI_DOC), kokoro('ja', 'ja-m-1', 'jm_kumo', 'ja-JP', 'male', 'vendor_documented', 'Kokoro documents Japanese voices.')],
  ko: [mai('ko', 'ko-f-1', 'ko-KR-Haena', 'ko-KR', 'female', 'vendor_documented', MAI_CATALOG), mai('ko', 'ko-m-1', 'ko-KR-Junho', 'ko-KR', 'male', 'vendor_documented', MAI_CATALOG)],
  'pt-BR': [mai('pt-BR', 'pt-br-f-1', 'pt-BR-Luana', 'pt-BR', 'female', 'vendor_documented', MAI_CATALOG), mai('pt-BR', 'pt-br-m-1', 'pt-BR-Caio', 'pt-BR', 'male', 'vendor_documented', MAI_CATALOG)],
  'pt-PT': [
    mai('pt-PT', 'pt-pt-m-1', 'pt-PT-Rui', 'pt-PT', 'male', 'verified', 'Live 2026-10-14: synthesised "Bom dia, está tudo bem consigo?" (mp3, 49 KB, 527 ms).'),
    mai('pt-PT', 'pt-pt-f-1', 'pt-PT-Harper', 'pt-PT', 'female', 'vendor_documented', MAI_CATALOG),
  ],
  ro: [mai('ro', 'ro-f-1', 'ro-RO-Ioana', 'ro-RO', 'female', 'vendor_documented', MAI_CATALOG), mai('ro', 'ro-m-1', 'ro-RO-Andrei', 'ro-RO', 'male', 'vendor_documented', MAI_CATALOG)],
  ru: [mai('ru', 'ru-f-1', 'ru-RU-Masha', 'ru-RU', 'female', 'vendor_documented', MAI_CATALOG), mai('ru', 'ru-m-1', 'ru-RU-Lev', 'ru-RU', 'male', 'vendor_documented', MAI_CATALOG)],
  'es-419': [
    mai('es-419', 'es-mx-f-1', 'es-MX-Valeria', 'es-MX', 'female', 'vendor_documented', MAI_CATALOG, 'MX'),
    mai('es-419', 'es-mx-m-1', 'es-MX-Alejo', 'es-MX', 'male', 'vendor_documented', MAI_CATALOG, 'MX'),
    gemini('es-419', 'es-419-f-2', 'Kore', 'es-419', 'female', 'vendor_documented', 'Speak in neutral Latin American Spanish.', 'Gemini TTS documents es-US (Latin American Spanish).'),
  ],
  'es-ES': [mai('es-ES', 'es-es-f-1', 'es-ES-Marta', 'es-ES', 'female', 'vendor_documented', MAI_CATALOG), gemini('es-ES', 'es-es-m-1', 'Charon', 'es-ES', 'male', 'limited', 'Speak in Castilian Spanish from Spain (distinción, vosotros).', 'Gemini documents es-US only; Castilian accent via instruction is unverified.')],
  sw: [gemini('sw', 'sw-f-1', 'Kore', 'sw-KE', 'female', 'limited', 'Speak in Kiswahili.', 'Live 2026-10-14: synthesised Swahili text; Whisper(sw) partially recognised it. No vendor documents Swahili for Gemini TTS; not native-reviewed.')],
  rw: 'unsupported',
  sv: [mai('sv', 'sv-f-1', 'sv-SE-Harper', 'sv-SE', 'female', 'vendor_documented', MAI_CATALOG), mai('sv', 'sv-m-1', 'sv-SE-Grant', 'sv-SE', 'male', 'vendor_documented', MAI_CATALOG)],
  ln: 'unsupported',
  uk: [gemini('uk', 'uk-f-1', 'Kore', 'uk-UA', 'female', 'vendor_documented', 'Speak in natural Ukrainian.', GEMINI_DOC), eleven('uk', 'uk-m-1', 'george', 'uk', 'male', 'vendor_documented', ELEVEN_DOC)],
  vi: [mai('vi', 'vi-f-1', 'vi-VN-Harper', 'vi-VN', 'female', 'vendor_documented', MAI_CATALOG), mai('vi', 'vi-m-1', 'vi-VN-Grant', 'vi-VN', 'male', 'vendor_documented', MAI_CATALOG)],
};

export const voicesForVariety = (variety: VarietyId): readonly VoiceEntry[] => {
  const entry = VOICE_REGISTRY[variety];
  return entry === 'unsupported' ? [] : entry;
};

const byVoiceId = new Map<string, VoiceEntry>();
for (const entry of Object.values(VOICE_REGISTRY)) {
  if (entry === 'unsupported') continue;
  for (const v of entry) byVoiceId.set(v.voiceId, v);
}
export const findVoice = (voiceId: string): VoiceEntry | null => byVoiceId.get(voiceId) ?? null;

/** Default voice for a variety, honouring a regional option when a voice is tagged for it. */
export function defaultVoiceFor(variety: VarietyId, regionalOptionId?: string | null): VoiceEntry | null {
  const voices = voicesForVariety(variety);
  if (!voices.length) return null;
  const rank = (v: VoiceEntry) => (v.status === 'verified' ? 3 : v.status === 'vendor_documented' ? 2 : v.status === 'limited' ? 1 : 0);
  const regional = regionalOptionId ? voices.filter((v) => v.regionalOptionId === regionalOptionId) : [];
  const pool = regional.length ? regional : voices;
  return [...pool].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}
