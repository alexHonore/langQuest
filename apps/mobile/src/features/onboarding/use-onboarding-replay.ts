/**
 * Replays the onboarding course selection into an enrollment once `/v1/me` has loaded from the network
 * (so an existing enrollment is seen before creating one), then makes it the active course and
 * refreshes the learner queries. Runs once per selection; a connectivity failure keeps the selection
 * for a retry, any other failure drops it so the learner is not stuck behind a request that cannot
 * succeed (the message stays on screen until they move on).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveEnrollment, useInvalidateLearner } from '@/features/session/queries';
import { ApiClientError } from '@/lib/api/client';
import { newUuid } from '@/lib/ids';
import { useReconnect } from '@/lib/network';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';
import { pendingOnboardingSelection, replayPendingOnboarding } from './replay';

export type OnboardingReplayState = { status: 'idle' } | { status: 'running' } | { status: 'failed'; error: unknown; retryable: boolean };

const isConnectivity = (error: unknown): boolean => error instanceof ApiClientError && (error.isConnectivity || error.kind === 'not_configured');

export function useOnboardingReplay(): { state: OnboardingReplayState; pending: boolean; retry: () => void } {
  const { api } = useServices();
  const invalidate = useInvalidateLearner();
  const { enrollments, query } = useActiveEnrollment();
  // One primitive selector per field: an object-returning selector would be a new snapshot every render.
  const pendingTrackId = usePrefs((s) => s.pendingTrackId);
  const pendingDefaultSourceLanguage = usePrefs((s) => s.pendingDefaultSourceLanguage);
  const pendingScriptMode = usePrefs((s) => s.pendingScriptMode);
  const pendingRegionalOption = usePrefs((s) => s.pendingRegionalOption);
  const pendingEnrollmentKey = usePrefs((s) => s.pendingEnrollmentKey);
  const set = usePrefs((s) => s.set);
  const selection = pendingOnboardingSelection({ pendingTrackId, pendingDefaultSourceLanguage, pendingScriptMode, pendingRegionalOption, pendingEnrollmentKey });
  const [state, setState] = useState<OnboardingReplayState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const meLoadedLive = Boolean(query.data) && !query.data?.fromCache;

  useEffect(() => {
    if (!selection || !meLoadedLive || running.current || state.status === 'failed') return;
    running.current = true;
    setState({ status: 'running' });
    void (async () => {
      const outcome = await replayPendingOnboarding({
        selection,
        existingEnrollments: enrollments,
        createEnrollment: (body, key) => api.enrollmentCreate(body, key),
        newIdempotencyKey: newUuid,
        isRetryable: isConnectivity,
      });
      const clearPending = { pendingTrackId: null, pendingScriptMode: null, pendingRegionalOption: null, pendingEnrollmentKey: null } as const;
      switch (outcome.kind) {
        case 'created':
        case 'existing':
          if (outcome.kind === 'created') track.onboardingStep('enrolled');
          set({ ...clearPending, activeEnrollmentId: outcome.enrollmentId });
          await invalidate();
          setState({ status: 'idle' });
          break;
        case 'failed':
          // Keep the key so a retry replays the same request; drop the selection when retrying cannot help.
          set(outcome.retryable ? { pendingEnrollmentKey: outcome.idempotencyKey } : clearPending);
          setState({ status: 'failed', error: outcome.error, retryable: outcome.retryable });
          break;
        default:
          set(clearPending);
          setState({ status: 'idle' });
      }
      running.current = false;
    })();
    // The selection object is rebuilt on every render; its fields and the attempt counter are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.trackId, selection?.sourceLanguageCode, selection?.scriptMode, selection?.regionalOption, meLoadedLive, attempt, state.status]);

  const retry = useCallback(() => {
    setState({ status: 'idle' });
    setAttempt((n) => n + 1);
  }, []);
  // Back online after a connectivity failure: try again on its own.
  const retryIfConnectivity = useCallback(() => {
    if (state.status === 'failed' && state.retryable) retry();
  }, [state, retry]);
  useReconnect(retryIfConnectivity);
  return { state, pending: Boolean(selection), retry };
}
