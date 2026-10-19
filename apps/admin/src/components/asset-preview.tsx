'use client';
/**
 * Asset preview: audio through a signed playback URL fetched from the API (`audioPlaybackUrl`),
 * images through the same URL. Honest states: no URL (API unreachable or rights blocked),
 * unsupported kind. Never a fake waveform — the transcript editor draws a time ruler instead.
 */
import { useEffect, useState } from 'react';
import { browserApi } from '@/src/lib/api-browser';
import { describeApiError } from '@/src/lib/api';
import { useI18n } from '@/src/lib/i18n/client';
import { useDeployment } from '@/src/lib/setup/context';
import { Notice, Spinner } from './ui';

export interface PlaybackState {
  url: string | null;
  expiresAt: string | null;
  error: string | null;
  loading: boolean;
}

/** Fetch (and renew) a signed playback URL for an asset. */
export function usePlaybackUrl(assetId: string | null): PlaybackState & { refresh: () => void } {
  const { mediaAvailable } = useDeployment();
  const [state, setState] = useState<{ forAsset: string | null; nonce: number; url: string | null; expiresAt: string | null; error: string | null }>({ forAsset: null, nonce: 0, url: null, expiresAt: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!assetId || !mediaAvailable) return;
    let cancelled = false;
    browserApi()
      .call('audioPlaybackUrl', { params: { id: assetId }, body: { renewal: false } })
      .then((res) => {
        if (!cancelled) setState({ forAsset: assetId, nonce, url: res.url, expiresAt: res.expiresAt, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ forAsset: assetId, nonce, url: null, expiresAt: null, error: describeApiError(err).message });
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, nonce, mediaAvailable]);
  const refresh = () => setNonce((n) => n + 1);
  if (!assetId || !mediaAvailable) return { url: null, expiresAt: null, error: null, loading: false, refresh };
  const fresh = state.forAsset === assetId && state.nonce === nonce;
  return { url: fresh ? state.url : null, expiresAt: fresh ? state.expiresAt : null, error: fresh ? state.error : null, loading: !fresh, refresh };
}

/** Preview through a signed URL; renders nothing at all when the deployment has no media storage (CONVENTIONS §8). */
export function AssetPreview({ assetId, kind, mimeType, title }: { assetId: string | null; kind: string; mimeType?: string | null; title?: string }) {
  const { t } = useI18n();
  const { mediaAvailable } = useDeployment();
  const playback = usePlaybackUrl(assetId);
  if (!mediaAvailable) return null;
  if (!assetId) return <p className="text-xs text-fg-muted">{t('admin.ui.noPreview')}</p>;
  if (playback.loading) return <Spinner label={t('admin.ui.loading')} />;
  if (!playback.url) return <Notice tone="warning">{t('admin.ui.playbackUrlUnavailable', { reason: playback.error ?? 'unknown' })}</Notice>;
  if (kind === 'audio') {
    return (
      <audio controls preload="metadata" src={playback.url} className="w-full" aria-label={title ?? t('common.a11y.playAudio')}>
        <track kind="captions" />
      </audio>
    );
  }
  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={playback.url} alt={title ?? ''} className="max-h-64 rounded-md border border-border object-contain" />;
  }
  return <p className="text-xs text-fg-muted">{t('admin.ui.noPreview')} ({mimeType ?? kind})</p>;
}

/** Inline SVG from the @langquest/ui string renderers (trusted, generated in code). */
export function SvgArt({ svg, label, className }: { svg: string; label: string; className?: string }) {
  return <div role="img" aria-label={label} className={`svg-preview ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
