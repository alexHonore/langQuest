/**
 * Spend/trace ledger for content-factory runs, summarised from the `@langquest/ai` request records
 * (re-exported by `content-factory.ts`; a separate module so the review stage can use it without an
 * import cycle).
 */
import type { AiRequestRecord } from '@langquest/ai';

export interface GenerationLedger {
  traceIds: string[];
  models: string[];
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  failures: number;
}

export const ledgerFromRecords = (records: readonly AiRequestRecord[]): GenerationLedger => ({
  traceIds: [...new Set(records.map((r) => r.traceId))],
  models: [...new Set(records.map((r) => r.model))],
  estimatedCostUsd: Math.round(records.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0) * 1e6) / 1e6,
  inputTokens: records.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
  outputTokens: records.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
  calls: records.length,
  failures: records.filter((r) => !r.success).length,
});
