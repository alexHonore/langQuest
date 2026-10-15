/**
 * Connectivity (expo-network). `useOnline` is the single source of truth for
 * offline banners and for the sync engine's reconnect trigger.
 */
import { addNetworkStateListener, getNetworkStateAsync, useNetworkState } from 'expo-network';
import { useEffect, useRef } from 'react';

export function useOnline(): boolean {
  const state = useNetworkState();
  // Unknown (null) is treated as online so we never block on a missing signal.
  return state.isInternetReachable ?? state.isConnected ?? true;
}

export async function isOnlineNow(): Promise<boolean> {
  try {
    const s = await getNetworkStateAsync();
    return s.isInternetReachable ?? s.isConnected ?? true;
  } catch {
    return true;
  }
}

/** Fire `onReconnect` on every offline → online transition. */
export function useReconnect(onReconnect: () => void): void {
  const wasOnline = useRef<boolean | null>(null);
  useEffect(() => {
    const sub = addNetworkStateListener((event) => {
      const online = event.isInternetReachable ?? event.isConnected ?? true;
      if (wasOnline.current === false && online) onReconnect();
      wasOnline.current = online;
    });
    return () => sub.remove();
  }, [onReconnect]);
}
