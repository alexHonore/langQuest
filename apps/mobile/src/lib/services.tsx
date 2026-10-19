/**
 * App-wide services: typed API endpoints, the local offline store, the
 * progress outbox and the sync engine (flushed on reconnect, foreground and
 * after every enqueue). Screens reach them with `useServices()`.
 *
 * Also replays queued conversation ends (`POST /conversations/:id/end` that
 * failed offline) whenever connectivity returns (§4.6).
 */
import type { ProgressEventPayload } from '@langquest/contracts';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { ENV } from '@/config/env';
import { useAuth } from '@/state/auth';
import { getLocalStore, type LocalStore } from '@/store';
import { SyncEngine, type SyncStatus } from '@/store/sync';
import { ApiClientError, createApiClient, createUnconfiguredClient } from './api/client';
import { createEndpoints, type Endpoints } from './api/endpoints';
import { isOnlineNow, useOnline, useReconnect } from './network';
import { getAccessToken } from './supabase';
import { track } from './telemetry';

export interface Services {
  api: Endpoints;
  /** Null until the local database is open. */
  local: LocalStore | null;
  sync: SyncEngine | null;
  syncStatus: SyncStatus;
  pendingEvents: number;
  online: boolean;
  configured: boolean;
  /** True when the local database could not be opened: nothing below survives a restart (banner + downloads off). */
  storageDegraded: boolean;
  /** Record a progress event locally and schedule a sync. */
  enqueue: (payload: ProgressEventPayload, enrollmentId: string | null) => Promise<void>;
  syncNow: () => Promise<void>;
  /** Replay conversation ends that could not be delivered; returns how many are still queued. */
  flushPendingConversationEnds: () => Promise<number>;
  /** Wipe local caches/outbox (sign-out, account deletion). */
  resetLocal: () => Promise<void>;
}

const ServicesContext = createContext<Services | null>(null);

/** Replay queued `conversation_end` requests; a non-connectivity failure drops the entry after 5 attempts. */
export async function replayPendingConversationEnds(api: Pick<Endpoints, 'conversationEnd'>, store: LocalStore): Promise<number> {
  const pending = await store.cache.listPendingConversationEnds();
  let remaining = 0;
  for (const p of pending) {
    try {
      await api.conversationEnd(p.sessionId, p.body);
      await store.cache.removePendingConversationEnd(p.sessionId);
    } catch (error) {
      const connectivity = error instanceof ApiClientError && (error.isConnectivity || error.kind === 'not_configured');
      const gone = error instanceof ApiClientError && (error.kind === 'not_found' || error.kind === 'conflict' || error.kind === 'forbidden');
      if (gone || (!connectivity && p.attempts + 1 >= 5)) {
        await store.cache.removePendingConversationEnd(p.sessionId);
        continue;
      }
      await store.cache.putPendingConversationEnd({ ...p, attempts: p.attempts + 1 });
      remaining += 1;
    }
  }
  return remaining;
}

export function ServicesProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const online = useOnline();
  const [local, setLocal] = useState<LocalStore | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [pendingEvents, setPendingEvents] = useState(0);
  const signedIn = useAuth((s) => s.status === 'signed_in');

  const api = useMemo(() => {
    const client = ENV.apiBaseUrl
      ? createApiClient({
          baseUrl: ENV.apiBaseUrl,
          getAccessToken,
          onError: (info) => {
            if (info.status !== null && info.code !== 'network' && info.code !== 'timeout' && info.code !== 'invalid_response') track.apiError(info.route, info.code, info.status, info.traceId);
          },
        })
      : createUnconfiguredClient();
    return createEndpoints(client);
  }, []);

  useEffect(() => {
    let alive = true;
    void getLocalStore().then((store) => {
      if (!alive) return;
      setLocal(store);
      if (!store.persistent) track.clientFault('local_store_volatile', store.degradedReason ?? 'unknown');
    });
    return () => {
      alive = false;
    };
  }, []);

  const sync = useMemo(() => {
    if (!local) return null;
    return new SyncEngine({ outbox: local.outbox, send: (req) => api.progressSync(req), isOnline: () => true });
  }, [local, api]);

  useEffect(() => {
    sync?.setOnline(online);
  }, [sync, online]);

  useEffect(() => {
    if (!sync) return;
    const unsub = sync.subscribe((status, pending) => {
      setSyncStatus(status);
      setPendingEvents(pending);
    });
    void local?.outbox.pendingCount().then(setPendingEvents);
    return () => {
      unsub();
      sync.dispose();
    };
  }, [sync, local]);

  const flushPendingConversationEnds = useCallback(async (): Promise<number> => {
    if (!local || !signedIn) return 0;
    return replayPendingConversationEnds(api, local);
  }, [api, local, signedIn]);

  // Flush when connectivity returns, when the app comes to the foreground and once signed in.
  const onReconnect = useCallback(() => {
    sync?.onReconnect();
    void flushPendingConversationEnds();
  }, [sync, flushPendingConversationEnds]);
  useReconnect(onReconnect);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void isOnlineNow().then((ok) => ok && onReconnect());
    });
    return () => sub.remove();
  }, [onReconnect]);
  useEffect(() => {
    if (signedIn && sync) {
      sync.requestSync();
      void flushPendingConversationEnds();
    }
  }, [signedIn, sync, flushPendingConversationEnds]);

  const value: Services = {
    api,
    local,
    sync,
    syncStatus,
    pendingEvents,
    online,
    configured: Boolean(ENV.apiBaseUrl),
    storageDegraded: local ? !local.persistent : false,
    enqueue: async (payload, enrollmentId) => {
      const store = local ?? (await getLocalStore());
      await store.outbox.enqueue(payload, enrollmentId);
      setPendingEvents(await store.outbox.pendingCount());
      sync?.requestSync();
    },
    syncNow: async () => {
      await sync?.syncNow();
      await flushPendingConversationEnds();
    },
    flushPendingConversationEnds,
    resetLocal: async () => {
      const store = local ?? (await getLocalStore());
      await store.outbox.clear();
      await store.cache.reset();
      setPendingEvents(0);
    },
  };

  return <ServicesContext.Provider value={value}>{props.children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used inside ServicesProvider');
  return ctx;
}
