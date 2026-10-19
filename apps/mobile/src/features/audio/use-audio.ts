/**
 * React bindings for the audio runtime: engine state via
 * `useSyncExternalStore`, download records, listening progress and bookmarks
 * that re-read the local index whenever the manager/engine writes.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AudioEngineEvent } from '@/audio/AudioEngine';
import { INITIAL_ENGINE_STATE, type AudioEngineState } from '@/audio/engine-state';
import type { LocalBookmark } from './bookmarks';
import type { DownloadRecord, StorageSummary } from './download-index';
import type { LocalListeningProgress } from './listening-progress';
import { getAudioRuntime, type AudioRuntime } from './runtime';

const runtimeListeners = new Set<() => void>();
let runtimeInstance: AudioRuntime | null = null;
let runtimeRequested = false;

function ensureRuntime(): void {
  if (runtimeRequested) return;
  runtimeRequested = true;
  void getAudioRuntime().then((rt) => {
    runtimeInstance = rt;
    for (const l of runtimeListeners) l();
  });
}

const subscribeRuntime = (listener: () => void): (() => void) => {
  runtimeListeners.add(listener);
  ensureRuntime();
  return () => runtimeListeners.delete(listener);
};

/** The runtime once its local store is open (null during the first frames). */
export function useAudioRuntime(): AudioRuntime | null {
  return useSyncExternalStore(subscribeRuntime, () => runtimeInstance, () => runtimeInstance);
}

const noop = (): void => undefined;

/** Live engine state (idle until the runtime is ready). */
export function useEngineState(): AudioEngineState {
  const runtime = useAudioRuntime();
  return useSyncExternalStore(
    (listener) => (runtime ? runtime.engine.subscribe(listener) : noop),
    () => (runtime ? runtime.engine.getState() : INITIAL_ENGINE_STATE),
    () => INITIAL_ENGINE_STATE,
  );
}

/** Most recent engine event (interruption, URL renewal, sleep timer) for transient notices. */
export function useEngineEvent(): AudioEngineEvent | null {
  const runtime = useAudioRuntime();
  const [event, setEvent] = useState<AudioEngineEvent | null>(null);
  useEffect(() => {
    if (!runtime) return;
    return runtime.subscribeEvents(setEvent);
  }, [runtime]);
  return event;
}

/** Run `handler` for every engine event (the latest closure is used; subscription is per runtime). */
export function useEngineEvents(handler: (event: AudioEngineEvent) => void): void {
  const runtime = useAudioRuntime();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!runtime) return;
    return runtime.subscribeEvents((event) => ref.current(event));
  }, [runtime]);
}

/** Ticks every second while something plays (for the sleep-timer countdown). */
export function useClock(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [active, intervalMs]);
  return now;
}

interface IndexedResult<T> {
  data: T;
  loading: boolean;
  refresh: () => void;
}

/** Re-read something from the local store whenever the download manager or engine writes. */
function useLocalRead<T>(runtime: AudioRuntime | null, read: (rt: AudioRuntime) => Promise<T>, initial: T, deps: readonly unknown[], watchEngine = false): IndexedResult<T> {
  const [data, setData] = useState<T>(initial);
  const [tick, setTick] = useState(0);
  // `loading` is derived: true until the read for the current inputs has settled.
  const key = JSON.stringify([tick, ...deps]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!runtime) return;
    let alive = true;
    void read(runtime)
      .then((d) => {
        if (alive) setData(d);
      })
      .finally(() => {
        if (alive) setLoadedKey(key);
      });
    const unsubDownloads = runtime.downloads.subscribe(() => {
      void read(runtime).then((d) => {
        if (alive) setData(d);
      });
    });
    const unsubEngine = watchEngine
      ? runtime.engine.subscribe(() => {
          void read(runtime).then((d) => {
            if (alive) setData(d);
          });
        })
      : noop;
    return () => {
      alive = false;
      unsubDownloads();
      unsubEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, key]);
  return { data, loading: loadedKey !== key, refresh: () => setTick((t) => t + 1) };
}

export function useDownloadRecord(lessonId: string | null): IndexedResult<DownloadRecord | null> {
  const runtime = useAudioRuntime();
  return useLocalRead(runtime, (rt) => (lessonId ? rt.index.get(lessonId) : Promise.resolve(null)), null, [lessonId]);
}

export function useDownloadList(): IndexedResult<DownloadRecord[]> {
  const runtime = useAudioRuntime();
  return useLocalRead(runtime, (rt) => rt.index.list(), [], []);
}

export function useStorageSummary(): IndexedResult<StorageSummary> {
  const runtime = useAudioRuntime();
  return useLocalRead(runtime, (rt) => rt.index.summary(), { lessons: 0, completeLessons: 0, bytesOnDisk: 0, bytesPending: 0 }, []);
}

export function useContinueListening(limit = 6): IndexedResult<LocalListeningProgress[]> {
  const runtime = useAudioRuntime();
  return useLocalRead(runtime, (rt) => rt.progress.continueListening(limit), [], [limit], true);
}

export function useListeningProgress(lessonId: string | null): IndexedResult<LocalListeningProgress | null> {
  const runtime = useAudioRuntime();
  return useLocalRead(runtime, (rt) => (lessonId ? rt.progress.get(lessonId) : Promise.resolve(null)), null, [lessonId], true);
}

export function useLessonBookmarks(lessonId: string | null): IndexedResult<LocalBookmark[]> & { reload: () => void } {
  const runtime = useAudioRuntime();
  const result = useLocalRead(runtime, (rt) => (lessonId ? rt.bookmarks.list(lessonId) : Promise.resolve([])), [], [lessonId]);
  return { ...result, reload: result.refresh };
}

/** Lesson ids with a complete offline copy (for list badges). */
export function useOfflineLessonIds(): Set<string> {
  const list = useDownloadList();
  return new Set(list.data.filter((r) => r.status === 'complete').map((r) => r.lessonId));
}
