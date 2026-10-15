import { describe, expect, it } from 'vitest';
import { OpenRouterClient, OpenRouterError, classifyError } from './client';
import { PricingTable } from './pricing';
import { redactChatRequest, redactErrorMessage } from './redact';
import { chatResponse, jsonResponse, mockFetch } from '../test-support/fakes';
import { base64ToBytes, bytesToBase64, fnv1a64Hex, mp3DurationMs, pcm16DurationMs, pcm16ToWav, redactPii, sha256Hex } from '../util';

const noSleep = async () => {};

const makeClient = (routes: Parameters<typeof mockFetch>[0], extra: Partial<ConstructorParameters<typeof OpenRouterClient>[0]> = {}) => {
  const { fetchImpl, calls } = mockFetch(routes);
  const client = new OpenRouterClient({ apiKey: 'sk-or-test', fetch: fetchImpl, sleep: noSleep, random: () => 0, requestIdFactory: () => 'req-1', ...extra });
  return { client, calls };
};

describe('OpenRouterClient.chatCompletions', () => {
  it('sends the models fallback array, response_format and returns usage/cost', async () => {
    const { client, calls } = makeClient([{ match: (u) => u.endsWith('/chat/completions'), respond: () => chatResponse('{"ok":true}') }]);
    const res = await client.chatCompletions({ models: ['a/one', 'b/two'], messages: [{ role: 'user', content: 'hi' }], responseFormat: { type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object' } } }, temperature: 0.2, maxTokens: 50 });
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk-or-test');
    expect(calls[0]?.headers['X-Request-Id']).toBe('req-1');
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.models).toEqual(['a/one', 'b/two']);
    expect(body.model).toBeUndefined();
    expect(body.response_format).toMatchObject({ type: 'json_schema' });
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(50);
    expect(res.content).toBe('{"ok":true}');
    expect(res.usage.inputTokens).toBe(100);
    expect(res.usage.reportedCostUsd).toBe(0.00005);
    expect(res.estimatedCostUsd).toBe(0.00005);
    expect(res.fallbackIndex).toBe(0);
  });

  it('drops an invalid model id (400 up-front rejection, as OpenRouter does live) and retries with the rest', async () => {
    let n = 0;
    const { client, calls } = makeClient([
      {
        match: (u) => u.endsWith('/chat/completions'),
        respond: () => {
          n += 1;
          return n === 1 ? jsonResponse({ error: { message: 'bogus/does-not-exist is not a valid model ID', code: 400 } }, 400) : chatResponse('ok', 'anthropic/claude-haiku-5.5');
        },
      },
    ]);
    const res = await client.chatCompletions({ models: ['bogus/does-not-exist', 'anthropic/claude-haiku-5.5'], messages: [{ role: 'user', content: 'x' }] });
    expect(calls).toHaveLength(2);
    expect((calls[1]?.body as Record<string, unknown>).model).toBe('anthropic/claude-haiku-5.5');
    expect(res.model).toBe('anthropic/claude-haiku-5.5');
    expect(res.fallbackIndex).toBe(1);
    expect(res.attempts).toBe(2);
  });

  it('retries 429/5xx with bounded backoff, then advances to the next model', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const { client, calls } = makeClient(
      [
        {
          match: (u) => u.endsWith('/chat/completions'),
          respond: () => {
            n += 1;
            if (n <= 3) return jsonResponse({ error: { message: 'rate limited', code: 429 } }, 429);
            return chatResponse('late', 'b/two');
          },
        },
      ],
      { maxRetries: 2, sleep: async (ms) => void sleeps.push(ms) },
    );
    const res = await client.chatCompletions({ models: ['a/one', 'b/two'], messages: [{ role: 'user', content: 'x' }] });
    expect(sleeps).toEqual([400, 800]);
    expect(calls).toHaveLength(4);
    expect((calls[3]?.body as Record<string, unknown>).model).toBe('b/two');
    expect(res.model).toBe('b/two');
  });

  it('throws a typed error after retries are exhausted on a single model', async () => {
    const { client } = makeClient([{ match: () => true, respond: () => jsonResponse({ error: { message: 'boom', code: 503 } }, 503) }], { maxRetries: 1 });
    await expect(client.chatCompletions({ models: ['a/one'], messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ kind: 'server_error', status: 503, retryable: true });
  });

  it('does not retry auth errors', async () => {
    const { client, calls } = makeClient([{ match: () => true, respond: () => jsonResponse({ error: { message: 'bad key', code: 401 } }, 401) }]);
    await expect(client.chatCompletions({ models: ['a/one', 'b/two'], messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });

  it('aborts on timeout via AbortController and classifies it', async () => {
    const { fetchImpl } = mockFetch([]);
    const slowFetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }).catch((e) => {
        void fetchImpl;
        throw e;
      })) as typeof fetch;
    const client = new OpenRouterClient({ apiKey: 'k', fetch: slowFetch, sleep: noSleep, maxRetries: 0, defaultTimeoutMs: 5 });
    await expect(client.chatCompletions({ models: ['a/one'], messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('estimates cost from the pricing table when the provider does not report one', async () => {
    const { client } = makeClient([{ match: () => true, respond: () => jsonResponse({ id: 'g', model: 'anthropic/claude-haiku-5.5', choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1000, completion_tokens: 1000 } }) }]);
    const res = await client.chatCompletions({ models: ['anthropic/claude-haiku-5.5'], messages: [{ role: 'user', content: 'x' }] });
    expect(res.usage.reportedCostUsd).toBeNull();
    expect(res.estimatedCostUsd).toBeCloseTo(0.0006, 6);
  });
});

describe('OpenRouterClient.audio', () => {
  it('transcriptions: JSON base64 transport sends input_audio and maps verbose_json', async () => {
    const { client, calls } = makeClient([
      {
        match: (u) => u.endsWith('/audio/transcriptions'),
        respond: () => jsonResponse({ text: ' Bonjour ', language: 'fr', duration: 2.5, usage: { seconds: 2.52, cost: 0.0000189 }, segments: [{ id: 0, start: 0.18, end: 2.52, text: ' Bonjour', avg_logprob: -0.08 }], words: [{ word: ' Bonjour', start: 0.18, end: 0.88 }] }),
      },
    ]);
    const res = await client.audio.transcriptions({ model: 'openai/whisper-large-v3', audio: { base64: 'AAAA', format: 'wav' }, language: 'fr', responseFormat: 'verbose_json', timestampGranularities: ['segment', 'word'] });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.input_audio).toEqual({ data: 'AAAA', format: 'wav' });
    expect(body.language).toBe('fr');
    expect(body.timestamp_granularities).toEqual(['segment', 'word']);
    expect(res.text).toBe('Bonjour');
    expect(res.segments[0]).toMatchObject({ text: 'Bonjour', avgLogprob: -0.08 });
    expect(res.words[0]?.word).toBe('Bonjour');
    expect(res.usage.seconds).toBe(2.52);
    expect(res.estimatedCostUsd).toBe(0.0000189);
  });

  it('transcriptions: multipart transport sends a file field', async () => {
    const { client, calls } = makeClient([{ match: (u) => u.endsWith('/audio/transcriptions'), respond: () => jsonResponse({ text: 'hola', usage: { seconds: 1 } }) }]);
    const res = await client.audio.transcriptions({ model: 'google/gemini-3.5-transcribe', audio: { bytes: new Uint8Array([1, 2, 3]), format: 'wav' }, language: 'es' });
    expect(calls[0]?.rawBody).toBeInstanceOf(FormData);
    expect(calls[0]?.body).toMatchObject({ model: 'google/gemini-3.5-transcribe', language: 'es' });
    expect(String((calls[0]?.body as Record<string, unknown>).file)).toContain('blob 3');
    expect(res.text).toBe('hola');
    expect(res.estimatedCostUsd).toBeNull(); // token-priced model, no token usage reported
  });

  it('speech: returns raw bytes, mime type and parsed pcm rate; sends voice/instructions', async () => {
    const { client, calls } = makeClient([{ match: (u) => u.endsWith('/audio/speech'), respond: () => new Response(new Uint8Array(4800), { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000;channels=1', 'x-generation-id': 'gen-tts-1' } }) }]);
    const res = await client.audio.speech({ model: 'google/gemini-3.8-flash-lite-tts', input: 'Bonjour', voice: 'Kore', responseFormat: 'pcm', instructions: 'slow' });
    expect(calls[0]?.body).toEqual({ model: 'google/gemini-3.8-flash-lite-tts', input: 'Bonjour', voice: 'Kore', response_format: 'pcm', instructions: 'slow' });
    expect(res.bytes.byteLength).toBe(4800);
    expect(res.mimeType).toBe('audio/pcm');
    expect(res.sampleRateHz).toBe(24000);
    expect(res.generationId).toBe('gen-tts-1');
    expect(res.estimatedCostUsd).toBeCloseTo(7 * 0.0000005, 10);
  });

  it('speech: surfaces provider validation errors (e.g. Gemini only supports pcm)', async () => {
    const { client } = makeClient([{ match: () => true, respond: () => jsonResponse({ error: { message: 'Gemini TTS only supports response_format="pcm". Got "mp3".', code: 400 } }, 400) }]);
    await expect(client.audio.speech({ model: 'google/gemini-3.8-flash-lite-tts', input: 'x', voice: 'Kore', responseFormat: 'mp3' })).rejects.toMatchObject({ kind: 'bad_request', status: 400 });
  });
});

describe('models + pricing', () => {
  it('lists models and refreshes pricing from the catalog', async () => {
    const { client } = makeClient([{ match: (u) => u.includes('/models'), respond: () => jsonResponse({ data: [{ id: 'x/tts', name: 'X', pricing: { prompt: '0.00001', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['speech'] }, supported_voices: ['a', 'b'] }] }) }]);
    const list = await client.models.list({ outputModality: 'speech' });
    expect(list[0]).toMatchObject({ id: 'x/tts', supportedVoices: ['a', 'b'], outputModalities: ['speech'] });
    expect(await client.models.refreshPricing()).toBe(3); // text + speech + transcription catalogs
    expect(client.pricing.get('x/tts')).toMatchObject({ unit: 'character', promptUsd: 0.00001, source: 'live-models-endpoint' });
  });

  it('PricingTable estimates per unit type', () => {
    const p = new PricingTable();
    expect(p.estimateChat('anthropic/claude-haiku-5.5', 1_000_000, 0)).toBeCloseTo(0.1, 6);
    expect(p.estimateSpeech('hexgrad/kokoro-82m', 1000)).toBeCloseTo(0.00062, 8);
    expect(p.estimateTranscription('openai/whisper-large-v3', 60, null, null)).toBeCloseTo(0.00045, 8);
    expect(p.estimateTranscription('google/gemini-3.5-transcribe', 60, 64, 9)).toBeCloseTo(64 * 0.000002 + 9 * 0.000012, 10);
    expect(p.estimateChat('unknown/model', 1, 1)).toBeNull();
  });
});

describe('redaction + classification', () => {
  it('never logs learner text', () => {
    const r = redactChatRequest({ models: ['m'], messages: [{ role: 'user', content: 'my secret phone 0612345678' }] });
    expect(JSON.stringify(r)).not.toContain('0612345678');
    expect(r.messages[0]).toMatchObject({ role: 'user', chars: 26 });
    expect(r.messages[0]?.fingerprint).toHaveLength(16);
  });
  it('scrubs keys from error messages', () => {
    expect(redactErrorMessage('bad key sk-or-v1-abcdef Bearer xyz')).toBe('bad key sk-or-[redacted] Bearer [redacted]');
  });
  it('classifies invalid-model and endpoint-mismatch messages', () => {
    expect(classifyError(400, { error: { message: 'foo/bar is not a valid model ID' } }, 'r')).toMatchObject({ kind: 'invalid_model', modelId: 'foo/bar' });
    expect(classifyError(400, { error: { message: 'openai/whisper-large-v3 is a transcription model and cannot be used with the chat/completions endpoint.' } }, 'r')).toMatchObject({ kind: 'invalid_model', modelId: 'openai/whisper-large-v3' });
    expect(classifyError(402, { error: { message: 'credits' } }, 'r').kind).toBe('insufficient_credits');
    expect(new OpenRouterError('rate_limited', 'x', { requestId: 'r' }).retryable).toBe(true);
  });
});

describe('util', () => {
  it('base64 round-trips and hashes deterministically', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(fnv1a64Hex('abc')).toBe(fnv1a64Hex('abc'));
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('wraps pcm into wav and computes durations', () => {
    const pcm = new Uint8Array(32_000);
    const wav = pcm16ToWav(pcm, 16_000);
    expect(wav.byteLength).toBe(32_044);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(pcm16DurationMs(32_000, 16_000)).toBe(1000);
  });
  it('parses MP3 frame headers for duration', () => {
    // Build 38 MPEG1 Layer III frames @128kbps/44.1kHz (417 bytes each, no padding) ≈ 992 ms.
    const frames = 38;
    const bytes = new Uint8Array(417 * frames);
    for (let i = 0; i < frames; i += 1) bytes.set([0xff, 0xfb, 0x90, 0x00], i * 417);
    expect(mp3DurationMs(bytes)).toBe(Math.round(((1152 * frames) / 44100) * 1000));
    expect(mp3DurationMs(new Uint8Array(10))).toBeNull();
  });
  it('redacts PII', () => {
    expect(redactPii('mail me at a.b@example.com or +33 6 12 34 56 78, see https://x.y/z')).toBe('mail me at [email] or [number], see [url]');
  });
});
