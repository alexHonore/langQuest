/**
 * Client-side search and filters for the audio library (§1.3 Audio, §10.2B
 * screen 7): by learning language (variety / track), instruction language,
 * speaker, level, length and free text. Pure so it runs identically against
 * the network page and the offline cache.
 */
import type { AudioCollectionManifest, AudioCollectionsResponse, AudioManifestLesson, LearnerLevel } from '@langquest/contracts';

export type AudioCollectionSummary = AudioCollectionsResponse['items'][number];

export type LengthBucket = 'short' | 'medium' | 'long';

export const LENGTH_BUCKETS: Readonly<Record<LengthBucket, { minMs: number; maxMs: number | null }>> = {
  short: { minMs: 0, maxMs: 5 * 60_000 },
  medium: { minMs: 5 * 60_000, maxMs: 20 * 60_000 },
  long: { minMs: 20 * 60_000, maxMs: null },
};

export function lengthBucketOf(durationMs: number | null): LengthBucket | null {
  if (durationMs === null) return null;
  for (const [bucket, range] of Object.entries(LENGTH_BUCKETS) as [LengthBucket, { minMs: number; maxMs: number | null }][]) {
    if (durationMs >= range.minMs && (range.maxMs === null || durationMs < range.maxMs)) return bucket;
  }
  return null;
}

export interface LibraryFilters {
  query: string;
  /** Target variety id (e.g. `ary`) or null for every language. */
  targetVarietyId: string | null;
  /** Course track id, when the learner wants only collections tied to their course. */
  courseTrackId: string | null;
  instructionLanguageCode: string | null;
  speaker: string | null;
  level: LearnerLevel | null;
  length: LengthBucket | null;
}

export const EMPTY_FILTERS: LibraryFilters = { query: '', targetVarietyId: null, courseTrackId: null, instructionLanguageCode: null, speaker: null, level: null, length: null };

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const matchesQuery = (query: string, ...fields: (string | null | undefined)[]): boolean => {
  const q = normalise(query);
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  const haystack = normalise(fields.filter((f): f is string => typeof f === 'string' && f.length > 0).join(' \u0001 '));
  return terms.every((term) => haystack.includes(term));
};

/** Collections matching the language filters and free text. */
export function filterCollections(items: readonly AudioCollectionSummary[], filters: LibraryFilters): AudioCollectionSummary[] {
  return items.filter((c) => {
    if (filters.targetVarietyId && c.targetVarietyId !== null && c.targetVarietyId !== filters.targetVarietyId) return false;
    if (filters.targetVarietyId && c.targetVarietyId === null && filters.courseTrackId && c.courseTrackId !== null && c.courseTrackId !== filters.courseTrackId) return false;
    if (filters.instructionLanguageCode && c.instructionLanguageCode !== null && c.instructionLanguageCode !== filters.instructionLanguageCode) return false;
    if (filters.speaker && !matchesQuery(filters.speaker, c.instructorName)) return false;
    return matchesQuery(filters.query, c.title, c.description, c.instructorName, c.region);
  });
}

export interface LessonHit {
  lesson: AudioManifestLesson;
  chapterId: string;
  chapterTitle: string;
  collectionId: string;
  collectionTitle: string;
}

/** Lessons inside a manifest matching speaker / level / length / text filters. */
export function filterLessons(manifest: AudioCollectionManifest, filters: Pick<LibraryFilters, 'query' | 'speaker' | 'level' | 'length'>): LessonHit[] {
  const hits: LessonHit[] = [];
  for (const chapter of manifest.chapters) {
    for (const lesson of chapter.lessons) {
      if (filters.level && lesson.level !== filters.level) continue;
      if (filters.length && lengthBucketOf(lesson.durationMs) !== filters.length) continue;
      if (filters.speaker && !lesson.speakerNames.some((n) => matchesQuery(filters.speaker!, n))) continue;
      if (!matchesQuery(filters.query, lesson.title, lesson.description, chapter.title, ...lesson.speakerNames)) continue;
      hits.push({ lesson, chapterId: chapter.id, chapterTitle: chapter.title, collectionId: manifest.collectionId, collectionTitle: manifest.title });
    }
  }
  return hits;
}

/** Distinct speaker names across loaded manifests (for the speaker filter chips). */
export function speakerOptions(manifests: readonly AudioCollectionManifest[]): string[] {
  const names = new Set<string>();
  for (const m of manifests) for (const ch of m.chapters) for (const l of ch.lessons) for (const n of l.speakerNames) if (n.trim()) names.add(n.trim());
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Whether any filter beyond the language defaults is active. */
export function hasActiveFilters(filters: LibraryFilters): boolean {
  return Boolean(filters.query.trim() || filters.speaker || filters.level || filters.length);
}
