/**
 * §7.4 AI metadata / organisation suggestions (`asset_suggestions`, migration 100).
 *
 * Suggestions are never applied automatically: jobs insert them with `review_status = 'review_needed'`
 * and a `provenance` record (task, model, prompt version, trace id); an editor approves or rejects
 * each row and the DB trigger stamps `reviewer_id` / `decided_at`. Staff-only under RLS; the service
 * role (jobs runner, API Worker) sees everything.
 */
import type { DbClient } from '../client';
import { unwrap, unwrapMaybe } from '../errors';
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
  update(id: string, patch: Update<'asset_suggestions'>): Promise<AssetSuggestionRow>;
  /**
   * Records an editorial decision. `reviewerId` is optional for JWT sessions (the trigger fills it
   * from `auth.uid()`); the service role must pass it explicitly so the decision stays attributable.
   */
  decide(id: string, decision: { reviewStatus: 'approved' | 'rejected'; reviewerId?: string | null; note?: string | null }): Promise<AssetSuggestionRow>;
}

const PENDING: AssetSuggestionReviewStatus[] = ['draft', 'review_needed', 'in_review'];

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
      return unwrap(await db.from('asset_suggestions').update(patch).eq('id', id).select('*').single(), 'suggestions.update');
    },
    async decide(id, decision) {
      const patch: Update<'asset_suggestions'> = { review_status: decision.reviewStatus };
      if (decision.reviewerId !== undefined) patch.reviewer_id = decision.reviewerId;
      if (decision.note !== undefined) patch.decision_note = decision.note;
      return unwrap(await db.from('asset_suggestions').update(patch).eq('id', id).select('*').single(), 'suggestions.decide');
    },
  };
}
