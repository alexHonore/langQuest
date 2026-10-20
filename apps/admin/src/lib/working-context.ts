'use client';
/**
 * Editorial working context (course track × instruction language), persisted per browser and
 * shared by every screen. Lives outside `shell.tsx` so brand components (mascot, lanterns,
 * cast views) can read it without importing the shell.
 */
import { useSyncExternalStore } from 'react';

export interface WorkingContext {
  courseTrackId: string | null;
  sourceLanguageCode: string | null;
}
const CONTEXT_KEY = 'lq_admin_context';
const DEFAULT_CONTEXT: WorkingContext = { courseTrackId: null, sourceLanguageCode: null };
const contextListeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedContext: WorkingContext = DEFAULT_CONTEXT;

function readContext(): WorkingContext {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CONTEXT_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedContext = raw ? { ...DEFAULT_CONTEXT, ...(JSON.parse(raw) as Partial<WorkingContext>) } : DEFAULT_CONTEXT;
    } catch {
      cachedContext = DEFAULT_CONTEXT;
    }
  }
  return cachedContext;
}
function subscribeContext(cb: () => void) {
  contextListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    contextListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

/** Editorial working context persisted per browser (defaults filters across screens). */
export function useWorkingContext(): [WorkingContext, (next: WorkingContext) => void] {
  const ctx = useSyncExternalStore(subscribeContext, readContext, () => DEFAULT_CONTEXT);
  const update = (next: WorkingContext) => {
    try {
      localStorage.setItem(CONTEXT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    for (const cb of contextListeners) cb();
  };
  return [ctx, update];
}
