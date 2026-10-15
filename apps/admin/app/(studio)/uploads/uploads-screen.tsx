'use client';
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import clsx from 'clsx';
import { FolderOpen, Pause, Play, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { UPLOAD_LIMITS } from '@langquest/media';
import { useI18n } from '@/src/lib/i18n/client';
import { formatBytes } from '@/src/lib/format';
import { collectDropped, collectFromInput } from '@/src/lib/upload/traverse';
import { useUploadEngine } from '@/src/lib/upload/use-upload-engine';
import { itemProgress, summarizeQueue } from '@/src/lib/upload/machine';
import type { UploadItem, UploadItemState } from '@/src/lib/upload/types';
import { Button, Checkbox, Notice, Select } from '@/src/components/ui';
import { Badge } from '@/src/components/badges';
import { VirtualList } from '@/src/components/virtual-list';
import { useToast } from '@/src/components/toast';

const STATE_TONE: Record<UploadItemState, 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent'> = {
  queued: 'neutral',
  hashing: 'info',
  initiating: 'info',
  uploading: 'accent',
  completing: 'info',
  verifying: 'info',
  done: 'success',
  duplicate: 'warning',
  paused: 'neutral',
  failed: 'error',
  cancelled: 'neutral',
  unsupported: 'error',
};

const ROW_HEIGHT = 72;

function describeError(t: (k: string, v?: Record<string, string | number>) => string, item: UploadItem): string | null {
  if (!item.error) return null;
  if (item.error.startsWith('unsupported_type:')) return t('admin.ui.upUnsupportedType', { type: item.error.slice('unsupported_type:'.length) });
  if (item.error.startsWith('too_large:')) return t('admin.ui.upTooLarge', { max: formatBytes(Number(item.error.slice('too_large:'.length))) });
  if (item.error === 'empty_file') return t('admin.upload.failed', { reason: 'empty file' });
  return t('admin.upload.failed', { reason: item.error });
}

export function UploadsScreen() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [concurrency, setConcurrency] = useState(3);
  const [assetKind, setAssetKind] = useState<'auto' | 'audio' | 'image' | 'document'>('auto');
  const [showId3, setShowId3] = useState(true);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const engine = useUploadEngine({ fileConcurrency: concurrency });
  const { items, ready, storeMode, hasherMode, restoredCount } = engine.state;
  const summary = useMemo(() => summarizeQueue(items), [items]);

  const ingest = useCallback(
    async (entries: AsyncIterable<{ file: File; relativePath: string }> | Array<{ file: File; relativePath: string }>) => {
      let batch: { file: File; relativePath: string }[] = [];
      let total = 0;
      const flush = () => {
        if (batch.length === 0) return;
        engine.addFiles(batch, assetKind === 'auto' ? undefined : assetKind);
        total += batch.length;
        batch = [];
      };
      for await (const entry of entries) {
        batch.push(entry);
        if (batch.length >= 200) flush();
      }
      flush();
      toast.push(t('admin.upload.queued', { count: total }));
    },
    [engine, assetKind, toast, t],
  );

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    await ingest(collectDropped(e.dataTransfer));
  };

  const pendingRestore = items.filter((i) => i.file === null);

  return (
    <div className="space-y-4">
      {!ready ? <p className="text-sm text-fg-muted">{t('admin.ui.loading')}</p> : null}
      {restoredCount > 0 && pendingRestore.length > 0 ? (
        <Notice tone="info">
          {t('admin.ui.upPersistedSessions', { count: pendingRestore.length })} — {t('admin.ui.upReattach')}
        </Notice>
      ) : null}
      {hasherMode === 'main-thread' ? <Notice tone="warning">{t('admin.ui.upWorkerUnavailable')}</Notice> : null}

      <div
        role="region"
        aria-label={t('admin.upload.dropzone')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx('rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors', dragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface')}
      >
        <Upload className="mx-auto mb-2 text-fg-muted" size={28} aria-hidden="true" />
        <p className="text-sm font-medium">{t('admin.upload.dropzone')}</p>
        <p className="mt-1 text-xs text-fg-muted">{t('admin.ui.upDropHint')}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button onClick={() => fileInput.current?.click()} icon={<Upload size={14} />}>
            {t('admin.upload.chooseFiles')}
          </Button>
          <Button onClick={() => folderInput.current?.click()} icon={<FolderOpen size={14} />}>
            {t('admin.upload.chooseFolder')}
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          accept={UPLOAD_LIMITS.allowedMimeTypes.join(',')}
          onChange={(e) => {
            if (e.target.files) void ingest(collectFromInput(e.target.files));
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="sr-only"
          // @ts-expect-error webkitdirectory is a non-standard attribute supported by Chromium/WebKit/Firefox.
          webkitdirectory=""
          onChange={(e) => {
            if (e.target.files) void ingest(collectFromInput(e.target.files));
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Button variant="primary" icon={<Play size={14} />} onClick={() => engine.start()} disabled={!items.some((i) => i.state === 'queued')}>
          {t('admin.ui.upStartAll')}
        </Button>
        <Button icon={<Pause size={14} />} onClick={() => engine.pause()} disabled={!summary.active}>
          {t('admin.ui.upPauseAll')}
        </Button>
        <Button icon={<Play size={14} />} onClick={() => engine.resume()} disabled={summary.byState.paused === 0}>
          {t('admin.ui.upResumeAll')}
        </Button>
        <Button icon={<RotateCcw size={14} />} onClick={() => engine.retry()} disabled={summary.byState.failed === 0}>
          {t('admin.ui.upRetryFailed')}
        </Button>
        <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => engine.clearFinished()} disabled={summary.byState.done + summary.byState.duplicate + summary.byState.cancelled + summary.byState.unsupported === 0}>
          {t('admin.ui.upClearDone')}
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <label className="flex items-center gap-1 text-xs">
          {t('admin.ui.upConcurrency')}
          <Select className="w-auto py-0.5 text-xs" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
            {[1, 2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          {t('admin.ui.upAssetKind')}
          <Select className="w-auto py-0.5 text-xs" value={assetKind} onChange={(e) => setAssetKind(e.target.value as typeof assetKind)}>
            <option value="auto">auto</option>
            <option value="audio">audio</option>
            <option value="image">image</option>
            <option value="document">document</option>
          </Select>
        </label>
        <Checkbox label={t('admin.ui.upId3')} checked={showId3} onChange={(e) => setShowId3(e.target.checked)} />
        {storeMode === 'memory' ? <Badge tone="warning">no IndexedDB</Badge> : null}
      </div>

      {items.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span>
              {t('admin.ui.upOverall')} · {t('admin.ui.upFiles', { count: summary.total })} · {t('admin.ui.upBytes', { done: formatBytes(summary.bytesDone, locale), total: formatBytes(summary.bytesTotal, locale) })}
            </span>
            <span className="tabular-nums">{Math.round(summary.progress * 100)}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.progress * 100)}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${summary.progress * 100}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-fg-muted">
            {(Object.keys(summary.byState) as UploadItemState[])
              .filter((s) => summary.byState[s] > 0)
              .map((s) => (
                <span key={s}>
                  {t(`admin.ui.upState.${s}`)}: {summary.byState[s]}
                </span>
              ))}
          </div>
        </div>
      ) : null}

      <VirtualList
        items={items}
        rowHeight={ROW_HEIGHT}
        height={Math.min(640, Math.max(160, items.length * ROW_HEIGHT + 2))}
        itemKey={(i) => i.localId}
        ariaLabel={t('admin.ui.upQueue')}
        render={(item) => <UploadRow item={item} showId3={showId3} engine={engine} />}
      />
    </div>
  );
}

function UploadRow({ item, showId3, engine }: { item: UploadItem; showId3: boolean; engine: ReturnType<typeof useUploadEngine> }) {
  const { t, locale } = useI18n();
  const pct = Math.round(itemProgress(item) * 100);
  const err = describeError(t, item);
  const canPause = ['hashing', 'initiating', 'uploading', 'completing', 'verifying', 'queued'].includes(item.state);
  const canResume = item.state === 'paused' && item.file !== null;
  const canRetry = item.state === 'failed';
  const canCancel = !['done', 'duplicate', 'cancelled', 'unsupported'].includes(item.state);
  const canRemove = ['done', 'duplicate', 'cancelled', 'failed', 'unsupported', 'paused', 'queued'].includes(item.state);
  return (
    <div className="flex h-full items-center gap-3 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" title={item.relativePath}>
            {item.relativePath}
          </span>
          <Badge tone={STATE_TONE[item.state]}>{t(`admin.ui.upState.${item.state}`)}</Badge>
          {item.resumed ? <Badge tone="info">{t('admin.ui.upResumed')}</Badge> : null}
          {item.file === null ? <Badge tone="warning">{t('admin.ui.upReattach')}</Badge> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-fg-muted">
          <span>{formatBytes(item.size, locale)}</span>
          <span>{item.mimeType}</span>
          {item.checksumSha256 ? <span className="font-mono" title={item.checksumSha256}>{item.checksumSha256.slice(0, 12)}…</span> : null}
          {item.partCount > 0 ? <span>{Object.keys(item.completedParts).length}/{item.partCount} parts</span> : null}
          {item.suggestion && (item.suggestion.collectionTitle || item.suggestion.lessonOrder != null) ? (
            <span title={t('admin.ui.upSuggested')}>
              {t('admin.ui.upSuggested')}: {[item.suggestion.collectionTitle, item.suggestion.chapterTitle, item.suggestion.lessonOrder != null ? `#${item.suggestion.lessonOrder}` : null].filter(Boolean).join(' › ')}
            </span>
          ) : null}
          {showId3 && item.tags ? (
            <span title={t('admin.ui.upId3')}>
              {[item.tags.artist, item.tags.album, item.tags.title, item.tags.track != null ? `track ${item.tags.track}` : null].filter(Boolean).join(' · ') || t('admin.ui.upNoTags')}
              {item.tags.codec ? ` · ${item.tags.codec}` : ''}
              {item.tags.bitrateKbps ? ` ${item.tags.bitrateKbps} kbps` : ''}
            </span>
          ) : null}
        </div>
        {item.state === 'duplicate' ? (
          <p className="text-[11px] text-warning">{item.duplicateOfAssetId ? t('admin.ui.upDuplicateRemote', { assetId: item.duplicateOfAssetId.slice(0, 8) }) : t('admin.ui.upDuplicateLocal')}</p>
        ) : null}
        {err ? <p className="truncate text-[11px] text-error">{err}</p> : null}
        {item.result?.queuedJobIds.length ? <p className="text-[11px] text-fg-muted">jobs: {item.result.queuedJobIds.map((j) => j.slice(0, 8)).join(', ')}</p> : null}
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={item.name}>
          <div className={clsx('h-full transition-[width]', item.state === 'failed' ? 'bg-error' : item.state === 'done' ? 'bg-success' : 'bg-accent')} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canPause ? (
          <Button size="sm" variant="ghost" aria-label={t('admin.upload.pauseAll')} onClick={() => engine.pause(item.localId)} icon={<Pause size={14} />} />
        ) : null}
        {canResume ? <Button size="sm" variant="ghost" aria-label={t('admin.upload.resume')} onClick={() => engine.resume(item.localId)} icon={<Play size={14} />} /> : null}
        {canRetry ? <Button size="sm" variant="ghost" aria-label={t('common.retry')} onClick={() => engine.retry(item.localId)} icon={<RotateCcw size={14} />} /> : null}
        {canCancel ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('admin.upload.abort')}
            onClick={() => {
              if (item.uploadId && !window.confirm(t('admin.upload.abortConfirm'))) return;
              void engine.cancel(item.localId);
            }}
            icon={<X size={14} />}
          />
        ) : null}
        {canRemove ? <Button size="sm" variant="ghost" aria-label={t('admin.ui.upRemove')} onClick={() => engine.remove(item.localId)} icon={<Trash2 size={14} />} /> : null}
      </div>
    </div>
  );
}
