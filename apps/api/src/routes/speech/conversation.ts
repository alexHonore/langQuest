/**
 * §6.2 conversation routes (§8.3, §8.6): session creation with a short-lived HMAC ticket and an opening
 * character turn, text/audio turns through the STT → character agent (language guard) → TTS pipeline with
 * replay-safe `clientTurnId`, and session end (evaluator, ≤ 2 priority corrections, summary, XP, review scheduling).
 *
 * The evaluator runs asynchronously every few turns (`ctx.waitUntil`) and synchronously at the end; the
 * character agent never receives full transcripts, only the compact context (§8.3).
 *
 * Audio turns: learner audio is accepted inline or as the learner's own stored recording; a caller-supplied URL is
 * refused (422, nothing fetched) exactly like the speech routes. The take is transcribed HERE, through the non-speech
 * gate (`screening: 'learner'`), before the learner turn is recorded or the character is asked: a take without speech
 * answers `speech: { speechDetected: false, reason }` with no learner turn, no character reply (no LLM / TTS call) and
 * therefore no evaluator evidence and no XP. A take with speech is recorded with its transcript and reaches the
 * character agent as a `transcript` input (the pipeline does not transcribe it a second time).
 */
import { CancelledError, createCancellationToken } from '@langquest/ai/realtime/pipeline';
import { signSessionTicket } from '@langquest/ai/realtime/tickets';
import { applySpeechScreening, speechDetectionOf } from '@langquest/ai/speech/speech-detection';
import { ConversationEndRequestSchema, ConversationEndResponseSchema, ConversationSessionCreateRequestSchema, ConversationSessionCreateResponseSchema, ConversationTurnRequestSchema, ConversationTurnResponseSchema, UuidSchema, emptyEvaluatorOutput, unsupportedCapability, type AudioInput, type Capability, type CharacterTurn, type ConversationSessionScope, type ConversationTurnAudio, type EvaluatorOutput, type LearnerTurnInput, type ShortLivedSession, type SpeechDetection, type SpeechRetention } from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { sha256Hex } from '@langquest/telemetry/privacy';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { AI_TIMEOUT_MS } from '../../app';
import { problem, respondErr, respondOk } from '../../http/envelope';
import { parseBody, parseParams } from '../../http/validate';
import { attachAudio, audioLessonSceneFacts, buildContext, CharacterRefSchema, evaluateSession, EVALUATE_EVERY_TURNS, hasForbiddenControlChars, isCreditedLearnerTurn, listTurns, loadOwnedSession, MAX_LEARNER_TEXT_CHARS, MAX_SESSION_MS, normaliseLearnerText, objectivesFromMission, personaFor, recentWeaknesses, refreshSummary, relationshipSummary, resolveCharacterRef, sessionScope, sessionState, syntheticVoiceOf, voiceConfig, type CharacterRow, type SessionRow } from '../../lib/conversation';
import { parsePrivacy } from '../../lib/dto';
import { languageContextFor, loadOwnedEnrollment, loadUiLocale, varietyOf, type EnrollmentRow } from '../../lib/enrollment';
import { awardXp, scheduleReviews } from '../../lib/learning';
import { sessionTicketSecret } from '../../lib/secrets';
import { SPEECH_BODY_LIMIT_BYTES } from '../../middleware/security';
import { encodingForMime } from '../../services/ai';
import type { RequestServices } from '../../services/context';
import { assertLearnerAudioSource, retainRecording } from './speech';

const IdParams = z.object({ id: UuidSchema });

/**
 * The published `ConversationSessionCreateRequestSchema` with `characterId` widened to a {@link CharacterRefSchema}:
 * the canonical value is the `characters.id` uuid (as the course manifest lists it); a roster key
 * (`characters.character_key`, e.g. `ary-cafe-staff-nadia`) is accepted for clients that derived the cast from the
 * `@langquest/ui` art roster before the manifest carried it. The contract's cross-field refinement is kept.
 */
export const SessionCreateRequestSchema = z
  .object({ ...ConversationSessionCreateRequestSchema.shape, characterId: CharacterRefSchema.optional() })
  .refine((v) => !v.scope || v.scope.kind !== 'mission' || !v.missionId || v.scope.missionId === v.missionId, { message: 'scope.missionId must match missionId', path: ['scope', 'missionId'] });

/**
 * The published `ConversationTurnRequestSchema` (its `audio` field is the contract union of `AudioInput` and a bare
 * `InlineAudioClip`), with every learner-controlled string bounded here: the contracts `transcript` variant has no
 * max length (cross-package gap), so without this cap a multi-megabyte "transcript" would flow straight into the
 * character agent and the evaluator (uncontrolled provider spend per request). Control characters are rejected outright.
 */
const learnerStrings = (input: LearnerTurnInput): string[] => (input.kind === 'text' || input.kind === 'transcript' ? [input.text] : input.kind === 'audio' && input.transcriptHint !== null ? [input.transcriptHint] : []);
export const TurnRequestSchema = ConversationTurnRequestSchema.extend({
  input: ConversationTurnRequestSchema.shape.input.superRefine((input, ctx) => {
    for (const text of learnerStrings(input)) {
      if (text.length > MAX_LEARNER_TEXT_CHARS) ctx.addIssue({ code: 'custom', path: ['text'], message: `Learner text is limited to ${MAX_LEARNER_TEXT_CHARS} characters per turn` });
      if (hasForbiddenControlChars(text)) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Learner text may not contain control characters' });
    }
  }),
});

/** `ConversationTurnAudio` → adapter `AudioInput`: a bare inline clip becomes an inline input with the encoding derived from its MIME type. */
function toAudioInput(audio: ConversationTurnAudio | undefined): AudioInput | undefined {
  if (!audio) return undefined;
  if ('source' in audio) return audio;
  return { source: 'inline', base64: audio.base64, encoding: encodingForMime(audio.mime), sampleRateHz: null };
}

/**
 * How long a learner row without a following character row counts as "in flight" (the first request for that
 * `clientTurnId` may still be running): the route budget. Older rows were abandoned (timed out / cancelled) and a
 * retry is allowed to run the pipeline for them.
 */
export const TURN_IN_FLIGHT_WINDOW_MS = AI_TIMEOUT_MS;
/** Longest a retry waits for the in-flight original before answering `conflict` + `Retry-After`. */
export const TURN_RETRY_WAIT_MS = 20_000;
const TURN_RETRY_POLL_MS = 1_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Character turn persisted for the learner row with `turnIndex`, or null. */
async function findCharacterReply(s: RequestServices, sessionId: string, learnerTurnIndex: number): Promise<Row<'conversation_turns'> | null> {
  const res = await s.service.from('conversation_turns').select('*').eq('session_id', sessionId).eq('speaker', 'character').eq('turn_index', learnerTurnIndex + 1).maybeSingle();
  return res.data ?? null;
}

/** Apply `normaliseLearnerText` to whichever field of the learner input carries free text. */
function normaliseLearnerInput(input: LearnerTurnInput): LearnerTurnInput {
  if (input.kind === 'text') return { ...input, text: normaliseLearnerText(input.text) ?? '…' };
  if (input.kind === 'transcript') return { ...input, text: normaliseLearnerText(input.text) ?? '…' };
  if (input.kind === 'audio') return { ...input, transcriptHint: normaliseLearnerText(input.transcriptHint) };
  return input;
}

interface SessionBundle {
  session: SessionRow;
  enrollment: EnrollmentRow;
  character: CharacterRow;
  mission: Row<'missions'> | null;
  scenario: Row<'dialogue_scenarios'> | null;
  /** What the session practises (persisted as sent; null for sessions created before migration 120). */
  scope: ConversationSessionScope | null;
}

async function loadBundle(s: RequestServices, sessionId: string): Promise<SessionBundle> {
  const { db, repos } = s.requireUser();
  const session = await loadOwnedSession(db, sessionId);
  const [enrollment, character, mission, scenario] = await Promise.all([
    loadOwnedEnrollment(db, session.enrollment_id, { allowArchived: true }),
    repos.curriculum.getCharacter(session.character_id),
    session.mission_id ? repos.curriculum.getMission(session.mission_id) : Promise.resolve(null),
    session.scenario_id ? db.from('dialogue_scenarios').select('*').eq('id', session.scenario_id).maybeSingle().then((r) => r.data ?? null) : Promise.resolve(null),
  ]);
  if (!character) throw problem.notFound('Character');
  return { session, enrollment, character, mission, scenario, scope: sessionScope(session) };
}

async function contextFor(s: RequestServices, b: SessionBundle) {
  const { db, principal } = s.requireUser();
  const uiLocale = await loadUiLocale(db, principal.userId);
  const language = languageContextFor(b.enrollment, uiLocale);
  // `audio_lesson` scope: the lesson's transcript lines become the scene facts (read under the learner's RLS).
  const [weaknesses, relationship, sceneFacts] = await Promise.all([recentWeaknesses(s, b.enrollment.id), relationshipSummary(db, b.character.id, b.enrollment.id), b.scope?.kind === 'audio_lesson' ? audioLessonSceneFacts(db, b.scope, b.enrollment.source_language_code) : Promise.resolve(null)]);
  const objectives = objectivesFromMission(b.mission, b.enrollment.source_language_code, b.session.objectives_completed);
  const context = buildContext({ language, session: b.session, character: b.character, scenario: b.scenario, objectives, weaknesses, relationship, sceneFacts });
  return { context, persona: personaFor(b.character), objectives };
}

async function capabilitiesFor(ai: Awaited<ReturnType<RequestServices['ai']>>, locale: string, voiceId: string, interruptible: boolean): Promise<{ realtime: Capability; recognition: Capability; synthesis: Capability; pronunciation: Capability }> {
  const [rt, stt, tts, pron] = await Promise.all([ai.registry.realtimeFor(locale, interruptible), ai.registry.recognizerFor(locale), ai.registry.synthesizerFor(locale, voiceId === 'unsupported' ? undefined : voiceId), ai.assessor.capability(locale)]);
  const none = (what: string) => unsupportedCapability('none', ['provider_unavailable'], [`${what} is not available for ${locale}`]);
  return { realtime: rt?.capability ?? none('Realtime conversation'), recognition: stt?.capability ?? none('Speech recognition'), synthesis: tts?.capability ?? none('Speech synthesis'), pronunciation: pron };
}

async function insertTurn(s: RequestServices, row: Omit<Row<'conversation_turns'>, 'id' | 'created_at' | 'expires_at' | 'audio_asset_id' | 'goals' | 'hints_used' | 'latency_ms' | 'confidence' | 'command' | 'text_hash' | 'client_turn_id'> & Partial<Pick<Row<'conversation_turns'>, 'audio_asset_id' | 'goals' | 'hints_used' | 'latency_ms' | 'confidence' | 'command' | 'client_turn_id'>>): Promise<Row<'conversation_turns'>> {
  const res = await s.service.from('conversation_turns').insert({ ...row, text_hash: row.text ? sha256Hex(row.text) : null }).select('*').single();
  if (res.error) throw new DbError(res.error, 'conversation.turn');
  return res.data;
}

export function registerConversationRoutes(define: DefineRoute): void {
  define('conversationSessionCreate', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS }, async (c) => {
    const body = await parseBody(c, SessionCreateRequestSchema);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, body.enrollmentId);
    const variety = varietyOf(enrollment);

    // Idempotent on clientSessionId (the session id): a retry returns the existing session + opening turn.
    const existing = await db.from('conversation_sessions').select('*').eq('id', body.clientSessionId).maybeSingle();
    let session: SessionRow;
    let character: CharacterRow;
    let mission: Row<'missions'> | null = null;
    let scenario: Row<'dialogue_scenarios'> | null = null;
    // Scope as sent, or derived: `missionId` ⇒ mission scope, nothing ⇒ free conversation (persisted either way).
    let scope: ConversationSessionScope | null = body.scope ?? (body.missionId ? { kind: 'mission', missionId: body.missionId } : { kind: 'free' });
    let replay = false;
    if (existing.data) {
      if (existing.data.enrollment_id !== enrollment.id) throw problem.conflict('clientSessionId already used for another enrollment');
      const b = await loadBundle(s, existing.data.id);
      ({ session, character, mission, scenario, scope } = b);
      replay = true;
    } else {
      const missionId = body.missionId ?? (scope?.kind === 'mission' ? scope.missionId : undefined);
      mission = missionId ? await repos.curriculum.getMission(missionId) : null;
      if (missionId && !mission) throw problem.notFound('Mission');
      if (scope?.kind === 'audio_lesson') await audioLessonSceneFacts(db, scope, enrollment.source_language_code); // 404 when the lesson is not visible to this learner
      if (mission && mission.target_variety_id !== variety) throw problem.validation('Mission belongs to another course variety');
      const scenarios = mission ? await repos.curriculum.listScenarios(mission.id) : [];
      scenario = body.scenarioId ? ((await db.from('dialogue_scenarios').select('*').eq('id', body.scenarioId).maybeSingle()).data ?? null) : (scenarios[0] ?? null);
      if (body.scenarioId && !scenario) throw problem.notFound('Scenario');
      // Character: as requested (uuid or roster key, published rows only under RLS), else the scenario's, else the
      // first published character of the enrollment's variety ranked by its regional preference (§5.2).
      const characterRef = body.characterId ?? scenario?.character_id ?? null;
      let found: CharacterRow | null;
      if (characterRef) {
        found = await resolveCharacterRef(repos.characters, characterRef);
        if (!found) throw problem.notFound('Character');
      } else {
        found = (await repos.characters.listPublishedForVariety(variety, enrollment.regional_preference))[0] ?? null;
        if (!found) throw problem.unsupported(`No published conversation character exists for ${variety} yet`);
      }
      if (found.target_variety_id !== variety) throw problem.validation(`Character speaks ${found.target_variety_id}, not ${variety}; dialects are never substituted`);
      character = found;
      const profile = await repos.profiles.getByUserId(principal.userId);
      const retention = body.speechRetention ?? parsePrivacy(profile?.privacy_options).store_speech_recordings;
      const ins = await db
        .from('conversation_sessions')
        .insert({ id: body.clientSessionId, user_id: principal.userId, enrollment_id: enrollment.id, mission_id: mission?.id ?? null, scenario_id: scenario?.id ?? null, character_id: character.id, target_variety_id: variety, source_language_code: enrollment.source_language_code, mode: body.mode, state: 'preparing', pipeline: body.mode === 'text_only' ? 'text_only' : 'stt_llm_tts', speech_retention: retention, scope: scope as never })
        .select('*')
        .single();
      if (ins.error) throw new DbError(ins.error, 'conversation.session');
      session = ins.data;
    }

    const ai = await s.ai(session.id);
    const { context, persona, objectives } = await contextFor(s, { session, enrollment, character, mission, scenario, scope });
    const config = voiceConfig({ session, context, enrollment, character, inputEncoding: body.inputEncoding });
    const capabilities = await capabilitiesFor(ai, config.locale, config.voiceId, config.interruptible);
    let provider: ShortLivedSession;
    try {
      provider = await ai.pipeline.createSession(config, { userId: principal.userId });
    } catch (error) {
      if (session.mode !== 'text_only' && !capabilities.recognition.supported) {
        throw problem.unsupported(`Spoken conversation is not available for ${variety} on this deployment yet. Start the session with mode "text_only" to keep practising in writing.`, { alternative: 'text_only', recognition: capabilities.recognition.reasons, synthesis: capabilities.synthesis.reasons });
      }
      throw error;
    }
    // The learner's choice wins: a text-only session never runs STT/TTS even when speech is available (§8.6, §15).
    if (session.mode === 'text_only' && provider.pipeline !== 'text_only') {
      // Fail closed: the ticket secret is a dedicated server secret (parseEnv enforces it whenever AI is enabled).
      const ticket = await signSessionTicket({ sessionId: session.id, userId: principal.userId, enrollmentId: enrollment.id, pipeline: 'text_only' }, sessionTicketSecret(s.config.env));
      provider = { ...provider, pipeline: 'text_only', clientToken: ticket.token, expiresAt: ticket.expiresAt, vad: null };
    }
    const pipeline = provider.pipeline;
    const turns = replay ? await listTurns(s, session.id) : [];
    let openingTurn: CharacterTurn | null = null;
    if (replay) {
      const first = turns.find((t) => t.speaker === 'character');
      openingTurn = first && first.text ? { turnId: first.id, characterId: character.id, text: first.text, transliteration: null, sourceGloss: null, expression: 'greeting', respondsToCommand: null, tentativeObjectiveIds: [], audio: null, endsConversation: false, model: null, latencyMs: null } : null;
    } else {
      const started = Date.now();
      try {
        const opening = await ai.characterAgent.respond({ context, persona, learnerInput: null, lastCharacterText: null, traceId: s.requestId });
        let turn = opening.turn;
        if (pipeline === 'stt_llm_tts' && capabilities.synthesis.supported) {
          try {
            const audio = await ai.synthesizer.synthesize(turn.text, config.locale, config.voiceId, { traceId: s.requestId, enrollmentId: enrollment.id });
            turn = await attachAudio(s, turn, audio);
          } catch (error) {
            s.log.warn('conversation.opening_tts_failed', { error });
          }
        }
        const row = await insertTurn(s, { session_id: session.id, turn_index: 0, speaker: 'character', text: turn.text, occurred_at: new Date().toISOString(), latency_ms: Date.now() - started, goals: turn.tentativeObjectiveIds });
        openingTurn = { ...turn, turnId: row.id, characterId: character.id };
      } catch (error) {
        s.log.error('conversation.opening_failed', { error });
        openingTurn = null; // the learner starts; honest rather than a fabricated line
      }
      const upd = await s.service.from('conversation_sessions').update({ state: 'listening', pipeline, last_seq: openingTurn ? 1 : 0, turn_count: openingTurn ? 1 : 0 }).eq('id', session.id).select('*').single();
      if (upd.error) throw new DbError(upd.error, 'conversation.session_update');
      session = upd.data;
    }
    return respondOk(
      c,
      ConversationSessionCreateResponseSchema.parse({
        session: sessionState(session, null, openingTurn?.turnId ?? null),
        provider,
        character: { id: character.id, name: character.name, role: character.role, targetVarietyId: character.target_variety_id, syntheticVoice: syntheticVoiceOf(character), portraitAssetId: character.portrait_visual_asset_id },
        capabilities,
        // Learner-facing: source-language text only (empty when the goal is not localized for this enrollment, §10.1).
        objectives: objectives.map((o) => ({ id: o.id, description: o.description, skillKeys: o.skillKeys })),
        openingTurn,
      }),
      replay ? 200 : 201,
    );
  });

  define('conversationTurn', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: SPEECH_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, TurnRequestSchema);
    // Same refusal as the speech routes, before anything is read or fetched: no caller-supplied audio URL.
    const turnAudio = toAudioInput(body.audio);
    if (turnAudio) assertLearnerAudioSource(turnAudio);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const b = await loadBundle(s, id);
    let { session } = b;
    if (session.state === 'finished') throw problem.precondition('This conversation has ended; start a new session');
    if (Date.now() - Date.parse(session.started_at) > MAX_SESSION_MS) throw problem.precondition('This conversation session has expired (30 min technical ceiling); start a new one', { maxSessionMs: MAX_SESSION_MS });

    // Replay: the learner turn exists → return the character turn that followed it (never a second LLM call).
    const turns = await listTurns(s, session.id);
    const learnerTurn = turns.find((t) => t.client_turn_id === body.clientTurnId);
    let followingCharacter = learnerTurn ? turns.find((t) => t.speaker === 'character' && t.turn_index === learnerTurn.turn_index + 1) : undefined;
    const replay = (learnerRow: Row<'conversation_turns'>, characterRow: Row<'conversation_turns'>): Response => {
      const characterTurn: CharacterTurn = { turnId: characterRow.id, characterId: b.character.id, text: characterRow.text ?? '', transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: (characterRow.command as CharacterTurn['respondsToCommand']) ?? null, tentativeObjectiveIds: characterRow.goals, audio: null, endsConversation: false, model: null, latencyMs: characterRow.latency_ms };
      return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerRow.id, characterRow.id), learnerTranscript: learnerRow.text ? { text: learnerRow.text, confidence: learnerRow.confidence } : null, characterTurn: characterTurn.text ? characterTurn : null, replayed: true, evaluationPending: false, objectivesCompleted: session.objectives_completed }));
    };
    if (learnerTurn && followingCharacter) return replay(learnerTurn, followingCharacter);
    if (learnerTurn && !followingCharacter) {
      // The first request for this clientTurnId may still be running (client retried before the server budget
      // elapsed). Never run the pipeline a second time for it: wait (bounded) for its character row, then either
      // replay it or ask the client to retry the SAME clientTurnId after `Retry-After`. Only a row older than the
      // in-flight window is treated as abandoned and processed below.
      const inFlightUntil = Date.parse(learnerTurn.occurred_at) + TURN_IN_FLIGHT_WINDOW_MS;
      const waitUntilTs = Math.min(inFlightUntil, Date.now() + TURN_RETRY_WAIT_MS);
      while (Date.now() < waitUntilTs) {
        await sleep(Math.min(TURN_RETRY_POLL_MS, Math.max(0, waitUntilTs - Date.now())));
        followingCharacter = (await findCharacterReply(s, session.id, learnerTurn.turn_index)) ?? undefined;
        if (followingCharacter) return replay(learnerTurn, followingCharacter);
      }
      if (Date.now() < inFlightUntil) {
        const retryAfterSeconds = Math.max(1, Math.ceil((inFlightUntil - Date.now()) / 1000));
        const res = respondErr(c, 'turn_in_progress', 'This clientTurnId is still being processed; retry the same clientTurnId shortly', { clientTurnId: body.clientTurnId, retryAfterSeconds });
        res.headers.set('Retry-After', String(Math.min(retryAfterSeconds, 30)));
        return res;
      }
      s.log.warn('conversation.turn_abandoned_retry', { sessionId: session.id, clientTurnId: body.clientTurnId, ageMs: Date.now() - Date.parse(learnerTurn.occurred_at) });
    }

    const ai = await s.ai(session.id);
    const { context, persona } = await contextFor(s, b);
    const config = voiceConfig({ session, context, enrollment: b.enrollment, character: b.character, inputEncoding: 'opus' });
    const lastCharacter = [...turns].reverse().find((t) => t.speaker === 'character');
    const sentInput: LearnerTurnInput = normaliseLearnerInput(body.input);
    let audio: AudioInput | undefined = turnAudio;
    const inlineClip = audio?.source === 'inline' ? audio : null;
    if (sentInput.kind === 'audio' && sentInput.transcriptHint === null && !audio) audio = { source: 'asset', assetId: sentInput.assetId, encoding: 'opus', sampleRateHz: null };
    if (sentInput.kind === 'audio' && session.pipeline === 'text_only') throw problem.unsupported('This session runs in text-only mode; send text or a transcript');

    // Non-speech gate before the learner turn is recorded or the character is asked (see the module comment).
    let learnerInput: LearnerTurnInput = sentInput;
    let speechVerdict: SpeechDetection | undefined;
    if (sentInput.kind === 'audio' && sentInput.transcriptHint === null && audio) {
      const clientSignals = body.recording ?? null;
      const heard = await ai.recognizer.transcribe(audio, config.locale, { traceId: s.requestId, enrollmentId: b.enrollment.id, screening: 'learner', clientSignals });
      const speech = speechDetectionOf(heard, { client: clientSignals });
      const screened = applySpeechScreening(heard, speech);
      const text = speech.speechDetected ? normaliseLearnerText(screened.text) : null;
      if (!text) {
        s.log.info('speech.no_speech_detected', { route: 'conversationTurn', sessionId: session.id, reason: speech.reason ?? 'empty_transcript', matchedPhrases: speech.matchedPhrases.length, signals: speech.signals, detector: speech.detectorVersion });
        const lastLearner = [...turns].reverse().find((t) => t.speaker === 'learner');
        return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, lastLearner?.id ?? null, lastCharacter?.id ?? null), learnerTranscript: null, characterTurn: null, replayed: false, evaluationPending: false, objectivesCompleted: session.objectives_completed, speech: { speechDetected: false, reason: speech.reason ?? 'empty_transcript' } }));
      }
      learnerInput = { kind: 'transcript', text, confidence: screened.confidence, provider: screened.provider };
      speechVerdict = { speechDetected: true, reason: null };
    }

    const nextIndex = turns.length ? Math.max(...turns.map((t) => t.turn_index)) + 1 : 0;
    const learnerText = learnerInput.kind === 'text' ? learnerInput.text : learnerInput.kind === 'transcript' ? learnerInput.text : learnerInput.kind === 'audio' ? learnerInput.transcriptHint : null;
    const command = learnerInput.kind === 'command' ? learnerInput.command : null;
    // Stored recording of an audio turn: the asset it was sent as; an inline clip's `input.assetId` is a client
    // placeholder (contract), so it is linked only once retained.
    const audioAssetId = sentInput.kind !== 'audio' ? null : audio?.source === 'asset' ? audio.assetId : audio?.source === 'inline' ? null : sentInput.assetId;
    let learnerRow = learnerTurn ?? null;
    if (!learnerRow) {
      try {
        learnerRow = await insertTurn(s, { session_id: session.id, turn_index: nextIndex, speaker: 'learner', client_turn_id: body.clientTurnId, text: learnerText, occurred_at: new Date().toISOString(), command, confidence: learnerInput.kind === 'transcript' ? learnerInput.confidence : null, audio_asset_id: audioAssetId });
      } catch (error) {
        if (error instanceof DbError && error.isUniqueViolation) {
          const res = respondErr(c, 'turn_in_progress', 'This clientTurnId is being processed; retry the same clientTurnId shortly', { clientTurnId: body.clientTurnId, retryAfterSeconds: 2 });
          res.headers.set('Retry-After', '2');
          return res;
        }
        throw error;
      }
    }
    if (body.bargeIn) s.log.info('conversation.barge_in', { sessionId: session.id, interrupted: lastCharacter?.id ?? null });

    // Cancellation: client disconnect AND the route timeout (both feed `s.signal`), so no provider work outlives the response.
    const token = createCancellationToken(s.signal ?? c.req.raw.signal);
    const started = Date.now();
    let result;
    try {
      result = await ai.pipeline.runTurn({ config, persona, learnerInput, audio: learnerInput.kind === 'audio' ? audio : undefined, lastCharacterText: lastCharacter?.text ?? null, token, traceId: s.requestId, textOnly: session.pipeline === 'text_only' });
    } catch (error) {
      if (error instanceof CancelledError) throw problem.precondition('Turn cancelled');
      throw error;
    }
    if (result.cancelled || !result.turn) {
      const upd = await s.service.from('conversation_sessions').update({ state: 'listening', last_seq: session.last_seq + 1 }).eq('id', session.id).select('*').single();
      session = upd.data ?? session;
      return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerRow.id, lastCharacter?.id ?? null), learnerTranscript: result.transcript ? { text: result.transcript.text, confidence: result.transcript.confidence } : learnerText && speechVerdict ? { text: learnerText, confidence: learnerInput.kind === 'transcript' ? learnerInput.confidence : null } : null, characterTurn: null, replayed: false, evaluationPending: false, objectivesCompleted: session.objectives_completed, ...(speechVerdict ? { speech: speechVerdict } : {}) }));
    }
    // A transcribed take was recorded WITH its sanitised transcript at insert (turns are append-only, so it could not be
    // added afterwards); the evaluator window reads it from there (retention-bound).
    // Inline clip: retained under the session's speech retention (§8.6 JSDoc promise of the contract), never when 'none'/'session'.
    if (inlineClip && sentInput.kind === 'audio') {
      const learnerRowId = learnerRow.id;
      s.waitUntil(
        retainRecording(s, b.enrollment, inlineClip, principal.userId, session.speech_retention as SpeechRetention).then(async (assetId) => {
          if (assetId) await s.service.from('conversation_turns').update({ audio_asset_id: assetId }).eq('id', learnerRowId);
        }),
      );
    }
    const turnWithAudio = await attachAudio(s, result.turn, result.audio);
    let charRow: Row<'conversation_turns'>;
    try {
      charRow = await insertTurn(s, { session_id: session.id, turn_index: learnerRow.turn_index + 1, speaker: 'character', text: turnWithAudio.text, occurred_at: new Date().toISOString(), latency_ms: Date.now() - started, goals: turnWithAudio.tentativeObjectiveIds, command: turnWithAudio.respondsToCommand });
    } catch (error) {
      // A concurrent request for the same clientTurnId already answered this learner turn: return ITS reply.
      if (error instanceof DbError && error.isUniqueViolation) {
        const existing = await findCharacterReply(s, session.id, learnerRow.turn_index);
        if (existing) {
          s.log.warn('conversation.turn_duplicate_reply_discarded', { sessionId: session.id, clientTurnId: body.clientTurnId });
          return replay(learnerRow, existing);
        }
      }
      throw error;
    }
    const characterTurn: CharacterTurn = { ...turnWithAudio, turnId: charRow.id, characterId: b.character.id };
    const learnerTurnCount = turns.filter((t) => t.speaker === 'learner').length + 1;
    const allTurns = [...turns, learnerRow, charRow];
    const upd = await s.service.from('conversation_sessions').update({ state: characterTurn.endsConversation ? 'listening' : 'listening', last_seq: session.last_seq + 1, turn_count: allTurns.length, revision: session.revision + 1 }).eq('id', session.id).select('*').single();
    if (upd.error) throw new DbError(upd.error, 'conversation.session_update');
    session = upd.data;
    const evaluationPending = learnerTurnCount % EVALUATE_EVERY_TURNS === 0 && command === null;
    if (evaluationPending) {
      s.waitUntil(
        (async () => {
          await evaluateSession(s, ai, { session, enrollment: b.enrollment, context, turns: allTurns, traceId: s.requestId });
          const summary = await refreshSummary(ai, context, session.summary, allTurns, s.requestId);
          await s.service.from('conversation_sessions').update({ summary: summary.turnSummary }).eq('id', session.id);
        })(),
      );
    }
    s.log.info('conversation.turn', { sessionId: session.id, latency: result.latency, pipeline: session.pipeline, userId: principal.userId });
    return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerRow.id, charRow.id), learnerTranscript: result.transcript ? { text: result.transcript.text, confidence: result.transcript.confidence } : learnerText ? { text: learnerText, confidence: learnerInput.kind === 'transcript' ? learnerInput.confidence : null } : null, characterTurn, replayed: false, evaluationPending, objectivesCompleted: session.objectives_completed, ...(speechVerdict ? { speech: speechVerdict } : {}) }));
  });

  define('conversationEnd', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ConversationEndRequestSchema);
    const s = c.get('services')!;
    const { principal, repos } = s.requireUser();
    const b = await loadBundle(s, id);
    let { session } = b;
    const turns = await listTurns(s, session.id);
    // XP counts turns where the learner said something (text) or used a command; a take without speech is never a turn.
    const learnerTurns = turns.filter(isCreditedLearnerTurn).length;
    // No evaluator output ⇒ `confidence: null` (never a fabricated 0).
    let evaluation: EvaluatorOutput = (session.rubric_outcomes as EvaluatorOutput | null) ?? emptyEvaluatorOutput();
    let summary = session.summary ?? '';
    if (session.state !== 'finished') {
      const ai = await s.ai(session.id);
      const { context } = await contextFor(s, b);
      const evaluated = await evaluateSession(s, ai, { session, enrollment: b.enrollment, context, turns, traceId: s.requestId });
      if (evaluated) evaluation = evaluated;
      const sum = await refreshSummary(ai, context, session.summary, turns, s.requestId);
      summary = sum.persistedSummary || sum.turnSummary;
      const profile = await repos.profiles.getByUserId(principal.userId);
      const consented = parsePrivacy(profile?.privacy_options).personalize_from_interests;
      const memoryUpdate = evaluation.relationshipMemoryUpdate ?? sum.relationshipMemoryUpdate;
      if (consented && memoryUpdate) {
        const existing = await s.service.from('character_relationship_memory').select('story_summary, missions_completed_together').eq('user_id', principal.userId).eq('character_id', b.character.id).eq('enrollment_id', b.enrollment.id).maybeSingle();
        const story = `${existing.data?.story_summary ?? ''} ${memoryUpdate}`.trim().slice(-2000);
        await s.service.from('character_relationship_memory').upsert({ user_id: principal.userId, character_id: b.character.id, enrollment_id: b.enrollment.id, story_summary: story, consented: true, missions_completed_together: (existing.data?.missions_completed_together ?? 0) + (body.reason === 'completed' ? 1 : 0), last_interaction_at: new Date().toISOString() }, { onConflict: 'user_id,character_id,enrollment_id' });
      }
      const upd = await s.service.from('conversation_sessions').update({ state: 'finished', ended_at: new Date().toISOString(), summary, rubric_outcomes: evaluation as unknown as SessionRow['rubric_outcomes'], objectives_completed: [...new Set([...session.objectives_completed, ...evaluation.objectivesCompleted])], last_seq: Math.max(session.last_seq, body.clientState.lastSeq) + 1, revision: session.revision + 1 }).eq('id', session.id).select('*').single();
      if (upd.error) throw new DbError(upd.error, 'conversation.finish');
      session = upd.data;
      void s.events.emit('conversation.finished', { sessionId: session.id, userId: principal.userId, enrollmentId: b.enrollment.id, missionId: session.mission_id, turnCount: turns.length, durationMs: Math.max(0, Date.parse(session.ended_at ?? session.started_at) - Date.parse(session.started_at)), objectivesCompleted: session.objectives_completed, evaluationPending: false }, { idempotencyKey: `conversation.finished:${session.id}`, traceId: s.requestId });
    }
    const xp = learnerTurns > 0 ? await awardXp(s, { idempotencyKey: body.clientEventId, userId: principal.userId, enrollmentId: b.enrollment.id, reason: 'conversation_turns', referenceTable: 'conversation_sessions', referenceId: session.id, units: Math.min(10, learnerTurns) }) : { applied: false, amount: 0, totalXp: 0, rejectedReason: null };
    const scheduled = await scheduleReviews(s, b.enrollment, evaluation.reviewTriggers.map((k) => ({ kind: 'skill' as const, id: k })), new Date().toISOString(), 'hard');
    const retained = session.speech_retention === 'opt_in_30_days' || session.speech_retention === 'opt_in_until_deleted';
    return respondOk(c, ConversationEndResponseSchema.parse({ session: sessionState(session, null, null), evaluation, xpAwarded: xp.amount, scheduledReviews: scheduled, summary, transcriptRetained: retained }));
  });
}
