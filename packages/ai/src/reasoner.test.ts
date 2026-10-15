import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiProviderUnavailableError } from './errors';
import { OpenRouterClient } from './openrouter/client';
import { MemoryAiRequestSink, OpenRouterTextReasoner, StructuredOutputError, extractJson, isStrictCompatible, toResponseFormat } from './reasoner';
import { ModelProfileRegistry } from './profiles';
import { chatResponse, ctxFor, jsonResponse, mockFetch } from './test-support/fakes';

const prompt = { system: 'sys', user: 'say hi', templateId: 'test.prompt', templateVersion: '1' };
const Schema = z.object({ reply: z.string(), variety: z.enum(['ary', 'arb']) });

const setup = (responder: (n: number, body: Record<string, unknown>) => Response) => {
  const { fetchImpl, calls } = mockFetch([{ match: (u) => u.endsWith('/chat/completions'), respond: (call, n) => responder(n, call.body as Record<string, unknown>) }]);
  const client = new OpenRouterClient({ apiKey: 'k', fetch: fetchImpl, sleep: async () => {}, requestIdFactory: () => 'req' });
  const sink = new MemoryAiRequestSink();
  const reasoner = new OpenRouterTextReasoner({ client, profiles: new ModelProfileRegistry(), sink });
  return { reasoner, sink, calls };
};

describe('OpenRouterTextReasoner', () => {
  it('resolves the profile chain, sends a JSON schema response_format and validates with Zod', async () => {
    const { reasoner, sink, calls } = setup(() => chatResponse('{"reply":"صباح الخير","variety":"ary"}'));
    const out = await reasoner.generateStructured('character_dialogue', ctxFor('arabic-moroccan'), prompt, Schema, { traceId: 'trace-1' });
    expect(out).toEqual({ reply: 'صباح الخير', variety: 'ary' });
    const body = calls[0]?.body as Record<string, unknown>;
    // ary has a variety-scoped dialogue profile: sonnet primary with fallbacks
    expect(body.models).toEqual(['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash']);
    const rf = body.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema).toMatchObject({ type: 'object', required: ['reply', 'variety'], additionalProperties: false });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, traceId: 'trace-1', enrollmentId: ctxFor('arabic-moroccan').enrollmentId, inputTokens: 100, outputTokens: 20 });
    expect(JSON.stringify(sink.records[0]?.redactedLog)).not.toContain('say hi');
  });

  it('retries once with a repair instruction when the output fails the schema, then succeeds', async () => {
    const { reasoner, sink, calls } = setup((n) => (n === 1 ? chatResponse('```json\n{"reply":"x","variety":"msa"}\n```') : chatResponse('{"reply":"x","variety":"arb"}')));
    const out = await reasoner.generateStructured('scene_planning', ctxFor('arabic-msa', 'en'), prompt, Schema);
    expect(out.variety).toBe('arb');
    expect(calls).toHaveLength(2);
    const second = (calls[1]?.body as { messages: Array<{ role: string; content: string }> }).messages;
    expect(second.at(-2)?.role).toBe('assistant');
    expect(second.at(-1)?.content).toMatch(/did not match the required JSON schema/);
    expect(second.at(-1)?.content).toContain('variety');
    expect(sink.records.map((r) => r.success)).toEqual([false, true]);
    expect(sink.records[0]?.errorCode).toBe('schema_validation_failed');
  });

  it('throws StructuredOutputError after the repair retry also fails', async () => {
    const { reasoner } = setup(() => chatResponse('not json at all'));
    await expect(reasoner.generateStructured('scene_planning', ctxFor('french', 'en'), prompt, Schema)).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('records a failed request when the provider errors and surfaces operator failures as provider_unavailable', async () => {
    const { reasoner, sink } = setup(() => jsonResponse({ error: { message: 'nope', code: 401 } }, 401));
    const err = await reasoner.generateStructured('scene_planning', ctxFor('french', 'en'), prompt, Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderUnavailableError);
    expect(err).toMatchObject({ code: 'provider_unavailable', providerErrorKind: 'auth', requestId: 'req' });
    expect((err as AiProviderUnavailableError).cause).toMatchObject({ kind: 'auth' });
    expect(sink.records[0]).toMatchObject({ success: false, errorCode: 'auth' });
  });

  it('never leaks the provider\'s credits/balance wording to a learner-facing error (402)', async () => {
    const { reasoner, sink } = setup(() => jsonResponse({ error: { message: 'Insufficient credits. Add more credits at https://openrouter.ai/settings/credits and retry.', code: 402 } }, 402));
    const err = await reasoner.generateStructured('character_dialogue', ctxFor('arabic-moroccan'), prompt, Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderUnavailableError);
    expect((err as Error).message).not.toMatch(/credit|balance|openrouter/i);
    expect((err as AiProviderUnavailableError).providerErrorKind).toBe('insufficient_credits');
    expect(sink.records[0]).toMatchObject({ success: false, errorCode: 'insufficient_credits' });
  });

  it('keeps request-level errors (bad request) classified as they are', async () => {
    const { reasoner } = setup(() => jsonResponse({ error: { message: 'messages: invalid', code: 400 } }, 400));
    await expect(reasoner.generateStructured('scene_planning', ctxFor('french', 'en'), prompt, Schema)).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('honours modelOverride by placing it first in the chain', async () => {
    const { reasoner, calls } = setup(() => chatResponse('{"reply":"x","variety":"arb"}'));
    await reasoner.generateStructured('scene_planning', ctxFor('arabic-msa', 'en'), prompt, Schema, { modelOverride: 'google/gemini-3.8-flash' });
    expect((calls[0]?.body as { models: string[] }).models[0]).toBe('google/gemini-3.8-flash');
  });
});

describe('schema helpers', () => {
  it('disables strict mode when optional keys exist', () => {
    expect(isStrictCompatible(z.toJSONSchema(z.object({ a: z.string(), b: z.string().optional() })))).toBe(false);
    expect(toResponseFormat('x', z.object({ a: z.string().nullable() })).json_schema.strict).toBe(true);
  });
  it('extracts JSON from fences and prose', () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` done')).toBe('{"a":1}');
    expect(extractJson('prefix {"a":{"b":[1,2]}} suffix')).toBe('{"a":{"b":[1,2]}}');
  });
});
