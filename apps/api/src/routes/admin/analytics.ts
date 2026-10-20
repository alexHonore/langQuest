/**
 * §6.4 analytics (§12.2): aggregations over `ai_requests` (cost, provider failures), content tables (quality,
 * rights coverage), enrollments/sessions/attempts (usage) and processing jobs. Every number is computed from
 * stored rows; metrics the platform does not record yet are returned as `null` (never estimated).
 * Cost anomalies use the telemetry `CostAnomalyDetector` over the daily series.
 *
 * Reads stay exact past PostgREST's row cap. PostgREST answers at most `max_rows` rows per request
 * (`supabase/config.toml` `[api] max_rows = 1000`) whatever `limit` asks for, so a plain `select` silently stops at
 * 1000 rows. Here:
 * - pure counts are `count=exact` HEAD queries: exact at any volume, one request each;
 * - row reads page through `range()` windows of `ANALYTICS_PAGE_ROWS`, ordered by primary key; the first page also
 *   returns the exact total, so the reader knows how many pages exist;
 * - the extra pages one panel request may fetch are bounded (`ANALYTICS_EXTRA_PAGE_BUDGET`: every page is a Worker
 *   subrequest) and shared by water-filling, so small reads always complete and only the largest ones can be cut;
 * - a read that hits the bound (or receives short pages) is named in the `x-langquest-analytics-truncated` response
 *   header as `read=fetched/total` and logged as `analytics.truncated`; no header means every number was computed
 *   from every matching row;
 * - track / source scope comes from each row's embedded enrollment (one join in SQL, no id lookups);
 * - a failed read is a 500, never a zero that looks measured.
 */
import { capabilityFromStatus } from '@langquest/ai/capability/registry';
import { capabilityForTrack } from '@langquest/ai/capability/matrix';
import { AnalyticsCostResponseSchema, AnalyticsErrorsResponseSchema, AnalyticsQualityResponseSchema, AnalyticsQuerySchema, AnalyticsUsageResponseSchema, COURSE_TRACKS, isCourseTrackId, type AiTaskName, type AnalyticsQuery, type CourseTrackId } from '@langquest/contracts';
import { CostAnomalyDetector, dayBucket } from '@langquest/telemetry/cost';
import type { Context } from 'hono';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseQuery } from '../../http/validate';
import type { RequestServices } from '../../services/context';
import type { AppEnv } from '../../types';

const DAY_MS = 86_400_000;

/** PostgREST `max_rows` (`supabase/config.toml`): the most rows one request returns, whatever `limit` asks for. */
export const ANALYTICS_PAGE_ROWS = 1000;
/**
 * Pages one panel request may fetch beyond the first page of each of its reads. Every page is a Worker subrequest
 * (Workers Free allows 50 per request); with the fixed count queries, the first pages and the auth lookups a panel
 * stays under that limit. Rows past the bound are reported through `ANALYTICS_TRUNCATED_HEADER`, never dropped silently.
 */
export const ANALYTICS_EXTRA_PAGE_BUDGET = 25;
/** Response header naming every read that hit the page bound, as `read=fetched/total` (comma separated). */
export const ANALYTICS_TRUNCATED_HEADER = 'x-langquest-analytics-truncated';

// ---------------------------------------------------------------------------------------------------------------
// Bounded, exact reads
// ---------------------------------------------------------------------------------------------------------------

interface PageWindow {
  from: number;
  to: number;
  /** Only the first page asks PostgREST for the exact total. */
  count: boolean;
}
interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}
/** One page of a read: the caller's query with `.order(<primary key>).range(window.from, window.to)` applied. */
type PageQuery<T> = (window: PageWindow) => PromiseLike<PageResult<T>>;
type RowOf<Q> = Q extends PageQuery<infer T> ? T : never;
interface RowSet<T> {
  rows: T[];
  /** Exact number of matching rows (PostgREST `count=exact`), even when `rows` is cut. */
  total: number;
  truncated: boolean;
}
type RowSets<Q extends Record<string, PageQuery<unknown>>> = { [K in keyof Q]: RowSet<RowOf<Q[K]>> };

/** `select()` options for one page. */
const counted = (w: PageWindow) => (w.count ? { count: 'exact' as const } : {});
/** A read the panel does not need under the current filters: no request, no rows. */
const skipRead =
  <T>(): PageQuery<T> =>
  () =>
    Promise.resolve({ data: [], error: null, count: 0 });

function readFailed(s: RequestServices, read: string, error: string) {
  s.log.error('analytics.read_failed', { read, error });
  return problem.internal('Could not read the rows behind this analytics panel');
}

/** Exact row count (`count=exact`, HEAD). A failed count is an error, never a measured zero. */
async function countOf(s: RequestServices, read: string, query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const res = await query;
  if (res.error || res.count === null) throw readFailed(s, read, res.error?.message ?? 'no exact count returned');
  return res.count;
}

/**
 * Splits `budget` extra pages over reads that need `need[i]` each (water-filling): the smallest needs are served
 * first and no read takes more than an even share of what is left, so the cut always lands on the largest reads.
 */
export function allocatePages(need: readonly number[], budget: number): number[] {
  const grant = need.map(() => 0);
  let left = Math.max(0, Math.floor(budget));
  const order = need.map((_, i) => i).sort((a, b) => need[a]! - need[b]! || a - b);
  order.forEach((i, k) => {
    const take = Math.min(Math.max(0, need[i]!), Math.floor(left / (order.length - k)));
    grant[i] = take;
    left -= take;
  });
  return grant;
}

/**
 * Reads every matching row of each query, page by page, within one shared page budget. The first page of every
 * read runs in parallel and carries the exact total; the remaining pages are allotted by `allocatePages` and also
 * run in parallel. A read is `truncated` when it holds fewer rows than its total (bound reached, or the server
 * returned shorter pages than asked for).
 */
async function readPages<const Q extends Record<string, PageQuery<unknown>>>(s: RequestServices, queries: Q, budget = ANALYTICS_EXTRA_PAGE_BUDGET): Promise<RowSets<Q>> {
  const names = Object.keys(queries);
  const page = async (name: string, index: number) => {
    const from = index * ANALYTICS_PAGE_ROWS;
    const res = await queries[name]!({ from, to: from + ANALYTICS_PAGE_ROWS - 1, count: index === 0 });
    if (res.error) throw readFailed(s, name, res.error.message);
    if (index === 0 && (res.count === null || res.count === undefined)) throw readFailed(s, name, 'no exact count returned');
    return { rows: res.data ?? [], count: res.count ?? 0 };
  };
  const first = await Promise.all(names.map((name) => page(name, 0)));
  const grant = allocatePages(
    first.map((p) => Math.max(0, Math.ceil(p.count / ANALYTICS_PAGE_ROWS) - 1)),
    budget,
  );
  const rest = await Promise.all(names.map((name, i) => Promise.all(Array.from({ length: grant[i]! }, (_, k) => page(name, k + 1)))));
  const out: Record<string, RowSet<unknown>> = {};
  names.forEach((name, i) => {
    const rows = first[i]!.rows.concat(...rest[i]!.map((p) => p.rows));
    const total = Math.max(first[i]!.count, rows.length);
    out[name] = { rows, total, truncated: rows.length < total };
  });
  return out as RowSets<Q>;
}

/** Response headers for a panel: names the reads that hit the bound (and logs them), or nothing when all are exact. */
function truncationHeaders(s: RequestServices, panel: string, reads: Record<string, RowSet<unknown>>): Record<string, string> | undefined {
  const cut = Object.entries(reads)
    .filter(([, set]) => set.truncated)
    .map(([name, set]) => `${name}=${set.rows.length}/${set.total}`);
  if (!cut.length) return undefined;
  s.log.warn('analytics.truncated', { panel, reads: cut, pageRows: ANALYTICS_PAGE_ROWS, extraPageBudget: ANALYTICS_EXTRA_PAGE_BUDGET });
  return { [ANALYTICS_TRUNCATED_HEADER]: cut.join(', ') };
}

// ---------------------------------------------------------------------------------------------------------------
// Periods and filters
// ---------------------------------------------------------------------------------------------------------------

function periodOf(ts: string, granularity: AnalyticsQuery['granularity']): string {
  const d = new Date(ts);
  if (granularity === 'month') return `${d.toISOString().slice(0, 7)}-01`;
  if (granularity === 'week') {
    const day = (d.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    return monday.toISOString().slice(0, 10);
  }
  return dayBucket(d);
}

function periods(q: AnalyticsQuery): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let t = Date.parse(q.from); t <= Date.parse(q.to); t += DAY_MS) {
    const p = periodOf(new Date(t).toISOString(), q.granularity);
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

const series = <T>(q: AnalyticsQuery, fill: (period: string) => T) => periods(q).map((period) => ({ period, value: fill(period) }));
const sumBy = (rows: { period: string; value: number }[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.period, (m.get(r.period) ?? 0) + r.value);
  return m;
};
const toIso = (date: string, end = false) => `${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`;
const ratio = (num: number, den: number): number | null => (den > 0 ? Math.min(1, num / den) : null);

/** The enrollment embedded on a row (`user_course_enrollments(course_track_id, source_language_code)`), or null. */
interface EnrollmentScope {
  course_track_id: string;
  source_language_code: string;
}

const isScoped = (q: AnalyticsQuery): boolean => Boolean(q.trackId || q.sourceLanguage);
/** A row tied to an enrollment matches the track / source filters (rows without one never match a filter). */
const inScope = (scope: EnrollmentScope | null | undefined, q: AnalyticsQuery): boolean => Boolean(scope) && (!q.trackId || scope!.course_track_id === q.trackId) && (!q.sourceLanguage || scope!.source_language_code === q.sourceLanguage);

/** Every panel validates the same way: a reversed range is a client error, never an empty "all zero" report. */
function parseAnalyticsQuery(c: Context<AppEnv>): AnalyticsQuery {
  const q = parseQuery(c, AnalyticsQuerySchema);
  if (q.from > q.to) throw problem.validation('from must be before to');
  return q;
}

const MEDIA_JOB_TYPES = ['transcode', 'verify', 'extract_metadata'];
const UNHEALTHY_JOB_STATES = ['failed', 'review_needed'];

export function registerAnalyticsRoutes(define: DefineRoute): void {
  define('adminAnalyticsQuality', {}, async (c) => {
    const q = parseAnalyticsQuery(c);
    const s = c.get('services')!;
    const [[exprTotal, exprReviewed, assetsTotal, assetsRights, quarantined, takedownReports], reads] = await Promise.all([
      Promise.all([
        countOf(s, 'expressions', s.service.from('expressions').select('id', { count: 'exact', head: true }).in('state', ['approved', 'published'])),
        countOf(s, 'expressions_reviewed', s.service.from('expressions').select('id', { count: 'exact', head: true }).in('state', ['approved', 'published']).eq('reviewed', true)),
        countOf(s, 'media_assets', s.service.from('media_assets').select('id', { count: 'exact', head: true }).eq('disposition', 'active')),
        // Two FKs link these tables (`media_assets.content_rights_id` and `content_rights.evidence_asset_id`); an
        // embed that does not name one is refused by PostgREST (PGRST201), so the many-to-one column is named.
        countOf(s, 'media_assets_rights_verified', s.service.from('media_assets').select('id, content_rights!content_rights_id!inner(verified)', { count: 'exact', head: true }).eq('disposition', 'active').eq('content_rights.verified', true)),
        countOf(s, 'media_assets_quarantined', s.service.from('media_assets').select('id', { count: 'exact', head: true }).eq('disposition', 'quarantined')),
        countOf(s, 'feedback_reports_takedown', s.service.from('feedback_reports').select('id', { count: 'exact', head: true }).eq('status', 'open').in('category', ['offensive', 'wrong_dialect'])),
      ]),
      readPages(s, {
        course_source_localizations: (w) => s.service.from('course_source_localizations').select('course_track_id, source_language_code, metrics', counted(w)).order('id').range(w.from, w.to),
        feedback_reports_false_correction: (w) =>
          s.service.from('feedback_reports').select('course_track_id, user_course_enrollments(course_track_id)', counted(w)).eq('status', 'open').eq('category', 'false_correction').order('id').range(w.from, w.to),
        mission_progress: (w) =>
          s.service
            .from('mission_progress')
            .select('first_completed_at, completed_without_hints', counted(w))
            .gte('first_completed_at', toIso(q.from))
            .lte('first_completed_at', toIso(q.to, true))
            .order('id')
            .range(w.from, w.to),
        transcript_segments: (w) => s.service.from('transcript_segments').select('confidence', counted(w)).not('confidence', 'is', null).order('id').range(w.from, w.to),
        user_course_enrollments: (w) => {
          let b = s.service.from('user_course_enrollments').select('course_track_id', counted(w));
          if (q.trackId) b = b.eq('course_track_id', q.trackId);
          return b.order('id').range(w.from, w.to);
        },
      }),
    ]);
    const tracks = COURSE_TRACKS.filter((t) => !q.trackId || t.id === q.trackId);
    const liveCapabilityByTrack = tracks.flatMap((t) => {
      const cap = capabilityForTrack(t.id);
      const entries: { task: AiTaskName; status: typeof cap.stt.status; evidence: string }[] = [
        { task: 'speech_recognition', status: cap.stt.status, evidence: cap.stt.evidence },
        { task: 'speech_synthesis', status: cap.tts.status, evidence: cap.tts.evidence },
        { task: 'realtime_conversation', status: cap.realtimePipeline.status, evidence: cap.realtimePipeline.evidence },
        { task: 'pronunciation_assessment', status: cap.pronunciation.phoneme.status, evidence: cap.pronunciation.phoneme.evidence },
      ];
      return entries.map((e) => ({ trackId: t.id, task: e.task, capability: capabilityFromStatus({ provider: e.task === 'pronunciation_assessment' ? 'azure_speech' : 'openrouter', status: e.status, effectiveLocale: t.defaultLocale, latencyClass: 'interactive', evidence: e.evidence }) }));
    });
    const completions = reads.mission_progress.rows.map((p) => ({ period: periodOf(p.first_completed_at!, q.granularity), value: 1, noHints: p.completed_without_hints }));
    const totalByPeriod = sumBy(completions);
    const noHintsByPeriod = sumBy(completions.filter((x) => x.noHints));
    const enrollmentsByTrack = new Map<string, number>();
    for (const e of reads.user_course_enrollments.rows) enrollmentsByTrack.set(e.course_track_id, (enrollmentsByTrack.get(e.course_track_id) ?? 0) + 1);
    const falseCorrectionsByTrack = new Map<string, number>();
    for (const r of reads.feedback_reports_false_correction.rows) {
      const trackId = r.course_track_id ?? r.user_course_enrollments?.course_track_id ?? null;
      if (trackId) falseCorrectionsByTrack.set(trackId, (falseCorrectionsByTrack.get(trackId) ?? 0) + 1);
    }
    const confidences = reads.transcript_segments.rows.map((x) => x.confidence).filter((v): v is number => typeof v === 'number');
    return respondOk(
      c,
      AnalyticsQualityResponseSchema.parse({
        nativeReviewedFraction: ratio(exprReviewed, exprTotal) ?? 0,
        rightsCoverageFraction: ratio(assetsRights, assetsTotal) ?? 0,
        localizationCoverageBySource: reads.course_source_localizations.rows
          .filter((r) => isCourseTrackId(r.course_track_id) && (!q.trackId || r.course_track_id === q.trackId) && (!q.sourceLanguage || r.source_language_code === q.sourceLanguage))
          .map((r) => ({ sourceLanguage: r.source_language_code, trackId: r.course_track_id, pct: Math.max(0, Math.min(100, Number((r.metrics as { mission_instructions_pct?: number } | null)?.mission_instructions_pct ?? 0))) })),
        liveCapabilityByTrack,
        unresolvedTakedowns: quarantined + takedownReports,
        transcriptAlignmentQuality: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
        falseCorrectionRateByTrack: tracks.map((t) => {
          const total = enrollmentsByTrack.get(t.id) ?? 0;
          return { trackId: t.id, rate: total > 0 ? Math.min(1, (falseCorrectionsByTrack.get(t.id) ?? 0) / total) : null };
        }),
        missionCompletionWithoutHints: series(q, (p) => ratio(noHintsByPeriod.get(p) ?? 0, totalByPeriod.get(p) ?? 0) ?? 0),
        recall7Day: series(q, () => null),
        recall30Day: series(q, () => null),
      }),
      200,
      truncationHeaders(s, 'quality', reads),
    );
  });

  define('adminAnalyticsCost', {}, async (c) => {
    const q = parseAnalyticsQuery(c);
    const s = c.get('services')!;
    const scoped = isScoped(q);
    /** "Meaningful conversation" filter, shared by the scoped read and the unscoped count so both divide like by like. */
    const finishedSessions = <B extends { eq: (col: 'state', v: string) => B; gte: (col: 'ended_at', v: string) => B; lte: (col: 'ended_at', v: string) => B; gt: (col: 'turn_count', v: number) => B }>(b: B) => b.eq('state', 'finished').gte('ended_at', toIso(q.from)).lte('ended_at', toIso(q.to, true)).gt('turn_count', 2);
    const [reads, unscopedConversations, reviewedTranscripts] = await Promise.all([
      readPages(s, {
        ai_requests: (w) =>
          s.service
            .from('ai_requests')
            .select('task, provider, input_tokens, output_tokens, audio_seconds, estimated_cost_usd, user_id, created_at, user_course_enrollments(course_track_id, source_language_code)', counted(w))
            .gte('created_at', toIso(q.from))
            .lte('created_at', toIso(q.to, true))
            .order('id')
            .range(w.from, w.to),
        media_assets: (w) => s.service.from('media_assets').select('byte_length', counted(w)).eq('disposition', 'active').order('id').range(w.from, w.to),
        // Under a filter the per-conversation cost divides in-scope cost by in-scope sessions, so the sessions are read.
        conversation_sessions: scoped
          ? (w) => finishedSessions(s.service.from('conversation_sessions').select('user_course_enrollments(course_track_id, source_language_code)', counted(w))).order('id').range(w.from, w.to)
          : skipRead<{ user_course_enrollments: EnrollmentScope | null }>(),
      }),
      scoped ? Promise.resolve(0) : countOf(s, 'conversation_sessions', finishedSessions(s.service.from('conversation_sessions').select('id', { count: 'exact', head: true }))),
      // Alignment cost and reviewed transcripts are not tied to an enrollment: only the unscoped view has a per-lesson figure.
      scoped ? Promise.resolve(0) : countOf(s, 'transcripts', s.service.from('transcripts').select('id', { count: 'exact', head: true }).in('qa_state', ['reviewed', 'approved']).gte('updated_at', toIso(q.from)).lte('updated_at', toIso(q.to, true))),
    ]);
    // Numerator and denominator of every per-unit cost share the same scope: in-scope cost over in-scope sessions.
    const rows = scoped ? reads.ai_requests.rows.filter((r) => inScope(r.user_course_enrollments, q)) : reads.ai_requests.rows;
    const conversations = scoped ? reads.conversation_sessions.rows.filter((r) => inScope(r.user_course_enrollments, q)).length : unscopedConversations;
    const usd = (r: { estimated_cost_usd: number | null }) => Number(r.estimated_cost_usd ?? 0);
    const totalUsd = rows.reduce((n, r) => n + usd(r), 0);
    const byTaskMap = new Map<string, { requests: number; tokens: number; audioSeconds: number; usd: number }>();
    const byProviderMap = new Map<string, number>();
    for (const r of rows) {
      const t = byTaskMap.get(r.task) ?? { requests: 0, tokens: 0, audioSeconds: 0, usd: 0 };
      t.requests += 1;
      t.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
      t.audioSeconds += Number(r.audio_seconds ?? 0);
      t.usd += usd(r);
      byTaskMap.set(r.task, t);
      byProviderMap.set(r.provider, (byProviderMap.get(r.provider) ?? 0) + usd(r));
    }
    const timelineMap = sumBy(rows.map((r) => ({ period: periodOf(r.created_at, q.granularity), value: usd(r) })));
    const activeLearners = new Set(rows.map((r) => r.user_id).filter((v): v is string => v !== null)).size;
    const conversationUsd = rows.filter((r) => r.task === 'character_dialogue' || r.task === 'speech_recognition' || r.task === 'speech_synthesis' || r.task === 'learner_evaluation').reduce((n, r) => n + usd(r), 0);
    const transcriptionUsd = rows.filter((r) => r.task === 'transcription_alignment').reduce((n, r) => n + usd(r), 0);
    return respondOk(
      c,
      AnalyticsCostResponseSchema.parse({
        totalUsd,
        byTask: [...byTaskMap.entries()].map(([task, v]) => ({ task, ...v })),
        byProvider: [...byProviderMap.entries()].map(([provider, usdValue]) => ({ provider, usd: usdValue })),
        storageGb: reads.media_assets.rows.reduce((n, a) => n + Number(a.byte_length), 0) / 1e9,
        r2Operations: 0,
        estimatedUsdPerActiveLearner: activeLearners > 0 ? totalUsd / activeLearners : null,
        usdPerMeaningfulConversation: conversations > 0 ? conversationUsd / conversations : null,
        // Alignment cost and reviewed transcripts are not tied to an enrollment, so a track / source filter has no honest
        // per-lesson figure (the scoped numerator would always read $0): null, never estimated.
        usdPerReviewedLesson: !scoped && reviewedTranscripts > 0 ? transcriptionUsd / reviewedTranscripts : null,
        timeline: series(q, (p) => timelineMap.get(p) ?? 0),
        reconciliation: { invoicedUsd: null, deltaUsd: null, asOf: null },
      }),
      200,
      truncationHeaders(s, 'cost', reads),
    );
  });

  define('adminAnalyticsUsage', {}, async (c) => {
    const q = parseAnalyticsQuery(c);
    const s = c.get('services')!;
    const scoped = isScoped(q);
    const reads = await readPages(s, {
      streak_activity: (w) => s.service.from('streak_activity').select('user_id, activity_date, minutes_active, speaking_seconds', counted(w)).gte('activity_date', q.from).lte('activity_date', q.to).order('id').range(w.from, w.to),
      conversation_sessions: (w) =>
        s.service
          .from('conversation_sessions')
          .select('started_at, ended_at, user_course_enrollments(course_track_id, source_language_code)', counted(w))
          .gte('started_at', toIso(q.from))
          .lte('started_at', toIso(q.to, true))
          .order('id')
          .range(w.from, w.to),
      mission_attempts: (w) =>
        s.service
          .from('mission_attempts')
          .select('completed_at, user_course_enrollments(course_track_id, source_language_code)', counted(w))
          .gte('completed_at', toIso(q.from))
          .lte('completed_at', toIso(q.to, true))
          .order('id')
          .range(w.from, w.to),
      user_audio_progress: (w) => s.service.from('user_audio_progress').select('updated_at, position_ms', counted(w)).gte('updated_at', toIso(q.from)).lte('updated_at', toIso(q.to, true)).order('id').range(w.from, w.to),
      user_download_manifests: (w) =>
        s.service
          .from('user_download_manifests')
          .select('downloaded_at', counted(w))
          .not('downloaded_at', 'is', null)
          .gte('downloaded_at', toIso(q.from))
          .lte('downloaded_at', toIso(q.to, true))
          .order('id')
          .range(w.from, w.to),
      // Per-track figures count ACTIVE enrollments only; the track / source filters run in SQL.
      user_course_enrollments: (w) => {
        let b = s.service.from('user_course_enrollments').select('user_id, course_track_id, source_language_code', counted(w)).eq('status', 'active');
        if (q.trackId) b = b.eq('course_track_id', q.trackId);
        if (q.sourceLanguage) b = b.eq('source_language_code', q.sourceLanguage);
        return b.order('id').range(w.from, w.to);
      },
      profiles: (w) => s.service.from('profiles').select('user_id, created_at', counted(w)).gte('created_at', toIso(q.from)).lte('created_at', toIso(q.to, true)).order('user_id').range(w.from, w.to),
    });
    const filterByEnrollment = <T extends { user_course_enrollments: EnrollmentScope | null }>(rows: T[]) => (scoped ? rows.filter((r) => inScope(r.user_course_enrollments, q)) : rows);
    const streaks = reads.streak_activity.rows;
    const activeByPeriod = new Map<string, Set<string>>();
    const activeDays = new Map<string, string[]>();
    for (const r of streaks) {
      if (r.minutes_active <= 0) continue;
      const p = periodOf(toIso(r.activity_date), q.granularity);
      activeByPeriod.set(p, (activeByPeriod.get(p) ?? new Set()).add(r.user_id));
      const days = activeDays.get(r.user_id);
      if (days) days.push(r.activity_date);
      else activeDays.set(r.user_id, [r.activity_date]);
    }
    // Concurrent voice sessions: sweep the start / end events of the sessions that started in each period.
    const eventsByPeriod = new Map<string, { t: number; d: number }[]>();
    for (const sess of filterByEnrollment(reads.conversation_sessions.rows)) {
      const p = periodOf(sess.started_at, q.granularity);
      const events = eventsByPeriod.get(p) ?? [];
      events.push({ t: Date.parse(sess.started_at), d: 1 }, { t: Date.parse(sess.ended_at ?? sess.started_at) + 1, d: -1 });
      eventsByPeriod.set(p, events);
    }
    const peakByPeriod = new Map<string, number>();
    for (const [p, events] of eventsByPeriod) {
      events.sort((a, b) => a.t - b.t || a.d - b.d);
      let cur = 0;
      let peak = 0;
      for (const e of events) {
        cur += e.d;
        peak = Math.max(peak, cur);
      }
      peakByPeriod.set(p, peak);
    }
    const missionsByPeriod = sumBy(filterByEnrollment(reads.mission_attempts.rows).map((a) => ({ period: periodOf(a.completed_at!, q.granularity), value: 1 })));
    const speakingByPeriod = sumBy(streaks.map((r) => ({ period: periodOf(toIso(r.activity_date), q.granularity), value: r.speaking_seconds })));
    const listenByPeriod = sumBy(reads.user_audio_progress.rows.map((a) => ({ period: periodOf(a.updated_at, q.granularity), value: Math.round(a.position_ms / 1000) })));
    const downloadsByPeriod = sumBy(reads.user_download_manifests.rows.map((d) => ({ period: periodOf(d.downloaded_at!, q.granularity), value: 1 })));
    const retention = (days: number): number | null => {
      const cohort = reads.profiles.rows.filter((p) => Date.parse(p.created_at) + days * DAY_MS <= Date.now());
      if (!cohort.length) return null;
      const retained = cohort.filter((p) => (activeDays.get(p.user_id) ?? []).some((d) => Date.parse(d) >= Date.parse(p.created_at) + days * DAY_MS)).length;
      return retained / cohort.length;
    };
    const activeByTrack = new Map<string, { learners: Set<string>; bySource: Map<string, number> }>();
    for (const e of reads.user_course_enrollments.rows) {
      const t = activeByTrack.get(e.course_track_id) ?? { learners: new Set<string>(), bySource: new Map<string, number>() };
      t.learners.add(e.user_id);
      t.bySource.set(e.source_language_code, (t.bySource.get(e.source_language_code) ?? 0) + 1);
      activeByTrack.set(e.course_track_id, t);
    }
    const byTrack = COURSE_TRACKS.filter((t) => !q.trackId || t.id === q.trackId).map((t) => {
      const active = activeByTrack.get(t.id);
      return { trackId: t.id, activeLearners: active?.learners.size ?? 0, enrollmentsBySource: [...(active?.bySource ?? new Map<string, number>()).entries()].map(([sourceLanguage, count]) => ({ sourceLanguage, count })) };
    });
    return respondOk(
      c,
      AnalyticsUsageResponseSchema.parse({
        activeLearners: series(q, (p) => activeByPeriod.get(p)?.size ?? 0),
        concurrentVoiceSessionsPeak: series(q, (p) => peakByPeriod.get(p) ?? 0),
        missionsCompleted: series(q, (p) => missionsByPeriod.get(p) ?? 0),
        speakingSeconds: series(q, (p) => speakingByPeriod.get(p) ?? 0),
        audioListenSeconds: series(q, (p) => listenByPeriod.get(p) ?? 0),
        downloadsCompleted: series(q, (p) => downloadsByPeriod.get(p) ?? 0),
        retentionD7: retention(7),
        retentionD30: retention(30),
        byTrack,
      }),
      200,
      truncationHeaders(s, 'usage', reads),
    );
  });

  define('adminAnalyticsErrors', {}, async (c) => {
    const q = parseAnalyticsQuery(c);
    const s = c.get('services')!;
    const scoped = isScoped(q);
    const now = Date.now();
    const jobsInRange = () => s.service.from('processing_jobs').select('id', { count: 'exact', head: true }).gte('created_at', toIso(q.from)).lte('created_at', toIso(q.to, true));
    const [reads, [failedJobs, mediaJobs, failedMediaJobs]] = await Promise.all([
      readPages(s, {
        ai_requests: (w) =>
          s.service
            .from('ai_requests')
            .select('task, provider, success, error_code, fallback_index, latency_ms, created_at, user_course_enrollments(course_track_id, source_language_code)', counted(w))
            .gte('created_at', toIso(q.from))
            .lte('created_at', toIso(q.to, true))
            .order('id')
            .range(w.from, w.to),
        learning_observations: (w) =>
          s.service
            .from('learning_observations')
            .select('utterance_confidence, user_course_enrollments(course_track_id, source_language_code)', counted(w))
            .not('utterance_confidence', 'is', null)
            .gte('observed_at', toIso(q.from))
            .lte('observed_at', toIso(q.to, true))
            .order('id')
            .range(w.from, w.to),
        content_rights: (w) =>
          s.service
            .from('content_rights')
            .select('id, expires_at', counted(w))
            .not('expires_at', 'is', null)
            .lte('expires_at', new Date(now + 30 * DAY_MS).toISOString())
            .gte('expires_at', new Date(now).toISOString())
            .order('id')
            .range(w.from, w.to),
        ai_requests_30d: (w) => s.service.from('ai_requests').select('created_at, estimated_cost_usd', counted(w)).gte('created_at', new Date(now - 30 * DAY_MS).toISOString()).order('id').range(w.from, w.to),
      }),
      Promise.all([
        countOf(s, 'processing_jobs_unhealthy', jobsInRange().in('state', UNHEALTHY_JOB_STATES)),
        countOf(s, 'processing_jobs_media', jobsInRange().in('job_type', MEDIA_JOB_TYPES)),
        countOf(s, 'processing_jobs_media_unhealthy', jobsInRange().in('job_type', MEDIA_JOB_TYPES).in('state', UNHEALTHY_JOB_STATES)),
      ]),
    ]);
    // Track / source filters apply to everything tied to an enrollment (AI requests, STT confidence); jobs, rights and
    // the runaway-cost alert stay deployment-wide.
    const rows = scoped ? reads.ai_requests.rows.filter((r) => inScope(r.user_course_enrollments, q)) : reads.ai_requests.rows;
    const byPeriod = new Map<string, { total: number; failed: number }>();
    for (const r of rows) {
      const p = periodOf(r.created_at, q.granularity);
      const v = byPeriod.get(p) ?? { total: 0, failed: 0 };
      v.total += 1;
      if (!r.success) v.failed += 1;
      byPeriod.set(p, v);
    }
    const failures = new Map<string, { provider: string; task: AiTaskName; failures: number; fallbacksUsed: number }>();
    for (const r of rows) {
      const key = `${r.provider}|${r.task}`;
      const v = failures.get(key) ?? { provider: r.provider, task: r.task as AiTaskName, failures: 0, fallbacksUsed: 0 };
      if (!r.success) v.failures += 1;
      if (r.fallback_index > 0) v.fallbacksUsed += 1;
      failures.set(key, v);
    }
    const sttByTrack = new Map<CourseTrackId, number[]>();
    for (const o of reads.learning_observations.rows) {
      const scope = o.user_course_enrollments;
      if (scoped && !inScope(scope, q)) continue;
      const t = scope?.course_track_id;
      if (!t || !isCourseTrackId(t)) continue;
      const values = sttByTrack.get(t);
      if (values) values.push(o.utterance_confidence as number);
      else sttByTrack.set(t, [o.utterance_confidence as number]);
    }
    // Runaway-cost detection over the trailing 30 days (operator alert, never learner-facing).
    const detector = new CostAnomalyDetector({ absoluteFloorUsd: 1 });
    const dailyMap = sumBy(reads.ai_requests_30d.rows.map((r) => ({ period: dayBucket(r.created_at), value: Number(r.estimated_cost_usd ?? 0) })));
    const alerts: { kind: 'runaway_cost' | 'attack' | 'provider_outage' | 'rights_expiry'; since: string; detail: string }[] = [];
    for (const day of [...dailyMap.keys()].sort()) {
      const alert = detector.observe('ai_requests', day, dailyMap.get(day) ?? 0);
      if (alert) alerts.push({ kind: 'runaway_cost', since: `${day}T00:00:00.000Z`, detail: alert.message });
    }
    const lastPeriod = periods(q).at(-1);
    const lastStats = lastPeriod ? byPeriod.get(lastPeriod) : undefined;
    if (lastStats && lastStats.total >= 10 && lastStats.failed / lastStats.total > 0.5) alerts.push({ kind: 'provider_outage', since: toIso(lastPeriod!), detail: `${lastStats.failed}/${lastStats.total} AI requests failed in the last period` });
    for (const r of reads.content_rights.rows) alerts.push({ kind: 'rights_expiry', since: new Date(now).toISOString(), detail: `content_rights ${r.id} expires at ${r.expires_at}` });
    // "Time to first AI audio": only requests whose output IS the AI audio (synthesis / realtime). Text, STT and admin
    // smoke calls have their own latencies and would mislabel the metric.
    const sorted = rows.filter((r) => r.task === 'speech_synthesis' || r.task === 'realtime_conversation').map((r) => r.latency_ms).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : null;
    return respondOk(
      c,
      AnalyticsErrorsResponseSchema.parse({
        apiErrorRate: series(q, (p) => ratio(byPeriod.get(p)?.failed ?? 0, byPeriod.get(p)?.total ?? 0) ?? 0),
        providerFailures: [...failures.values()].filter((f) => f.failures > 0 || f.fallbacksUsed > 0),
        mediaFailureRate: ratio(failedMediaJobs, mediaJobs),
        downloadFailureRate: null,
        timeouts: rows.filter((r) => r.error_code === 'timeout').length,
        latency: { apiP95Ms: null, timeToFirstAiAudioP95Ms: p95, interruptionLatencyP95Ms: null, mediaStartP99Ms: null },
        sttConfidenceByTrack: [...sttByTrack.entries()].map(([trackId, values]) => ({ trackId, meanConfidence: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, languageMismatchRate: null })),
        alerts: [...alerts, ...(failedJobs > 25 ? [{ kind: 'attack' as const, since: toIso(q.from), detail: `${failedJobs} processing jobs failed in range; check for abusive uploads` }] : [])],
      }),
      200,
      truncationHeaders(s, 'errors', reads),
    );
  });
}
