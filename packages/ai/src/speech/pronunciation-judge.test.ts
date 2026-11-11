import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, ChatCompletionResult } from '../openrouter/client';
import { ModelProfileRegistry } from '../profiles';
import { MemoryAiRequestSink } from '../reasoner';
import { LlmPronunciationJudge, PronunciationJudgeError, bandFor, judgePrompt, parseJudgement } from './pronunciation-judge';

const answer = (content: string): ChatCompletionResult =>
  ({
    requestId: 'r',
    generationId: null,
    model: 'google/gemini-3.8-flash',
    provider: 'google',
    content,
    finishReason: 'stop',
    usage: { inputTokens: 900, outputTokens: 200, cachedTokens: null, reportedCostUsd: 0.002 },
    estimatedCostUsd: 0.002,
    latencyMs: 4200,
    fallbackIndex: 0,
    attempts: 1,
  }) as ChatCompletionResult;

const silentH = JSON.stringify({
  targetIpa: 'ˈola ˈbwenos ˈdias',
  heardIpa: 'ˈxola ˈbwenos ˈdias',
  heard: 'Jola, buenos días',
  matchesTarget: true,
  score: 75,
  words: [
    { word: 'Hola', status: 'mispronounced', tip: 'Le h ne se prononce pas : dites « ola ».' },
    { word: 'buenos', status: 'good', tip: null },
    { word: 'días', status: 'good', tip: '' },
  ],
  summary: 'Bien compris, mais le h de « Hola » est prononcé.',
  tip: 'Gardez le h muet.',
});

const input = { audio: { bytes: new Uint8Array([82, 73, 70, 70]), format: 'wav' as const }, targetText: 'Hola, buenos días.', varietyName: 'Spanish (Spain, Castilian)', sourceLanguage: 'fr' };

describe('AI pronunciation feedback (a listening model)', () => {
  it('asks for IPA of what is heard before comparing, typical errors of the learner, tips in their language', () => {
    const prompt = judgePrompt({ targetText: 'السلام عليكم', transliteration: 'salam 3alikom', varietyName: 'Moroccan Arabic (Darija)', sourceLanguage: 'fr' });
    expect(prompt).toContain('learners whose first language is French, learning Moroccan Arabic (Darija)');
    expect(prompt).toContain('"السلام عليكم" (romanized: "salam 3alikom")');
    expect(prompt).toContain('Do NOT assume the learner said it correctly');
    expect(prompt.indexOf('"heardIpa"')).toBeGreaterThan(prompt.indexOf('"targetIpa"'));
    expect(prompt).toContain('as if you did not know the target');
    expect(prompt).toContain('in French, simply, for a beginner');
  });

  it('reads the JSON even inside a code fence; anything else is no judgement', () => {
    expect(parseJudgement('```json\n' + silentH + '\n```')?.score).toBe(75);
    expect(parseJudgement('I could not hear anything.')).toBeNull();
    expect(parseJudgement('{"score": "high"}')).toBeNull();
  });

  it('bands: off target whatever the sound when the phrase was not said', () => {
    expect(bandFor(97, true)).toBe('native_like');
    expect(bandFor(62, true)).toBe('clear_accent');
    expect(bandFor(40, true)).toBe('hard_to_understand');
    expect(bandFor(20, true)).toBe('off_target');
    expect(bandFor(95, false)).toBe('off_target');
  });

  it('sends the take as an audio part with the prompt, and returns the judgement; the cost is recorded', async () => {
    const sent: ChatCompletionRequest[] = [];
    const sink = new MemoryAiRequestSink();
    const judge = new LlmPronunciationJudge({ client: { chatCompletions: async (req) => (sent.push(req), answer(silentH)) }, sink });
    const result = await judge.judge(input, { enrollmentId: 'e-1' });
    const message = sent[0]!.messages[0]!;
    expect(Array.isArray(message.content)).toBe(true);
    const parts = message.content as readonly { type: string }[];
    expect(parts.map((p) => p.type)).toEqual(['text', 'input_audio']);
    expect(parts[1]).toEqual({ type: 'input_audio', input_audio: { data: 'UklGRg==', format: 'wav' } });
    expect(sent[0]!.models[0]).toBe('google/gemini-3.8-flash');
    expect(result).toMatchObject({ score: 75, band: 'clear_accent', matchesTarget: true, heardIpa: 'ˈxola ˈbwenos ˈdias', tip: 'Gardez le h muet.' });
    expect(result.words.map((w) => [w.word, w.status, w.tip])).toEqual([
      ['Hola', 'mispronounced', 'Le h ne se prononce pas : dites « ola ».'],
      ['buenos', 'good', null],
      ['días', 'good', null],
    ]);
    expect(sink.records[0]).toMatchObject({ task: 'pronunciation_feedback', success: true, estimatedCostUsd: 0.002, enrollmentId: 'e-1', redactedLog: { method: 'ai_listening' } });
  });

  it('listens with the pronunciation_feedback profile an admin set for the variety, else the built-in models', async () => {
    const sent: ChatCompletionRequest[] = [];
    const profiles = new ModelProfileRegistry();
    const judge = new LlmPronunciationJudge({ client: { chatCompletions: async (req) => (sent.push(req), answer(silentH)) }, profiles });
    await judge.judge({ ...input, targetVariety: 'es-ES' });
    expect(sent[0]!.models, 'the package default profile').toEqual(['google/gemini-3.8-flash', 'google/gemini-3.5-flash-lite']);
    await profiles.refresh({ load: async () => [{ ...profiles.listDefaults('pronunciation_feedback')[0]!, id: crypto.randomUUID(), targetVariety: 'es-ES', primaryModel: 'openai/gpt-audio-mini', fallbackModels: [] }] });
    await judge.judge({ ...input, targetVariety: 'es-ES' });
    expect(sent[1]!.models).toEqual(['openai/gpt-audio-mini']);
  });

  it('clamps a score out of range; an unusable answer is an error (and recorded as failed)', async () => {
    const sink = new MemoryAiRequestSink();
    const over = new LlmPronunciationJudge({ client: { chatCompletions: async () => answer(silentH.replace('"score":75', '"score":140')) } });
    expect((await over.judge(input)).score).toBe(100);
    const broken = new LlmPronunciationJudge({ client: { chatCompletions: async () => answer('Sorry.') }, sink });
    await expect(broken.judge(input)).rejects.toBeInstanceOf(PronunciationJudgeError);
    expect(sink.records[0]).toMatchObject({ success: false, errorCode: 'invalid_output' });
  });
});
