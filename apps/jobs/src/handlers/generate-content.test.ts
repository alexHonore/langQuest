import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageGuard } from '@langquest/ai';
import { FakeReasoner, createTestServices, runHandler, type TestServices } from '../test-support/fakes';
import { BATCH_GATE_THRESHOLDS, DIVERSITY_REVIEW_FLAG, MISSION_GATE_THRESHOLDS, buildContentFactoryPrompt, buildMissionGoals, diversityMark, generateContentHandler, missionDiversityInput, validateGeneratedMission, type DiversityMark, type GeneratedMission } from './generate-content';
import { scoreDialogueDiversity } from '@langquest/curriculum';

const mission = (overrides: Partial<GeneratedMission> = {}): GeneratedMission => ({
  title: 'Pedir un café',
  sceneDescription: 'Una cafetería en Madrid por la mañana.',
  objectiveIntentKeys: ['greet_hello', 'request_item'],
  // Only one objective is described: the other must surface as a goal without a learner-facing description.
  objectiveDescriptions: [{ intentKey: 'greet_hello', description: 'Saluer poliment le serveur.' }, { intentKey: 'not_in_brief', description: 'ignored' }],
  dialogue: [
    { speaker: 'character', intentKey: 'greet_hello', targetText: 'Hola, buenos días. ¿Qué te pongo?', transliteration: null, sourceMeaning: 'Bonjour. Qu’est-ce que je vous sers ?', register: 'neutral', act: 'normal' },
    { speaker: 'learner', intentKey: 'request_item', targetText: 'Un café con leche, por favor.', transliteration: null, sourceMeaning: 'Un café au lait, s’il vous plaît.', register: 'polite', act: 'normal' },
  ],
  expressions: [
    { intentKey: 'greet_hello', targetText: 'Hola, buenos días.', transliteration: null, sourceMeaning: 'Bonjour.', literalGloss: null, contextNote: null, register: 'neutral', variants: ['Buenas.'] },
    { intentKey: 'request_item', targetText: 'Un café con leche, por favor.', transliteration: null, sourceMeaning: 'Un café au lait, s’il vous plaît.', literalGloss: 'Un café avec lait, par faveur.', contextNote: 'Vale en toda España.', register: 'polite', variants: [] },
    { intentKey: 'request_item', targetText: 'Un café con leche, por favor.', transliteration: null, sourceMeaning: 'dup', literalGloss: null, contextNote: null, register: 'polite', variants: [] },
    { intentKey: 'not_in_brief', targetText: 'Adiós.', transliteration: null, sourceMeaning: 'Au revoir.', literalGloss: null, contextNote: null, register: 'neutral', variants: [] },
    { intentKey: 'greet_hello', targetText: 'Bonjour tout le monde, comment allez-vous aujourd’hui ?', transliteration: null, sourceMeaning: 'Bonjour.', literalGloss: null, contextNote: null, register: 'neutral', variants: [] },
    { intentKey: 'greet_hello', targetText: '', transliteration: null, sourceMeaning: 'x', literalGloss: null, contextNote: null, register: 'neutral', variants: [] },
  ],
  instructions: 'Saluez et commandez un café.',
  hints: ['Commencez par « Hola ».'],
  ...overrides,
});

/**
 * A one-correct-answer drill: the character asks, the learner answers, twice; each intent has a single acceptable
 * phrasing (the "variant" only differs by punctuation).
 */
const drill = (overrides: Partial<GeneratedMission> = {}): GeneratedMission =>
  mission({
    title: 'Quiz del café',
    objectiveDescriptions: [{ intentKey: 'greet_hello', description: 'Saluer.' }, { intentKey: 'request_item', description: 'Commander.' }],
    dialogue: [
      { speaker: 'character', intentKey: 'greet_hello', targetText: '¿Qué quieres tomar?', transliteration: null, sourceMeaning: 'Que veux-tu boire ?', register: 'neutral', act: 'normal' },
      { speaker: 'learner', intentKey: 'request_item', targetText: 'Un café, por favor.', transliteration: null, sourceMeaning: 'Un café, s’il te plaît.', register: 'polite', act: 'normal' },
      { speaker: 'character', intentKey: 'request_item', targetText: '¿Con leche o solo?', transliteration: null, sourceMeaning: 'Avec du lait ou noir ?', register: 'neutral', act: 'normal' },
      { speaker: 'learner', intentKey: 'request_item', targetText: 'Con leche.', transliteration: null, sourceMeaning: 'Avec du lait.', register: 'neutral', act: 'normal' },
    ],
    expressions: [
      { intentKey: 'greet_hello', targetText: 'Hola.', transliteration: null, sourceMeaning: 'Bonjour.', literalGloss: null, contextNote: null, register: 'neutral', variants: [] },
      { intentKey: 'request_item', targetText: 'Un café, por favor.', transliteration: null, sourceMeaning: 'Un café, s’il vous plaît.', literalGloss: null, contextNote: null, register: 'polite', variants: ['Un café, por favor'] },
    ],
    ...overrides,
  });

describe('diversity gate', () => {
  it('passes a mission with real alternatives and a conversational dialogue', () => {
    const m = mission();
    const report = scoreDialogueDiversity(missionDiversityInput(m, m.expressions.slice(0, 2), 'missions/0'), MISSION_GATE_THRESHOLDS);
    expect(report).toMatchObject({ verdict: 'diverse', reasons: [] });
    expect(diversityMark(report, null, false)).toMatchObject({ verdict: 'diverse', reasons: [], batch: null });
  });

  it('marks a question → answer drill whose intents have one acceptable phrasing each', () => {
    const m = drill();
    const report = scoreDialogueDiversity(missionDiversityInput(m, m.expressions, 'missions/0'), MISSION_GATE_THRESHOLDS);
    expect(report.verdict).toBe('needs_regeneration');
    expect(report.reasons).toEqual(expect.arrayContaining(['low_alternative_coverage:0', 'quiz_shaped_set:1']));
    // A failing batch marks every mission in it, with the batch reasons prefixed.
    const good = mission();
    const batch = scoreDialogueDiversity({ intents: [], dialogues: [0, 1].map((i) => ({ id: `missions/${i}`, turns: good.dialogue.map((l) => ({ speaker: l.speaker, text: l.targetText })) })) }, BATCH_GATE_THRESHOLDS);
    const mark = diversityMark(scoreDialogueDiversity(missionDiversityInput(good, good.expressions.slice(0, 2), 'missions/0'), MISSION_GATE_THRESHOLDS), batch, false);
    expect(mark.verdict).toBe('needs_regeneration');
    expect(mark.reasons).toEqual(expect.arrayContaining(['batch:repeated_dialogues:0.5']));
    expect(mark.mission.verdict).toBe('diverse');
  });
});

describe('validateGeneratedMission', () => {
  it('keeps valid in-variety expressions and rejects duplicates, unrequested intents, source-language leaks and empties', () => {
    const guard = new LanguageGuard({});
    const res = validateGeneratedMission(mission(), 0, { allowedIntents: new Set(['greet_hello', 'request_item']), guard: (text) => guard.checkHeuristic(text, 'es-ES', 'native', { sourceLanguage: 'fr', track: 'spanish-spain' }) });
    expect(res.accepted.map((e) => e.targetText)).toEqual(['Hola, buenos días.', 'Un café con leche, por favor.']);
    expect(res.objectives).toEqual(['greet_hello', 'request_item']);
    const reasons = res.rejections.map((r) => r.reason);
    expect(reasons.some((r) => r.includes('duplicate'))).toBe(true);
    expect(reasons.some((r) => r.includes('not in brief'))).toBe(true);
    expect(reasons.some((r) => r.includes('language guard'))).toBe(true);
    expect(reasons.some((r) => r.includes('empty'))).toBe(true);
  });
});

describe('buildMissionGoals', () => {
  it('writes { id, skill_keys, description: { [source]: text } } per objective and never a bare string or empty map', () => {
    const { goals, goalsWithoutDescription } = buildMissionGoals({ objectives: ['greet_hello', 'request_item'], sourceLanguage: 'fr', descriptions: [{ intentKey: 'greet_hello', description: '  Saluer.  ' }, { intentKey: 'request_item', description: '   ' }], skillKeysFor: (k) => (k === 'greet_hello' ? ['greetings.basic'] : []) });
    expect(goals).toEqual([{ id: 'greet_hello', skill_keys: ['greetings.basic'], description: { fr: 'Saluer.' } }, { id: 'request_item', skill_keys: [] }]);
    expect(goalsWithoutDescription).toEqual(['request_item']);
    expect(goals.every((g) => typeof g.description !== 'string')).toBe(true);
  });
});

describe('generate_content', () => {
  let t: TestServices;
  let reasoner: FakeReasoner;
  beforeEach(async () => {
    t = await createTestServices({ reasoner: (sink) => (reasoner = new FakeReasoner(() => ({ missions: [mission()] }), sink)) });
    t.db.intents.set('greet_hello', crypto.randomUUID());
    t.db.intents.set('request_item', crypto.randomUUID());
  });
  afterEach(() => t.cleanup());

  it('generates, validates and stores review_needed drafts with provenance; nothing is published', async () => {
    const { result, events } = await runHandler(generateContentHandler, t, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello', 'request_item'], level: 'beginner', scene: 'Cafetería' }, { job_type: 'content_generate' });
    const out = result.output as Record<string, unknown>;
    expect(reasoner.calls[0]?.task).toBe('content_generation');
    expect(reasoner.calls[0]?.locale).toMatchObject({ targetVariety: 'es-ES', sourceLanguage: 'fr' });
    expect(reasoner.calls[0]?.prompt.system).toMatch(/French/);
    const drafts = out.drafts as Array<{ missionId: string; draft: Record<string, unknown>; accepted: number; rejected: unknown[] }>;
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.accepted).toBe(2);
    expect(drafts[0]!.rejected.length).toBe(5);
    expect(drafts[0]!.draft).toMatchObject({ targetTrack: 'spanish-spain', targetVariety: 'es-ES', sourceLanguage: 'fr', publication: { status: 'draft', requiresNativeReview: true, requiresVerifiedSourceRights: true } });
    expect((drafts[0]!.draft.expressions as Array<Record<string, unknown>>).every((e) => e.nativeReviewed === false && e.approvedForPublishing === false)).toBe(true);
    const missions = [...t.db.tables.missions.values()];
    expect(missions.length).toBe(1);
    expect(missions[0]!.state).toBe('review_needed');
    expect(missions[0]!.template_key).toMatch(/^cf\.greet_hello\.[a-z0-9]+$/);
    // §10.1 goal shape read by the API publish gate / learner routes: id + skill_keys + per-source description map.
    const goals = missions[0]!.goals as Array<{ id: string; skill_keys: string[]; description?: unknown }>;
    expect(goals.map((g) => g.id)).toEqual(['greet_hello', 'request_item']);
    expect(goals[0]).toMatchObject({ skill_keys: expect.arrayContaining([expect.stringMatching(/./)]), description: { fr: 'Saluer poliment le serveur.' } });
    expect(goals[0]!.description).not.toHaveProperty('en');
    expect(goals[1]).toEqual({ id: 'request_item', skill_keys: expect.any(Array) });
    expect(drafts[0]!).toMatchObject({ goalsWithoutDescription: ['request_item'] });
    expect(drafts[0]!.rejected.some((r) => (r as { item: string }).item === 'goal:request_item')).toBe(true);
    expect((missions[0]!.scoring_rubric as Record<string, unknown>).provenance).toMatchObject({ role: 'content_factory', promptVersion: expect.stringMatching(/content_factory:v/), nativeReviewed: false });
    expect([...t.db.tables.mission_localizations.values()][0]).toMatchObject({ source_language_code: 'fr', qa_state: 'machine_draft', title: 'Pedir un café' });
    const expressions = [...t.db.tables.expressions.values()];
    expect(expressions.length).toBe(2);
    expect(expressions.every((e) => e.state === 'review_needed' && e.origin === 'ai_generated' && e.reviewed === false)).toBe(true);
    expect([...t.db.tables.expression_forms.values()].every((f) => f.script === 'Latn')).toBe(true);
    expect([...t.db.tables.expression_translations.values()].map((x) => x.source_language_code)).toEqual(['fr', 'fr']);
    expect(events.map((e) => e.type)).toEqual(['translation.review_requested']);
    expect([...t.db.tables.audit_logs.values()][0]?.action).toBe('content_factory.draft_created');
    // Diversity gate: a conversational mission with alternatives passes; nothing is flagged for regeneration.
    const rubric = missions[0]!.scoring_rubric as unknown as { diversity: DiversityMark; reviewFlags: string[]; reviewStatus: string };
    expect(rubric).toMatchObject({ reviewStatus: 'review_needed', reviewFlags: [], diversity: { verdict: 'diverse', reasons: [], batch: null, regenerated: false } });
    expect(out.diversityGate).toMatchObject({ batch: null, needsRegeneration: [], regeneration: { requested: false, attempts: 0, kept: [], skipped: null } });
    expect(reasoner.calls[0]?.prompt.system).toMatch(/misunderstanding/);
  });

  it('writes the generation cost to ai_requests without an enrollment (the job id is not an enrollment)', async () => {
    const { ctx } = await runHandler(generateContentHandler, t, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello', 'request_item'], level: 'beginner' }, { job_type: 'content_generate' });
    await ctx.cost.flush();
    // The reasoner saw the job-scoped context (job id as enrollmentId); the ledger row carries no enrollment.
    expect(reasoner.calls[0]?.locale.enrollmentId).toBe(ctx.job.id);
    expect(t.persistErrors).toEqual([]);
    const rows = [...t.db.tables.ai_requests.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: 'content_generation', enrollment_id: null, user_id: null, estimated_cost_usd: 0.0005, redacted_log: { jobId: ctx.job.id } });
  });

  it('keeps a low-diversity draft as review_needed, marked for regeneration with the reasons (never published, never dropped)', async () => {
    const drillT = await createTestServices({ reasoner: (sink) => (reasoner = new FakeReasoner(() => ({ missions: [drill()] }), sink)) });
    drillT.db.intents.set('greet_hello', crypto.randomUUID());
    drillT.db.intents.set('request_item', crypto.randomUUID());
    try {
      const { result } = await runHandler(generateContentHandler, drillT, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello', 'request_item'], level: 'beginner' }, { job_type: 'content_generate' });
      const out = result.output as { drafts: Array<{ missionId: string; diversity: DiversityMark }>; diversityGate: { needsRegeneration: Array<{ missionId: string; reasons: string[] }>; regeneration: { skipped: string | null; attempts: number } } };
      expect(reasoner.calls).toHaveLength(1); // regeneration is opt-in (paid)
      const [row] = [...drillT.db.tables.missions.values()];
      expect(row!.state).toBe('review_needed');
      const rubric = row!.scoring_rubric as unknown as { diversity: DiversityMark; reviewFlags: string[] };
      expect(rubric.reviewFlags).toEqual([DIVERSITY_REVIEW_FLAG]);
      expect(rubric.diversity.verdict).toBe('needs_regeneration');
      expect(rubric.diversity.reasons).toEqual(expect.arrayContaining(['low_alternative_coverage:0', 'quiz_shaped_set:1']));
      expect([...drillT.db.tables.expressions.values()].every((e) => e.state === 'review_needed' && (e.script_annotations as { reviewFlags: string[] }).reviewFlags.includes(DIVERSITY_REVIEW_FLAG))).toBe(true);
      expect(out.diversityGate.needsRegeneration).toEqual([{ mission: 0, missionId: row!.id, reasons: rubric.diversity.reasons }]);
      expect(out.diversityGate.regeneration).toMatchObject({ attempts: 0, skipped: 'not requested (regenerateOnLowDiversity is off)' });
      const audit = [...drillT.db.tables.audit_logs.values()][0]!;
      expect((audit.after as unknown as { diversity: DiversityMark }).diversity.verdict).toBe('needs_regeneration');
    } finally {
      await drillT.cleanup();
    }
  });

  it('regenerates a low-diversity mission once with the gate reasons when asked, and keeps the retry only if it is better and rewritten', async () => {
    let calls = 0;
    const regenT = await createTestServices({ reasoner: (sink) => (reasoner = new FakeReasoner(() => ({ missions: [calls++ === 0 ? drill() : mission({ title: 'Pedir en la barra' })] }), sink)) });
    regenT.db.intents.set('greet_hello', crypto.randomUUID());
    regenT.db.intents.set('request_item', crypto.randomUUID());
    try {
      const { result } = await runHandler(generateContentHandler, regenT, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello', 'request_item'], level: 'beginner', regenerateOnLowDiversity: true }, { job_type: 'content_generate' });
      expect(reasoner.calls).toHaveLength(2);
      expect(reasoner.calls[1]!.prompt.user).toMatch(/failed the diversity gate: .*quiz_shaped_set/);
      expect(JSON.parse(reasoner.calls[1]!.prompt.user.split('\n\n')[0]!)).toMatchObject({ missionCount: 1 });
      const [row] = [...regenT.db.tables.missions.values()];
      expect(row!.title_translations).toEqual({ fr: 'Pedir en la barra' });
      expect(row!.scoring_rubric).toMatchObject({ reviewFlags: [], diversity: { verdict: 'diverse', regenerated: true } });
      expect((result.output as { diversityGate: unknown }).diversityGate).toMatchObject({ regeneration: { requested: true, attempts: 1, kept: [0], skipped: null } });
      // Both calls are in the job's ledger.
      expect([...regenT.db.tables.ai_requests.values()]).toHaveLength(2);
    } finally {
      await regenT.cleanup();
    }
    // A retry that only relabels the same lines is never kept.
    const relabelT = await createTestServices({ reasoner: (sink) => (reasoner = new FakeReasoner(() => ({ missions: [drill()] }), sink)) });
    relabelT.db.intents.set('greet_hello', crypto.randomUUID());
    relabelT.db.intents.set('request_item', crypto.randomUUID());
    try {
      const { result } = await runHandler(generateContentHandler, relabelT, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello', 'request_item'], level: 'beginner', regenerateOnLowDiversity: true }, { job_type: 'content_generate' });
      expect(reasoner.calls).toHaveLength(2);
      const [row] = [...relabelT.db.tables.missions.values()];
      expect(row!.scoring_rubric).toMatchObject({ reviewFlags: [DIVERSITY_REVIEW_FLAG], diversity: { verdict: 'needs_regeneration', regenerated: false } });
      expect((result.output as { diversityGate: unknown }).diversityGate).toMatchObject({ regeneration: { attempts: 1, kept: [] } });
    } finally {
      await relabelT.cleanup();
    }
  });

  it('gates a batch: missions that repeat one dialogue are all marked with the batch reasons', async () => {
    const batchT = await createTestServices({ reasoner: (sink) => (reasoner = new FakeReasoner(() => ({ missions: [mission(), mission()] }), sink)) });
    batchT.db.intents.set('greet_hello', crypto.randomUUID());
    batchT.db.intents.set('request_item', crypto.randomUUID());
    try {
      const { result } = await runHandler(generateContentHandler, batchT, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello', 'request_item'], level: 'beginner', count: 2 }, { job_type: 'content_generate' });
      const out = result.output as { diversityGate: { batch: { verdict: string; reasons: string[] }; needsRegeneration: unknown[] } };
      expect(out.diversityGate.batch.verdict).toBe('needs_regeneration');
      expect(out.diversityGate.batch.reasons).toEqual(expect.arrayContaining(['repeated_dialogues:0.5', 'high_overlap_dialogues:1']));
      expect(out.diversityGate.needsRegeneration).toHaveLength(2);
      const rows = [...batchT.db.tables.missions.values()];
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.state).toBe('review_needed');
        expect(row.scoring_rubric).toMatchObject({ reviewFlags: [DIVERSITY_REVIEW_FLAG], diversity: { verdict: 'needs_regeneration', mission: { verdict: 'diverse' }, reasons: expect.arrayContaining(['batch:repeated_dialogues:0.5']) } });
      }
    } finally {
      await batchT.cleanup();
    }
  });

  it('dry run writes nothing; unknown intents fail fast; fully rejected output is retried', async () => {
    const { result } = await runHandler(generateContentHandler, t, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello', 'request_item'], level: 'beginner', dryRun: true }, { job_type: 'content_generate' });
    expect((result.output as Record<string, unknown>).draftIds).toEqual([]);
    expect(t.db.tables.missions.size).toBe(0);
    await expect(runHandler(generateContentHandler, t, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['no_such_intent'], level: 'beginner' }, { job_type: 'content_generate' })).rejects.toMatchObject({ code: 'unknown_intent', retry: false });
    const bad = await createTestServices({ reasoner: (sink) => new FakeReasoner(() => ({ missions: [mission({ expressions: [{ intentKey: 'greet_hello', targetText: 'Bonjour madame, comment allez-vous ?', transliteration: null, sourceMeaning: 'Bonjour.', literalGloss: null, contextNote: null, register: 'neutral', variants: [] }] })] }), sink) });
    try {
      await expect(runHandler(generateContentHandler, bad, { targetTrack: 'spanish-spain', sourceLanguage: 'fr', intentKeys: ['greet_hello'], level: 'beginner' }, { job_type: 'content_generate' })).rejects.toMatchObject({ code: 'all_drafts_rejected', retry: true });
    } finally {
      await bad.cleanup();
    }
  });

  it('prompt carries the variety guard and the source-language coaching rule', () => {
    const p = buildContentFactoryPrompt({ track: 'arabic-moroccan', variety: 'ary', source: 'fr', level: 'beginner', scene: null, count: 1, intents: [{ key: 'greet_hello', description: 'greet', socialMeaning: null, politeness: 'any', typicalMaxWords: 6, variants: [] }] });
    expect(p.system).toMatch(/Moroccan/);
    expect(p.system).toMatch(/French/);
    expect(p.system).toMatch(/arabizi/i);
    expect(p.system).toMatch(/objectiveDescriptions/);
  });
});
