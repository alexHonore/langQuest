/**
 * Native platform wiring for the document store: `expo-sqlite` on iOS/Android
 * (Metro picks this `.native.ts` file; web uses `sqlite.ts`). Everything above
 * this module only sees the `DocumentStore` interface.
 *
 * Opening the database is retried once; when it still fails the app falls back
 * to a volatile in-memory store and REPORTS it (`getStoreMode()` →
 * `persistent: false`) so the UI can say that progress cannot be saved instead
 * of pretending the outbox and downloads are durable (§4.5 honest states).
 */
import { Platform } from 'react-native';
import { MemoryDocumentStore, SqlDocumentStore, type DocumentStore, type KeyValuePersistence, type SqlExecutor } from './document-store';

const DB_NAME = 'langquest-learner.db';

export interface StoreMode {
  /** True when writes survive a process restart. */
  persistent: boolean;
  /** Why the store is volatile (null when persistent). */
  reason: string | null;
}

function webPersistence(): KeyValuePersistence | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValuePersistence }).localStorage;
    if (!ls) return null;
    ls.setItem('langquest:probe', '1');
    ls.removeItem('langquest:probe');
    return ls;
  } catch {
    return null;
  }
}

async function expoSqliteExecutor(): Promise<SqlExecutor> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      await db.runAsync(sql, [...params]);
    },
    all: <R>(sql: string, params: readonly (string | number | null)[]) => db.getAllAsync<R>(sql, [...params]),
  };
}

let instance: Promise<DocumentStore> | null = null;
let mode: StoreMode = { persistent: true, reason: null };

/** How the current store behaves; valid once `getDocumentStore()` has resolved. */
export function getStoreMode(): StoreMode {
  return mode;
}

/** Lazily opened singleton store for the current platform. */
export function getDocumentStore(): Promise<DocumentStore> {
  if (!instance) {
    instance = (async () => {
      if (Platform.OS === 'web') {
        const persistence = webPersistence();
        mode = persistence ? { persistent: true, reason: null } : { persistent: false, reason: 'localStorage unavailable' };
        return new MemoryDocumentStore(persistence);
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const store = new SqlDocumentStore(await expoSqliteExecutor());
          // Touch the schema now so a corrupt file surfaces here, not on the first write.
          await store.count('meta');
          mode = { persistent: true, reason: null };
          return store;
        } catch (error) {
          lastError = error;
        }
      }
      mode = { persistent: false, reason: lastError instanceof Error ? lastError.message : 'SQLite unavailable' };
      console.warn('[langquest] SQLite unavailable after retry, falling back to a volatile in-memory store', lastError);
      return new MemoryDocumentStore();
    })();
  }
  return instance;
}
