/**
 * Long-form audio engine (ADR-001, §1.3 Audio, §14.1 A21–A23).
 *
 * Owns the play queue, position, rate (with pitch correction), skip, sleep
 * timer, A/B loop, lock-screen metadata, interruption / headphone handling and
 * signed-URL renewal (proactive before expiry, reactive on a mid-stream 403 or
 * playback error, resuming at the last known position). The native player is
 * injected through {@link NativePlayer} so the whole engine is unit-tested with
 * a fake; `expo-adapter.ts` provides the `expo-audio` implementation.
 */
import {
  INITIAL_ENGINE_STATE,
  SKIP_BACK_MS,
  SKIP_FORWARD_MS,
  clampMs,
  clampRate,
  currentItem,
  endBehaviour,
  hasNext,
  hasPrevious,
  isCompleted,
  loopJump,
  reduceEngine,
  sleepRemainingMs,
  type AbLoop,
  type AudioEngineError,
  type AudioEngineState,
  type EngineAction,
  type PauseReason,
  type QueueItem,
  type ResolvedSource,
  type SleepTimer,
} from './engine-state';
import { isLeaseExpired, renewalDecision } from './url-renewal';

/** Retry cadence for a proactive renewal that failed while the current URL is still valid. */
const RENEWAL_RETRY_MS = 15_000;

/** Status pushed by the native player (ms-based; `expo-audio` reports seconds). */
export interface NativePlayerStatus {
  playing: boolean;
  positionMs: number;
  durationMs: number | null;
  loaded: boolean;
  buffering: boolean;
  didJustFinish: boolean;
  error: string | null;
  /** iOS: media daemon reset; the player reloads itself but we re-seek to be safe. */
  mediaServicesDidReset?: boolean;
}

export interface LockScreenMetadata {
  title: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: string;
}

/** The slice of a native player the engine needs (implemented over `expo-audio`). */
export interface NativePlayer {
  load(uri: string): void;
  play(): void;
  pause(): void;
  seekTo(positionMs: number): Promise<void>;
  setRate(rate: number): void;
  setLockScreen(active: boolean, metadata?: LockScreenMetadata): void;
  subscribe(listener: (status: NativePlayerStatus) => void): () => void;
  /** Called when the engine starts playing (configure the audio session for background playback). */
  prepareSession?(): Promise<void>;
  release(): void;
}

export class SourceResolutionError extends Error {
  readonly code: AudioEngineError['code'];
  constructor(code: AudioEngineError['code'], message: string) {
    super(message);
    this.name = 'SourceResolutionError';
    this.code = code;
  }
}

export type ProgressReason = 'tick' | 'pause' | 'seek' | 'ended' | 'switch' | 'stop';

export interface ProgressReport {
  item: QueueItem;
  positionMs: number;
  durationMs: number | null;
  completed: boolean;
  reason: ProgressReason;
}

export interface AudioEngineDeps {
  player: NativePlayer;
  /** Resolve a queue item to a playable URI (local file first, else a signed URL). */
  resolveSource: (item: QueueItem, options: { renewal: boolean; afterFailure: boolean }) => Promise<ResolvedSource>;
  onProgress?: (report: ProgressReport) => void;
  /** Emit a `tick` progress report at most this often while playing (default 5 s). */
  progressIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onEvent?: (event: AudioEngineEvent) => void;
}

export type AudioEngineEvent =
  | { type: 'url_renewed'; assetId: string; reactive: boolean }
  | { type: 'interrupted' }
  | { type: 'sleep_fired' }
  | { type: 'item_started'; item: QueueItem }
  | { type: 'item_finished'; item: QueueItem }
  | { type: 'error'; error: AudioEngineError };

export class AudioEngine {
  private state: AudioEngineState = INITIAL_ENGINE_STATE;
  private readonly listeners = new Set<(state: AudioEngineState) => void>();
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly progressIntervalMs: number;
  private unsubscribeNative: (() => void) | null = null;
  private loadToken = 0;
  private wantPlaying = false;
  private sleepHandle: unknown = null;
  private renewalHandle: unknown = null;
  /** A proactive renewal failed and is being retried while the current lease still works. */
  private renewalPending = false;
  private lastProgressAt = 0;
  private lastReportedPosition = -1;
  private disposed = false;
  private seekInFlight = false;

  constructor(private readonly deps: AudioEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.progressIntervalMs = deps.progressIntervalMs ?? 5_000;
    this.unsubscribeNative = deps.player.subscribe((status) => this.onNativeStatus(status));
  }

  /* ------------------------------------------------------------ state --- */

  getState(): AudioEngineState {
    return this.state;
  }

  subscribe(listener: (state: AudioEngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get current(): QueueItem | null {
    return currentItem(this.state);
  }

  get hasNext(): boolean {
    return hasNext(this.state);
  }

  get hasPrevious(): boolean {
    return hasPrevious(this.state);
  }

  /** Remaining sleep time in ms (minute timers only). */
  sleepRemaining(): number | null {
    return sleepRemainingMs(this.state.sleep, this.now());
  }

  private dispatch(action: EngineAction): void {
    const next = reduceEngine(this.state, action);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /* ------------------------------------------------------------ queue --- */

  /** Replace the queue and load `index` at `positionMs`; plays immediately when `autoplay`. */
  async setQueue(queue: readonly QueueItem[], index: number, options: { positionMs?: number; autoplay?: boolean } = {}): Promise<void> {
    this.reportProgress('switch');
    this.dispatch({ type: 'queue_set', queue, index, positionMs: options.positionMs ?? 0 });
    this.wantPlaying = options.autoplay ?? true;
    if (this.state.index >= 0) await this.loadCurrent(false);
  }

  /** Jump to another item of the current queue. */
  async selectIndex(index: number, options: { positionMs?: number; autoplay?: boolean } = {}): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) return;
    this.reportProgress('switch');
    this.dispatch({ type: 'item_selected', index, positionMs: options.positionMs ?? 0 });
    this.wantPlaying = options.autoplay ?? true;
    await this.loadCurrent(false);
  }

  next(): Promise<void> {
    return this.hasNext ? this.selectIndex(this.state.index + 1, { autoplay: this.wantPlaying || this.state.status === 'playing' }) : Promise.resolve();
  }

  previous(): Promise<void> {
    // Like most players: restart the current item unless we are within its first seconds.
    if (this.state.positionMs > 3_000 || !this.hasPrevious) return this.seekTo(0);
    return this.selectIndex(this.state.index - 1, { autoplay: this.wantPlaying || this.state.status === 'playing' });
  }

  /** Stop playback, clear the queue and lock-screen controls. */
  async stop(): Promise<void> {
    this.reportProgress('stop');
    this.loadToken += 1;
    this.wantPlaying = false;
    this.cancelRenewalTimer();
    try {
      this.deps.player.pause();
      this.deps.player.setLockScreen(false);
    } catch {
      /* native player already released */
    }
    this.dispatch({ type: 'stopped' });
  }

  /* --------------------------------------------------------- transport --- */

  async play(): Promise<void> {
    if (this.state.index < 0) return;
    this.wantPlaying = true;
    if (this.state.status === 'error' && !this.state.source) {
      await this.loadCurrent(false);
      return;
    }
    if (this.state.status === 'ended') {
      await this.seekTo(0);
    }
    if (!this.state.source) {
      this.dispatch({ type: 'play_requested' });
      return; // loadCurrent will start playback once the source is ready
    }
    await this.deps.player.prepareSession?.().catch(() => undefined);
    this.dispatch({ type: 'play_requested' });
    this.deps.player.play();
  }

  pause(reason: Exclude<PauseReason, null> = 'user'): void {
    this.wantPlaying = false;
    this.dispatch({ type: 'pause_requested', reason });
    try {
      this.deps.player.pause();
    } catch {
      /* not loaded */
    }
    this.reportProgress('pause');
  }

  toggle(): Promise<void> {
    if (this.state.status === 'playing') {
      this.pause('user');
      return Promise.resolve();
    }
    return this.play();
  }

  async seekTo(positionMs: number): Promise<void> {
    if (this.state.index < 0) return;
    const target = clampMs(positionMs, this.state.durationMs);
    this.dispatch({ type: 'seek', positionMs: target });
    if (this.state.source) {
      this.seekInFlight = true;
      try {
        await this.deps.player.seekTo(target);
      } catch {
        /* seek on an unloaded player: the position is re-applied on load */
      } finally {
        this.seekInFlight = false;
      }
    }
    this.reportProgress('seek');
  }

  skipBack(ms: number = SKIP_BACK_MS): Promise<void> {
    return this.seekTo(this.state.positionMs - ms);
  }

  skipForward(ms: number = SKIP_FORWARD_MS): Promise<void> {
    return this.seekTo(this.state.positionMs + ms);
  }

  setRate(rate: number): void {
    const r = clampRate(rate);
    this.dispatch({ type: 'rate', rate: r });
    try {
      this.deps.player.setRate(r);
    } catch {
      /* applied on load */
    }
  }

  /* ------------------------------------------------------ sleep & loop --- */

  /** `null` = off, `'end_of_item'` = stop when the current lesson ends, number = minutes. */
  setSleepTimer(value: number | 'end_of_item' | null): void {
    this.cancelSleepTimer();
    let sleep: SleepTimer;
    if (value === null) sleep = { kind: 'off' };
    else if (value === 'end_of_item') sleep = { kind: 'end_of_item' };
    else {
      const minutes = Math.max(1, Math.round(value));
      sleep = { kind: 'minutes', minutes, endsAt: this.now() + minutes * 60_000 };
      this.sleepHandle = this.setTimer(() => this.onSleepFired(), minutes * 60_000);
    }
    this.dispatch({ type: 'sleep_set', sleep });
  }

  private onSleepFired(): void {
    this.sleepHandle = null;
    this.dispatch({ type: 'sleep_set', sleep: { kind: 'off' } });
    this.deps.onEvent?.({ type: 'sleep_fired' });
    if (this.state.status === 'playing') this.pause('sleep_timer');
  }

  private cancelSleepTimer(): void {
    if (this.sleepHandle) this.clearTimer(this.sleepHandle);
    this.sleepHandle = null;
  }

  setLoop(loop: AbLoop | null): void {
    this.dispatch({ type: 'loop_set', loop });
    if (loop && this.state.loop && (this.state.positionMs < this.state.loop.startMs || this.state.positionMs >= this.state.loop.endMs)) void this.seekTo(this.state.loop.startMs);
  }

  /* ------------------------------------------------------------- load --- */

  private async loadCurrent(afterFailure: boolean): Promise<void> {
    const item = this.current;
    if (!item) return;
    const token = ++this.loadToken;
    this.cancelRenewalTimer();
    this.dispatch({ type: 'load_started' });
    let source: ResolvedSource;
    try {
      source = await this.deps.resolveSource(item, { renewal: afterFailure, afterFailure });
    } catch (error) {
      if (token !== this.loadToken) return;
      this.fail(error);
      return;
    }
    if (token !== this.loadToken || this.disposed) return;
    this.dispatch({ type: 'source_ready', source, renewal: afterFailure });
    try {
      this.deps.player.load(source.uri);
      this.deps.player.setRate(this.state.rate);
      this.deps.player.setLockScreen(true, { title: item.title, artist: item.subtitle ?? undefined, albumTitle: item.subtitle ?? undefined, artworkUrl: item.artworkUri ?? undefined });
      if (this.state.positionMs > 0) await this.deps.player.seekTo(this.state.positionMs);
    } catch (error) {
      if (token !== this.loadToken) return;
      this.fail(error);
      return;
    }
    if (token !== this.loadToken) return;
    this.lastProgressAt = this.now();
    this.lastReportedPosition = -1;
    this.deps.onEvent?.({ type: 'item_started', item });
    this.scheduleRenewalCheck();
    if (this.wantPlaying) {
      await this.deps.player.prepareSession?.().catch(() => undefined);
      if (token !== this.loadToken) return;
      this.dispatch({ type: 'play_requested' });
      this.deps.player.play();
    } else {
      this.dispatch({ type: 'native_status', playing: false, positionMs: this.state.positionMs, durationMs: this.state.durationMs, buffering: false, loaded: true });
    }
  }

  private fail(error: unknown): void {
    const err: AudioEngineError = error instanceof SourceResolutionError ? { code: error.code, message: error.message } : { code: 'playback', message: error instanceof Error ? error.message : 'Playback failed' };
    this.cancelRenewalTimer();
    this.dispatch({ type: 'error', error: err });
    this.deps.onEvent?.({ type: 'error', error: err });
  }

  /* ---------------------------------------------------------- renewal --- */

  private scheduleRenewalCheck(): void {
    this.cancelRenewalTimer();
    const source = this.state.source;
    if (!source || source.kind !== 'remote' || !source.expiresAt) return;
    const remaining = this.state.durationMs !== null ? Math.max(0, this.state.durationMs - this.state.positionMs) : null;
    const decision = renewalDecision({ lease: { expiresAt: source.expiresAt }, now: this.now(), remainingPlaybackMs: remaining, rate: this.state.rate, playing: this.state.status === 'playing' });
    if (decision.renew) {
      void this.swapSource(false);
      return;
    }
    this.renewalHandle = this.setTimer(() => this.scheduleRenewalCheck(), decision.checkAgainInMs);
  }

  private cancelRenewalTimer(): void {
    if (this.renewalHandle) this.clearTimer(this.renewalHandle);
    this.renewalHandle = null;
  }

  /**
   * Fetch a renewed URL and continue at the current position. Proactive swaps
   * happen before expiry; reactive ones after a 403 / playback error (A22).
   */
  private async swapSource(afterFailure: boolean): Promise<void> {
    const item = this.current;
    if (!item || this.state.recovering) return;
    const token = this.loadToken;
    const wasPlaying = this.state.status === 'playing' || this.wantPlaying;
    const position = this.state.positionMs;
    this.dispatch({ type: 'recovering', value: true });
    let source: ResolvedSource;
    try {
      source = await this.deps.resolveSource(item, { renewal: true, afterFailure });
    } catch (error) {
      if (token !== this.loadToken) return;
      this.dispatch({ type: 'recovering', value: false });
      const current = this.state.source;
      const stillValid = !afterFailure && current?.kind === 'remote' && current.expiresAt !== null && !isLeaseExpired({ expiresAt: current.expiresAt }, this.now());
      if (stillValid) {
        // Proactive renewal failed (offline blip, transient API error) but the current URL is
        // still good: keep playing on it and try again shortly, until the lease really expires.
        this.renewalPending = true;
        this.cancelRenewalTimer();
        this.renewalHandle = this.setTimer(() => this.scheduleRenewalCheck(), RENEWAL_RETRY_MS);
        return;
      }
      this.fail(error);
      return;
    }
    this.renewalPending = false;
    if (token !== this.loadToken || this.disposed) return;
    this.dispatch({ type: 'source_ready', source, renewal: true });
    this.deps.onEvent?.({ type: 'url_renewed', assetId: source.assetId, reactive: afterFailure });
    try {
      this.deps.player.load(source.uri);
      this.deps.player.setRate(this.state.rate);
      await this.deps.player.seekTo(position);
      if (wasPlaying) this.deps.player.play();
    } catch (error) {
      if (token !== this.loadToken) return;
      this.dispatch({ type: 'recovering', value: false });
      this.fail(error);
      return;
    }
    if (token !== this.loadToken) return;
    this.dispatch({ type: 'recovering', value: false });
    if (wasPlaying) this.dispatch({ type: 'play_requested' });
    this.scheduleRenewalCheck();
  }

  /* ---------------------------------------------------- native status --- */

  private onNativeStatus(status: NativePlayerStatus): void {
    if (this.disposed || this.state.index < 0 || !this.state.source) return;
    if (status.error) {
      if (this.state.source.kind === 'remote' && !this.state.recovering) {
        void this.swapSource(true);
        return;
      }
      if (!this.state.recovering) this.fail(new Error(status.error));
      return;
    }
    if (status.mediaServicesDidReset && !this.state.recovering) {
      void this.swapSource(false);
      return;
    }
    if (this.state.recovering) return;
    if (status.didJustFinish) {
      this.onEnded();
      return;
    }
    const wasPlaying = this.state.status === 'playing';
    // While a seek is in flight the native position may still be stale; keep ours.
    const positionMs = this.seekInFlight ? this.state.positionMs : status.positionMs;
    this.dispatch({ type: 'native_status', playing: status.playing, positionMs, durationMs: status.durationMs, buffering: status.buffering, loaded: status.loaded });
    if (wasPlaying && this.state.status === 'paused' && this.state.pauseReason === 'interrupted') {
      this.wantPlaying = false;
      this.deps.onEvent?.({ type: 'interrupted' });
      this.reportProgress('pause');
      return;
    }
    if (this.state.status === 'playing') {
      const jump = loopJump(this.state, this.state.positionMs);
      if (jump !== null) {
        void this.seekTo(jump);
        return;
      }
      const now = this.now();
      if (now - this.lastProgressAt >= this.progressIntervalMs) {
        this.lastProgressAt = now;
        this.reportProgress('tick');
      }
    }
  }

  private onEnded(): void {
    const item = this.current;
    const behaviour = endBehaviour(this.state);
    if (behaviour.kind === 'loop_back') {
      void this.seekTo(behaviour.toMs).then(() => this.deps.player.play());
      return;
    }
    this.dispatch({ type: 'ended' });
    if (item) {
      this.reportProgress('ended');
      this.deps.onEvent?.({ type: 'item_finished', item });
    }
    if (behaviour.kind === 'advance') {
      void this.selectIndex(behaviour.toIndex, { autoplay: true });
      return;
    }
    if (behaviour.kind === 'stop_sleep') {
      this.wantPlaying = false;
      this.dispatch({ type: 'sleep_set', sleep: { kind: 'off' } });
      this.deps.onEvent?.({ type: 'sleep_fired' });
      return;
    }
    this.wantPlaying = false;
  }

  /* --------------------------------------------------------- progress --- */

  private reportProgress(reason: ProgressReason): void {
    const item = this.current;
    if (!item || !this.deps.onProgress) return;
    if (!this.state.source && reason !== 'stop' && reason !== 'switch') return;
    const positionMs = this.state.positionMs;
    if (reason === 'tick' && positionMs === this.lastReportedPosition) return;
    this.lastReportedPosition = positionMs;
    const completed = reason === 'ended' || isCompleted(positionMs, this.state.durationMs);
    this.deps.onProgress({ item, positionMs, durationMs: this.state.durationMs, completed, reason });
  }

  /** Release the native player. The engine cannot be used afterwards. */
  dispose(): void {
    this.disposed = true;
    this.reportProgress('stop');
    this.cancelSleepTimer();
    this.cancelRenewalTimer();
    this.unsubscribeNative?.();
    this.unsubscribeNative = null;
    try {
      this.deps.player.release();
    } catch {
      /* already released */
    }
    this.listeners.clear();
  }
}
