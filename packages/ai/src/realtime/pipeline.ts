/**
 * Turn-based realtime pipeline (§8.6 primary option): streaming learner audio → STT → character agent (LLM)
 * → TTS, with barge-in cancellation tokens, short-lived HMAC session tickets and latency measurement hooks.
 * Implements `RealtimeConversationProvider` so the capability registry can route to it.
 */
import type {
  AudioInput,
  AudioOutput,
  Capability,
  CharacterTurn,
  LearnerTurnInput,
  RealtimeConversationProvider,
  ShortLivedSession,
  SpeechRecognizer,
  SpeechSynthesizer,
  TranscriptResult,
  VoiceSessionConfig,
} from '@langquest/contracts';
import { unsupportedCapability } from '@langquest/contracts';
import { resolveVariety, varietyBoundaryViolation } from '../capability/registry';
import type { CharacterResponder } from '../conversation/character-agent';
import type { CharacterPersona } from '../prompts/builders';
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
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Synthesizer that may accept per-call options (rate, trace id); plain contract adapters also qualify. */
export interface PipelineSynthesizer extends SpeechSynthesizer {
  synthesize(text: string, locale: string, voiceId: string, options?: { rate?: number; traceId?: string }): Promise<AudioOutput>;
}

export interface PipelineRealtimeProviderOptions {
  recognizer: SpeechRecognizer;
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
}

export interface PipelineTurnResult {
  transcript: TranscriptResult | null;
  turn: CharacterTurn | null;
  audio: AudioOutput | null;
  playbackRate: number;
  latency: TurnLatencySample;
  cancelled: boolean;
}

export class PipelineRealtimeProvider implements RealtimeConversationProvider {
  readonly provider = 'pipeline_stt_llm_tts';
  private readonly recognizer: SpeechRecognizer;
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

  async createSession(config: VoiceSessionConfig, options: { userId?: string } = {}): Promise<ShortLivedSession> {
    const cap = await this.supports(config.locale, config.interruptible);
    const pipeline = cap.supported ? 'stt_llm_tts' : config.mode === 'text_only' ? 'text_only' : null;
    if (!pipeline) throw new Error(`Pipeline unavailable for ${config.locale}: ${cap.notes.join('; ')}`);
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
    const cancelledResult = (transcript: TranscriptResult | null, turn: CharacterTurn | null) => finish({ transcript, turn, audio: null, playbackRate: 1 });

    try {
      // 1. STT
      let transcript: TranscriptResult | null = null;
      let learnerInput = input.learnerInput;
      if (learnerInput.kind === 'audio' && learnerInput.transcriptHint === null) {
        if (!input.audio) throw new Error('Audio learner turn requires `audio` bytes for transcription');
        const s = this.clock();
        transcript = await this.recognizer.transcribe(input.audio, input.config.locale);
        sample.sttMs = this.clock() - s;
        input.hooks?.onSttComplete?.(sample.sttMs);
        input.token.throwIfCancelled();
        learnerInput = { kind: 'transcript', text: transcript.text || '…', confidence: transcript.confidence, provider: transcript.provider };
      }

      // 2. LLM
      const l = this.clock();
      const response = await this.agent.respond({ context: input.config.context, persona: input.persona, learnerInput, lastCharacterText: input.lastCharacterText, traceId: input.traceId, signal: input.token.signal });
      sample.llmMs = this.clock() - l;
      sample.fallbackUsed = response.usedRecoveryLine;
      input.hooks?.onLlmComplete?.(sample.llmMs);
      input.token.throwIfCancelled();

      // 3. TTS
      if (input.textOnly || input.config.mode === 'text_only') return finish({ transcript, turn: response.turn, audio: null, playbackRate: response.playbackRate });
      const v = this.clock();
      const audio = await this.synthesizer.synthesize(response.turn.text, input.config.locale, input.config.voiceId, { rate: response.playbackRate, traceId: input.traceId });
      sample.ttsMs = this.clock() - v;
      sample.timeToFirstAudioMs = this.clock() - t0;
      input.hooks?.onFirstAudio?.(sample.timeToFirstAudioMs);
      input.token.throwIfCancelled();
      const turn: CharacterTurn = { ...response.turn, audio: { assetId: audio.assetId, url: audio.url, durationMs: audio.durationMs, synthetic: true } };
      return finish({ transcript, turn, audio, playbackRate: response.playbackRate });
    } catch (error) {
      if (input.token.cancelled || error instanceof CancelledError || (error as Error)?.name === 'AbortError') return cancelledResult(null, null);
      throw error;
    }
  }
}
