import { Button, Chip, EmptyState, InfoAffordance, Row, Surface, ThemedText, formatDurationMs, useTheme } from '@langquest/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { SwitchRow } from '@/components/SettingRow';
import { CoverArt } from '@/features/audio/components/CoverArt';
import { DownloadControls, confirmRemoveDownload } from '@/features/audio/components/DownloadControls';
import { formatMegabytes } from '@/features/audio/download-index';
import { useAudioLabels } from '@/features/audio/labels';
import { useAudioRuntime, useDownloadList, useStorageSummary } from '@/features/audio/use-audio';
import { useActiveEnrollment } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { useT } from '@/lib/i18n';
import { usePrefs } from '@/state/prefs';

/** Storage usage + download manager (§4.5): device-driven limits, Wi-Fi-only, per-lesson controls, delete. */
export default function DownloadsScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const L = useAudioLabels();
  const runtime = useAudioRuntime();
  const { enrollment } = useActiveEnrollment();
  const nav = useEnrollmentNavigation(enrollment);
  const list = useDownloadList();
  const summary = useStorageSummary();
  const wifiOnly = usePrefs((s) => s.wifiOnlyDownloads);
  const setPrefs = usePrefs((s) => s.set);
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    if (!runtime?.downloadsSupported) return;
    let alive = true;
    void import('expo-file-system').then(({ Paths }) => {
      try {
        if (alive) setFree(Paths.availableDiskSpace);
      } catch {
        if (alive) setFree(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [runtime, list.data]);

  const removeAll = (): void => {
    if (!runtime) return;
    confirmRemoveDownload(L.deleteAll, L.deleteConfirmBody, t('common.delete'), t('common.cancel'), () => {
      void Promise.all(list.data.map((r) => runtime.downloads.remove(r.lessonId)));
    });
  };

  const storageDetails = [...(summary.data.bytesPending > 0 ? [`+${formatMegabytes(summary.data.bytesPending)} MB ${L.downloadQueued.toLowerCase()}`] : []), ...(free !== null ? [L.deviceFree(formatMegabytes(free))] : [])];

  // Offline packs are a capability of the pair AND of the platform (§8): no controls when either is missing.
  if (!nav.downloads) return <Redirect href="/(tabs)" />;
  return (
    <Screen insideTabs title={L.downloads} onBack={() => router.back()}>
      {/* Storage card = one line (storage used); queued bytes and free space sit behind ⓘ. */}
      <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
        <Row gap={theme.spacing.sm} justify="space-between" align="center">
          <ThemedText variant="subheading" style={{ flex: 1 }}>
            {t('audio.download.storageUsed', { used: formatMegabytes(summary.data.bytesOnDisk) })}
          </ThemedText>
          {storageDetails.length > 0 ? <InfoAffordance label={t('common.details')} title={L.storageUsage} text={storageDetails} /> : null}
        </Row>
        <SwitchRow label={t('audio.download.wifiOnly')} value={wifiOnly} onChange={(v) => setPrefs({ wifiOnlyDownloads: v })} />
      </Surface>

      {list.data.length === 0 && !list.loading ? <EmptyState title={t('audio.offline.notDownloaded')} description={t('audio.offline.banner')} mascotState="quiet_audio" icon="download" actionLabel={L.browse} onAction={() => router.push('/audio')} /> : null}

      {list.data.map((r) => (
        <Surface key={r.lessonId} variant="elevated" level={1} radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.sm }}>
          <Pressable accessibilityRole="button" accessibilityLabel={r.title} onPress={() => router.push({ pathname: '/audio/lesson/[id]', params: { id: r.lessonId, autoplay: '0' } })}>
            <Row gap={theme.spacing.md} align="center">
              <CoverArt imageUri={r.artworkUri} courseTrackId={r.courseTrackId} title={r.title} size={56} square />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText variant="label" numberOfLines={2}>
                  {r.title}
                </ThemedText>
                {r.subtitle ? (
                  <ThemedText variant="caption" tone="muted" numberOfLines={1}>
                    {r.subtitle}
                  </ThemedText>
                ) : null}
                <Row gap={theme.spacing.xs} wrap>
                  {r.durationMs !== null ? <Chip label={formatDurationMs(r.durationMs)} /> : null}
                  <Chip label={t('audio.download.size', { size: formatMegabytes(r.totalBytes || r.bytesDownloaded) })} />
                </Row>
              </View>
            </Row>
          </Pressable>
          <Row gap={theme.spacing.sm} justify="space-between" align="center">
            <DownloadControls lessonId={r.lessonId} offlineEligible meta={{ title: r.title, subtitle: r.subtitle, durationMs: r.durationMs, artworkUri: r.artworkUri, courseTrackId: r.courseTrackId }} compact />
            {r.attributionText ? <InfoAffordance label={t('audio.player.details')} title={r.title} text={r.attributionText} /> : null}
          </Row>
        </Surface>
      ))}

      {list.data.length > 0 ? <Button label={L.deleteAll} variant="danger" icon="close" onPress={removeAll} accessibilityLabel={L.deleteAll} /> : null}
    </Screen>
  );
}
