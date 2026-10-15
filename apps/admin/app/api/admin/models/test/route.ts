import { OpenRouterClient } from '@langquest/ai';
import { adminRoute, LocalApiError } from '@/src/lib/local-api/handler';
import { ModelTestSchema } from '@/src/lib/local-api/schemas';
import { serverEnv } from '@/src/lib/env';

/**
 * POST /api/admin/models/test — model test harness probes run from the admin server with a
 * server-only OPENROUTER_API_KEY (never shipped to the browser). When the key is absent the
 * route answers `capability_unsupported` so the UI shows an honest "unavailable" state; the
 * speech probes can alternatively run through the LangQuest API speech routes.
 */
export const POST = adminRoute('aiModels', ModelTestSchema, async ({ body }) => {
  const { OPENROUTER_API_KEY } = serverEnv();
  if (!OPENROUTER_API_KEY) throw new LocalApiError('capability_unsupported', 'OPENROUTER_API_KEY is not configured on the admin server.');
  const client = new OpenRouterClient({ apiKey: OPENROUTER_API_KEY, appName: 'LangQuest Studio', defaultTimeoutMs: 45_000, maxRetries: 1 });
  if (body.mode === 'prompt') {
    const result = await client.chatCompletions({
      models: body.models,
      messages: [...(body.system ? [{ role: 'system' as const, content: body.system }] : []), { role: 'user' as const, content: body.prompt }],
      temperature: body.temperature,
      maxTokens: body.maxTokens ?? 512,
    });
    return {
      mode: 'prompt',
      model: result.model,
      provider: result.provider,
      content: result.content,
      finishReason: result.finishReason,
      usage: result.usage,
      estimatedCostUsd: result.estimatedCostUsd,
      latencyMs: result.latencyMs,
      fallbackIndex: result.fallbackIndex,
    };
  }
  if (body.mode === 'synthesize') {
    const result = await client.audio.speech({ model: body.model, input: body.text, voice: body.voice, responseFormat: 'mp3' });
    return {
      mode: 'synthesize',
      mimeType: result.mimeType,
      audioBase64: Buffer.from(result.bytes).toString('base64'),
      characters: result.characters,
      estimatedCostUsd: result.estimatedCostUsd,
      latencyMs: result.latencyMs,
    };
  }
  const result = await client.audio.transcriptions({ model: body.model, audio: { base64: body.audioBase64, format: body.format }, language: body.language, responseFormat: 'verbose_json' });
  return {
    mode: 'transcribe',
    text: result.text,
    language: result.language,
    durationSeconds: result.durationSeconds,
    confidence: result.confidence,
    segments: result.segments.slice(0, 50),
    estimatedCostUsd: result.estimatedCostUsd,
    latencyMs: result.latencyMs,
  };
});
