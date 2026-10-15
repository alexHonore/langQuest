'use client';
/**
 * Analytics (§12.2): quality, cost, usage and errors from the API analytics routes, charted
 * with recharts. Every panel renders an honest "no data"/"API unreachable" state; nothing is
 * synthesised client-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { COURSE_TRACKS, LANGUAGES, type AnalyticsQuery } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { describeApiError, isUnreachable, type ResponseOf } from '@/src/lib/api';
import { useI18n } from '@/src/lib/i18n/client';
import { formatPercent, formatUsd, isoDate } from '@/src/lib/format';
import { Button, Card, Field, Input, Notice, Select, Spinner, Stat } from '@/src/components/ui';
import { Badge } from '@/src/components/badges';

type Quality = ResponseOf<'adminAnalyticsQuality'>;
type Cost = ResponseOf<'adminAnalyticsCost'>;
type Usage = ResponseOf<'adminAnalyticsUsage'>;
type Errors = ResponseOf<'adminAnalyticsErrors'>;

interface Panel<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}
const idle = <T,>(): Panel<T> => ({ data: null, error: null, loading: false });

const CHART_COLORS = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--info)'];

export function AnalyticsScreen() {
  const { t, locale } = useI18n();
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86400_000);
  const [query, setQuery] = useState<AnalyticsQuery>({ from: isoDate(monthAgo), to: isoDate(today), granularity: 'day' });
  const [quality, setQuality] = useState<Panel<Quality>>(idle());
  const [cost, setCost] = useState<Panel<Cost>>(idle());
  const [usage, setUsage] = useState<Panel<Usage>>(idle());
  const [errors, setErrors] = useState<Panel<Errors>>(idle());
  const [unreachable, setUnreachable] = useState(false);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const load = useCallback(async () => {
    const current = queryRef.current;
    const q: Record<string, string | undefined> = { from: current.from, to: current.to, granularity: current.granularity, trackId: current.trackId, sourceLanguage: current.sourceLanguage };
    setUnreachable(false);
    const run = async <T,>(key: 'adminAnalyticsQuality' | 'adminAnalyticsCost' | 'adminAnalyticsUsage' | 'adminAnalyticsErrors', set: (p: Panel<T>) => void) => {
      set({ data: null, error: null, loading: true });
      try {
        const data = (await browserApi().call(key, { query: q })) as T;
        set({ data, error: null, loading: false });
      } catch (e) {
        if (isUnreachable(e)) setUnreachable(true);
        set({ data: null, error: describeApiError(e).message, loading: false });
      }
    };
    await Promise.all([run<Quality>('adminAnalyticsQuality', setQuality), run<Cost>('adminAnalyticsCost', setCost), run<Usage>('adminAnalyticsUsage', setUsage), run<Errors>('adminAnalyticsErrors', setErrors)]);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Field label={t('admin.ui.anFrom')}>{(id) => <Input id={id} type="date" value={query.from} onChange={(e) => setQuery({ ...query, from: e.target.value })} />}</Field>
        <Field label={t('admin.ui.anTo')}>{(id) => <Input id={id} type="date" value={query.to} onChange={(e) => setQuery({ ...query, to: e.target.value })} />}</Field>
        <Field label={t('admin.ui.anGranularity')}>
          {(id) => (
            <Select id={id} value={query.granularity} onChange={(e) => setQuery({ ...query, granularity: e.target.value as AnalyticsQuery['granularity'] })}>
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="month">month</option>
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.anTrackFilter')}>
          {(id) => (
            <Select id={id} value={query.trackId ?? ''} onChange={(e) => setQuery({ ...query, trackId: (e.target.value || undefined) as AnalyticsQuery['trackId'] })}>
              <option value="">{t('admin.ui.all')}</option>
              {COURSE_TRACKS.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.anSourceFilter')}>
          {(id) => (
            <Select id={id} value={query.sourceLanguage ?? ''} onChange={(e) => setQuery({ ...query, sourceLanguage: (e.target.value || undefined) as AnalyticsQuery['sourceLanguage'] })}>
              <option value="">{t('admin.ui.all')}</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.englishName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button variant="primary" onClick={() => void load()}>
          {t('admin.ui.refresh')}
        </Button>
      </div>
      {unreachable ? <Notice tone="warning">{t('admin.ui.anNeedsApi')}</Notice> : null}

      <PanelFrame title={t('admin.analytics.cost')} panel={cost}>
        {(c) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label={t('admin.ui.anTotal')} value={formatUsd(c.totalUsd, locale)} />
              <Stat label={t('admin.ui.anCostPerLearner')} value={formatUsd(c.estimatedUsdPerActiveLearner, locale)} />
              <Stat label={t('admin.ui.anCostPerConversation')} value={formatUsd(c.usdPerMeaningfulConversation, locale)} hint={t('admin.ui.anCostPerSpeakingMission')} />
              <Stat label={t('admin.ui.anCostPerLesson')} value={formatUsd(c.usdPerReviewedLesson, locale)} />
              <Stat label={t('admin.ui.anStorage')} value={`${c.storageGb.toFixed(2)} GB`} hint={`${c.r2Operations} R2 ops`} />
            </div>
            <TimelineChart data={c.timeline.map((p) => ({ period: p.period, value: p.value }))} label="USD" />
            <div className="grid gap-3 lg:grid-cols-2">
              <table className="w-full text-xs">
                <caption className="text-start font-medium">{t('admin.ui.anByTask')}</caption>
                <tbody>
                  {c.byTask.map((row) => (
                    <tr key={row.task} className="border-t border-border">
                      <td className="py-1">{row.task}</td>
                      <td className="py-1 text-end tabular-nums">{row.requests} req</td>
                      <td className="py-1 text-end tabular-nums">{row.tokens} tok</td>
                      <td className="py-1 text-end tabular-nums">{Math.round(row.audioSeconds)} s</td>
                      <td className="py-1 text-end tabular-nums">{formatUsd(row.usd, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <p className="text-xs font-medium">{t('admin.ui.anByProvider')}</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={c.byProvider}>
                    <XAxis dataKey="provider" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => formatUsd(Number(v), locale)} />
                    <Bar dataKey="usd" fill={CHART_COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-fg-muted">
                  {t('admin.ui.anReconciliation')}: {c.reconciliation.invoicedUsd == null ? t('admin.ui.anNotReconciled') : `${formatUsd(c.reconciliation.invoicedUsd, locale)} (Δ ${formatUsd(c.reconciliation.deltaUsd, locale)})`}
                </p>
              </div>
            </div>
          </div>
        )}
      </PanelFrame>

      <PanelFrame title={t('admin.analytics.quality')} panel={quality}>
        {(q) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('admin.ui.anNativeReviewed')} value={formatPercent(q.nativeReviewedFraction, locale)} />
              <Stat label={t('admin.ui.anRightsCoverage')} value={formatPercent(q.rightsCoverageFraction, locale)} />
              <Stat label={t('admin.ui.anTakedowns')} value={q.unresolvedTakedowns} tone={q.unresolvedTakedowns > 0 ? 'error' : 'default'} />
              <Stat label="Transcript alignment" value={formatPercent(q.transcriptAlignmentQuality, locale)} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <TimelineChart data={q.missionCompletionWithoutHints.map((p) => ({ period: p.period, value: p.value }))} label={t('admin.analytics.missionsCompleted')} percent />
              <TimelineChart data={q.recall7Day.map((p, i) => ({ period: p.period, value: p.value, value2: q.recall30Day[i]?.value ?? null }))} label="recall 7d / 30d" percent secondLabel="30d" />
            </div>
            <div className="grid gap-3 lg:grid-cols-2 text-xs">
              <div>
                <p className="font-medium">{t('admin.analytics.bySource')}</p>
                <ul className="max-h-40 overflow-auto">
                  {q.localizationCoverageBySource.map((row) => (
                    <li key={`${row.trackId}-${row.sourceLanguage}`} className="flex justify-between border-t border-border py-0.5">
                      <span>
                        {row.trackId} ← {row.sourceLanguage}
                      </span>
                      <span className="tabular-nums">{row.pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">{t('admin.ui.anLiveCapability')}</p>
                <ul className="max-h-40 overflow-auto">
                  {q.liveCapabilityByTrack.map((row) => (
                    <li key={`${row.trackId}-${row.task}`} className="flex items-center gap-2 border-t border-border py-0.5">
                      <span>{row.trackId}</span>
                      <span className="text-fg-muted">{row.task}</span>
                      <Badge tone={row.capability.supported ? 'success' : 'error'}>{row.capability.supported ? row.capability.provider : row.capability.reasons.join(', ')}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 font-medium">{t('admin.analytics.dialectIncidents')}</p>
                <ul>
                  {q.falseCorrectionRateByTrack.map((row) => (
                    <li key={row.trackId} className="flex justify-between border-t border-border py-0.5">
                      <span>{row.trackId}</span>
                      <span className="tabular-nums">{formatPercent(row.rate, locale, 1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </PanelFrame>

      <PanelFrame title={t('admin.analytics.usage')} panel={usage}>
        {(u) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={t('admin.ui.anActiveLearners')} value={u.activeLearners.at(-1)?.value ?? 0} />
              <Stat label={t('admin.ui.anRetention')} value={`${formatPercent(u.retentionD7, locale)} / ${formatPercent(u.retentionD30, locale)}`} />
              <Stat label={t('admin.analytics.speakingMinutes')} value={Math.round(u.speakingSeconds.reduce((n, p) => n + p.value, 0) / 60)} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <TimelineChart data={u.activeLearners.map((p) => ({ period: p.period, value: p.value }))} label={t('admin.ui.anActiveLearners')} />
              <TimelineChart data={u.missionsCompleted.map((p, i) => ({ period: p.period, value: p.value, value2: u.concurrentVoiceSessionsPeak[i]?.value ?? null }))} label={t('admin.analytics.missionsCompleted')} secondLabel="voice peak" />
            </div>
            <table className="w-full text-xs">
              <caption className="text-start font-medium">{t('admin.analytics.byTrack')}</caption>
              <tbody>
                {u.byTrack.map((row) => (
                  <tr key={row.trackId} className="border-t border-border">
                    <td className="py-1">{row.trackId}</td>
                    <td className="py-1 text-end tabular-nums">{row.activeLearners}</td>
                    <td className="py-1 text-fg-muted">{row.enrollmentsBySource.map((s) => `${s.sourceLanguage}: ${s.count}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelFrame>

      <PanelFrame title={t('admin.analytics.errors')} panel={errors}>
        {(e) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('admin.ui.anApiErrorRate')} value={formatPercent(e.apiErrorRate.at(-1)?.value ?? null, locale, 2)} />
              <Stat label="timeouts" value={e.timeouts} tone={e.timeouts > 0 ? 'warning' : 'default'} />
              <Stat label={t('admin.ui.anLatency')} value={`${e.latency.apiP95Ms ?? '—'} ms`} hint={`AI audio ${e.latency.timeToFirstAiAudioP95Ms ?? '—'} ms · barge-in ${e.latency.interruptionLatencyP95Ms ?? '—'} ms`} />
              <Stat label="media failures" value={formatPercent(e.mediaFailureRate, locale, 2)} hint={`downloads ${formatPercent(e.downloadFailureRate, locale, 2)}`} />
            </div>
            <TimelineChart data={e.apiErrorRate.map((p) => ({ period: p.period, value: p.value }))} label={t('admin.ui.anApiErrorRate')} percent />
            <div className="grid gap-3 lg:grid-cols-2 text-xs">
              <table className="w-full">
                <caption className="text-start font-medium">{t('admin.analytics.providerFailures')}</caption>
                <tbody>
                  {e.providerFailures.map((row) => (
                    <tr key={`${row.provider}-${row.task}`} className="border-t border-border">
                      <td className="py-1">{row.provider}</td>
                      <td className="py-1 text-fg-muted">{row.task}</td>
                      <td className="py-1 text-end tabular-nums">{row.failures} failures</td>
                      <td className="py-1 text-end tabular-nums">{row.fallbacksUsed} fallbacks</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <p className="font-medium">{t('admin.analytics.sttQuality')}</p>
                <ul>
                  {e.sttConfidenceByTrack.map((row) => (
                    <li key={row.trackId} className="flex justify-between border-t border-border py-0.5">
                      <span>{row.trackId}</span>
                      <span className="tabular-nums">
                        {formatPercent(row.meanConfidence, locale)} · mismatch {formatPercent(row.languageMismatchRate, locale, 1)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 font-medium">{t('admin.ui.anAlerts')}</p>
                {e.alerts.length === 0 ? <p className="text-fg-muted">{t('admin.ui.anNoAlerts')}</p> : null}
                <ul>
                  {e.alerts.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 border-t border-border py-0.5">
                      <Badge tone="error">{a.kind}</Badge>
                      <span>{a.detail}</span>
                      <span className="text-fg-muted">{a.since}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </PanelFrame>
    </div>
  );
}

function PanelFrame<T>({ title, panel, children }: { title: string; panel: Panel<T>; children: (data: T) => React.ReactNode }) {
  const { t } = useI18n();
  return (
    <Card title={title}>
      {panel.loading ? <Spinner label={t('admin.ui.loading')} /> : panel.error ? <Notice tone="warning">{panel.error}</Notice> : panel.data ? children(panel.data) : <p className="text-sm text-fg-muted">{t('admin.analytics.noData')}</p>}
    </Card>
  );
}

function TimelineChart({ data, label, percent, secondLabel }: { data: Array<{ period: string; value: number | null; value2?: number | null }>; label: string; percent?: boolean; secondLabel?: string }) {
  const { t } = useI18n();
  if (data.length === 0) return <p className="text-xs text-fg-muted">{t('admin.analytics.noData')}</p>;
  const fmt = (v: unknown) => (percent ? `${Math.round(Number(v) * 100)}%` : String(v));
  return (
    <div>
      <p className="text-xs font-medium">{label}</p>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="period" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={fmt} domain={percent ? [0, 1] : undefined} />
          <Tooltip formatter={(v) => fmt(v)} />
          <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} dot={false} name={label} connectNulls />
          {secondLabel ? <Line type="monotone" dataKey="value2" stroke={CHART_COLORS[1]} dot={false} name={secondLabel} connectNulls /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
