'use client';
/**
 * Image picker + multipart upload for §10.2A visual assets. Honest states: no media storage on
 * this deployment (server message shown verbatim, picker disabled), hashing / uploading progress,
 * duplicate (same bytes already registered), failed with the reason, verified (ready to register).
 */
import { useRef } from 'react';
import { VISUAL_UPLOAD_MIME_TYPES } from '@langquest/contracts';
import { UPLOAD_LIMITS } from '@langquest/media';
import { useI18n } from '@/src/lib/i18n/client';
import { formatBytes } from '@/src/lib/format';
import { itemProgress } from '@/src/lib/upload/machine';
import type { useImageUpload } from '@/src/lib/upload/use-image-upload';
import { Badge } from './badges';
import { Button, Notice } from './ui';

type Upload = ReturnType<typeof useImageUpload>;

export function ImageUploadField({ upload, disabled }: { upload: Upload; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const { item, storageUnavailable, previewUrl, ready } = upload.state;
  const busy = item ? ['queued', 'hashing', 'initiating', 'uploading', 'completing', 'verifying'].includes(item.state) : false;
  return (
    <div className="space-y-2">
      {storageUnavailable ? (
        <Notice tone="warning">
          <strong>{t('admin.ui.vaStorageUnavailable')}</strong> {storageUnavailable}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={disabled || !ready || Boolean(storageUnavailable) || busy} onClick={() => input.current?.click()}>
          {item ? t('admin.ui.vaChooseAnother') : t('admin.ui.vaChooseImage')}
        </Button>
        <input
          ref={input}
          type="file"
          className="sr-only"
          accept={VISUAL_UPLOAD_MIME_TYPES.join(',')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.upload(file);
            e.target.value = '';
          }}
        />
        <span className="text-xs text-fg-muted">{t('admin.ui.vaUploadHint', { max: formatBytes(UPLOAD_LIMITS.maxFileBytesByKind.image, locale) })}</span>
      </div>
      {item ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2 text-sm">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-16 w-16 rounded object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{item.name}</p>
            <p className="text-xs text-fg-muted">
              {item.mimeType} · {formatBytes(item.size, locale)}
              {item.checksumSha256 ? ` · sha256 ${item.checksumSha256.slice(0, 12)}…` : ''}
            </p>
            {busy ? (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(itemProgress(item) * 100)}>
                <div className="h-full bg-accent" style={{ width: `${Math.round(itemProgress(item) * 100)}%` }} />
              </div>
            ) : null}
            {item.state === 'failed' || item.state === 'unsupported' ? <p className="text-xs text-error">{item.error}</p> : null}
            {item.state === 'duplicate' ? <p className="text-xs text-warning">{t('admin.ui.vaDuplicateUpload', { id: item.duplicateOfAssetId ?? '?' })}</p> : null}
            {item.state === 'done' && item.result?.status !== 'verified' ? <p className="text-xs text-warning">{t('admin.ui.vaNotVerified', { status: item.result?.status ?? '?', code: item.result?.failureCode ?? '—' })}</p> : null}
          </div>
          <Badge tone={item.state === 'done' ? 'success' : item.state === 'failed' || item.state === 'unsupported' ? 'error' : 'info'}>{t(`admin.ui.upState.${item.state}`)}</Badge>
          {item.state === 'failed' ? (
            <Button size="sm" onClick={upload.retry}>
              {t('common.retry')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={upload.reset}>
            {t('admin.ui.cancel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
