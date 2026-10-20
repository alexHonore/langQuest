/**
 * Turn-based realtime pipeline (§8.6 primary option): streaming learner audio → STT → character agent (LLM)
 * → TTS, with barge-in cancellation tokens, short-lived HMAC session tickets and latency measurement hooks.
 * Implements `RealtimeConversationProvider` so the capability registry can route to it.
 *
 * Speech honesty (ADR-006, device QA 2026-10-19 §6.1): learner audio is transcribed through the non-speech gate
 * (`screening: 'learner'`, `../speech/speech-detection`). A take without speech — silence, ambient noise the recognizer
 * turned into a stock phrase, a decoding loop, an empty transcript — ends the turn there: no character agent (LLM) call,
 * no TTS call, so nothing paid beyond the recognizer call itself (none at all when the recorder metering or the PCM
 * level already shows silence). The result carries `speech: { speechDetected: false, reason }` and `onNoSpeech` fires:
 * the client renders "I didn't hear you, try again". The same applies to recognizer output with no words in it (this
 * pipeline's own transcription, or an audio turn's `transcriptHint`): it is never replaced by a placeholder and sent to
 * the model.
 *
 * A `transcript` learner input is NOT recognizer output the pipeline can judge: mobile sends typed chat messages as
 * `{ kind: 'transcript', provider: 'client' }`, and the API sends its own already-screened transcription the same way.
 * So the no-words rule never applies to it: "?", "...", "…" or an emoji is a learner's message and gets an in-character
 * reply, as before. Only a transcript that is empty after trimming ends the turn (nothing to answer). Its `speech`
 * verdict is null: the pipeline holds no speech evidence for a transcript it did not produce.
 */
import type {
  AudioInput,
  AudioOutput,
  Capability,
  CharacterTurn,
  LearnerTurnInput,
  RealtimeConversationProvider,
  RecordingSignals,
  ShortLivedSession,
  SpeechDetection,
  SpeechRecognizer,
  SpeechSynthesizer,
  TranscriptResult,
  VoiceSessionConfig,
} from '@langquest/contracts';
import { unsupportedCapability } from '@langquest/contracts';
import { resolveVariety, varietyBoundaryViolation } from '../capability/registry';
import type { CharacterResponder } from '../conversation/character-agent';
import type { CharacterPersona } from '../prompts/builders';
import { applySpeechScreening, normalizeForScreening, speechDetectionOf, type SpeechScreeningOptions } from '../speech/speech-detection';
import { signSessionTicket } from './tickets';

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export class CancelledError extends Error {
  constructor(readonly reason: string) {
    super(`Cancelled: ${reason}`);
    this.name = 'CancelledError';
  }
}

export interface CancellationToken {
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
  readonly reason: string | null;
  cancel(reason?: string): void;
  onCancel(cb: (reason: string) => void): () => void;
  throwIfCancelled(): void;
}

/** Create a token; optionally linked to a parent signal (e.g. request abort). */
export function createCancellationToken(parent?: AbortSignal): CancellationToken {
  const controller = new AbortController();
  let reason: string | null = null;
  const listeners = new Set<(reason: string) => void>();
  const cancel = (why = 'cancelled') => {
    if (reason !== null) return;
    reason = why;
    controller.abort(new CancelledError(why));
    for (const l of listeners) l(why);
    listeners.clear();
  };
  if (parent) {
    if (parent.aborted) cancel('parent_aborted');
    else parent.addEventListener('abort', () => cancel('parent_aborted'), { once: true });
  }
  return {
    signal: controller.signal,
    get cancelled() {
      return reason !== null;
    },
    get reason() {
      return reason;
    },
    cancel,
    onCancel(cb) {
      if (reason !== null) {
        cb(reason);
        return () => {};
      }
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    throwIfCancelled() {
      if (reason !== null) throw new CancelledError(reason);
    },
  };
}

// ---------------------------------------------------------------------------
// Latency hooks
// ---------------------------------------------------------------------------

export interface TurnLatencySample {
  sttMs: number | null;
  llmMs: number | null;
  ttsMs: number | null;
  /** Time from turn start to the first audio bytes being available. */
  timeToFirstAudioMs: number | null;
  totalMs: number;
  cancelled: boolean;
  cancelReason: string | null;
  fallbackUsed: boolean;
}

export interface LatencyHooks {
  onSttComplete?(ms: number): void;
  onLlmComplete?(ms: number): void;
  onFirstAudio?(ms: number): void;
  onTurnComplete?(sample: TurnLatencySample): void;
  /** The take had no speech: the turn ends here (no LLM / TTS call). The client renders "I didn't hear you". */
  onNoSpeech?(speech: SpeechDetection): void;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Recognizer that may accept per-call options (the learner screening, client metering, trace and attribution), like
 * `OpenRouterSpeechRecognizer`; plain contract adapters also qualify (their transcript is screened here).
 */
export interface PipelineRecognizer extends SpeechRecognizer {
  transcribe(audio: AudioInput, locale: string, options?: SpeechScreeningOptions & { traceId?: string; enrollmentId?: string | null }): Promise<TranscriptResult>;
}

/** Synthesizer that may accept per-call options (rate, trace id); plain contract adapters also qualify. */
export interface PipelineSynthesizer extends SpeechSynthesizer {
  synthesize(text: string, locale: string, voiceId: string, options?: { rate?: number; traceId?: string }): Promise<AudioOutput>;
}

export interface PipelineRealtimeProviderOptions {
  recognizer: PipelineRecognizer;
  synthesizer: PipelineSynthesizer;
  characterAgent: CharacterResponder;
  /** HMAC secret for client session tickets (≥ 16 chars). */
  ticketSecret: string;
  ticketTtlSeconds?: number;
  /** URL the client connects to for streaming turns (null = plain HTTP turn endpoint). */
  connectUrl?: (sessionId: string) => string | null;
  vad?: { silenceMs: number; minSpeechMs: number };
  clock?: () => number;
}

export interface PipelineTurnInput {
  config: VoiceSessionConfig;
  persona: CharacterPersona;
  learnerInput: LearnerTurnInput;
  /** Audio bytes/reference for `audio` learner inputs when the API already has them. */
  audio?: AudioInput;
  lastCharacterText: string | null;
  token: CancellationToken;
  hooks?: LatencyHooks;
  traceId?: string;
  /** Skip TTS (text-only mode / accessibility). */
  textOnly?: boolean;
  /** Recorder metering sent with the take (can only make the outcome more conservative). */
  recording?: RecordingSignals | null;
}

export interface PipelineTurnResult {
  /** The screened transcript when this pipeline transcribed the take and it contained speech; null otherwise. */
  transcript: TranscriptResult | null;
  turn: CharacterTurn | null;
  audio: AudioOutput | null;
  playbackRate: number;
  latency: TurnLatencySample;
  cancelled: boolean;
  /**
   * Speech verdict for audio turns: the take this pipeline transcribed, or an audio turn's transcript hint. Null for
   * `text`, `transcript` (typed chat arrives as `transcript` too, so the pipeline has no speech evidence for it) and
   * `command` inputs, and for a cancelled turn. The one exception: a `transcript` that is empty after trimming ends
   * as `{ speechDetected: false, reason: 'empty_transcript' }`.
   * `speechDetected: false` = the honest no-speech outcome: `turn` and `audio` are null and no model was called.
   */
  speech: SpeechDetection | null;
}

/**
 * Recognizer output with no words in it (empty, whitespace, punctuation or a lone "…"). Applied ONLY to recognizer
 * output (this pipeline's transcription, an audio turn's `transcriptHint`), never to a `transcript` input, which may be
 * a typed message.
 */
const recognizerHeardNoWords = (text: string | null | undefined): boolean => !normalizeForScreening(text ?? '');

export class PipelineRealtimeProvider implements RealtimeConversationProvider {
  readonly provider = 'pipeline_stt_llm_tts';
  private readonly recognizer: PipelineRecognizer;
  private readonly synthesizer: PipelineSynthesizer;
  private readonly agent: CharacterResponder;
  private readonly ticketSecret: string;
  private readonly ticketTtlSeconds: number;
  private readonly connectUrl: (sessionId: string) => string | null;
  private readonly vad: { silenceMs: number; minSpeechMs: number };
  private readonly clock: () => number;

  constructor(options: PipelineRealtimeProviderOptions) {
    this.recognizer = options.recognizer;
    this.synthesizer = options.synthesizer;
    this.agent = options.characterAgent;
    this.ticketSecret = options.ticketSecret;
    this.ticketTtlSeconds = options.ticketTtlSeconds ?? 15 * 60;
    this.connectUrl = options.connectUrl ?? (() => null);
    this.vad = options.vad ?? { silenceMs: 700, minSpeechMs: 250 };
    this.clock = options.clock ?? Date.now;
  }

  async supports(locale: string, interruptible: boolean): Promise<Capability> {
    const variety = resolveVariety(locale);
    if (!variety) return unsupportedCapability(this.provider, ['locale_unsupported'], [`Unknown or ambiguous locale: ${locale}`]);
    const [stt, tts] = await Promise.all([this.recognizer.supports(locale), this.synthesizer.supports(locale)]);
    const notes = [`stt=${stt.provider}:${stt.supported ? 'ok' : stt.reasons.join('|')}`, `tts=${tts.provider}:${tts.supported ? 'ok' : tts.reasons.join('|')}`];
    if (!stt.supported) return unsupportedCapability(this.provider, stt.reasons.length ? stt.reasons : ['provider_unavailable'], ['Speech recognition unavailable for this variety', ...notes]);
    if (!tts.supported) return unsupportedCapability(this.provider, tts.reasons.length ? tts.reasons : ['provider_unavailable'], ['Speech synthesis unavailable for this variety (text-only conversation is still possible)', ...notes]);
    const boundary = varietyBoundaryViolation(this.provider, variety, stt.effectiveLocale) ?? varietyBoundaryViolation(this.provider, variety, tts.effectiveLocale);
    if (boundary) return boundary;
    const limited = [...stt.reasons, ...tts.reasons].includes('not_benchmarked');
    return {
      supported: true,
      reasons: limited ? ['not_benchmarked'] : [],
      features: { word: false, phoneme: false, tone: false, prosody: false, streaming: tts.features.streaming, interruptible: true, codeSwitch: stt.features.codeSwitch, multiSpeaker: false },
      latencyClass: 'interactive',
      effectiveLocale: stt.effectiveLocale,
      qualityEstimate: stt.qualityEstimate !== null && tts.qualityEstimate !== null ? Math.min(stt.qualityEstimate, tts.qualityEstimate) : null,
      provider: this.provider,
      notes: [interruptible ? 'Barge-in handled client-side + cancellation tokens (not provider duplex).' : 'Push-to-talk.', ...notes, ...stt.notes.slice(0, 1), ...tts.notes.slice(0, 1)],
    };
  }

  /**
   * Issue a session ticket. A `text_only` session always gets the `text_only` pipeline — the learner's choice is
   * honoured even when speech is available for the variety — and only needs the locale to resolve to a variety;
   * voice modes require the full STT + TTS capability.
   */
  async createSession(config: VoiceSessionConfig, options: { userId?: string } = {}): Promise<ShortLivedSession> {
    let pipeline: ShortLivedSession['pipeline'];
    if (config.mode === 'text_only') {
      if (!resolveVariety(config.locale)) throw new Error(`Pipeline unavailable for ${config.locale}: unknown or ambiguous locale`);
      pipeline = 'text_only';
    } else {
      const cap = await this.supports(config.locale, config.interruptible);
      if (!cap.supported) throw new Error(`Pipeline unavailable for ${config.locale}: ${cap.notes.join('; ')}`);
      pipeline = 'stt_llm_tts';
    }
    const ticket = await signSessionTicket(
      { sessionId: config.sessionId, userId: options.userId ?? config.context.language.enrollmentId, enrollmentId: config.context.language.enrollmentId, pipeline, ttlSeconds: this.ticketTtlSeconds, now: this.clock() },
      this.ticketSecret,
    );
    return {
      sessionId: config.sessionId,
      provider: this.provider,
      clientToken: ticket.token,
      connectUrl: this.connectUrl(config.sessionId),
      expiresAt: ticket.expiresAt,
      pipeline,
      vad: config.mode === 'hands_free' ? this.vad : null,
    };
  }

  /**
   * Run one learner turn through STT → LLM → TTS. Every stage checks the cancellation token so a barge-in
   * stops work early and never produces a second reply for the same turn.
   */
  async runTurn(input: PipelineTurnInput): Promise<PipelineTurnResult> {
    const t0 = this.clock();
    const sample: TurnLatencySample = { sttMs: null, llmMs: null, ttsMs: null, timeToFirstAudioMs: null, totalMs: 0, cancelled: false, cancelReason: null, fallbackUsed: false };
    const finish = (result: Omit<PipelineTurnResult, 'latency' | 'cancelled'>): PipelineTurnResult => {
      sample.totalMs = this.clock() - t0;
      sample.cancelled = input.token.cancelled;
      sample.cancelReason = input.token.reason;
      input.hooks?.onTurnComplete?.(sample);
      return { ...result, latency: sample, cancelled: sample.cancelled };
    };
    const cancelledResult = (transcript: TranscriptResult | null, turn: CharacterTurn | null) => finish({ transcript, turn, audio: null, playbackRate: 1, speech: null });
    /** The honest no-speech outcome: nothing reaches the character agent or the synthesizer. */
    const noSpeechResult = (speech: SpeechDetection): PipelineTurnResult => {
      input.hooks?.onNoSpeech?.(speech);
      return finish({ transcript: null, turn: null, audio: null, playbackRate: 1, speech });
    };

    try {
      // 1. STT, through the non-speech gate
      let transcript: TranscriptResult | null = null;
      let speech: SpeechDetection | null = null;
      let learnerInput = input.learnerInput;
      if (learnerInput.kind === 'audio' && learnerInput.transcriptHint === null) {
        if (!input.audio) throw new Error('Audio learner turn requires `audio` bytes for transcription');
        const clientSignals = input.recording ?? null;
        const s = this.clock();
        const heard = await this.recognizer.transcribe(input.audio, input.config.locale, { screening: 'learner', clientSignals, traceId: input.traceId, enrollmentId: input.config.context.language.enrollmentId });
        sample.sttMs = this.clock() - s;
        input.hooks?.onSttComplete?.(sample.sttMs);
        input.token.throwIfCancelled();
        // The learner-mode recognizer attached its verdict (applied once, idempotently); a plain adapter is screened here.
        const verdict = speechDetectionOf(heard, { client: clientSignals });
        const screened = applySpeechScreening(heard, verdict);
        if (!verdict.speechDetected || recognizerHeardNoWords(screened.text)) return noSpeechResult({ speechDetected: false, reason: verdict.speechDetected ? 'empty_transcript' : (verdict.reason ?? 'empty_transcript') });
        transcript = screened;
        speech = { speechDetected: true, reason: null };
        learnerInput = { kind: 'transcript', text: screened.text, confidence: screened.confidence, provider: screened.provider };
      } else if (learnerInput.kind === 'audio' && learnerInput.transcriptHint !== null) {
        // A device recognizer's transcript sent with the take: recognizer output, so a hint with no words is no speech.
        if (recognizerHeardNoWords(learnerInput.transcriptHint)) return noSpeechResult({ speechDetected: false, reason: 'empty_transcript' });
        speech = { speechDetected: true, reason: null };
      } else if (learnerInput.kind === 'transcript' && !learnerInput.text.trim()) {
        // Typed chat or an already-screened transcript: answered as sent ("?", "…", an emoji), unless there is nothing at all.
        return noSpeechResult({ speechDetected: false, reason: 'empty_transcript' });
      }

      // 2. LLM
      const l = this.clock();
      const response = await this.agent.respond({ context: input.config.context, persona: input.persona, learnerInput, lastCharacterText: input.lastCharacterText, traceId: input.traceId, signal: input.token.signal });
      sample.llmMs = this.clock() - l;
      sample.fallbackUsed = response.usedRecoveryLine;
      input.hooks?.onLlmComplete?.(sample.llmMs);
      input.token.throwIfCancelled();

      // 3. TTS
      if (input.textOnly || input.config.mode === 'text_only') return finish({ transcript, turn: response.turn, audio: null, playbackRate: response.playbackRate, speech });
      const v = this.clock();
      const audio = await this.synthesizer.synthesize(response.turn.text, input.config.locale, input.config.voiceId, { rate: response.playbackRate, traceId: input.traceId });
      sample.ttsMs = this.clock() - v;
      sample.timeToFirstAudioMs = this.clock() - t0;
      input.hooks?.onFirstAudio?.(sample.timeToFirstAudioMs);
      input.token.throwIfCancelled();
      const turn: CharacterTurn = { ...response.turn, audio: { assetId: audio.assetId, url: audio.url, durationMs: audio.durationMs, synthetic: true } };
      return finish({ transcript, turn, audio, playbackRate: response.playbackRate, speech });
    } catch (error) {
      if (input.token.cancelled || error instanceof CancelledError || (error as Error)?.name === 'AbortError') return cancelledResult(null, null);
      throw error;
    }
  }
}
