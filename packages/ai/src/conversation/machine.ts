/**
 * Pure conversation state machine for §8.3: preparing → connecting → listening → speech_detected →
 * interpreting → responding → listening, plus paused / interrupted / recoverable_error / finished.
 *
 * The reducer is side-effect free: it returns the next state plus a list of `Effect`s the orchestrator must
 * perform (stop TTS, cancel an in-flight LLM request, resubmit a preserved learner turn, emit an event).
 * Invariants enforced here: barge-in stops TTS and cancels the pending response (no duplicate reply);
 * a disconnect never drops the last learner turn; stale completions are ignored.
 */
import { canTransition, type ConversationCommand, type ConversationMode, type ConversationState } from '@langquest/contracts';

export interface PendingLearnerTurn {
  learnerTurnId: string;
  /** Transcript or text when already known (audio-only turns carry null until STT completes). */
  text: string | null;
  audioRef: string | null;
  receivedAt: string;
}

export interface MachineState {
  sessionId: string;
  mode: ConversationMode;
  state: ConversationState;
  /** State to return to after `recoverable_error` / `paused` (always a safe listening-type state). */
  safeState: Extract<ConversationState, 'connecting' | 'listening'>;
  seq: number;
  turnCount: number;
  /** Learner turn captured but not yet answered — preserved across disconnects. */
  pendingLearnerTurn: PendingLearnerTurn | null;
  lastLearnerTurnId: string | null;
  lastCharacterTurnId: string | null;
  /** LLM request currently producing a reply (cancelled on barge-in). */
  responseInFlight: { requestId: string; learnerTurnId: string } | null;
  /** Character turn currently being spoken (TTS playing). */
  speakingTurnId: string | null;
  objectivesCompleted: string[];
  endedReason: 'completed' | 'learner_ended' | 'timeout' | 'error' | 'abandoned' | null;
  /** Consecutive recoverable errors; the orchestrator may finish after too many. */
  errorCount: number;
}

export type MachineEvent =
  | { type: 'start' }
  | { type: 'connected' }
  | { type: 'speech_started'; learnerTurnId: string; at: string }
  | { type: 'speech_ended'; learnerTurnId: string; text: string | null; audioRef: string | null }
  | { type: 'text_submitted'; learnerTurnId: string; text: string; at: string }
  | { type: 'transcript_final'; learnerTurnId: string; text: string }
  | { type: 'response_started'; requestId: string; learnerTurnId: string }
  | { type: 'response_ready'; requestId: string; characterTurnId: string; objectivesCompleted?: string[]; endsConversation?: boolean }
  | { type: 'response_failed'; requestId: string; recoverable: boolean; code: string }
  | { type: 'tts_started'; characterTurnId: string }
  | { type: 'tts_finished'; characterTurnId: string }
  | { type: 'barge_in'; learnerTurnId: string; at: string }
  | { type: 'command'; command: ConversationCommand; learnerTurnId: string; at: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'disconnect'; code: string }
  | { type: 'reconnect' }
  | { type: 'end'; reason: 'completed' | 'learner_ended' | 'timeout' | 'abandoned' }
  | { type: 'fatal'; code: string };

export type Effect =
  | { type: 'stop_tts'; characterTurnId: string }
  | { type: 'cancel_response'; requestId: string }
  | { type: 'start_response'; learnerTurnId: string; text: string | null; audioRef: string | null; command: ConversationCommand | null }
  | { type: 'start_stt'; learnerTurnId: string; audioRef: string | null }
  | { type: 'resubmit_learner_turn'; turn: PendingLearnerTurn }
  | { type: 'emit'; event: EmittedEvent }
  | { type: 'log'; level: 'warn' | 'info'; message: string };

/** Minimal event payloads; the orchestrator fills `sessionId`, `at`, `seq` to build contract `ConversationEvent`s. */
export type EmittedEvent =
  | { type: 'state_changed'; from: ConversationState; to: ConversationState }
  | { type: 'speech_started' }
  | { type: 'speech_ended' }
  | { type: 'barge_in'; interruptedTurnId: string }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'command'; command: ConversationCommand }
  | { type: 'error'; code: string; recoverable: boolean }
  | { type: 'recovered'; resumedFromSeq: number }
  | { type: 'finished'; reason: NonNullable<MachineState['endedReason']> };

export interface ReduceResult {
  state: MachineState;
  effects: Effect[];
}

export function createMachine(sessionId: string, mode: ConversationMode): MachineState {
  return {
    sessionId,
    mode,
    state: 'preparing',
    safeState: 'connecting',
    seq: 0,
    turnCount: 0,
    pendingLearnerTurn: null,
    lastLearnerTurnId: null,
    lastCharacterTurnId: null,
    responseInFlight: null,
    speakingTurnId: null,
    objectivesCompleted: [],
    endedReason: null,
    errorCount: 0,
  };
}

/** Transition helper: validates against the contract table and records a `state_changed` effect. */
function go(state: MachineState, to: ConversationState, effects: Effect[]): MachineState {
  if (state.state === to) return state;
  if (!canTransition(state.state, to)) {
    effects.push({ type: 'log', level: 'warn', message: `Invalid transition ${state.state} → ${to} ignored` });
    return state;
  }
  effects.push({ type: 'emit', event: { type: 'state_changed', from: state.state, to } });
  const safeState = to === 'listening' ? 'listening' : state.safeState;
  return { ...state, state: to, safeState, seq: state.seq + 1 };
}

const interruptSpeaking = (state: MachineState, effects: Effect[]): MachineState => {
  let next = state;
  if (next.speakingTurnId) {
    effects.push({ type: 'stop_tts', characterTurnId: next.speakingTurnId });
    effects.push({ type: 'emit', event: { type: 'barge_in', interruptedTurnId: next.speakingTurnId } });
    next = { ...next, speakingTurnId: null };
  }
  if (next.responseInFlight) {
    effects.push({ type: 'cancel_response', requestId: next.responseInFlight.requestId });
    next = { ...next, responseInFlight: null };
  }
  return next;
};

export function reduce(state: MachineState, event: MachineEvent): ReduceResult {
  const effects: Effect[] = [];
  let next = state;
  if (state.state === 'finished') return { state, effects: [{ type: 'log', level: 'warn', message: `Event ${event.type} after finish ignored` }] };

  switch (event.type) {
    case 'start':
      next = go(next, 'connecting', effects);
      break;

    case 'connected':
      next = go(next, 'listening', effects);
      if (next.state === 'listening') {
        next = { ...next, errorCount: 0 };
        if (next.pendingLearnerTurn && !next.responseInFlight) {
          effects.push({ type: 'resubmit_learner_turn', turn: next.pendingLearnerTurn });
        }
      }
      break;

    case 'speech_started': {
      if (next.state === 'responding') {
        next = interruptSpeaking(next, effects);
        next = go(next, 'interrupted', effects);
        next = go(next, 'speech_detected', effects);
      } else if (next.state === 'listening' || next.state === 'interrupted') {
        next = go(next, 'speech_detected', effects);
      } else {
        effects.push({ type: 'log', level: 'warn', message: `speech_started ignored in ${next.state}` });
        break;
      }
      next = { ...next, pendingLearnerTurn: { learnerTurnId: event.learnerTurnId, text: null, audioRef: null, receivedAt: event.at } };
      effects.push({ type: 'emit', event: { type: 'speech_started' } });
      break;
    }

    case 'speech_ended': {
      if (next.state !== 'speech_detected') {
        effects.push({ type: 'log', level: 'warn', message: `speech_ended ignored in ${next.state}` });
        break;
      }
      effects.push({ type: 'emit', event: { type: 'speech_ended' } });
      const turn: PendingLearnerTurn = { learnerTurnId: event.learnerTurnId, text: event.text, audioRef: event.audioRef, receivedAt: next.pendingLearnerTurn?.receivedAt ?? new Date(0).toISOString() };
      next = { ...next, pendingLearnerTurn: turn, lastLearnerTurnId: event.learnerTurnId };
      next = go(next, 'interpreting', effects);
      if (event.text === null) effects.push({ type: 'start_stt', learnerTurnId: event.learnerTurnId, audioRef: event.audioRef });
      else effects.push({ type: 'start_response', learnerTurnId: event.learnerTurnId, text: event.text, audioRef: event.audioRef, command: null });
      break;
    }

    case 'text_submitted': {
      if (next.state === 'responding') {
        next = interruptSpeaking(next, effects);
        next = go(next, 'interrupted', effects);
        next = go(next, 'speech_detected', effects);
      } else if (next.state === 'listening' || next.state === 'interrupted') {
        next = go(next, 'speech_detected', effects);
      } else {
        // Not ready (connecting / error / paused): keep the turn so it is never lost.
        next = { ...next, pendingLearnerTurn: { learnerTurnId: event.learnerTurnId, text: event.text, audioRef: null, receivedAt: event.at } };
        effects.push({ type: 'log', level: 'info', message: `text queued while ${next.state}` });
        break;
      }
      next = { ...next, pendingLearnerTurn: { learnerTurnId: event.learnerTurnId, text: event.text, audioRef: null, receivedAt: event.at }, lastLearnerTurnId: event.learnerTurnId };
      next = go(next, 'interpreting', effects);
      effects.push({ type: 'start_response', learnerTurnId: event.learnerTurnId, text: event.text, audioRef: null, command: null });
      break;
    }

    case 'transcript_final': {
      if (next.pendingLearnerTurn?.learnerTurnId !== event.learnerTurnId) {
        effects.push({ type: 'log', level: 'warn', message: 'stale transcript ignored' });
        break;
      }
      const pending: PendingLearnerTurn = { ...next.pendingLearnerTurn, text: event.text };
      next = { ...next, pendingLearnerTurn: pending };
      if (next.state === 'interpreting' && !next.responseInFlight) {
        effects.push({ type: 'start_response', learnerTurnId: event.learnerTurnId, text: event.text, audioRef: pending.audioRef, command: null });
      }
      break;
    }

    case 'command': {
      effects.push({ type: 'emit', event: { type: 'command', command: event.command } });
      if (next.state === 'responding') {
        next = interruptSpeaking(next, effects);
        next = go(next, 'interrupted', effects);
        next = go(next, 'speech_detected', effects);
      } else if (next.state === 'listening' || next.state === 'interrupted') {
        next = go(next, 'speech_detected', effects);
      } else {
        effects.push({ type: 'log', level: 'warn', message: `command ignored in ${next.state}` });
        break;
      }
      next = { ...next, pendingLearnerTurn: { learnerTurnId: event.learnerTurnId, text: null, audioRef: null, receivedAt: event.at }, lastLearnerTurnId: event.learnerTurnId };
      next = go(next, 'interpreting', effects);
      effects.push({ type: 'start_response', learnerTurnId: event.learnerTurnId, text: null, audioRef: null, command: event.command });
      break;
    }

    case 'response_started': {
      if (next.pendingLearnerTurn?.learnerTurnId !== event.learnerTurnId) {
        effects.push({ type: 'log', level: 'warn', message: 'response_started for a turn that is no longer pending' });
        break;
      }
      if (next.responseInFlight && next.responseInFlight.requestId !== event.requestId) {
        // Guard against duplicate LLM responses for the same learner turn.
        effects.push({ type: 'cancel_response', requestId: event.requestId });
        effects.push({ type: 'log', level: 'warn', message: 'duplicate response_started cancelled' });
        break;
      }
      next = { ...next, responseInFlight: { requestId: event.requestId, learnerTurnId: event.learnerTurnId } };
      break;
    }

    case 'response_ready': {
      if (!next.responseInFlight || next.responseInFlight.requestId !== event.requestId) {
        effects.push({ type: 'log', level: 'warn', message: `stale response ${event.requestId} ignored (no duplicate reply)` });
        break;
      }
      next = { ...next, responseInFlight: null, pendingLearnerTurn: null, lastCharacterTurnId: event.characterTurnId, turnCount: next.turnCount + 1, objectivesCompleted: [...new Set([...next.objectivesCompleted, ...(event.objectivesCompleted ?? [])])] };
      next = go(next, 'responding', effects);
      if (event.endsConversation) {
        next = { ...next, endedReason: 'completed' };
      }
      break;
    }

    case 'response_failed': {
      if (!next.responseInFlight || next.responseInFlight.requestId !== event.requestId) break;
      next = { ...next, responseInFlight: null, errorCount: next.errorCount + 1 };
      effects.push({ type: 'emit', event: { type: 'error', code: event.code, recoverable: event.recoverable } });
      if (event.recoverable) {
        next = go(next, 'recoverable_error', effects);
      } else {
        next = { ...next, endedReason: 'error' };
        next = go(next, 'finished', effects);
        effects.push({ type: 'emit', event: { type: 'finished', reason: 'error' } });
      }
      break;
    }

    case 'tts_started':
      if (next.state === 'responding') next = { ...next, speakingTurnId: event.characterTurnId };
      break;

    case 'tts_finished': {
      if (next.speakingTurnId !== event.characterTurnId) break;
      next = { ...next, speakingTurnId: null };
      if (next.state !== 'responding') break;
      if (next.endedReason === 'completed') {
        next = go(next, 'finished', effects);
        effects.push({ type: 'emit', event: { type: 'finished', reason: 'completed' } });
      } else {
        next = go(next, 'listening', effects);
      }
      break;
    }

    case 'barge_in': {
      if (next.state !== 'responding') {
        effects.push({ type: 'log', level: 'info', message: `barge_in while ${next.state}: treated as speech_started` });
      }
      return reduce(next, { type: 'speech_started', learnerTurnId: event.learnerTurnId, at: event.at });
    }

    case 'pause': {
      if (next.state === 'responding') next = interruptSpeaking(next, effects);
      next = go(next, 'paused', effects);
      effects.push({ type: 'emit', event: { type: 'paused' } });
      break;
    }

    case 'resume': {
      if (next.state !== 'paused') break;
      next = go(next, 'listening', effects);
      effects.push({ type: 'emit', event: { type: 'resumed' } });
      if (next.pendingLearnerTurn) effects.push({ type: 'resubmit_learner_turn', turn: next.pendingLearnerTurn });
      break;
    }

    case 'disconnect': {
      if (next.state === 'responding') next = interruptSpeaking(next, effects);
      else if (next.responseInFlight) {
        effects.push({ type: 'cancel_response', requestId: next.responseInFlight.requestId });
        next = { ...next, responseInFlight: null };
      }
      effects.push({ type: 'emit', event: { type: 'error', code: event.code, recoverable: true } });
      next = { ...next, errorCount: next.errorCount + 1 };
      if (next.state === 'paused') {
        // paused → connecting is allowed; keep the pending turn for resume.
        next = go(next, 'connecting', effects);
      } else {
        next = go(next, 'recoverable_error', effects);
      }
      break;
    }

    case 'reconnect': {
      if (next.state !== 'recoverable_error' && next.state !== 'paused') break;
      const resumedFromSeq = next.seq;
      next = go(next, 'connecting', effects);
      effects.push({ type: 'emit', event: { type: 'recovered', resumedFromSeq } });
      break;
    }

    case 'end': {
      if (next.state === 'responding') next = interruptSpeaking(next, effects);
      else if (next.responseInFlight) {
        effects.push({ type: 'cancel_response', requestId: next.responseInFlight.requestId });
        next = { ...next, responseInFlight: null };
      }
      next = { ...next, endedReason: event.reason };
      next = go(next, 'finished', effects);
      effects.push({ type: 'emit', event: { type: 'finished', reason: event.reason } });
      break;
    }

    case 'fatal': {
      if (next.state === 'responding') next = interruptSpeaking(next, effects);
      effects.push({ type: 'emit', event: { type: 'error', code: event.code, recoverable: false } });
      next = { ...next, endedReason: 'error' };
      next = go(next, 'finished', effects);
      effects.push({ type: 'emit', event: { type: 'finished', reason: 'error' } });
      break;
    }
  }
  return { state: next, effects };
}

/** Apply a list of events in order (handy in tests and replay). */
export function replay(initial: MachineState, events: readonly MachineEvent[]): ReduceResult {
  let state = initial;
  const effects: Effect[] = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
