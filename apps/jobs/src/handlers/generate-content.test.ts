import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageGuard } from '@langquest/ai';
import { FakeReasoner, createTestServices, runHandler, type TestServices } from '../test-support/fakes';
import { buildContentFactoryPrompt, buildMissionGoals, generateContentHandler, validateGeneratedMission, type GeneratedMission } from './generate-content';

const mission = (overrides: Partial<GeneratedMission> = {}): GeneratedMission => ({
  title: 'Pedir un café',
  sceneDescription: 'Una cafetería en Madrid por la mañana.',
  objectiveIntentKeys: ['greet_hello', 'request_item'],
  // Only one objective is described: the other must surface as a goal without a learner-facing description.
  objectiveDescriptions: [{ intentKey: 'greet_hello', description: 'Saluer poliment le serveur.' }, { intentKey: 'not_in_brief', description: 'ignored' }],
  dialogue: [
    { speaker: 'character', intentKey: 'greet_hello', targetText: 'Hola, buenos días. ¿Qué te pongo?', transliteration: null, sourceMeaning: 'Bonjour. Qu’est-ce que je vous sers ?', register: 'neutral' },
    { speaker: 'learner', intentKey: 'request_item', targetText: 'Un café con leche, por favor.', transliteration: null, sourceMeaning: 'Un café au lait, s’il vous plaît.', register: 'polite' },
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
