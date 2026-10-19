/**
 * Seeded character cast (migration 130) against the LOCAL Supabase stack.
 * Skipped without a stack unless LANGQUEST_REQUIRE_LOCAL_STACK=1 (then the file fails).
 */
import { CHARACTER_ROSTER, charactersForVariety } from '@langquest/ui/art/web';
import { expect, it } from 'vitest';
import { characterUuid } from '../character-uuid';
import { createServiceClient } from '../client';
import { createRepositories } from '../repositories';
import { describeWithStack, stackEnv } from './stack';

describeWithStack('characters seed')('seeded character cast (migration 130)', () => {
  const service = createServiceClient(stackEnv);
  const repos = createRepositories(service);

  it('has one published row per roster character with the deterministic uuid and synthetic voice', async () => {
    for (const c of CHARACTER_ROSTER) {
      const row = await repos.characters.getById(characterUuid(c.id));
      expect(row, c.id).not.toBeNull();
      expect(row!.character_key).toBe(c.id);
      expect(row!.name).toBe(c.name);
      expect(row!.target_variety_id).toBe(c.varietyId);
      expect(row!.regional_option).toBe(c.voice.regionalOption);
      expect(row!.state).toBe('published');
      expect((row!.voice_profile as { synthetic?: boolean }).synthetic).toBe(true);
      expect(row!.storyline_facts.length).toBeGreaterThanOrEqual(2);
      expect(row!.safety_rules.length).toBeGreaterThan(0);
      expect((await repos.characters.getByKey(c.id))?.id).toBe(characterUuid(c.id));
    }
  });

  it('listPublishedForVariety never crosses a variety boundary and ranks the regional match first', async () => {
    const ary = await repos.characters.listPublishedForVariety('ary', 'casablanca');
    expect(ary.every((r) => r.target_variety_id === 'ary' && r.state === 'published')).toBe(true);
    const rosterIds = charactersForVariety('ary').map((c) => c.characterId);
    for (const id of rosterIds) expect(ary.map((r) => r.id)).toContain(id);
    const firstNonMatch = ary.findIndex((r) => r.regional_option !== 'casablanca');
    const lastMatch = ary.map((r) => r.regional_option).lastIndexOf('casablanca');
    if (firstNonMatch >= 0) expect(lastMatch).toBeLessThan(firstNonMatch);
    expect((await repos.characters.listPublishedForVariety('arb')).some((r) => rosterIds.includes(r.id))).toBe(false);
  });

  it('buildManifest includes the cast even without published missions', async () => {
    const manifest = await repos.curriculum.buildManifest('arabic-moroccan', 'fr', 'ary', 'casablanca');
    const nadia = manifest.characters.find((c) => c.characterKey === 'ary-cafe-staff-nadia');
    expect(nadia).toBeDefined();
    expect(nadia!.id).toBe(characterUuid('ary-cafe-staff-nadia'));
    expect(nadia!.portraitKey).toBe('ary-cafe-staff-nadia');
    expect(nadia!.region).toBe('Casablanca, Morocco');
    expect(nadia!.varietyId).toBe('ary');
    expect(nadia!.syntheticVoice).toBe(true);
    expect(manifest.characters[0]?.regionalOption).toBe('casablanca');
    const sw = await repos.curriculum.buildManifest('swahili', 'en', 'sw', 'TZ');
    expect(sw.characters.map((c) => c.characterKey)).toContain('sw-matatu-conductor-brian');
  });
});
