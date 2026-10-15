/**
 * Connects the audio runtime to app-level signals: connectivity (flush
 * positions/bookmarks, resume downloads on reconnect), app background
 * (flush the current position so another device can resume, §14.1 A23) and
 * sign-out (stop playback, forget signed URLs). Renders nothing.
 */
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useReconnect } from '@/lib/network';
import { useServices } from '@/lib/services';
import { useAuth } from '@/state/auth';
import { setAudioRuntimeOnline } from '../runtime';
import { useAudioRuntime } from '../use-audio';

export function AudioRuntimeBridge(): React.JSX.Element | null {
  const runtime = useAudioRuntime();
  const { online } = useServices();
  const signedIn = useAuth((s) => s.status === 'signed_in');

  useEffect(() => {
    setAudioRuntimeOnline(online);
    if (online && runtime) void runtime.onReconnect();
  }, [online, runtime]);

  useReconnect(() => {
    if (runtime) void runtime.onReconnect();
  });

  useEffect(() => {
    if (!runtime) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') void runtime.progress.flushAll();
      if (next === 'active') void runtime.onReconnect();
    });
    return () => sub.remove();
  }, [runtime]);

  useEffect(() => {
    if (!signedIn && runtime) void runtime.reset();
  }, [signedIn, runtime]);

  return null;
}
