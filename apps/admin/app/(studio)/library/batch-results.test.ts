/**
 * The library's batch actions (Attach / Merge dialogs): a refusal stops only its file, a retry runs only the files that
 * did not land, and every file keeps the `sortOrder` it was given when the batch was built, on the first run and on a
 * retry alike (a retried file never takes the number of a file that already landed).
 */
import { describe, expect, it } from 'vitest';
import { ApiClientError, ApiUnreachableError } from '@/src/lib/api';
import type { LibraryAssetRow } from '@/src/lib/queries/library';
import { attachItemsOf, mergeItemsOf, mergeReports, remainingItems, runBatch, type AttachItem } from './batch-results';

type Item = { assetId: string };
const items: Item[] = ['a', 'b', 'c', 'd'].map((assetId) => ({ assetId }));

type File = Pick<LibraryAssetRow, 'id' | 'lessonLinks'>;
const link = (lessonId: string | null, assetType = 'master'): LibraryAssetRow['lessonLinks'][number] => ({
  asset_type: assetType,
  lesson: lessonId ? { id: lessonId, title_translations: {}, chapter_id: 'ch', target_variety_id: 'ary', instruction_language_code: 'fr', transcript_status: 'none', chapter: null } : null,
});
const file = (id: string, lessonIds: (string | null)[] = []): File => ({ id, lessonLinks: lessonIds.map((l) => link(l)) });

describe('library batch outcomes', () => {
  it('a 409 on one file does not stop the batch; each file reports its own outcome', async () => {
    const calls: string[] = [];
    const report = await runBatch(items, async (item) => {
      calls.push(item.assetId);
      if (item.assetId === 'b') throw new ApiClientError('conflict', 'This audio belongs to a published lesson', 409, { publishedLessonIds: ['L1'] });
      if (item.assetId === 'c') throw new ApiClientError('internal', 'boom', 500);
      return { moved: item.assetId === 'd' };
    });
    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    expect(report).toMatchObject({ done: 2, moved: 1, conflicts: 1, failed: 1, skipped: 0, complete: false });
    expect(report.outcomes[1]).toEqual({ item: { assetId: 'b' }, status: 'conflict', code: 'conflict', message: 'This audio belongs to a published lesson', publishedLessonIds: ['L1'] });
    expect(report.outcomes[2]).toMatchObject({ status: 'failed', code: 'internal' });
    expect(remainingItems(report).map((i) => i.assetId)).toEqual(['b', 'c']);
  });

  it('a 412 is a conflict too; an unreachable API stops the batch and marks the rest as not attempted', async () => {
    const report = await runBatch(items, async (item) => {
      if (item.assetId === 'a') throw new ApiClientError('precondition_failed', 'Lesson revision is 3, expected 2', 412, { currentRevision: 3 });
      if (item.assetId === 'b') throw new ApiUnreachableError('http://127.0.0.1:8787');
      return {};
    });
    expect(report.outcomes.map((o) => o.status)).toEqual(['conflict', 'failed', 'skipped', 'skipped']);
    expect(report.outcomes[0]).toMatchObject({ publishedLessonIds: [] });
    expect(report).toMatchObject({ done: 0, conflicts: 1, failed: 1, skipped: 2, complete: false });
  });

  it('a retry runs only the rest and keeps earlier successes', async () => {
    const first = await runBatch(items, async (item) => {
      if (item.assetId === 'b' || item.assetId === 'd') throw new ApiClientError('conflict', 'published', 409, { publishedLessonIds: ['L1'] });
    });
    const retried: string[] = [];
    const second = await runBatch(remainingItems(first), async (item) => {
      retried.push(item.assetId);
      if (item.assetId === 'd') throw new ApiClientError('conflict', 'published', 409, { publishedLessonIds: ['L2'] });
    });
    expect(retried).toEqual(['b', 'd']);
    const merged = mergeReports(first, second, (x, y) => x.assetId === y.assetId);
    expect(merged.outcomes.map((o) => `${o.item.assetId}:${o.status}`)).toEqual(['a:done', 'b:done', 'c:done', 'd:conflict']);
    expect(merged).toMatchObject({ done: 3, conflicts: 1, complete: false });
    expect(mergeReports(merged, await runBatch(remainingItems(merged), async () => ({})), (x, y) => x.assetId === y.assetId).complete).toBe(true);
  });
});

describe('library batch positions', () => {
  it('attach: a retry after failures between successes re-sends each file its own sortOrder, never a duplicate', async () => {
    const attach = attachItemsOf(['a', 'b', 'c', 'd'].map((id) => file(id)), (r) => `${r.id}.mp3`);
    expect(attach).toEqual([
      { assetId: 'a', label: 'a.mp3', sortOrder: 0 },
      { assetId: 'b', label: 'b.mp3', sortOrder: 1 },
      { assetId: 'c', label: 'c.mp3', sortOrder: 2 },
      { assetId: 'd', label: 'd.mp3', sortOrder: 3 },
    ]);
    const landed = new Map<string, number>();
    const send = (fail: Set<string>) => async (item: AttachItem) => {
      if (fail.has(item.assetId)) throw new ApiClientError(item.assetId === 'b' ? 'conflict' : 'internal', 'refused', item.assetId === 'b' ? 409 : 500);
      landed.set(item.assetId, item.sortOrder);
    };
    const first = await runBatch(attach, send(new Set(['b', 'c'])));
    expect(first.done).toBe(2);
    const retry = await runBatch(remainingItems(first), send(new Set()));
    expect(mergeReports(first, retry, (x, y) => x.assetId === y.assetId).complete).toBe(true);
    expect(Object.fromEntries(landed)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
    expect(new Set(landed.values()).size).toBe(4);
  });

  it('merge: links are numbered in merge order across groups; links already on the primary lesson or without a lesson are left out', () => {
    const groups = [
      [file('x1', ['P1']), file('x2', ['L2', 'P1', null])],
      [file('y1', [null]), file('y2', ['P2']), file('y3', ['L3'])],
      [file('z1', [null]), file('z2', [null])],
    ];
    expect(mergeItemsOf(groups, (r) => r.id)).toEqual([
      { primaryLessonId: 'P1', lessonId: 'L2', assetId: 'x2', assetType: 'master', label: 'x2', sortOrder: 0 },
      { primaryLessonId: 'P2', lessonId: 'L3', assetId: 'y3', assetType: 'master', label: 'y3', sortOrder: 1 },
    ]);
  });
});
