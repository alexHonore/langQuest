/**
 * Client-side conversation orchestrator (§8.3, ADR-002 pipeline mode).
 *
 * Wraps the pure state machine from `@langquest/ai` and executes its effects
 * against injected adapters: the API (turn / transcribe / synthesize / end),
 * a short-clip audio player and a recorder. Guarantees carried over from the
 * machine: barge-in stops TTS and cancels the in-flight reply (never two
 * replies for one learner turn); a disconnect never drops the learner's last
 * turn; stale completions are ignored. Hands-free mode feeds recorder metering
 * samples into a `VadDetector`; push-to-talk calls `pressStart/pressStop`.
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

export interface ConversationApiAdapter {
  turn(sessionId: string, body: ConversationTurnRequest, signal: AbortSignal): Promise<ConversationTurnResponse>;
  transcribe(clip: RecordedClip, signal: AbortSignal): Promise<TranscribeResponse>;
  synthesize(text: string, speed: 'slow' | 'normal', signal: AbortSignal): Promise<SynthesizeResponse>;
  end(sessionId: string, body: { reason: ConversationEndReason; clientState: { lastSeq: number; turnCount: number }; clientEventId: string }): Promise<ConversationEndResponse>;
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
  private slowNext = false;
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

  /** Hands-free: feed a metering sample (dBFS). */
  async meter(levelDb: number | undefined, atMs: number): Promise<void> {
    this.micLevel = this.recording ? Math.max(0, Math.min(1, ((levelDb ?? -60) + 60) / 60)) : 0;
    if (this.options.mode !== 'hands_free') {
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
    this.dispatch({ type: 'command', command, learnerTurnId: this.options.newId(), at: this.now() });
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
    this.dispatch({ type: 'reconnect' });
    this.dispatch({ type: 'connected' });
  }

  async end(reason: ConversationEndReason = 'learner_ended'): Promise<ConversationEndResponse | null> {
    if (this.ended || this.ending) return this.ended;
    this.ending = true;
    this.emitChange();
    if (this.recording) await this.options.recorder.cancel().catch(() => undefined);
    this.recording = false;
    this.dispatch({ type: 'end', reason: reason === 'error' ? 'abandoned' : reason });
    try {
      this.ended = await this.options.api.end(this.sessionId, {
        reason,
        clientState: { lastSeq: this.machine.seq, turnCount: this.machine.turnCount },
        clientEventId: this.options.newId(),
      });
    } catch (error) {
      this.notice = { code: isConnectivityError(error) ? 'end_offline' : 'end_failed', recoverable: true };
    } finally {
      this.ending = false;
      this.emitChange();
    }
    return this.ended;
  }

  dispose(): void {
    this.disposed = true;
    this.inFlight?.controller.abort();
    this.sttController?.abort();
    this.options.audio.stop();
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
        this.options.audio.stop();
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
      if (this.options.mode === 'hands_free' && !this.disposed && this.machine.state !== 'finished') {
        await this.options.recorder.start();
        this.recording = true;
      }
      return clip;
    } catch {
      return null;
    }
  }

  /** Leave `speech_detected`/`interpreting` without a reply (no speech, recorder error). */
  private recoverToListening(code: string): void {
    if (this.machine.state === 'speech_detected') {
      // speech_detected → listening is a legal transition; emulate it via a cancelled pending turn.
      this.machine = { ...this.machine, state: 'listening', pendingLearnerTurn: null, seq: this.machine.seq + 1 };
      this.notice = { code, recoverable: true };
      this.options.onEvent?.({ type: 'state_changed', from: 'speech_detected', to: 'listening' });
    } else if (this.machine.state === 'interpreting') {
      const requestId = this.options.newId();
      const learnerTurnId = this.machine.pendingLearnerTurn?.learnerTurnId ?? '';
      this.dispatch({ type: 'response_started', requestId, learnerTurnId });
      this.dispatch({ type: 'response_failed', requestId, recoverable: true, code });
      this.dispatch({ type: 'reconnect' });
      this.dispatch({ type: 'connected' });
      this.machine = { ...this.machine, pendingLearnerTurn: null };
      this.notice = { code, recoverable: true };
    }
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
        this.machine = { ...this.machine, pendingLearnerTurn: null };
        this.recoverToListening('no_speech');
        return;
      }
      this.pushLearnerTurn(text, res.transcript.confidence);
      this.dispatch({ type: 'transcript_final', learnerTurnId, text });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.pendingClip = clip; // keep the audio so a reconnect can resubmit it
      this.dispatch({ type: 'disconnect', code: isConnectivityError(error) ? 'offline' : 'stt_failed' });
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
        this.dispatch({ type: 'response_failed', requestId, recoverable: true, code: 'empty_reply' });
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
        this.dispatch({ type: 'response_failed', requestId, recoverable: true, code: (error as { kind?: string })?.kind ?? 'turn_failed' });
      }
    }
  }

  private async speak(turn: CharacterTurn, _reason: 'opening' | 'reply' | 'repeat', rate = 1): Promise<void> {
    const sourceFromTurn = turn.audio?.url ? { url: turn.audio.url } : null;
    const inResponding = this.machine.state === 'responding';
    if (inResponding) this.dispatch({ type: 'tts_started', characterTurnId: turn.turnId });
    try {
      let source: { url: string } | { base64: string; mimeType: string } | null = sourceFromTurn;
      if (!source) {
        const controller = new AbortController();
        const synth = await this.options.api.synthesize(turn.text, rate < 1 ? 'slow' : 'normal', controller.signal);
        source = synth.audio.url ? { url: synth.audio.url } : synth.audio.base64 ? { base64: synth.audio.base64, mimeType: mimeFor(synth.audio.encoding) } : null;
      }
      if (source && !this.disposed) await this.options.audio.play(source, rate);
    } catch {
      // Audio failure is not fatal: the text is on screen. Note it honestly.
      this.notice = { code: 'tts_unavailable', recoverable: true };
    } finally {
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
