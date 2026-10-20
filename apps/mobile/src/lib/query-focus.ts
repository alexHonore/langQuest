/**
 * React Query focus wiring for React Native (device QA 2026-10-20): Progress kept a reviews list fetched
 * one minute before two reviews fell due, while Home (fetched later) showed "2 expressions à réviser".
 * On native nothing tells React Query that the app or a tab came back into view, so stale queries were
 * never refetched. Two signals fix it:
 * - the app returning to the foreground → `focusManager` (refetches every stale, mounted query);
 * - a tab screen regaining focus → `useRefetchOnFocus` (refetches that screen's stale queries).
 */
import { focusManager } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/** Whether React Query should consider the app focused for an AppState status. */
export function isAppFocused(status: AppStateStatus): boolean {
  return status === 'active';
}

/** Mount once (root providers): forwards AppState to React Query's focus manager on native. */
export function useAppStateFocus(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return; // the browser's visibility events already drive focusManager
    const sub = AppState.addEventListener('change', (status) => focusManager.setFocused(isAppFocused(status)));
    return () => sub.remove();
  }, []);
}

/** Refetch the given (stale) queries whenever the screen regains focus, skipping the first mount. */
export function useRefetchOnFocus(refetchers: readonly { isStale: boolean; refetch: () => unknown }[]): void {
  const first = useRef(true);
  const latest = useRef(refetchers);
  useEffect(() => {
    latest.current = refetchers;
  });
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      for (const q of latest.current) if (q.isStale) void q.refetch();
    }, []),
  );
}
