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
 *
 * Nothing to answer is never padded: typed `text` that is blank once normalised is refused (422); a blank `transcript`
 * and a device `transcriptHint` with no words in it are the same no-speech outcome as a silent take (no learner turn,
 * no model call). Every turn response carries the speech verdict the route or the pipeline reached.
 *
 * Integrity of the session row (migration 160 makes it server-owned at the source): sessions are inserted with the
 * service role after everything they name was resolved under the learner's RLS and checked against the enrollment's
 * variety (mission, scenario through its mission or character, audio lesson, character); a stored session that names
 * anything of another variety never runs (412). The end route decides the `finished` transition itself, and exactly one
 * request wins it: every session write goes through `updateOpenSession` (a compare-and-set on `revision` that never
 * touches a finished row), so nothing reopens a finished session, and a turn re-checks the state before it records the
 * learner line and again before the character line (a turn that loses to the end is answered 412, like any turn on an
 * ended conversation). The winner lists the transcript after the transition and records only what THIS request's
 * evaluator produced; the asynchronous evaluator records nothing once the session is finished. Replaying a finished
 * session shows its stored output again, filtered to the skill registry and the mission's goals, and records nothing.
 */
import { CancelledError, createCancellationToken } from '@langquest/ai/realtime/pipeline';
import { signSessionTicket } from '@langquest/ai/realtime/tickets';
import { applySpeechScreening, normalizeForScreening, speechDetectionOf } from '@langquest/ai/speech/speech-detection';
import { ConversationEndRequestSchema, ConversationEndResponseSchema, ConversationSessionCreateRequestSchema, ConversationSessionCreateResponseSchema, ConversationTurnRequestSchema, ConversationTurnResponseSchema, UuidSchema, emptyEvaluatorOutput, unsupportedCapability, type AudioInput, type Capability, type CharacterTurn, type ConversationSessionScope, type ConversationTurnAudio, type EvaluatorOutput, type LearnerTurnInput, type NoSpeechReason, type ShortLivedSession, type SpeechDetection, type SpeechRetention } from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { sha256Hex } from '@langquest/telemetry/privacy';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { AI_TIMEOUT_MS } from '../../app';
import { problem, respondErr, respondOk } from '../../http/envelope';
import { parseBody, parseParams } from '../../http/validate';
import { attachAudio, audioLessonScene, buildContext, CharacterRefSchema, currentSession, evaluateSession, EVALUATE_EVERY_TURNS, existingSkillReviews, hasForbiddenControlChars, isCreditedLearnerTurn, listTurns, loadOwnedSession, MAX_LEARNER_TEXT_CHARS, MAX_SESSION_MS, normaliseLearnerText, objectivesFromMission, personaFor, recentWeaknesses, refreshSummary, relationshipSummary, resolveCharacterRef, scenarioFit, sessionScope, sessionState, storedEvaluatorOutput, syntheticVoiceOf, updateOpenSession, voiceConfig, type AudioLessonScene, type CharacterRow, type SessionRow } from '../../lib/conversation';
import { parsePrivacy } from '../../lib/dto';
import { languageContextFor, loadOwnedEnrollment, loadUiLocale, varietyOf, type EnrollmentRow } from '../../lib/enrollment';
import { awardXp, scheduleReviews, type ScheduledReview } from '../../lib/learning';
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
 * Typed `text` that is blank once normalised (spaces, line breaks) is refused too: there is nothing to answer, and no
 * placeholder is ever recorded or sent to the model in its place.
 */
const learnerStrings = (input: LearnerTurnInput): string[] => (input.kind === 'text' || input.kind === 'transcript' ? [input.text] : input.kind === 'audio' && input.transcriptHint !== null ? [input.transcriptHint] : []);
export const BLANK_LEARNER_TEXT_MESSAGE = 'Learner text is empty; send what the learner wrote, or a command';
export const TurnRequestSchema = ConversationTurnRequestSchema.extend({
  input: ConversationTurnRequestSchema.shape.input.superRefine((input, ctx) => {
    for (const text of learnerStrings(input)) {
      if (text.length > MAX_LEARNER_TEXT_CHARS) ctx.addIssue({ code: 'custom', path: ['text'], message: `Learner text is limited to ${MAX_LEARNER_TEXT_CHARS} characters per turn` });
      if (hasForbiddenControlChars(text)) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Learner text may not contain control characters' });
    }
    if (input.kind === 'text' && normaliseLearnerText(input.text) === null) ctx.addIssue({ code: 'custom', path: ['text'], message: BLANK_LEARNER_TEXT_MESSAGE });
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

/**
 * Apply `normaliseLearnerText` to whichever field of the learner input carries free text. Null when a `text` or
 * `transcript` input is blank once normalised: nothing to answer, so no placeholder is invented for it (blank typed
 * `text` is refused at validation; a blank `transcript` is the no-speech outcome).
 */
export function normaliseLearnerInput(input: LearnerTurnInput): LearnerTurnInput | null {
  if (input.kind === 'text' || input.kind === 'transcript') {
    const text = normaliseLearnerText(input.text);
    return text === null ? null : { ...input, text };
  }
  if (input.kind === 'audio') return { ...input, transcriptHint: normaliseLearnerText(input.transcriptHint) };
  return input;
}

/**
 * A device recognizer's transcript hint with no words in it ("…", "?", only punctuation): recognizer output, so it is no
 * speech. The same rule as the pipeline's (`recognizerHeardNoWords`), applied here before a learner turn is recorded.
 */
export const transcriptHintHasNoWords = (hint: string): boolean => !normalizeForScreening(hint);

interface SessionBundle {
  session: SessionRow;
  enrollment: EnrollmentRow;
  character: CharacterRow;
  mission: Row<'missions'> | null;
  scenario: Row<'dialogue_scenarios'> | null;
  /** What the session practises (persisted as sent; null for sessions created before migration 120). */
  scope: ConversationSessionScope | null;
  /** The `audio_lesson` scope as the learner's RLS shows it (null: another scope, or the lesson is no longer visible). */
  lesson: AudioLessonScene | null;
}

/** The precondition every write path answers once the conversation is finished (also a turn that lost to the end). */
const CONVERSATION_ENDED = 'This conversation has ended; start a new session';
const courseMismatch = (variety: string) => problem.precondition(`This conversation session does not match the ${variety} course; dialects are never substituted. Start a new session.`);

async function loadBundle(s: RequestServices, sessionId: string): Promise<SessionBundle> {
  const { db, repos } = s.requireUser();
  const session = await loadOwnedSession(db, sessionId);
  const [enrollment, character, mission, storedScenario] = await Promise.all([
    loadOwnedEnrollment(db, session.enrollment_id, { allowArchived: true }),
    repos.curriculum.getCharacter(session.character_id),
    session.mission_id ? repos.curriculum.getMission(session.mission_id) : Promise.resolve(null),
    session.scenario_id ? db.from('dialogue_scenarios').select('*').eq('id', session.scenario_id).maybeSingle().then((r) => r.data ?? null) : Promise.resolve(null),
  ]);
  if (!character) throw problem.notFound('Character');
  // Before migration 160 a learner could insert or rewrite a session row directly: a session whose variety, character,
  // mission, scenario or audio lesson is not the enrollment's never runs (dialects are never substituted).
  const variety = varietyOf(enrollment);
  if (session.target_variety_id !== variety || character.target_variety_id !== variety || (mission !== null && mission.target_variety_id !== variety)) throw courseMismatch(variety);
  let scenario = storedScenario;
  if (scenario) {
    const fit = await scenarioFit(s, scenario, mission, variety);
    if (fit === 'mismatch') throw courseMismatch(variety);
    if (fit === 'unknown') scenario = null; // its mission or character is no longer visible: none of its facts are used
  }
  const scope = sessionScope(session);
  const lesson = scope?.kind === 'audio_lesson' ? await audioLessonScene(db, scope, enrollment.source_language_code) : null;
  if (lesson && lesson.targetVarietyId !== variety) throw courseMismatch(variety);
  return { session, enrollment, character, mission, scenario, scope, lesson };
}

async function contextFor(s: RequestServices, b: SessionBundle) {
  const { db, principal } = s.requireUser();
  const uiLocale = await loadUiLocale(db, principal.userId);
  const language = languageContextFor(b.enrollment, uiLocale);
  // `audio_lesson` scope: the lesson's transcript lines become the scene facts (read under the learner's RLS, of the
  // enrollment's variety: `loadBundle` / session create checked it). A lesson no longer visible is a 404, as before.
  if (b.scope?.kind === 'audio_lesson' && !b.lesson) throw problem.notFound('Audio lesson');
  const sceneFacts = b.lesson?.facts ?? null;
  const [weaknesses, relationship] = await Promise.all([recentWeaknesses(s, b.enrollment.id), relationshipSummary(db, b.character.id, b.enrollment.id)]);
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

/**
 * The `→ finished` transition through `updateOpenSession` (compare-and-set on `revision`, never on a finished row): the
 * server decides it, and exactly one request wins it. Only the winner runs the evaluator and records its outcome; a
 * concurrent or later request replays the finished session. Every other session write goes through the same helper,
 * so no in-flight turn or asynchronous evaluator can reopen the session afterwards. Null when it was already finished.
 */
function claimFinish(s: RequestServices, sessionId: string, clientLastSeq: number): Promise<SessionRow | null> {
  return updateOpenSession(s, sessionId, (current) => ({ state: 'finished', ended_at: new Date().toISOString(), last_seq: Math.max(current.last_seq, clientLastSeq) + 1 }));
}

/** A turn records nothing on a finished conversation: re-read right before each line is written (a concurrent end may have won). */
async function assertStillOpen(s: RequestServices, sessionId: string): Promise<void> {
  if ((await currentSession(s, sessionId)).state === 'finished') throw problem.precondition(CONVERSATION_ENDED);
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
    let lesson: AudioLessonScene | null = null;
    let replay = false;
    if (existing.data) {
      if (existing.data.enrollment_id !== enrollment.id) throw problem.conflict('clientSessionId already used for another enrollment');
      const b = await loadBundle(s, existing.data.id);
      ({ session, character, mission, scenario, scope, lesson } = b);
      replay = true;
    } else {
      const missionId = body.missionId ?? (scope?.kind === 'mission' ? scope.missionId : undefined);
      mission = missionId ? await repos.curriculum.getMission(missionId) : null;
      if (missionId && !mission) throw problem.notFound('Mission');
      if (scope?.kind === 'audio_lesson') {
        lesson = await audioLessonScene(db, scope, enrollment.source_language_code);
        if (!lesson) throw problem.notFound('Audio lesson'); // not visible to this learner
        // Its transcript lines become the character's scene facts: only a lesson of this course's variety.
        if (lesson.targetVarietyId !== variety) throw problem.validation(`This audio lesson is not part of the ${variety} course; dialects are never substituted`);
      }
      if (mission && mission.target_variety_id !== variety) throw problem.validation('Mission belongs to another course variety');
      if (body.scenarioId) {
        scenario = (await db.from('dialogue_scenarios').select('*').eq('id', body.scenarioId).maybeSingle()).data ?? null;
        if (!scenario) throw problem.notFound('Scenario');
        // Its scene facts become the character's: one of this mission's scenarios, or (free conversation) one of this variety.
        const fit = await scenarioFit(s, scenario, mission, variety);
        if (fit === 'unknown') throw problem.notFound('Scenario');
        if (fit === 'mismatch') throw problem.validation(mission ? 'Scenario belongs to another mission' : `Scenario belongs to another course variety; dialects are never substituted`);
      } else {
        scenario = mission ? ((await repos.curriculum.listScenarios(mission.id))[0] ?? null) : null;
      }
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
      // Inserted with the service role: since migration 160 a learner cannot create a session row directly. Everything
      // it names was resolved above under the learner's RLS (their own enrollment; a mission, scenario, character and
      // audio lesson they can see, of the enrollment's variety), and the server-owned columns start at their defaults.
      const ins = await s.service
        .from('conversation_sessions')
        .insert({ id: body.clientSessionId, user_id: principal.userId, enrollment_id: enrollment.id, mission_id: mission?.id ?? null, scenario_id: scenario?.id ?? null, character_id: character.id, target_variety_id: variety, source_language_code: enrollment.source_language_code, mode: body.mode, state: 'preparing', pipeline: body.mode === 'text_only' ? 'text_only' : 'stt_llm_tts', speech_retention: retention, scope: scope as never })
        .select('*')
        .single();
      if (ins.error) throw new DbError(ins.error, 'conversation.session');
      session = ins.data;
    }

    const ai = await s.ai(session.id);
    const { context, persona, objectives } = await contextFor(s, { session, enrollment, character, mission, scenario, scope, lesson });
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
        // Ended (by the client's own end request) while the opening line was being written: it is never added.
        if ((await currentSession(s, session.id)).state !== 'finished') {
          const row = await insertTurn(s, { session_id: session.id, turn_index: 0, speaker: 'character', text: turn.text, occurred_at: new Date().toISOString(), latency_ms: Date.now() - started, goals: turn.tentativeObjectiveIds });
          openingTurn = { ...turn, turnId: row.id, characterId: character.id };
        }
      } catch (error) {
        s.log.error('conversation.opening_failed', { error });
        openingTurn = null; // the learner starts; honest rather than a fabricated line
      }
      // Never reopens a session that was ended meanwhile: the response then shows it as it is (finished).
      session = (await updateOpenSession(s, session.id, () => ({ state: 'listening', pipeline, last_seq: openingTurn ? 1 : 0, turn_count: openingTurn ? 1 : 0 }))) ?? (await currentSession(s, session.id));
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
    if (session.state === 'finished') throw problem.precondition(CONVERSATION_ENDED);
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

    const lastCharacter = [...turns].reverse().find((t) => t.speaker === 'character');
    const lastLearner = [...turns].reverse().find((t) => t.speaker === 'learner');
    /** The honest no-speech outcome: no learner turn, no character reply, no model call, nothing credited. */
    const noSpeech = (reason: NoSpeechReason): Response =>
      respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, lastLearner?.id ?? null, lastCharacter?.id ?? null), learnerTranscript: null, characterTurn: null, replayed: false, evaluationPending: false, objectivesCompleted: session.objectives_completed, speech: { speechDetected: false, reason } }));

    if (body.input.kind === 'audio' && session.pipeline === 'text_only') throw problem.unsupported('This session runs in text-only mode; send text or a transcript');
    // Nothing to answer is settled here, before a learner turn is recorded or any provider is set up: a blank
    // transcript, or a device transcript hint with no words in it, is the no-speech outcome. (Blank typed `text` is
    // refused at validation; the check below only keeps this path closed if that rule ever moves.)
    const normalised = normaliseLearnerInput(body.input);
    if (normalised === null) {
      if (body.input.kind === 'text') throw problem.validation(BLANK_LEARNER_TEXT_MESSAGE);
      s.log.info('speech.no_speech_detected', { route: 'conversationTurn', sessionId: session.id, reason: 'empty_transcript', input: body.input.kind });
      return noSpeech('empty_transcript');
    }
    if (normalised.kind === 'audio' && normalised.transcriptHint !== null && transcriptHintHasNoWords(normalised.transcriptHint)) {
      s.log.info('speech.no_speech_detected', { route: 'conversationTurn', sessionId: session.id, reason: 'empty_transcript', input: 'audio_hint' });
      return noSpeech('empty_transcript');
    }
    const sentInput: LearnerTurnInput = normalised;

    const ai = await s.ai(session.id);
    const { context, persona } = await contextFor(s, b);
    const config = voiceConfig({ session, context, enrollment: b.enrollment, character: b.character, inputEncoding: 'opus' });
    let audio: AudioInput | undefined = turnAudio;
    const inlineClip = audio?.source === 'inline' ? audio : null;
    if (sentInput.kind === 'audio' && sentInput.transcriptHint === null && !audio) audio = { source: 'asset', assetId: sentInput.assetId, encoding: 'opus', sampleRateHz: null };

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
        return noSpeech(speech.reason ?? 'empty_transcript');
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
      // A concurrent end may have finished the session while this request was preparing: nothing is added to it.
      await assertStillOpen(s, session.id);
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
    // The verdict the route reached (its own transcription), else the pipeline's (an audio turn's transcript hint, or
    // its no-speech outcome): every response carries it, the turn that produced no character reply included.
    const speech: SpeechDetection | null = speechVerdict ?? result.speech ?? null;
    if (result.cancelled || !result.turn) {
      const listening = await updateOpenSession(s, session.id, (current) => ({ state: 'listening', last_seq: current.last_seq + 1 }));
      if (!listening) throw problem.precondition(CONVERSATION_ENDED); // the end won while the pipeline ran: never reopened
      session = listening;
      // The checks above mirror the pipeline's no-speech rules, so this should not happen; if it does, the take is
      // never presented as heard.
      if (speech && !speech.speechDetected) s.log.warn('conversation.no_speech_after_learner_turn', { sessionId: session.id, reason: speech.reason, learnerTurnId: learnerRow.id });
      const heard = speech?.speechDetected === false ? null : result.transcript ? { text: result.transcript.text, confidence: result.transcript.confidence } : learnerText && speechVerdict ? { text: learnerText, confidence: learnerInput.kind === 'transcript' ? learnerInput.confidence : null } : null;
      return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerRow.id, lastCharacter?.id ?? null), learnerTranscript: heard, characterTurn: null, replayed: false, evaluationPending: false, objectivesCompleted: session.objectives_completed, ...(speech ? { speech } : {}) }));
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
    // The end may have won while the character was thinking (the client aborts the turn and ends right away): the
    // late reply is not added to the finished transcript, and the turn is answered as the ended conversation.
    await assertStillOpen(s, session.id);
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
    // `turns` already holds the learner row of an abandoned retry: it is counted once.
    const answered = learnerRow;
    const allTurns = [...turns.filter((t) => t.id !== answered.id), answered, charRow];
    const learnerTurnCount = allTurns.filter((t) => t.speaker === 'learner').length;
    // Compare-and-set on the row as stored now: never reopens a session the end finished meanwhile (412 as above).
    const updated = await updateOpenSession(s, session.id, (current) => ({ state: 'listening', last_seq: current.last_seq + 1, turn_count: Math.max(current.turn_count, allTurns.length) }));
    if (!updated) throw problem.precondition(CONVERSATION_ENDED);
    session = updated;
    const evaluationPending = learnerTurnCount % EVALUATE_EVERY_TURNS === 0 && command === null;
    if (evaluationPending) {
      const evaluatedSession = session;
      s.waitUntil(
        (async () => {
          try {
            // Recorded only while the session is still open: once the end has won, its own evaluator decides.
            await evaluateSession(s, ai, { session: evaluatedSession, enrollment: b.enrollment, context, turns: allTurns, traceId: s.requestId, persist: 'open_session' });
            if ((await currentSession(s, evaluatedSession.id)).state === 'finished') return;
            const summary = await refreshSummary(ai, context, evaluatedSession.summary, allTurns, s.requestId);
            await updateOpenSession(s, evaluatedSession.id, () => ({ summary: summary.turnSummary }));
          } catch (error) {
            s.log.error('conversation.async_evaluation_failed', { sessionId: evaluatedSession.id, error });
          }
        })(),
      );
    }
    s.log.info('conversation.turn', { sessionId: session.id, latency: result.latency, pipeline: session.pipeline, userId: principal.userId });
    return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerRow.id, charRow.id), learnerTranscript: result.transcript ? { text: result.transcript.text, confidence: result.transcript.confidence } : learnerText ? { text: learnerText, confidence: learnerInput.kind === 'transcript' ? learnerInput.confidence : null } : null, characterTurn, replayed: false, evaluationPending, objectivesCompleted: session.objectives_completed, ...(speech ? { speech } : {}) }));
  });

  define('conversationEnd', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ConversationEndRequestSchema);
    const s = c.get('services')!;
    const { principal, repos, db } = s.requireUser();
    const b = await loadBundle(s, id);
    let { session } = b;
    // The session's mission goals: the only objective ids ever stored or shown for it (none for a free conversation).
    const objectiveIds = new Set(objectivesFromMission(b.mission, b.enrollment.source_language_code, []).map((o) => o.id));

    let evaluation: EvaluatorOutput;
    let summary: string;
    let scheduled: ScheduledReview[];
    let finishing: SessionRow | null = null;
    let setup: { ai: Awaited<ReturnType<RequestServices['ai']>>; context: Awaited<ReturnType<typeof contextFor>>['context'] } | null = null;
    if (session.state !== 'finished') {
      // Everything that can fail before the transition is prepared first, so such a failure leaves the session open for a retry.
      setup = { ai: await s.ai(session.id), context: (await contextFor(s, b)).context };
      finishing = await claimFinish(s, session.id, body.clientState.lastSeq);
    }
    // The transcript as of the finish, listed AFTER the transition: every line a turn recorded before it is evaluated and
    // credited, and a turn re-checks the state before each line, so none is added once the session is finished.
    const turns = await listTurns(s, session.id);
    // XP counts turns where the learner said something (text) or used a command; a take without speech is never a turn.
    const learnerTurns = turns.filter(isCreditedLearnerTurn).length;
    if (finishing && setup) {
      const { ai, context } = setup;
      const evaluated = await evaluateSession(s, ai, { session: finishing, enrollment: b.enrollment, context, turns, traceId: s.requestId, persist: 'caller' });
      // Only what THIS request's evaluator produced is recorded or returned; no evaluator output ⇒ `confidence: null`
      // (never a fabricated 0, never the stored rubric, which a learner could write before migration 160).
      evaluation = evaluated ?? emptyEvaluatorOutput();
      const sum = await refreshSummary(ai, context, finishing.summary, turns, s.requestId);
      summary = sum.persistedSummary || sum.turnSummary;
      const objectives = [...new Set([...finishing.objectives_completed, ...evaluation.objectivesCompleted])].filter((o) => objectiveIds.has(o));
      // The stored rubric is replaced only by a fresh evaluator output: an earlier asynchronous output (written while the
      // session was open) stays when this run produced none, still capped by its evaluator rows wherever it counts. The
      // row is finished, so no other request writes it any more (`updateOpenSession` refuses finished rows).
      const upd = await s.service
        .from('conversation_sessions')
        .update({ summary, objectives_completed: objectives, revision: finishing.revision + 1, ...(evaluated ? { rubric_outcomes: evaluated as unknown as SessionRow['rubric_outcomes'] } : {}) })
        .eq('id', session.id)
        .select('*')
        .single();
      if (upd.error) throw new DbError(upd.error, 'conversation.finish');
      session = upd.data;
      const profile = await repos.profiles.getByUserId(principal.userId);
      const consented = parsePrivacy(profile?.privacy_options).personalize_from_interests;
      const memoryUpdate = evaluation.relationshipMemoryUpdate ?? sum.relationshipMemoryUpdate;
      if (consented && memoryUpdate) {
        const existing = await s.service.from('character_relationship_memory').select('story_summary, missions_completed_together').eq('user_id', principal.userId).eq('character_id', b.character.id).eq('enrollment_id', b.enrollment.id).maybeSingle();
        const story = `${existing.data?.story_summary ?? ''} ${memoryUpdate}`.trim().slice(-2000);
        await s.service.from('character_relationship_memory').upsert({ user_id: principal.userId, character_id: b.character.id, enrollment_id: b.enrollment.id, story_summary: story, consented: true, missions_completed_together: (existing.data?.missions_completed_together ?? 0) + (body.reason === 'completed' ? 1 : 0), last_interaction_at: new Date().toISOString() }, { onConflict: 'user_id,character_id,enrollment_id' });
      }
      void s.events.emit('conversation.finished', { sessionId: session.id, userId: principal.userId, enrollmentId: b.enrollment.id, missionId: session.mission_id, turnCount: turns.length, durationMs: Math.max(0, Date.parse(session.ended_at ?? session.started_at) - Date.parse(session.started_at)), objectivesCompleted: session.objectives_completed, evaluationPending: false }, { idempotencyKey: `conversation.finished:${session.id}`, traceId: s.requestId });
      scheduled = await scheduleReviews(s, b.enrollment, evaluation.reviewTriggers.map((k) => ({ kind: 'skill' as const, id: k })), new Date().toISOString(), 'hard');
    } else {
      // Replay of a finished session (a retried end, or a concurrent request that lost the transition): its stored
      // output is shown again, filtered to the registry and the mission's goals, and nothing is recorded from it — no
      // observation, no new review card, no objective (the review cards listed are the ones that already exist).
      if (session.state !== 'finished') session = await loadOwnedSession(db, session.id);
      const stored = storedEvaluatorOutput(session.rubric_outcomes, objectiveIds);
      if (!stored.valid || stored.dropped.length) s.log.warn('conversation.stored_rubric_filtered', { sessionId: session.id, valid: stored.valid, droppedKeys: stored.dropped.length });
      evaluation = stored.output;
      summary = session.summary ?? '';
      scheduled = await existingSkillReviews(s, b.enrollment.id, evaluation.reviewTriggers);
    }
    // Idempotent: one payment per session (`award_xp` keys on the client event and on the session reference).
    const xp = learnerTurns > 0 ? await awardXp(s, { idempotencyKey: body.clientEventId, userId: principal.userId, enrollmentId: b.enrollment.id, reason: 'conversation_turns', referenceTable: 'conversation_sessions', referenceId: session.id, units: Math.min(10, learnerTurns) }) : { applied: false, amount: 0, totalXp: 0, rejectedReason: null };
    const retained = session.speech_retention === 'opt_in_30_days' || session.speech_retention === 'opt_in_until_deleted';
    return respondOk(c, ConversationEndResponseSchema.parse({ session: sessionState(session, null, null), evaluation, xpAwarded: xp.amount, scheduledReviews: scheduled, summary, transcriptRetained: retained }));
  });
}
