/**
 * Native platform wiring for the document store: `expo-sqlite` on iOS/Android
 * (Metro picks this `.native.ts` file; web uses `sqlite.ts`). Everything above
 * this module only sees the `DocumentStore` interface.
 */
import { Platform } from 'react-native';
import { MemoryDocumentStore, SqlDocumentStore, type DocumentStore, type KeyValuePersistence, type SqlExecutor } from './document-store';

const DB_NAME = 'langquest-learner.db';

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

/** Lazily opened singleton store for the current platform. */
export function getDocumentStore(): Promise<DocumentStore> {
  if (!instance) {
    instance = (async () => {
      if (Platform.OS === 'web') return new MemoryDocumentStore(webPersistence());
      try {
        return new SqlDocumentStore(await expoSqliteExecutor());
      } catch (error) {
        console.warn('[langquest] SQLite unavailable, falling back to in-memory store', error);
        return new MemoryDocumentStore();
      }
    })();
  }
  return instance;
}
