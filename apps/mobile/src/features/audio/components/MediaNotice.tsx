/**
 * Honest media states (§0.2 "no fake data", provisioning runbook): when media
 * storage is not enabled, rights are blocked, the device is offline without a
 * download, or playback failed, explain it in one line instead of rendering a
 * broken player.
 */
import { StatusLine } from '@langquest/ui';
import React from 'react';
import type { AudioEngineError } from '@/audio/engine-state';
import { useT } from '@/lib/i18n';
import type { MediaUnavailableReason } from '../api';
import { useAudioLabels } from '../labels';

export function mediaReasonFromEngineError(error: AudioEngineError | null): MediaUnavailableReason | null {
  if (!error) return null;
  switch (error.code) {
    case 'unsupported':
      return 'storage_not_enabled';
    case 'rights_blocked':
      return 'rights_blocked';
    case 'source_unavailable':
      return 'not_found';
    case 'offline_no_link':
      return 'offline';
    default:
      return 'unknown';
  }
}

export function MediaNotice(props: { reason: MediaUnavailableReason | null; detail?: string | null }): React.JSX.Element | null {
  const L = useAudioLabels();
  const t = useT();
  if (!props.reason) return null;
  const text =
    props.reason === 'not_configured'
      ? L.mediaNotConfigured
      : props.reason === 'storage_not_enabled'
        ? L.storageNotEnabled
        : props.reason === 'rights_blocked'
          ? L.rightsBlocked
          : props.reason === 'not_found'
            ? L.mediaNotFound
            : props.reason === 'offline'
              ? L.offlineNoLink
              : (props.detail ?? t('errors.audioPlayback'));
  const tone = props.reason === 'storage_not_enabled' || props.reason === 'not_configured' ? 'info' : props.reason === 'offline' ? 'warning' : 'error';
  return <StatusLine icon={tone === 'info' ? 'info' : tone === 'warning' ? 'offline' : 'warning'} tone={tone} text={text} />;
}
