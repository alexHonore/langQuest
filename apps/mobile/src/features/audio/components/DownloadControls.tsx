/**
 * Download state + actions for one lesson (§4.5): queued / waiting for Wi-Fi /
 * downloading with real byte progress / verifying / complete / error with the
 * honest failure reason, plus pause, resume, retry, cancel and delete.
 */
import { Button, ProgressBar, Row, StatusLine, ThemedText, useTheme } from '@langquest/ui';
import React from 'react';
import { Alert, Platform, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { downloadFraction, formatMegabytes, type DownloadMeta, type DownloadRecord } from '../download-index';
import { DownloadManager, type DownloadFailureCode } from '../download-manager';
import { useAudioLabels } from '../labels';
import { useAudioRuntime, useDownloadRecord } from '../use-audio';

export interface DownloadControlsProps {
  lessonId: string;
  meta: DownloadMeta;
  offlineEligible: boolean;
  compact?: boolean;
}

export function confirmRemoveDownload(title: string, body: string, confirmLabel: string, cancelLabel: string, onConfirm: () => void): void {
  if (Platform.OS === 'web') {
    if (typeof globalThis.confirm === 'function' ? globalThis.confirm(`${title}\n\n${body}`) : true) onConfirm();
    return;
  }
  Alert.alert(title, body, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export function DownloadControls(props: DownloadControlsProps): React.JSX.Element {
  const theme = useTheme();
  const t = useT();
  const L = useAudioLabels();
  const runtime = useAudioRuntime();
  const { data: record } = useDownloadRecord(props.lessonId);

  if (!runtime) return <View />;
  if (!runtime.downloadsSupported) return <StatusLine icon="info" tone="muted" text={L.downloadsUnsupportedWeb} />;
  // A volatile store cannot keep the download index: never offer a download it would forget (§4.4).
  if (!runtime.local.persistent) return <StatusLine icon="warning" tone="warning" text={L.downloadsDisabledNoStorage} />;
  if (!props.offlineEligible && !record) return <StatusLine icon="info" tone="muted" text={L.notOfflineEligible} />;

  const start = (): void => void runtime.downloads.start(props.lessonId, props.meta);
  const remove = (): void => confirmRemoveDownload(L.deleteConfirmTitle, L.deleteConfirmBody, t('common.delete'), t('common.cancel'), () => void runtime.downloads.remove(props.lessonId));

  if (!record || record.status === 'cancelled') {
    return <Button label={t('audio.download.download')} icon="download" variant="secondary" size="sm" onPress={start} accessibilityLabel={t('audio.download.download')} />;
  }
  if (record.status === 'complete') {
    const verified = record.files.find((f) => f.kind === 'audio')?.verifiedBy ?? null;
    return (
      <View style={{ gap: theme.spacing.xs }}>
        <Row gap={theme.spacing.sm} justify="space-between" align="center">
          <StatusLine icon="offline" tone="success" text={`${t('audio.download.downloaded')} · ${t('audio.download.size', { size: formatMegabytes(record.bytesDownloaded) })}`} />
          <Button label={t('audio.download.remove')} icon="close" variant="ghost" size="sm" onPress={remove} accessibilityLabel={t('audio.download.remove')} />
        </Row>
        {!props.compact && verified ? (
          <ThemedText variant="caption" tone="muted">
            {L.verifiedBy(verified)}
          </ThemedText>
        ) : null}
      </View>
    );
  }
  const fraction = downloadFraction(record);
  const waitingNetwork = DownloadManager.isWaitingForNetwork(record);
  const fileMissing = record.status === 'error' && record.error === 'file_missing';
  const statusText =
    record.status === 'queued'
      ? L.downloadQueued
      : record.status === 'waiting_wifi'
        ? L.downloadWaitingWifi
        : waitingNetwork
          ? L.failure.offline
          : record.status === 'paused'
            ? L.downloadPaused
            : record.status === 'verifying'
              ? L.downloadVerifying
              : record.status === 'error'
                ? `${L.downloadFailed}: ${L.failure[(record.error as DownloadFailureCode | null) ?? 'unknown'] ?? L.failure.unknown}`
                : t('audio.download.downloading', { percent: fraction });
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <StatusLine icon={record.status === 'error' ? 'warning' : waitingNetwork ? 'offline' : 'download'} tone={record.status === 'error' ? 'error' : waitingNetwork ? 'warning' : 'secondary'} text={statusText} />
      {record.status === 'downloading' || record.status === 'verifying' ? <ProgressBar value={fraction} accessibilityLabel={t('audio.download.downloading', { percent: fraction })} tone="info" /> : null}
      <Row gap={theme.spacing.sm} wrap>
        {record.status === 'downloading' || record.status === 'queued' ? <Button label={L.downloadPause} variant="ghost" size="sm" icon="pause" onPress={() => void runtime.downloads.pause(props.lessonId)} /> : null}
        {(record.status === 'paused' && !waitingNetwork) || record.status === 'waiting_wifi' ? <Button label={L.downloadResume} variant="secondary" size="sm" icon="play" onPress={() => void runtime.downloads.retry(props.lessonId)} /> : null}
        {record.status === 'error' ? <Button label={fileMissing ? L.downloadAgain : L.downloadRetry} variant="secondary" size="sm" icon={fileMissing ? 'download' : 'replay'} onPress={() => void runtime.downloads.retry(props.lessonId)} /> : null}
        <Button label={L.downloadCancel} variant="ghost" size="sm" icon="close" onPress={() => void runtime.downloads.cancel(props.lessonId)} />
      </Row>
    </View>
  );
}

export type { DownloadRecord };
