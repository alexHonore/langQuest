import { getCourseTrack } from '@langquest/contracts';
import { Button, Chip, EmptyState, Row, StatusLine, Surface, ThemedText, formatDurationMs, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { mediaUnavailableReason } from '@/features/audio/api';
import { CoverArt } from '@/features/audio/components/CoverArt';
import { MediaNotice } from '@/features/audio/components/MediaNotice';
import { useAudioLabels } from '@/features/audio/labels';
import { EMPTY_FILTERS, filterCollections, type AudioCollectionSummary } from '@/features/audio/library-search';
import { useAudioCollections, useCollectionsScope } from '@/features/audio/queries';
import { useAudioRuntime, useContinueListening, useStorageSummary } from '@/features/audio/use-audio';
import { useActiveEnrollment } from '@/features/session/queries';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { formatMegabytes } from '@/features/audio/download-index';

/** Screen 7: audio course / audiobook library (collections, continue listening, search, downloads). */
export default function AudioLibrary(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const L = useAudioLabels();
  const names = useLanguageNames();
  const { configured } = useServices();
  const { enrollment } = useActiveEnrollment();
  const [allLanguages, setAllLanguages] = useState(false);
  const [query, setQuery] = useState('');
  const scope = useCollectionsScope(enrollment, allLanguages);
  const collections = useAudioCollections(scope);
  const continueListening = useContinueListening(6);
  const storage = useStorageSummary();
  const runtime = useAudioRuntime();
  useEffect(() => track.screenView('audio_library', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);

  const filtered = useMemo(() => filterCollections(collections.data?.data.items ?? [], { ...EMPTY_FILTERS, query }), [collections.data, query]);
  const trackName = enrollment ? getCourseTrack(enrollment.courseTrackId).displayName : null;

  return (
    <Screen insideTabs title={t('audio.library')} headerEnd={<Button label={L.downloads} variant="ghost" size="sm" icon="download" onPress={() => router.push('/audio/downloads')} accessibilityLabel={L.downloads} />}>
      {!configured ? <MediaNotice reason="not_configured" /> : null}

      {continueListening.data.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <ThemedText variant="heading" accessibilityRole="header">
            {L.continueListening}
          </ThemedText>
          {continueListening.data.map((p) => {
            const remaining = p.durationMs ? Math.max(0, Math.round((p.durationMs - p.positionMs) / 60000)) : null;
            return (
              <Pressable key={p.lessonId} accessibilityRole="button" accessibilityLabel={`${t('audio.progress.resume', { position: formatDurationMs(p.positionMs) })}: ${p.meta.title}`} onPress={() => router.push({ pathname: '/audio/lesson/[id]', params: { id: p.lessonId } })}>
                <Surface variant="muted" radius="lg" padding={theme.spacing.md}>
                  <Row gap={theme.spacing.md} align="center">
                    <CoverArt imageUri={p.meta.artworkUri} courseTrackId={p.meta.courseTrackId} title={p.meta.title} size={56} square />
                    <View style={{ flex: 1, gap: 2 }}>
                      <ThemedText variant="label" numberOfLines={2}>
                        {p.meta.title}
                      </ThemedText>
                      {p.meta.subtitle ? (
                        <ThemedText variant="caption" tone="muted" numberOfLines={1}>
                          {p.meta.subtitle}
                        </ThemedText>
                      ) : null}
                      <ThemedText variant="caption" tone="secondary">
                        {t('audio.progress.resume', { position: formatDurationMs(p.positionMs) })}
                        {remaining !== null ? ` · ${L.minutesLeft(remaining)}` : ''}
                      </ThemedText>
                    </View>
                  </Row>
                </Surface>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <ThemedText variant="heading" accessibilityRole="header">
          {t('audio.collections')}
        </ThemedText>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={L.searchPlaceholder}
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={t('common.search')}
          returnKeyType="search"
          style={{ ...theme.text('body'), color: theme.colors.textPrimary, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, minHeight: 44, textAlign: theme.direction.rtl ? 'right' : 'left' }}
        />
        <Row gap={theme.spacing.xs} wrap>
          {enrollment ? <Chip label={`${L.myCourse}: ${trackName}`} selected={!allLanguages} onPress={() => setAllLanguages(false)} icon="audio" /> : null}
          <Chip label={L.allLanguages} selected={allLanguages || !enrollment} onPress={() => setAllLanguages(true)} icon="globe" />
          {scope.instructionLanguageCode ? <Chip label={`${t('audio.filters.sourceLanguage')}: ${names(scope.instructionLanguageCode)}`} tone="info" /> : null}
        </Row>
      </View>

      {collections.isLoading ? <LoadingView /> : null}
      {collections.error && !collections.data ? (
        mediaUnavailableReason(collections.error) === 'not_configured' ? null : <ErrorView error={collections.error} onRetry={() => void collections.refetch()} />
      ) : null}
      {collections.data?.fromCache ? <CacheNotice fetchedAt={collections.data.fetchedAt} /> : null}
      {collections.data && filtered.length === 0 ? <EmptyState title={query ? L.noResults : L.noCollections} description={query ? undefined : t('audio.offline.notDownloaded')} mascotState="quiet_audio" icon="headphones" actionLabel={!allLanguages && enrollment ? L.allLanguages : undefined} onAction={!allLanguages && enrollment ? () => setAllLanguages(true) : undefined} /> : null}
      {filtered.map((c) => (
        <CollectionCard key={c.id} collection={c} onPress={() => router.push({ pathname: '/audio/collection/[id]', params: { id: c.id } })} />
      ))}

      {runtime?.downloadsSupported && storage.data.lessons > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={L.downloads} onPress={() => router.push('/audio/downloads')}>
          <StatusLine icon="offline" tone="secondary" text={`${t('audio.download.storageUsed', { used: formatMegabytes(storage.data.bytesOnDisk) })} · ${L.lessonsCount(storage.data.completeLessons)}`} />
        </Pressable>
      ) : null}
    </Screen>
  );
}

function CollectionCard(props: { collection: AudioCollectionSummary; onPress: () => void }): React.JSX.Element {
  const theme = useTheme();
  const t = useT();
  const L = useAudioLabels();
  const names = useLanguageNames();
  const c = props.collection;
  const total = c.totalDurationMs !== null ? formatDurationMs(c.totalDurationMs) : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={c.title} onPress={props.onPress}>
      <Surface variant="elevated" level={1} radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.sm }}>
        <Row gap={theme.spacing.md} align="flex-start">
          <CoverArt imageUri={c.coverArt?.publicUrl} courseTrackId={c.courseTrackId} title={c.title} size={96} />
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText variant="subheading" numberOfLines={2}>
              {c.title}
            </ThemedText>
            {c.description ? (
              <ThemedText variant="caption" tone="secondary" numberOfLines={3}>
                {c.description}
              </ThemedText>
            ) : null}
            <ThemedText variant="caption" tone="muted">
              {[L.chaptersCount(c.chapterCount), L.lessonsCount(c.lessonCount), total].filter(Boolean).join(' · ')}
            </ThemedText>
            {c.instructorName ? (
              <ThemedText variant="caption" tone="muted">
                {t('audio.attribution', { speaker: c.instructorName })}
              </ThemedText>
            ) : null}
          </View>
        </Row>
        <Row gap={theme.spacing.xs} wrap>
          {c.targetVarietyId ? <Chip label={c.targetVarietyId} tone="accent" /> : null}
          {c.instructionLanguageCode ? <Chip label={`${t('audio.filters.sourceLanguage')}: ${names(c.instructionLanguageCode)}`} tone="info" /> : null}
          {c.region ? <Chip label={c.region} /> : null}
          {c.offlineEligible ? <Chip label={t('audio.download.download')} icon="download" tone="success" /> : null}
        </Row>
        {c.attributionText ? (
          <ThemedText variant="caption" tone="muted">
            {c.attributionText}
          </ThemedText>
        ) : null}
      </Surface>
    </Pressable>
  );
}
