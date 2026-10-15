/**
 * Web wiring for the document store: an in-memory store persisted to
 * `localStorage` (expo-sqlite's wasm worker is not bundled for web). Native
 * platforms resolve `sqlite.native.ts` instead. Everything above this module
 * only sees the `DocumentStore` interface.
 */
import { MemoryDocumentStore, type DocumentStore, type KeyValuePersistence } from './document-store';

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

/** Lazily opened singleton store for the web platform. */
export function getDocumentStore(): Promise<DocumentStore> {
  instance ??= Promise.resolve(new MemoryDocumentStore(webPersistence()));
  return instance;
}
