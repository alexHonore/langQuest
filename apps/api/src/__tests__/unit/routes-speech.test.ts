/**
 * `POST /v1/speech/transcribe` (R-6.2-04) and `POST /v1/speech/synthesize` (R-6.2-06) through the real app, the real
 * `@langquest/ai` adapters (OpenRouter STT/TTS, capability matrix, voice registry) and a fake OpenRouter reached only
 * through a fake base URL. Invariants: the enrollment's variety is the only one ever served (a request naming another
 * variety is refused, a voice of another variety is refused, the provider is always asked in the enrollment's own
 * language hint, failures never fall back to a neighbouring variety); a deployment without a provider answers an honest
 * `capability_unsupported`; synthesis only speaks approved course content or the learner's own character turns; a
 * recording is kept only under the learner's retention preference; audio is accepted inline or as a stored recording the
 * learner owns (another learner's private recording is 403, a missing / quarantined / revoked one 404), and a
 * caller-supplied URL is refused before anything is fetched.
 */
import { capabilityForVariety } from '@langquest/ai/capability/matrix';
import { SynthesizeResponseSchema, TranscribeResponseSchema, apiEnvelope } from '@langquest/contracts';
import { sha256Hex } from '@langquest/telemetry/privacy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_OPENROUTER_BASE, enrollmentRow, mediaAssetRow, profileRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WAV = Buffer.from('RIFF0000WAVEfmt fake-audio-bytes').toString('base64');
const TranscribeEnvelope = apiEnvelope(TranscribeResponseSchema);
const SynthesizeEnvelope = apiEnvelope(SynthesizeResponseSchema);

interface Fixture {
  h: RouteHarness;
  token: string;
  french: DbRow;
  darija: DbRow;
  kinyarwanda: DbRow;
  haitian: DbRow;
  archived: DbRow;
  foreign: DbRow;
}

async function setup(options: { openRouter?: boolean; media?: boolean; privacy?: DbRow } = {}): Promise<Fixture> {
  const h = routeHarness({ openRouter: options.openRouter ?? true, media: options.media });
  h.db.seed('profiles', [profileRow(LEARNER, { privacy_options: options.privacy ?? {} }), profileRow(OTHER)]);
  const [french, darija, kinyarwanda, haitian, archived, foreign] = h.db.seed('user_course_enrollments', [
    enrollmentRow(LEARNER, 'french'),
    enrollmentRow(LEARNER, 'arabic-moroccan', { source_language_code: 'fr', script_mode: 'both' }),
    enrollmentRow(LEARNER, 'kinyarwanda'),
    enrollmentRow(LEARNER, 'haitian-creole'),
    enrollmentRow(LEARNER, 'german', { status: 'archived' }),
    enrollmentRow(OTHER, 'french'),
  ]);
  return { h, token: await h.token(LEARNER), french: french!, darija: darija!, kinyarwanda: kinyarwanda!, haitian: haitian!, archived: archived!, foreign: foreign! };
}

const transcribeBody = (enrollmentId: unknown, targetVarietyId: string, over: DbRow = {}) => ({ enrollmentId, targetVarietyId, audio: { source: 'inline', base64: WAV, encoding: 'wav', sampleRateHz: 16_000 }, clientRequestId: crypto.randomUUID(), ...over });

describe('POST /v1/speech/transcribe', () => {
  let f: Fixture;
  afterEach(() => f.h.restore());

  describe('with the provider configured', () => {
    beforeEach(async () => {
      f = await setup();
    });

    it('requires a learner token', async () => {
      const res = await f.h.call('/v1/speech/transcribe', { body: transcribeBody(f.french.id, 'fr') });
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe('unauthorized');
    });

    it('validates the body (422 validation_failed) before any provider call', async () => {
      const bad = [
        { ...transcribeBody(f.french.id, 'fr'), clientRequestId: undefined },
        transcribeBody(f.french.id, 'klingon'),
        transcribeBody('not-a-uuid', 'fr'),
        transcribeBody(f.french.id, 'fr', { audio: { source: 'inline', base64: '', encoding: 'wav', sampleRateHz: null } }),
        transcribeBody(f.french.id, 'fr', { audio: { source: 'tape', encoding: 'wav', sampleRateHz: null } }),
      ];
      for (const body of bad) {
        const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body });
        expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
      expect(f.h.openrouter.calls).toHaveLength(0);
    });

    it('transcribes in the enrollment locale and answers the contract envelope with an honest capability', async () => {
      const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.french.id, 'fr') });
      expect(res.status).toBe(200);
      const parsed = TranscribeEnvelope.parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      expect(parsed.data.transcript).toMatchObject({ text: 'Bonjour', requestedLocale: 'fr-FR', provider: 'openrouter', model: 'openai/whisper-large-v3', languageMismatch: false });
      expect(parsed.data.capability).toMatchObject({ supported: true, provider: 'openrouter', effectiveLocale: 'fr-FR' });
      expect(parsed.data.recordingAssetId).toBeNull(); // default retention is `none`
      const [stt] = f.h.openrouter.callsTo('/audio/transcriptions');
      expect(stt?.body).toMatchObject({ model: 'openai/whisper-large-v3', language: 'fr', response_format: 'verbose_json' });
      // Cost ledger: one ai_requests row for the call, attributed to the enrollment.
      await f.h.flush();
      expect(f.h.db.rows('ai_requests')).toEqual([expect.objectContaining({ task: 'speech_recognition', provider: 'openrouter', success: true, enrollment_id: f.french.id })]);
      expect(f.h.blocked).toEqual([]);
    });

    it('never crosses a variety boundary: another variety is refused, Darija is asked as ar-MA and reported as such', async () => {
      const refused = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.darija.id, 'arb') });
      expect(refused.status).toBe(422);
      expect(refused.json.error.code).toBe('validation_failed');
      expect(refused.json.error.message).toContain('different variety');
      const haitianAsFrench = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.haitian.id, 'fr') });
      expect(haitianAsFrench.status).toBe(422);
      expect(f.h.openrouter.calls).toHaveLength(0);

      const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.darija.id, 'ary') });
      expect(res.status).toBe(200);
      expect(res.json.data.transcript.requestedLocale).toBe('ar-MA');
      expect(res.json.data.capability.effectiveLocale).toBe('ar-MA');
      expect(res.json.data.capability.reasons).toContain('not_benchmarked'); // Darija STT is `limited`, and says so
      expect(f.h.openrouter.callsTo('/audio/transcriptions')[0]?.body).toMatchObject({ language: 'ar' });
    });

    it('when every model fails it answers provider_unavailable after exactly one pass over the Darija model chain', async () => {
      // MSA (arb) shares Darija's language hint and model chain, so the language hint alone cannot tell them apart. What
      // can: a fallback to another variety would be a SECOND pass over a chain (more attempts than the Darija chain has)
      // or a 200 served from it. Neither may happen; every attempt and ledger row stays on the Darija enrollment.
      f.h.openrouter.transcription = () => ({ status: 400, body: { error: { message: 'audio could not be decoded', code: 400 } } });
      const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.darija.id, 'ary') });
      expect(res.status).toBe(503);
      expect(res.json.error.code).toBe('provider_unavailable');
      const attempts = f.h.openrouter.callsTo('/audio/transcriptions');
      const darijaChain = capabilityForVariety('ary').stt.models;
      expect(darijaChain.length).toBeGreaterThan(1);
      expect(attempts.map((a) => a.body?.model)).toEqual([...darijaChain]);
      expect(attempts.every((a) => a.body?.language === 'ar')).toBe(true);
      await f.h.flush();
      const ledger = f.h.db.rows('ai_requests');
      expect(ledger.map((r) => r.model)).toEqual([...darijaChain]);
      expect(ledger.every((r) => r.success === false && r.task === 'speech_recognition' && r.enrollment_id === f.darija.id)).toBe(true);
    });

    it('refuses caller-supplied audio URLs (422) without fetching them or calling the provider', async () => {
      for (const url of ['https://attacker.example/big.wav', 'http://169.254.169.254/latest/meta-data', `${FAKE_OPENROUTER_BASE}/models`]) {
        const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.french.id, 'fr', { audio: { source: 'url', url, encoding: 'wav', sampleRateHz: null } }) });
        expect(res.status, url).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
        expect(res.json.error.message).toContain('audio.source');
      }
      expect(f.h.openrouter.calls).toHaveLength(0);
      expect(f.h.blocked).toEqual([]);
      const assess = await f.h.call('/v1/speech/pronunciation-assess', { token: f.token, body: { enrollmentId: f.french.id, targetVarietyId: 'fr', referenceText: 'Bonjour', audio: { source: 'url', url: 'https://attacker.example/big.wav', encoding: 'wav', sampleRateHz: null }, clientRequestId: crypto.randomUUID() } });
      expect(assess.status).toBe(422);
      expect(assess.json.error.message).toContain('audio.source');
      expect(f.h.blocked).toEqual([]);
    });
  });

  describe('a stored recording (audio.source "asset")', () => {
    const assetBody = (assetId: string) => transcribeBody(f.french.id, 'fr', { audio: { source: 'asset', assetId, encoding: 'wav', sampleRateHz: null } });
    const storeAsset = (over: DbRow) => {
      const [asset] = f.h.db.seed('media_assets', [mediaAssetRow({ mime_type: 'audio/wav', storage_key: `masters/${crypto.randomUUID()}.wav`, ...over })]);
      f.h.bucket!.putText(asset!.storage_key as string, 'RIFF0000WAVEfmt stored-recording', 'audio/wav');
      return asset!;
    };
    beforeEach(async () => {
      f = await setup({ media: true });
    });

    it('transcribes the learner’s own recording from storage (no second copy kept)', async () => {
      const own = storeAsset({ owner_id: LEARNER });
      const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: assetBody(own.id as string) });
      expect(res.status).toBe(200);
      expect(res.json.data.transcript.text).toBe('Bonjour');
      expect(res.json.data.recordingAssetId).toBeNull();
      const [stt] = f.h.openrouter.callsTo('/audio/transcriptions');
      expect(stt?.body?.file).toMatchObject({ bytes: 'RIFF0000WAVEfmt stored-recording'.length });
      expect(f.h.db.rows('media_assets')).toHaveLength(1);
      expect(f.h.blocked).toEqual([]);
    });

    it('another learner’s private recording is forbidden (403) before any provider call', async () => {
      const foreign = storeAsset({ owner_id: OTHER, visibility: 'private', state: 'imported_draft' });
      const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: assetBody(foreign.id as string) });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('forbidden');
      expect(f.h.openrouter.calls).toHaveLength(0);
    });

    it('a missing, quarantined or revoked recording is a 404 before any provider call', async () => {
      const quarantined = storeAsset({ owner_id: LEARNER, disposition: 'quarantined' });
      const revoked = storeAsset({ owner_id: LEARNER, disposition: 'revoked' });
      for (const id of [crypto.randomUUID(), quarantined.id as string, revoked.id as string]) {
        const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: assetBody(id) });
        expect(res.status, id).toBe(404);
        expect(res.json.error.code).toBe('not_found');
      }
      expect(f.h.openrouter.calls).toHaveLength(0);
    });
  });

  describe('a foreign or archived enrollment', () => {
    beforeEach(async () => {
      f = await setup();
    });

    it('a foreign enrollment is a 404 (no leak) and an archived one a 412, both before any provider call', async () => {
      const foreign = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.foreign.id, 'fr') });
      expect(foreign.status).toBe(404);
      expect(foreign.json.error.code).toBe('not_found');
      const archived = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.archived.id, 'de') });
      expect(archived.status).toBe(412);
      expect(archived.json.error.code).toBe('precondition_failed');
      expect(f.h.openrouter.calls).toHaveLength(0);
    });
  });

  it('answers capability_unsupported (501) when no speech provider is configured, without any network call', async () => {
    f = await setup({ openRouter: false });
    const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.french.id, 'fr') });
    expect(res.status).toBe(501);
    expect(res.json).toMatchObject({ ok: false, error: { code: 'capability_unsupported' } });
    expect(f.h.openrouter.calls).toHaveLength(0);
    expect(f.h.blocked).toEqual([]);
  });

  it('keeps the recording only under an opt-in retention preference (private asset owned by the learner)', async () => {
    f = await setup({ media: true, privacy: { store_speech_recordings: 'opt_in_30_days' } });
    const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.french.id, 'fr') });
    expect(res.status).toBe(200);
    const assetId = res.json.data.recordingAssetId as string;
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/);
    const asset = f.h.db.rows('media_assets').find((a) => a.id === assetId);
    expect(asset).toMatchObject({ owner_id: LEARNER, kind: 'audio', visibility: 'private', mime_type: 'audio/wav' });
    expect(f.h.bucket?.objects.has(asset!.storage_key as string)).toBe(true);
  });

  it('a session-only retention preference keeps nothing', async () => {
    f = await setup({ media: true, privacy: { store_speech_recordings: 'session' } });
    const res = await f.h.call('/v1/speech/transcribe', { token: f.token, body: transcribeBody(f.french.id, 'fr') });
    expect(res.status).toBe(200);
    expect(res.json.data.recordingAssetId).toBeNull();
    expect(f.h.db.rows('media_assets')).toHaveLength(0);
    expect(f.h.bucket?.objects.size).toBe(0);
  });
});

describe('POST /v1/speech/synthesize', () => {
  let f: Fixture;
  let frExpression: DbRow;
  let aryExpression: DbRow;
  let rwExpression: DbRow;

  const seedContent = (fx: Fixture) => {
    [frExpression, aryExpression, rwExpression] = fx.h.db.seed('expressions', [
      { canonical_text: 'Bonjour, comment ça va ?', target_variety_id: 'fr', state: 'published', intent_id: 'greeting', reviewed: true },
      { canonical_text: 'صباح الخير، لاباس عليك؟', target_variety_id: 'ary', state: 'published', intent_id: 'greeting', reviewed: true },
      { canonical_text: 'Muraho, amakuru?', target_variety_id: 'rw', state: 'published', intent_id: 'greeting', reviewed: true },
      { canonical_text: 'Brouillon jamais publié', target_variety_id: 'fr', state: 'review_needed', intent_id: 'draft', reviewed: false },
    ]) as [DbRow, DbRow, DbRow];
    fx.h.db.seed('conversation_turns', [
      { speaker: 'character', text: null, text_hash: sha256Hex('Et vous, ça va bien ?'), session_id: crypto.randomUUID(), conversation_sessions: { user_id: LEARNER } },
      { speaker: 'character', text: null, text_hash: sha256Hex('Texte d’une autre session'), session_id: crypto.randomUUID(), conversation_sessions: { user_id: OTHER } },
    ]);
  };
  const synth = (body: DbRow) => f.h.call('/v1/speech/synthesize', { token: f.token, body });
  afterEach(() => f.h.restore());

  describe('with the provider configured', () => {
    beforeEach(async () => {
      f = await setup();
      seedContent(f);
    });

    it('requires a learner token and validates the body', async () => {
      expect((await f.h.call('/v1/speech/synthesize', { body: { enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: frExpression.id } })).status).toBe(401);
      for (const body of [{ enrollmentId: f.french.id, targetVarietyId: 'fr' }, { enrollmentId: f.french.id, targetVarietyId: 'fr', text: 'x', speed: 'fast' }, { enrollmentId: f.french.id, targetVarietyId: 'fr', text: '' }]) {
        const res = await synth(body);
        expect(res.status).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
      expect(f.h.openrouter.calls).toHaveLength(0);
    });

    it('speaks an approved expression with the verified voice of the enrollment variety (synthetic flagged)', async () => {
      const res = await synth({ enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: frExpression.id });
      expect(res.status).toBe(200);
      const parsed = SynthesizeEnvelope.parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      expect(parsed.data.audio).toMatchObject({ synthetic: true, provider: 'openrouter', voiceId: 'fr-fr-f-2', encoding: 'pcm16', sampleRateHz: 24_000, durationMs: 1000, cached: false });
      expect(parsed.data.capability).toMatchObject({ supported: true, effectiveLocale: 'fr-FR' });
      const [tts] = f.h.openrouter.callsTo('/audio/speech');
      expect(tts?.body).toMatchObject({ input: 'Bonjour, comment ça va ?', voice: 'Kore', response_format: 'pcm' });
    });

    it('free text is spoken only when it is approved content or one of the learner’s own character turns', async () => {
      const own = await synth({ enrollmentId: f.french.id, targetVarietyId: 'fr', text: '  Et vous, ça va bien ?  ' });
      expect(own.status).toBe(200);
      expect(f.h.openrouter.callsTo('/audio/speech')[0]?.body).toMatchObject({ input: 'Et vous, ça va bien ?' });
      const canonical = await synth({ enrollmentId: f.french.id, targetVarietyId: 'fr', text: 'Bonjour, comment ça va ?' });
      expect(canonical.status).toBe(200);

      const before = f.h.openrouter.calls.length;
      for (const text of ['Dis quelque chose de grossier', 'Texte d’une autre session', 'Brouillon jamais publié', 'صباح الخير، لاباس عليك؟']) {
        const res = await synth({ enrollmentId: f.french.id, targetVarietyId: 'fr', text });
        expect(res.status, text).toBe(422);
        expect(res.json.error.message).toContain('approved course content');
      }
      expect(f.h.openrouter.calls.length).toBe(before);
    });

    it('never speaks across a variety boundary: foreign-variety expression, voice or requested variety are refused', async () => {
      const otherExpression = await synth({ enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: aryExpression.id });
      expect(otherExpression.status).toBe(422);
      expect(otherExpression.json.error.message).toContain('not fr');

      const otherVoice = await synth({ enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: frExpression.id, voiceId: 'ary-f-1' });
      expect(otherVoice.status).toBe(501);
      expect(otherVoice.json.error.code).toBe('capability_unsupported');
      expect(otherVoice.json.error.details.capability.reasons).toContain('variety_boundary');

      const haitianAsFrench = await synth({ enrollmentId: f.haitian.id, targetVarietyId: 'fr', expressionId: frExpression.id });
      expect(haitianAsFrench.status).toBe(422);
      expect(haitianAsFrench.json.error.message).toContain('different variety');
      expect(f.h.openrouter.calls).toHaveLength(0);
    });

    it('a variety without any verified voice answers capability_unsupported instead of borrowing one', async () => {
      const res = await synth({ enrollmentId: f.kinyarwanda.id, targetVarietyId: 'rw', expressionId: rwExpression.id });
      expect(res.status).toBe(501);
      expect(res.json.error.code).toBe('capability_unsupported');
      expect(res.json.error.details.capability).toMatchObject({ supported: false, effectiveLocale: null });
      expect(f.h.openrouter.calls).toHaveLength(0);
    });

    it('Darija is synthesised with a Darija voice under its dialect instruction', async () => {
      const res = await synth({ enrollmentId: f.darija.id, targetVarietyId: 'ary', expressionId: aryExpression.id });
      expect(res.status).toBe(200);
      expect(res.json.data.audio.voiceId).toMatch(/^ary-/);
      expect(res.json.data.capability.effectiveLocale).toBe('ar-MA');
      expect(String(f.h.openrouter.callsTo('/audio/speech')[0]?.body?.instructions)).toContain('Moroccan Darija');
    });
  });

  it('answers capability_unsupported (501) when no speech provider is configured', async () => {
    f = await setup({ openRouter: false });
    seedContent(f);
    const res = await synth({ enrollmentId: f.french.id, targetVarietyId: 'fr', expressionId: frExpression.id });
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe('capability_unsupported');
    expect(f.h.openrouter.calls).toHaveLength(0);
    expect(f.h.blocked).toEqual([]);
  });
});
