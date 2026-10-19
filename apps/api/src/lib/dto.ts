/**
 * Row → DTO mappers shared by learner routes. Mapping is explicit (no spread of DB rows) so a column added to
 * the database never leaks into a client response by accident.
 */
import {
  AccessibilityOptionsSchema,
  type SourceLanguageCode,
  EnrollmentDtoSchema,
  PrivacyOptionsSchema,
  getCourseTrack,
  isCourseTrackId,
  isSourceLanguageCode,
  type AssetRef,
  type CourseCapabilities,
  type EnrollmentDto,
  type ReviewCard,
  type SourceCoverage,
  type VisualRef,
} from '@langquest/contracts';
import type { Row } from '@langquest/db/types';
import { lazyAssetRef } from '@langquest/media/manifests';
import { problem } from '../http/envelope';

/** Learner-readable columns of `course_source_localizations` (column-level grant, 070_rls §8). */
export const COVERAGE_COLUMNS = 'id, course_track_id, source_language_code, status, metrics, native_reviewed, reviewed_at, editorial_note_key, fallback_source_language_code, created_at, updated_at';
export type CoverageRow = Pick<Row<'course_source_localizations'>, 'id' | 'course_track_id' | 'source_language_code' | 'status' | 'metrics' | 'native_reviewed' | 'reviewed_at' | 'editorial_note_key' | 'fallback_source_language_code'>;

/** Learner-readable columns of `media_assets` (never owner_id / legacy paths). */
export const MEDIA_ASSET_COLUMNS = 'id, storage_key, bucket, kind, checksum_sha256, mime_type, byte_length, duration_ms, channels, sample_rate_hz, bitrate_kbps, source_asset_id, derivation, visibility, content_rights_id, disposition, state, etag, created_at, updated_at';
export type MediaAssetPublicRow = Pick<Row<'media_assets'>, 'id' | 'storage_key' | 'bucket' | 'kind' | 'checksum_sha256' | 'mime_type' | 'byte_length' | 'duration_ms' | 'channels' | 'sample_rate_hz' | 'bitrate_kbps' | 'source_asset_id' | 'derivation' | 'visibility' | 'content_rights_id' | 'disposition' | 'state' | 'etag'>;

const DEFAULT_METRICS = { mission_instructions_pct: 0, explanations_pct: 0, ui_pct: 0, subtitles_pct: 0, audio_overlays_pct: 0 };

export function coverageToDto(row: CoverageRow): SourceCoverage {
  const metrics = { ...DEFAULT_METRICS, ...((row.metrics as Record<string, number> | null) ?? {}) };
  return {
    sourceLanguageCode: row.source_language_code as SourceCoverage['sourceLanguageCode'],
    status: row.status as SourceCoverage['status'],
    metrics: metrics as SourceCoverage['metrics'],
    nativeReviewed: row.native_reviewed,
    reviewedAt: row.reviewed_at,
    editorialNoteKey: row.editorial_note_key,
    fallbackSourceLanguageCode: (row.fallback_source_language_code as SourceCoverage['fallbackSourceLanguageCode']) ?? null,
  };
}

/** A `planned` coverage row for pairs the catalog has not seeded yet (honest, never "complete"). */
export const plannedCoverage = (sourceLanguageCode: string): SourceCoverage => ({
  sourceLanguageCode: sourceLanguageCode as SourceCoverage['sourceLanguageCode'],
  status: 'planned',
  metrics: DEFAULT_METRICS as SourceCoverage['metrics'],
  nativeReviewed: false,
  reviewedAt: null,
  editorialNoteKey: 'enrollment.coverage.detail.planned',
  fallbackSourceLanguageCode: null,
});

/**
 * `capabilities` (CONVENTIONS §8) is attached by every learner route through `courseCapabilitiesFor`; the parameter
 * is optional only so existing callers/tests keep compiling — API responses always carry it.
 */
export function enrollmentToDto(row: Row<'user_course_enrollments'>, coverage: CoverageRow | null, capabilities?: CourseCapabilities): EnrollmentDto {
  if (!isCourseTrackId(row.course_track_id)) throw problem.internal(`Enrollment references unknown track ${row.course_track_id}`);
  const track = getCourseTrack(row.course_track_id);
  const cov = coverage ? coverageToDto(coverage) : plannedCoverage(row.source_language_code);
  return EnrollmentDtoSchema.parse({
    id: row.id,
    courseTrackId: row.course_track_id,
    sourceLanguageCode: row.source_language_code,
    targetVarietyId: track.targetVarietyId,
    preferredTargetVariantId: row.preferred_target_variant_id,
    regionalPreference: row.regional_preference,
    scriptMode: row.script_mode,
    learnerLevel: row.learner_level,
    status: row.status,
    preferredLearningSpeed: row.preferred_learning_speed,
    activeMissionId: row.active_mission_id,
    translationPeekLanguageCode: row.translation_peek_language_code,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    coverage: { status: cov.status, nativeReviewed: cov.nativeReviewed, editorialNoteKey: cov.editorialNoteKey, fallbackSourceLanguageCode: cov.fallbackSourceLanguageCode },
    capabilities,
  });
}

export const parsePrivacy = (value: unknown) => PrivacyOptionsSchema.parse(value ?? {});
export const parseAccessibility = (value: unknown) => AccessibilityOptionsSchema.parse(value ?? {});

export function mediaAssetToRef(asset: MediaAssetPublicRow, publicUrl: string | null = null): AssetRef {
  return lazyAssetRef({ id: asset.id, kind: asset.kind as AssetRef['kind'], checksumSha256: asset.checksum_sha256, byteLength: asset.byte_length, mimeType: asset.mime_type, durationMs: asset.duration_ms, visibility: asset.visibility as 'private' | 'authenticated' | 'public', publicUrl });
}

export function visualAssetToRef(v: Row<'visual_assets'>, publicUrl: string | null): VisualRef | null {
  if (v.review_status !== 'approved') return null;
  return {
    assetId: v.id,
    kind: 'image',
    contentHash: v.content_hash,
    byteLength: v.byte_length,
    mimeType: v.mime_type,
    durationMs: null,
    publicUrl,
    altTextKey: v.alt_text_key,
    visualType: v.type,
  } as VisualRef;
}

/** `user_expression_reviews` row → contracts `ReviewCard`. */
export function reviewRowToCard(row: Row<'user_expression_reviews'>): ReviewCard {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    targetKind: row.expression_id ? 'expression' : 'skill',
    targetId: row.expression_id ?? row.skill_key ?? '',
    state: row.card_state as ReviewCard['state'],
    memory: { stability: row.stability, difficulty: row.difficulty, retrievability: row.retrievability },
    due: row.next_due_at,
    lastReviewedAt: row.last_reviewed_at,
    reps: row.reps,
    lapses: row.lapses,
    scheduledDays: row.scheduled_days,
    elapsedDays: row.elapsed_days,
    recentScenarioIds: row.recent_scenario_ids,
  };
}

/** Contracts `ReviewCard` → `user_expression_reviews` patch (ids/enrollment never change). */
export function cardToReviewPatch(card: ReviewCard, extra: { lastRating: string | null; lastHintCount: number; schedulerVersion: string }) {
  return {
    card_state: card.state,
    stability: card.memory.stability,
    difficulty: card.memory.difficulty,
    retrievability: card.memory.retrievability,
    reps: card.reps,
    lapses: card.lapses,
    scheduled_days: card.scheduledDays,
    elapsed_days: card.elapsedDays,
    last_rating: extra.lastRating,
    last_hint_count: extra.lastHintCount,
    last_reviewed_at: card.lastReviewedAt,
    next_due_at: card.due,
    recent_scenario_ids: card.recentScenarioIds,
    scheduler_version: extra.schedulerVersion,
  };
}

export const assertSourceLanguage = (code: string): asserts code is SourceLanguageCode => {
  if (!isSourceLanguageCode(code)) throw problem.validation(`Unknown source language ${code}`);
};
