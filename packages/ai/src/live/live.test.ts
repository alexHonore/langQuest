/**
 * Live provider tests — only run with `LANGQUEST_LIVE_TESTS=1` (CONVENTIONS §7). They read OPENROUTER_API_KEY
 * from the environment or the repo-root `.env`, use the cheapest models, and spend well under one cent per run.
 *
 *   LANGQUEST_LIVE_TESTS=1 pnpm --filter @langquest/ai test -- live
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenRouterClient } from '../openrouter/client';
import { MemoryAiRequestSink, OpenRouterTextReasoner } from '../reasoner';
import { ModelProfileRegistry } from '../profiles';
import { OpenRouterSpeechRecognizer } from '../speech/stt';
import { OpenRouterSpeechSynthesizer } from '../speech/tts';
import { LanguageGuard } from '../prompts/language-guard';
import { ctxFor } from '../test-support/fakes';

const LIVE = process.env.LANGQUEST_LIVE_TESTS === '1';

function loadKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const env = readFileSync(resolve(__dirname, '../../../../.env'), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('OPENROUTER_API_KEY='));
    return line ? line.slice('OPENROUTER_API_KEY='.length).trim().replace(/^"|"$/g, '') : null;
  } catch {
    return null;
  }
}

const key = LIVE ? loadKey() : null;

describe.skipIf(!LIVE || !key)('OpenRouter live (LANGQUEST_LIVE_TESTS=1)', () => {
  const client = new OpenRouterClient({ apiKey: key ?? 'skipped', appName: 'LangQuest live tests', defaultTimeoutMs: 60_000 });
  const sink = new MemoryAiRequestSink();

  it('structured chat in Darija via the profile chain (haiku primary) passes the language guard', async () => {
    const reasoner = new OpenRouterTextReasoner({ client, profiles: new ModelProfileRegistry(), sink });
    const Schema = z.object({ reply: z.string().min(1), transliteration: z.string().min(1) });
    const out = await reasoner.generateStructured(
      'source_explanation',
      ctxFor('arabic-moroccan', 'fr'),
      { templateId: 'live.darija', templateVersion: '1', system: 'You are a Moroccan Darija speaker from Casablanca. Reply only in Darija (Arabic script), never Modern Standard Arabic, and give an Arabizi transliteration. Return JSON.', user: 'Say "good morning, how are you?" in one short natural sentence.' },
      Schema,
      { modelOverride: 'anthropic/claude-haiku-5.5' },
    );
    expect(out.reply.length).toBeGreaterThan(3);
    expect(new LanguageGuard().checkHeuristic(out.reply, 'ary').ok).toBe(true);
    expect(sink.records[0]).toMatchObject({ success: true, provider: 'openrouter' });
    expect(sink.records[0]?.estimatedCostUsd).toBeLessThan(0.01);
  }, 60_000);

  it('TTS (Gemini flash-lite, pcm) → STT (Whisper) round-trip in French', async () => {
    const tts = new OpenRouterSpeechSynthesizer({ client, sink });
    const audio = await tts.synthesize('Bonjour, comment ça va aujourd’hui ?', 'fr-FR', 'fr-fr-f-2');
    expect(audio.encoding).toBe('pcm16');
    expect(audio.durationMs).toBeGreaterThan(500);
    const stt = new OpenRouterSpeechRecognizer({ client, sink });
    const res = await stt.transcribe({ source: 'inline', base64: audio.base64 ?? '', encoding: 'pcm16', sampleRateHz: audio.sampleRateHz }, 'fr-FR');
    expect(res.text.toLowerCase()).toContain('bonjour');
    expect(res.languageMismatch).toBe(false);
    expect(res.model).toBe('openai/whisper-large-v3');
  }, 120_000);

  it('fallback array: an unknown primary id is dropped client-side and the fallback answers', async () => {
    const res = await client.chatCompletions({ models: ['bogus/does-not-exist-9000', 'anthropic/claude-haiku-5.5'], messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 5 });
    expect(res.model).toBe('anthropic/claude-haiku-5.5');
    expect(res.fallbackIndex).toBe(1);
    expect(res.attempts).toBe(2);
  }, 60_000);

  it('models discovery lists speech + transcription models and refreshes pricing', async () => {
    const speech = await client.models.list({ outputModality: 'speech' });
    expect(speech.some((m) => m.id === 'google/gemini-3.8-flash-lite-tts')).toBe(true);
    expect(await client.models.refreshPricing()).toBeGreaterThan(50);
    expect(client.pricing.get('openai/whisper-large-v3')?.source).toBe('live-models-endpoint');
  }, 60_000);
});
