import { describe, expect, it } from 'vitest';
import { AI_TASK_NAME_VALUES, ModelProfileSchema } from '@langquest/contracts';
import { AI_ROLE_VALUES, DEFAULT_PROFILES, ModelProfileRegistry, ProfileNotFoundError, ROLE_TO_TASK, defaultProfileId, ledgerProfileId } from './profiles';

describe('DEFAULT_PROFILES', () => {
  it('covers every AiTaskName with a global default and validates against the contract schema', () => {
    for (const task of AI_TASK_NAME_VALUES) expect(DEFAULT_PROFILES.some((p) => p.task === task && p.targetVariety === null && p.sourceLanguage === null)).toBe(true);
    for (const p of DEFAULT_PROFILES) expect(() => ModelProfileSchema.parse(p)).not.toThrow();
    const ids = new Set(DEFAULT_PROFILES.map((p) => p.id));
    expect(ids.size).toBe(DEFAULT_PROFILES.length);
  });
  it('maps every internal role to a spec task', () => {
    for (const role of AI_ROLE_VALUES) expect(AI_TASK_NAME_VALUES).toContain(ROLE_TO_TASK[role]);
  });
  it('produces deterministic uuid-shaped ids', () => {
    expect(defaultProfileId('character_dialogue', 'ary', null)).toBe(defaultProfileId('character_dialogue', 'ary', null));
    expect(defaultProfileId('character_dialogue', 'ary', null)).not.toBe(defaultProfileId('character_dialogue', 'arz', null));
    expect(defaultProfileId('character_dialogue', null, null)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('ModelProfileRegistry resolution', () => {
  it('resolves exact → variety → source → global', () => {
    const r = new ModelProfileRegistry();
    const global = r.resolve({ task: 'character_dialogue', targetVariety: 'fr', sourceLanguage: 'en' });
    expect(global.targetVariety).toBeNull();
    const variety = r.resolve({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'en' });
    expect(variety.targetVariety).toBe('ary');
    r.upsertInput({ task: 'character_dialogue', targetVariety: null, sourceLanguage: 'fr', provider: 'openrouter', primaryModel: 'x/source-fr', fallbackModels: [], params: {}, latencyClass: 'realtime', enabled: true, dailyBudgetUsd: null });
    expect(r.resolve({ task: 'character_dialogue', targetVariety: 'fr', sourceLanguage: 'fr' }).primaryModel).toBe('x/source-fr');
    // variety beats source
    expect(r.resolve({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr' }).targetVariety).toBe('ary');
    r.upsertInput({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr', provider: 'openrouter', primaryModel: 'x/exact', fallbackModels: ['y/fb'], params: {}, latencyClass: 'realtime', enabled: true, dailyBudgetUsd: null });
    const exact = r.resolve({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr' });
    expect(exact.primaryModel).toBe('x/exact');
    expect(ModelProfileRegistry.modelChain(exact)).toEqual(['x/exact', 'y/fb']);
    expect(ModelProfileRegistry.modelChain(exact, 'y/fb')).toEqual(['y/fb', 'x/exact']);
  });

  it('skips disabled profiles and throws when nothing matches', () => {
    const r = new ModelProfileRegistry([]);
    expect(() => r.resolve({ task: 'scene_planning', targetVariety: 'fr', sourceLanguage: 'en' })).toThrow(ProfileNotFoundError);
    r.upsertInput({ task: 'scene_planning', targetVariety: null, sourceLanguage: null, provider: 'openrouter', primaryModel: 'a/b', fallbackModels: [], params: {}, latencyClass: 'batch', enabled: false, dailyBudgetUsd: null });
    expect(r.find({ task: 'scene_planning', targetVariety: 'fr', sourceLanguage: 'en' })).toBeNull();
  });

  it('overlays rows from a loader (ai_model_profiles)', async () => {
    const r = new ModelProfileRegistry();
    const row = ModelProfileSchema.parse({ ...DEFAULT_PROFILES[0], id: '44444444-4444-4444-8444-444444444444', task: 'meaning_assessment', targetVariety: 'yue', sourceLanguage: null, primaryModel: 'db/model', fallbackModels: [], version: 3 });
    expect(await r.refresh({ load: async () => [row] })).toBe(1);
    expect(r.resolve({ task: 'meaning_assessment', targetVariety: 'yue', sourceLanguage: 'en' }).primaryModel).toBe('db/model');
    expect(r.list('meaning_assessment')[0]?.targetVariety).toBe('yue');
  });

  it('marks resolved profiles with their source: package-default vs db', async () => {
    const r = new ModelProfileRegistry();
    const before = r.resolve({ task: 'meaning_assessment', targetVariety: 'yue', sourceLanguage: 'en' });
    expect(before.resolvedSource).toBe('package-default');
    expect(ledgerProfileId(before)).toBeNull();
    const row = ModelProfileSchema.parse({ ...DEFAULT_PROFILES[0], id: '44444444-4444-4444-8444-444444444444', task: 'meaning_assessment', targetVariety: 'yue', sourceLanguage: null, primaryModel: 'db/model', fallbackModels: [], version: 3 });
    await r.refresh({ load: async () => [row] });
    const after = r.resolve({ task: 'meaning_assessment', targetVariety: 'yue', sourceLanguage: 'en' });
    expect(after.resolvedSource).toBe('db');
    expect(ledgerProfileId(after)).toBe('44444444-4444-4444-8444-444444444444');
    expect(r.sourceOf('meaning_assessment', 'yue', null)).toBe('db');
    expect(r.sourceOf('meaning_assessment', null, null)).toBe('package-default');
    expect(r.list('meaning_assessment').find((p) => p.targetVariety === 'yue')?.resolvedSource).toBe('db');
  });

  it('calls default to GPT 6 Luna then Sonnet; dialect courses to Sonnet then Luna (three models at most, for OpenRouter)', () => {
    const r = new ModelProfileRegistry();
    const call = r.resolve({ task: 'character_dialogue', targetVariety: 'es-ES', sourceLanguage: 'en' });
    expect([call.primaryModel, ...call.fallbackModels]).toEqual(['openai/gpt-6-luna', 'anthropic/claude-sonnet-5.5', 'google/gemini-3.8-flash']);
    const dialect = r.resolve({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'fr' });
    expect([dialect.primaryModel, ...dialect.fallbackModels]).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna', 'google/gemini-3.8-flash']);
    for (const p of DEFAULT_PROFILES) expect(1 + p.fallbackModels.length, `${p.task} ${p.targetVariety ?? '*'}`).toBeLessThanOrEqual(3);
  });

  it('refresh ignores disabled DB rows so the package default for the same scope stays in force', async () => {
    const r = new ModelProfileRegistry();
    const packageDefault = r.resolve({ task: 'character_dialogue', targetVariety: 'fr', sourceLanguage: 'en' });
    const disabledGlobal = ModelProfileSchema.parse({ ...packageDefault, resolvedSource: undefined, id: '55555555-5555-4555-8555-555555555555', primaryModel: 'db/disabled', enabled: false });
    const disabledVariety = ModelProfileSchema.parse({ ...disabledGlobal, id: '66666666-6666-4666-8666-666666666666', targetVariety: 'ary' });
    const result = await r.refreshDetailed({ load: async () => [disabledGlobal, disabledVariety] });
    expect(result).toEqual({ applied: 0, skippedDisabled: 2, reverted: 0 });
    const resolved = r.resolve({ task: 'character_dialogue', targetVariety: 'fr', sourceLanguage: 'en' });
    expect(resolved.primaryModel).toBe(packageDefault.primaryModel);
    expect(resolved.resolvedSource).toBe('package-default');
    expect(r.resolve({ task: 'character_dialogue', targetVariety: 'ary', sourceLanguage: 'en' })).toMatchObject({ targetVariety: 'ary', resolvedSource: 'package-default' });
    // Seed scenario: every row disabled → nothing is turned off, all tasks still resolve.
    const allDisabled = DEFAULT_PROFILES.map((p, i) => ModelProfileSchema.parse({ ...p, id: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`, enabled: false }));
    expect(await r.refresh({ load: async () => allDisabled })).toBe(0);
    for (const task of AI_TASK_NAME_VALUES) expect(r.find({ task, targetVariety: 'fr', sourceLanguage: 'en' })).not.toBeNull();
  });

  it('refresh reverts a previously overlaid scope when its row is disabled later', async () => {
    const r = new ModelProfileRegistry();
    const enabled = ModelProfileSchema.parse({ ...DEFAULT_PROFILES[0], id: '88888888-8888-4888-8888-888888888888', task: 'scene_planning', targetVariety: null, sourceLanguage: null, primaryModel: 'db/enabled' });
    expect(await r.refresh({ load: async () => [enabled] })).toBe(1);
    expect(r.resolve({ task: 'scene_planning', targetVariety: 'fr', sourceLanguage: 'en' })).toMatchObject({ primaryModel: 'db/enabled', resolvedSource: 'db' });
    const result = await r.refreshDetailed({ load: async () => [{ ...enabled, enabled: false }] });
    expect(result).toEqual({ applied: 0, skippedDisabled: 1, reverted: 1 });
    const back = r.resolve({ task: 'scene_planning', targetVariety: 'fr', sourceLanguage: 'en' });
    expect(back.resolvedSource).toBe('package-default');
    expect(back.primaryModel).toBe('anthropic/claude-haiku-5.5');
    // upsert() of a DB row defaults to the db layer; a disabled one never lands.
    r.upsert({ ...enabled, enabled: false });
    expect(r.resolve({ task: 'scene_planning', targetVariety: 'fr', sourceLanguage: 'en' }).resolvedSource).toBe('package-default');
    r.upsert(enabled);
    expect(r.resolve({ task: 'scene_planning', targetVariety: 'fr', sourceLanguage: 'en' }).resolvedSource).toBe('db');
  });
});
