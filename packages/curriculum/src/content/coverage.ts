/**
 * Coverage summary over seed content (§2.1 honest availability, CONVENTIONS §2.2).
 * Consumed by `scripts` (`validate-course-coverage`) and usable to seed
 * `course_source_localizations`.
 */
import { COURSE_TRACKS, SOURCE_LANGUAGES, type CourseTrackId, type CoverageMetrics, type CoverageStatus, type SourceLanguageCode } from '@langquest/contracts';
import { DEFAULT_STORY_ARC } from '../missions/story';
import { ARABIC_MOROCCAN_CHAPTER_1 } from './arabic-moroccan';
import { AUTHORED_CHAPTERS } from './authored/chapter-2';
import { ENGLISH_CHAPTER_1 } from './english';
import { JAPANESE_CHAPTER_1 } from './japanese';
import { GENERATED_CHAPTERS } from './generated';
import { buildAllPlannedSkeletons } from './skeletons';
import { SPANISH_SPAIN_CHAPTER_1 } from './spanish-spain';
import type { SeedChapter } from './types';

/** The four hand-authored draft chapters. */
export const HAND_AUTHORED_CHAPTERS: readonly SeedChapter[] = [ARABIC_MOROCCAN_CHAPTER_1, SPANISH_SPAIN_CHAPTER_1, JAPANESE_CHAPTER_1, ENGLISH_CHAPTER_1];

/**
 * Every draft chapter (never published as reviewed: all are `review_needed` AI drafts): chapter 1 of every course
 * (hand-authored, then generated), then chapter 2 (authored). A course's chapters come in story order.
 */
export const DRAFT_CHAPTERS: readonly SeedChapter[] = [...HAND_AUTHORED_CHAPTERS, ...GENERATED_CHAPTERS, ...AUTHORED_CHAPTERS];

/** Missions the default story arc plans in its chapters 1 to [chapterIndex]: what a course's drafts are measured against. */
export function arcMissionsThrough(chapterIndex: number): number {
  return DEFAULT_STORY_ARC.chapters.slice(0, Math.max(1, chapterIndex)).reduce((n, c) => n + c.missionKeys.length, 0);
}

export interface TrackSourceCoverage {
  courseTrackId: CourseTrackId;
  sourceLanguageCode: SourceLanguageCode;
  status: CoverageStatus;
  nativeReviewed: false;
  draftChapterKeys: string[];
  plannedChapterKeys: string[];
  missionCount: number;
  /** Missions with at least one draft expression carrying target text. */
  draftedMissionCount: number;
  expressionCount: number;
  expressionsWithTargetText: number;
  expressionsWithSourceMeaning: number;
  nativeReviewedExpressionCount: number;
  metrics: CoverageMetrics;
  /** Why the status is what it is (editor-facing). */
  reason: string;
}

export interface CoverageSummary {
  generatedAt: string;
  trackCount: number;
  sourceCount: number;
  rows: TrackSourceCoverage[];
  totals: { complete: number; partial: number; planned: number; unavailable: number };
  /** Sanity flags for the validator: all must be true. */
  invariants: { everyTrackHasSkeleton: boolean; noPublishedContent: boolean; noNativeReviewedClaims: boolean; noSkeletonTargetText: boolean };
}

const pct = (num: number, den: number): number => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

/** Summarise coverage per (track, source). Pure. */
export function summariseCoverage(options: { now?: string; sources?: readonly SourceLanguageCode[]; drafts?: readonly SeedChapter[] } = {}): CoverageSummary {
  const sources = options.sources ?? SOURCE_LANGUAGES.map((s) => s.code);
  const drafts = options.drafts ?? DRAFT_CHAPTERS;
  const skeletons = buildAllPlannedSkeletons(sources);
  const rows: TrackSourceCoverage[] = [];

  for (const track of COURSE_TRACKS) {
    const skeleton = skeletons.find((s) => s.courseTrackId === track.id)!;
    for (const source of sources) {
      const trackDrafts = drafts.filter((d) => d.courseTrackId === track.id && d.sourceLanguages.includes(source));
      // Measured against the chapters drafted so far for this pair (chapter 1 at least).
      const through = Math.max(1, ...trackDrafts.map((d) => d.chapterIndex));
      const expectedMissions = arcMissionsThrough(through);
      const draftMissions = trackDrafts.flatMap((d) => d.missions);
      const draftExpressions = draftMissions.flatMap((m) => m.expressions);
      const withText = draftExpressions.filter((e) => e.targetText !== null).length;
      const withMeaning = draftExpressions.filter((e) => e.meanings[source]).length;
      const draftedMissionCount = draftMissions.filter((m) => m.expressions.some((e) => e.targetText !== null)).length;
      const nativeReviewedCount = draftExpressions.filter((e) => (e.nativeReviewed as boolean) === true).length;
      const missionCount = Math.max(draftMissions.length, skeleton.missions.length);
      const status: CoverageStatus = withText > 0 ? 'partial' : 'planned';
      rows.push({
        courseTrackId: track.id,
        sourceLanguageCode: source,
        status,
        nativeReviewed: false,
        draftChapterKeys: trackDrafts.map((d) => d.key),
        plannedChapterKeys: [skeleton.key],
        missionCount,
        draftedMissionCount,
        expressionCount: draftExpressions.length + skeleton.missions.flatMap((m) => m.expressions).length,
        expressionsWithTargetText: withText,
        expressionsWithSourceMeaning: withMeaning,
        nativeReviewedExpressionCount: nativeReviewedCount,
        metrics: {
          mission_instructions_pct: pct(draftedMissionCount, expectedMissions),
          explanations_pct: pct(withMeaning, Math.max(withText, 1)) * (withText > 0 ? 1 : 0),
          ui_pct: 0,
          subtitles_pct: 0,
          audio_overlays_pct: 0,
        },
        reason: withText > 0 ? `${draftedMissionCount}/${expectedMissions} ${through > 1 ? `missions of chapters 1–${through}` : 'chapter-1 missions'} drafted (unreviewed AI drafts); native review and audio pending` : 'structure planned from shared blueprints; no target text authored yet',
      });
    }
  }

  const totals = { complete: 0, partial: 0, planned: 0, unavailable: 0 };
  for (const r of rows) totals[r.status] += 1;
  const allChapters = [...drafts, ...skeletons];
  return {
    generatedAt: options.now ?? new Date(0).toISOString(),
    trackCount: COURSE_TRACKS.length,
    sourceCount: sources.length,
    rows,
    totals,
    invariants: {
      everyTrackHasSkeleton: COURSE_TRACKS.every((t) => skeletons.some((s) => s.courseTrackId === t.id)),
      noPublishedContent: allChapters.every((c) => c.reviewStatus !== 'approved'),
      noNativeReviewedClaims: allChapters.every((c) => !c.nativeReviewed && c.missions.every((m) => m.expressions.every((e) => !e.nativeReviewed))),
      noSkeletonTargetText: skeletons.every((s) => s.missions.every((m) => m.expressions.every((e) => e.targetText === null))),
    },
  };
}
