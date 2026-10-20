import { describe, expect, it } from 'vitest';
import type { AiRequestRecord } from '@langquest/ai';
import { CostCeilingExceeded, JobCostTracker } from './cost';
import { MemoryJobsDb } from './test-support/memory-db';

const JOB = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const ADMIN = '66666666-6666-4666-8666-666666666666';

const record = (over: Partial<AiRequestRecord> = {}): AiRequestRecord => ({
  occurredAt: new Date().toISOString(),
  userId: null,
  // Job language contexts carry the job id as `enrollmentId` (`jobLanguageContext`).
  enrollmentId: JOB,
  task: 'content_generation',
  provider: 'openrouter',
  model: 'fake/model',
  profileId: null,
  fallbackIndex: 0,
  latencyMs: 10,
  inputTokens: 100,
  outputTokens: 20,
  audioSeconds: null,
  estimatedCostUsd: 0.002,
  success: true,
  errorCode: null,
  traceId: '',
  redactedLog: { templateId: 't' },
  ...over,
});

describe('JobCostTracker ledger rows (ai_requests)', () => {
  it('never writes the job id as an enrollment, keeps the job id in the redacted log and the job trace id', () => {
    const cost = new JobCostTracker({ jobId: JOB, traceId: `job:${JOB}:1` });
    expect(cost.toLedgerRow(record())).toMatchObject({ enrollment_id: null, user_id: null, profile_id: null, trace_id: `job:${JOB}:1`, redacted_log: { templateId: 't', jobId: JOB } });
    // A real enrollment named by an adapter is passed through untouched.
    const enrollment = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
    expect(cost.toLedgerRow(record({ enrollmentId: enrollment })).enrollment_id).toBe(enrollment);
  });

  it('attributes a staff job to the requester and the measured profile, with the purpose in the redacted log', () => {
    const cost = new JobCostTracker({ jobId: JOB, traceId: 't' });
    const profileId = '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c';
    const row = cost.toLedgerRow(record({ userId: 'ignored-adapter-user' }), { userId: ADMIN, profileId, purpose: 'model_benchmark', log: { sampleSetId: 'core-v1' } });
    expect(row).toMatchObject({ user_id: ADMIN, profile_id: profileId, enrollment_id: null, redacted_log: { purpose: 'model_benchmark', sampleSetId: 'core-v1', jobId: JOB } });
  });

  it('persists through the database: a job row lands, a row naming a non-enrollment id is refused by the foreign key', async () => {
    const db = new MemoryJobsDb();
    const errors: unknown[] = [];
    const cost = new JobCostTracker({ jobId: JOB, traceId: 't', persistAiRequest: (row) => db.logAiRequest(row), onPersistError: (e) => void errors.push(e) });
    cost.record(record());
    // What the admin probes used to send: a random uuid standing in for an enrollment.
    cost.record(record({ enrollmentId: crypto.randomUUID() }));
    await cost.flush();
    expect([...db.tables.ai_requests.values()]).toEqual([expect.objectContaining({ enrollment_id: null, estimated_cost_usd: 0.002 })]);
    expect(errors).toEqual([expect.objectContaining({ code: '23503', message: expect.stringContaining('ai_requests_enrollment_id_fkey') })]);
    // Both attempts count against the job ceiling whether or not the row could be written.
    expect(cost.summary()).toMatchObject({ aiCalls: 2, aiUsd: 0.004 });
  });

  it('an attributed sink shares the tracker ceiling', () => {
    const cost = new JobCostTracker({ jobId: JOB, traceId: 't', maxUsd: 0.001 });
    cost.attributed({ userId: ADMIN, purpose: 'model_benchmark' }).record(record());
    expect(cost.records).toHaveLength(1);
    expect(() => cost.assertBudget()).toThrow(CostCeilingExceeded);
  });
});
