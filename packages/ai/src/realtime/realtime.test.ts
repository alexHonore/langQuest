import { describe, expect, it } from 'vitest';
import type { AudioOutput, SpeechRecognizer, SpeechSynthesizer, TranscriptResult, VoiceSessionConfig } from '@langquest/contracts';
import { ShortLivedSessionSchema } from '@langquest/contracts';
import { CHARACTER_ID, SESSION_ID, conversationContext, mockFetch, persona } from '../test-support/fakes';
import { OpenRouterClient } from '../openrouter/client';
import { OpenRouterSpeechRecognizer } from '../speech/stt';
import { OpenRouterSpeechSynthesizer } from '../speech/tts';
import type { CharacterResponder } from '../conversation/character-agent';
import { DuplexProviderStub } from './duplex-stub';
import { CancelledError, PipelineRealtimeProvider, createCancellationToken } from './pipeline';
import { signSessionTicket, verifySessionTicket } from './tickets';

const SECRET = 'a-very-long-ticket-secret-for-tests';

describe('session tickets', () => {
  it('signs and verifies, rejects tampering and expiry', async () => {
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    const { token, expiresAt } = await signSessionTicket({ sessionId: SESSION_ID, userId: 'u1', enrollmentId: conversationContext('french').language.enrollmentId, pipeline: 'stt_llm_tts', ttlSeconds: 60, now }, SECRET);
    expect(expiresAt).toBe(new Date(now + 60_000).toISOString());
    const ok = await verifySessionTicket(token, SECRET, now + 1000);
    expect(ok).toMatchObject({ ok: true, payload: { sessionId: SESSION_ID, userId: 'u1', pipeline: 'stt_llm_tts' } });
    expect(await verifySessionTicket(token, SECRET, now + 61_000)).toEqual({ ok: false, reason: 'expired' });
    expect(await verifySessionTicket(token, 'another-secret-that-is-long', now)).toEqual({ ok: false, reason: 'bad_signature' });
    const [body, sig] = token.split('.') as [string, string];
    const tampered = `${body.slice(0, -2)}AA.${sig}`;
    expect((await verifySessionTicket(tampered, SECRET, now)).ok).toBe(false);
    expect(await verifySessionTicket('garbage', SECRET, now)).toEqual({ ok: false, reason: 'malformed' });
    expect(token).not.toContain(SECRET);
    await expect(signSessionTicket({ sessionId: SESSION_ID, userId: 'u', enrollmentId: SESSION_ID, pipeline: 'duplex' }, 'short')).rejects.toThrow(/16/);
  });
});

describe('cancellation tokens', () => {
  it('cancels once, notifies listeners and links to a parent signal', () => {
    const parent = new AbortController();
    const token = createCancellationToken(parent.signal);
    const seen: string[] = [];
    token.onCancel((r) => seen.push(r));
    expect(token.cancelled).toBe(false);
    token.cancel('barge_in');
    token.cancel('again');
    expect(token.reason).toBe('barge_in');
    expect(seen).toEqual(['barge_in']);
    expect(() => token.throwIfCancelled()).toThrow(CancelledError);
    const child = createCancellationToken(parent.signal);
    parent.abort();
    expect(child.reason).toBe('parent_aborted');
  });
});

const recognizer = (text: string, delay = 0): SpeechRecognizer => ({
  provider: 'fake-stt',
  supports: async (locale) => ({ supported: !locale.startsWith('rw'), reasons: locale.startsWith('ar-MA') ? ['not_benchmarked'] : [], features: { word: true, phoneme: false, tone: false, prosody: false, streaming: false, interruptible: false, codeSwitch: true, multiSpeaker: false }, latencyClass: 'interactive', effectiveLocale: locale, qualityEstimate: 0.6, provider: 'fake-stt', notes: ['stt note'] }),
  transcribe: async (_a, locale): Promise<TranscriptResult> => {
    await new Promise((r) => setTimeout(r, delay));
    return { text, segments: [], confidence: 0.8, detectedLanguage: null, requestedLocale: locale, provider: 'fake-stt', model: 'm', durationMs: 900, languageMismatch: false };
  },
});
const synthesizer = (calls: string[]): SpeechSynthesizer => ({
  provider: 'fake-tts',
  supports: async (locale) => ({ supported: !locale.startsWith('rw') && !locale.startsWith('ln'), reasons: [], features: { word: false, phoneme: false, tone: false, prosody: false, streaming: true, interruptible: false, codeSwitch: false, multiSpeaker: false }, latencyClass: 'realtime', effectiveLocale: locale, qualityEstimate: 0.7, provider: 'fake-tts', notes: ['tts note'] }),
  synthesize: async (text, _l, voiceId): Promise<AudioOutput> => {
    calls.push(text);
    return { encoding: 'pcm16', sampleRateHz: 24_000, durationMs: 800, assetId: null, url: null, base64: 'AAAA', provider: 'fake-tts', voiceId, synthetic: true, cached: false };
  },
});
const agent = (text: string, onRespond?: () => void): CharacterResponder => ({
  respond: async (input) => {
    onRespond?.();
    input.signal?.throwIfAborted();
    return {
      turn: { turnId: '66666666-6666-4666-8666-666666666666', characterId: CHARACTER_ID, text, transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: null, tentativeObjectiveIds: [], audio: null, endsConversation: false, model: null, latencyMs: 5 },
      guard: null,
      usedRecoveryLine: false,
      playbackRate: 1,
      model: null,
    };
  },
});

const config = (locale: string, mode: VoiceSessionConfig['mode'] = 'hands_free'): VoiceSessionConfig => ({
  sessionId: SESSION_ID,
  context: conversationContext('arabic-moroccan'),
  mode,
  interruptible: true,
  locale,
  voiceId: 'ary-f-1',
  inputEncoding: 'pcm16',
  outputEncoding: 'pcm16',
  maxSessionMs: 600_000,
  maxTurnMs: 20_000,
  speechRetention: 'none',
});

describe('PipelineRealtimeProvider', () => {
  it('supports() combines STT/TTS, carries limited flags and enforces variety boundary', async () => {
    const p = new PipelineRealtimeProvider({ recognizer: recognizer('x'), synthesizer: synthesizer([]), characterAgent: agent('y'), ticketSecret: SECRET });
    const cap = await p.supports('ar-MA', true);
    expect(cap).toMatchObject({ supported: true, reasons: ['not_benchmarked'], features: { interruptible: true, streaming: true }, effectiveLocale: 'ar-MA', qualityEstimate: 0.6 });
    expect((await p.supports('rw-RW', true)).supported).toBe(false);
    expect((await p.supports('ln-CD', true)).notes[0]).toMatch(/text-only/);
    expect((await p.supports('es', true)).reasons).toEqual(['locale_unsupported']);
  });

  it('serves Eastern Arabic (ar-SY / ar-LB) with the real synthesizer and recognizer, within the variety boundary', async () => {
    const { fetchImpl } = mockFetch([]);
    const client = new OpenRouterClient({ apiKey: 'k', fetch: fetchImpl, sleep: async () => {}, maxRetries: 0 });
    const p = new PipelineRealtimeProvider({ recognizer: new OpenRouterSpeechRecognizer({ client }), synthesizer: new OpenRouterSpeechSynthesizer({ client }), characterAgent: agent('y'), ticketSecret: SECRET });
    for (const locale of ['ar-SY', 'ar-LB', 'ar-MA', 'ar-EG', 'ar']) {
      const cap = await p.supports(locale, true);
      expect(cap.supported, locale).toBe(true);
      expect(cap.reasons).not.toContain('variety_boundary');
    }
  });

  it('createSession issues a short-lived signed ticket with the pipeline kind and VAD for hands-free', async () => {
    const p = new PipelineRealtimeProvider({ recognizer: recognizer('x'), synthesizer: synthesizer([]), characterAgent: agent('y'), ticketSecret: SECRET, connectUrl: (id) => `wss://rt.example/${id}` });
    const s = await p.createSession(config('ar-MA'), { userId: 'u1' });
    expect(() => ShortLivedSessionSchema.parse(s)).not.toThrow();
    expect(s).toMatchObject({ pipeline: 'stt_llm_tts', provider: 'pipeline_stt_llm_tts', connectUrl: `wss://rt.example/${SESSION_ID}`, vad: { silenceMs: 700, minSpeechMs: 250 } });
    const v = await verifySessionTicket(s.clientToken, SECRET);
    expect(v).toMatchObject({ ok: true, payload: { userId: 'u1', pipeline: 'stt_llm_tts' } });
    expect((await p.createSession(config('ar-MA', 'push_to_talk'))).vad).toBeNull();
    await expect(p.createSession(config('rw-RW'))).rejects.toThrow(/unavailable/);
    expect((await p.createSession(config('rw-RW', 'text_only'))).pipeline).toBe('text_only');
  });

  it('runs STT → LLM → TTS with latency hooks', async () => {
    const tts: string[] = [];
    const p = new PipelineRealtimeProvider({ recognizer: recognizer('بغيت قهوة'), synthesizer: synthesizer(tts), characterAgent: agent('واخا، قهوة وحدة!'), ticketSecret: SECRET });
    const hooks = { stt: 0, llm: 0, audio: 0, done: null as unknown };
    const token = createCancellationToken();
    const res = await p.runTurn({ config: config('ar-MA'), persona, learnerInput: { kind: 'audio', assetId: '55555555-5555-4555-8555-555555555555', durationMs: 900, transcriptHint: null }, audio: { source: 'inline', base64: 'AAAA', encoding: 'wav', sampleRateHz: 16000 }, lastCharacterText: null, token, hooks: { onSttComplete: () => (hooks.stt += 1), onLlmComplete: () => (hooks.llm += 1), onFirstAudio: () => (hooks.audio += 1), onTurnComplete: (s) => (hooks.done = s) } });
    expect(res.transcript?.text).toBe('بغيت قهوة');
    expect(res.turn?.text).toBe('واخا، قهوة وحدة!');
    expect(res.turn?.audio).toMatchObject({ synthetic: true, durationMs: 800 });
    expect(res.audio?.base64).toBe('AAAA');
    expect(tts).toEqual(['واخا، قهوة وحدة!']);
    expect(hooks).toMatchObject({ stt: 1, llm: 1, audio: 1 });
    expect(res.latency).toMatchObject({ cancelled: false, fallbackUsed: false });
    expect(res.latency.timeToFirstAudioMs).not.toBeNull();
  });

  it('barge-in cancellation stops before the LLM/TTS stages and never produces a reply', async () => {
    const tts: string[] = [];
    const token = createCancellationToken();
    let agentCalls = 0;
    const p = new PipelineRealtimeProvider({ recognizer: recognizer('x', 5), synthesizer: synthesizer(tts), characterAgent: agent('y', () => (agentCalls += 1)), ticketSecret: SECRET });
    const run = p.runTurn({ config: config('ar-MA'), persona, learnerInput: { kind: 'audio', assetId: '55555555-5555-4555-8555-555555555555', durationMs: 900, transcriptHint: null }, audio: { source: 'inline', base64: 'AAAA', encoding: 'wav', sampleRateHz: 16000 }, lastCharacterText: null, token });
    token.cancel('barge_in');
    const res = await run;
    expect(res.cancelled).toBe(true);
    expect(res.turn).toBeNull();
    expect(res.audio).toBeNull();
    expect(tts).toEqual([]);
    expect(agentCalls).toBe(0);
    expect(res.latency.cancelReason).toBe('barge_in');
  });

  it('text-only mode skips synthesis', async () => {
    const tts: string[] = [];
    const p = new PipelineRealtimeProvider({ recognizer: recognizer('x'), synthesizer: synthesizer(tts), characterAgent: agent('y'), ticketSecret: SECRET });
    const res = await p.runTurn({ config: config('ar-MA', 'text_only'), persona, learnerInput: { kind: 'text', text: 'سلام' }, lastCharacterText: null, token: createCancellationToken() });
    expect(res.turn?.text).toBe('y');
    expect(res.audio).toBeNull();
    expect(tts).toEqual([]);
  });
});

describe('DuplexProviderStub', () => {
  it('never pretends to support duplex voice unless a delegate is configured', async () => {
    const stub = new DuplexProviderStub();
    expect(stub.configured).toBe(false);
    expect(await stub.supports('fr-FR', true)).toMatchObject({ supported: false, reasons: ['provider_disabled'] });
    await expect(stub.createSession(config('fr-FR'))).rejects.toMatchObject({ code: 'capability_unsupported' });
    const delegate = new PipelineRealtimeProvider({ recognizer: recognizer('x'), synthesizer: synthesizer([]), characterAgent: agent('y'), ticketSecret: SECRET });
    const wrapped = new DuplexProviderStub({ delegate });
    expect(wrapped.configured).toBe(true);
    expect((await wrapped.supports('fr-FR', true)).supported).toBe(true);
  });
});
