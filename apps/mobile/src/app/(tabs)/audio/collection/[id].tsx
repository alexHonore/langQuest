import type { LearnerLevel } from '@langquest/contracts';
import { Button, Chip, EmptyState, Row, Surface, ThemedText, formatDurationMs, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { CacheNotice, ErrorView, LoadingView } from '@/components/StateViews';
import { CoverArt } from '@/features/audio/components/CoverArt';
import { useAudioLabels } from '@/features/audio/labels';
import { EMPTY_FILTERS, filterLessons, hasActiveFilters, speakerOptions, type LengthBucket, type LibraryFilters } from '@/features/audio/library-search';
import { useCollectionManifest } from '@/features/audio/queries';
import { buildQueue } from '@/features/audio/queue';
import { useAudioRuntime, useContinueListening, useOfflineLessonIds } from '@/features/audio/use-audio';
import { useActiveEnrollment } from '@/features/session/queries';
import { useT } from '@/lib/i18n';

const LEVELS: readonly LearnerLevel[] = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'];
const LENGTHS: readonly LengthBucket[] = ['short', 'medium', 'long'];

/** Collection → chapters → lessons with per-lesson progress, offline badge and lesson-level filters. */
export default function CollectionScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const L = useAudioLabels();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enrollment } = useActiveEnrollment();
  const runtime = useAudioRuntime();
  const manifestQuery = useCollectionManifest(id ?? null);
  const manifest = manifestQuery.data?.data ?? null;
  const offline = useOfflineLessonIds();
  const recent = useContinueListening(50);
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const speakers = useMemo(() => (manifest ? speakerOptions([manifest]) : []), [manifest]);
  const hits = useMemo(() => (manifest ? filterLessons(manifest, filters) : []), [manifest, filters]);
  const hitIds = useMemo(() => new Set(hits.map((h) => h.lesson.id)), [hits]);
  const positions = useMemo(() => new Map(recent.data.map((p) => [p.lessonId, p] as const)), [recent.data]);

  const playChapter = async (chapterId: string): Promise<void> => {
    if (!runtime || !manifest) return;
    const queue = buildQueue(manifest, { chapterId, courseTrackId: enrollment?.courseTrackId ?? null });
    const first = queue[0];
    if (!first) return;
    await runtime.engine.setQueue(queue, 0, { autoplay: true });
    router.push({ pathname: '/audio/lesson/[id]', params: { id: first.id, autoplay: '0' } });
  };

  const levelLabel = (l: LearnerLevel): string => L.level[l] ?? l;
  const lengthLabel = (b: LengthBucket): string => (b === 'short' ? L.lengthShort : b === 'medium' ? L.lengthMedium : L.lengthLong);

  return (
    <Screen insideTabs title={manifest?.title ?? t('audio.collections')} onBack={() => router.back()}>
      {manifestQuery.isLoading ? <LoadingView /> : null}
      {manifestQuery.error && !manifest ? <ErrorView error={manifestQuery.error} onRetry={() => void manifestQuery.refetch()} /> : null}
      {manifestQuery.data?.fromCache ? <CacheNotice fetchedAt={manifestQuery.data.fetchedAt} /> : null}
      {manifest ? (
        <>
          <Row gap={theme.spacing.md} align="flex-start">
            <CoverArt imageUri={manifest.coverArt?.publicUrl} courseTrackId={enrollment?.courseTrackId ?? null} title={manifest.title} size={120} />
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <ThemedText variant="caption" tone="muted">
                {L.chaptersCount(manifest.chapters.length)} · {L.lessonsCount(manifest.chapters.reduce((n, c) => n + c.lessons.length, 0))}
              </ThemedText>
              {manifest.attributionText ? (
                <ThemedText variant="caption" tone="muted">
                  {manifest.attributionText}
                </ThemedText>
              ) : null}
            </View>
          </Row>

          <TextInput
            value={filters.query}
            onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
            placeholder={L.searchPlaceholder}
            placeholderTextColor={theme.colors.textMuted}
            accessibilityLabel={t('common.search')}
            style={{ ...theme.text('body'), color: theme.colors.textPrimary, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, minHeight: 44, textAlign: theme.direction.rtl ? 'right' : 'left' }}
          />
          <Row gap={theme.spacing.xs} wrap accessibilityLabel={t('audio.filters.level')}>
            <Chip label={L.anyLevel} selected={filters.level === null} onPress={() => setFilters((f) => ({ ...f, level: null }))} />
            {LEVELS.map((l) => (
              <Chip key={l} label={levelLabel(l)} selected={filters.level === l} onPress={() => setFilters((f) => ({ ...f, level: f.level === l ? null : l }))} />
            ))}
          </Row>
          <Row gap={theme.spacing.xs} wrap accessibilityLabel={t('audio.filters.length')}>
            <Chip label={L.anyLength} selected={filters.length === null} onPress={() => setFilters((f) => ({ ...f, length: null }))} />
            {LENGTHS.map((b) => (
              <Chip key={b} label={lengthLabel(b)} selected={filters.length === b} onPress={() => setFilters((f) => ({ ...f, length: f.length === b ? null : b }))} />
            ))}
          </Row>
          {speakers.length > 0 ? (
            <Row gap={theme.spacing.xs} wrap accessibilityLabel={t('audio.filters.speaker')}>
              <Chip label={L.anySpeaker} selected={filters.speaker === null} onPress={() => setFilters((f) => ({ ...f, speaker: null }))} />
              {speakers.map((s) => (
                <Chip key={s} label={s} selected={filters.speaker === s} onPress={() => setFilters((f) => ({ ...f, speaker: f.speaker === s ? null : s }))} />
              ))}
            </Row>
          ) : null}
          {hasActiveFilters(filters) ? <Button label={t('common.clearFilters')} variant="ghost" size="sm" icon="close" onPress={() => setFilters(EMPTY_FILTERS)} /> : null}

          {hits.length === 0 ? <EmptyState title={L.noResults} icon="search" mascotState="curious" /> : null}
          {[...manifest.chapters]
            .sort((a, b) => a.order - b.order)
            .map((chapter) => {
              const lessons = [...chapter.lessons].sort((a, b) => a.order - b.order).filter((l) => hitIds.has(l.id));
              if (lessons.length === 0) return null;
              return (
                <View key={chapter.id} style={{ gap: theme.spacing.sm }}>
                  <Row gap={theme.spacing.sm} justify="space-between" align="center">
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="heading" accessibilityRole="header">
                        {chapter.title}
                      </ThemedText>
                      {chapter.summary ? (
                        <ThemedText variant="caption" tone="secondary">
                          {chapter.summary}
                        </ThemedText>
                      ) : null}
                    </View>
                    <Button label={L.playAll} variant="secondary" size="sm" icon="play" onPress={() => void playChapter(chapter.id)} accessibilityLabel={`${L.playAll}: ${chapter.title}`} />
                  </Row>
                  {lessons.map((lesson) => {
                    const p = positions.get(lesson.id) ?? null;
                    const fraction = p && lesson.durationMs ? Math.min(1, p.positionMs / lesson.durationMs) : 0;
                    const playable = lesson.assets.some((a) => a.kind === 'audio');
                    return (
                      <Pressable key={lesson.id} accessibilityRole="button" accessibilityLabel={lesson.title} onPress={() => router.push({ pathname: '/audio/lesson/[id]', params: { id: lesson.id } })}>
                        <Surface variant="muted" radius="md" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
                          <Row gap={theme.spacing.sm} align="center">
                            <View style={{ flex: 1, gap: 2 }}>
                              <ThemedText variant="label" numberOfLines={2}>
                                {lesson.title}
                              </ThemedText>
                              <ThemedText variant="caption" tone="muted">
                                {[lesson.durationMs !== null ? formatDurationMs(lesson.durationMs) : null, lesson.level ? levelLabel(lesson.level) : null, lesson.speakerNames.join(', ') || null].filter(Boolean).join(' · ')}
                              </ThemedText>
                            </View>
                            {offline.has(lesson.id) ? <Chip label={t('audio.download.downloaded')} icon="offline" tone="success" /> : null}
                            {lesson.transcriptAvailable ? <Chip label={t('audio.player.transcript')} icon="transcript" /> : null}
                          </Row>
                          {p?.completed ? <Chip label={t('audio.progress.completed')} icon="check" tone="success" /> : fraction > 0 ? <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.surface, overflow: 'hidden' }}><View style={{ width: `${Math.round(fraction * 100)}%`, height: '100%', backgroundColor: theme.colors.accent }} /></View> : null}
                          {!playable ? (
                            <ThemedText variant="caption" tone="warning">
                              {t('common.notAvailable')}
                            </ThemedText>
                          ) : null}
                        </Surface>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
        </>
      ) : null}
    </Screen>
  );
}
