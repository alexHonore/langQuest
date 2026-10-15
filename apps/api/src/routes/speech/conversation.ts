/**
 * §6.2 conversation routes (§8.3, §8.6): session creation with a short-lived HMAC ticket and an opening
 * character turn, text/audio turns through the STT → character agent (language guard) → TTS pipeline with
 * replay-safe `clientTurnId`, and session end (evaluator, ≤ 2 priority corrections, summary, XP, review scheduling).
 *
 * The evaluator runs asynchronously every few turns (`ctx.waitUntil`) and synchronously at the end; the
 * character agent never receives full transcripts, only the compact context (§8.3).
 */
import { CancelledError, createCancellationToken } from '@langquest/ai/realtime/pipeline';
import { signSessionTicket } from '@langquest/ai/realtime/tickets';
import { AudioInputSchema, ConversationEndRequestSchema, ConversationEndResponseSchema, ConversationSessionCreateRequestSchema, ConversationSessionCreateResponseSchema, ConversationTurnRequestSchema, ConversationTurnResponseSchema, UuidSchema, unsupportedCapability, type AudioInput, type Capability, type CharacterTurn, type EvaluatorOutput, type LearnerTurnInput, type ShortLivedSession } from '@langquest/contracts';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { sha256Hex } from '@langquest/telemetry/privacy';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { AI_TIMEOUT_MS } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams } from '../../http/validate';
import { attachAudio, buildContext, evaluateSession, EVALUATE_EVERY_TURNS, listTurns, loadOwnedSession, MAX_SESSION_MS, objectivesFromMission, personaFor, recentWeaknesses, refreshSummary, relationshipSummary, sessionState, voiceConfig, type CharacterRow, type SessionRow } from '../../lib/conversation';
import { parsePrivacy } from '../../lib/dto';
import { languageContextFor, loadOwnedEnrollment, loadUiLocale, varietyOf, type EnrollmentRow } from '../../lib/enrollment';
import { awardXp, scheduleReviews } from '../../lib/learning';
import { SPEECH_BODY_LIMIT_BYTES } from '../../middleware/security';
import type { RequestServices } from '../../services/context';

const IdParams = z.object({ id: UuidSchema });

/** Local extension: a turn may carry the audio bytes/URL directly (contracts only reference an asset id). */
const TurnRequestSchema = ConversationTurnRequestSchema.extend({ audio: AudioInputSchema.optional() });

const EMPTY_EVALUATION: EvaluatorOutput = { objectivesCompleted: [], skillsExercised: [], observations: [], priorityCorrections: [], summary: '', reviewTriggers: [], relationshipMemoryUpdate: null, confidence: 0 };

interface SessionBundle {
  session: SessionRow;
  enrollment: EnrollmentRow;
  character: CharacterRow;
  mission: Row<'missions'> | null;
  scenario: Row<'dialogue_scenarios'> | null;
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
  return { session, enrollment, character, mission, scenario };
}

async function contextFor(s: RequestServices, b: SessionBundle) {
  const { db, principal } = s.requireUser();
  const uiLocale = await loadUiLocale(db, principal.userId);
  const language = languageContextFor(b.enrollment, uiLocale);
  const [weaknesses, relationship] = await Promise.all([recentWeaknesses(s, b.enrollment.id), relationshipSummary(db, b.character.id, b.enrollment.id)]);
  const context = buildContext({ language, session: b.session, character: b.character, scenario: b.scenario, objectives: objectivesFromMission(b.mission, b.enrollment.source_language_code, b.session.objectives_completed), weaknesses, relationship });
  return { context, persona: personaFor(b.character) };
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
    const body = await parseBody(c, ConversationSessionCreateRequestSchema);
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
    let replay = false;
    if (existing.data) {
      if (existing.data.enrollment_id !== enrollment.id) throw problem.conflict('clientSessionId already used for another enrollment');
      const b = await loadBundle(s, existing.data.id);
      ({ session, character, mission, scenario } = b);
      replay = true;
    } else {
      mission = body.missionId ? await repos.curriculum.getMission(body.missionId) : null;
      if (body.missionId && !mission) throw problem.notFound('Mission');
      if (mission && mission.target_variety_id !== variety) throw problem.validation('Mission belongs to another course variety');
      const scenarios = mission ? await repos.curriculum.listScenarios(mission.id) : [];
      scenario = body.scenarioId ? ((await db.from('dialogue_scenarios').select('*').eq('id', body.scenarioId).maybeSingle()).data ?? null) : (scenarios[0] ?? null);
      if (body.scenarioId && !scenario) throw problem.notFound('Scenario');
      const characterId = body.characterId ?? scenario?.character_id ?? (await repos.curriculum.listCharacters(variety))[0]?.id;
      if (!characterId) throw problem.unsupported(`No published conversation character exists for ${variety} yet`);
      const found = await repos.curriculum.getCharacter(characterId);
      if (!found) throw problem.notFound('Character');
      if (found.target_variety_id !== variety) throw problem.validation(`Character speaks ${found.target_variety_id}, not ${variety}; dialects are never substituted`);
      character = found;
      const profile = await repos.profiles.getByUserId(principal.userId);
      const retention = body.speechRetention ?? parsePrivacy(profile?.privacy_options).store_speech_recordings;
      const ins = await db
        .from('conversation_sessions')
        .insert({ id: body.clientSessionId, user_id: principal.userId, enrollment_id: enrollment.id, mission_id: mission?.id ?? null, scenario_id: scenario?.id ?? null, character_id: character.id, target_variety_id: variety, source_language_code: enrollment.source_language_code, mode: body.mode, state: 'preparing', pipeline: body.mode === 'text_only' ? 'text_only' : 'stt_llm_tts', speech_retention: retention })
        .select('*')
        .single();
      if (ins.error) throw new DbError(ins.error, 'conversation.session');
      session = ins.data;
    }

    const ai = await s.ai(session.id);
    const { context, persona } = await contextFor(s, { session, enrollment, character, mission, scenario });
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
      const ticket = await signSessionTicket({ sessionId: session.id, userId: principal.userId, enrollmentId: enrollment.id, pipeline: 'text_only' }, ai.env.AI_SESSION_TICKET_SECRET ?? s.config.env.AI_SESSION_TICKET_SECRET ?? `${s.config.env.SUPABASE_ANON_KEY}-ticket`);
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
        character: { id: character.id, name: character.name, role: character.role, targetVarietyId: character.target_variety_id, syntheticVoice: true, portraitAssetId: character.portrait_visual_asset_id },
        capabilities,
        objectives: context.objectives.map((o) => ({ id: o.id, description: o.description, skillKeys: o.skillKeys })),
        openingTurn,
      }),
      replay ? 200 : 201,
    );
  });

  define('conversationTurn', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS, bodyLimitBytes: SPEECH_BODY_LIMIT_BYTES, idempotent: false }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, TurnRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const b = await loadBundle(s, id);
    let { session } = b;
    if (session.state === 'finished') throw problem.precondition('This conversation has ended; start a new session');
    if (Date.now() - Date.parse(session.started_at) > MAX_SESSION_MS) throw problem.precondition('This conversation session has expired (30 min technical ceiling); start a new one', { maxSessionMs: MAX_SESSION_MS });

    // Replay: the learner turn exists → return the character turn that followed it (never a second LLM call).
    const turns = await listTurns(s, session.id);
    const learnerTurn = turns.find((t) => t.client_turn_id === body.clientTurnId);
    const followingCharacter = learnerTurn ? turns.find((t) => t.speaker === 'character' && t.turn_index === learnerTurn.turn_index + 1) : undefined;
    if (learnerTurn && followingCharacter) {
      const characterTurn: CharacterTurn = { turnId: followingCharacter.id, characterId: b.character.id, text: followingCharacter.text ?? '', transliteration: null, sourceGloss: null, expression: 'talking', respondsToCommand: (followingCharacter.command as CharacterTurn['respondsToCommand']) ?? null, tentativeObjectiveIds: followingCharacter.goals, audio: null, endsConversation: false, model: null, latencyMs: followingCharacter.latency_ms };
      return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerTurn.id, followingCharacter.id), learnerTranscript: learnerTurn.text ? { text: learnerTurn.text, confidence: learnerTurn.confidence } : null, characterTurn: characterTurn.text ? characterTurn : null, replayed: true, evaluationPending: false, objectivesCompleted: session.objectives_completed }));
    }

    const ai = await s.ai(session.id);
    const { context, persona } = await contextFor(s, b);
    const config = voiceConfig({ session, context, enrollment: b.enrollment, character: b.character, inputEncoding: 'opus' });
    const lastCharacter = [...turns].reverse().find((t) => t.speaker === 'character');
    const learnerInput: LearnerTurnInput = body.input;
    let audio: AudioInput | undefined = body.audio;
    if (learnerInput.kind === 'audio' && learnerInput.transcriptHint === null && !audio) audio = { source: 'asset', assetId: learnerInput.assetId, encoding: 'opus', sampleRateHz: null };
    if (learnerInput.kind === 'audio' && session.pipeline === 'text_only') throw problem.unsupported('This session runs in text-only mode; send text or a transcript');

    const nextIndex = turns.length ? Math.max(...turns.map((t) => t.turn_index)) + 1 : 0;
    const learnerText = learnerInput.kind === 'text' ? learnerInput.text : learnerInput.kind === 'transcript' ? learnerInput.text : learnerInput.kind === 'audio' ? learnerInput.transcriptHint : null;
    const command = learnerInput.kind === 'command' ? learnerInput.command : null;
    let learnerRow = learnerTurn ?? null;
    if (!learnerRow) {
      try {
        learnerRow = await insertTurn(s, { session_id: session.id, turn_index: nextIndex, speaker: 'learner', client_turn_id: body.clientTurnId, text: learnerText, occurred_at: new Date().toISOString(), command, confidence: learnerInput.kind === 'transcript' ? learnerInput.confidence : null, audio_asset_id: learnerInput.kind === 'audio' ? learnerInput.assetId : null });
      } catch (error) {
        if (error instanceof DbError && error.isUniqueViolation) throw problem.conflict('This clientTurnId is being processed; retry shortly');
        throw error;
      }
    }
    if (body.bargeIn) s.log.info('conversation.barge_in', { sessionId: session.id, interrupted: lastCharacter?.id ?? null });

    const token = createCancellationToken(c.req.raw.signal);
    const started = Date.now();
    let result;
    try {
      result = await ai.pipeline.runTurn({ config, persona, learnerInput, audio, lastCharacterText: lastCharacter?.text ?? null, token, traceId: s.requestId, textOnly: session.pipeline === 'text_only' });
    } catch (error) {
      if (error instanceof CancelledError) throw problem.precondition('Turn cancelled');
      throw error;
    }
    if (result.cancelled || !result.turn) {
      const upd = await s.service.from('conversation_sessions').update({ state: 'listening', last_seq: session.last_seq + 1 }).eq('id', session.id).select('*').single();
      session = upd.data ?? session;
      return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerRow.id, lastCharacter?.id ?? null), learnerTranscript: result.transcript ? { text: result.transcript.text, confidence: result.transcript.confidence } : null, characterTurn: null, replayed: false, evaluationPending: false, objectivesCompleted: session.objectives_completed }));
    }
    // Transcribed audio: the learner row keeps the sanitised transcript for the evaluator window (retention-bound).
    if (result.transcript && !learnerRow.text) {
      await s.service.from('conversation_turns').update({ text: result.transcript.text, text_hash: sha256Hex(result.transcript.text), confidence: result.transcript.confidence }).eq('id', learnerRow.id).then(() => undefined, () => undefined);
    }
    const turnWithAudio = await attachAudio(s, result.turn, result.audio);
    const charRow = await insertTurn(s, { session_id: session.id, turn_index: learnerRow.turn_index + 1, speaker: 'character', text: turnWithAudio.text, occurred_at: new Date().toISOString(), latency_ms: Date.now() - started, goals: turnWithAudio.tentativeObjectiveIds, command: turnWithAudio.respondsToCommand });
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
    return respondOk(c, ConversationTurnResponseSchema.parse({ session: sessionState(session, learnerRow.id, charRow.id), learnerTranscript: result.transcript ? { text: result.transcript.text, confidence: result.transcript.confidence } : learnerText ? { text: learnerText, confidence: learnerInput.kind === 'transcript' ? learnerInput.confidence : null } : null, characterTurn, replayed: false, evaluationPending, objectivesCompleted: session.objectives_completed }));
  });

  define('conversationEnd', { rate: 'ai', timeoutMs: AI_TIMEOUT_MS }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ConversationEndRequestSchema);
    const s = c.get('services')!;
    const { principal, repos } = s.requireUser();
    const b = await loadBundle(s, id);
    let { session } = b;
    const turns = await listTurns(s, session.id);
    const learnerTurns = turns.filter((t) => t.speaker === 'learner').length;
    let evaluation: EvaluatorOutput = (session.rubric_outcomes as EvaluatorOutput | null) ?? EMPTY_EVALUATION;
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
