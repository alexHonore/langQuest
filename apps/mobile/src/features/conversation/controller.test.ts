import type { Capability, CharacterTurn, ConversationSessionCreateResponse, ConversationTurnRequest, ConversationTurnResponse } from '@langquest/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ConversationController, type ConversationEndBody, type RecordedClip, type SynthesizeResponse, type TranscribeResponse } from './controller';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = uuid(1);
const CHARACTER = uuid(2);

const capability: Capability = { supported: true, reasons: [], features: { word: false, phoneme: false, tone: false, prosody: false, streaming: false, interruptible: true, codeSwitch: false, multiSpeaker: false }, latencyClass: 'interactive', effectiveLocale: 'es-ES', qualityEstimate: 0.8, provider: 'pipeline', notes: [] };

const characterTurn = (n: number, over: Partial<CharacterTurn> = {}): CharacterTurn => ({
  turnId: uuid(100 + n),
  characterId: CHARACTER,
  text: `Hola ${n}`,
  transliteration: null,
  sourceGloss: `Hello ${n}`,
  expression: 'greeting',
  respondsToCommand: null,
  tentativeObjectiveIds: [],
  audio: { assetId: null, url: `https://cdn.test/turn-${n}.mp3`, durationMs: 800, synthetic: true },
  endsConversation: false,
  model: null,
  latencyMs: 300,
  ...over,
});

const sessionResponse = (openingTurn: CharacterTurn | null): ConversationSessionCreateResponse => ({
  session: { sessionId: SESSION, state: 'preparing', mode: 'push_to_talk', targetVarietyId: 'es-ES', turnCount: 0, lastLearnerTurnId: null, lastCharacterTurnId: null, lastSeq: 0, objectivesCompleted: [], startedAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', endedAt: null },
  provider: { sessionId: SESSION, provider: 'pipeline_stt_llm_tts', clientToken: 'tok', connectUrl: null, expiresAt: '2026-10-14T11:00:00.000Z', pipeline: 'stt_llm_tts', vad: { silenceMs: 700, minSpeechMs: 200 } },
  character: { id: CHARACTER, name: 'Nadia', role: 'cafe staff', targetVarietyId: 'es-ES', syntheticVoice: true, portraitAssetId: null },
  capabilities: { realtime: capability, recognition: capability, synthesis: capability, pronunciation: { ...capability, supported: false } },
  objectives: [{ id: 'order', description: 'Order a drink', skillKeys: ['request_item'] }],
  openingTurn,
});

function harness(opening: CharacterTurn | null = characterTurn(0), mode: 'push_to_talk' | 'hands_free' = 'push_to_talk') {
  let ids = 1000;
  const played: { url: string; rate: number }[] = [];
  let resolvePlay: (() => void) | null = null;
  const audio = {
    play: vi.fn(async (source: { url: string } | { base64: string; mimeType: string }, rate: number) => {
      played.push({ url: 'url' in source ? source.url : 'inline', rate });
      await new Promise<void>((resolve) => {
        resolvePlay = resolve;
      });
    }),
    stop: vi.fn(() => {
      resolvePlay?.();
      resolvePlay = null;
    }),
  };
  const clip: RecordedClip = { base64: 'QUJD', encoding: 'm4a', sampleRateHz: 44100, durationMs: 1500 };
  const recorder = { start: vi.fn(async () => {}), stop: vi.fn(async () => clip), cancel: vi.fn(async () => {}) };
  let turnCount = 0;
  const turnCalls: ConversationTurnRequest[] = [];
  const api = {
    turn: vi.fn(async (_id: string, body: ConversationTurnRequest): Promise<ConversationTurnResponse> => {
      turnCalls.push(body);
      turnCount += 1;
      return { session: sessionResponse(null).session, learnerTranscript: null, characterTurn: characterTurn(turnCount), replayed: false, evaluationPending: true, objectivesCompleted: [] };
    }),
    transcribe: vi.fn(async (): Promise<TranscribeResponse> => ({ transcript: { text: 'un café por favor', segments: [], confidence: 0.8, detectedLanguage: null, requestedLocale: 'es-ES', provider: 'openrouter', model: 'm', durationMs: 1500, languageMismatch: false }, capability, recordingAssetId: null })),
    synthesize: vi.fn(async (_text: string, _speed: 'slow' | 'normal', _signal: AbortSignal): Promise<SynthesizeResponse> => ({ audio: { encoding: 'mp3', sampleRateHz: 24000, durationMs: 500, assetId: null, url: 'https://cdn.test/tts.mp3', base64: null, provider: 'openrouter', voiceId: 'v', synthetic: true, cached: false }, capability })),
    end: vi.fn(async (_id: string, _body: ConversationEndBody) => ({
      session: { ...sessionResponse(null).session, state: 'finished' as const },
      evaluation: { objectivesCompleted: ['order'], skillsExercised: ['request_item'], observations: [], priorityCorrections: [], summary: 'ok', reviewTriggers: [], relationshipMemoryUpdate: null, confidence: 0.7 },
      xpAwarded: 20,
      scheduledReviews: [],
      summary: 'ok',
      transcriptRetained: false,
    })),
  };
  const controller = new ConversationController({ session: sessionResponse(opening), mode, api, audio, recorder, newId: () => uuid(++ids), now: () => '2026-10-14T10:00:00.000Z' });
  return { controller, api, audio, recorder, played, turnCalls, finishPlayback: () => audio.stop() };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ConversationController', () => {
  it('plays the opening line then listens; a push-to-talk turn transcribes and gets one reply', async () => {
    const h = harness();
    const start = h.controller.start();
    await flush();
    expect(h.played[0]?.url).toContain('turn-0');
    h.finishPlayback();
    await start;
    expect(h.controller.snapshot().machine.state).toBe('listening');
    expect(h.controller.snapshot().speechState).toBe('waiting');

    await h.controller.pressStart();
    expect(h.recorder.start).toHaveBeenCalled();
    expect(h.controller.snapshot().speechState).toBe('learner_mic_active');
    await h.controller.pressStop();
    await flush();
    await flush();
    expect(h.api.transcribe).toHaveBeenCalledTimes(1);
    expect(h.api.turn).toHaveBeenCalledTimes(1);
    expect(h.turnCalls[0]?.input).toMatchObject({ kind: 'transcript', text: 'un café por favor' });
    expect(h.controller.snapshot().machine.state).toBe('responding');
    expect(h.controller.snapshot().turns.map((t) => t.role)).toEqual(['character', 'learner', 'character']);
    h.finishPlayback();
    await flush();
    expect(h.controller.snapshot().machine.state).toBe('listening');
  });

  it('barge-in stops playback, cancels nothing twice and produces a single reply (A13)', async () => {
    const h = harness();
    const start = h.controller.start();
    await flush();
    h.finishPlayback();
    await start;
    await h.controller.submitText('hola');
    await flush();
    expect(h.controller.snapshot().machine.state).toBe('responding');
    expect(h.audio.play).toHaveBeenCalledTimes(2);

    await h.controller.pressStart(); // interrupt while the character speaks
    expect(h.audio.stop).toHaveBeenCalled();
    expect(h.controller.snapshot().machine.state).toBe('speech_detected');
    await h.controller.pressStop();
    await flush();
    await flush();
    expect(h.api.turn).toHaveBeenCalledTimes(2);
    expect(h.turnCalls[1]?.bargeIn).toBe(true);
    expect(h.controller.snapshot().turns.filter((t) => t.role === 'character')).toHaveLength(3);
  });

  it('keeps the learner turn across a network failure and resubmits it on reconnect', async () => {
    const h = harness(characterTurn(0, { audio: null }));
    h.api.synthesize.mockResolvedValue({ audio: { encoding: 'mp3', sampleRateHz: 24000, durationMs: 500, assetId: null, url: null, base64: 'AAA', provider: 'openrouter', voiceId: 'v', synthetic: true, cached: false }, capability });
    const start = h.controller.start();
    await flush();
    h.finishPlayback();
    await start;
    const offline = Object.assign(new Error('offline'), { isConnectivity: true });
    h.api.turn.mockRejectedValueOnce(offline);
    await h.controller.submitText('quiero un té');
    await flush();
    expect(h.controller.snapshot().machine.state).toBe('recoverable_error');
    expect(h.controller.snapshot().speechState).toBe('reconnecting');
    const pending = h.controller.snapshot().machine.pendingLearnerTurn;
    expect(pending?.text).toBe('quiero un té');
    expect(h.api.turn.mock.calls[0]?.[1].clientTurnId).toBe(pending?.learnerTurnId);

    h.controller.reconnect();
    await flush();
    expect(h.api.turn).toHaveBeenCalledTimes(2);
    // Same client turn id is replayed, so the server can never produce two replies for one learner turn.
    expect(h.turnCalls[0]?.clientTurnId).toBe(pending?.learnerTurnId);
    expect(h.turnCalls[0]?.input).toMatchObject({ kind: 'transcript', text: 'quiero un té' });
    expect(h.controller.snapshot().machine.state).toBe('responding');
  });

  it('"repeat" replays locally without an LLM call and "slower" is sent as a command', async () => {
    const h = harness();
    const start = h.controller.start();
    await flush();
    h.finishPlayback();
    await start;
    const repeat = h.controller.command('repeat');
    await flush();
    expect(h.api.turn).not.toHaveBeenCalled();
    expect(h.played).toHaveLength(2);
    h.finishPlayback();
    await repeat;
    await h.controller.command('slower');
    await flush();
    expect(h.turnCalls[0]?.input).toEqual({ kind: 'command', command: 'slower' });
    expect(h.played.at(-1)?.rate).toBe(0.8);
  });

  it('ends the session with the end-of-mission summary', async () => {
    const h = harness(null);
    await h.controller.start();
    const result = await h.controller.end('learner_ended');
    expect(result?.xpAwarded).toBe(20);
    expect(h.controller.snapshot().machine.state).toBe('finished');
    expect(h.api.end).toHaveBeenCalledWith(SESSION, expect.objectContaining({ reason: 'learner_ended' }));
  });

  it('barge-in while the reply is still being synthesized: the audio never starts (§8.3 no overlap)', async () => {
    const h = harness(characterTurn(0, { audio: null }));
    let resolveSynth: ((r: SynthesizeResponse) => void) | null = null;
    const abortSignals: AbortSignal[] = [];
    h.api.synthesize.mockImplementation(async (_t: string, _s: 'slow' | 'normal', signal: AbortSignal) => {
      abortSignals.push(signal);
      return new Promise<SynthesizeResponse>((resolve) => {
        resolveSynth = resolve;
      });
    });
    // Opening turn: synthesis pending → dispose-safe start; resolve it so the session is listening.
    const start = h.controller.start();
    await flush();
    resolveSynth!({ audio: { encoding: 'mp3', sampleRateHz: 24000, durationMs: 500, assetId: null, url: 'https://cdn.test/opening.mp3', base64: null, provider: 'openrouter', voiceId: 'v', synthetic: true, cached: false }, capability });
    await flush();
    h.finishPlayback();
    await start;
    expect(h.audio.play).toHaveBeenCalledTimes(1);

    h.api.turn.mockResolvedValueOnce({ session: sessionResponse(null).session, learnerTranscript: null, characterTurn: characterTurn(5, { audio: null }), replayed: false, evaluationPending: true, objectivesCompleted: [] });
    await h.controller.submitText('hola');
    await flush();
    expect(h.controller.snapshot().machine.state).toBe('responding');
    expect(h.api.synthesize).toHaveBeenCalledTimes(2);
    await h.controller.pressStart(); // learner talks over the character while TTS is still being fetched
    expect(abortSignals[1]?.aborted).toBe(true);
    expect(h.controller.snapshot().machine.state).toBe('speech_detected');
    resolveSynth!({ audio: { encoding: 'mp3', sampleRateHz: 24000, durationMs: 500, assetId: null, url: 'https://cdn.test/late.mp3', base64: null, provider: 'openrouter', voiceId: 'v', synthetic: true, cached: false }, capability });
    await flush();
    await flush();
    expect(h.audio.play).toHaveBeenCalledTimes(1); // the late synthesis is discarded, nothing plays over the learner
    expect(h.played.some((p) => p.url.includes('late'))).toBe(false);
  });

  it('hands-free VAD is gated while the character speaks: speaker output cannot trigger a barge-in', async () => {
    const h = harness(null, 'hands_free');
    await h.controller.start();
    await h.controller.armHandsFree();
    await h.controller.submitText('hola');
    await flush();
    expect(h.controller.snapshot().machine.state).toBe('responding');
    for (let t = 0; t <= 1000; t += 100) await h.controller.meter(-5, t); // loud: the device's own speaker
    expect(h.controller.snapshot().machine.state).toBe('responding');
    expect(h.audio.stop).not.toHaveBeenCalled();
    h.finishPlayback();
    await flush();
    expect(h.controller.snapshot().machine.state).toBe('listening');
    // Once the character is quiet the learner's voice starts a turn as usual.
    await h.controller.meter(-20, 2000);
    await h.controller.meter(-20, 2100);
    await h.controller.meter(-20, 2300);
    expect(h.controller.snapshot().machine.state).toBe('speech_detected');
  });

  it('a non-connectivity STT failure returns to listening with a retry instead of a permanent "reconnecting"', async () => {
    const h = harness(null);
    await h.controller.start();
    h.api.transcribe.mockRejectedValueOnce(Object.assign(new Error('clip too long'), { kind: 'validation_failed', status: 422 }));
    await h.controller.pressStart();
    await h.controller.pressStop();
    await flush();
    await flush();
    const snap = h.controller.snapshot();
    expect(snap.machine.state).toBe('listening');
    expect(snap.speechState).toBe('waiting');
    expect(snap.notice?.code).toBe('validation_failed');
    expect(snap.canRetryTurn).toBe(true);
    expect(h.api.turn).not.toHaveBeenCalled();
    await h.controller.retryLastTurn();
    await flush();
    await flush();
    expect(h.api.transcribe).toHaveBeenCalledTimes(2);
    expect(h.api.turn).toHaveBeenCalledTimes(1);
    expect(h.controller.snapshot().machine.state).toBe('responding');
  });

  it('a 4xx on the turn goes back to listening (retryable), while a connectivity failure keeps the turn for reconnect', async () => {
    const h = harness(null);
    await h.controller.start();
    h.api.turn.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { kind: 'rate_limited', status: 429 }));
    await h.controller.submitText('quiero un té');
    await flush();
    expect(h.controller.snapshot().machine.state).toBe('listening');
    expect(h.controller.snapshot().notice?.code).toBe('rate_limited');
    expect(h.controller.snapshot().canRetryTurn).toBe(true);
    await h.controller.retryLastTurn();
    await flush();
    expect(h.api.turn).toHaveBeenCalledTimes(2);
    expect(h.api.turn.mock.calls[1]?.[1].clientTurnId).toBe(h.api.turn.mock.calls[0]?.[1].clientTurnId);
    expect(h.controller.snapshot().machine.state).toBe('responding');
  });

  it('ending offline holds the session in paused with a pending end; retrying delivers it and finishes', async () => {
    const h = harness(null);
    await h.controller.start();
    h.api.end.mockRejectedValueOnce(Object.assign(new Error('offline'), { isConnectivity: true }));
    const first = await h.controller.end('learner_ended');
    expect(first).toBeNull();
    const snap = h.controller.snapshot();
    expect(snap.machine.state).toBe('paused');
    expect(snap.notice?.code).toBe('end_offline');
    expect(snap.pendingEnd?.reason).toBe('learner_ended');
    const second = await h.controller.end('learner_ended');
    expect(second?.xpAwarded).toBe(20);
    expect(h.api.end.mock.calls[1]?.[1].clientEventId).toBe(h.api.end.mock.calls[0]?.[1].clientEventId); // identical replayable request
    expect(h.controller.snapshot().machine.state).toBe('finished');
    expect(h.controller.snapshot().pendingEnd).toBeNull();
  });

  it('hands-free mode turns metering samples into turns through the VAD', async () => {
    const h = harness(null, 'hands_free');
    await h.controller.start();
    await h.controller.armHandsFree();
    expect(h.recorder.start).toHaveBeenCalledTimes(1);
    await h.controller.meter(-20, 0);
    await h.controller.meter(-20, 100);
    await h.controller.meter(-20, 250);
    expect(h.controller.snapshot().machine.state).toBe('speech_detected');
    await h.controller.meter(-55, 300);
    await h.controller.meter(-55, 1100);
    await flush();
    await flush();
    expect(h.recorder.stop).toHaveBeenCalledTimes(1);
    expect(h.recorder.start).toHaveBeenCalledTimes(2); // re-armed for the next turn
    expect(h.api.turn).toHaveBeenCalledTimes(1);
  });
});
