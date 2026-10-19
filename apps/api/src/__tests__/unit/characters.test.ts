/**
 * Offline checks for the cast plumbing: character references (uuid or roster key), the widened session-create
 * schema, the stale-cast detector for stored manifests, the synthetic-voice disclosure and the versioned cache keys.
 */
import { describe, expect, it } from 'vitest';
import { CharacterRefSchema, isUuid, resolveCharacterRef, syntheticVoiceOf } from '../../lib/conversation';
import { storedCastIsStale } from '../../lib/manifests';
import { SessionCreateRequestSchema } from '../../routes/speech/conversation';
import { CACHE_KEY_VERSION, createEdgeCache, versionedCacheKey } from '../../services/cache';

const UUID = '58835d74-6c1e-5735-a386-62b6af2dd06b';
const ENROLLMENT = '11111111-1111-4111-8111-111111111111';

describe('character references', () => {
  it('accepts a uuid or a roster key, rejects anything else', () => {
    expect(CharacterRefSchema.safeParse(UUID).success).toBe(true);
    expect(CharacterRefSchema.safeParse('ary-cafe-staff-nadia').success).toBe(true);
    expect(CharacterRefSchema.safeParse('tests.char_abc').success).toBe(true);
    expect(CharacterRefSchema.safeParse('Not A Key').success).toBe(false);
    expect(CharacterRefSchema.safeParse('-leading').success).toBe(false);
    expect(CharacterRefSchema.safeParse('').success).toBe(false);
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid('ary-cafe-staff-nadia')).toBe(false);
  });

  it('resolves a uuid by id and a key by character_key, never substituting', async () => {
    const seen: string[] = [];
    const repo = {
      getById: async (id: string) => {
        seen.push(`id:${id}`);
        return null;
      },
      getByKey: async (key: string) => {
        seen.push(`key:${key}`);
        return null;
      },
      listPublishedForVariety: async () => [],
    };
    expect(await resolveCharacterRef(repo, UUID)).toBeNull();
    expect(await resolveCharacterRef(repo, 'ary-cafe-staff-nadia')).toBeNull();
    expect(seen).toEqual([`id:${UUID}`, 'key:ary-cafe-staff-nadia']);
  });

  it('the session-create schema keeps the contract refinement while widening characterId', () => {
    const base = { enrollmentId: ENROLLMENT, clientSessionId: ENROLLMENT, mode: 'text_only' };
    expect(SessionCreateRequestSchema.safeParse({ ...base, characterId: 'ary-cafe-staff-nadia' }).success).toBe(true);
    expect(SessionCreateRequestSchema.safeParse({ ...base, characterId: UUID }).success).toBe(true);
    expect(SessionCreateRequestSchema.safeParse({ ...base, characterId: 'Nadia!' }).success).toBe(false);
    const mismatch = SessionCreateRequestSchema.safeParse({ ...base, missionId: UUID, scope: { kind: 'mission', missionId: ENROLLMENT } });
    expect(mismatch.success).toBe(false);
  });

  it('discloses a synthetic voice unless the profile explicitly says otherwise', () => {
    expect(syntheticVoiceOf({ voice_profile: { synthetic: true } })).toBe(true);
    expect(syntheticVoiceOf({ voice_profile: {} })).toBe(true);
    expect(syntheticVoiceOf({ voice_profile: null as never })).toBe(true);
    expect(syntheticVoiceOf({ voice_profile: { synthetic: false } })).toBe(false);
  });
});

describe('stored manifest cast staleness', () => {
  const entry = (id: string) => ({ id, characterKey: `k-${id}`, portraitKey: `k-${id}` });
  it('is stale when empty while characters are published, or when ids drifted', () => {
    expect(storedCastIsStale({ characters: [] }, [UUID])).toBe(true);
    expect(storedCastIsStale(null, [UUID])).toBe(true);
    expect(storedCastIsStale({ characters: [entry(UUID)] }, [])).toBe(true);
    expect(storedCastIsStale({ characters: [entry(UUID)] }, [ENROLLMENT])).toBe(true);
  });
  it('is stale when entries predate the art mapping', () => {
    expect(storedCastIsStale({ characters: [{ id: UUID }] }, [UUID])).toBe(true);
  });
  it('is fresh when the ids match and the mapping is present (order-independent)', () => {
    expect(storedCastIsStale({ characters: [entry(ENROLLMENT), entry(UUID)] }, [UUID, ENROLLMENT])).toBe(false);
    expect(storedCastIsStale({ characters: [] }, [])).toBe(false);
  });
});

describe('edge cache key version', () => {
  it('namespaces every key so a bump retires old entries', async () => {
    expect(versionedCacheKey('manifest:course:arabic-moroccan:fr')).toBe(`${CACHE_KEY_VERSION}:manifest:course:arabic-moroccan:fr`);
    const seen: string[] = [];
    const cache = createEdgeCache({ cache: { match: async (r) => { seen.push(r.url); return undefined; }, put: async (r) => { seen.push(r.url); }, delete: async (r) => { seen.push(r.url); return true; } } });
    await cache.put('manifest:course:arabic-moroccan:fr', '{}', 60, '"e"');
    expect(await cache.get('manifest:course:arabic-moroccan:fr')).toEqual({ body: '{}', etag: '"e"' });
    await cache.delete('manifest:course:arabic-moroccan:fr');
    expect(await cache.get('manifest:course:arabic-moroccan:fr')).toBeNull();
    for (const url of seen) expect(decodeURIComponent(url)).toContain(`${CACHE_KEY_VERSION}:manifest:course`);
  });
});
