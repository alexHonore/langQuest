/**
 * Explicit fallback-language opt-in per enrollment (§2.1: "If a fallback is
 * necessary, show the learner and let them opt into it"). The editorial row
 * only OFFERS `fallbackSourceLanguageCode`; nothing is served in it until the
 * learner accepts, and the acceptance is withdrawn automatically when the
 * offered fallback changes. Stored device-locally in prefs (cross-package gap:
 * a server-side field on the enrollment).
 */
import type { EnrollmentDto, SourceLanguageCode } from '@langquest/contracts';
import { useCallback } from 'react';
import { usePrefs } from '@/state/prefs';

export interface FallbackOptIn {
  /** Fallback the editorial coverage offers for this (track, source) pair, if any. */
  offered: SourceLanguageCode | null;
  /** The fallback the learner accepted — only when it is the one currently offered. */
  active: SourceLanguageCode | null;
  optIn: () => void;
  optOut: () => void;
}

export function resolveFallbackOptIn(enrollment: Pick<EnrollmentDto, 'id' | 'coverage'> | null, optIns: Record<string, SourceLanguageCode>): { offered: SourceLanguageCode | null; active: SourceLanguageCode | null } {
  const offered = enrollment?.coverage.fallbackSourceLanguageCode ?? null;
  const accepted = enrollment ? (optIns[enrollment.id] ?? null) : null;
  return { offered, active: offered && accepted === offered ? offered : null };
}

export function useFallbackOptIn(enrollment: Pick<EnrollmentDto, 'id' | 'coverage'> | null): FallbackOptIn {
  const optIns = usePrefs((s) => s.fallbackOptIns);
  const set = usePrefs((s) => s.setFallbackOptIn);
  const { offered, active } = resolveFallbackOptIn(enrollment, optIns);
  const optIn = useCallback(() => {
    if (enrollment && offered) set(enrollment.id, offered);
  }, [enrollment, offered, set]);
  const optOut = useCallback(() => {
    if (enrollment) set(enrollment.id, null);
  }, [enrollment, set]);
  return { offered, active, optIn, optOut };
}
