import type { AudioCollectionManifest } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterCollections, filterLessons, hasActiveFilters, lengthBucketOf, speakerOptions, type AudioCollectionSummary } from './library-search';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const col = (n: number, patch: Partial<AudioCollectionSummary>): AudioCollectionSummary => ({ id: uuid(n), title: `Collection ${n}`, description: null, courseTrackId: 'arabic-moroccan', targetVarietyId: 'ary', instructionLanguageCode: 'fr', region: null, instructorName: null, coverArt: null, chapterCount: 1, lessonCount: 2, totalDurationMs: null, attributionText: null, offlineEligible: true, version: 1, ...patch });

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
  attributionText: null,
  chapters: [
    {
      id: uuid(10),
      order: 0,
      title: 'Au marché',
      summary: null,
      coverArt: null,
      lessons: [
        { id: uuid(100), order: 0, title: 'Les légumes', description: null, durationMs: 3 * 60_000, level: 'beginner', speakerNames: ['Yasmine'], assets: [], transcriptAvailable: true, transcriptLanguages: ['fr'], offlineEligible: true },
        { id: uuid(101), order: 1, title: 'Négocier le prix', description: 'Marchander poliment', durationMs: 12 * 60_000, level: 'intermediate', speakerNames: ['Yasmine', 'Karim'], assets: [], transcriptAvailable: false, transcriptLanguages: [], offlineEligible: false },
        { id: uuid(102), order: 2, title: 'Longue conversation', description: null, durationMs: 40 * 60_000, level: 'advanced', speakerNames: ['Karim'], assets: [], transcriptAvailable: true, transcriptLanguages: [], offlineEligible: true },
      ],
    },
  ],
};

describe('library search', () => {
  it('filters collections by variety, instruction language and accent-insensitive text', () => {
    const items = [col(1, { title: 'Darija au café' }), col(2, { targetVarietyId: 'arb', title: 'Fusha' }), col(3, { instructionLanguageCode: 'en', title: 'Darija for travellers' }), col(4, { targetVarietyId: null, instructionLanguageCode: null, title: 'General' })];
    expect(filterCollections(items, { ...EMPTY_FILTERS, targetVarietyId: 'ary' }).map((c) => c.id)).toEqual([uuid(1), uuid(3), uuid(4)]);
    expect(filterCollections(items, { ...EMPTY_FILTERS, instructionLanguageCode: 'fr' }).map((c) => c.id)).toEqual([uuid(1), uuid(2), uuid(4)]);
    expect(filterCollections(items, { ...EMPTY_FILTERS, query: 'cafe darija' }).map((c) => c.id)).toEqual([uuid(1)]);
  });

  it('filters lessons by level, length bucket, speaker and text', () => {
    expect(filterLessons(manifest, { ...EMPTY_FILTERS, level: 'beginner' }).map((h) => h.lesson.id)).toEqual([uuid(100)]);
    expect(filterLessons(manifest, { ...EMPTY_FILTERS, length: 'medium' }).map((h) => h.lesson.id)).toEqual([uuid(101)]);
    expect(filterLessons(manifest, { ...EMPTY_FILTERS, speaker: 'karim' }).map((h) => h.lesson.id)).toEqual([uuid(101), uuid(102)]);
    expect(filterLessons(manifest, { ...EMPTY_FILTERS, query: 'marchander' })[0]?.chapterTitle).toBe('Au marché');
    expect(filterLessons(manifest, { ...EMPTY_FILTERS, query: 'marché' })).toHaveLength(3);
  });

  it('exposes speaker options and length buckets', () => {
    expect(speakerOptions([manifest])).toEqual(['Karim', 'Yasmine']);
    expect(lengthBucketOf(4 * 60_000)).toBe('short');
    expect(lengthBucketOf(20 * 60_000)).toBe('long');
    expect(lengthBucketOf(null)).toBeNull();
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, level: 'advanced' })).toBe(true);
  });
});
