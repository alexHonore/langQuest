'use client';
/**
 * §7.4 AI organisation suggestions review queue. Nothing applies without a human decision:
 * approve (optionally with an edited proposal) / reject with a note, per row or in bulk, and a
 * generate action that only enqueues `infer_metadata` jobs. The proposal is shown next to the
 * current value; confidence is the model's self-report (or "not reported"), never a score.
 * `applied` from the API is the only source of truth for "the lesson actually changed".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ASSET_SUGGESTION_KIND_VALUES,
  CONTENT_STATE_VALUES,
  REVIEW_STATUS_VALUES,
  type AssetSuggestionDecideRequest,
  type AssetSuggestionDto,
  type AssetSuggestionsBulkDecideRequest,
  type AssetSuggestionsBulkDecideResponse,
  type AssetSuggestionsGenerateRequest,
  type AssetSuggestionsGenerateResponse,
  type AssetSuggestionsListQuery,
  type ContentState,
  type ReviewStatus,
} from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { describeApiError, isUnreachable } from '@/src/lib/api';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatDateTime, newIdempotencyKey, shortId } from '@/src/lib/format';
import { currentFields, formatConfidence, parseOverride, proposalChanges, proposedFields } from '@/src/lib/suggestions/format';
import { Badge } from '@/src/components/badges';
import { DataTable, type Column } from '@/src/components/data-table';
import { Dialog } from '@/src/components/dialog';
import { Button, Checkbox, ErrorState, Field, Input, Mono, Notice, Select, Textarea } from '@/src/components/ui';
import { useDeployment } from '@/src/lib/setup/context';

const PENDING: ReadonlySet<ReviewStatus> = new Set(['draft', 'review_needed', 'in_review']);
const REVIEW_TONE: Record<ReviewStatus, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = { draft: 'neutral', review_needed: 'warning', in_review: 'info', approved: 'success', rejected: 'error' };

type Filters = { reviewStatus: string; kind: string; minConfidence: string; lessonId: string; mediaAssetId: string };
const DEFAULT_FILTERS: Filters = { reviewStatus: 'review_needed', kind: '', minConfidence: '', lessonId: '', mediaAssetId: '' };

function toQuery(f: Filters, cursor: string | null): AssetSuggestionsListQuery {
  const min = f.minConfidence === '' ? Number.NaN : Number(f.minConfidence);
  return {
    reviewStatus: (f.reviewStatus || undefined) as AssetSuggestionsListQuery['reviewStatus'],
    kind: (f.kind || undefined) as AssetSuggestionsListQuery['kind'],
    minConfidence: Number.isFinite(min) ? Math.min(1, Math.max(0, min)) : undefined,
    lessonId: f.lessonId.length === 36 ? f.lessonId : undefined,
    mediaAssetId: f.mediaAssetId.length === 36 ? f.mediaAssetId : undefined,
    cursor: cursor ?? undefined,
    limit: 50,
  };
}

function ProposalDiff({ s }: { s: AssetSuggestionDto }) {
  const { t } = useI18n();
  const fields = proposedFields(s.suggestion);
  const current = currentFields(s.currentValue, s.suggestion);
  if (fields.length === 0) return <span className="text-xs text-fg-muted">—</span>;
  return (
    <table className="text-xs">
      <thead className="text-fg-muted">
        <tr>
          <th scope="col" className="pe-2 text-start font-medium">{t('admin.ui.sgField')}</th>
          <th scope="col" className="pe-2 text-start font-medium">{t('admin.ui.sgCurrent')}</th>
          <th scope="col" className="text-start font-medium">{t('admin.ui.sgProposed')}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.key} className={current[f.key] === f.value ? 'text-fg-muted' : ''}>
            <td className="pe-2 font-mono">{f.key}</td>
            <td className="pe-2">{f.key in current ? current[f.key] : <span className="italic">{t('admin.ui.sgNoCurrent')}</span>}</td>
            <td className={current[f.key] === f.value ? '' : 'font-medium'}>{f.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SuggestionsScreen({ canDecide }: { canDecide: boolean }) {
  const { t, locale } = useI18n();
  const { aiAvailable } = useDeployment();
  const canGenerate = canDecide && aiAvailable;
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; page: { items: AssetSuggestionDto[]; nextCursor: string | null; total: number | null } | null; error: { unreachable: boolean; message: string } | null } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deciding, setDeciding] = useState<{ s: AssetSuggestionDto; decision: 'approve' | 'reject' } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkResult, setBulkResult] = useState<AssetSuggestionsBulkDecideResponse | null>(null);
  const cursor = cursors[cursors.length - 1] ?? null;
  // One request per (filters, cursor, nonce); `loading` is derived, so the effect never sets state synchronously.
  const key = useMemo(() => JSON.stringify([filters, cursor, nonce]), [filters, cursor, nonce]);
  useEffect(() => {
    let cancelled = false;
    browserApi()
      .call('adminAssetSuggestionsList', { query: toQuery(filters, cursor) as Record<string, string | number | boolean | undefined> })
      .then((res) => {
        if (cancelled) return;
        setResult({ key, page: res, error: null });
        setSelected(new Set());
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult((prev) => ({ key, page: prev?.page ?? null, error: { unreachable: isUnreachable(err), message: describeApiError(err).message } }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, filters, cursor]);
  const loading = result?.key !== key;
  const page = result?.page ?? null;
  const error = result?.key === key ? result.error : null;
  const load = useCallback(async () => setNonce((n) => n + 1), []);
  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursors([null]);
  };

  const bulk = useAction(
    async (decision: 'approve' | 'reject') => {
      const body: AssetSuggestionsBulkDecideRequest = { suggestionIds: [...selected], decision, note: bulkNote || undefined, idempotencyKey: newIdempotencyKey('blk') };
      const res = await browserApi().call('adminAssetSuggestionsBulkDecide', { body, idempotencyKey: body.idempotencyKey });
      setBulkResult(res);
      await load();
      return res;
    },
    { successMessage: (res) => t('admin.ui.sgBulkResult', { approved: res.approved, rejected: res.rejected, skipped: res.skipped.length }), refresh: false },
  );

  const pendingSelected = useMemo(() => (page?.items ?? []).filter((s) => selected.has(s.id) && PENDING.has(s.reviewStatus)).length, [page, selected]);

  const columns: Column<AssetSuggestionDto>[] = [
    {
      key: 'kind',
      header: t('admin.ui.sgKind'),
      render: (s) => (
        <div className="space-y-1">
          <Badge tone="accent">{s.kind}</Badge>
          <div className="text-[11px] text-fg-muted">{formatDateTime(s.createdAt, locale)}</div>
        </div>
      ),
    },
    {
      key: 'target',
      header: t('admin.ui.sgTarget'),
      render: (s) => (
        <div className="text-xs">
          <Link href={`/library/${s.mediaAssetId}`} className="font-mono text-accent hover:underline">
            {shortId(s.mediaAssetId)}
          </Link>
          <div>
            {s.lessonId ? (
              <Link href={`/lessons/${s.lessonId}`} className="text-accent hover:underline">
                {t('admin.sections.lessons')} {shortId(s.lessonId)}
              </Link>
            ) : (
              <span className="text-fg-muted">{t('admin.ui.sgNoLesson')}</span>
            )}
          </div>
        </div>
      ),
    },
    { key: 'proposal', header: t('admin.ui.sgProposal'), render: (s) => <ProposalDiff s={s} /> },
    {
      key: 'confidence',
      header: t('admin.ui.sgConfidence'),
      className: 'whitespace-nowrap',
      render: (s) => {
        const c = formatConfidence(s.confidence, locale);
        return c ? <span className="tabular-nums">{c}</span> : <span className="text-xs text-fg-muted">{t('admin.ui.sgNotReported')}</span>;
      },
    },
    { key: 'provenance', header: t('admin.ui.sgModel'), render: (s) => <span className="text-xs text-fg-muted">{[s.provenance.provider, s.provenance.model, s.provenance.task].filter(Boolean).join(' · ')}</span> },
    {
      key: 'status',
      header: t('admin.ui.status'),
      render: (s) => (
        <div className="space-y-1">
          <Badge tone={REVIEW_TONE[s.reviewStatus]}>{t(`admin.ui.reviewStatus.${s.reviewStatus}`)}</Badge>
          {s.decidedAt ? <div className="text-[11px] text-fg-muted">{t('admin.ui.sgDecidedBy', { who: shortId(s.reviewerId), when: formatDateTime(s.decidedAt, locale) })}</div> : null}
          {s.decisionNote ? <div className="text-[11px] text-fg-secondary">{s.decisionNote}</div> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('admin.ui.actions'),
      render: (s) =>
        canDecide && PENDING.has(s.reviewStatus) ? (
          <span className="flex gap-1">
            <Button size="sm" onClick={() => setDeciding({ s, decision: 'approve' })}>
              {t('admin.review.approve')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeciding({ s, decision: 'reject' })}>
              {t('admin.review.reject')}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div role="search" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Field label={t('admin.ui.status')}>
          {(id) => (
            <Select id={id} className="w-auto py-1 text-xs" value={filters.reviewStatus} onChange={(e) => setFilter({ reviewStatus: e.target.value })}>
              <option value="">{t('admin.ui.all')}</option>
              {REVIEW_STATUS_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`admin.ui.reviewStatus.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.sgKind')}>
          {(id) => (
            <Select id={id} className="w-auto py-1 text-xs" value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value })}>
              <option value="">{t('admin.ui.all')}</option>
              {ASSET_SUGGESTION_KIND_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.ui.sgMinConfidence')}>{(id) => <Input id={id} type="number" min={0} max={1} step={0.05} className="w-24 py-1 text-xs" value={filters.minConfidence} onChange={(e) => setFilter({ minConfidence: e.target.value })} />}</Field>
        <Field label={t('admin.sections.lessons')}>{(id) => <Input id={id} className="w-72 py-1 font-mono text-xs" placeholder="lesson uuid" value={filters.lessonId} onChange={(e) => setFilter({ lessonId: e.target.value.trim() })} />}</Field>
        <Field label={t('admin.ui.sgAsset')}>{(id) => <Input id={id} className="w-72 py-1 font-mono text-xs" placeholder="media asset uuid" value={filters.mediaAssetId} onChange={(e) => setFilter({ mediaAssetId: e.target.value.trim() })} />}</Field>
        <span className="ms-auto flex gap-2">
          <Button size="sm" onClick={() => void load()} loading={loading}>
            {t('admin.ui.refresh')}
          </Button>
          {canGenerate ? (
            <Button size="sm" variant="primary" onClick={() => setGenerating(true)}>
              {t('admin.ui.sgGenerate')}
            </Button>
          ) : null}
        </span>
      </div>
      {!canDecide ? <Notice tone="info">{t('admin.ui.sgReadOnly')}</Notice> : null}
      {error ? <ErrorState title={error.unreachable ? t('admin.ui.apiUnreachableTitle') : t('admin.ui.errorTitle')} message={error.message} onRetry={() => void load()} retryLabel={t('common.retry')} /> : null}
      {canDecide && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span>{t('admin.ui.sgSelected', { count: selected.size, pending: pendingSelected })}</span>
          <Input placeholder={t('admin.ui.pbNote')} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} className="w-64" />
          <Button size="sm" disabled={pendingSelected === 0} loading={bulk.busy} onClick={() => void bulk.run('approve')}>
            {t('admin.ui.sgBulkApprove')}
          </Button>
          <Button size="sm" variant="danger" disabled={pendingSelected === 0} loading={bulk.busy} onClick={() => void bulk.run('reject')}>
            {t('admin.ui.sgBulkReject')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('admin.ui.cancel')}
          </Button>
        </div>
      ) : null}
      {bulkResult ? (
        <Notice tone={bulkResult.skipped.length > 0 ? 'warning' : 'success'}>
          {t('admin.ui.sgBulkResult', { approved: bulkResult.approved, rejected: bulkResult.rejected, skipped: bulkResult.skipped.length })}
          {bulkResult.replayed ? ` · ${t('admin.ui.sgReplayed')}` : ''}
          {bulkResult.revisions.length > 0 ? ` · ${t('admin.ui.sgRevisions', { count: bulkResult.revisions.length })}` : ''}
          {bulkResult.skipped.length > 0 ? (
            <ul className="mt-1 list-disc ps-4 text-xs">
              {bulkResult.skipped.map((s) => (
                <li key={s.id}>
                  <Mono>{shortId(s.id)}</Mono> {s.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      <DataTable
        columns={columns}
        rows={page?.items ?? []}
        rowKey={(s) => s.id}
        selectable={canDecide}
        selected={selected}
        onSelectionChange={setSelected}
        loading={loading && !page}
        empty={canGenerate ? t('admin.ui.sgEmptyHint') : t('admin.ui.sgNothing')}
        caption={t('admin.sections.assetSuggestions')}
        pagination={{
          page: cursors.length,
          hasPrev: cursors.length > 1,
          hasNext: Boolean(page?.nextCursor),
          onPrev: () => setCursors((c) => c.slice(0, -1)),
          onNext: () => page?.nextCursor && setCursors((c) => [...c, page.nextCursor]),
          total: page?.total ?? null,
        }}
      />
      {deciding ? (
        <DecideDialog
          suggestion={deciding.s}
          initialDecision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDecided={() => {
            setDeciding(null);
            void load();
          }}
        />
      ) : null}
      {canGenerate ? <GenerateDialog open={generating} onClose={() => setGenerating(false)} onQueued={() => void load()} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------- decide

function DecideDialog({ suggestion, initialDecision, onClose, onDecided }: { suggestion: AssetSuggestionDto; initialDecision: 'approve' | 'reject'; onClose: () => void; onDecided: () => void }) {
  const { t, locale } = useI18n();
  const [decision, setDecision] = useState<'approve' | 'reject'>(initialDecision);
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(JSON.stringify(suggestion.suggestion, null, 2));
  const edited = override.trim() !== JSON.stringify(suggestion.suggestion, null, 2).trim();
  const parsed = edited ? parseOverride(override) : null;
  const overrideInvalid = decision === 'approve' && edited && parsed === null;
  const noChange = !proposalChanges(parsed ?? suggestion.suggestion, suggestion.currentValue);
  const decide = useAction(
    async () => {
      const body: AssetSuggestionDecideRequest = {
        decision,
        overrideSuggestion: decision === 'approve' && edited && parsed ? parsed : undefined,
        note: note || undefined,
        idempotencyKey: newIdempotencyKey('dec'),
      };
      return browserApi().call('adminAssetSuggestionDecide', { params: { id: suggestion.id }, body, idempotencyKey: body.idempotencyKey });
    },
    {
      successMessage: (res) => {
        if (res.replayed) return t('admin.ui.sgReplayed');
        if (res.suggestion.reviewStatus === 'rejected') return t('admin.ui.sgRejectedOk');
        return res.applied && res.revision ? t('admin.ui.sgAppliedOk', { revision: res.revision.revision }) : t('admin.ui.sgApprovedNotApplied');
      },
      refresh: false,
    },
  );
  const confidence = formatConfidence(suggestion.confidence, locale);
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`${t('admin.ui.sgDecideTitle')} · ${suggestion.kind} · ${shortId(suggestion.id)}`}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.cancel')}</Button>
          <Button variant={decision === 'reject' ? 'danger' : 'primary'} disabled={overrideInvalid} loading={decide.busy} onClick={() => void decide.run().then((r) => r && onDecided())}>
            {decision === 'approve' ? t('admin.review.approve') : t('admin.review.reject')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
          <span>
            {t('admin.ui.sgConfidence')}: {confidence ?? t('admin.ui.sgNotReported')}
          </span>
          <span>
            {t('admin.ui.sgModel')}: {[suggestion.provenance.provider, suggestion.provenance.model].filter(Boolean).join(' · ') || '—'}
          </span>
          <span>
            {t('admin.ui.sgAsset')}: <Mono>{shortId(suggestion.mediaAssetId)}</Mono>
          </span>
        </div>
        <ProposalDiff s={suggestion} />
        <div className="flex gap-3 text-sm">
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="decision" checked={decision === 'approve'} onChange={() => setDecision('approve')} /> {t('admin.review.approve')}
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="decision" checked={decision === 'reject'} onChange={() => setDecision('reject')} /> {t('admin.review.reject')}
          </label>
        </div>
        {decision === 'approve' ? (
          <Field label={t('admin.ui.sgOverride')} hint={t('admin.ui.sgOverrideHint')} error={overrideInvalid ? t('admin.ui.sgOverrideInvalid') : undefined}>
            {(id) => <Textarea id={id} className="font-mono text-xs" value={override} onChange={(e) => setOverride(e.target.value)} />}
          </Field>
        ) : null}
        {decision === 'approve' && noChange ? <Notice tone="info">{t('admin.ui.sgNoChange')}</Notice> : null}
        {!suggestion.lessonId && decision === 'approve' ? <Notice tone="warning">{t('admin.ui.sgNoLessonApply')}</Notice> : null}
        <Field label={t('admin.ui.pbNote')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />}</Field>
        {decide.error ? <Notice tone="error">{decide.error}</Notice> : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------- generate

function GenerateDialog({ open, onClose, onQueued }: { open: boolean; onClose: () => void; onQueued: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'ids' | 'filter'>('ids');
  const [idsText, setIdsText] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState<Set<string>>(new Set(['metadata', 'language', 'lesson_structure', 'level', 'topics', 'tags']));
  const [force, setForce] = useState(false);
  const [result, setResult] = useState<AssetSuggestionsGenerateResponse | null>(null);
  const ids = idsText
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => x.length === 36);
  const generate = useAction(
    async () => {
      const body: AssetSuggestionsGenerateRequest = {
        ...(mode === 'ids' ? { assetIds: ids } : { filter: { status: (status || undefined) as ContentState | undefined, q: q || undefined } }),
        kinds: [...kinds] as AssetSuggestionsGenerateRequest['kinds'],
        force,
        idempotencyKey: newIdempotencyKey('gen'),
      };
      const res = await browserApi().call('adminAssetSuggestionsGenerate', { body, idempotencyKey: body.idempotencyKey });
      setResult(res);
      onQueued();
      return res;
    },
    { successMessage: (res) => (res.replayed ? t('admin.ui.sgReplayed') : t('admin.ui.sgQueued', { assets: res.queuedAssets, jobs: res.jobIds.length })), refresh: false },
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.ui.sgGenerateTitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.ui.cancel')}</Button>
          <Button variant="primary" disabled={kinds.size === 0 || (mode === 'ids' && ids.length === 0)} loading={generate.busy} onClick={() => void generate.run()}>
            {t('admin.ui.sgGenerate')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-fg-muted">{t('admin.ui.sgGenerateHint')}</p>
        <div className="flex gap-3 text-sm">
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === 'ids'} onChange={() => setMode('ids')} /> {t('admin.ui.sgAssetIds')}
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === 'filter'} onChange={() => setMode('filter')} /> {t('admin.ui.sgByFilter')}
          </label>
        </div>
        {mode === 'ids' ? (
          <Field label={t('admin.ui.sgAssetIds')} hint={t('admin.ui.sgAssetIdsHint', { count: ids.length })}>
            {(id) => <Textarea id={id} className="font-mono text-xs" value={idsText} onChange={(e) => setIdsText(e.target.value)} />}
          </Field>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('admin.ui.status')}>
              {(id) => (
                <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">{t('admin.ui.all')}</option>
                  {CONTENT_STATE_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {t(`admin.publish.state.${v}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('common.search')}>{(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          </div>
        )}
        <fieldset>
          <legend className="text-xs font-medium text-fg-secondary">{t('admin.ui.sgKinds')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {ASSET_SUGGESTION_KIND_VALUES.map((k) => (
              <Checkbox
                key={k}
                label={k}
                checked={kinds.has(k)}
                onChange={(e) => {
                  const next = new Set(kinds);
                  if (e.target.checked) next.add(k);
                  else next.delete(k);
                  setKinds(next);
                }}
              />
            ))}
          </div>
        </fieldset>
        <Checkbox label={t('admin.ui.sgForce')} checked={force} onChange={(e) => setForce(e.target.checked)} />
        {result ? (
          <Notice tone={result.skipped.length > 0 ? 'warning' : 'success'}>
            {t('admin.ui.sgQueued', { assets: result.queuedAssets, jobs: result.jobIds.length })}
            {result.skipped.length > 0 ? (
              <ul className="mt-1 list-disc ps-4 text-xs">
                {result.skipped.map((s) => (
                  <li key={s.assetId}>
                    <Mono>{shortId(s.assetId)}</Mono> {s.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.jobIds.length > 0 ? (
              <p className="mt-1 text-xs">
                <Link href="/jobs" className="text-accent hover:underline">
                  {t('admin.sections.jobQueue')} →
                </Link>
              </p>
            ) : null}
          </Notice>
        ) : null}
        {generate.error ? <Notice tone="error">{generate.error}</Notice> : null}
      </div>
    </Dialog>
  );
}
