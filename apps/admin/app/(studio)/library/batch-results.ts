/**
 * Per-item outcomes of the library's batch actions (the Attach and Merge dialogs call `adminLessonAssetAttach` once
 * per file). Each call stands on its own, so a refusal stops only its item, never the rest of the batch:
 * - `conflict`: the API refused the item as it stands (409, e.g. the audio belongs to a published lesson and must not
 *   be moved off it; 412, the lesson changed meanwhile). `publishedLessonIds` names the lessons to unpublish first.
 * - `failed`: any other error for that item. The client cannot tell how far the call got (a 500 after the move's
 *   detach, a timeout the server finished), so the dialog never says such an item was left unchanged.
 * - `skipped`: not attempted because the API became unreachable (every later call would fail the same way).
 * The dialog reports exactly which items landed and offers a retry of the rest (`remainingItems`).
 *
 * Every item carries its `sortOrder`, fixed when the batch is built (`attachItemsOf`, `mergeItemsOf`): the first run
 * and every retry send that same number, so a retried file takes back its own place between the files that landed.
 */
import type { AudioAssetType } from '@langquest/contracts';
import { ApiClientError, ApiUnreachableError, describeApiError } from '@/src/lib/api';
import type { LibraryAssetRow } from '@/src/lib/queries/library';

type LibraryFile = Pick<LibraryAssetRow, 'id' | 'lessonLinks'>;

/** One file of the Attach dialog, at its position in the selection. */
export type AttachItem = { assetId: string; label: string; sortOrder: number };
/** One link of the Merge dialog to re-point at its group's primary lesson, at its position in the merge. */
export type MergeItem = { primaryLessonId: string; lessonId: string; assetId: string; assetType: AudioAssetType; label: string; sortOrder: number };

export const attachItemsOf = <R extends LibraryFile>(rows: readonly R[], label: (row: R) => string): AttachItem[] => rows.map((r, sortOrder) => ({ assetId: r.id, label: label(r), sortOrder }));

/**
 * Every link to re-point at its group's primary lesson (the first lesson that references the content hash), numbered in
 * merge order across all groups.
 */
export function mergeItemsOf<R extends LibraryFile>(groups: readonly (readonly R[])[], label: (row: R) => string): MergeItem[] {
  const out: MergeItem[] = [];
  for (const group of groups) {
    const links = group.flatMap((r) => r.lessonLinks.flatMap((l) => (l.lesson ? [{ lessonId: l.lesson.id, assetId: r.id, assetType: l.asset_type as AudioAssetType, label: label(r) }] : [])));
    const primaryLessonId = links[0]?.lessonId;
    if (!primaryLessonId) continue;
    for (const link of links.slice(1)) if (link.lessonId !== primaryLessonId) out.push({ ...link, primaryLessonId, sortOrder: out.length });
  }
  return out;
}

export type BatchOutcome<T> =
  | { item: T; status: 'done'; moved: boolean }
  | { item: T; status: 'conflict'; code: string; message: string; publishedLessonIds: string[] }
  | { item: T; status: 'failed'; code: string; message: string }
  | { item: T; status: 'skipped' };

export interface BatchReport<T> {
  outcomes: BatchOutcome<T>[];
  done: number;
  /** Items that were moved from another lesson (attach semantics: 200 + `movedFromLessonId`). */
  moved: number;
  conflicts: number;
  failed: number;
  skipped: number;
  /** Every item landed. */
  complete: boolean;
}

const publishedLessonIdsOf = (details: unknown): string[] => {
  const ids = details && typeof details === 'object' ? (details as { publishedLessonIds?: unknown }).publishedLessonIds : undefined;
  return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string') : [];
};

/** Classify one thrown error: refusals of the item as it stands are conflicts, everything else a failure. */
export function outcomeOfError<T>(item: T, error: unknown): BatchOutcome<T> {
  const { code, message } = describeApiError(error);
  if (error instanceof ApiClientError && (error.status === 409 || error.status === 412 || error.code === 'conflict' || error.code === 'precondition_failed')) {
    return { item, status: 'conflict', code, message, publishedLessonIds: publishedLessonIdsOf(error.details) };
  }
  return { item, status: 'failed', code, message };
}

/**
 * Run `call` for every item in order and collect one outcome per item. A thrown error is recorded for its item and the
 * batch goes on; an unreachable API marks the item that hit it as failed and the rest as skipped.
 */
export async function runBatch<T>(items: readonly T[], call: (item: T, index: number) => Promise<{ moved?: boolean } | void>): Promise<BatchReport<T>> {
  const outcomes: BatchOutcome<T>[] = [];
  let unreachable = false;
  for (const [index, item] of items.entries()) {
    if (unreachable) {
      outcomes.push({ item, status: 'skipped' });
      continue;
    }
    try {
      const result = await call(item, index);
      outcomes.push({ item, status: 'done', moved: Boolean(result && result.moved) });
    } catch (error) {
      outcomes.push(outcomeOfError(item, error));
      if (error instanceof ApiUnreachableError) unreachable = true;
    }
  }
  return summarize(outcomes);
}

export function summarize<T>(outcomes: BatchOutcome<T>[]): BatchReport<T> {
  const count = (status: BatchOutcome<T>['status']) => outcomes.filter((o) => o.status === status).length;
  const done = count('done');
  return { outcomes, done, moved: outcomes.filter((o) => o.status === 'done' && o.moved).length, conflicts: count('conflict'), failed: count('failed'), skipped: count('skipped'), complete: done === outcomes.length };
}

/** The items a retry should run again: every outcome that did not land. */
export const remainingItems = <T>(report: BatchReport<T> | null): T[] => (report ? report.outcomes.filter((o) => o.status !== 'done').map((o) => o.item) : []);

/** Fold a retry's report into the previous one: earlier successes stay, retried items take their new outcome. */
export function mergeReports<T>(previous: BatchReport<T> | null, retry: BatchReport<T>, sameItem: (a: T, b: T) => boolean): BatchReport<T> {
  if (!previous) return retry;
  const outcomes = previous.outcomes.map((o) => (o.status === 'done' ? o : (retry.outcomes.find((r) => sameItem(r.item, o.item)) ?? o)));
  return summarize(outcomes);
}
