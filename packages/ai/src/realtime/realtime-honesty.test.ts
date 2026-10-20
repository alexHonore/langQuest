/**
 * Realtime pipeline speech honesty (HANDOFF §9 item 5; device QA 2026-10-19 §6.1). Before: `runTurn` turned an empty
 * transcript into "…" and still asked the character LLM (then TTS), so a silent or hallucinated take produced a paid,
 * in-character reply to nothing. Now a take without speech ends the turn at the gate: no character-agent (LLM) call, no
 * TTS call, an honest `speech: { speechDetected: false, reason }` the client can render, and `onNoSpeech` fires.
 *
 * Offline only: the REAL OpenRouter recognizer, text reasoner, character agent and synthesizer over one mocked fetch
 * and one in-memory `ai_requests` sink, so "nothing paid" is checked on the ledger itself, not on a fake agent's
 * call counter.
 */
import { describe, expect, it } from 'vitest';
import type { SpeechDetection, SpeechRecognizer, TranscriptResult, VoiceSessionConfig } from '@langquest/contracts';
import { CharacterAgent } from '../conversation/character-agent';
import { OpenRouterClient } from '../openrouter/client';
import { LanguageGuard } from '../prompts/language-guard';
import { MemoryAiRequestSink, OpenRouterTextReasoner } from '../reasoner';
import { OpenRouterSpeechRecognizer } from '../speech/stt';
import { OpenRouterSpeechSynthesizer } from '../speech/tts';
import { SESSION_ID, chatResponse, conversationContext, jsonResponse, mockFetch, persona } from '../test-support/fakes';
import { bytesToBase64, pcm16ToWav } from '../util';
import { PipelineRealtimeProvider, createCancellationToken, type PipelineTurnInput } from './pipeline';

const SECRET = 'a-very-long-ticket-secret-for-tests';

/** 16-bit PCM sine: loud enough that the server-side level check lets it reach the recognizer. */
const tone = (ms: number, amplitude = 0.3, rate = 16_000): Uint8Array => {
  const n = Math.round((ms / 1000) * rate);
  const out = new Uint8Array(n * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; i += 1) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767), true);
  return out;
};
const TONE = { source: 'inline' as const, base64: bytesToBase64(pcm16ToWav(tone(900), 16_000)), encoding: 'wav' as const, sampleRateHz: 16_000 };
const M4A = { source: 'inline' as const, base64: bytesToBase64(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32])), encoding: 'm4a' as const, sampleRateHz: 44_100 };

type Segment = { text: string; nsp?: number; lp?: number; cr?: number };
/** OpenRouter verbose_json transcription body (Whisper shape). */
const whisper = (language: string, segments: Segment[], duration = 2) => ({
  text: segments.map((s) => s.text).join(' '),
  language,
  duration,
  usage: { seconds: duration, cost: 0.00002 },
  segments: segments.map((s, i) => ({ id: i, start: (i * duration) / segments.length, end: ((i + 1) * duration) / segments.length, text: s.text, avg_logprob: s.lp ?? -0.2, no_speech_prob: s.nsp ?? 0.02, ...(s.cr !== undefined ? { compression_ratio: s.cr } : {}) })),
  words: [],
});

const config = (track: Parameters<typeof conversationContext>[0], locale: string, mode: VoiceSessionConfig['mode'] = 'push_to_talk'): VoiceSessionConfig => ({
  sessionId: SESSION_ID,
  context: conversationContext(track),
  mode,
  interruptible: mode === 'hands_free',
  locale,
  voiceId: 'ary-f-1',
  inputEncoding: 'pcm16',
  outputEncoding: 'mp3',
  maxSessionMs: 600_000,
  maxTurnMs: 20_000,
  speechRetention: 'none',
});

/** Real adapters, one fetch, one ledger. The chat route answers like a French character would. */
function realStack(transcription: unknown) {
  const { fetchImpl, calls } = mockFetch([
    { match: (u) => u.endsWith('/audio/transcriptions'), respond: () => jsonResponse(transcription) },
    { match: (u) => u.endsWith('/chat/completions'), respond: () => chatResponse(JSON.stringify({ text: 'Bonjour ! Comment allez-vous aujourd’hui ?', transliteration: null, sourceGloss: null, expression: 'greeting', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false })) },
    { match: (u) => u.endsWith('/audio/speech'), respond: () => new Response(new Uint8Array(4_000), { status: 200, headers: { 'content-type': 'audio/mpeg' } }) },
  ]);
  const client = new OpenRouterClient({ apiKey: 'k', fetch: fetchImpl, sleep: async () => {}, maxRetries: 0 });
  const sink = new MemoryAiRequestSink();
  const reasoner = new OpenRouterTextReasoner({ client, sink });
  const pipeline = new PipelineRealtimeProvider({
    recognizer: new OpenRouterSpeechRecognizer({ client, sink }),
    synthesizer: new OpenRouterSpeechSynthesizer({ client, sink }),
    characterAgent: new CharacterAgent({ reasoner, guard: new LanguageGuard() }),
    ticketSecret: SECRET,
  });
  const paths = () => calls.map((c) => new URL(c.url).pathname.replace(/^.*\/api\/v1/, ''));
  /** The JSON body of every chat (LLM) request, as sent. */
  const chatBodies = () => calls.filter((c) => c.url.endsWith('/chat/completions')).map((c) => JSON.stringify(c.body));
  return { pipeline, sink, paths, chatBodies };
}

const audioTurn = (over: Partial<PipelineTurnInput> = {}): Omit<PipelineTurnInput, 'token'> => ({
  config: config('french', 'fr-FR'),
  persona,
  learnerInput: { kind: 'audio', assetId: '55555555-5555-4555-8555-555555555555', durationMs: 900, transcriptHint: null },
  audio: TONE,
  lastCharacterText: null,
  ...over,
});

async function run(pipeline: PipelineRealtimeProvider, input: Omit<PipelineTurnInput, 'token'>) {
  const events: SpeechDetection[] = [];
  const result = await pipeline.runTurn({ ...input, token: createCancellationToken(), hooks: { ...input.hooks, onNoSpeech: (s) => events.push(s) } });
  return { result, events };
}

describe('PipelineRealtimeProvider: a take without speech never reaches the character LLM or TTS', () => {
  it('a hallucinated take ("Sous-titres réalisés par la communauté d\'Amara.org"): no-speech event, no reply, only the STT call on the ledger', async () => {
    const { pipeline, sink, paths } = realStack(whisper('fr', [{ text: "Sous-titres réalisés par la communauté d'Amara.org", nsp: 0.3, lp: -0.4 }]));
    const { result, events } = await run(pipeline, audioTurn());
    expect(result).toMatchObject({ speech: { speechDetected: false, reason: 'known_hallucination' }, transcript: null, turn: null, audio: null, cancelled: false });
    expect(events).toEqual([{ speechDetected: false, reason: 'known_hallucination' }]);
    expect(paths()).toEqual(['/audio/transcriptions']);
    // The one recognizer call that really happened is ledgered (with the verdict, never the text); nothing else.
    expect(sink.records.map((r) => r.task)).toEqual(['speech_recognition']);
    expect(sink.records[0]?.redactedLog).toMatchObject({ speechDetected: false, noSpeechReason: 'known_hallucination' });
    expect(JSON.stringify(sink.records)).not.toContain('Amara');
    expect(result.latency).toMatchObject({ llmMs: null, ttsMs: null, timeToFirstAudioMs: null });
    expect(result.latency.sttMs).not.toBeNull();
  });

  it('an empty transcript is no longer replaced by "…" and sent to the model', async () => {
    const { pipeline, sink, paths } = realStack({ text: '', language: 'fr', duration: 1.5, segments: [], words: [], usage: { seconds: 1.5 } });
    const { result, events } = await run(pipeline, audioTurn());
    expect(result).toMatchObject({ speech: { speechDetected: false, reason: 'empty_transcript' }, turn: null, audio: null });
    expect(events).toHaveLength(1);
    expect(paths()).toEqual(['/audio/transcriptions']);
    expect(sink.records.map((r) => r.task)).toEqual(['speech_recognition']);
  });

  it('a decoding loop the recognizer measured (compression_ratio > 2.4) ends the turn as repetition_loop', async () => {
    const loop = "I'm going to the store. I'm going to the store. I'm going to the store. I'm going to the store.";
    const { pipeline, paths } = realStack(whisper('fr', [{ text: loop, nsp: 0.03, lp: -0.1, cr: 5.1 }]));
    const { result } = await run(pipeline, audioTurn());
    expect(result).toMatchObject({ speech: { speechDetected: false, reason: 'repetition_loop' }, turn: null });
    expect(paths()).toEqual(['/audio/transcriptions']);
  });

  it('a take the recorder metering shows silent costs nothing at all: no provider call, an empty ledger', async () => {
    const { pipeline, sink, paths } = realStack(whisper('fr', [{ text: 'Bonjour' }]));
    const { result, events } = await run(pipeline, audioTurn({ audio: M4A, recording: { peakLevelDb: -72 } }));
    expect(result).toMatchObject({ speech: { speechDetected: false, reason: 'client_silence' }, turn: null, audio: null });
    expect(events).toEqual([{ speechDetected: false, reason: 'client_silence' }]);
    expect(paths()).toEqual([]);
    expect(sink.records).toEqual([]);
  });

  it('a device transcript hint with no words ("…", " ... ", "?") is no speech, never a model prompt', async () => {
    for (const transcriptHint of ['…', ' ... ', '?']) {
      const { pipeline, sink, paths } = realStack(whisper('fr', [{ text: 'Bonjour' }]));
      const { result, events } = await run(pipeline, audioTurn({ learnerInput: { kind: 'audio', assetId: '55555555-5555-4555-8555-555555555555', durationMs: 900, transcriptHint }, audio: undefined }));
      expect(result, transcriptHint).toMatchObject({ speech: { speechDetected: false, reason: 'empty_transcript' }, turn: null, audio: null });
      expect(events, transcriptHint).toHaveLength(1);
      expect(paths()).toEqual([]);
      expect(sink.records).toEqual([]);
    }
  });

  it("typed chat in mobile's exact shape ({ kind: 'transcript', provider: 'client' }) is answered even with no letters: \"?\", \"...\", \"…\", an emoji", async () => {
    // apps/mobile/src/features/conversation/controller.ts sends typed text as a `transcript`; the no-words rule is for recognizer output only.
    for (const text of ['?', '...', '…', '👍', 'Bonjour ?']) {
      const { pipeline, sink, paths, chatBodies } = realStack(whisper('fr', [{ text: 'Bonjour' }]));
      const { result, events } = await run(pipeline, audioTurn({ learnerInput: { kind: 'transcript', text, confidence: null, provider: 'client' }, audio: undefined, textOnly: true }));
      expect(events, text).toEqual([]);
      expect(result.speech, text).toBeNull();
      expect(result.turn?.text, text).toBe('Bonjour ! Comment allez-vous aujourd’hui ?');
      expect(paths(), text).toEqual(['/chat/completions']);
      expect(sink.records.map((r) => r.task), text).toEqual(['character_dialogue']);
      expect(chatBodies()[0], text).toContain(JSON.stringify(text).slice(1, -1));
    }
  });

  it('a transcript that is empty after trimming ends the turn with no model call (nothing to answer)', async () => {
    const { pipeline, sink, paths } = realStack(whisper('fr', [{ text: 'Bonjour' }]));
    const { result, events } = await run(pipeline, audioTurn({ learnerInput: { kind: 'transcript', text: ' \t ', confidence: null, provider: 'client' }, audio: undefined }));
    expect(result).toMatchObject({ speech: { speechDetected: false, reason: 'empty_transcript' }, turn: null, audio: null });
    expect(events).toHaveLength(1);
    expect(paths()).toEqual([]);
    expect(sink.records).toEqual([]);
  });

  it('genuine speech still reaches the character, once screened (a trailing credit line is not part of the learner turn)', async () => {
    const { pipeline, sink, paths, chatBodies } = realStack(whisper('fr', [{ text: 'Bonjour madame.' }, { text: "Sous-titres réalisés par la communauté d'Amara.org", nsp: 0.45, lp: -0.6 }]));
    const { result, events } = await run(pipeline, audioTurn({ textOnly: true }));
    expect(events).toEqual([]);
    expect(result.speech).toEqual({ speechDetected: true, reason: null });
    expect(result.transcript?.text).toBe('Bonjour madame.');
    expect(result.turn?.text).toBe('Bonjour ! Comment allez-vous aujourd’hui ?');
    expect(paths()).toEqual(['/audio/transcriptions', '/chat/completions']);
    expect(sink.records.map((r) => r.task)).toEqual(['speech_recognition', 'character_dialogue']);
    // The character prompt carries the screened learner text only.
    expect(chatBodies()).toHaveLength(1);
    expect(chatBodies()[0]).toContain('Bonjour madame.');
    expect(chatBodies()[0]).not.toContain('Amara');
  });

  it('a plain contract recognizer (no screening of its own) is screened by the pipeline itself', async () => {
    let agentCalls = 0;
    const plain: SpeechRecognizer = {
      provider: 'plain-stt',
      supports: async () => {
        throw new Error('not used');
      },
      transcribe: async (_a, locale): Promise<TranscriptResult> => ({ text: 'Thanks for watching!', segments: [], confidence: 0.9, detectedLanguage: null, requestedLocale: locale, provider: 'plain-stt', model: 'm', durationMs: 900, languageMismatch: false }),
    };
    const pipeline = new PipelineRealtimeProvider({
      recognizer: plain,
      synthesizer: { provider: 'tts', supports: async () => { throw new Error('not used'); }, synthesize: async () => { throw new Error('TTS must not run'); } },
      characterAgent: { respond: async () => { agentCalls += 1; throw new Error('the LLM must not run'); } },
      ticketSecret: SECRET,
    });
    const { result, events } = await run(pipeline, audioTurn({ config: config('english', 'en-US') }));
    expect(result).toMatchObject({ speech: { speechDetected: false, reason: 'known_hallucination' }, turn: null, audio: null });
    expect(events).toHaveLength(1);
    expect(agentCalls).toBe(0);
  });

  it('typed text and commands carry no speech verdict and are answered as before', async () => {
    const { pipeline, paths } = realStack(whisper('fr', [{ text: 'Bonjour' }]));
    const { result } = await run(pipeline, audioTurn({ learnerInput: { kind: 'text', text: 'Bonjour' }, audio: undefined, textOnly: true }));
    expect(result.speech).toBeNull();
    expect(result.turn?.text).toBe('Bonjour ! Comment allez-vous aujourd’hui ?');
    expect(paths()).toEqual(['/chat/completions']);
  });
});
