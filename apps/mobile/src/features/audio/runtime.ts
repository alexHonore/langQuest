/**
 * Process-wide audio runtime: one `AudioEngine` over `expo-audio`, the signed
 * URL lease cache, listening-progress sync, bookmarks, the download index +
 * manager and the local store. Screens and the global mini player read it
 * through the hooks in `use-audio.ts`; nothing here is created twice.
 */
import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { AudioEngine, SourceResolutionError, type AudioEngineEvent, type ProgressReport } from '@/audio/AudioEngine';
import type { QueueItem, ResolvedSource } from '@/audio/engine-state';
import { createExpoNativePlayer } from '@/audio/expo-adapter';
import { PlaybackLeaseCache } from '@/audio/url-renewal';
import { ApiClientError } from '@/lib/api/client';
import { newUuid, nowIso } from '@/lib/ids';
import { isOnlineNow } from '@/lib/network';
import { usePrefs } from '@/state/prefs';
import { getLocalStore, type LocalStore } from '@/store';
import { getAudioEndpoints, isConnectivityError, type AudioEndpoints } from './api';
import { BookmarkStore } from './bookmarks';
import { DownloadIndex, isPlayableOffline, localAudioFile } from './download-index';
import { DownloadManager } from './download-manager';
import { createExpoDownloadFs, downloadsSupported } from './expo-fs-adapter';
import { ListeningProgressSync } from './listening-progress';

export interface AudioRuntime {
  engine: AudioEngine;
  leases: PlaybackLeaseCache;
  progress: ListeningProgressSync;
  bookmarks: BookmarkStore;
  index: DownloadIndex;
  downloads: DownloadManager;
  api: AudioEndpoints;
  local: LocalStore;
  downloadsSupported: boolean;
  /** Last notable engine event (for transient UI notices). */
  subscribeEvents: (listener: (event: AudioEngineEvent) => void) => () => void;
  /** Reconnect / foreground hook: flush positions + bookmarks, resume downloads. */
  onReconnect: () => Promise<void>;
  /** Sign-out: stop playback and forget leases (local downloads stay on disk, keyed by this device). */
  reset: () => Promise<void>;
}

let online = true;
let runtimePromise: Promise<AudioRuntime> | null = null;

/** Keep the runtime's connectivity view in sync with `useOnline` (called by the bridge component). */
export function setAudioRuntimeOnline(value: boolean): void {
  online = value;
}

async function networkClass(): Promise<{ online: boolean; wifi: boolean }> {
  try {
    const s = await getNetworkStateAsync();
    const isOnline = s.isInternetReachable ?? s.isConnected ?? true;
    return { online: isOnline, wifi: s.type === NetworkStateType.WIFI || s.type === NetworkStateType.ETHERNET };
  } catch {
    return { online: true, wifi: false };
  }
}

function toSourceError(error: unknown): SourceResolutionError {
  if (error instanceof SourceResolutionError) return error;
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case 'capability_unsupported':
        return new SourceResolutionError('unsupported', error.message);
      case 'rights_blocked':
        return new SourceResolutionError('rights_blocked', error.message);
      case 'not_found':
        return new SourceResolutionError('source_unavailable', error.message);
      case 'network':
      case 'timeout':
      case 'not_configured':
        return new SourceResolutionError('offline_no_link', error.message);
      default:
        return new SourceResolutionError('playback', error.message);
    }
  }
  return new SourceResolutionError('playback', error instanceof Error ? error.message : 'Playback failed');
}

async function build(): Promise<AudioRuntime> {
  const local = await getLocalStore();
  const api = getAudioEndpoints();
  const leases = new PlaybackLeaseCache((assetId, options) => api.playbackUrl(assetId, { preferredType: 'mobile_encoded', renewal: options.renewal }));
  const index = new DownloadIndex(local.store);
  const fs = createExpoDownloadFs();
  const supported = downloadsSupported();
  const downloads = new DownloadManager({
    index,
    fs,
    fetchPack: async (lessonId) => (await api.downloadPack(lessonId, local.deviceId)).manifest,
    network: networkClass,
    wifiOnly: () => usePrefs.getState().wifiOnlyDownloads,
    now: nowIso,
  });
  const progress = new ListeningProgressSync({
    store: local.store,
    deviceId: local.deviceId,
    newId: newUuid,
    now: nowIso,
    put: (lessonId, body) => api.putProgress(lessonId, body),
    // Same event id as the PUT (server dedupes) and the LESSON revision (what the server compares per device).
    enqueueOutbox: (payload, options) => local.outbox.enqueue(payload, null, options.occurredAt, { clientEventId: options.clientEventId, revision: options.revision }),
    isOnline: () => online,
    isConnectivityError,
  });
  const bookmarks = new BookmarkStore({
    store: local.store,
    newId: newUuid,
    now: nowIso,
    create: (body) => api.createBookmark(body),
    enqueueOutbox: (payload) => local.outbox.enqueue(payload, null),
    isOnline: () => online,
    isConnectivityError,
  });

  const eventListeners = new Set<(event: AudioEngineEvent) => void>();

  const resolveSource = async (item: QueueItem, options: { renewal: boolean; afterFailure: boolean }): Promise<ResolvedSource> => {
    // 1. Verified local file (airplane mode, A23).
    if (supported) {
      const record = await index.get(item.id);
      if (isPlayableOffline(record)) {
        const file = localAudioFile(record, item.assetId);
        if (file?.localUri) {
          if (await fs.exists(file.localUri)) return { uri: file.localUri, kind: 'local', expiresAt: null, assetId: file.assetId };
          // The index said "Downloaded" but the file is gone: reconcile so the UI stops claiming it (§4.4).
          await downloads.markFileMissing(item.id, file.assetId).catch(() => undefined);
        }
      }
    }
    // 2. Signed URL (renewed before expiry / after a mid-stream failure, A22).
    if (!online && !(await isOnlineNow())) throw new SourceResolutionError('offline_no_link', 'Offline and not downloaded');
    try {
      const lease = options.afterFailure ? await leases.renewAfterFailure(item.assetId) : options.renewal ? await leases.renew(item.assetId) : await leases.acquire(item.assetId);
      if (!lease) throw new SourceResolutionError('playback', 'Playback link could not be renewed');
      return { uri: lease.url, kind: 'remote', expiresAt: lease.expiresAt, assetId: lease.assetId };
    } catch (error) {
      throw toSourceError(error);
    }
  };

  const onProgress = (report: ProgressReport): void => {
    const { item } = report;
    void progress.record(
      { lessonId: item.id, positionMs: report.positionMs, durationMs: report.durationMs, completed: report.completed, meta: { title: item.title, subtitle: item.subtitle, collectionId: item.collectionId, chapterId: item.chapterId, artworkUri: item.artworkUri, courseTrackId: item.courseTrackId } },
      { flush: report.reason !== 'tick' },
    );
  };

  const engine = new AudioEngine({
    player: createExpoNativePlayer(),
    resolveSource,
    onProgress,
    onEvent: (event) => {
      for (const l of eventListeners) l(event);
    },
  });

  if (supported) void downloads.resumeInterrupted();

  return {
    engine,
    leases,
    progress,
    bookmarks,
    index,
    downloads,
    api,
    local,
    downloadsSupported: supported,
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onReconnect: async () => {
      await Promise.all([progress.flushAll(), bookmarks.flushPending(), supported ? downloads.onNetworkChange() : Promise.resolve()]);
    },
    reset: async () => {
      await engine.stop();
      leases.clear();
    },
  };
}

/** Lazily built singleton (the native player is created on first use, not at app start). */
export function getAudioRuntime(): Promise<AudioRuntime> {
  runtimePromise ??= build();
  return runtimePromise;
}
