/**
 * Sign-out safety (§4.5 "never delete progress"): flush the outbox first and
 * tell the caller how many events are still unsent so the screen can ask for
 * confirmation instead of silently wiping them. Pure, unit-tested.
 */
export interface SignOutDeps {
  /** Attempt a sync now (no-op when offline). */
  syncNow: () => Promise<void>;
  pendingCount: () => Promise<number>;
}

export interface SignOutReadiness {
  /** Events that would be lost by wiping the local store now. */
  pending: number;
  /** True when the flush attempt itself threw (server unreachable). */
  flushFailed: boolean;
}

/** Flush, then report what is still pending. Never wipes anything itself. */
export async function prepareSignOut(deps: SignOutDeps): Promise<SignOutReadiness> {
  let flushFailed = false;
  try {
    await deps.syncNow();
  } catch {
    flushFailed = true;
  }
  const pending = await deps.pendingCount();
  return { pending, flushFailed };
}
