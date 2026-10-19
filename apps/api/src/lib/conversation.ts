/**
 * Conversation session helpers (§8.3): compact, safe context (target variety, per-enrollment source language,
 * level, recent weaknesses, scene facts, rolling summary — never full transcripts), character persona, voice
 * config, transcript windows for the evaluator, and the asynchronous evaluator → observations → mastery step.
 */
import type { AiServices } from '@langquest/ai';
import { providerLocaleFor } from '@langquest/ai/capability/registry';
import { fallbackTurnSummary } from '@langquest/ai/conversation/summariser';
import type { CharacterPersona, TurnRecord } from '@langquest/ai/prompts/builders';
import { defaultVoiceFor, findVoice } from '@langquest/ai/speech/voices';
import { bytesToBase64 } from '@langquest/ai/util';
import type { AudioOutput, CharacterTurn, ConversationCommand, ConversationContext, ConversationMode, ConversationSessionState, EvaluatorOutput, LanguageContext, SourceLanguageCode, SpeechRetention, VoiceSessionConfig } from '@langquest/contracts';
import { ConversationSessionStateSchema } from '@langquest/contracts';
import { sanitizeForMemory } from '@langquest/curriculum/missions/story';
import type { DbClient } from '@langquest/db/client';
import type { Row } from '@langquest/db/types';
import { sourceLanguageTranslator } from '@langquest/locales';
import { sha256Hex } from '@langquest/telemetry/privacy';
import { problem } from '../http/envelope';
import type { RequestServices } from '../services/context';
import type { EnrollmentRow } from './enrollment';
import { goalDescriptionFor, goalEditorialText, goalsOf } from './goals';
import { recordObservations, scheduleReviews } from './learning';

export type SessionRow = Row<'conversation_sessions'>;
export type TurnRow = Row<'conversation_turns'>;
export type CharacterRow = Row<'characters'>;

export const MAX_SESSION_MS = 30 * 60_000;
/** Hard cap on one learner utterance (typed, transcript or hint) before it reaches storage or any prompt. */
export const MAX_LEARNER_TEXT_CHARS = 2000;
/** C0/C1 control characters except TAB, LF, CR (rejected at the boundary, stripped defensively here). */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
export const MAX_TURN_MS = 60_000;
/** Evaluate asynchronously every N learner turns (plus at the end). */
export const EVALUATE_EVERY_TURNS = 4;
/** Transcript window handed to the evaluator (recent turns only, §8.3 "avoid full historic transcripts"). */
export const EVALUATOR_WINDOW_TURNS = 12;

export async function loadOwnedSession(db: DbClient, sessionId: string): Promise<SessionRow> {
  const res = await db.from('conversation_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (res.error) throw problem.internal('Could not read the conversation session');
  if (!res.data) throw problem.notFound('Conversation session');
  return res.data;
}

export function sessionState(row: SessionRow, lastLearnerTurnId: string | null, lastCharacterTurnId: string | null): ConversationSessionState {
  return ConversationSessionStateSchema.parse({
    sessionId: row.id,
    state: row.state,
    mode: row.mode,
    targetVarietyId: row.target_variety_id,
    turnCount: row.turn_count,
    lastLearnerTurnId,
    lastCharacterTurnId,
    lastSeq: row.last_seq,
    objectivesCompleted: row.objectives_completed,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
  });
}

export function personaFor(character: CharacterRow): CharacterPersona {
  const voice = (character.voice_profile ?? {}) as { voice_id?: string; voiceId?: string; speech_speed?: 'slow' | 'normal' | 'fast' };
  return { id: character.id, name: character.name, role: character.role, region: character.home_region, personality: character.personality, voiceId: voice.voice_id ?? voice.voiceId ?? null, speechSpeed: voice.speech_speed ?? 'normal' };
}

export interface Objective {
  id: string;
  /** Learner-facing text in the enrollment's source language; empty when the goal is not localized for it (§10.1). */
  description: string;
  /** Editor free text without a language tag: prompt context only, never shown to the learner. */
  editorialDescription: string | null;
  skillKeys: string[];
  completed: boolean;
}

export function objectivesFromMission(mission: Row<'missions'> | null, source: string, completed: readonly string[]): Objective[] {
  if (!mission) return [];
  const t = sourceLanguageTranslator({ sourceLanguage: source as SourceLanguageCode });
  return goalsOf(mission).map((g) => ({
    id: g.id,
    description: goalDescriptionFor(g, source as SourceLanguageCode, t.translator) ?? '',
    editorialDescription: goalEditorialText(g),
    skillKeys: (g.skill_keys ?? []).filter((k) => /^[a-z0-9]+(?:[._][a-z0-9]+)*$/.test(k)),
    completed: completed.includes(g.id),
  }));
}

export async function recentWeaknesses(s: RequestServices, enrollmentId: string): Promise<string[]> {
  const mastery = await s.repos.progress.listMastery(enrollmentId);
  return mastery
    .filter((m) => m.mastery_state !== 'not_attempted' && m.internal_score < 0.5)
    .sort((a, b) => a.internal_score - b.internal_score)
    .slice(0, 10)
    .map((m) => m.skill_key);
}

export async function relationshipSummary(db: DbClient, characterId: string, enrollmentId: string): Promise<string | null> {
  const res = await db.from('character_relationship_memory').select('story_summary, consented').eq('character_id', characterId).eq('enrollment_id', enrollmentId).maybeSingle();
  if (!res.data || !res.data.consented || !res.data.story_summary) return null;
  return sanitizeForMemory(res.data.story_summary, 1000);
}

export function buildContext(input: { language: LanguageContext; session: SessionRow; character: CharacterRow; scenario: Row<'dialogue_scenarios'> | null; objectives: Objective[]; weaknesses: string[]; relationship: string | null }): ConversationContext {
  const facts = (input.scenario?.scene_facts?.length ? input.scenario.scene_facts : input.character.storyline_facts).slice(0, 20).map((f) => f.slice(0, 300));
  return {
    language: input.language,
    missionId: input.session.mission_id,
    characterId: input.character.id,
    scenarioId: input.session.scenario_id,
    sceneFacts: facts,
    // The agent needs some wording for every objective; the learner-facing field stays source-language only.
    objectives: input.objectives.map((o) => ({ id: o.id, description: o.description || o.editorialDescription || o.id, skillKeys: o.skillKeys, completed: o.completed })),
    recentWeaknessSkillKeys: input.weaknesses.slice(0, 10),
    turnSummary: (input.session.summary ?? '').slice(0, 2000),
    register: 'neutral',
    relationshipSummary: input.relationship,
  };
}

export function voiceConfig(input: { session: SessionRow; context: ConversationContext; enrollment: EnrollmentRow; character: CharacterRow; inputEncoding: VoiceSessionConfig['inputEncoding'] }): VoiceSessionConfig {
  const variety = input.context.language.targetVariety;
  const persona = personaFor(input.character);
  const voice = (persona.voiceId ? findVoice(persona.voiceId) : null) ?? defaultVoiceFor(variety, input.enrollment.regional_preference);
  return {
    sessionId: input.session.id,
    context: input.context,
    mode: input.session.mode as ConversationMode,
    interruptible: input.session.mode === 'hands_free',
    locale: providerLocaleFor(variety, input.enrollment.regional_preference),
    voiceId: voice?.voiceId ?? 'unsupported',
    inputEncoding: input.inputEncoding,
    outputEncoding: 'mp3',
    maxSessionMs: MAX_SESSION_MS,
    maxTurnMs: MAX_TURN_MS,
    speechRetention: input.session.speech_retention as SpeechRetention,
  };
}

export async function listTurns(s: RequestServices, sessionId: string, limit?: number): Promise<TurnRow[]> {
  let q = s.service.from('conversation_turns').select('*').eq('session_id', sessionId).order('turn_index', { ascending: true });
  if (limit) q = q.limit(limit);
  const res = await q;
  if (res.error) throw problem.internal('Could not read conversation turns');
  return res.data ?? [];
}

/**
 * Normalise learner-controlled text before persistence and before any prompt (§14.3 prompt injection): line breaks
 * collapse to spaces so a learner can never forge a `CHARACTER:` / `SYSTEM:` line in the evaluator or summary
 * transcript, triple quotes are neutralised so the character prompt's `"""…"""` framing cannot be closed, control
 * characters are stripped and the length is capped. Returns null for empty input.
 */
export function normaliseLearnerText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const cleaned = text
    .replace(CONTROL_CHARS, '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\t+/g, ' ')
    .replace(/"""+/g, '""')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_LEARNER_TEXT_CHARS);
  return cleaned.length ? cleaned : null;
}

/** True when the text carries control characters the API refuses at validation time (TAB/LF/CR are allowed). */
export const hasForbiddenControlChars = (text: string): boolean => {
  CONTROL_CHARS.lastIndex = 0;
  return CONTROL_CHARS.test(text);
};

/**
 * Transcript window for the evaluator/summariser. Learner turns are normalised again here (rows written before this
 * rule existed, or by other writers, still cannot smuggle a fake speaker line). Character turns are model output
 * that already passed the language guard; they keep their text but lose line breaks for the same reason.
 */
export const turnRecords = (turns: readonly TurnRow[]): TurnRecord[] =>
  turns
    .map((t) => ({ row: t, text: t.speaker === 'learner' ? normaliseLearnerText(t.text) : (t.text?.replace(/[\r\n]+/g, ' ').trim() ?? null) }))
    .filter((x): x is { row: TurnRow; text: string } => Boolean(x.text))
    .map(({ row, text }) => ({ role: row.speaker as 'learner' | 'character', text, confidence: row.confidence, command: (row.command as ConversationCommand | null) ?? null }));

/** Attach TTS audio to a character turn: R2-backed URL when available, otherwise an inline data URL. */
export async function attachAudio(s: RequestServices, turn: CharacterTurn, audio: AudioOutput | null): Promise<CharacterTurn> {
  if (!audio) return turn;
  if (audio.url) return { ...turn, audio: { assetId: audio.assetId, url: audio.url, durationMs: audio.durationMs, synthetic: true } };
  if (!audio.base64) return turn;
  const mime = audio.encoding === 'mp3' ? 'audio/mpeg' : audio.encoding === 'wav' || audio.encoding === 'pcm16' ? 'audio/wav' : audio.encoding === 'opus' ? 'audio/ogg' : 'audio/mp4';
  if (s.media.canPresign) {
    try {
      const key = `tts/turns/${sha256Hex(`${turn.turnId}:${audio.voiceId}`)}.${audio.encoding === 'mp3' ? 'mp3' : 'wav'}`;
      const bytes = Uint8Array.from(atob(audio.base64), (ch) => ch.charCodeAt(0));
      await s.media.put(key, bytes, mime);
      const url = await s.media.presignGet(key, 900);
      return { ...turn, audio: { assetId: null, url, durationMs: audio.durationMs, synthetic: true } };
    } catch (error) {
      s.log.warn('tts.r2_store_failed', { error });
    }
  }
  return { ...turn, audio: { assetId: null, url: `data:${mime};base64,${audio.base64}`, durationMs: audio.durationMs, synthetic: true } };
}

export const encodeBase64 = bytesToBase64;

/**
 * Run the evaluator on the recent window and persist observations + mastery; update the session's rubric
 * outcomes/objectives. Safe to call repeatedly (each run appends evidence for the NEW turns only when
 * `sinceTurnIndex` is given). Never throws into the request path (callers run it under `waitUntil`).
 */
export async function evaluateSession(s: RequestServices, ai: AiServices, input: { session: SessionRow; enrollment: EnrollmentRow; context: ConversationContext; turns: TurnRow[]; traceId: string }): Promise<EvaluatorOutput | null> {
  const window = turnRecords(input.turns.slice(-EVALUATOR_WINDOW_TURNS));
  if (!window.some((t) => t.role === 'learner')) return null;
  try {
    const raw = await ai.evaluator.evaluate({ context: input.context, transcriptWindow: window, conversationSessionId: input.session.id, skillCatalog: input.context.objectives.flatMap((o) => o.skillKeys), traceId: input.traceId });
    // Objective ids are server-known (mission goals in the context). The package evaluator keeps raw ids when the
    // context lists no objectives (free conversation); here nothing outside the context may ever be persisted, so a
    // talked-into "completed g1" can never be matched against a mission goal later (missionEvaluate reads rubric_outcomes).
    const allowed = new Set(input.context.objectives.map((o) => o.id));
    const output: EvaluatorOutput = { ...raw, objectivesCompleted: raw.objectivesCompleted.filter((id) => allowed.has(id)) };
    const observations = ai.evaluator.toSkillObservations(output, input.enrollment.id);
    await recordObservations(s, input.enrollment, observations, new Date().toISOString());
    const objectives = [...new Set([...input.session.objectives_completed, ...output.objectivesCompleted])];
    await s.service.from('conversation_sessions').update({ rubric_outcomes: output as unknown as SessionRow['rubric_outcomes'], objectives_completed: objectives, revision: input.session.revision + 1 }).eq('id', input.session.id);
    if (output.reviewTriggers.length) await scheduleReviews(s, input.enrollment, output.reviewTriggers.map((k) => ({ kind: 'skill' as const, id: k })), new Date().toISOString(), 'hard');
    return output;
  } catch (error) {
    s.log.error('conversation.evaluation_failed', { sessionId: input.session.id, error });
    return null;
  }
}

/** Rolling summary refresh: model summary when possible, deterministic fallback otherwise. */
export async function refreshSummary(ai: AiServices, context: ConversationContext, previous: string | null, turns: TurnRow[], traceId: string): Promise<{ turnSummary: string; persistedSummary: string; relationshipMemoryUpdate: string | null }> {
  const records = turnRecords(turns.slice(-EVALUATOR_WINDOW_TURNS));
  try {
    return await ai.summariser.summarise({ context, previousTurnSummary: previous, turns: records, traceId });
  } catch {
    const fallback = fallbackTurnSummary(previous, records);
    return { turnSummary: fallback, persistedSummary: fallback.slice(0, 1500), relationshipMemoryUpdate: null };
  }
}
