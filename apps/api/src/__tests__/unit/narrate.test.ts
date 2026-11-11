/**
 * `POST /v1/speech/narrate`: an exercise's instruction or context read aloud in the learner's instruction language.
 * Through the real app and the real `@langquest/ai` synthesizer, with the offline fake OpenRouter. The voice is one of
 * the enrollment's source language (never the target variety's); the request names no language, so it cannot be
 * steered to speak target-language content; a deployment without AI says so honestly.
 */
import { NarrateResponseSchema, apiEnvelope } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { narratorLocaleFor } from '../../routes/speech/speech';
import { enrollmentRow, profileRow, routeHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const Envelope = apiEnvelope(NarrateResponseSchema);

async function setup(options: { openRouter?: boolean } = {}) {
  const h = routeHarness({ openRouter: options.openRouter ?? true });
  h.db.seed('profiles', [profileRow(LEARNER)]);
  const [darijaFromFrench, japaneseFromEnglish] = h.db.seed('user_course_enrollments', [
    enrollmentRow(LEARNER, 'arabic-moroccan', { source_language_code: 'fr' }),
    enrollmentRow(LEARNER, 'japanese', { source_language_code: 'en' }),
  ]);
  return { h, token: await h.token(LEARNER), darijaFromFrench: darijaFromFrench!, japaneseFromEnglish: japaneseFromEnglish! };
}

describe('POST /v1/speech/narrate (the narrator)', () => {
  it('reads the instruction in the learner\'s instruction language, with a voice of that language', async () => {
    const f = await setup();
    const res = await f.h.call('/v1/speech/narrate', { token: f.token, body: { enrollmentId: f.darijaFromFrench.id, text: 'Au café. Karim vous salue. Que répondez-vous ?' } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const parsed = Envelope.parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.data.language).toBe('fr');
    expect(parsed.data.audio.synthetic).toBe(true);
    expect(parsed.data.capability).toMatchObject({ supported: true, effectiveLocale: 'fr-FR' });
    const speech = f.h.openrouter.callsTo('/audio/speech');
    expect(speech).toHaveLength(1);
    expect(speech[0]!.body!.input).toBe('Au café. Karim vous salue. Que répondez-vous ?');

    const english = await f.h.call('/v1/speech/narrate', { token: f.token, body: { enrollmentId: f.japaneseFromEnglish.id, text: 'What do you answer?' } });
    expect(english.status).toBe(200);
    expect(english.json.data).toMatchObject({ language: 'en', capability: { effectiveLocale: 'en-US' } });
  });

  it('validates the body: a learner token, some text, at most 400 characters', async () => {
    const f = await setup();
    expect((await f.h.call('/v1/speech/narrate', { body: { enrollmentId: f.darijaFromFrench.id, text: 'Bonjour' } })).status).toBe(401);
    for (const text of ['', '   ', 'x'.repeat(401)]) {
      const res = await f.h.call('/v1/speech/narrate', { token: f.token, body: { enrollmentId: f.darijaFromFrench.id, text } });
      expect(res.status).toBe(422);
    }
    expect(f.h.openrouter.callsTo('/audio/speech')).toHaveLength(0);
  });

  it('without AI on the deployment: capability_unsupported', async () => {
    const f = await setup({ openRouter: false });
    const res = await f.h.call('/v1/speech/narrate', { token: f.token, body: { enrollmentId: f.darijaFromFrench.id, text: 'Bonjour' } });
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe('capability_unsupported');
  });

  it('a narrator locale for each instruction language the app offers', () => {
    expect(narratorLocaleFor('en')).toBe('en-US');
    expect(narratorLocaleFor('fr')).toBe('fr-FR');
    expect(narratorLocaleFor('es')).toBe('es-ES');
    expect(narratorLocaleFor('ar')).toBe('ar');
    expect(narratorLocaleFor('ru')).toBe('ru-RU');
  });
});
