/** Shared test doubles (no network). */
import type { z } from 'zod';
import { buildLanguageContext, type AiTaskName, type ConversationContext, type LanguageContext, type Prompt, type TextReasoner, type TextReasonerOptions, type CourseTrackId } from '@langquest/contracts';
import type { CharacterPersona } from '../prompts/builders';

export const ENROLLMENT_ID = '11111111-1111-4111-8111-111111111111';
export const CHARACTER_ID = '22222222-2222-4222-8222-222222222222';
export const SESSION_ID = '33333333-3333-4333-8333-333333333333';

export const ctxFor = (track: CourseTrackId, source: LanguageContext['sourceLanguage'] = 'fr', level: LanguageContext['learnerLevel'] = 'beginner'): LanguageContext =>
  buildLanguageContext({ uiLocale: 'fr-CA', enrollmentId: ENROLLMENT_ID, sourceLanguageCode: source, courseTrackId: track, learnerLevel: level });

export const conversationContext = (track: CourseTrackId, source: LanguageContext['sourceLanguage'] = 'fr'): ConversationContext => ({
  language: ctxFor(track, source),
  missionId: null,
  characterId: CHARACTER_ID,
  scenarioId: null,
  sceneFacts: ['A small café near the station', 'It is morning'],
  objectives: [
    { id: 'greet', description: 'Greet the barista', skillKeys: ['greetings.basic'], completed: false },
    { id: 'order_coffee', description: 'Order a coffee', skillKeys: ['ordering.cafe'], completed: false },
  ],
  recentWeaknessSkillKeys: ['numbers.prices'],
  turnSummary: '',
  register: 'casual',
  relationshipSummary: null,
});

export const persona: CharacterPersona = { id: CHARACTER_ID, name: 'Samira', role: 'a barista', region: 'Casablanca', personality: 'warm, playful, patient', voiceId: 'ary-f-1', speechSpeed: 'normal' };

type Handler = (prompt: Prompt, locale: LanguageContext) => unknown;

/** Scripted TextReasoner: responses queued per task; the Zod schema validates each reply like the real one. */
export class FakeReasoner implements TextReasoner {
  readonly calls: Array<{ task: AiTaskName; prompt: Prompt; locale: LanguageContext; options?: TextReasonerOptions }> = [];
  private readonly queues = new Map<AiTaskName, Handler[]>();

  on(task: AiTaskName, handler: Handler | unknown): this {
    const list = this.queues.get(task) ?? [];
    list.push(typeof handler === 'function' ? (handler as Handler) : () => handler);
    this.queues.set(task, list);
    return this;
  }

  async generateStructured<T>(task: AiTaskName, locale: LanguageContext, prompt: Prompt, schema: z.ZodType<T>, options?: TextReasonerOptions): Promise<T> {
    this.calls.push({ task, prompt, locale, options });
    const list = this.queues.get(task) ?? [];
    const handler = list.length > 1 ? list.shift() : list[0];
    if (!handler) throw new Error(`FakeReasoner: no response scripted for task ${task}`);
    return schema.parse(handler(prompt, locale));
  }
}

/** Minimal fetch mock that routes by URL substring and records every call. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: BodyInit | null | undefined;
}

export function mockFetch(routes: Array<{ match: (url: string, body: unknown) => boolean; respond: (call: RecordedCall, n: number) => Response | Promise<Response> }>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const rawBody = init?.body;
    let body: unknown = null;
    if (typeof rawBody === 'string') {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    } else if (rawBody instanceof FormData) {
      body = Object.fromEntries([...rawBody.entries()].map(([k, v]) => [k, v instanceof Blob ? `<blob ${v.size} ${v.type}>` : v]));
    }
    const call: RecordedCall = { url, method: init?.method ?? 'GET', headers: (init?.headers as Record<string, string>) ?? {}, body, rawBody };
    calls.push(call);
    const route = routes.find((r) => r.match(url, body));
    if (!route) return new Response(JSON.stringify({ error: { message: `no route for ${url}`, code: 404 } }), { status: 404, headers: { 'content-type': 'application/json' } });
    return route.respond(call, calls.length);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export const jsonResponse = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

export const chatResponse = (content: string, model = 'anthropic/claude-haiku-5.5', extra: Record<string, unknown> = {}) =>
  jsonResponse({ id: 'gen-test', model, provider: 'TestProvider', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.00005 }, ...extra });

/** A tiny valid MP3 frame sequence is not worth synthesising; use PCM for audio fixtures. */
export const pcmFixture = (ms: number, rate = 16_000): Uint8Array => new Uint8Array(Math.round((ms / 1000) * rate * 2));
