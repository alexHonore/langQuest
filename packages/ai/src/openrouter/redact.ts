/**
 * Log redaction: learner text never reaches logs or `ai_requests.redacted_log`.
 * We keep role, character count and a non-cryptographic fingerprint for correlation.
 */
import { fnv1a64Hex } from '../util';

export interface RedactedMessage {
  role: string;
  chars: number;
  fingerprint: string;
}

export interface RedactedChatRequest {
  models: readonly string[];
  messages: RedactedMessage[];
  responseFormat: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

export const redactText = (text: string): RedactedMessage & { role: 'text' } => ({ role: 'text', chars: text.length, fingerprint: fnv1a64Hex(text) });

export function redactMessages(messages: ReadonlyArray<{ role: string; content: string }>): RedactedMessage[] {
  return messages.map((m) => ({ role: m.role, chars: m.content.length, fingerprint: fnv1a64Hex(m.content) }));
}

export function redactChatRequest(req: {
  models: readonly string[];
  messages: ReadonlyArray<{ role: string; content: string }>;
  responseFormat?: { type: string } | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
}): RedactedChatRequest {
  return {
    models: [...req.models],
    messages: redactMessages(req.messages),
    responseFormat: req.responseFormat?.type ?? null,
    temperature: req.temperature ?? null,
    maxTokens: req.maxTokens ?? null,
  };
}

/** Strip secrets and learner payloads from an arbitrary error message before logging. */
export function redactErrorMessage(message: string): string {
  return message
    .replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/"data"\s*:\s*"[A-Za-z0-9+/=]{32,}"/g, '"data":"[base64 redacted]"')
    .slice(0, 500);
}
