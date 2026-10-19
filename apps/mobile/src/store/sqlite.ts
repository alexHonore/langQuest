/**
 * Web wiring for the document store: an in-memory store persisted to
 * `localStorage` (expo-sqlite's wasm worker is not bundled for web). Native
 * platforms resolve `sqlite.native.ts` instead. Everything above this module
 * only sees the `DocumentStore` interface plus `getStoreMode()`.
 */
import { MemoryDocumentStore, type DocumentStore, type KeyValuePersistence } from './document-store';

export interface StoreMode {
  /** True when writes survive a page reload. */
  persistent: boolean;
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

let instance: Promise<DocumentStore> | null = null;
let mode: StoreMode = { persistent: true, reason: null };

export function getStoreMode(): StoreMode {
  return mode;
}

/** Lazily opened singleton store for the web platform. */
export function getDocumentStore(): Promise<DocumentStore> {
  if (!instance) {
    const persistence = webPersistence();
    mode = persistence ? { persistent: true, reason: null } : { persistent: false, reason: 'localStorage unavailable' };
    instance = Promise.resolve(new MemoryDocumentStore(persistence));
  }
  return instance;
}
