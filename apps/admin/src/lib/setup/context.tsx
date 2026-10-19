'use client';
/**
 * Deployment setup status for client components (CONVENTIONS §8): the studio layout observes the public
 * API signals once per request and hands the non-secret result down. Components use `useDeployment()`
 * to NOT render controls whose backing capability is missing (never to grey them out) and `SetupCard`
 * to show the exact next step where a whole page lost its purpose.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { UNKNOWN_CAPABILITIES, type DeploymentCapabilities, type SetupStatus } from './derive';

export interface SetupContextValue extends SetupStatus {
  /** The signed-in roles may open `/setup` (admins); others see the next step inline only. */
  canOpenSetup: boolean;
}

const EMPTY: SetupContextValue = { items: [], capabilities: UNKNOWN_CAPABILITIES, incomplete: true, checkedAt: '', canOpenSetup: false };
const SetupContext = createContext<SetupContextValue>(EMPTY);

export function DeploymentProvider({ value, children }: { value: SetupContextValue; children: ReactNode }) {
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}

/** Non-secret deployment capabilities; outside the studio layout everything reads as unavailable. */
export function useDeployment(): DeploymentCapabilities {
  return useContext(SetupContext).capabilities;
}

/** Full setup status (checklist items + capabilities). */
export function useSetupStatus(): SetupContextValue {
  return useContext(SetupContext);
}
