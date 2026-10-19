/**
 * Client-side conversation orchestrator (§8.3, ADR-002 pipeline mode).
 *
 * Wraps the pure state machine from `@langquest/ai` and executes its effects
 * against injected adapters: the API (turn / transcribe / synthesize / end),
 * a short-clip audio player and a recorder. Guarantees carried over from the
 * machine: barge-in stops TTS — including a synthesis that is still in
 * flight — and cancels the pending reply (never two replies for one learner
 * turn); a disconnect never drops the learner's last turn; stale completions
 * are ignored. Hands-free mode feeds recorder metering samples into a
 * `VadDetector`; while the character speaks the VAD is gated (no echo
 * cancellation is available, so hands-free barge-in needs a tap).
 *
 * Failures that are not connectivity problems (422, 429, provider errors)
 * return the learner to `listening` with a translated notice and a retry
 * instead of parking the session in `recoverable_error` ("reconnecting")
 * while the device is online (§15 "no broken spinner").
 *
 * Ending: the machine is held in `paused` while `POST …/end` is in flight and
 * only reaches `finished` once the server confirmed; a failed end is exposed as
 * `pendingEnd` so the screen can queue it for replay (§4.6).
 *
 * Nothing here imports React Native, so the whole flow is unit-tested.
 */
import { createMachine, reduce, type Effect, type EmittedEvent, type MachineState } from '@langquest/ai/conversation/machine';
import type {
  AudioEncoding,
  CharacterTurn,
  ConversationCommand,
  ConversationEndResponse,
  ConversationMode,
  ConversationSessionCreateResponse,
  ConversationState,
  ConversationTurnRequest,
  ConversationTurnResponse,
  SpeechState,
  SynthesizeResponseSchema,
  TranscribeResponseSchema,
} from '@langquest/contracts';
import type { z } from 'zod';
import { VadDetector } from './vad';

export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;
export type SynthesizeResponse = z.infer<typeof SynthesizeResponseSchema>;

export interface RecordedClip {
  base64: string;
  encoding: AudioEncoding;
  sampleRateHz: number | null;
  durationMs: number;
}

export interface ConversationAudioAdapter {
  /** Play a clip; resolves when playback ends (or is stopped). */
  play(source: { url: string } | { base64: string; mimeType: string }, rate: number): Promise<void>;
  stop(): void;
}

export interface ConversationRecorderAdapter {
  start(): Promise<void>;
  /** Stop and return the clip, or null when nothing usable was captured. */
  stop(): Promise<RecordedClip | null>;
  cancel(): Promise<void>;
}

export interface ConversationEndBody {
  reason: ConversationEndReason;
  clientState: { lastSeq: number; turnCount: number };
  clientEventId: string;
}

export interface ConversationApiAdapter {
  turn(sessionId: string, body: ConversationTurnRequest, signal: AbortSignal): Promise<ConversationTurnResponse>;
  transcribe(clip: RecordedClip, signal: AbortSignal): Promise<TranscribeResponse>;
  synthesize(text: string, speed: 'slow' | 'normal', signal: AbortSignal): Promise<SynthesizeResponse>;
  end(sessionId: string, body: ConversationEndBody): Promise<ConversationEndResponse>;
}

export type ConversationEndReason = 'completed' | 'learner_ended' | 'timeout' | 'error' | 'abandoned';

export interface ConversationTurnView {
  id: string;
  role: 'learner' | 'character';
  text: string;
  transliteration: string | null;
  sourceGloss: string | null;
  confidence: number | null;
  expression: CharacterTurn['expression'] | null;
  at: string;
}

export interface ConversationSnapshot {
  machine: MachineState;
  speechState: SpeechState;
  turns: ConversationTurnView[];
  lastCharacterTurn: CharacterTurn | null;
  objectivesCompleted: string[];
  /** Latest recoverable problem to show (null when fine). */
  notice: { code: string; recoverable: boolean } | null;
  /** 0..1 microphone level from real metering (0 when not recording). */
  micLevel: number;
  /** Learner speaking time captured so far (ms, from real clip durations). */
  speakingMs: number;
  recording: boolean;
  ended: ConversationEndResponse | null;
  ending: boolean;
  /** A learner turn that failed for a non-connectivity reason and can be re-sent with `retryLastTurn()`. */
  canRetryTurn: boolean;
  /** The end request that could not be delivered (queue it for replay, or `abandonLocally()`). */
  pendingEnd: ConversationEndBody | null;
}

export interface ConversationControllerOptions {
  session: ConversationSessionCreateResponse;
  mode: ConversationMode;
  api: ConversationApiAdapter;
  audio: ConversationAudioAdapter;
  recorder: ConversationRecorderAdapter;
  newId: () => string;
  now?: () => string;
  isOnline?: () => boolean;
  vad?: VadDetector;
  onEvent?: (event: EmittedEvent) => void;
}

const isConnectivityError = (error: unknown): boolean => {
  const e = error as { isConnectivity?: boolean; kind?: string } | null;
  return Boolean(e && (e.isConnectivity || e.kind === 'network' || e.kind === 'timeout' || e.kind === 'provider_unavailable'));
};

const errorCode = (error: unknown, fallback: string): string => {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' && kind.length > 0 ? kind : fallback;
};

interface FailedTurn {
  learnerTurnId: string;
  text: string | null;
  command: ConversationCommand | null;
  clip: RecordedClip | null;
}

export class ConversationController {
  private machine: MachineState;
  private readonly listeners = new Set<(snapshot: ConversationSnapshot) => void>();
  private readonly turns: ConversationTurnView[] = [];
  private lastCharacterTurn: CharacterTurn | null;
  private notice: ConversationSnapshot['notice'] = null;
  private micLevel = 0;
  private speakingMs = 0;
  private recording = false;
  private ended: ConversationEndResponse | null = null;
  private ending = false;
  private inFlight: { requestId: string; controller: AbortController } | null = null;
  private sttController: AbortController | null = null;
  /** Synthesis in flight for the turn being spoken; aborted by `stop_tts` and `dispose()`. */
  private ttsController: AbortController | null = null;
  /** Bumped on every `stop_tts` so a synthesis that resolves afterwards never plays. */
  private ttsGeneration = 0;
  private slowNext = false;
  private failedTurn: FailedTurn | null = null;
  private pendingEnd: ConversationEndBody | null = null;
  private readonly vad: VadDetector;
  private readonly now: () => string;
  private readonly isOnline: () => boolean;
  private disposed = false;

  constructor(private readonly options: ConversationControllerOptions) {
    this.machine = createMachine(options.session.session.sessionId, options.mode);
    this.lastCharacterTurn = options.session.openingTurn;
    this.now = options.now ?? (() => new Date().toISOString());
    this.isOnline = options.isOnline ?? (() => true);
    const vad = options.session.provider.vad;
    this.vad = options.vad ?? new VadDetector(vad ? { silenceMs: vad.silenceMs, minSpeechMs: vad.minSpeechMs } : {});
    if (options.session.openingTurn) this.pushCharacterTurn(options.session.openingTurn);
  }

  /* ------------------------------------------------------------ public --- */

  get sessionId(): string {
    return this.options.session.session.sessionId;
  }

  subscribe(listener: (snapshot: ConversationSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ConversationSnapshot {
    return {
      machine: this.machine,
      speechState: this.speechState(),
      turns: [...this.turns],
      lastCharacterTurn: this.lastCharacterTurn,
      objectivesCompleted: this.machine.objectivesCompleted,
      notice: this.notice,
      micLevel: this.micLevel,
      speakingMs: this.speakingMs,
      recording: this.recording,
      ended: this.ended,
      ending: this.ending,
      canRetryTurn: this.failedTurn !== null && this.machine.state === 'listening',
      pendingEnd: this.pendingEnd,
    };
  }

  /** Connect and play the opening line (if any). */
  async start(): Promise<void> {
    this.dispatch({ type: 'start' });
    this.dispatch({ type: 'connected' });
    const opening = this.options.session.openingTurn;
    if (opening) await this.speak(opening, 'opening');
  }

  /** Push-to-talk: begin capturing (also used as barge-in while the character speaks). */
  async pressStart(): Promise<void> {
    if (this.machine.state === 'finished' || this.ending) return;
    const learnerTurnId = this.options.newId();
    if (this.machine.state === 'responding') {
      this.bargeInPending = true;
      this.dispatch({ type: 'barge_in', learnerTurnId, at: this.now() });
    } else {
      this.dispatch({ type: 'speech_started', learnerTurnId, at: this.now() });
    }
    if (this.machine.state !== 'speech_detected') return;
    this.failedTurn = null;
    await this.beginRecording();
  }

  /** Push-to-talk: stop capturing and send the turn. */
  async pressStop(): Promise<void> {
    if (!this.recording) return;
    const learnerTurnId = this.machine.pendingLearnerTurn?.learnerTurnId ?? this.options.newId();
    const clip = await this.endRecording();
    if (!clip) {
      // Nothing captured: back to listening without inventing a turn.
      this.recoverToListening('no_speech');
      return;
    }
    this.speakingMs += clip.durationMs;
    this.pendingClip = clip;
    this.dispatch({ type: 'speech_ended', learnerTurnId, text: null, audioRef: `clip:${clip.durationMs}` });
  }

  /**
   * Hands-free: feed a metering sample (dBFS). While the character speaks (or its synthesis is still
   * pending) the detector is ignored: without echo cancellation the device's own speaker output would
   * trigger a barge-in, so hands-free interruption needs a tap (`pressStart`).
   */
  async meter(levelDb: number | undefined, atMs: number): Promise<void> {
    this.micLevel = this.recording ? Math.max(0, Math.min(1, ((levelDb ?? -60) + 60) / 60)) : 0;
    if (this.options.mode !== 'hands_free') {
      this.emitChange();
      return;
    }
    if (this.characterAudioActive()) {
      this.vad.reset();
      this.emitChange();
      return;
    }
    const t = this.vad.sample(levelDb, atMs);
    if (t === 'speech_start') await this.pressStart();
    else if (t === 'speech_end') await this.pressStop();
    else this.emitChange();
  }

  /** Hands-free needs the recorder running continuously; call once after `start()`. */
  async armHandsFree(): Promise<void> {
    if (this.options.mode !== 'hands_free') return;
    await this.options.recorder.start();
    this.recording = true;
    this.emitChange();
  }

  async submitText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.machine.state === 'finished') return;
    this.failedTurn = null;
    this.pushLearnerTurn(trimmed, null);
    this.dispatch({ type: 'text_submitted', learnerTurnId: this.options.newId(), text: trimmed, at: this.now() });
  }

  async command(command: ConversationCommand): Promise<void> {
    if (this.machine.state === 'finished') return;
    if (command === 'repeat' && this.lastCharacterTurn && this.machine.state === 'listening') {
      // Local replay: no LLM call needed (§3.7).
      await this.speak(this.lastCharacterTurn, 'repeat', this.slowNext ? 0.8 : 1);
      return;
    }
    if (command === 'slower') this.slowNext = true;
    this.failedTurn = null;
    this.dispatch({ type: 'command', command, learnerTurnId: this.options.newId(), at: this.now() });
  }

  /** Re-send the learner turn that failed for a non-connectivity reason (same client turn id → server dedupes). */
  async retryLastTurn(): Promise<void> {
    const failed = this.failedTurn;
    if (!failed || this.machine.state !== 'listening') return;
    this.failedTurn = null;
    this.notice = null;
    if (failed.command) {
      this.dispatch({ type: 'command', command: failed.command, learnerTurnId: failed.learnerTurnId, at: this.now() });
    } else if (failed.text !== null) {
      this.dispatch({ type: 'text_submitted', learnerTurnId: failed.learnerTurnId, text: failed.text, at: this.now() });
    } else if (failed.clip) {
      this.pendingClip = failed.clip;
      this.dispatch({ type: 'speech_started', learnerTurnId: failed.learnerTurnId, at: this.now() });
      this.dispatch({ type: 'speech_ended', learnerTurnId: failed.learnerTurnId, text: null, audioRef: `clip:${failed.clip.durationMs}` });
    }
  }

  pause(): void {
    this.dispatch({ type: 'pause' });
  }

  resume(): void {
    this.dispatch({ type: 'resume' });
  }

  /** Network dropped (from the app's connectivity listener). */
  disconnect(code = 'offline'): void {
    this.dispatch({ type: 'disconnect', code });
  }

  reconnect(): void {
    if (this.machine.state !== 'recoverable_error' && this.machine.state !== 'paused') return;
    this.notice = null;
    this.dispatch({ type: 'reconnect' });
    this.dispatch({ type: 'connected' });
  }

  /**
   * End the session. Audio and recording stop at once and the machine is held in `paused`; it only
   * reaches `finished` once the server confirmed. On failure the request body is kept (same
   * `clientEventId`) so `end()` can be called again or the screen can queue it for replay.
   */
  async end(reason: ConversationEndReason = 'learner_ended'): Promise<ConversationEndResponse | null> {
    if (this.ended || this.ending) return this.ended;
    this.ending = true;
    this.emitChange();
    if (this.recording) await this.options.recorder.cancel().catch(() => undefined);
    this.recording = false;
    this.micLevel = 0;
    this.stopCharacterAudio();
    this.inFlight?.controller.abort();
    this.inFlight = null;
    this.sttController?.abort();
    if (this.machine.state !== 'finished' && this.machine.state !== 'paused') {
      if (this.machine.state !== 'listening') this.forceListening();
      this.dispatch({ type: 'pause' });
    }
    const body: ConversationEndBody = this.pendingEnd ?? {
      reason,
      clientState: { lastSeq: this.machine.seq, turnCount: this.machine.turnCount },
      clientEventId: this.options.newId(),
    };
    try {
      this.ended = await this.options.api.end(this.sessionId, body);
      this.pendingEnd = null;
      this.notice = null;
      this.dispatch({ type: 'end', reason: reason === 'error' ? 'abandoned' : reason });
    } catch (error) {
      this.pendingEnd = body;
      this.notice = { code: isConnectivityError(error) ? 'end_offline' : 'end_failed', recoverable: true };
    } finally {
      this.ending = false;
      this.emitChange();
    }
    return this.ended;
  }

  /** Finish the machine locally without a server summary (the caller has queued `pendingEnd` for replay). */
  abandonLocally(): void {
    if (this.machine.state === 'finished') return;
    this.dispatch({ type: 'end', reason: this.pendingEnd?.reason === 'completed' ? 'completed' : 'learner_ended' });
  }

  dispose(): void {
    this.disposed = true;
    this.inFlight?.controller.abort();
    this.sttController?.abort();
    this.stopCharacterAudio();
    if (this.recording) void this.options.recorder.cancel().catch(() => undefined);
    this.listeners.clear();
  }

  /* ----------------------------------------------------------- private --- */

  private pendingClip: RecordedClip | null = null;
  private pendingEffects: Effect[] = [];
  private bargeInPending = false;

  /** Transparent speech status for `SpeechStateIndicator` / `CharacterPortrait` (§10.2A). */
  private speechState(): SpeechState {
    switch (this.machine.state) {
      case 'responding':
        return 'character_speaking';
      case 'interpreting':
        return 'thinking';
      case 'recoverable_error':
      case 'connecting':
        return 'reconnecting';
      case 'listening':
        return 'waiting';
      case 'speech_detected':
      case 'interrupted':
        return 'learner_mic_active';
      default:
        return 'idle';
    }
  }

  private characterAudioActive(): boolean {
    return this.machine.state === 'responding' || this.machine.speakingTurnId !== null || this.ttsController !== null;
  }

  /** Stop playback and any synthesis still in flight; later resolutions of that synthesis are ignored. */
  private stopCharacterAudio(): void {
    this.ttsGeneration += 1;
    this.ttsController?.abort();
    this.ttsController = null;
    this.options.audio.stop();
  }

  private dispatch(event: Parameters<typeof reduce>[1]): void {
    if (this.disposed) return;
    const result = reduce(this.machine, event);
    this.machine = result.state;
    this.pendingEffects.push(...result.effects);
    this.runEffects();
  }

  private runEffects(): void {
    const effects = this.pendingEffects;
    this.pendingEffects = [];
    for (const effect of effects) this.execute(effect);
    this.emitChange();
  }

  private execute(effect: Effect): void {
    switch (effect.type) {
      case 'stop_tts':
        this.stopCharacterAudio();
        break;
      case 'cancel_response':
        if (this.inFlight?.requestId === effect.requestId) {
          this.inFlight.controller.abort();
          this.inFlight = null;
        }
        break;
      case 'start_stt':
        void this.transcribePending(effect.learnerTurnId);
        break;
      case 'start_response':
        void this.requestTurn(effect.learnerTurnId, effect.text, effect.command);
        break;
      case 'resubmit_learner_turn':
        // Re-enter the normal path with the SAME learner turn id so the server dedupes on clientTurnId.
        if (effect.turn.text) {
          this.dispatch({ type: 'text_submitted', learnerTurnId: effect.turn.learnerTurnId, text: effect.turn.text, at: this.now() });
        } else if (this.pendingClip) {
          this.dispatch({ type: 'speech_started', learnerTurnId: effect.turn.learnerTurnId, at: this.now() });
          this.dispatch({ type: 'speech_ended', learnerTurnId: effect.turn.learnerTurnId, text: null, audioRef: effect.turn.audioRef });
        }
        break;
      case 'emit':
        this.handleEmitted(effect.event);
        break;
      case 'log':
        break;
    }
  }

  private handleEmitted(event: EmittedEvent): void {
    this.options.onEvent?.(event);
    if (event.type === 'error') this.notice = { code: event.code, recoverable: event.recoverable };
    if (event.type === 'recovered' || event.type === 'state_changed') {
      if (event.type === 'state_changed' && event.to === 'listening') this.notice = this.notice?.code === 'no_speech' ? this.notice : null;
    }
  }

  private emitChange(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  private async beginRecording(): Promise<void> {
    if (this.recording) return;
    try {
      await this.options.recorder.start();
      this.recording = true;
    } catch {
      this.recoverToListening('recorder_failed');
    }
    this.emitChange();
  }

  private async endRecording(): Promise<RecordedClip | null> {
    if (!this.recording) return null;
    this.recording = false;
    this.micLevel = 0;
    try {
      const clip = await this.options.recorder.stop();
      if (this.options.mode === 'hands_free' && !this.disposed && this.machine.state !== 'finished' && !this.ending) {
        await this.options.recorder.start();
        this.recording = true;
      }
      return clip;
    } catch {
      return null;
    }
  }

  /**
   * Orchestrator-level recovery: return to `listening` from any live state, dropping the pending
   * turn and any in-flight reply (a legal `… → listening` move in the §8.3 table for every live state
   * except `connecting`/`recoverable_error`, which `reconnect()` handles).
   */
  private forceListening(): void {
    const from: ConversationState = this.machine.state;
    if (from === 'finished' || from === 'listening') return;
    if (from === 'responding' || from === 'interrupted') this.stopCharacterAudio();
    this.inFlight?.controller.abort();
    this.inFlight = null;
    this.machine = { ...this.machine, state: 'listening', safeState: 'listening', pendingLearnerTurn: null, responseInFlight: null, speakingTurnId: null, seq: this.machine.seq + 1 };
    this.options.onEvent?.({ type: 'state_changed', from, to: 'listening' });
  }

  /** Leave `speech_detected`/`interpreting`/`responding` without a reply and show `code`. */
  private recoverToListening(code: string): void {
    this.forceListening();
    this.notice = { code, recoverable: true };
    this.emitChange();
  }

  private async transcribePending(learnerTurnId: string): Promise<void> {
    const clip = this.pendingClip;
    if (!clip) {
      this.recoverToListening('no_speech');
      return;
    }
    this.pendingClip = null;
    this.sttController?.abort();
    const controller = new AbortController();
    this.sttController = controller;
    try {
      const res = await this.options.api.transcribe(clip, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const text = res.transcript.text.trim();
      if (!text) {
        this.recoverToListening('no_speech');
        return;
      }
      this.pushLearnerTurn(text, res.transcript.confidence);
      this.dispatch({ type: 'transcript_final', learnerTurnId, text });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isConnectivityError(error)) {
        this.pendingClip = clip; // keep the audio so a reconnect can resubmit it
        this.dispatch({ type: 'disconnect', code: 'offline' });
        return;
      }
      // Application error (422 clip too long, 429, unsupported variety…): back to listening with a
      // retry, never a permanent "reconnecting" state while the device is online.
      this.failedTurn = { learnerTurnId, text: null, command: null, clip };
      this.recoverToListening(errorCode(error, 'stt_failed'));
    }
  }

  private async requestTurn(learnerTurnId: string, text: string | null, command: ConversationCommand | null): Promise<void> {
    if (!this.isOnline()) {
      this.dispatch({ type: 'disconnect', code: 'offline' });
      return;
    }
    const requestId = this.options.newId();
    const controller = new AbortController();
    this.inFlight?.controller.abort();
    this.inFlight = { requestId, controller };
    this.dispatch({ type: 'response_started', requestId, learnerTurnId });
    const input: ConversationTurnRequest['input'] = command ? { kind: 'command', command } : { kind: 'transcript', text: text ?? '', confidence: null, provider: 'client' };
    const body: ConversationTurnRequest = {
      clientTurnId: learnerTurnId,
      input,
      clientState: { state: this.machine.state, lastSeq: this.machine.seq, lastCharacterTurnId: this.machine.lastCharacterTurnId },
      bargeIn: this.bargeInPending,
    };
    this.bargeInPending = false;
    try {
      const res = await this.options.api.turn(this.sessionId, body, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      this.inFlight = null;
      const turn = res.characterTurn;
      if (!turn) {
        this.failedTurn = { learnerTurnId, text, command, clip: null };
        this.dispatch({ type: 'response_failed', requestId, recoverable: true, code: 'empty_reply' });
        this.forceListening();
        this.emitChange();
        return;
      }
      this.pushCharacterTurn(turn);
      this.dispatch({ type: 'response_ready', requestId, characterTurnId: turn.turnId, objectivesCompleted: res.objectivesCompleted, endsConversation: turn.endsConversation });
      const rate = command === 'slower' || this.slowNext ? 0.8 : 1;
      this.slowNext = false;
      await this.speak(turn, 'reply', rate);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.inFlight = null;
      const connectivity = isConnectivityError(error);
      if (connectivity) {
        // Keep the learner turn: disconnect → recoverable_error; reconnect() resubmits it.
        this.machine = { ...this.machine, responseInFlight: null };
        this.dispatch({ type: 'disconnect', code: 'offline' });
      } else {
        // 4xx/validation/rate limit: record the failure, then straight back to listening with a retry.
        this.failedTurn = { learnerTurnId, text, command, clip: null };
        this.dispatch({ type: 'response_failed', requestId, recoverable: true, code: errorCode(error, 'turn_failed') });
        this.forceListening();
        this.emitChange();
      }
    }
  }

  private async speak(turn: CharacterTurn, _reason: 'opening' | 'reply' | 'repeat', rate = 1): Promise<void> {
    const sourceFromTurn = turn.audio?.url ? { url: turn.audio.url } : null;
    const inResponding = this.machine.state === 'responding';
    if (inResponding) this.dispatch({ type: 'tts_started', characterTurnId: turn.turnId });
    const generation = this.ttsGeneration;
    const stillCurrent = (): boolean => !this.disposed && generation === this.ttsGeneration && (!inResponding || this.machine.speakingTurnId === turn.turnId);
    try {
      let source: { url: string } | { base64: string; mimeType: string } | null = sourceFromTurn;
      if (!source) {
        const controller = new AbortController();
        this.ttsController = controller;
        try {
          const synth = await this.options.api.synthesize(turn.text, rate < 1 ? 'slow' : 'normal', controller.signal);
          source = synth.audio.url ? { url: synth.audio.url } : synth.audio.base64 ? { base64: synth.audio.base64, mimeType: mimeFor(synth.audio.encoding) } : null;
        } finally {
          if (this.ttsController === controller) this.ttsController = null;
        }
        // A barge-in (or dispose) while synthesizing: the reply must not start playing now.
        if (!stillCurrent()) return;
      }
      if (source && stillCurrent()) await this.options.audio.play(source, rate);
    } catch (error) {
      if (!stillCurrent()) return;
      const aborted = (error as { name?: string } | null)?.name === 'AbortError';
      // Audio failure is not fatal: the text is on screen. Note it honestly.
      if (!aborted) this.notice = { code: 'tts_unavailable', recoverable: true };
    } finally {
      this.vad.reset();
      if (inResponding && this.machine.speakingTurnId === turn.turnId) this.dispatch({ type: 'tts_finished', characterTurnId: turn.turnId });
      else this.emitChange();
    }
  }

  private pushLearnerTurn(text: string, confidence: number | null): void {
    this.turns.push({ id: this.options.newId(), role: 'learner', text, transliteration: null, sourceGloss: null, confidence, expression: null, at: this.now() });
  }

  private pushCharacterTurn(turn: CharacterTurn): void {
    this.lastCharacterTurn = turn;
    this.turns.push({ id: turn.turnId, role: 'character', text: turn.text, transliteration: turn.transliteration, sourceGloss: turn.sourceGloss, confidence: null, expression: turn.expression, at: this.now() });
  }
}

function mimeFor(encoding: AudioEncoding): string {
  switch (encoding) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
    case 'pcm16':
      return 'audio/wav';
    case 'aac':
    case 'm4a':
      return 'audio/mp4';
    case 'opus':
    case 'webm_opus':
      return 'audio/webm';
    case 'flac':
      return 'audio/flac';
  }
}
