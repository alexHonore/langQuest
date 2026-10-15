/**
 * Planned chapter-1 skeletons for ALL 30 tracks (§2.1, §13 Phase 10).
 *
 * A skeleton instantiates the language-independent blueprints with `targetText: null`
 * so the catalog shows real structure (missions, objectives, slots, characters-by-role)
 * and an honest `planned` status. No target-language text is ever invented here.
 */
import { COURSE_TRACKS, type CourseTrackId, type SourceLanguageCode } from '@langquest/contracts';
import { DEFAULT_STORY_ARC } from '../missions/story';
import { getBlueprint } from '../missions/scenarios';
import { defineSeedChapter, type SeedChapter, type SeedExpressionInput } from './types';

/** Blueprint keys that make up chapter 1 everywhere (story arc chapter 1). */
export const CHAPTER_1_BLUEPRINT_KEYS: readonly string[] = DEFAULT_STORY_ARC.chapters[0]!.missionKeys;

const trackSlug = (id: CourseTrackId): string => id.replace(/-/g, '_');

/** Build the planned skeleton chapter for one track. Deterministic. */
export function buildPlannedSkeleton(courseTrackId: CourseTrackId, sourceLanguages: readonly SourceLanguageCode[] = ['en']): SeedChapter {
  const track = COURSE_TRACKS.find((t) => t.id === courseTrackId);
  if (!track) throw new Error(`Unknown course track ${courseTrackId}`);
  const slug = trackSlug(courseTrackId);
  const roles = new Map<string, string>();
  const missions = CHAPTER_1_BLUEPRINT_KEYS.map((bpKey) => {
    const bp = getBlueprint(bpKey);
    const roleKey = `${slug}_${bp.characterRole.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    roles.set(roleKey, bp.characterRole);
    const expressions: SeedExpressionInput[] = bp.slots.map((slot) => ({
      key: slot.slotId,
      intentKey: slot.intentKey,
      slotId: slot.slotId,
      speaker: slot.speaker,
      targetText: null,
      forms: [],
      meanings: {},
      register: slot.register,
      codeSwitchNote: null,
      pronunciationNote: null,
      nativeReviewed: false,
      reviewStatus: 'draft',
      provenance: 'planned_skeleton',
    }));
    const titles = Object.fromEntries(sourceLanguages.map((s) => [s, bp.titleKey])) as Record<SourceLanguageCode, string>;
    return { key: `${slug}_${bpKey}`, blueprintKey: bpKey, characterKey: roleKey, titles, sceneNotes: {}, expressions };
  });
  return defineSeedChapter({
    key: `${slug}_ch1_planned`,
    chapterIndex: 1,
    courseTrackId,
    targetVarietyId: track.targetVarietyId,
    sourceLanguages: [...sourceLanguages],
    titles: Object.fromEntries(sourceLanguages.map((s) => [s, DEFAULT_STORY_ARC.chapters[0]!.titleKey])) as Record<SourceLanguageCode, string>,
    characters: [...roles.entries()].map(([characterKey, role]) => ({ characterKey, role, name: role, personality: 'to be authored', homeRegion: track.defaultLocale, regionalOption: null })),
    missions,
    provenance: 'planned_skeleton',
    nativeReviewed: false,
    reviewStatus: 'draft',
    generatedBy: 'curriculum-seed/skeletons@2026-10',
    notes: [
      `Planned structure only for ${track.displayName} (${track.targetVarietyId}); no target text exists yet.`,
      ...(track.sharesAssetsWithTrackId ? [`Shares language/voice assets with ${track.sharesAssetsWithTrackId} (script focus ${track.scriptFocus ?? 'default'}).`] : []),
      ...track.assumptions,
    ],
  });
}

/** Skeleton chapters for all 30 tracks, in catalog order. */
export function buildAllPlannedSkeletons(sourceLanguages: readonly SourceLanguageCode[] = ['en']): SeedChapter[] {
  return COURSE_TRACKS.map((t) => buildPlannedSkeleton(t.id, sourceLanguages));
}
