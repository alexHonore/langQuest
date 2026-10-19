'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AUDIO_ASSET_TYPE_VALUES, type AudioAssetType } from '@langquest/contracts';
import { browserApi } from '@/src/lib/api-browser';
import { useI18n } from '@/src/lib/i18n/client';
import { useAction } from '@/src/lib/use-action';
import { formatBytes, formatDurationMs, shortId } from '@/src/lib/format';
import { Button, Field, Input, Select } from '@/src/components/ui';
import { Badge, StatusBadge } from '@/src/components/badges';
import { AssetPreview } from '@/src/components/asset-preview';

interface AssetLink {
  id: string;
  asset_type: string;
  sort_order: number;
  asset: { id: string; kind: string; mime_type: string; byte_length: number; duration_ms: number | null; checksum_sha256: string; state: string; legacy_filename: string | null; source_asset_id: string | null; derivation: string | null } | null;
}

export function LessonAssets({ lessonId, assets, expectedRevision }: { lessonId: string; assets: AssetLink[]; expectedRevision?: number }) {
  const { t, locale } = useI18n();
  const [assetId, setAssetId] = useState('');
  const [assetType, setAssetType] = useState<AudioAssetType>('master');
  const [previewId, setPreviewId] = useState<string | null>(null);
  // 201 = fresh link, 200 + `movedFromLessonId` = the asset was moved here from another lesson (both lessons get a revision).
  const attach = useAction(async () => browserApi().call('adminLessonAssetAttach', { params: { id: lessonId }, body: { assetId, assetType, sortOrder: assets.length, expectedRevision } }), {
    successMessage: (res) => (res.movedFromLessonId ? t('admin.ui.lsAssetMoved', { from: shortId(res.movedFromLessonId), revision: res.revision }) : t('admin.ui.lsAssetAttached', { revision: res.revision })),
  });
  // Detached assets return to `imported_draft`; they are never deleted.
  const detach = useAction(async (id: string) => browserApi().call('adminLessonAssetDetach', { params: { id: lessonId, assetId: id } }), {
    successMessage: (res) => t('admin.ui.lsAssetDetached', { state: t(`admin.publish.state.${res.assetState}`) }),
  });
  return (
    <div className="space-y-3">
      {assets.length === 0 ? <p className="text-sm text-fg-muted">{t('admin.ui.lsNoAssets')}</p> : null}
      <ul className="divide-y divide-border">
        {assets.map((link) => (
          <li key={link.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={link.asset_type === 'master' ? 'accent' : 'neutral'}>{link.asset_type}</Badge>
              {link.asset ? (
                <>
                  <Link href={`/library/${link.asset.id}`} className="font-medium text-accent hover:underline">
                    {link.asset.legacy_filename ?? shortId(link.asset.id)}
                  </Link>
                  <span className="text-xs text-fg-muted">
                    {link.asset.kind} · {formatBytes(link.asset.byte_length, locale)} · {formatDurationMs(link.asset.duration_ms)}
                  </span>
                  {link.asset.source_asset_id ? <Badge tone="neutral">{t('admin.library.derived')} · {link.asset.derivation}</Badge> : <Badge tone="neutral">{t('admin.library.original')}</Badge>}
                  <StatusBadge state={link.asset.state} />
                  <Button size="sm" variant="ghost" onClick={() => setPreviewId(previewId === link.asset!.id ? null : link.asset!.id)}>
                    {t('admin.library.preview')}
                  </Button>
                </>
              ) : (
                <span className="text-fg-muted">{t('common.notAvailable')}</span>
              )}
              <Button size="sm" variant="ghost" className="ms-auto" loading={detach.busy} onClick={() => link.asset && void detach.run(link.asset.id)}>
                {t('admin.ui.removeLocale')}
              </Button>
            </div>
            {previewId && link.asset?.id === previewId ? (
              <div className="mt-2">
                <AssetPreview assetId={link.asset.id} kind={link.asset.kind} mimeType={link.asset.mime_type} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2">
        <Field label={t('admin.ui.libAttachToLesson')} className="flex-1">
          {(id) => <Input id={id} placeholder="media asset uuid" value={assetId} onChange={(e) => setAssetId(e.target.value)} />}
        </Field>
        <Field label={t('admin.ui.type')}>
          {(id) => (
            <Select id={id} value={assetType} onChange={(e) => setAssetType(e.target.value as AudioAssetType)}>
              {AUDIO_ASSET_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button disabled={assetId.length < 36} loading={attach.busy} onClick={() => void attach.run().then(() => setAssetId(''))}>
          {t('admin.ui.apply')}
        </Button>
      </div>
    </div>
  );
}
