import { describe, expect, it } from 'vitest';
import { createAiServices, readAiEnv } from './index';

describe('createAiServices', () => {
  it('wires every adapter from env without network access and reports honest capabilities', async () => {
    const warnings: string[] = [];
    const services = await createAiServices({ OPENROUTER_API_KEY: 'sk-or-test', AZURE_SPEECH_KEY: '', AZURE_SPEECH_REGION: '' }, { logger: { info() {}, warn: (e) => void warnings.push(e), error() {} }, fetch: (async () => new Response('{}')) as typeof fetch });
    expect(services.azureAssessor.enabled).toBe(false);
    expect(warnings).toContain('ai.tickets.ephemeral_secret');
    expect((await services.registry.recognizerFor('ar-MA'))?.adapter.provider).toBe('openrouter');
    expect((await services.registry.synthesizerFor('rw-RW'))).toBeNull();
    expect((await services.registry.realtimeFor('fr-FR', true))?.adapter.provider).toBe('pipeline_stt_llm_tts');
    expect((await services.registry.assessorFor('ar-EG', ['phoneme']))).toBeNull(); // Azure disabled
    expect((await services.registry.assessorFor('ar-EG', ['word']))?.adapter.provider).toBe('reference_comparison');
    expect((await services.assessor.capability('ar-MA')).provider).toBe('reference_comparison');
    expect(services.profiles.list().length).toBeGreaterThan(12);
  });
  it('parses env, treating empty strings as unset and validating the ticket secret length', () => {
    expect(readAiEnv({ OPENROUTER_API_KEY: 'k', AI_SESSION_TICKET_SECRET: '' }).AI_SESSION_TICKET_SECRET).toBeUndefined();
    expect(() => readAiEnv({ OPENROUTER_API_KEY: 'k', AI_SESSION_TICKET_SECRET: 'short' })).toThrow();
    expect(() => readAiEnv({})).toThrow();
  });
});
