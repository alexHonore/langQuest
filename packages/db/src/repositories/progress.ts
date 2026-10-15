/**
 * Learner progress (§3.4, §3.5, §3.8, §4.5): sync events, XP, mastery, reviews, attempts.
 * Idempotent writes go through RPCs (`apply_sync_events`, `award_xp`); reads respect RLS.
 */
import type { ProgressSyncEvent } from '@langquest/contracts';
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
import type { FnReturns, Insert, Row, Update } from '../types';

export type SyncEventResult = FnReturns<'apply_sync_events'>[number];
export type AwardXpResult = FnReturns<'award_xp'>[number];

export interface AwardXpInput {
  /** Client event UUID; replays return the original ledger row with `applied = false`. */
  idempotencyKey: string;
  userId: string;
  amount: number;
  reason: Row<'xp_ledger'>['reason'];
  enrollmentId?: string | null;
  referenceTable?: string | null;
  referenceId?: string | null;
  occurredAt?: string;
}

export interface ProgressRepository {
  /**
   * Applies a sync batch idempotently (RPC). Learner clients act on their own user; service clients pass `userId`.
   *
   * Results with `handled_in_db = false` (`review_result`, `step_completed`, `mission_abandoned`,
   * `observation`, `xp_claim`) are recorded but not finished: the API Worker runs the engine for them
   * and then calls `markSyncEventsApplied`. An `xp_claim` is never paid by the DB — it is `rejected`
   * (`xp_claim_requires_reference`) without a `referenceId`, and otherwise the Worker must verify the
   * referenced row is the learner's own, completed one (`xp_reference_owned`) and call `awardXp` with the
   * `clientEventId` as idempotency key and the canonical amount.
   */
  applySyncEvents(events: ProgressSyncEvent[], opts?: { userId?: string; clientSentAt?: string }): Promise<SyncEventResult[]>;
  markSyncEventsApplied(clientEventIds: string[], userId?: string): Promise<number>;
  /**
   * Service-role only: server-validated XP award (RPC, idempotent on `idempotencyKey`). With a
   * reference, the row must belong to the user and be complete (`xp_reference_owned`, else 23503)
   * and is paid at most once per reason (`xp_ledger_reference_once`): a second award for it returns
   * `applied = false` with the ledger row that already paid it.
   */
  awardXp(input: AwardXpInput): Promise<AwardXpResult>;
  totalXp(userId: string): Promise<number>;
  listXp(userId: string, opts?: { enrollmentId?: string; limit?: number }): Promise<Row<'xp_ledger'>[]>;
  listMastery(enrollmentId: string): Promise<Row<'user_skill_mastery'>[]>;
  /** Service role only (derived state is engine-written; learners read it). */
  upsertMastery(rows: Insert<'user_skill_mastery'>[]): Promise<Row<'user_skill_mastery'>[]>;
  /** Due review cards via `get_due_reviews` (SECURITY INVOKER → RLS). */
  getDueReviews(enrollmentId: string, limit?: number, now?: Date): Promise<Row<'user_expression_reviews'>[]>;
  countDueReviews(enrollmentId: string, now?: Date): Promise<number>;
  getReviewCard(id: string): Promise<Row<'user_expression_reviews'> | null>;
  upsertReviewCard(card: Insert<'user_expression_reviews'>): Promise<Row<'user_expression_reviews'>>;
  updateReviewCard(id: string, patch: Update<'user_expression_reviews'>): Promise<Row<'user_expression_reviews'>>;
  insertObservations(rows: Insert<'learning_observations'>[]): Promise<Row<'learning_observations'>[]>;
  listObservations(enrollmentId: string, opts?: { skillKey?: string; limit?: number }): Promise<Row<'learning_observations'>[]>;
  /** Idempotent on (user_id, client_attempt_id). Learners may start attempts but not pre-fill the outcome columns. */
  startAttempt(attempt: Insert<'mission_attempts'>): Promise<Row<'mission_attempts'>>;
  /**
   * Learners may advance their own attempt (step index, step results, hints, abandoned_at);
   * `completed_at`, `evaluation`, `xp_awarded` and `objectives_completed` are service-role only
   * (`guard_mission_attempt_write` raises 42501 for a JWT session).
   */
  updateAttempt(id: string, patch: Update<'mission_attempts'>): Promise<Row<'mission_attempts'>>;
  getAttempt(id: string): Promise<Row<'mission_attempts'> | null>;
  /** Service role only (engine-written). */
  upsertMissionProgress(row: Insert<'mission_progress'>): Promise<Row<'mission_progress'>>;
  listMissionProgress(enrollmentId: string): Promise<Row<'mission_progress'>[]>;
  listAchievements(userId: string): Promise<Row<'user_achievements'>[]>;
  listStreak(userId: string, sinceDate: string): Promise<Row<'streak_activity'>[]>;
  /** Service role only (engine-written). */
  upsertDailyMetrics(row: Insert<'daily_learning_metrics'>): Promise<Row<'daily_learning_metrics'>>;
}

export function progressRepository(db: DbClient): ProgressRepository {
  return {
    async applySyncEvents(events, opts) {
      const args: { p_events: ProgressSyncEvent[]; p_user_id?: string; p_client_sent_at?: string } = { p_events: events };
      if (opts?.userId) args.p_user_id = opts.userId;
      if (opts?.clientSentAt) args.p_client_sent_at = opts.clientSentAt;
      return unwrap(await db.rpc('apply_sync_events', args as never), 'progress.applySyncEvents');
    },
    async markSyncEventsApplied(clientEventIds, userId) {
      const args: { p_client_event_ids: string[]; p_user_id?: string } = { p_client_event_ids: clientEventIds };
      if (userId) args.p_user_id = userId;
      return unwrap(await db.rpc('mark_sync_events_applied', args), 'progress.markSyncEventsApplied');
    },
    async awardXp(input) {
      const rows = unwrap(
        await db.rpc('award_xp', {
          p_idempotency_key: input.idempotencyKey,
          p_user_id: input.userId,
          p_amount: input.amount,
          p_reason: input.reason,
          p_enrollment_id: input.enrollmentId ?? undefined,
          p_reference_table: input.referenceTable ?? undefined,
          p_reference_id: input.referenceId ?? undefined,
          p_occurred_at: input.occurredAt,
        }),
        'progress.awardXp',
      );
      const first = rows[0];
      if (!first) throw new Error('award_xp returned no row');
      return first;
    },
    async totalXp(userId) {
      return unwrap(await db.rpc('user_total_xp', { p_user_id: userId }), 'progress.totalXp');
    },
    async listXp(userId, opts) {
      let q = db.from('xp_ledger').select('*').eq('user_id', userId).order('occurred_at', { ascending: false }).limit(opts?.limit ?? 100);
      if (opts?.enrollmentId) q = q.eq('enrollment_id', opts.enrollmentId);
      return unwrap(await q, 'progress.listXp');
    },
    async listMastery(enrollmentId) {
      return unwrap(await db.from('user_skill_mastery').select('*').eq('enrollment_id', enrollmentId).order('skill_key'), 'progress.listMastery');
    },
    async upsertMastery(rows) {
      if (rows.length === 0) return [];
      return unwrap(await db.from('user_skill_mastery').upsert(rows, { onConflict: 'enrollment_id,skill_key' }).select('*'), 'progress.upsertMastery');
    },
    async getDueReviews(enrollmentId, limit = 20, now) {
      return unwrap(
        await db.rpc('get_due_reviews', { p_enrollment_id: enrollmentId, p_limit: limit, p_now: (now ?? new Date()).toISOString() }),
        'progress.getDueReviews',
      );
    },
    async countDueReviews(enrollmentId, now) {
      const res = await db
        .from('user_expression_reviews')
        .select('id', { count: 'exact', head: true })
        .eq('enrollment_id', enrollmentId)
        .lte('next_due_at', (now ?? new Date()).toISOString());
      unwrap(res, 'progress.countDueReviews');
      return res.count ?? 0;
    },
    async getReviewCard(id) {
      return unwrapMaybe(await db.from('user_expression_reviews').select('*').eq('id', id).single(), 'progress.getReviewCard');
    },
    async upsertReviewCard(card) {
      return unwrap(await db.from('user_expression_reviews').upsert(card).select('*').single(), 'progress.upsertReviewCard');
    },
    async updateReviewCard(id, patch) {
      return unwrap(await db.from('user_expression_reviews').update(patch).eq('id', id).select('*').single(), 'progress.updateReviewCard');
    },
    async insertObservations(rows) {
      if (rows.length === 0) return [];
      return unwrap(await db.from('learning_observations').insert(rows).select('*'), 'progress.insertObservations');
    },
    async listObservations(enrollmentId, opts) {
      let q = db.from('learning_observations').select('*').eq('enrollment_id', enrollmentId).order('observed_at', { ascending: false }).limit(opts?.limit ?? 100);
      if (opts?.skillKey) q = q.eq('skill_key', opts.skillKey);
      return unwrap(await q, 'progress.listObservations');
    },
    async startAttempt(attempt) {
      return unwrap(await db.from('mission_attempts').upsert(attempt, { onConflict: 'user_id,client_attempt_id', ignoreDuplicates: false }).select('*').single(), 'progress.startAttempt');
    },
    async updateAttempt(id, patch) {
      return unwrap(await db.from('mission_attempts').update(patch).eq('id', id).select('*').single(), 'progress.updateAttempt');
    },
    async getAttempt(id) {
      return unwrapMaybe(await db.from('mission_attempts').select('*').eq('id', id).single(), 'progress.getAttempt');
    },
    async upsertMissionProgress(row) {
      return unwrap(await db.from('mission_progress').upsert(row, { onConflict: 'enrollment_id,mission_id' }).select('*').single(), 'progress.upsertMissionProgress');
    },
    async listMissionProgress(enrollmentId) {
      return unwrap(await db.from('mission_progress').select('*').eq('enrollment_id', enrollmentId), 'progress.listMissionProgress');
    },
    async listAchievements(userId) {
      return unwrap(await db.from('user_achievements').select('*').eq('user_id', userId).order('unlocked_at', { ascending: false }), 'progress.listAchievements');
    },
    async listStreak(userId, sinceDate) {
      return unwrap(await db.from('streak_activity').select('*').eq('user_id', userId).gte('activity_date', sinceDate).order('activity_date'), 'progress.listStreak');
    },
    async upsertDailyMetrics(row) {
      return unwrap(await db.from('daily_learning_metrics').upsert(row, { onConflict: 'enrollment_id,metric_date' }).select('*').single(), 'progress.upsertDailyMetrics');
    },
  };
}
