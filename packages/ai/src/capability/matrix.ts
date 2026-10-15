/**
 * Typed capability matrix for all 30 course tracks (§8.5, §8.6): honest, evidence-backed statuses for
 * STT, TTS, realtime and pronunciation (word / phoneme / tone / prosody).
 *
 * Status semantics:
 * - `verified`          — exercised live by LangQuest engineering on the date in `evidence` (smoke-level unless noted).
 * - `vendor_documented` — the provider documents the locale; not yet exercised or native-reviewed by us.
 * - `limited`           — something works (generic model reads the text / recognises the language) but
 *                          dialect fidelity is NOT established; must be surfaced to learners as limited.
 * - `unavailable`       — no configured provider claims support; never fabricate.
 *
 * Pronunciation statuses describe the Azure Speech acoustic assessor (the only numeric scorer we integrate).
 * When Azure credentials are absent the runtime capability is `unsupported` regardless of this table.
 */
import { COURSE_TRACKS, type CourseTrackId, type VarietyId } from '@langquest/contracts';
import { findAzurePronunciationLocale } from './azure-locales';

export const SUPPORT_STATUS_VALUES = ['verified', 'vendor_documented', 'limited', 'unavailable'] as const;
export type SupportStatus = (typeof SUPPORT_STATUS_VALUES)[number];

export interface SupportEntry {
  status: SupportStatus;
  /** Human-readable evidence: what was verified, when, with which model; or which vendor doc was consulted. */
  evidence: string;
}

export interface SttCapability extends SupportEntry {
  /** ISO-639-1 (or Whisper code such as `yue`) hint sent to providers; `null` = let the provider auto-detect. */
  languageHint: string | null;
  /** Ordered model preference for this variety (OpenRouter transcription ids). */
  models: readonly string[];
}

export interface PronunciationCapability {
  /** Azure locale used for scripted assessment, or null when no documented locale maps to this variety. */
  azureLocale: string | null;
  word: SupportEntry;
  phoneme: SupportEntry;
  tone: SupportEntry;
  prosody: SupportEntry;
}

export interface VarietyCapabilityProfile {
  varietyId: VarietyId;
  stt: SttCapability;
  tts: SupportEntry;
  /** Turn-based STT→LLM→TTS pipeline (our own orchestration). */
  realtimePipeline: SupportEntry;
  /** Full-duplex provider — none configured in this build; honest `unavailable`. */
  realtimeDuplex: SupportEntry;
  pronunciation: PronunciationCapability;
}

export interface TrackCapabilityProfile extends VarietyCapabilityProfile {
  trackId: CourseTrackId;
}

const WHISPER = 'openai/whisper-large-v3';
const SCRIBE = 'elevenlabs/scribe-v2';
const GEMINI_STT = 'google/gemini-3.5-transcribe';
const WHISPER_CHAIN = [WHISPER, SCRIBE, GEMINI_STT] as const;

const DUPLEX_UNAVAILABLE: SupportEntry = { status: 'unavailable', evidence: 'No full-duplex realtime provider is configured; DuplexProviderStub reports supports()=false (§8.6).' };

const whisperDoc = (lang: string): string => `Whisper large-v3 documents ${lang} in its 99-language list; not yet exercised by LangQuest.`;
const azureDoc = (locale: string): string => `Azure Speech pronunciation-assessment locale list (fetched 2026-10-14) includes ${locale}; not live-exercised (no Azure key in this environment).`;

const az = (locale: string | null, tonal = false, notes?: string): PronunciationCapability => {
  const row = locale ? findAzurePronunciationLocale(locale) : null;
  if (!row || !locale) {
    const evidence = notes ?? `No Azure pronunciation-assessment locale maps to this variety (33-locale list fetched 2026-10-14).`;
    const none: SupportEntry = { status: 'unavailable', evidence };
    return { azureLocale: null, word: none, phoneme: none, tone: none, prosody: none };
  }
  const base = notes ? `${azureDoc(locale)} ${notes}` : azureDoc(locale);
  const status: SupportStatus = notes?.startsWith('LIMITED') ? 'limited' : 'vendor_documented';
  return {
    azureLocale: locale,
    word: { status, evidence: base },
    phoneme: { status, evidence: base },
    tone: tonal
      ? { status: 'limited', evidence: `${base} Azure reports per-phoneme accuracy for this tonal locale but no explicit tone labels; tone feedback is derived, not measured.` }
      : { status: 'unavailable', evidence: 'Non-tonal variety: tone assessment not applicable.' },
    prosody: row.prosody ? { status, evidence: `${base} Prosody assessment documented (EnableProsodyAssessment).` } : { status: 'limited', evidence: `${base} Prosody assessment not confirmed for this locale; only accuracy/fluency/completeness are relied on.` },
  };
};

type Partial30 = Record<VarietyId, VarietyCapabilityProfile>;

const V: Partial30 = {
  'ar-levant': {
    varietyId: 'ar-levant',
    stt: { status: 'limited', languageHint: 'ar', models: WHISPER_CHAIN, evidence: 'Whisper "ar" is pan-Arabic; Levantine lexicon not benchmarked. Darija/Egyptian smoke tests on 2026-10-14 showed dialect-word errors, so Levantine is assumed similar until a native fixture suite runs.' },
    tts: { status: 'limited', evidence: 'No provider documents Levantine Arabic. ElevenLabs flash v2.5 / Gemini TTS read Arabic-script text with a generic or Egyptian voice; not native-reviewed for Shami.' },
    realtimePipeline: { status: 'limited', evidence: 'Pipeline available; bounded by limited STT/TTS dialect fidelity.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'ar-SY / ar-LB / ar-JO / ar-PS are NOT in the Azure pronunciation-assessment list (only ar-EG and ar-SA are). Never score Levantine with ar-SA.'),
  },
  ary: {
    varietyId: 'ary',
    stt: { status: 'limited', languageHint: 'ar', models: WHISPER_CHAIN, evidence: 'Live 2026-10-14: Gemini-TTS Darija sample → Whisper "ar" returned "صباح الخير لبس عليك؟" (لاباس misheard). Pan-Arabic ASR; Darija lexicon not reliable.' },
    tts: { status: 'limited', evidence: 'Live 2026-10-14: google/gemini-3.8-flash-lite-tts synthesised Darija text (117 KB PCM) and Whisper read it back; no native review of accent/lexicon. No provider documents Darija.' },
    realtimePipeline: { status: 'limited', evidence: 'Pipeline available; dialect fidelity limited (see STT/TTS).' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'ar-MA is NOT in the Azure pronunciation-assessment list (only ar-EG and ar-SA). Darija gets reference-comparison feedback only.'),
  },
  arz: {
    varietyId: 'arz',
    stt: { status: 'limited', languageHint: 'ar', models: WHISPER_CHAIN, evidence: 'Live 2026-10-14: Egyptian sample round-trip via Whisper "ar" was exact ("صباح الخير عامل إيه النهاردة؟"); single synthetic sample, pan-Arabic model.' },
    tts: { status: 'vendor_documented', evidence: 'Gemini TTS documents ar-EG; live 2026-10-14 smoke synthesis succeeded. Not native-reviewed.' },
    realtimePipeline: { status: 'limited', evidence: 'Pipeline available; STT dialect fidelity limited.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('ar-EG'),
  },
  arb: {
    varietyId: 'arb',
    stt: { status: 'vendor_documented', languageHint: 'ar', models: WHISPER_CHAIN, evidence: whisperDoc('Arabic (MSA-dominant training data)') },
    tts: { status: 'vendor_documented', evidence: 'ElevenLabs flash v2.5 documents Arabic (32-language list); Gemini TTS ar-EG voice reads MSA text. Not native-reviewed.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available with documented STT/TTS.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('ar-SA', false, 'LIMITED: Azure has no MSA locale; ar-SA (Saudi) is the closest documented scripted-assessment locale and is used with a limited confidence label.'),
  },
  yue: {
    varietyId: 'yue',
    stt: { status: 'verified', languageHint: 'yue', models: WHISPER_CHAIN, evidence: 'Live 2026-10-14: Whisper large-v3 with language=yue returned exact "早晨,你今日點呀?" for a synthetic Cantonese sample (1 sample).' },
    tts: { status: 'limited', evidence: 'No provider documents Cantonese (ElevenLabs/MAI "Chinese" = Mandarin). Live 2026-10-14: Gemini TTS read Cantonese text and Whisper(yue) transcribed it exactly — suggestive, not native-reviewed.' },
    realtimePipeline: { status: 'limited', evidence: 'Pipeline available; TTS Cantonese fidelity not established.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('zh-HK', true),
  },
  cmn: {
    varietyId: 'cmn',
    stt: { status: 'vendor_documented', languageHint: 'zh', models: WHISPER_CHAIN, evidence: whisperDoc('Chinese (Mandarin)') },
    tts: { status: 'vendor_documented', evidence: 'microsoft/mai-voice-2.1-flash lists zh-CN voices (live catalog 2026-10-14); ElevenLabs and Kokoro document Chinese.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available with documented STT/TTS.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('zh-CN', true),
  },
  en: {
    varietyId: 'en',
    stt: { status: 'vendor_documented', languageHint: 'en', models: WHISPER_CHAIN, evidence: whisperDoc('English') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists en-US / en-GB voices (live catalog 2026-10-14).' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('en-US'),
  },
  da: {
    varietyId: 'da',
    stt: { status: 'vendor_documented', languageHint: 'da', models: WHISPER_CHAIN, evidence: whisperDoc('Danish') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists da-DK voices; ElevenLabs documents Danish.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('da-DK'),
  },
  fr: {
    varietyId: 'fr',
    stt: { status: 'verified', languageHint: 'fr', models: WHISPER_CHAIN, evidence: 'Live 2026-10-14: Whisper (verbose_json, words), Gemini-3.5-transcribe (multipart) and Scribe v2 all returned "Bonjour, comment ça va aujourd\'hui ?" exactly.' },
    tts: { status: 'verified', evidence: 'Live 2026-10-14: Gemini flash-lite TTS (Kore, pcm 24 kHz) and Kokoro (ff_siwis, mp3) synthesised French; MAI lists fr-FR voices. fr-CA: no MAI voice; generic French only (limited).' },
    realtimePipeline: { status: 'verified', evidence: 'STT and TTS components verified live; end-to-end latency not yet measured in production.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('fr-FR'),
  },
  de: {
    varietyId: 'de',
    stt: { status: 'vendor_documented', languageHint: 'de', models: WHISPER_CHAIN, evidence: whisperDoc('German') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists de-DE voices.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('de-DE'),
  },
  el: {
    varietyId: 'el',
    stt: { status: 'vendor_documented', languageHint: 'el', models: WHISPER_CHAIN, evidence: whisperDoc('Greek') },
    tts: { status: 'vendor_documented', evidence: 'ElevenLabs flash v2.5 documents Greek; no MAI/Gemini Greek voice.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'el-GR is NOT in the Azure pronunciation-assessment list (it appears only in STT/TTS lists).'),
  },
  ht: {
    varietyId: 'ht',
    stt: { status: 'limited', languageHint: 'ht', models: WHISPER_CHAIN, evidence: 'Live 2026-10-14: Whisper "ht" returned "Monjou, ki jan ou ye jodia?" for "Bonjou, kijan ou ye jodi a?" — recognisable but with errors; 17.5 s latency.' },
    tts: { status: 'limited', evidence: 'No provider documents Haitian Creole. Live 2026-10-14: Gemini TTS produced audio that Whisper(ht) mostly recognised; accent not native-reviewed. Never substitute French voices.' },
    realtimePipeline: { status: 'limited', evidence: 'Pipeline available; fidelity limited.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'ht-HT is absent from every Azure Speech table. Reference comparison only; fr-FR must never be used.'),
  },
  he: {
    varietyId: 'he',
    stt: { status: 'vendor_documented', languageHint: 'he', models: WHISPER_CHAIN, evidence: whisperDoc('Hebrew') },
    tts: { status: 'limited', evidence: 'Hebrew is not in the ElevenLabs flash v2.5 32-language list; eleven-v3 (70+ languages) is expected to cover it but is unverified here. No MAI/Gemini Hebrew voice.' },
    realtimePipeline: { status: 'limited', evidence: 'Pipeline available; TTS unverified.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'he-IL is NOT in the Azure pronunciation-assessment list.'),
  },
  hi: {
    varietyId: 'hi',
    stt: { status: 'vendor_documented', languageHint: 'hi', models: WHISPER_CHAIN, evidence: whisperDoc('Hindi') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists hi-IN voices; Gemini TTS and Kokoro document Hindi.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('hi-IN'),
  },
  it: {
    varietyId: 'it',
    stt: { status: 'vendor_documented', languageHint: 'it', models: WHISPER_CHAIN, evidence: whisperDoc('Italian') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists it-IT voices.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('it-IT'),
  },
  ja: {
    varietyId: 'ja',
    stt: { status: 'vendor_documented', languageHint: 'ja', models: WHISPER_CHAIN, evidence: whisperDoc('Japanese') },
    tts: { status: 'vendor_documented', evidence: 'Gemini TTS documents ja-JP; Kokoro lists Japanese voices; ElevenLabs documents Japanese.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('ja-JP'),
  },
  ko: {
    varietyId: 'ko',
    stt: { status: 'vendor_documented', languageHint: 'ko', models: WHISPER_CHAIN, evidence: whisperDoc('Korean') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists ko-KR voices.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('ko-KR'),
  },
  'pt-BR': {
    varietyId: 'pt-BR',
    stt: { status: 'vendor_documented', languageHint: 'pt', models: WHISPER_CHAIN, evidence: whisperDoc('Portuguese (Brazilian-dominant data)') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists pt-BR voices; Gemini TTS documents pt-BR.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('pt-BR'),
  },
  'pt-PT': {
    varietyId: 'pt-PT',
    stt: { status: 'vendor_documented', languageHint: 'pt', models: WHISPER_CHAIN, evidence: 'Whisper "pt" has no European/Brazilian switch; transcripts are orthographically shared, but ASR of EU-PT phonology is not benchmarked.' },
    tts: { status: 'verified', evidence: 'Live 2026-10-14: microsoft/mai-voice-2.1-flash voice pt-PT-Rui synthesised "Bom dia, está tudo bem consigo?" (mp3, 527 ms). Not native-reviewed.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available; TTS verified, STT documented.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('pt-PT'),
  },
  ro: {
    varietyId: 'ro',
    stt: { status: 'vendor_documented', languageHint: 'ro', models: WHISPER_CHAIN, evidence: whisperDoc('Romanian') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists ro-RO voices; Gemini TTS documents ro-RO.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'ro-RO is NOT in the Azure pronunciation-assessment list.'),
  },
  ru: {
    varietyId: 'ru',
    stt: { status: 'vendor_documented', languageHint: 'ru', models: WHISPER_CHAIN, evidence: whisperDoc('Russian') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists ru-RU voices; Gemini TTS documents ru-RU.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('ru-RU'),
  },
  'es-419': {
    varietyId: 'es-419',
    stt: { status: 'vendor_documented', languageHint: 'es', models: WHISPER_CHAIN, evidence: whisperDoc('Spanish') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists es-MX voices (regional default for es-419).' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('es-MX', false, 'es-MX is the only Latin-American locale in the Azure pronunciation list; es-CO/es-AR/es-PE/es-CL regional preferences are scored with es-MX (same variety es-419, surfaced to the learner).'),
  },
  'es-ES': {
    varietyId: 'es-ES',
    stt: { status: 'vendor_documented', languageHint: 'es', models: WHISPER_CHAIN, evidence: whisperDoc('Spanish') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists es-ES-Marta.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('es-ES'),
  },
  sw: {
    varietyId: 'sw',
    stt: { status: 'limited', languageHint: 'sw', models: WHISPER_CHAIN, evidence: 'Live 2026-10-14: Whisper "sw" returned "Habariya subuhi? Uhaligani leo," for "Habari ya asubuhi, u hali gani leo?" — word-boundary errors.' },
    tts: { status: 'limited', evidence: 'No configured provider documents Swahili (ElevenLabs v3 70+ list unverified). Live 2026-10-14: Gemini TTS produced audio that Whisper partially recognised; not native-reviewed.' },
    realtimePipeline: { status: 'limited', evidence: 'Pipeline available; fidelity limited.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'sw-KE / sw-TZ are NOT in the Azure pronunciation-assessment list (STT-only locales).'),
  },
  rw: {
    varietyId: 'rw',
    stt: { status: 'limited', languageHint: null, models: [SCRIBE, GEMINI_STT, WHISPER], evidence: 'Kinyarwanda is not in the Whisper language list; Scribe v2 / Gemini transcribe coverage unverified. Language hint omitted (auto-detect).' },
    tts: { status: 'unavailable', evidence: 'No configured provider documents Kinyarwanda; native-recorded audio required (§9.6).' },
    realtimePipeline: { status: 'unavailable', evidence: 'No TTS for Kinyarwanda; text-only or native-audio lessons only.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'rw-RW is absent from every Azure Speech table.'),
  },
  sv: {
    varietyId: 'sv',
    stt: { status: 'vendor_documented', languageHint: 'sv', models: WHISPER_CHAIN, evidence: whisperDoc('Swedish') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists sv-SE voices.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('sv-SE'),
  },
  ln: {
    varietyId: 'ln',
    stt: { status: 'limited', languageHint: 'ln', models: WHISPER_CHAIN, evidence: 'Whisper lists Lingala ("ln") but accuracy is unbenchmarked; not exercised.' },
    tts: { status: 'unavailable', evidence: 'No configured provider documents Lingala; native-recorded audio required. French voices must never be substituted.' },
    realtimePipeline: { status: 'unavailable', evidence: 'No TTS for Lingala.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'ln-CD is absent from every Azure Speech table.'),
  },
  uk: {
    varietyId: 'uk',
    stt: { status: 'vendor_documented', languageHint: 'uk', models: WHISPER_CHAIN, evidence: whisperDoc('Ukrainian') },
    tts: { status: 'vendor_documented', evidence: 'Gemini TTS documents uk-UA; ElevenLabs documents Ukrainian.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az(null, false, 'uk-UA is NOT in the Azure pronunciation-assessment list.'),
  },
  vi: {
    varietyId: 'vi',
    stt: { status: 'vendor_documented', languageHint: 'vi', models: WHISPER_CHAIN, evidence: whisperDoc('Vietnamese') },
    tts: { status: 'vendor_documented', evidence: 'MAI-Voice-2.1-Flash lists vi-VN voices; Gemini TTS documents vi-VN. North/South voice selection not yet differentiated.' },
    realtimePipeline: { status: 'vendor_documented', evidence: 'Pipeline available.' },
    realtimeDuplex: DUPLEX_UNAVAILABLE,
    pronunciation: az('vi-VN', true),
  },
};

export const VARIETY_CAPABILITIES: Readonly<Record<VarietyId, VarietyCapabilityProfile>> = V;

/** One entry per course track (30). `chinese-simplified` shares the Mandarin profile. */
export const TRACK_CAPABILITY_MATRIX: Readonly<Record<CourseTrackId, TrackCapabilityProfile>> = Object.fromEntries(
  COURSE_TRACKS.map((t) => [t.id, { trackId: t.id, ...V[t.targetVarietyId] }]),
) as Record<CourseTrackId, TrackCapabilityProfile>;

export const capabilityForTrack = (trackId: CourseTrackId): TrackCapabilityProfile => TRACK_CAPABILITY_MATRIX[trackId];
export const capabilityForVariety = (varietyId: VarietyId): VarietyCapabilityProfile => VARIETY_CAPABILITIES[varietyId];

export const isUsable = (status: SupportStatus): boolean => status !== 'unavailable';

/** Coarse quality prior derived from evidence status (benchmarks replace this once they exist). */
export const qualityEstimateFor = (status: SupportStatus): number | null => {
  switch (status) {
    case 'verified':
      return 0.8;
    case 'vendor_documented':
      return 0.6;
    case 'limited':
      return 0.35;
    default:
      return null;
  }
};
