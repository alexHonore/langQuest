/** Server-side environment for `@langquest/ai` (never shipped to mobile/admin bundles). */
import { z } from 'zod';

export const AiEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.url().optional(),
  AZURE_SPEECH_KEY: z.string().min(1).optional(),
  AZURE_SPEECH_REGION: z.string().min(1).optional(),
  /** HMAC secret for realtime session tickets (≥ 16 chars). */
  AI_SESSION_TICKET_SECRET: z.string().min(16).optional(),
  /** Optional WebSocket/HTTP endpoint template for streaming turns; `{sessionId}` is substituted. */
  AI_REALTIME_CONNECT_URL: z.string().optional(),
  AI_APP_NAME: z.string().optional(),
  AI_APP_REFERER: z.string().optional(),
});
export type AiEnv = z.infer<typeof AiEnvSchema>;

/** Parse from `process.env` / Worker bindings; empty strings are treated as unset. */
export function readAiEnv(source: Record<string, string | undefined>): AiEnv {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
  return AiEnvSchema.parse(cleaned);
}
