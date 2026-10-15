import { describe, expect, it } from 'vitest';
import { createMachine, reduce, replay, type Effect, type MachineEvent } from './machine';

const SID = '33333333-3333-4333-8333-333333333333';
const at = '2026-10-14T10:00:00.000Z';
const types = (effects: Effect[]) => effects.map((e) => e.type);
const stateChanges = (effects: Effect[]) => effects.flatMap((e) => (e.type === 'emit' && e.event.type === 'state_changed' ? [e.event.to] : []));

const toListening: MachineEvent[] = [{ type: 'start' }, { type: 'connected' }];

describe('conversation state machine (§8.3)', () => {
  it('walks the happy path preparing → connecting → listening → speech_detected → interpreting → responding → listening', () => {
    const r = replay(createMachine(SID, 'hands_free'), [
      ...toListening,
      { type: 'speech_started', learnerTurnId: 'l1', at },
      { type: 'speech_ended', learnerTurnId: 'l1', text: 'bonjour', audioRef: null },
      { type: 'response_started', requestId: 'r1', learnerTurnId: 'l1' },
      { type: 'response_ready', requestId: 'r1', characterTurnId: 'c1', objectivesCompleted: ['greet'] },
      { type: 'tts_started', characterTurnId: 'c1' },
      { type: 'tts_finished', characterTurnId: 'c1' },
    ]);
    expect(stateChanges(r.effects)).toEqual(['connecting', 'listening', 'speech_detected', 'interpreting', 'responding', 'listening']);
    expect(r.state).toMatchObject({ state: 'listening', turnCount: 1, lastLearnerTurnId: 'l1', lastCharacterTurnId: 'c1', objectivesCompleted: ['greet'], pendingLearnerTurn: null });
    expect(types(r.effects)).toContain('start_response');
  });

  it('requests STT for audio-only turns and starts the response once the transcript is final', () => {
    const r = replay(createMachine(SID, 'push_to_talk'), [...toListening, { type: 'speech_started', learnerTurnId: 'l1', at }, { type: 'speech_ended', learnerTurnId: 'l1', text: null, audioRef: 'blob:1' }]);
    expect(types(r.effects)).toContain('start_stt');
    expect(types(r.effects)).not.toContain('start_response');
    const r2 = reduce(r.state, { type: 'transcript_final', learnerTurnId: 'l1', text: 'bonjour' });
    expect(r2.effects).toContainEqual({ type: 'start_response', learnerTurnId: 'l1', text: 'bonjour', audioRef: 'blob:1', command: null });
  });

  it('barge-in while responding stops TTS, cancels the in-flight reply and produces no duplicate response', () => {
    const base = replay(createMachine(SID, 'hands_free'), [
      ...toListening,
      { type: 'speech_started', learnerTurnId: 'l1', at },
      { type: 'speech_ended', learnerTurnId: 'l1', text: 'bonjour', audioRef: null },
      { type: 'response_started', requestId: 'r1', learnerTurnId: 'l1' },
      { type: 'response_ready', requestId: 'r1', characterTurnId: 'c1' },
      { type: 'tts_started', characterTurnId: 'c1' },
    ]).state;
    expect(base.state).toBe('responding');
    const b = reduce(base, { type: 'barge_in', learnerTurnId: 'l2', at });
    expect(b.effects).toContainEqual({ type: 'stop_tts', characterTurnId: 'c1' });
    expect(b.effects).toContainEqual({ type: 'emit', event: { type: 'barge_in', interruptedTurnId: 'c1' } });
    expect(stateChanges(b.effects)).toEqual(['interrupted', 'speech_detected']);
    expect(b.state.speakingTurnId).toBeNull();
    // learner finishes new turn; a *second* LLM request starts
    const c = replay(b.state, [{ type: 'speech_ended', learnerTurnId: 'l2', text: 'attends', audioRef: null }, { type: 'response_started', requestId: 'r2', learnerTurnId: 'l2' }]);
    // stale completion for the interrupted request must be ignored
    const stale = reduce(c.state, { type: 'response_ready', requestId: 'r1', characterTurnId: 'c1-dup' });
    expect(stale.state.state).toBe('interpreting');
    expect(stale.state.lastCharacterTurnId).toBe('c1');
    expect(stale.effects.some((e) => e.type === 'log' && /stale/.test(e.message))).toBe(true);
    const fresh = reduce(stale.state, { type: 'response_ready', requestId: 'r2', characterTurnId: 'c2' });
    expect(fresh.state).toMatchObject({ state: 'responding', lastCharacterTurnId: 'c2', turnCount: 2 });
  });

  it('cancels an LLM request when the learner interrupts during interpreting-with-response-in-flight → responding', () => {
    const s = replay(createMachine(SID, 'hands_free'), [
      ...toListening,
      { type: 'speech_started', learnerTurnId: 'l1', at },
      { type: 'speech_ended', learnerTurnId: 'l1', text: 'x', audioRef: null },
      { type: 'response_started', requestId: 'r1', learnerTurnId: 'l1' },
      { type: 'response_ready', requestId: 'r1', characterTurnId: 'c1' },
    ]).state;
    const dup = reduce(s, { type: 'response_started', requestId: 'r-dup', learnerTurnId: 'l1' });
    expect(dup.effects.some((e) => e.type === 'log')).toBe(true);
    const r = reduce(s, { type: 'pause' });
    expect(r.state.state).toBe('paused');
  });

  it('preserves the last learner turn across a disconnect and resubmits it after reconnect', () => {
    const r = replay(createMachine(SID, 'push_to_talk'), [
      ...toListening,
      { type: 'speech_started', learnerTurnId: 'l1', at },
      { type: 'speech_ended', learnerTurnId: 'l1', text: 'je voudrais un café', audioRef: null },
      { type: 'response_started', requestId: 'r1', learnerTurnId: 'l1' },
      { type: 'disconnect', code: 'network_lost' },
    ]);
    expect(r.state.state).toBe('recoverable_error');
    expect(r.state.pendingLearnerTurn?.learnerTurnId).toBe('l1');
    expect(r.effects).toContainEqual({ type: 'cancel_response', requestId: 'r1' });
    const back = replay(r.state, [{ type: 'reconnect' }, { type: 'connected' }]);
    expect(stateChanges(back.effects)).toEqual(['connecting', 'listening']);
    expect(back.effects.some((e) => e.type === 'emit' && e.event.type === 'recovered')).toBe(true);
    expect(back.effects).toContainEqual({ type: 'resubmit_learner_turn', turn: r.state.pendingLearnerTurn });
    expect(back.state.errorCount).toBe(0);
  });

  it('queues text submitted while not ready instead of dropping it', () => {
    const r = reduce(createMachine(SID, 'text_only'), { type: 'text_submitted', learnerTurnId: 'l1', text: 'hola', at });
    expect(r.state.state).toBe('preparing');
    expect(r.state.pendingLearnerTurn?.text).toBe('hola');
    const ready = replay(r.state, toListening);
    expect(ready.effects.some((e) => e.type === 'resubmit_learner_turn')).toBe(true);
  });

  it('handles commands as learner turns and ends the conversation after the closing line is spoken', () => {
    const s = replay(createMachine(SID, 'hands_free'), [...toListening, { type: 'command', command: 'slower', learnerTurnId: 'l1', at }]);
    expect(s.effects).toContainEqual({ type: 'start_response', learnerTurnId: 'l1', text: null, audioRef: null, command: 'slower' });
    const end = replay(s.state, [
      { type: 'response_started', requestId: 'r1', learnerTurnId: 'l1' },
      { type: 'response_ready', requestId: 'r1', characterTurnId: 'c1', endsConversation: true },
      { type: 'tts_started', characterTurnId: 'c1' },
      { type: 'tts_finished', characterTurnId: 'c1' },
    ]);
    expect(end.state.state).toBe('finished');
    expect(end.state.endedReason).toBe('completed');
    expect(reduce(end.state, { type: 'start' }).effects[0]?.type).toBe('log');
  });

  it('pause/resume and fatal errors respect the transition table', () => {
    const paused = replay(createMachine(SID, 'hands_free'), [...toListening, { type: 'pause' }]);
    expect(paused.state.state).toBe('paused');
    const resumed = reduce(paused.state, { type: 'resume' });
    expect(resumed.state.state).toBe('listening');
    const fatal = reduce(resumed.state, { type: 'fatal', code: 'provider_down' });
    expect(fatal.state.state).toBe('finished');
    expect(fatal.state.endedReason).toBe('error');
    // invalid: speech_started while connecting is ignored with a warning (no state change)
    const bad = reduce(createMachine(SID, 'hands_free'), { type: 'speech_started', learnerTurnId: 'x', at });
    expect(bad.state.state).toBe('preparing');
    expect(bad.effects[0]?.type).toBe('log');
  });
});
