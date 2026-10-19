'use client';
/**
 * Single-image upload for §10.2A visual assets: the regular multipart engine bound to
 * `adminVisualAssetUploadInitiate` (image-only, server fixes `kind: 'image'`), an in-memory store
 * (visual uploads are short-lived and must not mix with the audio queue persisted in IndexedDB),
 * worker hashing and the XHR transport. When the API answers `capability_unsupported` the
 * deployment has no media storage (R2): the hook exposes the server's message so the screen can
 * say so instead of pretending the upload is possible.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RouteKey } from '@langquest/contracts';
import { ApiClientError, type ApiClient, type CallOptions } from '../api';
import { browserApi } from '../api-browser';
import { isStorageUnavailable } from '../visual/slots';
import { UploadEngine } from './engine';
import { createHasher } from './hasher';
import { MemoryUploadStore } from './store';
import { XhrPartTransport } from './transport';
import type { UploadItem } from './types';

export interface ImageUploadState {
  item: UploadItem | null;
  /** Server message when media storage is not enabled on this deployment (`capability_unsupported`). */
  storageUnavailable: string | null;
  /** Local preview of the selected file (object URL; revoked on change / unmount). */
  previewUrl: string | null;
  ready: boolean;
}

export function useImageUpload() {
  const engineRef = useRef<UploadEngine | null>(null);
  const [state, setState] = useState<ImageUploadState>({ item: null, storageUnavailable: null, previewUrl: null, ready: false });
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    const hasher = createHasher();
    const api: Pick<ApiClient, 'call'> = {
      call: async <K extends RouteKey>(key: K, opts?: CallOptions<K>) => {
        try {
          return await browserApi().call(key, opts);
        } catch (error) {
          if (isStorageUnavailable(error)) setState((s) => ({ ...s, storageUnavailable: (error as ApiClientError).message }));
          throw error;
        }
      },
    };
    const engine = new UploadEngine({ api, store: new MemoryUploadStore(), hasher, transport: new XhrPartTransport(), fileConcurrency: 1, initiateRoute: 'adminVisualAssetUploadInitiate' });
    engineRef.current = engine;
    const unsubscribe = engine.subscribe((items) => setState((s) => ({ ...s, item: items[items.length - 1] ?? null })));
    setState((s) => ({ ...s, ready: true }));
    return () => {
      unsubscribe();
      engine.dispose();
      hasher.dispose();
      engineRef.current = null;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    const engine = engineRef.current;
    if (engine) for (const it of engine.getItems()) void engine.cancel(it.localId).then(() => engine.remove(it.localId));
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setState((s) => ({ ...s, item: null, previewUrl: null }));
  }, []);

  /** Replace the current upload (if any) with `file` and start it. */
  const upload = useCallback(
    (file: File) => {
      const engine = engineRef.current;
      if (!engine) return;
      reset();
      const url = URL.createObjectURL(file);
      previewRef.current = url;
      const [added] = engine.addFiles([{ file }], { kind: 'image' });
      setState((s) => ({ ...s, item: added ?? null, previewUrl: url }));
      engine.start();
    },
    [reset],
  );

  const retry = useCallback(() => {
    const engine = engineRef.current;
    const item = engine?.getItems()[0];
    if (engine && item) engine.retry(item.localId);
  }, []);

  /** Upload id of a verified image, ready for `adminVisualAssetRegister` / `adminVisualAssetReplace`. */
  const verifiedUploadId = state.item?.state === 'done' && state.item.result?.status === 'verified' ? state.item.uploadId : null;

  return { state, upload, reset, retry, verifiedUploadId };
}
