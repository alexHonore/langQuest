/**
 * App-wide services: typed API endpoints, the local offline store, the
 * progress outbox and the sync engine (flushed on reconnect, foreground and
 * after every enqueue). Screens reach them with `useServices()`.
 */
import type { ProgressEventPayload } from '@langquest/contracts';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { ENV } from '@/config/env';
import { useAuth } from '@/state/auth';
import { getLocalStore, type LocalStore } from '@/store';
import { SyncEngine, type SyncStatus } from '@/store/sync';
import { createApiClient, createUnconfiguredClient } from './api/client';
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
  /** Record a progress event locally and schedule a sync. */
  enqueue: (payload: ProgressEventPayload, enrollmentId: string | null) => Promise<void>;
  syncNow: () => Promise<void>;
  /** Wipe local caches/outbox (sign-out, account deletion). */
  resetLocal: () => Promise<void>;
}

const ServicesContext = createContext<Services | null>(null);

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
      if (alive) setLocal(store);
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

  // Flush when connectivity returns, when the app comes to the foreground and once signed in.
  const onReconnect = useCallback(() => sync?.onReconnect(), [sync]);
  useReconnect(onReconnect);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void isOnlineNow().then((ok) => ok && sync?.onReconnect());
    });
    return () => sub.remove();
  }, [sync]);
  useEffect(() => {
    if (signedIn && sync) sync.requestSync();
  }, [signedIn, sync]);

  const value: Services = {
      api,
      local,
      sync,
      syncStatus,
      pendingEvents,
      online,
      configured: Boolean(ENV.apiBaseUrl),
      enqueue: async (payload, enrollmentId) => {
        const store = local ?? (await getLocalStore());
        await store.outbox.enqueue(payload, enrollmentId);
        setPendingEvents(await store.outbox.pendingCount());
        sync?.requestSync();
      },
      syncNow: async () => {
        await sync?.syncNow();
      },
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
