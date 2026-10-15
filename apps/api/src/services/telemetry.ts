/**
 * Telemetry sinks for the Worker (§12.2, §11): every AI call lands in `ai_requests` (redacted metadata,
 * estimated cost) through the service client; language-quality incidents (wrong dialect) are flagged in
 * `moderation_incidents` for operator review. Writes are deferred with `waitUntil` so they never add latency.
 */
import type { AiRequestRecord, AiRequestSink } from '@langquest/ai/reasoner';
import type { QualityIncident, QualityIncidentSink } from '@langquest/ai/prompts/language-guard';
import type { DbClient } from '@langquest/db/client';
import type { Insert } from '@langquest/db/types';
import { redactDeep } from '@langquest/telemetry/privacy';
import type { Logger } from '../middleware/logging';

export interface TelemetryDeps {
  service: DbClient;
  log: Logger;
  waitUntil: (p: Promise<unknown>) => void;
  /** DB profile ids (FK target); records naming an unknown profile id are stored with `profile_id = null`. */
  knownProfileIds: () => ReadonlySet<string>;
  /** Adapters log pseudonymously (`userId: null`); the API attributes the row to the requesting learner for cost accounting. */
  defaultUserId?: string | null;
}

/** Map an adapter record onto the `ai_requests` ledger row. */
export function toAiRequestRow(record: AiRequestRecord, knownProfileIds: ReadonlySet<string>, defaultUserId: string | null = null): Insert<'ai_requests'> {
  return {
    user_id: record.userId ?? defaultUserId,
    enrollment_id: record.enrollmentId,
    task: record.task,
    provider: record.provider,
    model: record.model,
    profile_id: record.profileId && knownProfileIds.has(record.profileId) ? record.profileId : null,
    fallback_index: record.fallbackIndex,
    latency_ms: record.latencyMs,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    audio_seconds: record.audioSeconds,
    estimated_cost_usd: record.estimatedCostUsd,
    success: record.success,
    error_code: record.errorCode,
    trace_id: record.traceId,
    redacted_log: record.redactedLog ? (redactDeep(record.redactedLog) as Insert<'ai_requests'>['redacted_log']) : null,
    created_at: record.occurredAt,
  };
}

export function createAiRequestSink(deps: TelemetryDeps): AiRequestSink & { flush(): Promise<void> } {
  const pending: Insert<'ai_requests'>[] = [];
  let scheduled = false;
  const flush = async (): Promise<void> => {
    scheduled = false;
    if (pending.length === 0) return;
    const rows = pending.splice(0, pending.length);
    const res = await deps.service.from('ai_requests').insert(rows);
    if (res.error) deps.log.error('telemetry.ai_requests_failed', { error: res.error.message, rows: rows.length });
  };
  return {
    record(entry) {
      pending.push(toAiRequestRow(entry, deps.knownProfileIds(), deps.defaultUserId ?? null));
      deps.log.info('ai.request', { task: entry.task, model: entry.model, provider: entry.provider, latencyMs: entry.latencyMs, success: entry.success, errorCode: entry.errorCode, estimatedCostUsd: entry.estimatedCostUsd, fallbackIndex: entry.fallbackIndex, traceId: entry.traceId });
      if (!scheduled) {
        scheduled = true;
        deps.waitUntil(Promise.resolve().then(flush));
      }
    },
    flush,
  };
}

export function createIncidentSink(deps: Pick<TelemetryDeps, 'service' | 'log' | 'waitUntil'>, context: { userId: string | null; sessionId: string | null }): QualityIncidentSink {
  return {
    record(incident: QualityIncident) {
      deps.log.warn('ai.quality_incident', { kind: incident.kind, varietyId: incident.varietyId, task: incident.task, model: incident.model, detail: incident.detail });
      deps.waitUntil(
        Promise.resolve(
        deps.service
          .from('moderation_incidents')
          .insert({
            user_id: context.userId,
            session_id: context.sessionId,
            kind: 'other',
            severity: incident.kind === 'wrong_variety' ? 'medium' : 'low',
            details: { quality_incident: { kind: incident.kind, varietyId: incident.varietyId, task: incident.task, model: incident.model, detail: incident.detail, textFingerprint: incident.textFingerprint, at: incident.at } },
            action_taken: 'reprompted_or_recovery_line',
          })
          .then((res) => {
            if (res.error) deps.log.error('telemetry.incident_failed', { error: res.error.message });
          }),
        ),
      );
    },
  };
}
