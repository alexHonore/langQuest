/**
 * The conversation evaluator credits registry skills only (HANDOFF §9 item 6). The local DB holds 3 mastery rows, their
 * observations and 2 review cards under keys the evaluator made up (`greetings.basic`, `ordering.cafe`,
 * `politeness.afak`): the prompt showed made-up example keys and said "invent only when nothing fits", and the API
 * persisted whatever came back. Now:
 * - the prompt lists the seeded skill registry (`EVALUATOR_SKILL_KEYS`: `ALL_SKILL_KEYS` minus the speech-only
 *   dimensions) as the only valid keys;
 * - `evaluateSession` drops every other key (and logs it) before anything is persisted: no observation, mastery row,
 *   review card or rubric entry for it;
 * - a mastery row under an invented key never reaches a prompt again (recent weaknesses are registry-only).
 *
 * Through the REAL app (`POST /v1/ai/conversation/:id/end`), the real evaluator / summariser, and the offline fakes of
 * `route-fixtures` (nothing leaves the process).
 */
import { ALL_SKILL_KEYS, SKILL_KEYS, SYSTEM_SKILL_KEYS } from '@langquest/curriculum/skills';
import type { EvaluatorOutput } from '@langquest/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { EVALUATOR_SKILL_KEYS, SPEECH_ONLY_SKILL_KEYS, restrictEvaluatorOutputToSkills } from '../../lib/conversation';
import { enrollmentRow, profileRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const CHARACTER_ID = '44444444-4444-4444-8444-444444444444';
const NOW = () => new Date().toISOString();

const obs = (skillKey: string, observationType = 'semantic_success') => ({ skillKey, observationType, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', uncertainty: 0.1, note: null });
/** What a model that invents keys answers (all three invented keys are the ones found in the local DB). */
const INVENTING_EVALUATOR = {
  objectivesCompleted: [],
  skillsExercised: ['greet_politely', 'greetings.basic', 'speaking.pronunciation'],
  observations: [obs('greet_politely'), obs('greetings.basic'), obs('ordering.cafe', 'spoken_production'), obs('speaking.pronunciation', 'spoken_production'), obs('speaking.intelligibility')],
  priorityCorrections: [
    { skillKey: 'politeness.afak', learnerUtterance: 'Bonjour', suggestedUtterance: 'Bonjour madame', explanation: 'Add "madame" to be polite.', category: 'register' },
    { skillKey: 'greet_politely', learnerUtterance: 'Salut', suggestedUtterance: 'Bonjour', explanation: 'More polite with a stranger.', category: 'register' },
  ],
  summary: 'The learner greeted the barista.',
  reviewTriggers: ['greet_politely', 'ordering.cafe'],
  relationshipMemoryUpdate: null,
  confidence: 0.8,
};

describe('EVALUATOR_SKILL_KEYS and restrictEvaluatorOutputToSkills (pure)', () => {
  it('is the seeded registry minus the speech-only dimensions', () => {
    expect(ALL_SKILL_KEYS).toHaveLength(62);
    for (const k of SPEECH_ONLY_SKILL_KEYS) expect(SYSTEM_SKILL_KEYS).toContain(k);
    expect(EVALUATOR_SKILL_KEYS).toEqual(ALL_SKILL_KEYS.filter((k) => k !== 'speaking.intelligibility' && k !== 'speaking.pronunciation'));
    expect(EVALUATOR_SKILL_KEYS).toHaveLength(SKILL_KEYS.length + 1);
    expect(EVALUATOR_SKILL_KEYS).toContain('general.participation');
  });

  it('drops unknown keys everywhere, keeps the correction text without its key, and reports what it dropped', () => {
    const { output, dropped } = restrictEvaluatorOutputToSkills({ ...(INVENTING_EVALUATOR as unknown as EvaluatorOutput), observations: INVENTING_EVALUATOR.observations.map((o) => ({ ...o, scenarioId: 's', missionId: null, missionAttemptId: null, conversationSessionId: null, expressionId: null, utteranceConfidence: null })) as EvaluatorOutput['observations'] });
    expect(output.skillsExercised).toEqual(['greet_politely']);
    expect(output.observations.map((o) => o.skillKey)).toEqual(['greet_politely']);
    expect(output.reviewTriggers).toEqual(['greet_politely']);
    expect(output.priorityCorrections.map((c) => [c.skillKey, c.suggestedUtterance])).toEqual([
      [null, 'Bonjour madame'],
      ['greet_politely', 'Bonjour'],
    ]);
    expect(dropped).toEqual(['greetings.basic', 'ordering.cafe', 'politeness.afak', 'speaking.intelligibility', 'speaking.pronunciation']);
    const clean = restrictEvaluatorOutputToSkills(output);
    expect(clean.dropped).toEqual([]);
    expect(clean.output).toEqual(output);
  });
});

describe('POST /v1/ai/conversation/:id/end — nothing outside the registry is credited', () => {
  let h: RouteHarness;
  afterEach(() => h.restore());

  async function setup() {
    h = routeHarness({ openRouter: true });
    h.db.seed('profiles', [profileRow(LEARNER)]);
    const [enrollment] = h.db.seed('user_course_enrollments', [enrollmentRow(LEARNER, 'french', { source_language_code: 'en' })]);
    h.db.seed('characters', [{ id: CHARACTER_ID, character_key: 'fr-cafe-camille', name: 'Camille', role: 'barista', home_region: 'Paris', personality: 'warm and patient', target_variety_id: 'fr', regional_option: null, relationships: {}, safety_rules: [], state: 'published', storyline_facts: ['A small café near the station'], voice_profile: {}, portrait_visual_asset_id: null, created_at: NOW(), updated_at: NOW() }]);
    const [session] = h.db.seed('conversation_sessions', [{ id: crypto.randomUUID(), user_id: LEARNER, enrollment_id: enrollment!.id, mission_id: null, scenario_id: null, character_id: CHARACTER_ID, target_variety_id: 'fr', source_language_code: 'en', mode: 'text_only', state: 'listening', pipeline: 'text_only', speech_retention: 'none', scope: { kind: 'free' }, started_at: NOW(), updated_at: NOW(), created_at: NOW(), ended_at: null, turn_count: 2, last_seq: 2, objectives_completed: [], summary: null, revision: 0, rubric_outcomes: null }]);
    const turn = (index: number, speaker: 'learner' | 'character', text: string): DbRow => ({ id: crypto.randomUUID(), session_id: session!.id, turn_index: index, speaker, client_turn_id: speaker === 'learner' ? crypto.randomUUID() : null, text, text_hash: null, audio_asset_id: null, goals: [], hints_used: 0, command: null, confidence: null, latency_ms: null, occurred_at: NOW(), expires_at: null, created_at: NOW() });
    h.db.seed('conversation_turns', [turn(0, 'character', 'Bonjour ! Qu’est-ce que je vous sers ?'), turn(1, 'learner', 'Bonjour madame, un café s’il vous plaît')]);
    // A mastery row left by an invented key (the local DB has three): it must never reach a prompt again.
    h.db.seed('user_skill_mastery', [{ id: crypto.randomUUID(), user_id: LEARNER, enrollment_id: enrollment!.id, skill_key: 'ordering.cafe', mastery_state: 'emerging', internal_score: 0.2, last_practiced_at: NOW(), due_at: null, evidence_count: 1, uncertainty: 0.5, created_at: NOW(), updated_at: NOW() }]);
    // `award_xp` (service RPC): accept every award and record it.
    const xp: Array<Record<string, unknown>> = [];
    h.db.rpcs.award_xp = (args) => {
      xp.push(args);
      return [{ applied: true, amount: args.p_amount, total_xp: xp.reduce((a, x) => a + Number(x.p_amount), 0) }];
    };
    const prompts: string[] = [];
    h.openrouter.chat = (req) => {
      const messages = (req.messages as Array<{ role: string; content: string }> | undefined) ?? [];
      const all = messages.map((m) => m.content).join('\n');
      prompts.push(all);
      if (all.includes('You are the learning evaluator')) return JSON.stringify(INVENTING_EVALUATOR);
      return JSON.stringify({ turnSummary: 'Greeted and ordered a coffee.', persistedSummary: 'You greeted the barista and ordered a coffee.', relationshipMemoryUpdate: null });
    };
    return { token: await h.token(LEARNER), sessionId: session!.id as string, enrollmentId: enrollment!.id as string, prompts, xp };
  }

  it('the evaluator is prompted with the registry, and only registry keys are persisted (observations, mastery, review cards, rubric)', async () => {
    const { token, sessionId, enrollmentId, prompts, xp } = await setup();
    const res = await h.call(`/v1/ai/conversation/${sessionId}/end`, { token, body: { reason: 'learner_ended', clientState: { lastSeq: 2, turnCount: 2 }, clientEventId: crypto.randomUUID() } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    await h.flush();

    const evaluatorPrompt = prompts.find((p) => p.includes('You are the learning evaluator'));
    expect(evaluatorPrompt).toBeDefined();
    expect(evaluatorPrompt).toContain('Skill catalog (the only valid skillKey values, copy them exactly):');
    expect(evaluatorPrompt).toContain('greet_politely');
    expect(evaluatorPrompt).toContain('general.participation');
    const catalogLine = evaluatorPrompt!.split('\n').find((l) => l.startsWith('Skills: '))!;
    expect(catalogLine.slice('Skills: '.length).split(', ')).toEqual(EVALUATOR_SKILL_KEYS);
    expect(evaluatorPrompt).not.toContain('speaking.pronunciation');
    // The invented-key mastery row is not offered as a "recent weakness" (to the evaluator or the summariser).
    for (const p of prompts) expect(p).not.toContain('ordering.cafe');

    const evaluation = res.json.data.evaluation;
    expect(evaluation.skillsExercised).toEqual(['greet_politely']);
    expect(evaluation.observations.map((o: { skillKey: string }) => o.skillKey)).toEqual(['greet_politely']);
    expect(evaluation.reviewTriggers).toEqual(['greet_politely']);
    expect(evaluation.priorityCorrections.map((c: { skillKey: string | null }) => c.skillKey)).toEqual([null, 'greet_politely']);
    expect(res.json.data.scheduledReviews.map((r: { targetId: string }) => r.targetId)).toEqual(['greet_politely']);

    expect(h.db.rows('learning_observations').map((o) => o.skill_key)).toEqual(['greet_politely']);
    expect(h.db.rows('user_skill_mastery').map((m) => m.skill_key).sort()).toEqual(['greet_politely', 'ordering.cafe']); // the seeded leftover is untouched, nothing new beside the registry key
    expect(h.db.rows('user_expression_reviews').map((r) => r.skill_key)).toEqual(['greet_politely']);
    const session = h.db.rows('conversation_sessions').find((s) => s.id === sessionId)!;
    const rubric = session.rubric_outcomes as EvaluatorOutput;
    expect(rubric.skillsExercised).toEqual(['greet_politely']);
    expect(rubric.observations.map((o) => o.skillKey)).toEqual(['greet_politely']);
    expect(h.db.rows('learning_observations').every((o) => o.enrollment_id === enrollmentId)).toBe(true);
    // XP: the conversation turns, and a skill-state advance only for the registry skill's mastery row.
    const masteryIds = new Map(h.db.rows('user_skill_mastery').map((m) => [m.id, m.skill_key]));
    const skillAwards = xp.filter((x) => x.p_reason === 'skill_state_advanced').map((x) => masteryIds.get(x.p_reference_id));
    expect(skillAwards.every((k) => k === 'greet_politely')).toBe(true);
    expect(xp.some((x) => x.p_reason === 'conversation_turns')).toBe(true);
    expect(h.blocked).toEqual([]);
  });
});
