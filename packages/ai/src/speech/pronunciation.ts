/**
 * Pronunciation assessors (§3.6, §8.5):
 * - `AzurePronunciationAssessor` — real REST implementation of Azure Speech scripted pronunciation
 *   assessment (`Pronunciation-Assessment` header); enabled only with `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`;
 *   `supports()` answers from the 33-locale table — never for ary / rw / ln / ht / Levantine.
 * - `ReferenceComparisonAssessor` — STT + semantic comparison + reference audio pointer; always
 *   `numericScore: null`, `assessmentMode: 'reference-comparison'`, `confidence: 'limited'`.
 * - `CompositeAssessor` — picks the acoustic assessor when (and only when) it genuinely supports the locale.
 *
 * Non-speech gate (`./speech-detection`): the reference-comparison path transcribes with `screening: 'learner'`; a take
 * without speech (silence, a recognizer hallucination such as "Sous-titres réalisés par la communauté d'Amara.org")
 * yields an empty transcript carrying the typed verdict and an `unavailable` pronunciation block — never a comparison
 * against the reference, never a score.
 */
import {
  PronunciationResultSchema,
  referenceComparisonAssessment,
  unsupportedCapability,
  type Capability,
  type PronunciationAssessor,
  type PronunciationFeature,
  type PronunciationInput,
  type PronunciationResult,
  type SpeechRecognizer,
  type TranscriptResult,
  type VarietyId,
  type WordScore,
} from '@langquest/contracts';
import { findAzurePronunciationLocale } from '../capability/azure-locales';
import { capabilityForVariety } from '../capability/matrix';
import { providerLocaleFor, resolveVariety, varietyBoundaryViolation } from '../capability/registry';
import { AiCapabilityError, AiProviderUnavailableError } from '../errors';
import { resolveAttribution, type AiAttributionSource, type AiRequestSink } from '../reasoner';
import { scoreAgainstReference, tokenize, normalizeForMeaning } from '../semantic/meaning';
import { bytesToBase64, clamp, newId, nowIso } from '../util';
import { resolveAudioBytes, type AudioAssetResolver } from './audio-input';
import { applySpeechScreening, noSpeechAssessment, speechDetectionOf, type ScreenedTranscriptResult, type SpeechScreeningOptions } from './speech-detection';

/** Per-call options for assessors that screen the take: recorder metering, plus cost attribution of the STT call. */
export interface PronunciationAssessOptions {
  clientSignals?: SpeechScreeningOptions['clientSignals'];
  traceId?: string;
  enrollmentId?: string | null;
}

/** A recognizer the reference comparison can ask for learner screening (any contract `SpeechRecognizer` fits). */
export interface ScreeningSpeechRecognizer {
  readonly provider: string;
  supports: SpeechRecognizer['supports'];
  transcribe(audio: PronunciationInput['audio'], locale: string, options?: SpeechScreeningOptions & { traceId?: string; enrollmentId?: string | null }): Promise<TranscriptResult>;
}

/** A pronunciation assessor that may take per-call options (any contract `PronunciationAssessor` fits). */
export interface ScreeningPronunciationAssessor extends Omit<PronunciationAssessor, 'assess'> {
  assess(input: PronunciationInput, options?: PronunciationAssessOptions): Promise<PronunciationResult>;
}

/** Assessor result whose transcript carries the non-speech gate verdict (`speechDetectionOf` reads it). */
export type ScreenedPronunciationResult = Omit<PronunciationResult, 'transcript'> & { transcript: ScreenedTranscriptResult | TranscriptResult | null };

// ---------------------------------------------------------------------------
// Azure
// ---------------------------------------------------------------------------

export interface AzurePronunciationAssessorOptions {
  key: string | null | undefined;
  region: string | null | undefined;
  fetch?: typeof fetch;
  assetResolver?: AudioAssetResolver;
  sink?: AiRequestSink;
  timeoutMs?: number;
  /** Override the endpoint (tests / sovereign clouds). */
  endpointBase?: string;
  /** Attribution for `ai_requests` rows (learner id, DB profile id). Default: pseudonymous. */
  attribution?: AiAttributionSource | null;
}

/** Subset of Azure's `format=detailed` JSON with pronunciation assessment enabled. Exported for fixtures. */
export interface AzureDetailedResponse {
  RecognitionStatus: string;
  DisplayText?: string;
  Offset?: number;
  Duration?: number;
  NBest?: Array<{
    Confidence?: number;
    Lexical?: string;
    Display?: string;
    PronunciationAssessment?: { AccuracyScore?: number; FluencyScore?: number; CompletenessScore?: number; PronScore?: number; ProsodyScore?: number };
    Words?: Array<{
      Word: string;
      Offset?: number;
      Duration?: number;
      PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string; Feedback?: { Prosody?: { Break?: { ErrorTypes?: string[] }; Intonation?: { ErrorTypes?: string[] } } } };
      Phonemes?: Array<{ Phoneme: string; PronunciationAssessment?: { AccuracyScore?: number } }>;
    }>;
  }>;
}

const ticksToMs = (ticks: number | undefined): number | null => (typeof ticks === 'number' ? Math.round(ticks / 10_000) : null);

/** Azure locale for a variety when the 33-locale list covers it (regional preference honoured when it is also listed). */
export function azureLocaleForVariety(variety: VarietyId, regionalPreference?: string | null): string | null {
  const documented = capabilityForVariety(variety).pronunciation.azureLocale;
  if (!documented) return null;
  if (regionalPreference) {
    const candidate = providerLocaleFor(variety, regionalPreference);
    if (findAzurePronunciationLocale(candidate) && resolveVariety(candidate) === variety) return candidate;
  }
  return documented;
}

export class AzurePronunciationAssessor implements PronunciationAssessor {
  readonly provider = 'azure_speech';
  private readonly key: string | null;
  private readonly region: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly assetResolver: AudioAssetResolver | undefined;
  private readonly sink: AiRequestSink | null;
  private readonly timeoutMs: number;
  private readonly endpointBase: string | null;
  private readonly attribution: AiAttributionSource | null;

  constructor(options: AzurePronunciationAssessorOptions) {
    this.attribution = options.attribution ?? null;
    this.key = options.key || null;
    this.region = options.region || null;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.assetResolver = options.assetResolver;
    this.sink = options.sink ?? null;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.endpointBase = options.endpointBase ?? null;
  }

  get enabled(): boolean {
    return Boolean(this.key && this.region);
  }

  async capability(locale: string): Promise<Capability> {
    const variety = resolveVariety(locale);
    if (!variety) return unsupportedCapability(this.provider, ['locale_unsupported'], [`Unknown or ambiguous locale: ${locale}`]);
    const pron = capabilityForVariety(variety).pronunciation;
    const azureLocale = azureLocaleForVariety(variety, locale.toLowerCase() === variety.toLowerCase() ? null : locale);
    if (!azureLocale) return unsupportedCapability(this.provider, ['locale_unsupported'], [pron.phoneme.evidence]);
    const boundary = varietyBoundaryViolation(this.provider, variety, azureLocale);
    if (boundary) return boundary;
    if (!this.enabled) return unsupportedCapability(this.provider, ['provider_disabled'], ['AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured']);
    const row = findAzurePronunciationLocale(azureLocale);
    const limited = pron.phoneme.status === 'limited';
    return {
      supported: true,
      reasons: limited ? ['not_benchmarked'] : [],
      features: { word: true, phoneme: true, tone: pron.tone.status !== 'unavailable', prosody: Boolean(row?.prosody) && pron.prosody.status !== 'unavailable', streaming: false, interruptible: false, codeSwitch: false, multiSpeaker: false },
      latencyClass: 'interactive',
      effectiveLocale: azureLocale,
      qualityEstimate: limited ? 0.4 : 0.7,
      provider: this.provider,
      notes: [pron.phoneme.evidence, ...(limited ? [pron.phoneme.evidence] : [])],
    };
  }

  async supports(locale: string, feature: PronunciationFeature): Promise<boolean> {
    const cap = await this.capability(locale);
    return cap.supported && cap.features[feature];
  }

  async assess(input: PronunciationInput): Promise<PronunciationResult> {
    const cap = await this.capability(input.locale);
    if (!cap.supported || !cap.effectiveLocale) throw new AiCapabilityError(`Azure pronunciation assessment unavailable for ${input.locale}`, cap, input.locale);
    if (resolveVariety(cap.effectiveLocale) !== input.targetVarietyId) {
      throw new AiCapabilityError(`Refusing to assess ${input.targetVarietyId} with Azure locale ${cap.effectiveLocale}`, cap, input.locale);
    }
    const audio = await resolveAudioBytes(input.audio, { assetResolver: this.assetResolver, fetch: this.fetchImpl });
    if (audio.format !== 'wav') throw new AiCapabilityError('Azure scripted assessment requires 16 kHz PCM WAV input', cap, input.locale);
    const wantProsody = input.requestedFeatures.includes('prosody') && cap.features.prosody;
    const paramsJson = JSON.stringify({
      ReferenceText: input.referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
      EnableMiscue: true,
      ...(wantProsody ? { EnableProsodyAssessment: true } : {}),
      ...(input.referencePhonemes ? { PhonemeAlphabet: 'IPA' } : {}),
    });
    const base = this.endpointBase ?? `https://${this.region}.stt.speech.microsoft.com`;
    const url = `${base}/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(cap.effectiveLocale)}&format=detailed`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const traceId = newId();
    const startedAt = Date.now();
    let json: AzureDetailedResponse;
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.key ?? '',
          'Pronunciation-Assessment': bytesToBase64(new TextEncoder().encode(paramsJson)),
          'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${audio.sampleRateHz ?? 16_000}`,
          Accept: 'application/json',
        },
        body: audio.bytes as BodyInit,
        signal: controller.signal,
      });
      if (!res.ok) {
        await this.record(traceId, cap.effectiveLocale, Date.now() - startedAt, false, `http_${res.status}`, input);
        throw new AiProviderUnavailableError(`Azure Speech responded ${res.status}`, this.provider);
      }
      json = (await res.json()) as AzureDetailedResponse;
    } catch (error) {
      if (error instanceof AiProviderUnavailableError) throw error;
      await this.record(traceId, cap.effectiveLocale, Date.now() - startedAt, false, controller.signal.aborted ? 'timeout' : 'network', input);
      throw new AiProviderUnavailableError('Azure Speech request failed', this.provider, { cause: error });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - startedAt;
    await this.record(traceId, cap.effectiveLocale, latencyMs, true, null, input);
    return mapAzureResponse(json, input, cap.effectiveLocale, latencyMs, this.provider, wantProsody);
  }

  private async record(traceId: string, locale: string, latencyMs: number, success: boolean, errorCode: string | null, input: PronunciationInput): Promise<void> {
    if (!this.sink) return;
    const attribution = resolveAttribution(this.attribution);
    await this.sink.record({
      occurredAt: nowIso(),
      userId: attribution.userId,
      enrollmentId: attribution.enrollmentId,
      task: 'pronunciation_assessment',
      provider: this.provider,
      model: `azure:scripted:${locale}`,
      profileId: attribution.profileId,
      fallbackIndex: 0,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      audioSeconds: null,
      estimatedCostUsd: null,
      success,
      errorCode,
      traceId,
      redactedLog: { locale, referenceChars: input.referenceText.length, features: input.requestedFeatures },
    });
  }
}

/** Map Azure detailed output to the contract (acoustic mode; numeric scores are real). Exported for fixture tests. */
export function mapAzureResponse(json: AzureDetailedResponse, input: PronunciationInput, locale: string, latencyMs: number, provider: string, prosodyRequested: boolean): PronunciationResult {
  const best = json.NBest?.[0];
  if (json.RecognitionStatus !== 'Success' || !best) {
    const noSpeech = json.RecognitionStatus === 'NoMatch' || json.RecognitionStatus === 'InitialSilenceTimeout';
    return PronunciationResultSchema.parse({
      targetVarietyId: input.targetVarietyId,
      locale,
      transcript: null,
      pronunciation: { ...referenceComparisonAssessment([noSpeech ? 'feedback.no_speech_detected' : 'feedback.assessment_unavailable_retry']), assessmentMode: 'unavailable', confidence: 'none', provider, scorerVersion: 'azure-scripted-v1' },
      latencyMs,
    });
  }
  const pa = best.PronunciationAssessment ?? {};
  const wordScores: WordScore[] = (best.Words ?? []).map((w) => {
    const err = (w.PronunciationAssessment?.ErrorType ?? 'None').toLowerCase();
    const errorType: WordScore['errorType'] = err === 'none' ? 'none' : err === 'mispronunciation' ? 'mispronunciation' : err === 'omission' ? 'omission' : err === 'insertion' ? 'insertion' : err === 'unexpectedbreak' ? 'unexpected_break' : err === 'missingbreak' ? 'missing_break' : err === 'monotone' ? 'monotone' : 'none';
    return { word: w.Word, startMs: ticksToMs(w.Offset), endMs: w.Offset !== undefined && w.Duration !== undefined ? ticksToMs(w.Offset + w.Duration) : null, accuracy: w.PronunciationAssessment?.AccuracyScore ?? null, errorType };
  });
  const phonemeHints = (best.Words ?? []).flatMap((w) =>
    (w.Phonemes ?? [])
      .filter((p) => (p.PronunciationAssessment?.AccuracyScore ?? 100) < 60)
      .map((p) => ({ phoneme: p.Phoneme, word: w.Word, accuracy: p.PronunciationAssessment?.AccuracyScore ?? null, guidanceKey: null })),
  );
  const weakest = [...wordScores].filter((w) => w.accuracy !== null).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0];
  const highlighted = weakest && (weakest.accuracy ?? 100) < 70 && weakest.startMs !== null && weakest.endMs !== null ? { startMs: weakest.startMs, endMs: weakest.endMs, text: weakest.word } : null;
  const confidence = (best.Confidence ?? 0) >= 0.75 ? 'high' : (best.Confidence ?? 0) >= 0.5 ? 'medium' : 'limited';
  const featuresAssessed: PronunciationFeature[] = ['word', 'phoneme', ...(prosodyRequested && pa.ProsodyScore !== undefined ? ['prosody' as const] : [])];
  const feedback: string[] = [];
  if ((pa.PronScore ?? 0) >= 80) feedback.push('feedback.pronunciation_clear');
  else if (highlighted) feedback.push(`feedback.focus_word:${highlighted.text}`);
  if ((pa.CompletenessScore ?? 100) < 70) feedback.push('feedback.some_words_missing');
  if (prosodyRequested && pa.ProsodyScore !== undefined && pa.ProsodyScore < 60) feedback.push('feedback.listen_to_rhythm');
  const transcript: TranscriptResult = {
    text: best.Display ?? json.DisplayText ?? '',
    segments: [],
    confidence: best.Confidence !== undefined ? clamp(best.Confidence, 0, 1) : null,
    detectedLanguage: null,
    requestedLocale: locale,
    provider,
    model: 'azure:scripted',
    durationMs: ticksToMs(json.Duration),
    languageMismatch: false,
  };
  return PronunciationResultSchema.parse({
    targetVarietyId: input.targetVarietyId,
    locale,
    transcript,
    pronunciation: {
      assessmentMode: 'acoustic-assessor',
      numericScore: pa.PronScore ?? pa.AccuracyScore ?? null,
      confidence,
      feedback: feedback.slice(0, 5),
      featuresAssessed,
      wordScores,
      phonemeHints: phonemeHints.slice(0, 12),
      toneHints: [],
      highlightedSegment: highlighted,
      provider,
      scorerVersion: 'azure-scripted-v1',
    },
    latencyMs,
  });
}

// ---------------------------------------------------------------------------
// Reference comparison (honest fallback)
// ---------------------------------------------------------------------------

export interface ReferenceAudioPointer {
  assetId: string | null;
  url: string | null;
  /** Human-reviewed phonetic tips for this expression (§8.5). */
  phoneticTips: readonly string[];
  humanCalibrated: boolean;
}

export interface ReferenceAudioResolver {
  forExpression(expressionId: string | null, referenceText: string, variety: VarietyId): Promise<ReferenceAudioPointer | null>;
}

export interface ReferenceComparisonAssessorOptions {
  recognizer: ScreeningSpeechRecognizer;
  referenceAudio?: ReferenceAudioResolver;
  /** Below this STT confidence, feedback asks for a retry instead of judging (§15). */
  lowConfidence?: number;
}

/**
 * Never produces numeric scores. Uses STT + lexical/semantic comparison against the reference text to give
 * actionable but honest feedback keys plus a pointer to the authentic reference audio.
 */
export class ReferenceComparisonAssessor implements PronunciationAssessor {
  readonly provider = 'reference_comparison';
  private readonly recognizer: ScreeningSpeechRecognizer;
  private readonly referenceAudio: ReferenceAudioResolver | null;
  private readonly lowConfidence: number;

  constructor(options: ReferenceComparisonAssessorOptions) {
    this.recognizer = options.recognizer;
    this.referenceAudio = options.referenceAudio ?? null;
    this.lowConfidence = options.lowConfidence ?? 0.35;
  }

  async capability(locale: string): Promise<Capability> {
    const stt = await this.recognizer.supports(locale);
    if (!stt.supported) return { ...stt, provider: this.provider };
    return {
      supported: true,
      reasons: ['feature_unsupported'],
      features: { word: true, phoneme: false, tone: false, prosody: false, streaming: false, interruptible: false, codeSwitch: stt.features.codeSwitch, multiSpeaker: false },
      latencyClass: 'interactive',
      effectiveLocale: stt.effectiveLocale,
      qualityEstimate: null,
      provider: this.provider,
      notes: ['Reference comparison: no acoustic scorer; numericScore is always null (§8.5).', ...stt.notes],
    };
  }

  async supports(locale: string, feature: PronunciationFeature): Promise<boolean> {
    const cap = await this.capability(locale);
    return cap.supported && cap.features[feature];
  }

  async assess(input: PronunciationInput, options: PronunciationAssessOptions = {}): Promise<ScreenedPronunciationResult> {
    const startedAt = Date.now();
    const cap = await this.capability(input.locale);
    if (!cap.supported) throw new AiCapabilityError(`No recognizer available for ${input.locale}`, cap, input.locale);
    const clientSignals = options.clientSignals ?? null;
    const heard = await this.recognizer.transcribe(input.audio, input.locale, { screening: 'learner', expectedText: input.referenceText, clientSignals, ...(options.traceId ? { traceId: options.traceId } : {}), ...(options.enrollmentId !== undefined ? { enrollmentId: options.enrollmentId } : {}) });
    // The recognizer's own verdict when it screens; otherwise one computed from the transcript (fakes, other adapters).
    const speech = speechDetectionOf(heard, { expectedText: input.referenceText, client: clientSignals });
    const transcript = applySpeechScreening(heard, speech);
    if (!speech.speechDetected) {
      const parsed = PronunciationResultSchema.parse({ targetVarietyId: input.targetVarietyId, locale: input.locale, transcript, pronunciation: noSpeechAssessment(this.provider, 'reference-comparison-v1'), latencyMs: Date.now() - startedAt });
      return { ...parsed, transcript: parsed.transcript ? { ...parsed.transcript, speech } : null };
    }
    const pointer = this.referenceAudio ? await this.referenceAudio.forExpression(input.expressionId, input.referenceText, input.targetVarietyId) : null;
    const { score } = scoreAgainstReference(transcript.text, input.referenceText, input.targetVarietyId);
    const refTokens = tokenize(normalizeForMeaning(input.referenceText, input.targetVarietyId));
    const heardTokens = new Set(tokenize(normalizeForMeaning(transcript.text, input.targetVarietyId)));
    const missing = refTokens.filter((t) => !heardTokens.has(t));

    const feedback: string[] = [];
    const lowConfidence = transcript.confidence !== null && transcript.confidence < this.lowConfidence;
    if (!transcript.text.trim()) feedback.push('feedback.no_speech_detected');
    else if (lowConfidence) feedback.push('feedback.unclear_recording_retry');
    else if (transcript.languageMismatch) feedback.push('feedback.sounded_like_other_language');
    else if (score >= 0.85) feedback.push('feedback.meaning_came_across', 'feedback.compare_with_reference_rhythm');
    else if (score >= 0.5) feedback.push('feedback.mostly_there', ...(missing.length ? [`feedback.missing_words:${missing.slice(0, 3).join(' ')}`] : []));
    else feedback.push('feedback.listen_and_try_again');
    feedback.push('feedback.detailed_phoneme_assessment_not_available');
    for (const tip of pointer?.phoneticTips ?? []) if (feedback.length < 5) feedback.push(tip);

    const wordScores: WordScore[] = transcript.segments.flatMap((s) => s.words).map((w) => ({
      word: w.text,
      startMs: w.startMs,
      endMs: w.endMs,
      accuracy: null,
      errorType: null,
    }));
    const pron = referenceComparisonAssessment(feedback.slice(0, 5), pointer?.humanCalibrated ?? false);
    const parsed = PronunciationResultSchema.parse({
      targetVarietyId: input.targetVarietyId,
      locale: input.locale,
      transcript,
      pronunciation: {
        ...pron,
        featuresAssessed: ['word'],
        wordScores,
        highlightedSegment: null,
        provider: this.provider,
        scorerVersion: 'reference-comparison-v1',
      },
      latencyMs: Date.now() - startedAt,
    });
    return { ...parsed, transcript: parsed.transcript ? { ...parsed.transcript, speech } : null };
  }
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

/** Chooses the acoustic assessor only when it genuinely supports the locale + requested features; otherwise reference comparison. */
export class CompositeAssessor implements PronunciationAssessor {
  readonly provider = 'composite';

  constructor(
    private readonly acoustic: readonly ScreeningPronunciationAssessor[],
    private readonly fallback: ScreeningPronunciationAssessor,
  ) {}

  async choose(locale: string, features: readonly PronunciationFeature[] = ['word']): Promise<{ assessor: ScreeningPronunciationAssessor; capability: Capability }> {
    const variety = resolveVariety(locale);
    for (const a of this.acoustic) {
      const cap = await a.capability(locale);
      if (!cap.supported) continue;
      if (variety && varietyBoundaryViolation(a.provider, variety, cap.effectiveLocale)) continue;
      if (features.every((f) => cap.features[f])) return { assessor: a, capability: cap };
    }
    return { assessor: this.fallback, capability: await this.fallback.capability(locale) };
  }

  async capability(locale: string): Promise<Capability> {
    return (await this.choose(locale)).capability;
  }

  async supports(locale: string, feature: PronunciationFeature): Promise<boolean> {
    const { capability } = await this.choose(locale, [feature]);
    return capability.supported && capability.features[feature];
  }

  /** Options reach the chosen assessor (the reference comparison screens with them; an acoustic assessor may ignore them). */
  async assess(input: PronunciationInput, options: PronunciationAssessOptions = {}): Promise<ScreenedPronunciationResult> {
    const { assessor } = await this.choose(input.locale, input.requestedFeatures.length ? input.requestedFeatures : ['word']);
    return assessor.assess(input, options);
  }
}
