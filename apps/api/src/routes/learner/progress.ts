/**
 * §6.1 progress: idempotent batch sync (§4.5, A27), skills and the progress summary (§3.8).
 *
 * Sync flow: `apply_sync_events` (RLS user, advisory-locked per user) records every event once and applies the
 * DB-handled payloads. Engine-handled payloads come back with `handled_in_db = false` and are finished here:
 *   - review_result  → FSRS-like scheduler on the learner's own card (RLS client)
 *   - step_completed / mission_abandoned → attempt bookkeeping on the learner's own attempt (RLS client). The
 *                      attempt reference is the server id OR the client_attempt_id (offline-started attempts);
 *                      a step for an attempt the server has never seen materialises it under the client id.
 *   - observation    → recorded as a CLIENT REPORT (scorer `client-sync:…`, uncertainty 1): history survives, mastery
 *                      ignores it, and it can never pose as server evidence (service client, after enrollment check)
 *   - xp_claim       → validated against the referenced OWNED, COMPLETED row that the server CREDITED (mission XP
 *                      only for an attempt with mission credit; skill advances are paid by `missionEvaluate` only;
 *                      `xpClaimRejection`), then `award_xp` with the clientEventId as idempotency key and the
 *                      canonical amount (client amount ignored)
 * then `mark_sync_events_applied`. A duplicate from a second device returns `duplicate` with 0 XP.
 */
import { ProgressResponseSchema, ProgressSyncRequestSchema, ProgressSyncResponseSchema, SkillsQuerySchema, SkillsResponseSchema, type MasteryState, type ProgressSyncEvent, type ReviewCard, type XpReason } from '@langquest/contracts';
import { DEFAULT_STORY_ARC, unlockedMilestones } from '@langquest/curriculum/missions/story';
import { levelForXp } from '@langquest/curriculum/rubric/xp';
import { masteryCounts } from '@langquest/curriculum/mastery/mastery';
import { findSkill } from '@langquest/curriculum/skills';
import { masteryRank } from '@langquest/contracts';
import type { DbClient } from '@langquest/db/client';
import type { Row } from '@langquest/db/types';
import type { DefineRoute } from '../../app';
import { respondOk } from '../../http/envelope';
import { parseBody, parseQuery } from '../../http/validate';
import { loadOwnedEnrollment, varietyOf, type EnrollmentRow } from '../../lib/enrollment';
import { applyReviewResult, awardXp, recordObservations } from '../../lib/learning';
import { clientReportedObservation, xpClaimRejection } from '../../lib/xp-credit';
import type { RequestServices } from '../../services/context';

/** Which owned, completed row an XP reason must point at (mirrors `xp_reference_owned` in SQL). */
export const XP_REFERENCE_TABLE: Readonly<Record<XpReason, string>> = {
  mission_completed: 'mission_attempts',
  step_completed: 'mission_attempts',
  review_completed: 'user_expression_reviews',
  conversation_turns: 'conversation_sessions',
  skill_state_advanced: 'user_skill_mastery',
  audio_lesson_completed: 'user_audio_progress',
  daily_goal: 'streak_activity',
  achievement: 'user_achievements',
};

interface EngineOutcome {
  resolution: 'applied' | 'rejected';
  reason: string | null;
  xpCredited: number | null;
  card: ReviewCard | null;
}

type OwnedAttempt = Pick<Row<'mission_attempts'>, 'id' | 'mission_id' | 'current_step_index'>;

/**
 * Resolve the learner's own attempt from a sync payload reference. Offline-first clients enqueue `step_completed` /
 * `mission_abandoned` before (or without) `missionAttemptCreate` succeeding, so `attemptId` may be either the server
 * `mission_attempts.id` or the client-generated `client_attempt_id` (unique per `(user_id, client_attempt_id)`).
 * The RLS client scopes both lookups to the caller's rows; `ref` is schema-validated as a UUID, so it is safe inside
 * the PostgREST filter.
 */
async function resolveOwnedAttempt(db: DbClient, ref: string): Promise<OwnedAttempt | null> {
  const res = await db.from('mission_attempts').select('id, mission_id, current_step_index').or(`id.eq.${ref},client_attempt_id.eq.${ref}`).limit(1).maybeSingle();
  if (res.error) throw new Error(`mission_attempts lookup failed: ${res.error.message}`);
  return res.data ?? null;
}

/** Finish one engine-handled sync event. Never throws for a bad event: it is reported as `rejected`. */
async function finishEngineEvent(s: RequestServices, event: ProgressSyncEvent, enrollments: Map<string, EnrollmentRow>, userId: string, now: string): Promise<EngineOutcome> {
  const { db, repos } = s.requireUser();
  const p = event.payload;
  const enrollment = event.enrollmentId ? enrollments.get(event.enrollmentId) : undefined;
  const needEnrollment = (): EnrollmentRow => {
    if (!enrollment) throw new Error('enrollment_required');
    return enrollment;
  };
  try {
    switch (p.type) {
      case 'review_result': {
        const card = await applyReviewResult(s, needEnrollment(), { cardId: p.cardId, rating: p.rating, hintsUsed: p.hintsUsed, replays: p.replays, responseTimeMs: p.responseTimeMs, scenarioId: p.scenarioId, occurredAt: event.occurredAt });
        if (!card) return { resolution: 'rejected', reason: 'card_not_owned', xpCredited: null, card: null };
        return { resolution: 'applied', reason: null, xpCredited: null, card };
      }
      case 'step_completed': {
        const step = await s.service.from('mission_steps').select('id, mission_id, sort_order').eq('id', p.stepId).maybeSingle();
        if (!step.data) return { resolution: 'rejected', reason: 'step_not_found', xpCredited: null, card: null };
        let attempt = await resolveOwnedAttempt(db, p.attemptId);
        if (!attempt) {
          // The attempt was started offline: `missionAttemptCreate` never reached the server, so the client only
          // has its own `clientAttemptId`. Materialise the attempt under that id (same unique key the create route
          // upserts on), so the later create call replays it and evaluation finds the learner's own row.
          const e = needEnrollment();
          const mission = await repos.curriculum.getMission(step.data.mission_id);
          if (!mission) return { resolution: 'rejected', reason: 'mission_not_found', xpCredited: null, card: null };
          if (mission.target_variety_id !== varietyOf(e)) return { resolution: 'rejected', reason: 'mission_variety_mismatch', xpCredited: null, card: null };
          const row = await repos.progress.startAttempt({ user_id: userId, enrollment_id: e.id, mission_id: mission.id, mission_revision: mission.published_revision ?? 0, client_attempt_id: p.attemptId, started_at: event.occurredAt });
          await repos.enrollments.setActiveMission(e.id, mission.id).catch(() => undefined);
          attempt = { id: row.id, mission_id: row.mission_id, current_step_index: row.current_step_index };
        } else if (attempt.mission_id !== step.data.mission_id) {
          return { resolution: 'rejected', reason: 'step_not_in_attempt_mission', xpCredited: null, card: null };
        }
        const upd = await db.from('mission_attempts').update({ current_step_index: Math.max(attempt.current_step_index, step.data.sort_order + 1) }).eq('id', attempt.id).select('id').maybeSingle();
        if (upd.error || !upd.data) return { resolution: 'rejected', reason: 'attempt_not_owned', xpCredited: null, card: null };
        return { resolution: 'applied', reason: null, xpCredited: null, card: null };
      }
      case 'mission_abandoned': {
        const attempt = await resolveOwnedAttempt(db, p.attemptId);
        // No server-side attempt under either id means no step ever reached the server: there is nothing to mark.
        if (!attempt) return { resolution: 'rejected', reason: 'attempt_not_found', xpCredited: null, card: null };
        const upd = await db.from('mission_attempts').update({ abandoned_at: event.occurredAt, current_step_index: Math.max(attempt.current_step_index, p.atStepIndex) }).eq('id', attempt.id).select('id').maybeSingle();
        if (upd.error || !upd.data) return { resolution: 'rejected', reason: 'attempt_not_owned', xpCredited: null, card: null };
        return { resolution: 'applied', reason: null, xpCredited: null, card: null };
      }
      case 'observation': {
        const e = needEnrollment();
        if (p.observation.enrollmentId !== e.id) return { resolution: 'rejected', reason: 'observation_enrollment_mismatch', xpCredited: null, card: null };
        if (p.observation.scorerKind === 'acoustic_assessor' || p.observation.scorerKind === 'human') return { resolution: 'rejected', reason: 'scorer_kind_not_client_assignable', xpCredited: null, card: null };
        // A client report, not server evidence: recorded, but never credited and never usable as a grading row.
        await recordObservations(s, e, [clientReportedObservation(p.observation)], now);
        return { resolution: 'applied', reason: null, xpCredited: null, card: null };
      }
      case 'xp_claim': {
        if (!p.referenceId) return { resolution: 'rejected', reason: 'xp_claim_requires_reference', xpCredited: 0, card: null };
        const table = XP_REFERENCE_TABLE[p.reason];
        const owned = await s.service.rpc('xp_reference_owned', { p_user_id: userId, p_reference_table: table, p_reference_id: p.referenceId });
        if (owned.error || owned.data !== true) return { resolution: 'rejected', reason: 'reference_not_owned_or_incomplete', xpCredited: 0, card: null };
        // Owned and complete is not enough: the server must have credited it (lib/xp-credit.ts).
        const refused = await xpClaimRejection(s, { userId, reason: p.reason, referenceTable: table, referenceId: p.referenceId });
        if (refused) return { resolution: 'rejected', reason: refused, xpCredited: 0, card: null };
        const award = await awardXp(s, { idempotencyKey: event.clientEventId, userId, enrollmentId: enrollment?.id ?? null, reason: p.reason, referenceTable: table, referenceId: p.referenceId, occurredAt: event.occurredAt });
        if (award.rejectedReason) return { resolution: 'rejected', reason: award.rejectedReason, xpCredited: 0, card: null };
        return { resolution: 'applied', reason: award.applied ? null : 'already_awarded', xpCredited: award.amount, card: null };
      }
      default:
        return { resolution: 'rejected', reason: 'unknown_payload_type', xpCredited: null, card: null };
    }
  } catch (error) {
    s.log.warn('sync.engine_event_failed', { type: p.type, error });
    return { resolution: 'rejected', reason: error instanceof Error && error.message === 'enrollment_required' ? 'enrollment_required' : 'engine_error', xpCredited: p.type === 'xp_claim' ? 0 : null, card: null };
  }
}

export function registerProgressRoutes(define: DefineRoute): void {
  define('progressSync', { idempotent: false, timeoutMs: 40_000 }, async (c) => {
    const body = await parseBody(c, ProgressSyncRequestSchema);
    const s = c.get('services')!;
    const { db, repos, principal } = s.requireUser();
    const serverTime = new Date();
    const now = serverTime.toISOString();
    const events = body.events.map((e) => ({ ...e, deviceId: e.deviceId || body.deviceId }));
    const enrollmentIds = [...new Set(events.map((e) => e.enrollmentId).filter((v): v is string => v !== null))];
    const enrollments = new Map<string, EnrollmentRow>();
    for (const id of enrollmentIds) {
      try {
        enrollments.set(id, await loadOwnedEnrollment(db, id, { allowArchived: true }));
      } catch {
        /* unknown/foreign enrollment: the RPC rejects those events */
      }
    }
    const applied = await repos.progress.applySyncEvents(events, { clientSentAt: body.clientSentAt });
    const byId = new Map(events.map((e) => [e.clientEventId, e]));
    const results: { clientEventId: string; resolution: 'applied' | 'duplicate' | 'superseded' | 'rejected'; reason: string | null; xpCredited: number | null; card: ReviewCard | null }[] = [];
    const toMark: string[] = [];
    const toReject: { id: string; reason: string }[] = [];
    for (const r of applied) {
      const event = r.client_event_id ? byId.get(r.client_event_id) : undefined;
      let outcome: EngineOutcome = { resolution: r.resolution as EngineOutcome['resolution'], reason: r.reason, xpCredited: r.xp_credited, card: null };
      if (event && r.resolution === 'applied' && r.handled_in_db === false) {
        outcome = await finishEngineEvent(s, event, enrollments, principal.userId, now);
        if (outcome.resolution === 'applied') toMark.push(event.clientEventId);
        else toReject.push({ id: event.clientEventId, reason: outcome.reason ?? 'rejected' });
      }
      results.push({ clientEventId: r.client_event_id ?? event?.clientEventId ?? '00000000-0000-0000-0000-000000000000', resolution: r.resolution === 'applied' ? outcome.resolution : (r.resolution as 'duplicate' | 'superseded' | 'rejected'), reason: outcome.reason, xpCredited: outcome.xpCredited, card: outcome.card });
    }
    if (toMark.length) await repos.progress.markSyncEventsApplied(toMark);
    for (const rej of toReject) {
      await s.service.from('device_sync_events').update({ resolution: 'rejected', rejection_reason: rej.reason }).eq('user_id', principal.userId).eq('client_event_id', rej.id);
    }
    const serverRevision = Math.max(0, ...events.filter((e) => results.find((r) => r.clientEventId === e.clientEventId)?.resolution === 'applied').map((e) => e.revision));
    s.log.info('progress.synced', { events: events.length, applied: results.filter((r) => r.resolution === 'applied').length, duplicates: results.filter((r) => r.resolution === 'duplicate').length });
    return respondOk(c, ProgressSyncResponseSchema.parse({ results, serverTime: now, estimatedClockSkewMs: Math.round(new Date(body.clientSentAt).getTime() - serverTime.getTime()), serverRevision }));
  });

  define('meSkills', {}, async (c) => {
    const query = parseQuery(c, SkillsQuerySchema);
    const s = c.get('services')!;
    const { db, repos } = s.requireUser();
    const enrollment = await loadOwnedEnrollment(db, query.enrollmentId, { allowArchived: true });
    const all = await repos.progress.listMastery(enrollment.id);
    const start = query.cursor ? all.findIndex((m) => m.skill_key > query.cursor!) : 0;
    const page = start < 0 ? [] : all.slice(start, start + query.limit);
    const recent = await repos.progress.listObservations(enrollment.id, { limit: 200 });
    const items = page.map((m) => ({
      enrollmentId: m.enrollment_id,
      skillKey: m.skill_key,
      masteryState: m.mastery_state,
      internalScore: m.internal_score,
      evidenceCount: m.evidence_count,
      uncertainty: m.uncertainty,
      lastPracticedAt: m.last_practiced_at,
      dueAt: m.due_at,
      descriptor: findSkill(m.skill_key)?.descriptor ?? m.skill_key,
      cefrCanDo: findSkill(m.skill_key)?.cefrCanDo ?? null,
      recentObservationTypes: [...new Set(recent.filter((o) => o.skill_key === m.skill_key).map((o) => o.observation_type))],
    }));
    const last = page[page.length - 1];
    return respondOk(c, SkillsResponseSchema.parse({ items, nextCursor: last && start + query.limit < all.length ? last.skill_key : null, total: all.length }));
  });

  define('meProgress', {}, async (c) => {
    const s = c.get('services')!;
    const { repos, principal } = s.requireUser();
    const sinceDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const [enrollments, totalXp, streakRows, achievements] = await Promise.all([repos.enrollments.listForUser(principal.userId, { includeArchived: true }), repos.progress.totalXp(principal.userId), repos.progress.listStreak(principal.userId, sinceDate), repos.progress.listAchievements(principal.userId)]);
    const settings = await repos.profiles.getSettings(principal.userId);
    const streakEnabled = Boolean((settings?.notification_preferences as { streak_gentle?: boolean } | null)?.streak_gentle);
    const streak = computeStreak(streakRows);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const perEnrollment = await Promise.all(
      enrollments.map(async (e) => {
        const [xp, progress, mastery, due, metrics] = await Promise.all([
          repos.progress.listXp(principal.userId, { enrollmentId: e.id, limit: 500 }),
          repos.progress.listMissionProgress(e.id),
          repos.progress.listMastery(e.id),
          repos.progress.countDueReviews(e.id),
          s.service.from('daily_learning_metrics').select('speaking_seconds, metric_date').eq('enrollment_id', e.id).gte('metric_date', weekAgo),
        ]);
        const completed = progress.filter((p) => p.status === 'completed');
        const missionIds = completed.map((p) => p.mission_id);
        const blueprintKeys = missionIds.length ? ((await s.service.from('missions').select('id, template_key').in('id', missionIds)).data ?? []).map((m) => m.template_key).filter((k): k is string => k !== null) : [];
        const milestones = unlockedMilestones(DEFAULT_STORY_ARC, new Set(blueprintKeys), new Map(mastery.map((m) => [m.skill_key, masteryRank(m.mastery_state as MasteryState)])));
        return {
          enrollmentId: e.id,
          courseTrackId: e.course_track_id,
          sourceLanguageCode: e.source_language_code,
          xp: xp.reduce((n, row) => n + row.amount, 0),
          missionsCompleted: completed.reduce((n, p) => n + p.completions, 0),
          missionsCompletedWithoutHints: completed.filter((p) => p.completed_without_hints).length,
          reviewsDue: due,
          masteryCounts: masteryCounts(mastery.map((m) => m.mastery_state as MasteryState)),
          speakingSecondsLast7Days: (metrics.data ?? []).reduce((n, m) => n + (m.speaking_seconds ?? 0), 0),
          recall7DayPct: null,
          recall30DayPct: null,
          storyMilestonesUnlocked: milestones.map((m) => m.id),
        };
      }),
    );
    return respondOk(
      c,
      ProgressResponseSchema.parse({
        userId: principal.userId,
        totalXp: Number(totalXp),
        level: levelForXp(Number(totalXp)),
        streak: { currentDays: streak.current, longestDays: streak.longest, enabled: streakEnabled },
        perEnrollment,
        achievements: achievements.map((a) => ({ key: a.achievement_key, unlockedAt: a.unlocked_at, enrollmentId: a.enrollment_id })),
      }),
    );
  });
}

/** Consecutive active days ending today or yesterday (never punitive: missing days just reset the count). */
export function computeStreak(rows: Pick<Row<'streak_activity'>, 'activity_date' | 'minutes_active'>[], today = new Date()): { current: number; longest: number } {
  const days = new Set(rows.filter((r) => r.minutes_active > 0).map((r) => r.activity_date));
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const t = Date.parse(d);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  let current = 0;
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    current += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { current, longest };
}
