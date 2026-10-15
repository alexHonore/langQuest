import { describe, expect, it } from 'vitest';
import { AI_TASK_NAME_VALUES, ModelProfileSchema } from '@langquest/contracts';
import { AI_ROLE_VALUES, DEFAULT_PROFILES, ModelProfileRegistry, ProfileNotFoundError, ROLE_TO_TASK, defaultProfileId } from './profiles';

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
});
