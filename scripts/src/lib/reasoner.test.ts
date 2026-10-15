import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MemoryAiRequestSink, StructuredOutputError, type ChatCompletionRequest, type ChatCompletionResult } from '@langquest/ai';
import { resolveTarget } from './content-factory';
import { ScriptsTextReasoner } from './reasoner';

const result = (content: string, finishReason: string, outputTokens = 100): ChatCompletionResult => ({ requestId: 'r', generationId: null, model: 'fake/model', provider: 'fake', content, finishReason, usage: { inputTokens: 50, outputTokens, cachedTokens: null, reportedCostUsd: null }, estimatedCostUsd: 0.001, latencyMs: 5, fallbackIndex: 0, attempts: 1 });

describe('ScriptsTextReasoner', () => {
  const ctx = resolveTarget('arabic-moroccan', 'fr').context;
  const Schema = z.object({ a: z.string(), n: z.number() });
  const prompt = { system: 's', user: 'u', templateId: 't', templateVersion: '1' };

  it('sends the raised output budget, parses JSON (even fenced) and records the ledger', async () => {
    const seen: ChatCompletionRequest[] = [];
    const sink = new MemoryAiRequestSink();
    const r = new ScriptsTextReasoner({ client: { chatCompletions: async (req) => (seen.push(req), result('```json\n{"a":"x","n":1}\n```', 'stop')) }, sink, maxOutputTokens: 9000, modelOverride: 'anthropic/claude-haiku-5.5' });
    const out = await r.generateStructured('content_generation', ctx, prompt, Schema);
    expect(out).toEqual({ a: 'x', n: 1 });
    expect(seen[0]!.maxTokens).toBe(9000);
    expect(seen[0]!.models[0]).toBe('anthropic/claude-haiku-5.5');
    expect(seen[0]!.responseFormat).toMatchObject({ type: 'json_schema' });
    expect(sink.records[0]).toMatchObject({ success: true, model: 'fake/model', estimatedCostUsd: 0.001, outputTokens: 100 });
  });

  it('repairs once on schema failure, then throws with the raw content', async () => {
    let calls = 0;
    const r = new ScriptsTextReasoner({ client: { chatCompletions: async (req) => (calls += 1, req.messages.length > 2 ? result('{"a":"fixed","n":2}', 'stop') : result('{"a":"x"}', 'stop')) } });
    expect(await r.generateStructured('content_generation', ctx, prompt, Schema)).toEqual({ a: 'fixed', n: 2 });
    expect(calls).toBe(2);
    const bad = new ScriptsTextReasoner({ client: { chatCompletions: async () => result('not json', 'stop') } });
    await expect(bad.generateStructured('content_generation', ctx, prompt, Schema)).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('reports truncation explicitly and does not waste a repair turn', async () => {
    let calls = 0;
    const sink = new MemoryAiRequestSink();
    const r = new ScriptsTextReasoner({ client: { chatCompletions: async () => (calls += 1, result('{"a":"x","n":', 'length', 12000)) }, sink });
    await expect(r.generateStructured('content_generation', ctx, prompt, Schema)).rejects.toThrow(/truncated/);
    expect(calls).toBe(1);
    expect(sink.records[0]!.errorCode).toBe('output_truncated');
  });
});
