/**
 * Singleton wiring for the local store: document store, typed cache, outbox
 * and sync engine. Screens use the hooks in `@/state` and `@/lib/services`;
 * this module only builds the objects once per app session.
 */
import { newUuid, nowIso } from '@/lib/ids';
import { createCache, type LocalCache } from './cache';
import type { DocumentStore } from './document-store';
import { Outbox } from './outbox';
import { getDocumentStore } from './sqlite';

export interface LocalStore {
  store: DocumentStore;
  cache: LocalCache;
  outbox: Outbox;
  deviceId: string;
}

let instance: Promise<LocalStore> | null = null;

export function getLocalStore(): Promise<LocalStore> {
  if (!instance) {
    instance = (async () => {
      const store = await getDocumentStore();
      const cache = createCache(store);
      let deviceId = await cache.getMeta<string>('deviceId');
      if (!deviceId) {
        deviceId = newUuid();
        await cache.putMeta('deviceId', deviceId);
      }
      const outbox = new Outbox({ store, newId: newUuid, now: nowIso, deviceId });
      return { store, cache, outbox, deviceId };
    })();
  }
  return instance;
}
