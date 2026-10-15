/**
 * Pure state for the long-form audio engine (ADR-001). Everything that can be
 * decided without touching the native player lives here so the queue, sleep
 * timer, A/B loop, chapter advance and interruption semantics are unit-tested
 * in Node. `AudioEngine` applies these transitions to `expo-audio`.
 */

export type AudioEngineStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/** Why the engine is paused (surfaced honestly in the UI). */
export type PauseReason = 'user' | 'interrupted' | 'route_changed' | 'sleep_timer' | 'offline_no_link' | null;

export type AudioEngineErrorCode = 'playback' | 'source_unavailable' | 'offline_no_link' | 'unsupported' | 'rights_blocked';

export interface AudioEngineError {
  code: AudioEngineErrorCode;
  message: string;
}

/** One playable library lesson in the queue. */
export interface QueueItem {
  /** Lesson id (stable key for progress + bookmarks). */
  id: string;
  collectionId: string;
  chapterId: string;
  title: string;
  /** Collection / chapter line shown under the title and on the lock screen. */
  subtitle: string | null;
  artworkUri: string | null;
  /** Preferred playable asset id (resolved lazily to a URL or local file). */
  assetId: string;
  durationMs: number | null;
  attributionText: string | null;
  /** Course track the collection belongs to (for the course header), when known. */
  courseTrackId: string | null;
}

export interface ResolvedSource {
  uri: string;
  kind: 'local' | 'remote';
  /** ISO expiry for signed remote URLs; null for local files or proxies without expiry. */
  expiresAt: string | null;
  /** Asset actually resolved (may differ from the preferred one when the server picked a rendition). */
  assetId: string;
}

export type SleepTimer = { kind: 'off' } | { kind: 'minutes'; endsAt: number; minutes: number } | { kind: 'end_of_item' };

export interface AbLoop {
  startMs: number;
  endMs: number;
}

export interface AudioEngineState {
  status: AudioEngineStatus;
  queue: readonly QueueItem[];
  index: number;
  positionMs: number;
  durationMs: number | null;
  rate: number;
  buffering: boolean;
  pauseReason: PauseReason;
  error: AudioEngineError | null;
  source: ResolvedSource | null;
  sleep: SleepTimer;
  loop: AbLoop | null;
  /** Number of URL renewals performed for the current item (diagnostics + loop guard). */
  renewals: number;
  /** True while a renewed URL is being swapped in; the UI keeps showing the last position. */
  recovering: boolean;
}

export const INITIAL_ENGINE_STATE: AudioEngineState = {
  status: 'idle',
  queue: [],
  index: -1,
  positionMs: 0,
  durationMs: null,
  rate: 1,
  buffering: false,
  pauseReason: null,
  error: null,
  source: null,
  sleep: { kind: 'off' },
  loop: null,
  renewals: 0,
  recovering: false,
};

export const SKIP_BACK_MS = 10_000;
export const SKIP_FORWARD_MS = 15_000;
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2;
/** A lesson counts as finished when the position is within this margin of the end. */
export const COMPLETION_MARGIN_MS = 3_000;

export type EngineAction =
  | { type: 'queue_set'; queue: readonly QueueItem[]; index: number; positionMs: number }
  | { type: 'item_selected'; index: number; positionMs: number }
  | { type: 'load_started' }
  | { type: 'source_ready'; source: ResolvedSource; renewal: boolean }
  | { type: 'native_status'; playing: boolean; positionMs: number; durationMs: number | null; buffering: boolean; loaded: boolean }
  | { type: 'play_requested' }
  | { type: 'pause_requested'; reason: Exclude<PauseReason, null> }
  | { type: 'interrupted' }
  | { type: 'seek'; positionMs: number }
  | { type: 'rate'; rate: number }
  | { type: 'ended' }
  | { type: 'error'; error: AudioEngineError }
  | { type: 'recovering'; value: boolean }
  | { type: 'sleep_set'; sleep: SleepTimer }
  | { type: 'loop_set'; loop: AbLoop | null }
  | { type: 'stopped' };

export const clampMs = (ms: number, durationMs: number | null): number => {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return durationMs !== null && durationMs > 0 ? Math.min(ms, durationMs) : ms;
};

export const clampRate = (rate: number): number => (Number.isFinite(rate) ? Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rate)) : 1);

export function currentItem(state: AudioEngineState): QueueItem | null {
  return state.index >= 0 ? (state.queue[state.index] ?? null) : null;
}

export function hasNext(state: AudioEngineState): boolean {
  return state.index >= 0 && state.index < state.queue.length - 1;
}

export function hasPrevious(state: AudioEngineState): boolean {
  return state.index > 0;
}

/** Deterministic transition function. Unknown combinations return the same state object. */
export function reduceEngine(state: AudioEngineState, action: EngineAction): AudioEngineState {
  switch (action.type) {
    case 'queue_set': {
      const index = action.queue.length === 0 ? -1 : Math.min(Math.max(0, action.index), action.queue.length - 1);
      const item = index >= 0 ? action.queue[index]! : null;
      return {
        ...state,
        queue: action.queue,
        index,
        status: item ? 'loading' : 'idle',
        positionMs: item ? clampMs(action.positionMs, item.durationMs) : 0,
        durationMs: item?.durationMs ?? null,
        buffering: false,
        pauseReason: null,
        error: null,
        source: null,
        loop: null,
        renewals: 0,
        recovering: false,
        sleep: state.sleep.kind === 'end_of_item' ? { kind: 'off' } : state.sleep,
      };
    }
    case 'item_selected': {
      if (action.index < 0 || action.index >= state.queue.length) return state;
      const item = state.queue[action.index]!;
      return {
        ...state,
        index: action.index,
        status: 'loading',
        positionMs: clampMs(action.positionMs, item.durationMs),
        durationMs: item.durationMs,
        buffering: false,
        pauseReason: null,
        error: null,
        source: null,
        loop: null,
        renewals: 0,
        recovering: false,
      };
    }
    case 'load_started':
      return state.status === 'loading' ? state : { ...state, status: 'loading', error: null };
    case 'source_ready':
      return { ...state, source: action.source, error: null, renewals: action.renewal ? state.renewals + 1 : state.renewals };
    case 'native_status': {
      if (state.status === 'idle' || state.status === 'error') return state;
      const durationMs = action.durationMs && action.durationMs > 0 ? action.durationMs : state.durationMs;
      const positionMs = state.recovering ? state.positionMs : clampMs(action.positionMs, durationMs);
      let status: AudioEngineStatus = state.status;
      let pauseReason = state.pauseReason;
      if (action.playing) {
        status = 'playing';
        pauseReason = null;
      } else if (state.status === 'playing' && action.loaded && !state.recovering) {
        // The OS stopped us (phone call, headphones unplugged, another app took focus).
        status = 'paused';
        pauseReason = 'interrupted';
      } else if (state.status === 'loading' && action.loaded) {
        status = 'paused';
      }
      if (status === state.status && pauseReason === state.pauseReason && positionMs === state.positionMs && durationMs === state.durationMs && action.buffering === state.buffering) return state;
      return { ...state, status, pauseReason, positionMs, durationMs, buffering: action.buffering };
    }
    case 'play_requested':
      if (state.index < 0) return state;
      return { ...state, status: state.source ? 'playing' : 'loading', pauseReason: null, error: null };
    case 'pause_requested':
      if (state.status !== 'playing' && state.status !== 'loading') return state;
      return { ...state, status: 'paused', pauseReason: action.reason };
    case 'interrupted':
      if (state.status !== 'playing') return state;
      return { ...state, status: 'paused', pauseReason: 'interrupted' };
    case 'seek':
      if (state.index < 0) return state;
      return { ...state, positionMs: clampMs(action.positionMs, state.durationMs), status: state.status === 'ended' ? 'paused' : state.status };
    case 'rate':
      return { ...state, rate: clampRate(action.rate) };
    case 'ended':
      return { ...state, status: 'ended', positionMs: state.durationMs ?? state.positionMs, pauseReason: null, buffering: false };
    case 'error':
      return { ...state, status: 'error', error: action.error, buffering: false, recovering: false };
    case 'recovering':
      return { ...state, recovering: action.value };
    case 'sleep_set':
      return { ...state, sleep: action.sleep };
    case 'loop_set': {
      if (!action.loop) return { ...state, loop: null };
      const startMs = clampMs(Math.min(action.loop.startMs, action.loop.endMs), state.durationMs);
      const endMs = clampMs(Math.max(action.loop.startMs, action.loop.endMs), state.durationMs);
      if (endMs <= startMs) return { ...state, loop: null };
      return { ...state, loop: { startMs, endMs } };
    }
    case 'stopped':
      return { ...INITIAL_ENGINE_STATE, rate: state.rate, sleep: state.sleep.kind === 'minutes' ? state.sleep : { kind: 'off' } };
    default:
      return state;
  }
}

/** What to do when the native player reports that the item finished. */
export type EndBehaviour = { kind: 'loop_back'; toMs: number } | { kind: 'advance'; toIndex: number } | { kind: 'stop_sleep' } | { kind: 'finish' };

export function endBehaviour(state: AudioEngineState): EndBehaviour {
  if (state.loop) return { kind: 'loop_back', toMs: state.loop.startMs };
  if (state.sleep.kind === 'end_of_item') return { kind: 'stop_sleep' };
  if (hasNext(state)) return { kind: 'advance', toIndex: state.index + 1 };
  return { kind: 'finish' };
}

/** A/B loop: when the playhead passes B, jump back to A. */
export function loopJump(state: AudioEngineState, positionMs: number): number | null {
  if (!state.loop) return null;
  return positionMs >= state.loop.endMs ? state.loop.startMs : null;
}

/** Milliseconds until the minute-based sleep timer fires (null when off / end-of-item). */
export function sleepRemainingMs(sleep: SleepTimer, now: number): number | null {
  return sleep.kind === 'minutes' ? Math.max(0, sleep.endsAt - now) : null;
}

/** Whether a position counts as "finished" for listening progress. */
export function isCompleted(positionMs: number, durationMs: number | null): boolean {
  return durationMs !== null && durationMs > 0 && positionMs >= durationMs - COMPLETION_MARGIN_MS;
}

/** Position to resume from: restart lessons that were finished, otherwise the saved position. */
export function resumePosition(savedPositionMs: number, durationMs: number | null, completed: boolean): number {
  if (completed || isCompleted(savedPositionMs, durationMs)) return 0;
  return clampMs(savedPositionMs, durationMs);
}
