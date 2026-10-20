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
import type { AudioOutput, CharacterTurn, ConversationCommand, ConversationContext, ConversationMode, ConversationSessionScope, ConversationSessionState, EvaluatorOutput, LanguageContext, SourceLanguageCode, SpeechRetention, VoiceSessionConfig } from '@langquest/contracts';
import { ConversationSessionScopeSchema, ConversationSessionStateSchema, EvaluatorOutputSchema, UuidSchema, emptyEvaluatorOutput, getCourseTrack, isCourseTrackId } from '@langquest/contracts';
import type { DbClient as LearnerDb } from '@langquest/db/client';
import type { CharactersRepository } from '@langquest/db/repositories/characters';
import { sanitizeForMemory } from '@langquest/curriculum/missions/story';
import { ALL_SKILL_KEYS } from '@langquest/curriculum/skills';
import type { DbClient } from '@langquest/db/client';
import { DbError } from '@langquest/db/errors';
import type { Row } from '@langquest/db/types';
import { sourceLanguageTranslator } from '@langquest/locales';
import { sha256Hex } from '@langquest/telemetry/privacy';
import { z } from 'zod';
import { problem } from '../http/envelope';
import type { RequestServices } from '../services/context';
import type { EnrollmentRow } from './enrollment';
import { goalDescriptionFor, goalEditorialText, goalsOf } from './goals';
import { recordObservations, scheduleReviews, type ScheduledReview } from './learning';

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

/** The persisted `conversation_sessions.scope` (migration 120), or null for rows written before it existed. */
export function sessionScope(row: SessionRow): ConversationSessionScope | null {
  const parsed = ConversationSessionScopeSchema.safeParse(row.scope);
  return parsed.success ? parsed.data : null;
}

/** An `audio_lesson` scope as the learner's RLS shows it: the variety the lesson teaches and its scene facts. */
export interface AudioLessonScene {
  /** The lesson's own variety, else its collection's, else its collection's course track's; null when none is recorded. */
  targetVarietyId: string | null;
  /** The lesson title + its transcript lines (the learner-picked segments when given). */
  facts: string[];
}

/** Variety of a lesson that records none itself: its collection's, else the variety of the collection's course track. */
async function collectionVarietyOf(db: LearnerDb, chapterId: string): Promise<string | null> {
  const chapter = (await db.from('audio_chapters').select('collection_id').eq('id', chapterId).maybeSingle()).data;
  if (!chapter) return null;
  const collection = (await db.from('audio_course_collections').select('target_variety_id, course_track_id').eq('id', chapter.collection_id).maybeSingle()).data;
  if (!collection) return null;
  if (collection.target_variety_id) return collection.target_variety_id;
  return collection.course_track_id && isCourseTrackId(collection.course_track_id) ? getCourseTrack(collection.course_track_id).targetVarietyId : null;
}

/**
 * The `audio_lesson` scope read under the learner's RLS: null when the lesson is not visible to them. The caller compares
 * `targetVarietyId` with the enrollment's variety before any fact reaches a prompt (dialects are never substituted).
 */
export async function audioLessonScene(db: LearnerDb, scope: Extract<ConversationSessionScope, { kind: 'audio_lesson' }>, source: string): Promise<AudioLessonScene | null> {
  const lesson = (await db.from('audio_lessons').select('id, chapter_id, title_translations, instruction_language_code, target_variety_id').eq('id', scope.audioLessonId).maybeSingle()).data;
  if (!lesson) return null;
  const targetVarietyId = lesson.target_variety_id ?? (await collectionVarietyOf(db, lesson.chapter_id));
  const titles = (lesson.title_translations ?? {}) as Record<string, string>;
  const title = titles[source] ?? titles[lesson.instruction_language_code ?? ''] ?? Object.values(titles)[0] ?? '';
  const facts: string[] = [];
  if (title) facts.push(`Audio lesson: ${title}`);
  const transcript = (await db.from('transcripts').select('id').eq('lesson_id', lesson.id).order('revision', { ascending: false }).limit(1).maybeSingle()).data;
  if (transcript) {
    let q = db.from('transcript_segments').select('id, text, sort_index, speaker_label').eq('transcript_id', transcript.id).order('sort_index').limit(200);
    if (scope.transcriptSegmentIds?.length) q = q.in('id', scope.transcriptSegmentIds);
    const segments = (await q).data ?? [];
    for (const seg of segments) {
      if (facts.length >= 20) break;
      const text = seg.text.replace(/[\r\n]+/g, ' ').trim();
      if (!text) continue;
      facts.push((seg.speaker_label ? `${seg.speaker_label}: ${text}` : text).slice(0, 300));
    }
  }
  return { targetVarietyId, facts };
}

/**
 * Whether a dialogue scenario belongs to a session of `variety` on `mission` (null: a free conversation). A scenario has
 * no variety column; it belongs to a course through its mission or, when it has none, its character. Under a mission it
 * must be one of that mission's scenarios (the mission's own variety is checked by the caller). Otherwise its mission (or
 * character), as the learner's RLS shows it, must be of `variety`. `unknown` when that mission or character is not visible.
 */
export async function scenarioFit(s: RequestServices, scenario: Row<'dialogue_scenarios'>, mission: Row<'missions'> | null, variety: string): Promise<'fits' | 'mismatch' | 'unknown'> {
  if (mission) return scenario.mission_id === mission.id ? 'fits' : 'mismatch';
  const { repos } = s.requireUser();
  if (scenario.mission_id) {
    const own = await repos.curriculum.getMission(scenario.mission_id);
    return !own ? 'unknown' : own.target_variety_id === variety ? 'fits' : 'mismatch';
  }
  const character = await repos.characters.getById(scenario.character_id);
  return !character ? 'unknown' : character.target_variety_id === variety ? 'fits' : 'mismatch';
}

/** The session row as stored now (service role), whatever this request loaded earlier. */
export async function currentSession(s: RequestServices, sessionId: string): Promise<SessionRow> {
  const res = await s.service.from('conversation_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (res.error) throw new DbError(res.error, 'conversation.session');
  if (!res.data) throw problem.notFound('Conversation session');
  return res.data;
}

/** Attempts of {@link updateOpenSession} before it gives up on a session other requests keep writing (a 409 to retry). */
export const SESSION_WRITE_ATTEMPTS = 5;

/**
 * Every write to a conversation session that is not its finish, plus the finish itself (`state: 'finished'`): a
 * compare-and-set on `revision` that never touches a finished session. The patch is computed from the row as stored
 * at that moment, `revision` goes up by exactly one, and a write that lost a race is retried on the fresh row. Null when
 * the session is finished (by this request's rival or earlier): nothing may reopen it, append to its counters or replace
 * the outcome the finishing request recorded.
 */
export async function updateOpenSession(s: RequestServices, sessionId: string, patch: (current: SessionRow) => Partial<Omit<SessionRow, 'id' | 'revision'>>): Promise<SessionRow | null> {
  for (let attempt = 0; attempt < SESSION_WRITE_ATTEMPTS; attempt++) {
    const current = await currentSession(s, sessionId);
    if (current.state === 'finished') return null;
    const res = await s.service
      .from('conversation_sessions')
      .update({ ...patch(current), revision: current.revision + 1 })
      .eq('id', sessionId)
      .eq('revision', current.revision)
      .neq('state', 'finished')
      .select('*');
    if (res.error) throw new DbError(res.error, 'conversation.session_update');
    const written = res.data?.[0];
    if (written) return written;
  }
  throw problem.conflict('This conversation session is being updated by another request; retry');
}

/**
 * `characters.character_key` (the `@langquest/ui` roster slug, e.g. `ary-cafe-staff-nadia`): same pattern as the
 * DB check constraint (migration 130). Contracts `KeySchema` still rejects hyphens, hence a local schema.
 */
export const CharacterKeySchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Expected a character key (lowercase slug)');
/** A character reference as clients send it: the DB uuid (canonical) or, for backward compatibility, the roster key. */
export const CharacterRefSchema = z.union([UuidSchema, CharacterKeySchema]);
export type CharacterRef = z.infer<typeof CharacterRefSchema>;

export const isUuid = (value: string): boolean => UuidSchema.safeParse(value).success;

/**
 * Resolve a character reference through the given repository (learner RLS: published rows only). A uuid is looked
 * up by id; anything else by `character_key` (clients built on the art roster before the cast was seeded send the
 * roster id). Null when absent — the caller decides whether that is a 404 (never a silent substitution).
 */
export async function resolveCharacterRef(characters: CharactersRepository, ref: CharacterRef): Promise<CharacterRow | null> {
  return isUuid(ref) ? characters.getById(ref) : characters.getByKey(ref);
}

/** Honesty (§8.6): a character's voice is synthetic unless its voice profile explicitly says otherwise. */
export function syntheticVoiceOf(character: Pick<CharacterRow, 'voice_profile'>): boolean {
  const profile = (character.voice_profile ?? {}) as { synthetic?: unknown };
  return profile.synthetic === false ? false : true;
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
    // Registry skills only: a mastery row left by an evaluator-invented key never reaches a prompt again.
    .filter((m) => EVALUATOR_SKILL_KEY_SET.has(m.skill_key))
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

export function buildContext(input: { language: LanguageContext; session: SessionRow; character: CharacterRow; scenario: Row<'dialogue_scenarios'> | null; objectives: Objective[]; weaknesses: string[]; relationship: string | null; /** Scope-specific facts (e.g. the audio lesson's transcript lines) that replace the scenario/character defaults. */ sceneFacts?: readonly string[] | null }): ConversationContext {
  const base = input.sceneFacts?.length ? input.sceneFacts : input.scenario?.scene_facts?.length ? input.scenario.scene_facts : input.character.storyline_facts;
  const facts = base.slice(0, 20).map((f) => f.slice(0, 300));
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

/**
 * A learner turn that earns conversation XP: the learner said something (stored text) or used a command. Takes without
 * speech are never recorded as turns (non-speech gate in the turn route); a learner row without text or command (an
 * audio turn recorded before that gate existed) is not credited either.
 */
export const isCreditedLearnerTurn = (t: Pick<TurnRow, 'speaker' | 'text' | 'command'>): boolean => t.speaker === 'learner' && (t.command !== null || normaliseLearnerText(t.text) !== null);

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
 * Speech-only evidence dimensions (`SYSTEM_SKILLS` in `@langquest/curriculum`). They are recorded by the speech routes
 * only: `speaking.intelligibility` after the non-speech gate and the meaning judge, `speaking.pronunciation` only with
 * an acoustic assessor score (ADR-006). The conversation evaluator reads text (typed turns, or transcripts), so it
 * never credits them.
 */
export const SPEECH_ONLY_SKILL_KEYS: readonly string[] = ['speaking.intelligibility', 'speaking.pronunciation'];

/**
 * The skill keys the conversation evaluator may credit: the seeded skill registry (`ALL_SKILL_KEYS`: the communicative
 * registry plus the system skills, one `skills` row each) minus the speech-only dimensions. The evaluator prompt lists
 * exactly these (mission skills first); anything else it emits is dropped by `restrictEvaluatorOutputToSkills`.
 */
export const EVALUATOR_SKILL_KEYS: readonly string[] = ALL_SKILL_KEYS.filter((k) => !SPEECH_ONLY_SKILL_KEYS.includes(k));
const EVALUATOR_SKILL_KEY_SET: ReadonlySet<string> = new Set(EVALUATOR_SKILL_KEYS);

/**
 * Server-side validation of the evaluator's skill keys (the model may still invent some, e.g. "greetings.basic"): every
 * key outside `allowed` is dropped from `skillsExercised`, `observations` and `reviewTriggers`, and a priority
 * correction keeps its text but loses the key. Nothing outside the registry is ever credited (observation, mastery,
 * review card, XP for a skill state). Pure; `dropped` lists the removed keys (sorted, unique) for the log line.
 */
export function restrictEvaluatorOutputToSkills(output: EvaluatorOutput, allowed: ReadonlySet<string> = EVALUATOR_SKILL_KEY_SET): { output: EvaluatorOutput; dropped: string[] } {
  const dropped = new Set<string>();
  const keep = (key: string): boolean => {
    if (allowed.has(key)) return true;
    dropped.add(key);
    return false;
  };
  const restricted: EvaluatorOutput = {
    ...output,
    skillsExercised: output.skillsExercised.filter(keep),
    observations: output.observations.filter((o) => keep(o.skillKey)),
    reviewTriggers: output.reviewTriggers.filter(keep),
    priorityCorrections: output.priorityCorrections.map((c) => (c.skillKey !== null && !keep(c.skillKey) ? { ...c, skillKey: null } : c)),
  };
  return { output: restricted, dropped: [...dropped].sort() };
}

/**
 * The evaluator output stored on a session (`conversation_sessions.rubric_outcomes`), made safe to SHOW again (the end
 * route's replay of a finished session). It is display only: nothing is ever recorded from it (no observation, review
 * card, objective or XP), because this request's evaluator did not produce it. It still goes through the same filters
 * as a fresh output, since rows written before migration 160 (or before the registry rule) may hold anything: a value
 * that is not an `EvaluatorOutput` becomes the empty output (`confidence: null`, never a fabricated 0), skill keys outside
 * the registry are dropped (`restrictEvaluatorOutputToSkills`), and objective ids outside `objectiveIds` (the session's
 * mission goals) are dropped. Pure.
 */
export function storedEvaluatorOutput(raw: unknown, objectiveIds: ReadonlySet<string>): { output: EvaluatorOutput; dropped: string[]; valid: boolean } {
  if (raw === null || raw === undefined) return { output: emptyEvaluatorOutput(), dropped: [], valid: true };
  const parsed = EvaluatorOutputSchema.safeParse(raw);
  if (!parsed.success) return { output: emptyEvaluatorOutput(), dropped: [], valid: false };
  const restricted = restrictEvaluatorOutputToSkills({ ...parsed.data, objectivesCompleted: parsed.data.objectivesCompleted.filter((id) => objectiveIds.has(id)) });
  return { output: restricted.output, dropped: restricted.dropped, valid: true };
}

/**
 * Read-only counterpart of `scheduleReviews` for skill targets: the review cards that already exist for `skillKeys` in
 * this enrollment (registry keys only), in the order given. Used when a finished session is replayed, so a replay
 * never creates a card. Keys without a card are omitted.
 */
export async function existingSkillReviews(s: RequestServices, enrollmentId: string, skillKeys: readonly string[]): Promise<ScheduledReview[]> {
  const keys = [...new Set(skillKeys.filter((k) => EVALUATOR_SKILL_KEY_SET.has(k)))];
  if (!keys.length) return [];
  const res = await s.service.from('user_expression_reviews').select('id, skill_key, next_due_at').eq('enrollment_id', enrollmentId).is('expression_id', null).in('skill_key', keys);
  if (res.error) throw problem.internal('Could not read review cards');
  const byKey = new Map((res.data ?? []).filter((r) => r.skill_key !== null).map((r) => [r.skill_key as string, r]));
  return keys.flatMap((k) => {
    const card = byKey.get(k);
    return card ? [{ cardId: card.id, targetKind: 'skill' as const, targetId: k, due: card.next_due_at }] : [];
  });
}

/**
 * Run the evaluator on the recent window and persist observations + mastery (+ review cards). Never throws into the
 * request path (the turn route runs it under `waitUntil`).
 *
 * `persist` says who owns the session row:
 * - `open_session` (the asynchronous run every few turns): the rubric and objectives are written only while the session
 *   is still open (`updateOpenSession`), and when it has been finished meanwhile nothing at all is recorded from this
 *   run (no observation, no review card): the request that finished the session ran its own evaluator and decides.
 * - `caller` (the end route, which has won the `finished` transition): observations and review cards are recorded here;
 *   the caller writes the rubric and objectives onto the finished row itself.
 */
export async function evaluateSession(s: RequestServices, ai: AiServices, input: { session: SessionRow; enrollment: EnrollmentRow; context: ConversationContext; turns: TurnRow[]; traceId: string; persist: 'open_session' | 'caller' }): Promise<EvaluatorOutput | null> {
  const window = turnRecords(input.turns.slice(-EVALUATOR_WINDOW_TURNS));
  if (!window.some((t) => t.role === 'learner')) return null;
  try {
    // The prompt lists the registry keys the evaluator may use (mission skills first, `evaluatorSkillCatalogLines`).
    const raw = await ai.evaluator.evaluate({ context: input.context, transcriptWindow: window, conversationSessionId: input.session.id, skillCatalog: EVALUATOR_SKILL_KEYS, traceId: input.traceId });
    // Objective ids are server-known (mission goals in the context). The package evaluator keeps raw ids when the
    // context lists no objectives (free conversation); here nothing outside the context may ever be persisted, so a
    // talked-into "completed g1" can never be matched against a mission goal later (missionEvaluate reads rubric_outcomes).
    const allowed = new Set(input.context.objectives.map((o) => o.id));
    // Skill keys outside the registry are dropped (and logged), never credited; the persisted rubric is the restricted one.
    const restricted = restrictEvaluatorOutputToSkills({ ...raw, objectivesCompleted: raw.objectivesCompleted.filter((id) => allowed.has(id)) });
    if (restricted.dropped.length) s.log.warn('conversation.evaluator_unknown_skill_keys', { sessionId: input.session.id, count: restricted.dropped.length, keys: restricted.dropped.slice(0, 20).map((k) => k.slice(0, 64)) });
    const output: EvaluatorOutput = restricted.output;
    if (input.persist === 'open_session') {
      const kept = await updateOpenSession(s, input.session.id, (current) => ({ rubric_outcomes: output as unknown as SessionRow['rubric_outcomes'], objectives_completed: [...new Set([...current.objectives_completed, ...output.objectivesCompleted])] }));
      if (!kept) {
        s.log.info('conversation.evaluation_after_finish_discarded', { sessionId: input.session.id });
        return null;
      }
    }
    const observations = ai.evaluator.toSkillObservations(output, input.enrollment.id);
    await recordObservations(s, input.enrollment, observations, new Date().toISOString());
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
