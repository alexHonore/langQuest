import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiProviderUnavailableError } from './errors';
import { OpenRouterClient } from './openrouter/client';
import { MemoryAiRequestSink, OpenRouterTextReasoner, StructuredOutputError, extractJson, isStrictCompatible, toResponseFormat } from './reasoner';
import { ModelProfileRegistry, defaultProfileId } from './profiles';
import { ModelProfileSchema } from '@langquest/contracts';
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
    expect(body.models).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna', 'google/gemini-3.8-flash']);
    const rf = body.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema).toMatchObject({ type: 'object', required: ['reply', 'variety'], additionalProperties: false });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ task: 'character_dialogue', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', success: true, traceId: 'trace-1', enrollmentId: ctxFor('arabic-moroccan').enrollmentId, inputTokens: 100, outputTokens: 20 });
    expect(JSON.stringify(sink.records[0]?.redactedLog)).not.toContain('say hi');
  });

  it('ledger rows stay pseudonymous by default and never carry package-default profile ids', async () => {
    const { reasoner, sink } = setup(() => chatResponse('{"reply":"x","variety":"arb"}'));
    await reasoner.generateStructured('scene_planning', ctxFor('arabic-msa', 'en'), prompt, Schema);
    expect(sink.records[0]).toMatchObject({ userId: null, profileId: null });
    expect(sink.records[0]?.redactedLog).toMatchObject({ profileSource: 'package-default' });
    expect(defaultProfileId('scene_planning', null, null)).not.toBe(sink.records[0]?.profileId);
  });

  it('writes injected attribution and the DB profile id when the profile came from ai_model_profiles', async () => {
    const { fetchImpl } = mockFetch([{ match: (u) => u.endsWith('/chat/completions'), respond: () => chatResponse('{"reply":"x","variety":"arb"}') }]);
    const client = new OpenRouterClient({ apiKey: 'k', fetch: fetchImpl, sleep: async () => {}, requestIdFactory: () => 'req' });
    const profiles = new ModelProfileRegistry();
    const dbRow = ModelProfileSchema.parse({ ...profiles.resolve({ task: 'scene_planning', targetVariety: 'arb', sourceLanguage: 'en' }), resolvedSource: undefined, id: 'abababab-abab-4bab-8bab-abababababab' });
    await profiles.refresh({ load: async () => [dbRow] });
    const sink = new MemoryAiRequestSink();
    const reasoner = new OpenRouterTextReasoner({ client, profiles, sink, attribution: { userId: 'user-1' } });
    await reasoner.generateStructured('scene_planning', ctxFor('arabic-msa', 'en'), prompt, Schema);
    expect(sink.records[0]).toMatchObject({ userId: 'user-1', profileId: 'abababab-abab-4bab-8bab-abababababab', enrollmentId: ctxFor('arabic-msa', 'en').enrollmentId });
    expect(sink.records[0]?.redactedLog).toMatchObject({ profileSource: 'db' });
    await reasoner.generateStructured('scene_planning', ctxFor('arabic-msa', 'en'), prompt, Schema, { attribution: { userId: null, enrollmentId: 'enr-override' } });
    expect(sink.records[1]).toMatchObject({ userId: null, profileId: 'abababab-abab-4bab-8bab-abababababab', enrollmentId: 'enr-override' });
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

  it('retries a reply cut off by max_tokens with a larger output budget and a truncation note (never the same cap twice)', async () => {
    // Live failure 2026-10-19: Darija text + transliteration + French gloss did not fit the 400-token dialogue cap;
    // the model answered with finish_reason "length" twice and the learner saw a 503.
    const { reasoner, sink, calls } = setup((n) => (n === 1 ? chatResponse('{"reply":"صباح', 'anthropic/claude-sonnet-5.5', { choices: [{ message: { role: 'assistant', content: '{"reply":"صباح' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 1000 } }) : chatResponse('{"reply":"صباح الخير","variety":"ary"}')));
    const out = await reasoner.generateStructured('character_dialogue', ctxFor('arabic-moroccan'), prompt, Schema);
    expect(out.variety).toBe('ary');
    expect(calls).toHaveLength(2);
    const first = calls[0]?.body as { max_tokens: number };
    const second = calls[1]?.body as { max_tokens: number; messages: Array<{ role: string; content: string }> };
    expect(first.max_tokens).toBe(1000);
    expect(second.max_tokens).toBeGreaterThan(first.max_tokens);
    expect(second.messages.at(-1)?.content).toMatch(/cut off by the output limit/);
    expect(sink.records[0]).toMatchObject({ success: false, errorCode: 'output_truncated' });
    expect(sink.records[0]?.redactedLog).toMatchObject({ finishReason: 'length', maxTokens: 1000 });
    expect(sink.records[1]).toMatchObject({ success: true });
  });

  it('names the output limit when both attempts are truncated', async () => {
    const { reasoner } = setup(() => chatResponse('{"reply":"', 'anthropic/claude-haiku-5.5', { choices: [{ message: { role: 'assistant', content: '{"reply":"' }, finish_reason: 'length' }] }));
    const err = await reasoner.generateStructured('scene_planning', ctxFor('french', 'en'), prompt, Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect((err as Error).message).toMatch(/cut off by the output limit/);
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
