/**
 * Non-speech / recognizer-hallucination gate for learner recordings (ADR-006 honesty; device QA 2026-10-19 §6.1).
 *
 * Whisper-family recognizers "transcribe" ambient noise and near-silence as stock phrases learned from subtitled video
 * ("اشتركوا في القناة", "subscribe to the channel", "Sous-titres réalisés par la communauté d'Amara.org",
 * "ご視聴ありがとうございました"). Graded as an answer, such a phrase became "partially understood" with meaning
 * confidence 0.99 and credited `speaking.intelligibility`. This module decides, from every signal actually available,
 * whether a recording contains the learner's speech. Its verdict is a typed flag (`speechDetected: false` + a
 * `NoSpeechReason`), never a silent drop: consumers answer "I didn't hear you, try again", call no meaning judge and
 * credit no skill or XP.
 *
 * Signals, in the order they are applied:
 * 1. Before any recognizer call (learner screening only):
 *    - the client's recorder metering (`RecordingSignals.peakLevelDb`), when sent, and
 *    - the server's own peak level for PCM/WAV clips (`measureWavLevels`; compressed formats are not decoded here).
 *    A take whose peak stays at or below `SILENCE_PEAK_DBFS` (−50 dBFS, 15 dB under the mobile VAD speech threshold of
 *    −35 dBFS) is silence. These signals can only make the outcome more conservative, so a forged level earns nothing.
 * 2. After the recognizer, per segment (verbose_json `segments[]`):
 *    - `no_speech_prob` above 0.8 alone (the threshold this adapter already used), or above 0.6 with
 *      `avg_logprob` ≤ −1.0 (Whisper's own skip rule in `openai/whisper` `transcribe()`) marks a segment silent;
 *    - a recognizer-reported `compression_ratio` above 2.4 (Whisper's `compression_ratio_threshold`: the decode is
 *      "too repetitive", a hallucination loop) marks a segment a failed decode, unless the expected answer is itself
 *      repetitive; a take whose every segment is a failed decode is `repetition_loop`;
 *    - a segment that is only a known hallucination phrase (below) or carries a subtitle-credit marker is dropped.
 * 3. On the remaining text:
 *    - empty / punctuation only → `empty_transcript`; only "[Music]" / "♪" style annotations → `non_speech_annotation`;
 *    - only STRONG phrases (outros, subtitle and broadcast credits) → `known_hallucination`;
 *    - only WEAK phrases (short courtesy words a recognizer also emits on silence: "Thank you.", "Merci.", "you")
 *      → `known_hallucination` ONLY with acoustic support (`no_speech_prob` ≥ 0.5, mean `avg_logprob` ≤ −1.0, or a
 *      quiet take ≤ −40 dBFS) — a clearly spoken "merci" is speech;
 *    - a repetitive decoding loop (greedy LZ ratio ≥ 3 on ≥ 24 characters, Whisper's `compression_ratio` idea) with
 *      weak acoustic support → `repetition_loop`.
 * A phrase that occurs in the text the learner was asked to say (`expectedText`) is never treated as a hallucination,
 * and one-word answers ("oui", "نعم", "はい", "yes") are never on any list.
 *
 * Signals: the OpenRouter client parser (`openrouter/client.ts`) passes `no_speech_prob`, `avg_logprob`,
 * `compression_ratio`, `duration` and `language` through. Recognizers that report no `compression_ratio` (and contract
 * segments, which do not carry it) fall back to the text's own repetition statistic below. Models that reject
 * verbose_json (plain `json`) return no segments: only the text rules then apply.
 *
 * Phrase list provenance (`HallucinationPhrase.evidence`): `observed` = seen on this project's device QA
 * (`docs/evidence/device-qa-2026-10-19.md`); `reported` = publicly reported Whisper silence hallucinations (openai/whisper
 * GitHub discussions on hallucinations during silence; Koenecke et al., "Careless Whisper: Speech-to-Text Hallucination
 * Harms", ACM FAccT 2024; community subtitle-credit lists); `pattern` = the same YouTube-outro formula in another course
 * language, added by analogy. Matching is done after `normalizeForScreening` (NFKD, marks removed, case-folded, Arabic
 * letter variants unified, punctuation and spacing ignored), so "Sous-titres réalisés par la communauté d'Amara.org"
 * and "sous titres realises par la communaute d amara org" are the same phrase.
 */
import { referenceComparisonAssessment, type NoSpeechReason, type PronunciationAssessment, type RecordingSignals, type SpeechDetection, type TranscriptResult } from '@langquest/contracts';

export const SPEECH_DETECTOR_VERSION = 'speech-gate@2026-10-20.2';

/** Model name reported when the gate answered without calling a recognizer (silent take). */
export const SPEECH_GATE_MODEL = 'langquest/speech-gate';

/** At or below this peak (dBFS) a take is silence: 15 dB under the mobile VAD speech threshold (−35 dBFS). */
export const SILENCE_PEAK_DBFS = -50;
/** At or below this peak (dBFS) nothing reached speech level; counts as acoustic support for a stock phrase. */
export const QUIET_PEAK_DBFS = -40;

export const SPEECH_GATE_THRESHOLDS = {
  /** Above this `no_speech_prob` a segment is silence whatever its log-probability (stock phrases decode confidently). */
  noSpeechProbAlone: 0.8,
  /** Whisper's own rule: `no_speech_prob` > 0.6 is silence unless `avg_logprob` > −1.0. */
  noSpeechProb: 0.6,
  logprob: -1.0,
  /** Acoustic support required before a WEAK phrase counts as a hallucination. */
  weakSupportNoSpeechProb: 0.5,
  weakSupportLogprob: -1.0,
  /** Repetition loop: greedy LZ ratio, minimum normalised length, and the (lower) acoustic support it needs. */
  repetitionRatio: 3,
  repetitionMinChars: 24,
  repetitionSupportNoSpeechProb: 0.3,
  repetitionSupportLogprob: -0.7,
  /** Whisper's `compression_ratio_threshold`: a segment above it is a failed (too repetitive) decode. */
  compressionRatio: 2.4,
} as const;

// ---------------------------------------------------------------------------
// Curated phrase lists
// ---------------------------------------------------------------------------

export interface HallucinationPhrase {
  text: string;
  /** ISO-639-1 language of the phrase (matching is language-independent; this documents the family). */
  lang: string;
  kind: 'video_outro' | 'subscribe_request' | 'subtitle_credit' | 'broadcast_credit' | 'stock_courtesy';
  evidence: 'observed' | 'reported' | 'pattern';
}

/** Never a plausible learner answer on their own: outros, subscribe requests, subtitle and broadcast credits. */
export const STRONG_HALLUCINATION_PHRASES: readonly HallucinationPhrase[] = [
  // Arabic
  { text: 'اشتركوا في القناة', lang: 'ar', kind: 'subscribe_request', evidence: 'observed' },
  { text: 'اشترك في القناة', lang: 'ar', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'لا تنسوا الاشتراك في القناة', lang: 'ar', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'شكرا للمشاهدة', lang: 'ar', kind: 'video_outro', evidence: 'pattern' },
  { text: 'شكرا على المشاهدة', lang: 'ar', kind: 'video_outro', evidence: 'pattern' },
  { text: 'ترجمة نانسي قنقر', lang: 'ar', kind: 'subtitle_credit', evidence: 'reported' },
  // English
  { text: 'subscribe to the channel', lang: 'en', kind: 'subscribe_request', evidence: 'observed' },
  { text: 'subscribe to my channel', lang: 'en', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'please subscribe', lang: 'en', kind: 'subscribe_request', evidence: 'reported' },
  { text: 'like and subscribe', lang: 'en', kind: 'subscribe_request', evidence: 'reported' },
  { text: "don't forget to like and subscribe", lang: 'en', kind: 'subscribe_request', evidence: 'pattern' },
  { text: "don't forget to subscribe", lang: 'en', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'thanks for watching', lang: 'en', kind: 'video_outro', evidence: 'reported' },
  { text: 'thank you for watching', lang: 'en', kind: 'video_outro', evidence: 'reported' },
  { text: 'thank you so much for watching', lang: 'en', kind: 'video_outro', evidence: 'pattern' },
  { text: 'see you in the next video', lang: 'en', kind: 'video_outro', evidence: 'reported' },
  { text: "i'll see you in the next video", lang: 'en', kind: 'video_outro', evidence: 'pattern' },
  { text: 'subtitles by the amara.org community', lang: 'en', kind: 'subtitle_credit', evidence: 'reported' },
  // French
  { text: "sous-titres réalisés par la communauté d'amara.org", lang: 'fr', kind: 'subtitle_credit', evidence: 'reported' },
  { text: "sous-titres réalisés para la communauté d'amara.org", lang: 'fr', kind: 'subtitle_credit', evidence: 'reported' },
  { text: "sous-titrage st' 501", lang: 'fr', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'sous-titrage société radio-canada', lang: 'fr', kind: 'broadcast_credit', evidence: 'reported' },
  { text: "merci d'avoir regardé", lang: 'fr', kind: 'video_outro', evidence: 'pattern' },
  { text: "merci d'avoir regardé cette vidéo", lang: 'fr', kind: 'video_outro', evidence: 'pattern' },
  { text: 'abonnez-vous', lang: 'fr', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'abonnez-vous à la chaîne', lang: 'fr', kind: 'subscribe_request', evidence: 'pattern' },
  { text: "n'oubliez pas de vous abonner", lang: 'fr', kind: 'subscribe_request', evidence: 'pattern' },
  // Japanese
  { text: 'ご視聴ありがとうございました', lang: 'ja', kind: 'video_outro', evidence: 'reported' },
  { text: 'ご視聴ありがとうございます', lang: 'ja', kind: 'video_outro', evidence: 'pattern' },
  { text: '最後までご視聴いただきありがとうございました', lang: 'ja', kind: 'video_outro', evidence: 'pattern' },
  { text: 'チャンネル登録お願いします', lang: 'ja', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'チャンネル登録よろしくお願いします', lang: 'ja', kind: 'subscribe_request', evidence: 'pattern' },
  // Chinese
  { text: '字幕由Amara.org社区提供', lang: 'zh', kind: 'subtitle_credit', evidence: 'reported' },
  { text: '字幕由Amara.org社群提供', lang: 'zh', kind: 'subtitle_credit', evidence: 'reported' },
  { text: '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目', lang: 'zh', kind: 'subscribe_request', evidence: 'reported' },
  { text: '請不吝點贊 訂閱 轉發 打賞支持明鏡與點點欄目', lang: 'zh', kind: 'subscribe_request', evidence: 'reported' },
  { text: '字幕by索兰娅', lang: 'zh', kind: 'subtitle_credit', evidence: 'reported' },
  { text: '谢谢观看', lang: 'zh', kind: 'video_outro', evidence: 'pattern' },
  { text: '謝謝觀看', lang: 'zh', kind: 'video_outro', evidence: 'pattern' },
  { text: '感谢观看', lang: 'zh', kind: 'video_outro', evidence: 'pattern' },
  { text: '订阅我的频道', lang: 'zh', kind: 'subscribe_request', evidence: 'pattern' },
  // Korean
  { text: 'MBC 뉴스 이덕영입니다', lang: 'ko', kind: 'broadcast_credit', evidence: 'reported' },
  { text: '시청해주셔서 감사합니다', lang: 'ko', kind: 'video_outro', evidence: 'reported' },
  { text: '구독과 좋아요 부탁드립니다', lang: 'ko', kind: 'subscribe_request', evidence: 'pattern' },
  // Spanish / Portuguese / Italian
  { text: 'subtítulos realizados por la comunidad de amara.org', lang: 'es', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'subtítulos por la comunidad de amara.org', lang: 'es', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'gracias por ver el video', lang: 'es', kind: 'video_outro', evidence: 'pattern' },
  { text: 'suscríbete al canal', lang: 'es', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'legendas pela comunidade amara.org', lang: 'pt', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'obrigado por assistir', lang: 'pt', kind: 'video_outro', evidence: 'pattern' },
  { text: 'inscreva-se no canal', lang: 'pt', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'sottotitoli creati dalla comunità amara.org', lang: 'it', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'sottotitoli a cura di qtss', lang: 'it', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'grazie per la visione', lang: 'it', kind: 'video_outro', evidence: 'pattern' },
  // German
  { text: 'untertitel im auftrag des zdf für funk', lang: 'de', kind: 'broadcast_credit', evidence: 'reported' },
  { text: 'untertitel im auftrag des zdf', lang: 'de', kind: 'broadcast_credit', evidence: 'reported' },
  { text: 'untertitelung im auftrag des zdf', lang: 'de', kind: 'broadcast_credit', evidence: 'reported' },
  { text: 'untertitel der amara.org-community', lang: 'de', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'vielen dank fürs zuschauen', lang: 'de', kind: 'video_outro', evidence: 'pattern' },
  // Russian / Ukrainian
  { text: 'субтитры сделал dimatorzok', lang: 'ru', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'субтитры создавал dimatorzok', lang: 'ru', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'редактор субтитров а.семкин корректор а.егорова', lang: 'ru', kind: 'subtitle_credit', evidence: 'reported' },
  { text: 'спасибо за просмотр', lang: 'ru', kind: 'video_outro', evidence: 'pattern' },
  { text: 'подписывайтесь на канал', lang: 'ru', kind: 'subscribe_request', evidence: 'pattern' },
  { text: 'дякую за перегляд', lang: 'uk', kind: 'video_outro', evidence: 'pattern' },
  { text: 'підписуйтесь на канал', lang: 'uk', kind: 'subscribe_request', evidence: 'pattern' },
];

/**
 * Short courtesy phrases a recognizer also emits on silence. They ARE plausible answers, so they count as a hallucination
 * only with acoustic support and never when the learner was asked to say them.
 */
export const WEAK_HALLUCINATION_PHRASES: readonly HallucinationPhrase[] = [
  { text: 'you', lang: 'en', kind: 'stock_courtesy', evidence: 'reported' },
  { text: 'thank you', lang: 'en', kind: 'stock_courtesy', evidence: 'reported' },
  { text: 'thank you very much', lang: 'en', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'thank you so much', lang: 'en', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'thanks', lang: 'en', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'bye', lang: 'en', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'see you next time', lang: 'en', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'merci', lang: 'fr', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'merci beaucoup', lang: 'fr', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'au revoir', lang: 'fr', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'à bientôt', lang: 'fr', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'شكرا', lang: 'ar', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'شكرا جزيلا', lang: 'ar', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'ありがとうございました', lang: 'ja', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'ありがとうございます', lang: 'ja', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: '谢谢', lang: 'zh', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: '謝謝', lang: 'zh', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: '谢谢大家', lang: 'zh', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: '감사합니다', lang: 'ko', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'gracias', lang: 'es', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'muchas gracias', lang: 'es', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'obrigado', lang: 'pt', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'obrigada', lang: 'pt', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'grazie', lang: 'it', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'danke', lang: 'de', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'vielen dank', lang: 'de', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'спасибо', lang: 'ru', kind: 'stock_courtesy', evidence: 'pattern' },
  { text: 'продолжение следует', lang: 'ru', kind: 'stock_courtesy', evidence: 'reported' },
  { text: 'дякую', lang: 'uk', kind: 'stock_courtesy', evidence: 'pattern' },
];

/** Subtitle-credit markers no learner says: a segment containing one is a credit line, whatever surrounds it. */
export const CREDIT_MARKERS: readonly string[] = ['amara.org', 'dimatorzok', 'castingwords', 'نانسي قنقر', '明镜与点点', '明鏡與點點'];

// ---------------------------------------------------------------------------
// Normalisation and matching
// ---------------------------------------------------------------------------

/** Script-agnostic normalisation for phrase matching (see the module comment). */
export function normalizeForScreening(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ـ/g, '')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const compact = (normalized: string): string => normalized.replace(/\s+/g, '');

export interface CompiledPhrase {
  key: string;
  compact: string;
}

const compile = (phrases: readonly HallucinationPhrase[]): CompiledPhrase[] =>
  phrases
    .map((p) => {
      const key = normalizeForScreening(p.text);
      return { key, compact: compact(key) };
    })
    .filter((p) => p.compact.length > 0)
    .sort((a, b) => b.compact.length - a.compact.length);

const STRONG = compile(STRONG_HALLUCINATION_PHRASES);
const WEAK = compile(WEAK_HALLUCINATION_PHRASES);
const MARKERS = CREDIT_MARKERS.map((m) => compact(normalizeForScreening(m))).filter(Boolean);

/** Phrases (and markers) that occur in the expected answer are never hallucinations for that attempt. */
function exempt(phrases: readonly CompiledPhrase[], expectedCompact: string): CompiledPhrase[] {
  return expectedCompact ? phrases.filter((p) => !expectedCompact.includes(p.compact)) : [...phrases];
}

/**
 * Remove every occurrence of the phrases (longest first); `covered` when nothing else remains. With `allowDigits`, a
 * leftover made only of digits still counts as covered (credit lines carry years: "… im Auftrag des ZDF für funk, 2017").
 */
export function phraseCoverage(text: string, phrases: readonly CompiledPhrase[], options: { allowDigits?: boolean } = {}): { covered: boolean; matched: string[] } {
  let rest = compact(normalizeForScreening(text));
  if (!rest) return { covered: false, matched: [] };
  const matched: string[] = [];
  for (const p of phrases) {
    if (!rest.includes(p.compact)) continue;
    rest = rest.split(p.compact).join('');
    matched.push(p.key);
    if (!rest) break;
  }
  if (options.allowDigits && matched.length > 0) rest = rest.replace(/\p{Nd}+/gu, '');
  return { covered: rest.length === 0 && matched.length > 0, matched };
}

const ANNOTATION = /\[[^\]]*\]|\([^)]*\)|（[^）]*）|【[^】]*】|\*[^*]+\*|[♪♫♬🎵🎶]/gu;
const hasAnnotation = (text: string): boolean => new RegExp(ANNOTATION.source, 'u').test(text);
const stripAnnotations = (text: string): string => text.replace(ANNOTATION, ' ').replace(/\s+/g, ' ').trim();

/**
 * Greedy LZ ratio of a text: its length over the cost of encoding it as literals (1) and back-references (3) of ≥ 4
 * characters. ≈ 1 for ordinary sentences; a decoding loop ("thank you thank you thank you …") scores ≥ 3. A cheap,
 * deterministic stand-in for Whisper's zlib `compression_ratio`, which the provider response does not surface here.
 */
export function repetitionRatio(text: string): number {
  const s = [...text.slice(0, 1000)];
  const n = s.length;
  if (n === 0) return 1;
  let i = 0;
  let cost = 0;
  while (i < n) {
    let best = 0;
    for (let j = 0; j < i; j += 1) {
      let k = 0;
      while (i + k < n && s[j + k] === s[i + k]) k += 1;
      if (k > best) best = k;
    }
    if (best >= 4) {
      cost += 3;
      i += best;
    } else {
      cost += 1;
      i += 1;
    }
  }
  return Math.round((n / cost) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Audio levels (PCM/WAV only)
// ---------------------------------------------------------------------------

export interface AudioLevels {
  peakDbfs: number;
  rmsDbfs: number;
  durationMs: number;
}

const toDbfs = (amplitude: number): number => (amplitude <= 0 ? -160 : Math.max(-160, Math.round(20 * Math.log10(amplitude / 32768) * 10) / 10));

/**
 * Peak / RMS level of a 16-bit PCM RIFF/WAVE clip; null for anything else (compressed formats, other bit depths,
 * malformed headers) — those are never judged on level here.
 */
export function measureWavLevels(bytes: Uint8Array): AudioLevels | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number): string => String.fromCharCode(bytes[o] ?? 0, bytes[o + 1] ?? 0, bytes[o + 2] ?? 0, bytes[o + 3] ?? 0);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: { start: number; length: number } | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'data') {
      data = { start: body, length: Math.min(size, bytes.byteLength - body) };
      break;
    }
    if (body + size > bytes.byteLength) return null;
    if (id === 'fmt ') {
      if (size < 16) return null;
      let format = view.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
      fmt = { format, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.rate <= 0) return null;
  const samples = Math.floor(data.length / 2);
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < samples; i += 1) {
    const v = view.getInt16(data.start + i * 2, true);
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
  }
  return { peakDbfs: toDbfs(peak), rmsDbfs: toDbfs(samples ? Math.sqrt(sumSq / samples) : 0), durationMs: Math.round((samples / fmt.channels / fmt.rate) * 1000) };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** One recognizer segment as the gate sees it (`TranscriptionSegment` or a contract segment, see `speechDetectionOf`). */
export interface DetectorSegment {
  text: string;
  noSpeechProb: number | null;
  avgLogprob: number | null;
  /** Recognizer-reported gzip `compression_ratio` of the segment text (Whisper verbose_json); absent / null when not reported. */
  compressionRatio?: number | null;
}

export interface SpeechDetectionInput {
  text: string;
  segments: readonly DetectorSegment[];
  durationMs?: number | null;
  detectedLanguage?: string | null;
  /** What the learner was asked to say: a stock phrase it contains is never treated as a hallucination. */
  expectedText?: string | null;
  audioLevels?: AudioLevels | null;
  client?: RecordingSignals | null;
}

export interface SpeechSignals {
  segments: number;
  silentSegments: number;
  maxNoSpeechProb: number | null;
  meanAvgLogprob: number | null;
  repetitionRatio: number | null;
  /** Highest recognizer-reported `compression_ratio` over the segments (null when none reported one). */
  maxCompressionRatio: number | null;
  /** Segments dropped as failed (too repetitive) decodes by their `compression_ratio`. */
  loopSegments: number;
  durationMs: number | null;
  detectedLanguage: string | null;
  audioPeakDbfs: number | null;
  clientPeakDbfs: number | null;
}

/** The gate's full verdict (the contract `SpeechDetection` plus what the server needs to act on it). */
export interface SpeechScreening extends SpeechDetection {
  /** Text credited as the learner's speech ('' when none): dropped segments and annotations removed. */
  text: string;
  /** Segment indices removed as silence or hallucination while the rest was speech. */
  droppedSegments: number[];
  /** Normalised phrases / markers that matched. */
  matchedPhrases: string[];
  /** Recognizer output that was not credited (kept for tests and support tooling; never graded, shown or logged). */
  discardedText: string | null;
  signals: SpeechSignals;
  detectorVersion: string;
}

/** Contract-level verdict for API responses. */
export const toSpeechDetection = (s: Pick<SpeechScreening, 'speechDetected' | 'reason'>): SpeechDetection => ({ speechDetected: s.speechDetected, reason: s.speechDetected ? null : s.reason });

const emptySignals = (input: Partial<SpeechDetectionInput>): SpeechSignals => ({
  segments: input.segments?.length ?? 0,
  silentSegments: 0,
  maxNoSpeechProb: null,
  meanAvgLogprob: null,
  repetitionRatio: null,
  maxCompressionRatio: null,
  loopSegments: 0,
  durationMs: input.durationMs ?? input.audioLevels?.durationMs ?? null,
  detectedLanguage: input.detectedLanguage ?? null,
  audioPeakDbfs: input.audioLevels?.peakDbfs ?? null,
  clientPeakDbfs: input.client?.peakLevelDb ?? null,
});

function noSpeech(reason: NoSpeechReason, discarded: string | null | undefined, signals: SpeechSignals, matchedPhrases: string[] = []): SpeechScreening {
  const d = discarded?.trim();
  return { speechDetected: false, reason, text: '', droppedSegments: [], matchedPhrases, discardedText: d ? d : null, signals, detectorVersion: SPEECH_DETECTOR_VERSION };
}

const isSilentSegment = (s: DetectorSegment): boolean => {
  const p = s.noSpeechProb;
  if (p === null || !Number.isFinite(p)) return false;
  if (p > SPEECH_GATE_THRESHOLDS.noSpeechProbAlone) return true;
  return p > SPEECH_GATE_THRESHOLDS.noSpeechProb && (s.avgLogprob === null || s.avgLogprob <= SPEECH_GATE_THRESHOLDS.logprob);
};

/** A failed decode by the recognizer's own repetition measure (Whisper `compression_ratio` > 2.4). */
const isLoopSegment = (s: DetectorSegment): boolean => typeof s.compressionRatio === 'number' && Number.isFinite(s.compressionRatio) && s.compressionRatio > SPEECH_GATE_THRESHOLDS.compressionRatio;

const quietTake = (levels: AudioLevels | null | undefined, client: RecordingSignals | null | undefined): boolean =>
  (levels !== null && levels !== undefined && levels.peakDbfs <= QUIET_PEAK_DBFS) || (typeof client?.peakLevelDb === 'number' && client.peakLevelDb <= QUIET_PEAK_DBFS);

/**
 * Pre-recognizer gate: a take the client metering or the server's PCM level measure as silent. Null when neither signal
 * says so (including when neither is available) — the recognizer then runs.
 */
export function preflightSpeech(input: { audioLevels?: AudioLevels | null; client?: RecordingSignals | null; durationMs?: number | null }): SpeechScreening | null {
  const signals = emptySignals(input);
  if (typeof input.client?.peakLevelDb === 'number' && input.client.peakLevelDb <= SILENCE_PEAK_DBFS) return noSpeech('client_silence', null, signals);
  if (input.audioLevels && input.audioLevels.peakDbfs <= SILENCE_PEAK_DBFS) return noSpeech('silent_audio', null, signals);
  return null;
}

/** Remove dropped segment texts from the full text (exact substrings); fall back to joining the kept segments. */
function creditedText(raw: string, segments: readonly DetectorSegment[], dropped: ReadonlySet<number>): string {
  if (!dropped.size) return raw;
  let text = raw;
  for (const i of dropped) {
    const t = segments[i]?.text.trim();
    if (!t) continue;
    if (!text.includes(t)) {
      const kept = segments.filter((_, k) => !dropped.has(k)).map((s) => s.text.trim()).filter(Boolean);
      const spaced = kept.some((k) => /\s/.test(k)) || /\s/.test(raw);
      return kept.join(spaced ? ' ' : '');
    }
    text = text.replace(t, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Decide whether a transcription is the learner's speech. Pure and deterministic. */
export function detectSpeech(input: SpeechDetectionInput): SpeechScreening {
  const pre = preflightSpeech(input);
  if (pre) return { ...pre, discardedText: input.text.trim() || null };
  const raw = input.text ?? '';
  const segments = input.segments ?? [];
  const nsp = segments.map((s) => s.noSpeechProb).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const lps = segments.map((s) => s.avgLogprob).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const crs = segments.map((s) => s.compressionRatio).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const signals: SpeechSignals = {
    ...emptySignals(input),
    maxNoSpeechProb: nsp.length ? Math.max(...nsp) : null,
    meanAvgLogprob: lps.length ? Math.max(-100, lps.reduce((a, b) => a + b, 0) / lps.length) : null,
    maxCompressionRatio: crs.length ? Math.max(...crs) : null,
  };
  const expectedCompact = compact(normalizeForScreening(input.expectedText ?? ''));
  // A repetitive expected answer (a drill that asks for a phrase several times) would legitimately decode with a high
  // compression ratio, so the recognizer's ratio is then not evidence of a loop.
  const expectedRepetitive = expectedCompact.length > 0 && repetitionRatio(normalizeForScreening(input.expectedText ?? '')) >= SPEECH_GATE_THRESHOLDS.repetitionRatio;
  const strong = exempt(STRONG, expectedCompact);
  const both = exempt([...STRONG, ...WEAK].sort((a, b) => b.compact.length - a.compact.length), expectedCompact);
  const markers = expectedCompact ? MARKERS.filter((m) => !expectedCompact.includes(m)) : MARKERS;
  const matched: string[] = [];
  const isCredit = (text: string): boolean => {
    const c = compact(normalizeForScreening(text));
    const marker = markers.find((m) => c.includes(m));
    if (marker) matched.push(marker);
    return marker !== undefined;
  };

  if (!normalizeForScreening(raw)) return noSpeech(hasAnnotation(raw) ? 'non_speech_annotation' : 'empty_transcript', raw, signals);

  // Segment level: silence by the recognizer's own signals, and whole-segment hallucinations / credit lines.
  const dropped = new Set<number>();
  let silent = 0;
  let hallucinated = 0;
  let loops = 0;
  segments.forEach((s, i) => {
    if (isSilentSegment(s)) {
      silent += 1;
      dropped.add(i);
      return;
    }
    if (!expectedRepetitive && isLoopSegment(s)) {
      loops += 1;
      dropped.add(i);
      return;
    }
    const text = stripAnnotations(s.text);
    if (!normalizeForScreening(text)) {
      dropped.add(i);
      return;
    }
    const cov = phraseCoverage(text, strong, { allowDigits: true });
    if (cov.covered || isCredit(text)) {
      hallucinated += 1;
      matched.push(...cov.matched);
      dropped.add(i);
    }
  });
  signals.silentSegments = silent;
  signals.loopSegments = loops;
  if (segments.length > 0 && dropped.size === segments.length) {
    const reason: NoSpeechReason = silent === segments.length ? 'no_speech_probability' : hallucinated > 0 ? 'known_hallucination' : loops > 0 ? 'repetition_loop' : 'non_speech_annotation';
    return noSpeech(reason, raw, signals, [...new Set(matched)]);
  }

  // Whole-text level on what remains.
  const text = stripAnnotations(creditedText(raw, segments, dropped));
  const normalized = normalizeForScreening(text);
  if (!normalized) return noSpeech(hasAnnotation(raw) ? 'non_speech_annotation' : 'empty_transcript', raw, signals);
  signals.repetitionRatio = repetitionRatio(normalized);
  if (segments.length === 0 && isCredit(text)) return noSpeech('known_hallucination', raw, signals, [...new Set(matched)]);
  const strongCov = phraseCoverage(text, strong, { allowDigits: true });
  if (strongCov.covered) return noSpeech('known_hallucination', raw, signals, [...new Set([...matched, ...strongCov.matched])]);

  const kept = segments.filter((_, i) => !dropped.has(i));
  const keptNsp = kept.map((s) => s.noSpeechProb).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const keptLps = kept.map((s) => s.avgLogprob).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const maxNsp = keptNsp.length ? Math.max(...keptNsp) : null;
  const meanLp = keptLps.length ? keptLps.reduce((a, b) => a + b, 0) / keptLps.length : null;
  const quiet = quietTake(input.audioLevels, input.client);
  const weakSupport = quiet || (maxNsp !== null && maxNsp >= SPEECH_GATE_THRESHOLDS.weakSupportNoSpeechProb) || (meanLp !== null && meanLp <= SPEECH_GATE_THRESHOLDS.weakSupportLogprob);
  const weakCov = phraseCoverage(text, both);
  if (weakCov.covered && weakSupport) return noSpeech('known_hallucination', raw, signals, [...new Set([...matched, ...weakCov.matched])]);

  const loopSupport = quiet || (maxNsp !== null && maxNsp >= SPEECH_GATE_THRESHOLDS.repetitionSupportNoSpeechProb) || (meanLp !== null && meanLp <= SPEECH_GATE_THRESHOLDS.repetitionSupportLogprob);
  if (normalized.length >= SPEECH_GATE_THRESHOLDS.repetitionMinChars && signals.repetitionRatio >= SPEECH_GATE_THRESHOLDS.repetitionRatio && loopSupport) return noSpeech('repetition_loop', raw, signals);

  const discarded = dropped.size ? segments.filter((_, i) => dropped.has(i)).map((s) => s.text.trim()).filter(Boolean).join(' ') : null;
  return { speechDetected: true, reason: null, text, droppedSegments: [...dropped].sort((a, b) => a - b), matchedPhrases: [...new Set(matched)], discardedText: discarded || null, signals, detectorVersion: SPEECH_DETECTOR_VERSION };
}

// ---------------------------------------------------------------------------
// Transcript helpers for consumers
// ---------------------------------------------------------------------------

/** A transcript with the gate's verdict attached (what `OpenRouterSpeechRecognizer.transcribe` returns). */
export type ScreenedTranscriptResult = TranscriptResult & { speech: SpeechScreening };

/** How a recognizer applies the gate: `learner` blanks non-speech (attempts, turns); `annotate` only attaches it. */
export type SpeechScreeningMode = 'learner' | 'annotate';

export interface SpeechScreeningOptions {
  /** Default `annotate` (content transcription keeps its legacy behaviour); learner-facing callers pass `learner`. */
  screening?: SpeechScreeningMode;
  /** Text the learner was asked to say (repeat / anticipation steps). */
  expectedText?: string | null;
  /** Recorder metering sent with the take. */
  clientSignals?: RecordingSignals | null;
}

const isScreening = (value: unknown): value is SpeechScreening =>
  typeof value === 'object' && value !== null && typeof (value as SpeechScreening).speechDetected === 'boolean' && typeof (value as SpeechScreening).detectorVersion === 'string' && typeof (value as SpeechScreening).text === 'string';

/** Contract segment → detector segment (`confidence` is exp(avg_logprob); no-speech probability is not carried). */
const fromContractSegment = (s: TranscriptResult['segments'][number]): DetectorSegment => ({ text: s.text, noSpeechProb: null, avgLogprob: s.confidence === null ? null : s.confidence > 0 ? Math.log(s.confidence) : -100 });

/**
 * The gate verdict for a transcript: the one the recognizer attached, or (for recognizers that do not screen, e.g. a
 * fake or an acoustic assessor's own transcript) one computed from the contract fields alone. Null transcript = nothing heard.
 */
export function speechDetectionOf(transcript: TranscriptResult | null | undefined, options: { expectedText?: string | null; client?: RecordingSignals | null } = {}): SpeechScreening {
  if (!transcript) return noSpeech('empty_transcript', null, emptySignals({ client: options.client ?? null }));
  const attached = (transcript as Partial<ScreenedTranscriptResult>).speech;
  if (isScreening(attached)) return attached;
  return detectSpeech({
    text: transcript.text ?? '',
    segments: (transcript.segments ?? []).map(fromContractSegment),
    durationMs: transcript.durationMs ?? null,
    detectedLanguage: transcript.detectedLanguage?.code ?? null,
    expectedText: options.expectedText ?? null,
    client: options.client ?? null,
  });
}

/**
 * Transcripts `applySpeechScreening` produced, keyed to the verdict applied. `droppedSegments` are indices into the
 * recognizer's ORIGINAL segment list, so applying the same verdict again to an already-reduced transcript would drop the
 * wrong (genuine) segments whenever a dropped one was not the last. The learner-mode recognizer applies its verdict
 * and the consumers (reference comparison, the speech and conversation routes) apply `speechDetectionOf(heard)` again
 * for recognizers that do not screen; this registry makes that second call a no-op. Identity-based on purpose: an
 * `annotate`-mode transcript carries the same verdict but its segments are NOT reduced, so it must still be screened.
 */
const SCREENED = new WeakMap<object, SpeechScreening>();

/**
 * The transcript a consumer may grade: blanked when no speech, otherwise reduced to the credited text and segments.
 * Idempotent: a transcript this function already reduced with the same verdict is returned as is.
 */
export function applySpeechScreening(transcript: TranscriptResult, screening: SpeechScreening): ScreenedTranscriptResult {
  if (SCREENED.get(transcript) === screening) return transcript as ScreenedTranscriptResult;
  const result = reduceTranscript(transcript, screening);
  SCREENED.set(result, screening);
  return result;
}

function reduceTranscript(transcript: TranscriptResult, screening: SpeechScreening): ScreenedTranscriptResult {
  if (!screening.speechDetected) return { ...transcript, text: '', segments: [], confidence: null, detectedLanguage: null, languageMismatch: false, speech: screening };
  if (!screening.droppedSegments.length) return { ...transcript, text: screening.text, speech: screening };
  const dropped = new Set(screening.droppedSegments);
  const segments = (transcript.segments ?? []).filter((s, i) => !dropped.has(i));
  const confidences = segments.map((s) => s.confidence).filter((c): c is number => c !== null);
  const confidence = confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000 : transcript.confidence;
  return { ...transcript, text: screening.text, segments, confidence, speech: screening };
}

/** Honest pronunciation block for a take without speech: nothing was assessed, so no score, no word list, no tips. */
export function noSpeechAssessment(provider: string | null, scorerVersion: string | null): PronunciationAssessment {
  return { ...referenceComparisonAssessment(['feedback.no_speech_detected']), assessmentMode: 'unavailable', confidence: 'none', provider, scorerVersion };
}
