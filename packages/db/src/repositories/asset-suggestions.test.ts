/**
 * `assetSuggestionsRepository.decide` is a conditional write (§7.4): the pending-status check is part of the UPDATE
 * filter, so two editors deciding the same suggestion at the same moment cannot both land a decision, and `update` (an
 * editor's payload override) is conditional the same way, so a decided suggestion keeps its payload. Offline: the
 * repository runs against a small in-memory stand-in for the supabase-js query builder that applies each UPDATE's
 * filters and write in one step (as one SQL statement does), and records every request it receives.
 */
import { ApiProblem } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import type { DbClient } from '../client';
import { DbError } from '../errors';
import { PENDING_SUGGESTION_STATUSES, SuggestionAlreadyDecidedError, assetSuggestionsRepository, type AssetSuggestionRow } from './asset-suggestions';

type Filter = { op: 'eq' | 'in'; column: string; value: unknown };
interface RecordedRequest {
  table: string;
  kind: 'select' | 'update';
  patch: Record<string, unknown> | null;
  filters: Filter[];
}

const EDITOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDITOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * In-memory `asset_suggestions`. `then` executes the whole request synchronously (filter match + write), which is what
 * makes a conditional UPDATE atomic in Postgres. `writable(row)` stands in for the RLS update policy.
 */
class FakeSuggestionsDb {
  readonly rows = new Map<string, AssetSuggestionRow>();
  readonly requests: RecordedRequest[] = [];
  writable: (row: AssetSuggestionRow) => boolean = () => true;

  seed(over: Partial<AssetSuggestionRow> = {}): AssetSuggestionRow {
    const row = {
      id: crypto.randomUUID(),
      media_asset_id: crypto.randomUUID(),
      lesson_id: null,
      job_id: null,
      kind: 'tags',
      suggestion: { tags: ['cafe'] },
      confidence: 0.9,
      provenance: { task: 'scene_planning' },
      review_status: 'review_needed',
      reviewer_id: null,
      decided_at: null,
      decision_note: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...over,
    } as unknown as AssetSuggestionRow;
    this.rows.set(row.id, row);
    return row;
  }

  client(): DbClient {
    return { from: (table: string) => this.builder(table) } as unknown as DbClient;
  }

  private matches(row: AssetSuggestionRow, filters: Filter[]): boolean {
    const r = row as unknown as Record<string, unknown>;
    return filters.every((f) => (f.op === 'eq' ? r[f.column] === f.value : (f.value as unknown[]).includes(r[f.column])));
  }

  private builder(table: string) {
    const request: RecordedRequest = { table, kind: 'select', patch: null, filters: [] };
    let single: 'maybe' | 'one' | null = null;
    const run = (): { data: unknown; error: unknown } => {
      this.requests.push(request);
      const hits = [...this.rows.values()].filter((row) => this.matches(row, request.filters));
      if (request.kind === 'update') {
        const written = hits.filter((row) => this.writable(row)).map((row) => {
          const status = request.patch!.review_status as string | undefined;
          const decided = status === 'approved' || status === 'rejected';
          // The `stamp_asset_suggestion_decision` trigger: a decision stamps `decided_at`.
          const next = { ...row, ...request.patch, decided_at: decided ? new Date().toISOString() : row.decided_at } as AssetSuggestionRow;
          this.rows.set(row.id, next);
          return next;
        });
        return { data: written.map((r) => ({ ...r })), error: null };
      }
      if (single === 'maybe') return { data: hits[0] ? { ...hits[0] } : null, error: null };
      if (single === 'one') return hits.length === 1 ? { data: { ...hits[0] }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows', details: '', hint: '' } };
      return { data: hits.map((r) => ({ ...r })), error: null };
    };
    const chain = {
      select: () => chain,
      update: (patch: Record<string, unknown>) => {
        request.kind = 'update';
        request.patch = patch;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        request.filters.push({ op: 'eq', column, value });
        return chain;
      },
      in: (column: string, value: unknown[]) => {
        request.filters.push({ op: 'in', column, value });
        return chain;
      },
      maybeSingle: () => {
        single = 'maybe';
        return chain;
      },
      single: () => {
        single = 'one';
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return chain;
  }
}

describe('assetSuggestions.decide: only a pending suggestion can be decided (conditional UPDATE)', () => {
  it('two editors who both read the suggestion as pending race: exactly one decision lands, the other is a 409 with the stored status', async () => {
    const db = new FakeSuggestionsDb();
    const row = db.seed();
    const asA = assetSuggestionsRepository(db.client());
    const asB = assetSuggestionsRepository(db.client());
    // Both editors loaded the review queue: the row is pending for both of them.
    expect((await asA.getById(row.id))?.review_status).toBe('review_needed');
    expect((await asB.getById(row.id))?.review_status).toBe('review_needed');

    const [a, b] = await Promise.allSettled([
      asA.decide(row.id, { reviewStatus: 'approved', reviewerId: EDITOR_A, note: 'looks right' }),
      asB.decide(row.id, { reviewStatus: 'rejected', reviewerId: EDITOR_B, note: 'wrong level' }),
    ]);
    const settled = [a, b];
    const won = settled.filter((r): r is PromiseFulfilledResult<AssetSuggestionRow> => r.status === 'fulfilled');
    const lost = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const winner = won[0]!.value;
    const error = lost[0]!.reason as SuggestionAlreadyDecidedError;
    expect(error).toBeInstanceOf(SuggestionAlreadyDecidedError);
    expect(error).toBeInstanceOf(ApiProblem);
    expect(error.code).toBe('conflict');
    expect(error.status).toBe(409);
    expect(error.currentStatus).toBe(winner.review_status);
    expect(error.details).toEqual({ reviewStatus: winner.review_status, decidedAt: winner.decided_at });
    expect(error.message).toBe(`Suggestion was already ${winner.review_status}`);

    // The stored row is the winner's decision, untouched by the loser.
    const stored = db.rows.get(row.id)!;
    expect(stored).toMatchObject({ review_status: winner.review_status, reviewer_id: winner.reviewer_id, decision_note: winner.decision_note });
    expect(stored.decided_at).not.toBeNull();

    // Both UPDATEs carried the pending-status filter; only one of them matched the row.
    const updates = db.requests.filter((r) => r.kind === 'update');
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u.filters).toEqual([{ op: 'eq', column: 'id', value: row.id }, { op: 'in', column: 'review_status', value: [...PENDING_SUGGESTION_STATUSES] }]);
  });

  it('a decision on an already decided suggestion writes nothing and answers 409 with the current status', async () => {
    const db = new FakeSuggestionsDb();
    const decidedAt = '2026-10-19T10:00:00.000Z';
    const row = db.seed({ review_status: 'approved', reviewer_id: EDITOR_A, decided_at: decidedAt, decision_note: 'ok' } as Partial<AssetSuggestionRow>);
    const repo = assetSuggestionsRepository(db.client());
    const error = await repo.decide(row.id, { reviewStatus: 'rejected', reviewerId: EDITOR_B, note: 'late' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SuggestionAlreadyDecidedError);
    expect((error as SuggestionAlreadyDecidedError).details).toEqual({ reviewStatus: 'approved', decidedAt });
    expect(db.rows.get(row.id)).toMatchObject({ review_status: 'approved', reviewer_id: EDITOR_A, decided_at: decidedAt, decision_note: 'ok' });
  });

  it('every pending status can be decided once (draft, review_needed, in_review: a reopened row too)', async () => {
    const db = new FakeSuggestionsDb();
    const repo = assetSuggestionsRepository(db.client());
    for (const status of PENDING_SUGGESTION_STATUSES) {
      const row = db.seed({ review_status: status } as Partial<AssetSuggestionRow>);
      const decided = await repo.decide(row.id, { reviewStatus: 'approved', reviewerId: EDITOR_A });
      expect(decided).toMatchObject({ id: row.id, review_status: 'approved', reviewer_id: EDITOR_A });
      await expect(repo.decide(row.id, { reviewStatus: 'approved', reviewerId: EDITOR_B })).rejects.toBeInstanceOf(SuggestionAlreadyDecidedError);
      expect(db.rows.get(row.id)!.reviewer_id).toBe(EDITOR_A);
    }
  });

  it('an unknown id is a not-found DbError; a pending row the client may not write is a forbidden DbError', async () => {
    const db = new FakeSuggestionsDb();
    const repo = assetSuggestionsRepository(db.client());
    const missing = await repo.decide(crypto.randomUUID(), { reviewStatus: 'approved' }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(DbError);
    expect((missing as DbError).isNotFound).toBe(true);

    const row = db.seed();
    db.writable = () => false;
    const denied = await repo.decide(row.id, { reviewStatus: 'rejected' }).catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(DbError);
    expect((denied as DbError).isForbidden).toBe(true);
    expect(db.rows.get(row.id)!.review_status).toBe('review_needed');
  });
});

describe('assetSuggestions payload writes: a decided suggestion keeps the payload it was decided on', () => {
  const PENDING_FILTER = (id: string) => [{ op: 'eq', column: 'id', value: id }, { op: 'in', column: 'review_status', value: [...PENDING_SUGGESTION_STATUSES] }];

  it('an override of the payload on a suggestion another editor approved since writes nothing and is a 409 with the stored status', async () => {
    const db = new FakeSuggestionsDb();
    const decidedAt = '2026-10-20T09:00:00.000Z';
    const row = db.seed({ review_status: 'approved', reviewer_id: EDITOR_B, decided_at: decidedAt, suggestion: { tags: ['cafe'] } } as Partial<AssetSuggestionRow>);
    const repo = assetSuggestionsRepository(db.client());
    const error = await repo.update(row.id, { suggestion: { tags: ['market'] } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SuggestionAlreadyDecidedError);
    expect((error as SuggestionAlreadyDecidedError).status).toBe(409);
    expect((error as SuggestionAlreadyDecidedError).details).toEqual({ reviewStatus: 'approved', decidedAt });
    // The approved payload is untouched, and the one UPDATE sent was conditional on the pending status.
    expect(db.rows.get(row.id)).toMatchObject({ review_status: 'approved', reviewer_id: EDITOR_B, suggestion: { tags: ['cafe'] } });
    const updates = db.requests.filter((r) => r.kind === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.filters).toEqual(PENDING_FILTER(row.id));
  });

  it('an override on a pending suggestion lands; an unknown id is a not-found DbError', async () => {
    const db = new FakeSuggestionsDb();
    const row = db.seed();
    const repo = assetSuggestionsRepository(db.client());
    expect(await repo.update(row.id, { suggestion: { tags: ['market'] } })).toMatchObject({ id: row.id, review_status: 'review_needed', suggestion: { tags: ['market'] } });
    const missing = await repo.update(crypto.randomUUID(), { suggestion: { tags: ['x'] } }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(DbError);
    expect((missing as DbError).isNotFound).toBe(true);
  });

  it('decide can carry the payload the editor approved: payload and decision land in one conditional UPDATE, and a lost race writes neither', async () => {
    const db = new FakeSuggestionsDb();
    const row = db.seed({ suggestion: { tags: ['cafe'] } } as Partial<AssetSuggestionRow>);
    const asA = assetSuggestionsRepository(db.client());
    const asB = assetSuggestionsRepository(db.client());
    const [a, b] = await Promise.allSettled([
      asA.decide(row.id, { reviewStatus: 'approved', reviewerId: EDITOR_A, suggestion: { tags: ['market'] } }),
      asB.decide(row.id, { reviewStatus: 'approved', reviewerId: EDITOR_B }),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const stored = db.rows.get(row.id)!;
    // Whoever won, the stored payload is exactly the one that editor approved.
    if (a.status === 'fulfilled') expect(stored).toMatchObject({ reviewer_id: EDITOR_A, suggestion: { tags: ['market'] } });
    else expect(stored).toMatchObject({ reviewer_id: EDITOR_B, suggestion: { tags: ['cafe'] } });
    const updates = db.requests.filter((r) => r.kind === 'update');
    expect(updates).toHaveLength(2);
    expect(updates.find((u) => u.patch!.reviewer_id === EDITOR_A)!.patch).toEqual({ review_status: 'approved', reviewer_id: EDITOR_A, suggestion: { tags: ['market'] } });
    for (const u of updates) expect(u.filters).toEqual(PENDING_FILTER(row.id));
  });
});
