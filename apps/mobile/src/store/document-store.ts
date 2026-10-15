/**
 * Offline-first local storage (§4.5): a small document store with ordered
 * collections, backed by SQLite on devices (`expo-sqlite`) and by an in-memory
 * map (optionally persisted to `localStorage`) on web and in tests.
 *
 * Collections hold JSON documents keyed by id with an optional numeric sort
 * key, which is all the app needs for cached enrollments, manifests, lesson
 * packs, the SRS due queue and the sync outbox. The SQL implementation takes
 * a minimal executor so the exact same statements run against `expo-sqlite`
 * on device and `node:sqlite` in unit tests.
 */
export interface ListOptions {
  /** Sort by `sortKey` (default) ascending/descending. */
  order?: 'asc' | 'desc';
  limit?: number;
  /** Only documents with sortKey >= / <= these bounds. */
  minSortKey?: number;
  maxSortKey?: number;
}

export interface StoredDocument<T> {
  id: string;
  sortKey: number;
  updatedAt: string;
  doc: T;
}

export interface DocumentStore {
  put<T>(collection: string, id: string, doc: T, sortKey?: number): Promise<void>;
  get<T>(collection: string, id: string): Promise<T | null>;
  list<T>(collection: string, options?: ListOptions): Promise<StoredDocument<T>[]>;
  remove(collection: string, id: string): Promise<void>;
  clear(collection: string): Promise<void>;
  count(collection: string): Promise<number>;
  /** Wipe everything (sign-out / delete account). */
  reset(): Promise<void>;
}

/* ----------------------------------------------------------------- SQL --- */

/** The subset of a SQLite driver the store needs. */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly (string | number | null)[]): Promise<void>;
  all<R>(sql: string, params: readonly (string | number | null)[]): Promise<R[]>;
}

interface DocRow {
  id: string;
  sort_key: number;
  updated_at: string;
  body: string;
}

export const DOCUMENT_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  sort_key REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS documents_sort ON documents (collection, sort_key);
`;

export class SqlDocumentStore implements DocumentStore {
  private ready: Promise<void> | null = null;
  constructor(
    private readonly sql: SqlExecutor,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private init(): Promise<void> {
    if (!this.ready) this.ready = this.sql.exec(DOCUMENT_STORE_SCHEMA);
    return this.ready;
  }

  async put<T>(collection: string, id: string, doc: T, sortKey = 0): Promise<void> {
    await this.init();
    await this.sql.run(
      'INSERT INTO documents (collection, id, sort_key, updated_at, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET sort_key = excluded.sort_key, updated_at = excluded.updated_at, body = excluded.body',
      [collection, id, sortKey, this.now(), JSON.stringify(doc)],
    );
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    await this.init();
    const rows = await this.sql.all<DocRow>('SELECT id, sort_key, updated_at, body FROM documents WHERE collection = ? AND id = ?', [collection, id]);
    const row = rows[0];
    return row ? (JSON.parse(row.body) as T) : null;
  }

  async list<T>(collection: string, options: ListOptions = {}): Promise<StoredDocument<T>[]> {
    await this.init();
    const where: string[] = ['collection = ?'];
    const params: (string | number)[] = [collection];
    if (options.minSortKey !== undefined) {
      where.push('sort_key >= ?');
      params.push(options.minSortKey);
    }
    if (options.maxSortKey !== undefined) {
      where.push('sort_key <= ?');
      params.push(options.maxSortKey);
    }
    const order = options.order === 'desc' ? 'DESC' : 'ASC';
    const limit = options.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(options.limit))}` : '';
    const rows = await this.sql.all<DocRow>(`SELECT id, sort_key, updated_at, body FROM documents WHERE ${where.join(' AND ')} ORDER BY sort_key ${order}, id ${order}${limit}`, params);
    return rows.map((r) => ({ id: r.id, sortKey: r.sort_key, updatedAt: r.updated_at, doc: JSON.parse(r.body) as T }));
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.init();
    await this.sql.run('DELETE FROM documents WHERE collection = ? AND id = ?', [collection, id]);
  }

  async clear(collection: string): Promise<void> {
    await this.init();
    await this.sql.run('DELETE FROM documents WHERE collection = ?', [collection]);
  }

  async count(collection: string): Promise<number> {
    await this.init();
    const rows = await this.sql.all<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE collection = ?', [collection]);
    return rows[0]?.n ?? 0;
  }

  async reset(): Promise<void> {
    await this.init();
    await this.sql.run('DELETE FROM documents', []);
  }
}

/* -------------------------------------------------------------- memory --- */

export interface KeyValuePersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory store (web + tests). Optionally mirrors every collection to a key-value persistence (localStorage). */
export class MemoryDocumentStore implements DocumentStore {
  private readonly data = new Map<string, Map<string, StoredDocument<unknown>>>();
  constructor(
    private readonly persistence: KeyValuePersistence | null = null,
    private readonly prefix = 'langquest:docs:',
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private collection(name: string): Map<string, StoredDocument<unknown>> {
    let col = this.data.get(name);
    if (!col) {
      col = new Map();
      const raw = this.persistence?.getItem(this.prefix + name);
      if (raw) {
        try {
          for (const entry of JSON.parse(raw) as StoredDocument<unknown>[]) col.set(entry.id, entry);
        } catch {
          /* corrupt cache: start empty */
        }
      }
      this.data.set(name, col);
    }
    return col;
  }

  private persist(name: string): void {
    if (!this.persistence) return;
    try {
      this.persistence.setItem(this.prefix + name, JSON.stringify([...this.collection(name).values()]));
    } catch {
      /* quota exceeded or private mode: in-memory only */
    }
  }

  async put<T>(collection: string, id: string, doc: T, sortKey = 0): Promise<void> {
    this.collection(collection).set(id, { id, sortKey, updatedAt: this.now(), doc });
    this.persist(collection);
  }
  async get<T>(collection: string, id: string): Promise<T | null> {
    return (this.collection(collection).get(id)?.doc as T | undefined) ?? null;
  }
  async list<T>(collection: string, options: ListOptions = {}): Promise<StoredDocument<T>[]> {
    const dir = options.order === 'desc' ? -1 : 1;
    let items = [...this.collection(collection).values()] as StoredDocument<T>[];
    if (options.minSortKey !== undefined) items = items.filter((d) => d.sortKey >= options.minSortKey!);
    if (options.maxSortKey !== undefined) items = items.filter((d) => d.sortKey <= options.maxSortKey!);
    items.sort((a, b) => (a.sortKey - b.sortKey || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) * dir);
    return options.limit !== undefined ? items.slice(0, Math.max(0, options.limit)) : items;
  }
  async remove(collection: string, id: string): Promise<void> {
    this.collection(collection).delete(id);
    this.persist(collection);
  }
  async clear(collection: string): Promise<void> {
    this.collection(collection).clear();
    this.persistence?.removeItem(this.prefix + collection);
  }
  async count(collection: string): Promise<number> {
    return this.collection(collection).size;
  }
  async reset(): Promise<void> {
    for (const name of [...this.data.keys()]) await this.clear(name);
    this.data.clear();
  }
}
