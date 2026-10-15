/**
 * Persistence for resumable uploads. IndexedDB in the browser (one object store keyed by
 * `localId`), an in-memory implementation for tests and for environments where IndexedDB
 * is blocked (private windows) — the queue still works, it just cannot resume after reload.
 */
import type { PersistedUpload } from './types';

export interface UploadStore {
  list(): Promise<PersistedUpload[]>;
  put(record: PersistedUpload): Promise<void>;
  remove(localId: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryUploadStore implements UploadStore {
  private readonly map = new Map<string, PersistedUpload>();
  async list() {
    return [...this.map.values()];
  }
  async put(record: PersistedUpload) {
    this.map.set(record.localId, { ...record });
  }
  async remove(localId: string) {
    this.map.delete(localId);
  }
  async clear() {
    this.map.clear();
  }
}

const DB_NAME = 'langquest-admin-uploads';
const STORE = 'uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'localId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbUploadStore implements UploadStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db() {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }
  async list() {
    const db = await this.db();
    return (await tx<PersistedUpload[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<PersistedUpload[]>)) ?? [];
  }
  async put(record: PersistedUpload) {
    const db = await this.db();
    await tx(db, 'readwrite', (s) => s.put(record));
  }
  async remove(localId: string) {
    const db = await this.db();
    await tx(db, 'readwrite', (s) => s.delete(localId));
  }
  async clear() {
    const db = await this.db();
    await tx(db, 'readwrite', (s) => s.clear());
  }
}

/** IndexedDB when usable, otherwise memory (reported through `mode`). */
export async function createUploadStore(): Promise<{ store: UploadStore; mode: 'indexeddb' | 'memory' }> {
  if (typeof indexedDB === 'undefined') return { store: new MemoryUploadStore(), mode: 'memory' };
  try {
    const store = new IndexedDbUploadStore();
    await store.list();
    return { store, mode: 'indexeddb' };
  } catch {
    return { store: new MemoryUploadStore(), mode: 'memory' };
  }
}
