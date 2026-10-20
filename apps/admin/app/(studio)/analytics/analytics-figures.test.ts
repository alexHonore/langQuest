import { AnalyticsCostResponseSchema } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { getTranslator } from '@/src/lib/i18n';
import { spendSplit, truncatedReadsOf } from './analytics-figures';

describe('spendSplit: the cost panel shows only the attribution figures the API computed', () => {
  it('unscoped: learner, staff and jobs, unattributed, in that order, measured zeros included', () => {
    expect(spendSplit({ learnerUsd: 0.75, staffAndJobsUsd: 3, unattributedUsd: 0 })).toEqual([
      { kind: 'learner', usd: 0.75 },
      { kind: 'staffAndJobs', usd: 3 },
      { kind: 'unattributed', usd: 0 },
    ]);
  });

  it('under a track or source filter only the learner figure exists (the API sends null for the other two)', () => {
    expect(spendSplit({ learnerUsd: 0.5, staffAndJobsUsd: null, unattributedUsd: null })).toEqual([{ kind: 'learner', usd: 0.5 }]);
  });

  it('an older server that sends none of the fields shows no split at all (nothing synthesised)', () => {
    const older = AnalyticsCostResponseSchema.parse({ totalUsd: 1, byTask: [], byProvider: [], storageGb: 0, r2Operations: 0, estimatedUsdPerActiveLearner: null, usdPerMeaningfulConversation: null, usdPerReviewedLesson: null, timeline: [], reconciliation: { invoicedUsd: null, deltaUsd: null, asOf: null } });
    expect(spendSplit(older)).toEqual([]);
  });
});

describe('truncatedReadsOf: the truncation notice', () => {
  it('lists the reads the API named, and nothing for an exact panel or an older server', () => {
    const reads = [{ read: 'ai_requests', fetched: 5000, total: 12000 }];
    expect(truncatedReadsOf({ truncated: reads })).toEqual(reads);
    expect(truncatedReadsOf({ truncated: [] })).toEqual([]);
    expect(truncatedReadsOf({})).toEqual([]);
    expect(truncatedReadsOf(null)).toEqual([]);
  });

  it('the notice and the split labels read naturally in en and fr', () => {
    const en = getTranslator('en');
    const fr = getTranslator('fr');
    const read = en.t('admin.ui.anTruncatedRead', { read: 'ai_requests', fetched: 5000, total: 12000 });
    expect(read).toBe('ai_requests: 5,000 of 12,000 rows');
    expect(en.t('admin.ui.anTruncated', { reads: read })).toBe('Partial data: ai_requests: 5,000 of 12,000 rows. These figures use only the rows read.');
    expect(fr.t('admin.ui.anTruncatedRead', { read: 'ai_requests', fetched: 5000, total: 12000 })).toMatch(/^ai_requests : 5\s000 sur 12\s000 lignes$/);
    expect(en.t('admin.ui.anLearnerSpendHint', { count: 1 })).toBe('1 active learner');
    expect(fr.t('admin.ui.anLearnerSpendHint', { count: 2 })).toBe('2 apprenants actifs');
    for (const key of ['anLearnerSpend', 'anStaffJobsSpend', 'anStaffJobsSpendHint', 'anUnattributedSpend', 'anUnattributedSpendHint']) {
      expect(en.t(`admin.ui.${key}`)).not.toBe(`admin.ui.${key}`);
      expect(fr.t(`admin.ui.${key}`)).not.toBe(en.t(`admin.ui.${key}`));
    }
  });
});
