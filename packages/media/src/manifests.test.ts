import { describe, expect, it } from 'vitest';
import type { AudioCollectionManifest, CourseManifest } from '@langquest/contracts';
import { buildAudioCollectionManifest, buildCourseManifest, buildDownloadPackManifest, canonicalJson, computeManifestChecksum, diffManifests, isKeyInvalidated, lazyAssetRef, manifestCacheKey, manifestInvalidationPrefixes, nextManifestVersion, verifyManifestChecksum } from './manifests';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const HASH = (c: string) => c.repeat(64);
const NOW = new Date('2026-10-14T12:00:00Z');

const audioAsset = lazyAssetRef({ id: U(10), kind: 'audio', checksumSha256: HASH('a'), byteLength: 1000, mimeType: 'audio/mp4', durationMs: 2000, visibility: 'private', publicUrl: 'https://cdn.example.com/leak.m4a' });
const visual = { ...lazyAssetRef({ id: U(11), kind: 'image', checksumSha256: HASH('b'), byteLength: 10, mimeType: 'image/png', durationMs: null, visibility: 'public', publicUrl: 'https://cdn.example.com/x.png', altTextKey: 'art.cafe' }), visualType: 'mission_scene' as const };

function course(version = 1): CourseManifest {
  return buildCourseManifest({
    courseTrackId: 'arabic-moroccan',
    sourceLanguageCode: 'fr',
    targetVarietyId: 'ary',
    version,
    coverArt: null,
    characters: [{ id: U(20), name: 'Salma', role: 'barista', varietyId: 'ary', portrait: null, syntheticVoice: true }],
    chapters: [
      {
        id: U(1), order: 1, title: 'Au café', description: null, scene: 'cafe', region: 'Casablanca', coverArt: null, mapArt: null,
        missions: [
          { id: U(2), order: 0, type: 'standard', titleKey: null, title: 'Commander un thé', level: 'beginner', difficulty: 0.2, recommendedMinutes: 8, prerequisiteSkillKeys: [], skillKeys: ['greet.basic'], characterIds: [U(20)], sceneArt: visual, publishedRevision: 1, localizationComplete: true,
            steps: [{ id: U(3), order: 1, type: 'context_listening', lessonType: 'anticipate_speak', estimatedSeconds: 60, expressionIds: [], assets: [audioAsset], visuals: [], offlineCapable: true }] },
        ],
      },
    ],
  }, NOW);
}

describe('canonical json and checksums', () => {
  it('sorts keys deterministically and verifies', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
    const m = course();
    expect(verifyManifestChecksum(m)).toBe(true);
    expect(computeManifestChecksum({ ...m, chapters: [] })).not.toBe(m.checksum);
    expect(verifyManifestChecksum({ ...m, version: 99 })).toBe(false);
  });

  it('lazy refs never leak a URL for private assets', () => {
    expect(audioAsset.publicUrl).toBeNull();
    expect(visual.publicUrl).toBe('https://cdn.example.com/x.png');
  });
});

describe('builders', () => {
  it('builds a valid course manifest sorted by order', () => {
    const m = course();
    expect(m.formatVersion).toBe(1);
    expect(m.generatedAt).toBe(NOW.toISOString());
    expect(m.cacheTtlSeconds).toBe(300);
    expect(m.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(course().checksum).toBe(m.checksum);
  });

  it('builds audio collection and download pack manifests', () => {
    const audio = buildAudioCollectionManifest({
      collectionId: U(30), title: 'Darija conversations', targetVarietyId: 'ary', instructionLanguageCode: 'fr', version: 2, coverArt: null, attributionText: null,
      chapters: [{ id: U(31), order: 2, title: 'B', summary: null, coverArt: null, lessons: [] }, { id: U(32), order: 1, title: 'A', summary: null, coverArt: null, lessons: [{ id: U(33), order: 1, title: 'L1', description: null, durationMs: 1000, level: null, speakerNames: ['Salma'], assets: [audioAsset], transcriptAvailable: true, transcriptLanguages: ['ary', 'fr'], offlineEligible: true }] }],
    }, NOW);
    expect(audio.chapters.map((c) => c.title)).toEqual(['A', 'B']);
    expect(verifyManifestChecksum(audio)).toBe(true);
    const pack = buildDownloadPackManifest({
      packId: U(40), lessonId: U(33), collectionId: U(30), version: 1, includesTranscript: true, distributionAllowed: true, attributionText: 'CC BY 4.0',
      files: [{ assetId: U(10), kind: 'audio', path: `${U(10)}.m4a`, contentHash: HASH('a'), byteLength: 1000, mimeType: 'audio/mp4', url: 'https://r2.example.com/signed', urlExpiresAt: NOW.toISOString() }],
    }, NOW);
    expect(pack.totalBytes).toBe(1000);
    expect(verifyManifestChecksum(pack)).toBe(true);
    expect(() => buildDownloadPackManifest({ packId: U(40), lessonId: U(33), collectionId: U(30), version: 1, includesTranscript: false, distributionAllowed: false, attributionText: null, files: pack.files }, NOW)).toThrow(/distribution rights/);
    expect(() => buildDownloadPackManifest({ packId: U(40), lessonId: U(33), collectionId: U(30), version: 1, includesTranscript: false, distributionAllowed: true, attributionText: null, files: [{ ...pack.files[0]!, path: '../escape.m4a' }] }, NOW)).toThrow(/Unsafe/);
  });
});

describe('diff and invalidation', () => {
  it('diffs manifests by node id and asset id', () => {
    const a = course(1);
    const next = course(2);
    const changedMission = { ...next.chapters[0]!.missions[0]!, title: 'Commander un café', steps: [{ ...next.chapters[0]!.missions[0]!.steps[0]!, assets: [{ ...audioAsset, assetId: U(99) }] }] };
    const b: CourseManifest = buildCourseManifest({ ...next, chapters: [{ ...next.chapters[0]!, missions: [changedMission, { ...changedMission, id: U(50), order: 1, steps: [] }] }] }, NOW);
    const diff = diffManifests(a, b);
    expect(diff.versionChanged).toBe(true);
    // the mission changed (title) and so did its step (new asset ref)
    expect([...diff.changedIds].sort()).toEqual([U(2), U(3)]);
    expect(diff.addedIds).toEqual([U(50)]);
    expect(diff.removedIds).toEqual([]);
    expect(diff.assetsAdded).toEqual([U(99)]);
    expect(diff.assetsRemoved).toEqual([U(10)]);
    const same = diffManifests(a, course(1));
    expect(same).toMatchObject({ versionChanged: false, checksumChanged: false, changedIds: [], addedIds: [], removedIds: [] });
  });

  it('builds cache keys and invalidation prefixes', () => {
    expect(manifestCacheKey({ kind: 'course', courseTrackId: 'french', sourceLanguageCode: 'en', version: 3 })).toBe('manifest:course:french:en:v3');
    expect(manifestCacheKey({ kind: 'audio_collection', collectionId: U(1) })).toBe(`manifest:audio:${U(1)}:any`);
    const all = manifestInvalidationPrefixes({ kind: 'course', courseTrackId: 'french', collectionId: null, sourceLanguageCode: null });
    expect(all).toEqual(['manifest:course:french:']);
    expect(isKeyInvalidated('manifest:course:french:en:v3', all)).toBe(true);
    expect(isKeyInvalidated('manifest:course:german:en:v3', all)).toBe(false);
    const one = manifestInvalidationPrefixes({ kind: 'course', courseTrackId: 'french', collectionId: null, sourceLanguageCode: 'fr' });
    expect(isKeyInvalidated('manifest:course:french:en:v3', one)).toBe(false);
    expect(() => manifestInvalidationPrefixes({ kind: 'audio_collection', courseTrackId: null, collectionId: null, sourceLanguageCode: null })).toThrow();
    expect(nextManifestVersion(null)).toBe(1);
    expect(nextManifestVersion(7)).toBe(8);
    const audioManifest = {} as AudioCollectionManifest;
    void audioManifest;
  });
});
