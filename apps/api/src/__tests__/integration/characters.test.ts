/**
 * Stack-bound: the seeded cast (migration 130) reaches learners through the course manifest and conversation
 * sessions. A learner enrolled in Arabic (Moroccan) FROM FRENCH fetches the manifest, finds Nadia (deterministic id
 * shared with the `@langquest/ui` roster), opens a text-only session with her, and gets a non-empty opening turn
 * produced with her variety (`ary`) and the enrollment's source language (`fr`) in the language context.
 * The reasoner is a scripted fake (no OpenRouter call); the live counterpart stays under `__tests__/live`.
 */
import { getPromptPack } from '@langquest/ai/prompts/packs';
import { FakeReasoner } from '@langquest/ai/test-support/fakes';
import { characterUuid } from '@langquest/db/character-uuid';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createStackUser, describeWithStack, fakeAiServices, stackApp, teardownStack, trackRow, type StackHarness, type TestUser } from '../harness';

const describeStack = describeWithStack('api.characters');

const NADIA_KEY = 'ary-cafe-staff-nadia';
const NADIA_ID = characterUuid(NADIA_KEY);
const YOUSSEF_ID = characterUuid('ary-neighbour-youssef');

interface ManifestCharacterDto {
  id: string;
  name: string;
  role: string;
  varietyId: string;
  syntheticVoice: boolean;
  characterKey?: string;
  portraitKey?: string;
  regionalOption?: string | null;
  region?: string;
}

describeStack('seeded cast: manifest → conversation session', () => {
  let h: StackHarness;
  let learner: TestUser;
  let enrollmentId: string;
  const reasoner = new FakeReasoner();
  const pack = getPromptPack('ary');
  const opening = pack.exemplars[0]!;

  beforeAll(async () => {
    h = stackApp({ OPENROUTER_API_KEY: 'sk-or-test-not-used' }, { aiFactory: async () => fakeAiServices(reasoner) });
    learner = await createStackUser(h, 'cast', { defaultSourceLanguageCode: 'fr', uiLocale: 'fr-CA' });
    reasoner.on('character_dialogue', { text: opening.target, transliteration: opening.transliteration, sourceGloss: null, expression: 'greeting', respondsToCommand: null, tentativeObjectiveIds: [], endsConversation: false });
    const enrollment = await call(h.app, '/v1/me/enrollments', { token: learner.token, body: { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both', regionalPreference: 'casablanca' } });
    expect(enrollment.status, JSON.stringify(enrollment.json)).toBe(201);
    enrollmentId = enrollment.json.data.id as string;
  });

  afterAll(() => teardownStack(h));

  it('the seed is present: Nadia has the deterministic id shared with the art roster', async () => {
    const row = await h.service.from('characters').select('id, character_key, state, target_variety_id, voice_profile').eq('character_key', NADIA_KEY).maybeSingle();
    expect(row.error).toBeNull();
    expect(row.data, 'migration 130 (seed characters) must be applied to the local stack').toMatchObject({ id: NADIA_ID, state: 'published', target_variety_id: 'ary' });
    expect((row.data!.voice_profile as { synthetic?: boolean }).synthetic).toBe(true);
  });

  it('GET /v1/courses/:trackId/manifest lists the published cast with the art mapping and synthetic-voice disclosure', async () => {
    const manifest = await call(h.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token });
    expect(manifest.status, JSON.stringify(manifest.json)).toBe(200);
    const characters = manifest.json.data.characters as ManifestCharacterDto[];
    expect(characters.length).toBeGreaterThan(0);
    const nadia = characters.find((ch) => ch.characterKey === NADIA_KEY);
    expect(nadia, 'Nadia missing from the manifest cast').toBeDefined();
    expect(nadia).toMatchObject({ id: NADIA_ID, name: 'Nadia', varietyId: 'ary', syntheticVoice: true, portraitKey: NADIA_KEY, regionalOption: 'casablanca' });
    // Every manifest character speaks the track's variety and is disclosed as synthetic (§8.6).
    for (const ch of characters) {
      expect(ch.varietyId).toBe('ary');
      expect(ch.syntheticVoice).toBe(true);
      expect(ch.characterKey).toBeTruthy();
    }
    // The published catalog counts the cast too.
    const courses = await call(h.app, '/v1/courses?source=fr');
    const darija = courses.json.data.courses.find((c: { track: { id: string } }) => c.track.id === 'arabic-moroccan');
    expect(darija.characterCount).toBeGreaterThanOrEqual(2);
  });

  it('a stored manifest with a stale (empty) cast is rebuilt and re-stored on the way out', async () => {
    const latest = await h.service.from('course_manifests').select('version, manifest').eq('course_track_id', 'arabic-moroccan').eq('source_language_code', 'fr').order('version', { ascending: false }).limit(1).maybeSingle();
    expect(latest.error).toBeNull();
    const version = (latest.data?.version ?? -1) + 1;
    // A copy as the API stored it before the seed: valid envelope, no characters.
    const live = await call(h.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token });
    const stale = { ...live.json.data, version, characters: [], checksum: 'f'.repeat(64) };
    const inserted = await h.service.from('course_manifests').insert({ course_track_id: 'arabic-moroccan', source_language_code: 'fr', version, checksum: stale.checksum, manifest: stale, published_at: new Date().toISOString() }).select('id').single();
    expect(inserted.error?.message ?? null).toBeNull();
    trackRow(h, 'course_manifests', inserted.data!.id);
    // Fresh app instance: an empty edge cache, so the stored copy is consulted.
    const fresh = stackApp({ OPENROUTER_API_KEY: 'sk-or-test-not-used' }, { aiFactory: async () => fakeAiServices(reasoner) });
    const res = await call(fresh.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.headers.get('x-manifest-source')).toBe('refreshed');
    expect(res.json.data.version).toBe(version + 1);
    const ids = (res.json.data.characters as ManifestCharacterDto[]).map((ch) => ch.id);
    expect(ids).toContain(NADIA_ID);
    // The API stored the rebuilt copy as version + 1: it is this suite's row too.
    const refreshed = await h.service.from('course_manifests').select('id').eq('course_track_id', 'arabic-moroccan').eq('source_language_code', 'fr').eq('version', version + 1).maybeSingle();
    if (refreshed.data) trackRow(h, 'course_manifests', refreshed.data.id);
    // The refreshed copy is now stored and served as such on the next uncached request.
    const again = stackApp({ OPENROUTER_API_KEY: 'sk-or-test-not-used' }, { aiFactory: async () => fakeAiServices(reasoner) });
    const second = await call(again.app, '/v1/courses/arabic-moroccan/manifest?source=fr', { token: learner.token });
    expect(second.headers.get('x-manifest-source')).toBe('stored');
    expect(second.json.data.version).toBe(version + 1);
    await fresh.app.flush();
    await again.app.flush();
  });

  it('POST /v1/ai/conversation/session with Nadia’s manifest id opens a text-only session whose opening turn uses ary + fr', async () => {
    const before = reasoner.calls.length;
    const clientSessionId = crypto.randomUUID();
    const session = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId: NADIA_ID, clientSessionId, mode: 'text_only' } });
    expect(session.status, JSON.stringify(session.json)).toBe(201);
    expect(session.json.data.character).toMatchObject({ id: NADIA_ID, name: 'Nadia', targetVarietyId: 'ary', syntheticVoice: true });
    expect(session.json.data.provider.pipeline).toBe('text_only');
    const turn = session.json.data.openingTurn;
    expect(turn).not.toBeNull();
    expect(turn.characterId).toBe(NADIA_ID);
    expect(typeof turn.text).toBe('string');
    expect(turn.text.trim().length).toBeGreaterThan(0);
    // The character agent was called with the character's variety and the enrollment's source language.
    const dialogue = reasoner.calls.slice(before).filter((c) => c.task === 'character_dialogue');
    expect(dialogue.length).toBeGreaterThanOrEqual(1);
    expect(dialogue[0]!.locale).toMatchObject({ targetVariety: 'ary', targetTrack: 'arabic-moroccan', sourceLanguage: 'fr', enrollmentId, regionalPreference: 'casablanca' });
    // Replay on the same clientSessionId returns the same session and turn without another model call.
    const calls = reasoner.calls.length;
    const replay = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId: NADIA_ID, clientSessionId, mode: 'text_only' } });
    expect(replay.status).toBe(200);
    expect(replay.json.data.openingTurn.turnId).toBe(turn.turnId);
    expect(reasoner.calls.length).toBe(calls);
  });

  it('accepts the roster key as a backward-compatible characterId and resolves it to the same character', async () => {
    const session = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId: NADIA_KEY, clientSessionId: crypto.randomUUID(), mode: 'text_only' } });
    expect(session.status, JSON.stringify(session.json)).toBe(201);
    expect(session.json.data.character.id).toBe(NADIA_ID);
    expect(session.json.data.openingTurn?.characterId).toBe(NADIA_ID);
  });

  it('picks a regionally matching published character when none is requested', async () => {
    const session = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, clientSessionId: crypto.randomUUID(), mode: 'text_only' } });
    expect(session.status, JSON.stringify(session.json)).toBe(201);
    expect([NADIA_ID, YOUSSEF_ID]).toContain(session.json.data.character.id);
  });

  it('404s only when the character is truly absent (unknown uuid, unknown key, unpublished row)', async () => {
    const unknownUuid = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId: crypto.randomUUID(), clientSessionId: crypto.randomUUID(), mode: 'text_only' } });
    expect(unknownUuid.status).toBe(404);
    expect(unknownUuid.json.error.code).toBe('not_found');
    const unknownKey = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId: 'ary-nobody-at-all', clientSessionId: crypto.randomUUID(), mode: 'text_only' } });
    expect(unknownKey.status).toBe(404);
    const malformed = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId: 'Not A Key!', clientSessionId: crypto.randomUUID(), mode: 'text_only' } });
    expect(malformed.status).toBe(422);
    // A draft character is invisible to learners (RLS) → absent, never substituted.
    const draftKey = `cast.draft.${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const draft = await h.service.from('characters').insert({ character_key: draftKey, name: 'Draft', role: 'tester', personality: 'quiet', home_region: 'Rabat', target_variety_id: 'ary', voice_profile: { synthetic: true }, storyline_facts: ['draft'], state: 'review_needed' }).select('id').single();
    expect(draft.error?.message ?? null).toBeNull();
    trackRow(h, 'characters', draft.data!.id);
    const hidden = await call(h.app, '/v1/ai/conversation/session', { token: learner.token, body: { enrollmentId, characterId: draft.data!.id, clientSessionId: crypto.randomUUID(), mode: 'text_only' } });
    expect(hidden.status).toBe(404);
  });
});
