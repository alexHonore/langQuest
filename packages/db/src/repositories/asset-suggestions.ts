/**
 * §7.4 AI metadata / organisation suggestions (`asset_suggestions`, migration 100).
 *
 * Suggestions are never applied automatically: jobs insert them with `review_status = 'review_needed'`
 * and a `provenance` record (task, model, prompt version, trace id); an editor approves or rejects
 * each row and the DB trigger stamps `reviewer_id` / `decided_at`. Staff-only under RLS; the service
 * role (jobs runner, API Worker) sees everything.
 *
 * Writes to one suggestion are conditional on the review queue: `decide`, `decideMany` and `update` change only rows
 * that are still pending (`review_status in ('draft', 'review_needed', 'in_review')` is part of the UPDATE filter), so
 * of two editors who decide the same suggestion at the same moment exactly one decision lands, and a decided
 * suggestion (the record of what was approved or rejected) never has its payload rewritten afterwards. `decide` and
 * `update` answer a write that lost with `SuggestionAlreadyDecidedError` (an `ApiProblem` `conflict`, HTTP 409,
 * carrying the status the winner stored); they never overwrite a decision another editor already made. `decide` can
 * carry the payload the editor approved (`suggestion`), so the override and the decision land in ONE statement.
 */
import { ApiProblem } from '@langquest/contracts';
import type { PostgrestError } from '@supabase/supabase-js';
import type { DbClient } from '../client';
import { DbError, unwrap, unwrapMaybe } from '../errors';
import { clampLimit, type Insert, type PageQuery, type PageResult, type Row, type Update } from '../types';

export type AssetSuggestionRow = Row<'asset_suggestions'>;
export type AssetSuggestionReviewStatus = AssetSuggestionRow['review_status'];

export interface AssetSuggestionsListFilter extends PageQuery {
  reviewStatus?: AssetSuggestionReviewStatus;
  kind?: AssetSuggestionRow['kind'];
  mediaAssetId?: string;
  lessonId?: string;
  jobId?: string;
  /** Rows with `confidence >= minConfidence` (rows with null confidence are excluded when set). */
  minConfidence?: number;
}

export interface AssetSuggestionDecision {
  reviewStatus: 'approved' | 'rejected';
  reviewerId?: string | null;
  note?: string | null;
  /**
   * The payload the editor decided on, when it differs from the stored one (an editor's override). Written in the same
   * conditional UPDATE as the decision, so the payload of record is always the one the deciding editor saw.
   */
  suggestion?: AssetSuggestionRow['suggestion'];
}

export interface AssetSuggestionsRepository {
  getById(id: string): Promise<AssetSuggestionRow | null>;
  getByIds(ids: string[]): Promise<AssetSuggestionRow[]>;
  /** Paged admin listing (`adminAssetSuggestionsList`), oldest first. */
  listPaged(filter?: AssetSuggestionsListFilter): Promise<PageResult<AssetSuggestionRow>>;
  /** Decides several rows at once (only rows still pending are changed); returns the updated rows. */
  decideMany(ids: string[], decision: { reviewStatus: 'approved' | 'rejected'; reviewerId?: string | null; note?: string | null }): Promise<AssetSuggestionRow[]>;
  insert(row: Insert<'asset_suggestions'>): Promise<AssetSuggestionRow>;
  insertMany(rows: Insert<'asset_suggestions'>[]): Promise<AssetSuggestionRow[]>;
  listForAsset(mediaAssetId: string, filter?: { reviewStatus?: AssetSuggestionReviewStatus; kind?: AssetSuggestionRow['kind'] }): Promise<AssetSuggestionRow[]>;
  listForLesson(lessonId: string, filter?: { reviewStatus?: AssetSuggestionReviewStatus }): Promise<AssetSuggestionRow[]>;
  listForJob(jobId: string): Promise<AssetSuggestionRow[]>;
  /** Review queue: draft / review_needed / in_review, oldest first. */
  listPending(filter?: { kind?: AssetSuggestionRow['kind']; limit?: number }): Promise<AssetSuggestionRow[]>;
  /**
   * Edits a suggestion that is still pending (e.g. an editor's override of the payload). Conditional on the pending
   * status like `decide`: on a row decided since the caller read it nothing is written and
   * `SuggestionAlreadyDecidedError` (409, with the current status) is thrown; an unknown or invisible id is a `DbError`
   * not-found (PGRST116), a pending row the caller may not write is a `DbError` forbidden (42501).
   */
  update(id: string, patch: Update<'asset_suggestions'>): Promise<AssetSuggestionRow>;
  /**
   * Records an editorial decision on a suggestion that is still pending. `reviewerId` is optional for JWT sessions
   * (the trigger fills it from `auth.uid()`); the service role must pass it explicitly so the decision stays
   * attributable. The UPDATE is conditional on the pending status: when another decision landed first, nothing is
   * written and `SuggestionAlreadyDecidedError` (409, with the current status) is thrown; an unknown or invisible id
   * is a `DbError` not-found (PGRST116), a pending row the caller may not write is a `DbError` forbidden (42501).
   */
  decide(id: string, decision: AssetSuggestionDecision): Promise<AssetSuggestionRow>;
}

/** The review statuses a decision may move a suggestion out of (the review queue). */
export const PENDING_SUGGESTION_STATUSES: readonly AssetSuggestionReviewStatus[] = ['draft', 'review_needed', 'in_review'];
const PENDING: AssetSuggestionReviewStatus[] = [...PENDING_SUGGESTION_STATUSES];

/**
 * A conditional write lost the race: the suggestion was decided (or otherwise left the review queue) after the caller
 * read it. An `ApiProblem` `conflict` (HTTP 409) whose details carry the status now stored, so the API answers it
 * unchanged; `currentStatus` lets a caller tell a matching decision (a replay) from a different one.
 */
export class SuggestionAlreadyDecidedError extends ApiProblem {
  readonly suggestionId: string;
  readonly currentStatus: AssetSuggestionReviewStatus;
  readonly decidedAt: string | null;
  constructor(row: Pick<AssetSuggestionRow, 'id' | 'review_status' | 'decided_at'>) {
    super('conflict', `Suggestion was already ${row.review_status}`, { reviewStatus: row.review_status, decidedAt: row.decided_at });
    this.suggestionId = row.id;
    this.currentStatus = row.review_status;
    this.decidedAt = row.decided_at;
  }
}

const dbFailure = (code: string, message: string, context: string): DbError => new DbError({ name: 'PostgrestError', message, code, details: '', hint: '' } as PostgrestError, context);

/**
 * `UPDATE … WHERE id = $id AND review_status IN (pending)`: the status check and the write are one statement, so a
 * decision that landed after the caller read the row makes this update zero rows instead of overwriting it. When
 * nothing matched, the row is re-read to say why: decided since (409), missing (not-found) or not writable (RLS).
 */
async function updatePending(db: DbClient, id: string, patch: Update<'asset_suggestions'>, context: string): Promise<AssetSuggestionRow> {
  const updated = unwrap(await db.from('asset_suggestions').update(patch).eq('id', id).in('review_status', PENDING).select('*'), context);
  if (updated[0]) return updated[0];
  const current = unwrapMaybe(await db.from('asset_suggestions').select('*').eq('id', id).maybeSingle(), context);
  if (!current) throw dbFailure('PGRST116', 'no asset suggestion with this id', context);
  if (!PENDING.includes(current.review_status)) throw new SuggestionAlreadyDecidedError(current);
  // Still pending and visible, yet the update matched nothing: the caller may read the row but not write it (RLS).
  throw dbFailure('42501', 'the change was not written (row not writable by this client)', context);
}

export function assetSuggestionsRepository(db: DbClient): AssetSuggestionsRepository {
  return {
    async getById(id) {
      return unwrapMaybe(await db.from('asset_suggestions').select('*').eq('id', id).maybeSingle(), 'suggestions.getById');
    },
    async getByIds(ids) {
      return ids.length ? unwrap(await db.from('asset_suggestions').select('*').in('id', ids), 'suggestions.getByIds') : [];
    },
    async listPaged(filter) {
      const limit = clampLimit(filter?.limit);
      let q = db.from('asset_suggestions').select('*').order('created_at').order('id').limit(limit + 1);
      if (filter?.reviewStatus) q = q.eq('review_status', filter.reviewStatus);
      if (filter?.kind) q = q.eq('kind', filter.kind);
      if (filter?.mediaAssetId) q = q.eq('media_asset_id', filter.mediaAssetId);
      if (filter?.lessonId) q = q.eq('lesson_id', filter.lessonId);
      if (filter?.jobId) q = q.eq('job_id', filter.jobId);
      if (filter?.minConfidence !== undefined) q = q.gte('confidence', filter.minConfidence);
      if (filter?.cursor) q = q.gt('created_at', filter.cursor);
      const rows = unwrap(await q, 'suggestions.listPaged');
      const items = rows.slice(0, limit);
      return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.created_at ?? null) : null };
    },
    async decideMany(ids, decision) {
      if (ids.length === 0) return [];
      const patch: Update<'asset_suggestions'> = { review_status: decision.reviewStatus };
      if (decision.reviewerId !== undefined) patch.reviewer_id = decision.reviewerId;
      if (decision.note !== undefined) patch.decision_note = decision.note;
      return unwrap(await db.from('asset_suggestions').update(patch).in('id', ids).in('review_status', PENDING).select('*'), 'suggestions.decideMany');
    },
    async insert(row) {
      return unwrap(await db.from('asset_suggestions').insert(row).select('*').single(), 'suggestions.insert');
    },
    async insertMany(rows) {
      if (rows.length === 0) return [];
      return unwrap(await db.from('asset_suggestions').insert(rows).select('*'), 'suggestions.insertMany');
    },
    async listForAsset(mediaAssetId, filter) {
      let q = db.from('asset_suggestions').select('*').eq('media_asset_id', mediaAssetId).order('created_at', { ascending: false });
      if (filter?.reviewStatus) q = q.eq('review_status', filter.reviewStatus);
      if (filter?.kind) q = q.eq('kind', filter.kind);
      return unwrap(await q, 'suggestions.listForAsset');
    },
    async listForLesson(lessonId, filter) {
      let q = db.from('asset_suggestions').select('*').eq('lesson_id', lessonId).order('created_at', { ascending: false });
      if (filter?.reviewStatus) q = q.eq('review_status', filter.reviewStatus);
      return unwrap(await q, 'suggestions.listForLesson');
    },
    async listForJob(jobId) {
      return unwrap(await db.from('asset_suggestions').select('*').eq('job_id', jobId).order('created_at'), 'suggestions.listForJob');
    },
    async listPending(filter) {
      let q = db.from('asset_suggestions').select('*').in('review_status', PENDING).order('created_at').limit(filter?.limit ?? 100);
      if (filter?.kind) q = q.eq('kind', filter.kind);
      return unwrap(await q, 'suggestions.listPending');
    },
    async update(id, patch) {
      return updatePending(db, id, patch, 'suggestions.update');
    },
    async decide(id, decision) {
      const patch: Update<'asset_suggestions'> = { review_status: decision.reviewStatus };
      if (decision.reviewerId !== undefined) patch.reviewer_id = decision.reviewerId;
      if (decision.note !== undefined) patch.decision_note = decision.note;
      if (decision.suggestion !== undefined) patch.suggestion = decision.suggestion;
      return updatePending(db, id, patch, 'suggestions.decide');
    },
  };
}
