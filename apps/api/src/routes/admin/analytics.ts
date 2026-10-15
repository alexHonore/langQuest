/**
 * §6.4 analytics (§12.2): aggregations over `ai_requests` (cost, provider failures), content tables (quality,
 * rights coverage), enrollments/sessions/attempts (usage) and processing jobs. Every number is computed from
 * stored rows; metrics the platform does not record yet are returned as `null` (never estimated).
 * Cost anomalies use the telemetry `CostAnomalyDetector` over the daily series.
 */
import { capabilityFromStatus } from '@langquest/ai/capability/registry';
import { capabilityForTrack } from '@langquest/ai/capability/matrix';
import { AnalyticsCostResponseSchema, AnalyticsErrorsResponseSchema, AnalyticsQualityResponseSchema, AnalyticsQuerySchema, AnalyticsUsageResponseSchema, COURSE_TRACKS, isCourseTrackId, type AiTaskName, type AnalyticsQuery, type CourseTrackId } from '@langquest/contracts';
import { CostAnomalyDetector, dayBucket } from '@langquest/telemetry/cost';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseQuery } from '../../http/validate';
import type { RequestServices } from '../../services/context';

const DAY_MS = 86_400_000;

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

async function trackOfEnrollment(s: RequestServices, enrollmentIds: string[]): Promise<Map<string, string>> {
  if (!enrollmentIds.length) return new Map();
  const res = await s.service.from('user_course_enrollments').select('id, course_track_id').in('id', enrollmentIds.slice(0, 5000));
  return new Map((res.data ?? []).map((e) => [e.id, e.course_track_id]));
}

export function registerAnalyticsRoutes(define: DefineRoute): void {
  define('adminAnalyticsQuality', {}, async (c) => {
    const q = parseQuery(c, AnalyticsQuerySchema);
    if (q.from > q.to) throw problem.validation('from must be before to');
    const s = c.get('services')!;
    const [exprTotal, exprReviewed, assetsTotal, assetsRights, coverage, quarantined, openReports, progress, segments, enrollments] = await Promise.all([
      s.service.from('expressions').select('id', { count: 'exact', head: true }).in('state', ['approved', 'published']),
      s.service.from('expressions').select('id', { count: 'exact', head: true }).in('state', ['approved', 'published']).eq('reviewed', true),
      s.service.from('media_assets').select('id', { count: 'exact', head: true }).eq('disposition', 'active'),
      s.service.from('media_assets').select('id, content_rights!inner(verified)').eq('disposition', 'active').eq('content_rights.verified', true),
      s.service.from('course_source_localizations').select('course_track_id, source_language_code, metrics'),
      s.service.from('media_assets').select('id', { count: 'exact', head: true }).eq('disposition', 'quarantined'),
      s.service.from('feedback_reports').select('id, category, enrollment_id, course_track_id').eq('status', 'open'),
      s.service.from('mission_progress').select('first_completed_at, completed_without_hints').gte('first_completed_at', toIso(q.from)).lte('first_completed_at', toIso(q.to, true)),
      s.service.from('transcript_segments').select('confidence').not('confidence', 'is', null).limit(5000),
      s.service.from('user_course_enrollments').select('id, course_track_id'),
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
    const completions = (progress.data ?? []).map((p) => ({ period: periodOf(p.first_completed_at!, q.granularity), value: 1, noHints: p.completed_without_hints }));
    const totalByPeriod = sumBy(completions);
    const noHintsByPeriod = sumBy(completions.filter((x) => x.noHints));
    const enrollmentTrack = new Map((enrollments.data ?? []).map((e) => [e.id, e.course_track_id]));
    const falseCorrections = (openReports.data ?? []).filter((r) => r.category === 'false_correction');
    const confidences = (segments.data ?? []).map((x) => x.confidence).filter((v): v is number => typeof v === 'number');
    return respondOk(
      c,
      AnalyticsQualityResponseSchema.parse({
        nativeReviewedFraction: ratio(exprReviewed.count ?? 0, exprTotal.count ?? 0) ?? 0,
        rightsCoverageFraction: ratio((assetsRights.data ?? []).length, assetsTotal.count ?? 0) ?? 0,
        localizationCoverageBySource: (coverage.data ?? [])
          .filter((r) => isCourseTrackId(r.course_track_id) && (!q.trackId || r.course_track_id === q.trackId) && (!q.sourceLanguage || r.source_language_code === q.sourceLanguage))
          .map((r) => ({ sourceLanguage: r.source_language_code, trackId: r.course_track_id, pct: Math.max(0, Math.min(100, Number((r.metrics as { mission_instructions_pct?: number } | null)?.mission_instructions_pct ?? 0))) })),
        liveCapabilityByTrack,
        unresolvedTakedowns: (quarantined.count ?? 0) + (openReports.data ?? []).filter((r) => r.category === 'offensive' || r.category === 'wrong_dialect').length,
        transcriptAlignmentQuality: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
        falseCorrectionRateByTrack: tracks.map((t) => {
          const reports = falseCorrections.filter((r) => (r.course_track_id ?? (r.enrollment_id ? enrollmentTrack.get(r.enrollment_id) : null)) === t.id).length;
          const total = [...enrollmentTrack.values()].filter((tid) => tid === t.id).length;
          return { trackId: t.id, rate: total > 0 ? Math.min(1, reports / total) : null };
        }),
        missionCompletionWithoutHints: series(q, (p) => ratio(noHintsByPeriod.get(p) ?? 0, totalByPeriod.get(p) ?? 0) ?? 0),
        recall7Day: series(q, () => null),
        recall30Day: series(q, () => null),
      }),
    );
  });

  define('adminAnalyticsCost', {}, async (c) => {
    const q = parseQuery(c, AnalyticsQuerySchema);
    const s = c.get('services')!;
    const [requests, storage, sessions, transcripts] = await Promise.all([
      s.service.from('ai_requests').select('task, provider, model, input_tokens, output_tokens, audio_seconds, estimated_cost_usd, user_id, enrollment_id, created_at').gte('created_at', toIso(q.from)).lte('created_at', toIso(q.to, true)).limit(50_000),
      s.service.from('media_assets').select('byte_length').eq('disposition', 'active').limit(50_000),
      s.service.from('conversation_sessions').select('id, enrollment_id', { count: 'exact' }).eq('state', 'finished').gte('ended_at', toIso(q.from)).lte('ended_at', toIso(q.to, true)).gt('turn_count', 2),
      s.service.from('transcripts').select('id', { count: 'exact', head: true }).in('qa_state', ['reviewed', 'approved']).gte('updated_at', toIso(q.from)).lte('updated_at', toIso(q.to, true)),
    ]);
    let rows = requests.data ?? [];
    if (q.trackId || q.sourceLanguage) {
      const byEnrollment = await trackOfEnrollment(s, [...new Set(rows.map((r) => r.enrollment_id).filter((v): v is string => v !== null))]);
      rows = rows.filter((r) => !q.trackId || (r.enrollment_id && byEnrollment.get(r.enrollment_id) === q.trackId));
    }
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
    const conversations = sessions.count ?? 0;
    return respondOk(
      c,
      AnalyticsCostResponseSchema.parse({
        totalUsd,
        byTask: [...byTaskMap.entries()].map(([task, v]) => ({ task, ...v })),
        byProvider: [...byProviderMap.entries()].map(([provider, usdValue]) => ({ provider, usd: usdValue })),
        storageGb: (storage.data ?? []).reduce((n, a) => n + Number(a.byte_length), 0) / 1e9,
        r2Operations: 0,
        estimatedUsdPerActiveLearner: activeLearners > 0 ? totalUsd / activeLearners : null,
        usdPerMeaningfulConversation: conversations > 0 ? conversationUsd / conversations : null,
        usdPerReviewedLesson: (transcripts.count ?? 0) > 0 ? transcriptionUsd / (transcripts.count ?? 1) : null,
        timeline: series(q, (p) => timelineMap.get(p) ?? 0),
        reconciliation: { invoicedUsd: null, deltaUsd: null, asOf: null },
      }),
    );
  });

  define('adminAnalyticsUsage', {}, async (c) => {
    const q = parseQuery(c, AnalyticsQuerySchema);
    const s = c.get('services')!;
    const [streaks, sessions, attempts, audio, downloads, enrollments, profiles] = await Promise.all([
      s.service.from('streak_activity').select('user_id, activity_date, minutes_active, speaking_seconds').gte('activity_date', q.from).lte('activity_date', q.to).limit(50_000),
      s.service.from('conversation_sessions').select('started_at, ended_at, enrollment_id').gte('started_at', toIso(q.from)).lte('started_at', toIso(q.to, true)).limit(50_000),
      s.service.from('mission_attempts').select('completed_at, enrollment_id').gte('completed_at', toIso(q.from)).lte('completed_at', toIso(q.to, true)).limit(50_000),
      s.service.from('user_audio_progress').select('updated_at, position_ms').gte('updated_at', toIso(q.from)).lte('updated_at', toIso(q.to, true)).limit(50_000),
      s.service.from('user_download_manifests').select('downloaded_at').not('downloaded_at', 'is', null).gte('downloaded_at', toIso(q.from)).lte('downloaded_at', toIso(q.to, true)).limit(50_000),
      s.service.from('user_course_enrollments').select('id, user_id, course_track_id, source_language_code, status').limit(50_000),
      s.service.from('profiles').select('user_id, created_at').gte('created_at', toIso(q.from)).lte('created_at', toIso(q.to, true)).limit(50_000),
    ]);
    const enrollmentRows = (enrollments.data ?? []).filter((e) => (!q.trackId || e.course_track_id === q.trackId) && (!q.sourceLanguage || e.source_language_code === q.sourceLanguage));
    const enrollmentIds = new Set(enrollmentRows.map((e) => e.id));
    const filterByEnrollment = <T extends { enrollment_id: string | null }>(rows: T[]) => (q.trackId || q.sourceLanguage ? rows.filter((r) => r.enrollment_id && enrollmentIds.has(r.enrollment_id)) : rows);
    const activeByPeriod = new Map<string, Set<string>>();
    for (const r of streaks.data ?? []) {
      if (r.minutes_active <= 0) continue;
      const p = periodOf(toIso(r.activity_date), q.granularity);
      activeByPeriod.set(p, (activeByPeriod.get(p) ?? new Set()).add(r.user_id));
    }
    const sessionRows = filterByEnrollment(sessions.data ?? []);
    const peakByPeriod = new Map<string, number>();
    for (const p of periods(q)) {
      const events: { t: number; d: number }[] = [];
      for (const sess of sessionRows) {
        if (periodOf(sess.started_at, q.granularity) !== p) continue;
        events.push({ t: Date.parse(sess.started_at), d: 1 }, { t: Date.parse(sess.ended_at ?? sess.started_at) + 1, d: -1 });
      }
      events.sort((a, b) => a.t - b.t || a.d - b.d);
      let cur = 0;
      let peak = 0;
      for (const e of events) {
        cur += e.d;
        peak = Math.max(peak, cur);
      }
      peakByPeriod.set(p, peak);
    }
    const missionsByPeriod = sumBy(filterByEnrollment(attempts.data ?? []).map((a) => ({ period: periodOf(a.completed_at!, q.granularity), value: 1 })));
    const speakingByPeriod = sumBy((streaks.data ?? []).map((r) => ({ period: periodOf(toIso(r.activity_date), q.granularity), value: r.speaking_seconds })));
    const listenByPeriod = sumBy((audio.data ?? []).map((a) => ({ period: periodOf(a.updated_at, q.granularity), value: Math.round(a.position_ms / 1000) })));
    const downloadsByPeriod = sumBy((downloads.data ?? []).map((d) => ({ period: periodOf(d.downloaded_at!, q.granularity), value: 1 })));
    const activeDays = new Map<string, string[]>();
    for (const r of streaks.data ?? []) if (r.minutes_active > 0) activeDays.set(r.user_id, [...(activeDays.get(r.user_id) ?? []), r.activity_date]);
    const retention = (days: number): number | null => {
      const cohort = (profiles.data ?? []).filter((p) => Date.parse(p.created_at) + days * DAY_MS <= Date.now());
      if (!cohort.length) return null;
      const retained = cohort.filter((p) => (activeDays.get(p.user_id) ?? []).some((d) => Date.parse(d) >= Date.parse(p.created_at) + days * DAY_MS)).length;
      return retained / cohort.length;
    };
    const byTrack = COURSE_TRACKS.filter((t) => !q.trackId || t.id === q.trackId).map((t) => {
      const rows = enrollmentRows.filter((e) => e.course_track_id === t.id && e.status === 'active');
      const bySource = new Map<string, number>();
      for (const e of rows) bySource.set(e.source_language_code, (bySource.get(e.source_language_code) ?? 0) + 1);
      return { trackId: t.id, activeLearners: new Set(rows.map((e) => e.user_id)).size, enrollmentsBySource: [...bySource.entries()].map(([sourceLanguage, count]) => ({ sourceLanguage, count })) };
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
    );
  });

  define('adminAnalyticsErrors', {}, async (c) => {
    const q = parseQuery(c, AnalyticsQuerySchema);
    const s = c.get('services')!;
    const [requests, jobs, observations, rights, daily] = await Promise.all([
      s.service.from('ai_requests').select('task, provider, success, error_code, fallback_index, latency_ms, created_at, estimated_cost_usd').gte('created_at', toIso(q.from)).lte('created_at', toIso(q.to, true)).limit(50_000),
      s.service.from('processing_jobs').select('state, failure_code, job_type').gte('created_at', toIso(q.from)).lte('created_at', toIso(q.to, true)).limit(50_000),
      s.service.from('learning_observations').select('enrollment_id, utterance_confidence').not('utterance_confidence', 'is', null).gte('observed_at', toIso(q.from)).lte('observed_at', toIso(q.to, true)).limit(50_000),
      s.service.from('content_rights').select('id, expires_at').not('expires_at', 'is', null).lte('expires_at', new Date(Date.now() + 30 * DAY_MS).toISOString()).gte('expires_at', new Date().toISOString()),
      s.service.from('ai_requests').select('created_at, estimated_cost_usd').gte('created_at', new Date(Date.now() - 30 * DAY_MS).toISOString()).limit(50_000),
    ]);
    const rows = requests.data ?? [];
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
    const enrollmentTrack = await trackOfEnrollment(s, [...new Set((observations.data ?? []).map((o) => o.enrollment_id))]);
    const sttByTrack = new Map<CourseTrackId, number[]>();
    for (const o of observations.data ?? []) {
      const t = enrollmentTrack.get(o.enrollment_id);
      if (!t || !isCourseTrackId(t)) continue;
      sttByTrack.set(t, [...(sttByTrack.get(t) ?? []), o.utterance_confidence as number]);
    }
    const failedJobs = (jobs.data ?? []).filter((j) => j.state === 'failed' || j.state === 'review_needed');
    const mediaJobs = (jobs.data ?? []).filter((j) => j.job_type === 'transcode' || j.job_type === 'verify' || j.job_type === 'extract_metadata');
    // Runaway-cost detection over the trailing 30 days (operator alert, never learner-facing).
    const detector = new CostAnomalyDetector({ absoluteFloorUsd: 1 });
    const dailyMap = sumBy((daily.data ?? []).map((r) => ({ period: dayBucket(r.created_at), value: Number(r.estimated_cost_usd ?? 0) })));
    const alerts: { kind: 'runaway_cost' | 'attack' | 'provider_outage' | 'rights_expiry'; since: string; detail: string }[] = [];
    for (const day of [...dailyMap.keys()].sort()) {
      const alert = detector.observe('ai_requests', day, dailyMap.get(day) ?? 0);
      if (alert) alerts.push({ kind: 'runaway_cost', since: `${day}T00:00:00.000Z`, detail: alert.message });
    }
    const lastPeriod = periods(q).at(-1);
    const lastStats = lastPeriod ? byPeriod.get(lastPeriod) : undefined;
    if (lastStats && lastStats.total >= 10 && lastStats.failed / lastStats.total > 0.5) alerts.push({ kind: 'provider_outage', since: toIso(lastPeriod!), detail: `${lastStats.failed}/${lastStats.total} AI requests failed in the last period` });
    for (const r of rights.data ?? []) alerts.push({ kind: 'rights_expiry', since: new Date().toISOString(), detail: `content_rights ${r.id} expires at ${r.expires_at}` });
    const sorted = rows.map((r) => r.latency_ms).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : null;
    return respondOk(
      c,
      AnalyticsErrorsResponseSchema.parse({
        apiErrorRate: series(q, (p) => ratio(byPeriod.get(p)?.failed ?? 0, byPeriod.get(p)?.total ?? 0) ?? 0),
        providerFailures: [...failures.values()].filter((f) => f.failures > 0 || f.fallbacksUsed > 0),
        mediaFailureRate: ratio(mediaJobs.filter((j) => j.state === 'failed' || j.state === 'review_needed').length, mediaJobs.length),
        downloadFailureRate: null,
        timeouts: rows.filter((r) => r.error_code === 'timeout').length,
        latency: { apiP95Ms: null, timeToFirstAiAudioP95Ms: p95, interruptionLatencyP95Ms: null, mediaStartP99Ms: null },
        sttConfidenceByTrack: [...sttByTrack.entries()].map(([trackId, values]) => ({ trackId, meanConfidence: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, languageMismatchRate: null })),
        alerts: [...alerts, ...(failedJobs.length > 25 ? [{ kind: 'attack' as const, since: toIso(q.from), detail: `${failedJobs.length} processing jobs failed in range; check for abusive uploads` }] : [])],
      }),
    );
  });
}
