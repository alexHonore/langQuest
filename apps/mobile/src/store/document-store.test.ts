import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MemoryDocumentStore, SqlDocumentStore, type DocumentStore, type SqlExecutor } from './document-store';

/** node:sqlite adapter so the exact SQL used on device runs in tests. */
function nodeSqliteExecutor(): SqlExecutor {
  const db = new DatabaseSync(':memory:');
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params) {
      db.prepare(sql).run(...(params as (string | number | null)[]));
    },
    async all<R>(sql: string, params: readonly (string | number | null)[]) {
      return db.prepare(sql).all(...(params as (string | number | null)[])) as R[];
    },
  };
}

const implementations: [string, () => DocumentStore][] = [
  ['SqlDocumentStore (node:sqlite)', () => new SqlDocumentStore(nodeSqliteExecutor())],
  ['MemoryDocumentStore', () => new MemoryDocumentStore()],
];

describe.each(implementations)('%s', (_name, make) => {
  it('puts, gets, upserts and removes documents', async () => {
    const store = make();
    await store.put('enrollments', 'a', { id: 'a', track: 'french' });
    await store.put('enrollments', 'a', { id: 'a', track: 'german' });
    expect(await store.get('enrollments', 'a')).toEqual({ id: 'a', track: 'german' });
    expect(await store.get('enrollments', 'missing')).toBeNull();
    expect(await store.count('enrollments')).toBe(1);
    await store.remove('enrollments', 'a');
    expect(await store.count('enrollments')).toBe(0);
  });

  it('lists ordered by sort key with bounds and limits', async () => {
    const store = make();
    await store.put('outbox', 'e3', { n: 3 }, 3);
    await store.put('outbox', 'e1', { n: 1 }, 1);
    await store.put('outbox', 'e2', { n: 2 }, 2);
    expect((await store.list<{ n: number }>('outbox')).map((d) => d.doc.n)).toEqual([1, 2, 3]);
    expect((await store.list<{ n: number }>('outbox', { order: 'desc', limit: 2 })).map((d) => d.doc.n)).toEqual([3, 2]);
    expect((await store.list<{ n: number }>('outbox', { minSortKey: 2 })).map((d) => d.doc.n)).toEqual([2, 3]);
    expect((await store.list<{ n: number }>('outbox', { maxSortKey: 1 })).map((d) => d.doc.n)).toEqual([1]);
  });

  it('isolates collections and resets everything', async () => {
    const store = make();
    await store.put('a', '1', { v: 1 });
    await store.put('b', '1', { v: 2 });
    await store.clear('a');
    expect(await store.count('a')).toBe(0);
    expect(await store.get('b', '1')).toEqual({ v: 2 });
    await store.reset();
    expect(await store.count('b')).toBe(0);
  });
});

describe('MemoryDocumentStore persistence', () => {
  it('round-trips collections through a key-value persistence', async () => {
    const backing = new Map<string, string>();
    const persistence = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const first = new MemoryDocumentStore(persistence);
    await first.put('prefs', 'ui', { locale: 'fr' }, 5);
    const second = new MemoryDocumentStore(persistence);
    expect(await second.get('prefs', 'ui')).toEqual({ locale: 'fr' });
    expect((await second.list('prefs'))[0]?.sortKey).toBe(5);
  });
});
