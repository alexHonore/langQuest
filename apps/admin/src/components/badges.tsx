'use client';
import clsx from 'clsx';
import type { ContentState, CoverageStatus, JobState, Role } from '@langquest/contracts';
import { useI18n } from '@/src/lib/i18n/client';
import { contentStateKey, coverageKey, jobStateKey, roleKey } from '@/src/lib/i18n';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-fg-secondary border-border',
  info: 'bg-info-soft text-info border-info/30',
  success: 'bg-success-soft text-success border-success/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  error: 'bg-error-soft text-error border-error/30',
  accent: 'bg-accent-soft text-accent-text border-accent/30',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', toneClass[tone])}>
      {children}
    </span>
  );
}

export const CONTENT_STATE_TONE: Record<ContentState, Tone> = {
  imported_draft: 'neutral',
  metadata_needed: 'warning',
  rights_unverified: 'warning',
  transcription_pending: 'info',
  review_needed: 'info',
  approved: 'accent',
  published: 'success',
  unpublished: 'neutral',
  rejected: 'error',
};

/** Localized content-state badge (§7.6 states). */
export function StatusBadge({ state }: { state: ContentState | string }) {
  const { t } = useI18n();
  const tone = (CONTENT_STATE_TONE as Record<string, Tone>)[state] ?? 'neutral';
  return <Badge tone={tone}>{t(contentStateKey(state))}</Badge>;
}

const JOB_TONE: Record<JobState, Tone> = { pending: 'neutral', running: 'info', succeeded: 'success', failed: 'error', review_needed: 'warning' };

export function JobBadge({ state }: { state: JobState | string }) {
  const { t } = useI18n();
  return <Badge tone={(JOB_TONE as Record<string, Tone>)[state] ?? 'neutral'}>{t(jobStateKey(state))}</Badge>;
}

const COVERAGE_TONE: Record<CoverageStatus, Tone> = { complete: 'success', partial: 'warning', planned: 'neutral', unavailable: 'error' };

/** Honest coverage badge for a (track, source) pair; copy comes from `enrollment.coverage.*`. */
export function CoverageBadge({ status, sourceLanguageCode, nativeReviewed }: { status: CoverageStatus | string; sourceLanguageCode?: string; nativeReviewed?: boolean }) {
  const { t } = useI18n();
  const label = t(coverageKey(status), { source: sourceLanguageCode ?? '' });
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={(COVERAGE_TONE as Record<string, Tone>)[status] ?? 'neutral'}>{status}</Badge>
      {sourceLanguageCode ? <span className="text-xs text-fg-muted">{label}</span> : null}
      {nativeReviewed ? <Badge tone="success">{t('enrollment.coverage.nativeReviewed')}</Badge> : null}
    </span>
  );
}

export function RoleBadge({ role }: { role: Role | string }) {
  const { t } = useI18n();
  return <Badge tone={role === 'super_admin' ? 'accent' : 'neutral'}>{t(roleKey(role))}</Badge>;
}

export function BoolBadge({ value, yes, no }: { value: boolean; yes: string; no: string }) {
  return <Badge tone={value ? 'success' : 'warning'}>{value ? yes : no}</Badge>;
}
