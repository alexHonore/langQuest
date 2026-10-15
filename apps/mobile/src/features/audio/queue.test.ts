import type { AudioCollectionManifest } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { buildQueue, preferredLessonAssetId, queueIndexOf } from './queue';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (n: number, kind: 'audio' | 'image' = 'audio') => ({ assetId: uuid(n), kind, contentHash: 'a'.repeat(64), byteLength: 10, mimeType: kind === 'audio' ? 'audio/mpeg' : 'image/png', durationMs: null, publicUrl: null, altTextKey: null });

const manifest: AudioCollectionManifest = {
  formatVersion: 1,
  collectionId: uuid(1),
  title: 'Darija au café',
  targetVarietyId: 'ary',
  instructionLanguageCode: 'fr',
  version: 1,
  checksum: 'a'.repeat(64),
  generatedAt: '2026-10-14T00:00:00Z',
  coverArt: null,
  attributionText: 'CC BY',
  chapters: [
    { id: uuid(20), order: 1, title: 'B', summary: null, coverArt: null, lessons: [{ id: uuid(201), order: 0, title: 'b1', description: null, durationMs: 1, level: null, speakerNames: [], assets: [asset(31)], transcriptAvailable: false, transcriptLanguages: [], offlineEligible: true }] },
    {
      id: uuid(10),
      order: 0,
      title: 'A',
      summary: null,
      coverArt: null,
      lessons: [
        { id: uuid(102), order: 1, title: 'a2', description: null, durationMs: 1, level: null, speakerNames: [], assets: [asset(32, 'image')], transcriptAvailable: false, transcriptLanguages: [], offlineEligible: true },
        { id: uuid(101), order: 0, title: 'a1', description: null, durationMs: 1, level: null, speakerNames: [], assets: [asset(30)], transcriptAvailable: false, transcriptLanguages: [], offlineEligible: true },
      ],
    },
  ],
};

describe('queue builder', () => {
  it('orders chapters and lessons, skips lessons without audio and scopes to a chapter', () => {
    const q = buildQueue(manifest, { courseTrackId: 'arabic-moroccan' });
    expect(q.map((i) => i.title)).toEqual(['a1', 'b1']);
    expect(q[0]).toMatchObject({ assetId: uuid(30), subtitle: 'Darija au café · A', attributionText: 'CC BY', courseTrackId: 'arabic-moroccan' });
    expect(buildQueue(manifest, { chapterId: uuid(20) }).map((i) => i.id)).toEqual([uuid(201)]);
    expect(queueIndexOf(q, uuid(201))).toBe(1);
  });

  it('prefers the mobile rendition for lesson detail assets', () => {
    const ref = (n: number) => ({ ref: asset(n), type: n === 1 ? ('master' as const) : ('mobile_encoded' as const) });
    expect(preferredLessonAssetId({ assets: [ref(1), ref(2)] })).toBe(uuid(2));
    expect(preferredLessonAssetId({ assets: [] })).toBeNull();
  });
});
