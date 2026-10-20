/**
 * Pure helpers for the Studio analytics screen (§12.2): which spend-attribution figures the cost panel shows and which
 * reads a panel computed from part of the rows. Nothing is synthesised: a figure the API did not send (an older server)
 * or sent as `null` (no honest figure under a track / source filter) is not shown, while a measured 0 is.
 */
import type { AnalyticsTruncatedRead } from '@langquest/contracts';

export type SpendKind = 'learner' | 'staffAndJobs' | 'unattributed';

export interface SpendFigure {
  kind: SpendKind;
  usd: number;
}

/** The cost fields the split is built from (`AnalyticsCostResponseSchema`; all optional for servers before 2026-10-20). */
export interface SpendSplitInput {
  learnerUsd?: number;
  staffAndJobsUsd?: number | null;
  unattributedUsd?: number | null;
}

const isFigure = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The spend split in a fixed order (learner, staff and jobs, unattributed), keeping only the figures the API computed.
 * Unscoped, the three add up to `totalUsd`; under a filter only the learner figure exists.
 */
export function spendSplit(cost: SpendSplitInput): SpendFigure[] {
  const figures: [SpendKind, number | null | undefined][] = [
    ['learner', cost.learnerUsd],
    ['staffAndJobs', cost.staffAndJobsUsd],
    ['unattributed', cost.unattributedUsd],
  ];
  return figures.filter((f): f is [SpendKind, number] => isFigure(f[1])).map(([kind, usd]) => ({ kind, usd }));
}

/**
 * The reads a panel computed from part of its rows, as the API lists them in `truncated` (empty: every figure used
 * every matching row; also empty for an older server, which only set the response header).
 */
export function truncatedReadsOf(panel: { truncated?: readonly AnalyticsTruncatedRead[] } | null | undefined): AnalyticsTruncatedRead[] {
  return [...(panel?.truncated ?? [])];
}
