/**
 * §6.1 public catalog: `/v1/languages` (static catalog constants), `/v1/courses` (published tracks with honest
 * per-source coverage and live capability snapshot) and `/v1/courses/:trackId/coverage`.
 * No learner data is involved; responses carry a short public cache TTL.
 */
import { COURSE_TRACKS, CourseTrackIdSchema, CoursesQuerySchema, CoverageQuerySchema, CoverageResponseSchema, CoursesResponseSchema, LANGUAGES, LANGUAGE_CODES, LANGUAGE_VARIETIES, LanguagesResponseSchema, SOURCE_LANGUAGES, WRITING_SYSTEMS, type CourseSummary, type SourceCoverage } from '@langquest/contracts';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseParams, parseQuery } from '../../http/validate';
import { trackCapabilitySummary } from '../../lib/capabilities';
import { coverageToDto, COVERAGE_COLUMNS, plannedCoverage, type CoverageRow } from '../../lib/dto';
import type { RequestServices } from '../../services/context';

const PUBLIC_CACHE = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' };

const languagesPayload = LanguagesResponseSchema.parse({
  languages: LANGUAGES,
  varieties: LANGUAGE_VARIETIES,
  writingSystems: WRITING_SYSTEMS,
  tracks: COURSE_TRACKS,
  sourceLanguages: SOURCE_LANGUAGES,
});

interface TrackCounts {
  missions: Map<string, number>;
  audioLessons: Map<string, number>;
  characters: Map<string, number>;
}

/**
 * Published-content counts per track (public information; one query per table, grouped in memory).
 *
 * A mission counts only when a learner can actually reach it through the course manifest: published
 * `lesson_courses → chapters → missions`. Orphan or template rows (`chapter_id` null) and missions under an
 * unpublished chapter/course never count, and the track is the one the course belongs to — so two tracks sharing
 * a variety (`chinese-simplified` / `chinese-mandarin`) each report their own missions.
 */
async function loadTrackCounts(s: RequestServices): Promise<TrackCounts> {
  const [missions, lessons, characters] = await Promise.all([
    s.service.from('missions').select('id, chapters!inner(state, lesson_courses!inner(course_track_id, state))').eq('state', 'published').eq('chapters.state', 'published').eq('chapters.lesson_courses.state', 'published'),
    s.service.from('audio_lessons').select('id, audio_chapters!inner(collection_id, audio_course_collections!inner(course_track_id))').eq('state', 'published'),
    s.service.from('characters').select('target_variety_id').eq('state', 'published'),
  ]);
  const count = (rows: { key: string | null }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.key) m.set(r.key, (m.get(r.key) ?? 0) + 1);
    return m;
  };
  const byVarietyToTracks = (m: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const t of COURSE_TRACKS) out.set(t.id, m.get(t.targetVarietyId) ?? 0);
    return out;
  };
  const lessonRows = ((lessons.data ?? []) as unknown as { audio_chapters: { audio_course_collections: { course_track_id: string | null } | null } | null }[]).map((r) => ({ key: r.audio_chapters?.audio_course_collections?.course_track_id ?? null }));
  const missionRows = ((missions.data ?? []) as unknown as { chapters: { lesson_courses: { course_track_id: string | null } | null } | null }[]).map((r) => ({ key: r.chapters?.lesson_courses?.course_track_id ?? null }));
  return {
    missions: count(missionRows),
    audioLessons: count(lessonRows),
    characters: byVarietyToTracks(count((characters.data ?? []).map((r) => ({ key: r.target_variety_id })))),
  };
}

export async function loadCoverageRows(s: RequestServices, trackIds: string[] | null, source: string | null): Promise<CoverageRow[]> {
  let q = s.service.from('course_source_localizations').select(COVERAGE_COLUMNS);
  if (trackIds) q = q.in('course_track_id', trackIds);
  if (source) q = q.eq('source_language_code', source);
  const res = await q;
  if (res.error) throw problem.internal('Could not read coverage');
  return res.data as CoverageRow[];
}

function coverageFor(rows: CoverageRow[], trackId: string, source: string | null): SourceCoverage[] {
  const own = rows.filter((r) => r.course_track_id === trackId).map(coverageToDto);
  if (source) return own.length ? own : [plannedCoverage(source)];
  const present = new Set(own.map((c) => c.sourceLanguageCode));
  return [...own, ...LANGUAGE_CODES.filter((code) => !present.has(code)).map(plannedCoverage)];
}

export function registerCatalogRoutes(define: DefineRoute): void {
  define('languages', {}, async (c) => respondOk(c, languagesPayload, 200, PUBLIC_CACHE));

  define('courses', {}, async (c) => {
    const query = parseQuery(c, CoursesQuerySchema);
    const s = c.get('services')!;
    const tracksRes = await s.service.from('course_tracks').select('id, publication_state').order('sort_order');
    if (tracksRes.error) throw problem.internal('Could not read course tracks');
    const stateById = new Map(tracksRes.data.map((t) => [t.id, t.publication_state]));
    const tracks = COURSE_TRACKS.filter((t) => !query.target || t.targetVarietyId === query.target);
    const [counts, coverage] = await Promise.all([loadTrackCounts(s), loadCoverageRows(s, tracks.map((t) => t.id), query.source ?? null)]);
    const azure = Boolean(s.config.env.AZURE_SPEECH_KEY && s.config.env.AZURE_SPEECH_REGION);
    const openRouter = Boolean(s.config.env.OPENROUTER_API_KEY);
    const courses: CourseSummary[] = tracks.map((track) => {
      const state = stateById.get(track.id);
      return {
        track,
        publicationState: state === 'published' ? 'published' : state === 'review_needed' || state === 'approved' ? 'in_review' : 'coming_soon',
        coverArt: null,
        coverage: coverageFor(coverage, track.id, query.source ?? null),
        publishedMissionCount: counts.missions.get(track.id) ?? 0,
        publishedAudioLessonCount: counts.audioLessons.get(track.id) ?? 0,
        characterCount: counts.characters.get(track.id) ?? 0,
        capabilities: trackCapabilitySummary(track.id, azure, openRouter),
      };
    });
    return respondOk(c, CoursesResponseSchema.parse({ courses }), 200, PUBLIC_CACHE);
  });

  define('courseCoverage', {}, async (c) => {
    const { trackId } = parseParams(c, z.object({ trackId: CourseTrackIdSchema }));
    const query = parseQuery(c, CoverageQuerySchema);
    const rows = await loadCoverageRows(c.get('services')!, [trackId], query.source ?? null);
    return respondOk(c, CoverageResponseSchema.parse({ courseTrackId: trackId, coverage: coverageFor(rows, trackId, query.source ?? null) }), 200, PUBLIC_CACHE);
  });
}
