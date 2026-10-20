'use client';
/**
 * Colour-scheme preference (light by default for a work tool, dark available, or follow the
 * system). The resolved scheme is written to `<html data-theme>` so the token CSS applies, and
 * exposed through `useScheme()` for the in-code art renderers (mascot, portraits).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_SCHEME_PREFERENCE, SCHEME_STORAGE_KEY, isSchemePreference, type AdminScheme, type SchemePreference } from './theme';

const listeners = new Set<() => void>();
const MEDIA = '(prefers-color-scheme: dark)';

function readPreference(): SchemePreference {
  try {
    const raw = localStorage.getItem(SCHEME_STORAGE_KEY);
    return isSchemePreference(raw) ? raw : DEFAULT_SCHEME_PREFERENCE;
  } catch {
    return DEFAULT_SCHEME_PREFERENCE;
  }
}
function resolve(pref: SchemePreference): AdminScheme {
  if (pref === 'system') return typeof window !== 'undefined' && window.matchMedia(MEDIA).matches ? 'dark' : 'light';
  return pref;
}
function readScheme(): AdminScheme {
  return resolve(readPreference());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  const mq = window.matchMedia(MEDIA);
  mq.addEventListener('change', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
    mq.removeEventListener('change', cb);
  };
}

export function useSchemePreference(): [SchemePreference, (next: SchemePreference) => void] {
  const pref = useSyncExternalStore(subscribe, readPreference, () => DEFAULT_SCHEME_PREFERENCE);
  const set = (next: SchemePreference) => {
    try {
      localStorage.setItem(SCHEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    for (const cb of listeners) cb();
  };
  return [pref, set];
}

/** Resolved scheme (`light` during SSR, which matches the default preference). */
export function useScheme(): AdminScheme {
  return useSyncExternalStore(subscribe, readScheme, () => 'light');
}

/** Keeps `<html data-theme>` in sync with the preference after hydration. */
export function useApplyScheme(): void {
  const scheme = useScheme();
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', scheme);
  }, [scheme]);
}
