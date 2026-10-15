/** Errors the API maps onto `ApiErrorCode` values (`capability_unsupported`, `provider_unavailable`). */
import type { Capability } from '@langquest/contracts';

export class AiCapabilityError extends Error {
  readonly code = 'capability_unsupported' as const;
  constructor(
    message: string,
    readonly capability: Capability | null,
    readonly locale: string,
  ) {
    super(message);
    this.name = 'AiCapabilityError';
  }
}

export class AiProviderUnavailableError extends Error {
  readonly code = 'provider_unavailable' as const;
  /** Provider error classification for operator logs (`insufficient_credits`, `auth`, …); never shown to learners. */
  readonly providerErrorKind: string | null;
  readonly requestId: string | null;
  constructor(message: string, readonly provider: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiProviderUnavailableError';
    const cause = options?.cause as { kind?: unknown; requestId?: unknown } | undefined;
    this.providerErrorKind = typeof cause?.kind === 'string' ? cause.kind : null;
    this.requestId = typeof cause?.requestId === 'string' ? cause.requestId : null;
  }
}

/**
 * Provider error kinds that describe the OPERATOR's account or the provider's health (exhausted balance,
 * revoked key, rate limit, outage, network) rather than the request. Learners must never see these as anything
 * but `provider_unavailable`: LangQuest is 100% free, so a provider's "credits"/"balance" wording may not reach
 * a client, and a key problem is an incident, not a user error.
 */
export const OPERATOR_ERROR_KINDS: ReadonlySet<string> = new Set(['auth', 'insufficient_credits', 'rate_limited', 'server_error', 'network', 'timeout']);

/**
 * Convert an operator/account-level provider error into `AiProviderUnavailableError` with LangQuest's own
 * message, keeping the original as `cause` (kind + requestId stay available for operator logs). Any other error
 * is returned unchanged so request-level problems (bad request, invalid model, oversized payload) keep their
 * classification.
 */
export function wrapOperatorError(error: unknown, task: string, provider: string): unknown {
  if (error instanceof AiProviderUnavailableError || error instanceof AiCapabilityError) return error;
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (typeof kind !== 'string' || !OPERATOR_ERROR_KINDS.has(kind)) return error;
  return new AiProviderUnavailableError(`${task} is temporarily unavailable. Please try again in a moment.`, provider, { cause: error });
}
