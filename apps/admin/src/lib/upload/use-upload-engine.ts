'use client';
/**
 * React binding for the upload engine: one engine per page lifetime, IndexedDB persistence,
 * worker hashing, XHR transport and the browser API client. Exposes the item snapshot plus
 * the restore/attach workflow for interrupted sessions.
 */
import { useEffect, useRef, useState } from 'react';
import { browserApi } from '../api-browser';
import { UploadEngine, type AddFileInput } from './engine';
import { createHasher, type Hasher } from './hasher';
import { readId3Preview } from './id3';
import { createUploadStore } from './store';
import { XhrPartTransport } from './transport';
import type { UploadItem } from './types';

export interface UploadEngineState {
  items: UploadItem[];
  ready: boolean;
  storeMode: 'indexeddb' | 'memory' | null;
  hasherMode: Hasher['mode'] | null;
  restoredCount: number;
}

export function useUploadEngine(options: { fileConcurrency: number }) {
  const engineRef = useRef<UploadEngine | null>(null);
  const [state, setState] = useState<UploadEngineState>({ items: [], ready: false, storeMode: null, hasherMode: null, restoredCount: 0 });

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      const { store, mode } = await createUploadStore();
      if (disposed) return;
      const hasher = createHasher();
      const engine = new UploadEngine({
        api: browserApi(),
        store,
        hasher,
        transport: new XhrPartTransport(),
        fileConcurrency: options.fileConcurrency,
        readTags: readId3Preview,
      });
      engineRef.current = engine;
      const restored = await engine.restore();
      unsubscribe = engine.subscribe((items) => setState((s) => ({ ...s, items: [...items] })));
      setState((s) => ({ ...s, ready: true, storeMode: mode, hasherMode: hasher.mode, restoredCount: restored.length }));
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // The engine is created once; concurrency changes apply to the next page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state.items.some((i) => ['hashing', 'initiating', 'uploading', 'completing', 'verifying'].includes(i.state))) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.items]);

  return {
    state,
    addFiles: (inputs: AddFileInput[], kind?: 'audio' | 'image' | 'document') => engineRef.current?.addFiles(inputs, kind ? { kind } : {}) ?? [],
    start: () => engineRef.current?.start(),
    pause: (id?: string) => engineRef.current?.pause(id),
    resume: (id?: string) => engineRef.current?.resume(id),
    retry: (id?: string) => engineRef.current?.retry(id),
    cancel: (id: string) => engineRef.current?.cancel(id),
    remove: (id: string) => engineRef.current?.remove(id),
    clearFinished: () => engineRef.current?.clearFinished(),
  };
}
