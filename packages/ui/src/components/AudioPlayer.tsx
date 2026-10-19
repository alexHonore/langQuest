/**
 * Audio player UI shell (§10.2B screen 7). No audio engine inside: the app
 * passes an {@link AudioPlayerController} (expo-audio, web Audio, …) and this
 * component renders artwork, seek bar, speed, ±skip, chapters, sleep timer,
 * download state, transcript toggle, bookmark and "Practice this with AI".
 * Progress is whatever the controller reports — never estimated.
 */
import React, { useMemo, useState } from 'react';
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AUDIO_LABELS, mergeLabels, type LocalizedLabels } from './labels';
import {
  type ChapterMarker,
  PLAYBACK_RATES,
  type PlaybackRate,
  chapterIndexAt,
  clamp,
  formatDurationMs,
  nextPlaybackRate,
} from './logic';
import { Button, Chip, IconButton, Row, Surface, ThemedText } from './primitives';
import { Skeleton } from './Skeleton';

export type AudioPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/** What the app's audio engine must expose. All methods are fire-and-forget. */
export interface AudioPlayerController {
  status: AudioPlaybackStatus;
  positionMs: number;
  durationMs: number | null;
  rate: number;
  play: () => void;
  pause: () => void;
  seekTo: (positionMs: number) => void;
  setRate: (rate: PlaybackRate) => void;
  /** Sleep timer remaining (null = off). */
  sleepRemainingMs?: number | null;
  setSleepTimer?: (minutes: number | null) => void;
}

export type DownloadState =
  | { status: 'none' }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; byteLength?: number }
  | { status: 'error'; message?: string };

export interface AudioPlayerProps {
  controller: AudioPlayerController;
  title: string;
  subtitle?: string | null;
  /** Artwork node (e.g. `<CourseCover />` or an `Image`). */
  artwork?: React.ReactNode;
  chapters?: readonly ChapterMarker[];
  onSelectChapter?: (chapter: ChapterMarker) => void;
  skipSeconds?: 10 | 15;
  download?: DownloadState;
  onDownload?: () => void;
  onRemoveDownload?: () => void;
  transcript?: { available: boolean; visible: boolean; onToggle: () => void };
  onBookmark?: () => void;
  onPracticeWithAi?: () => void;
  onRepeatSentence?: () => void;
  sleepOptionsMinutes?: readonly number[];
  /** Localized error text when `controller.status === 'error'`. */
  errorText?: string | null;
  /** Shown when the file is synthetic/attributed (e.g. CC-BY line). */
  attributionText?: string | null;
  compact?: boolean;
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof AUDIO_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function SeekBar(props: {
  positionMs: number;
  durationMs: number | null;
  onSeek: (ms: number) => void;
  label: string;
  skipMs: number;
}): React.JSX.Element {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const duration = props.durationMs ?? 0;
  const fraction = duration > 0 ? clamp(props.positionMs / duration, 0, 1) : 0;
  const seekFromEvent = (e: GestureResponderEvent): void => {
    if (duration <= 0 || width <= 0) return;
    const x = e.nativeEvent.locationX;
    const f = clamp(x / width, 0, 1);
    props.onSeek(
      Math.round((theme.direction.mirrorRows && theme.direction.rtl ? 1 - f : f) * duration),
    );
  };
  return (
    <Pressable
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={props.label}
      accessibilityValue={{
        min: 0,
        max: Math.round(duration / 1000),
        now: Math.round(props.positionMs / 1000),
        text: formatDurationMs(props.positionMs),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const delta = e.nativeEvent.actionName === 'increment' ? props.skipMs : -props.skipMs;
        props.onSeek(clamp(props.positionMs + delta, 0, duration));
      }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onPress={seekFromEvent}
      disabled={duration <= 0}
      hitSlop={{ top: 12, bottom: 12 }}
      style={{ height: 24, justifyContent: 'center' }}
    >
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.surfaceMuted,
          overflow: 'hidden',
          borderWidth: theme.highContrast ? 1 : 0,
          borderColor: theme.colors.border,
        }}
      >
        <View
          style={{
            width: `${fraction * 100}%`,
            height: '100%',
            backgroundColor: theme.colors.accent,
            alignSelf:
              theme.direction.mirrorRows && theme.direction.rtl ? 'flex-end' : 'flex-start',
          }}
        />
      </View>
      {width > 0 && duration > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            [theme.direction.rtl ? 'right' : 'left']: clamp(
              fraction * width - 8,
              0,
              Math.max(0, width - 16),
            ),
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: theme.colors.accent,
            borderWidth: 2,
            borderColor: theme.colors.surface,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function AudioPlayer(props: AudioPlayerProps): React.JSX.Element {
  const {
    controller,
    title,
    subtitle,
    artwork,
    chapters = [],
    onSelectChapter,
    skipSeconds = 10,
    download = { status: 'none' },
    onDownload,
    onRemoveDownload,
    transcript,
    onBookmark,
    onPracticeWithAi,
    onRepeatSentence,
    sleepOptionsMinutes = [15, 30, 45, 60],
    errorText,
    attributionText,
    compact = false,
    labels,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const L = mergeLabels(AUDIO_LABELS, labels);
  const [showChapters, setShowChapters] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const skipMs = skipSeconds * 1000;
  const playing = controller.status === 'playing';
  const loading = controller.status === 'loading';
  const duration = controller.durationMs;
  const chapterIdx = useMemo(
    () => chapterIndexAt(chapters, controller.positionMs),
    [chapters, controller.positionMs],
  );
  const currentChapter = chapterIdx >= 0 ? chapters[chapterIdx] : undefined;
  const positionText = L.position(
    formatDurationMs(controller.positionMs),
    duration === null ? '–:––' : formatDurationMs(duration),
  );

  const seek = (ms: number): void =>
    controller.seekTo(clamp(ms, 0, duration ?? Number.MAX_SAFE_INTEGER));

  const downloadLabel =
    download.status === 'downloaded'
      ? L.downloaded
      : download.status === 'downloading'
        ? L.downloading(download.progress * 100)
        : download.status === 'error'
          ? L.error
          : L.download;

  return (
    <Surface
      variant="elevated"
      level={2}
      radius="lg"
      padding={theme.spacing.lg}
      style={[{ gap: theme.spacing.md }, style]}
      testID={testID}
      accessibilityState={{ busy: loading }}
    >
      <Row gap={theme.spacing.md} align="flex-start">
        {artwork ? (
          <View
            style={{
              width: compact ? 56 : 96,
              height: compact ? 56 : 96,
              borderRadius: theme.radii.md,
              overflow: 'hidden',
            }}
          >
            {artwork}
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText
            variant={compact ? 'label' : 'subheading'}
            numberOfLines={2}
            accessibilityRole="header"
          >
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText variant="caption" tone="secondary" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          ) : null}
          {currentChapter ? (
            <ThemedText variant="caption" tone="muted" numberOfLines={1}>
              {currentChapter.title}
            </ThemedText>
          ) : null}
        </View>
        {onBookmark ? (
          <IconButton icon="bookmark" accessibilityLabel={L.bookmark} onPress={onBookmark} />
        ) : null}
      </Row>

      {controller.status === 'error' ? (
        <ThemedText variant="label" tone="error">
          {errorText ?? L.error}
        </ThemedText>
      ) : loading && duration === null ? (
        <Skeleton height={6} />
      ) : (
        <SeekBar
          positionMs={controller.positionMs}
          durationMs={duration}
          onSeek={seek}
          label={L.seek}
          skipMs={skipMs}
        />
      )}
      <Row justify="space-between">
        <ThemedText variant="caption" tone="muted" accessibilityLiveRegion="polite">
          {positionText}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={L.speed(controller.rate)}
          onPress={() => controller.setRate(nextPlaybackRate(controller.rate))}
          hitSlop={8}
        >
          <Chip
            label={`${controller.rate}×`}
            tone="neutral"
            accessibilityLabel={L.speed(controller.rate)}
          />
        </Pressable>
      </Row>

      <Row gap={theme.spacing.md} justify="center">
        <IconButton
          icon="skip10back"
          accessibilityLabel={L.skipBack(skipSeconds)}
          onPress={() => seek(controller.positionMs - skipMs)}
          mirrorRtl
          size={theme.iconSizes.lg}
        />
        <IconButton
          icon={playing ? 'pause' : 'play'}
          accessibilityLabel={playing ? L.pause : L.play}
          accessibilityState={{ busy: loading }}
          onPress={() => (playing ? controller.pause() : controller.play())}
          selected
          size={theme.iconSizes.xl}
          disabled={controller.status === 'error'}
        />
        <IconButton
          icon="skip10forward"
          accessibilityLabel={L.skipForward(skipSeconds)}
          onPress={() => seek(controller.positionMs + skipMs)}
          mirrorRtl
          size={theme.iconSizes.lg}
        />
      </Row>

      {!compact ? (
        <Row gap={theme.spacing.sm} wrap justify="center">
          {chapters.length > 0 ? (
            <Button
              variant={showChapters ? 'primary' : 'secondary'}
              size="sm"
              icon="missions"
              label={L.chapters}
              onPress={() => setShowChapters((v) => !v)}
            />
          ) : null}
          {controller.setSleepTimer ? (
            <Button
              variant={controller.sleepRemainingMs ? 'primary' : 'secondary'}
              size="sm"
              icon="sleep"
              label={
                controller.sleepRemainingMs
                  ? `${L.sleepTimer} ${formatDurationMs(controller.sleepRemainingMs)}`
                  : L.sleepTimer
              }
              onPress={() => setShowSleep((v) => !v)}
            />
          ) : null}
          {transcript?.available ? (
            // No transcript → no toggle at all (CONVENTIONS §8: never a disabled placeholder).
            <Button
              variant={transcript.visible ? 'primary' : 'secondary'}
              size="sm"
              icon="transcript"
              label={L.transcript}
              onPress={transcript.onToggle}
            />
          ) : null}
          {onDownload || onRemoveDownload ? (
            <Button
              variant={download.status === 'downloaded' ? 'ghost' : 'secondary'}
              size="sm"
              icon={download.status === 'downloaded' ? 'offline' : 'download'}
              label={downloadLabel}
              loading={download.status === 'downloading'}
              onPress={download.status === 'downloaded' ? onRemoveDownload : onDownload}
              accessibilityLabel={
                download.status === 'downloaded'
                  ? `${L.downloaded}. ${L.removeDownload}`
                  : downloadLabel
              }
            />
          ) : null}
          {onRepeatSentence ? (
            <Button
              variant="secondary"
              size="sm"
              icon="replay"
              label={L.repeatSentence}
              onPress={onRepeatSentence}
            />
          ) : null}
          {onPracticeWithAi ? (
            <Button
              variant="primary"
              size="sm"
              icon="speak"
              label={L.practice}
              onPress={onPracticeWithAi}
            />
          ) : null}
        </Row>
      ) : null}

      {showSleep && controller.setSleepTimer ? (
        <Row gap={theme.spacing.xs} wrap accessibilityLabel={L.sleepTimer}>
          <Chip
            label={L.sleepOff}
            selected={!controller.sleepRemainingMs}
            onPress={() => controller.setSleepTimer?.(null)}
          />
          {sleepOptionsMinutes.map((m) => (
            <Chip key={m} label={L.sleepMinutes(m)} onPress={() => controller.setSleepTimer?.(m)} />
          ))}
        </Row>
      ) : null}

      {showChapters && chapters.length > 0 ? (
        <ScrollView style={{ maxHeight: 220 }} accessibilityRole="list">
          {chapters.map((c, i) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={`${c.title}, ${formatDurationMs(c.startMs)}`}
              accessibilityState={{ selected: i === chapterIdx }}
              onPress={() => {
                seek(c.startMs);
                onSelectChapter?.(c);
              }}
              style={({ pressed }) => ({
                paddingVertical: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radii.sm,
                backgroundColor:
                  i === chapterIdx
                    ? theme.colors.accentSoft
                    : pressed
                      ? theme.colors.surfaceMuted
                      : 'transparent',
              })}
            >
              <Row justify="space-between">
                <ThemedText
                  variant="label"
                  tone={i === chapterIdx ? 'accent' : 'primary'}
                  style={{ flex: 1 }}
                  numberOfLines={1}
                >
                  {c.title}
                </ThemedText>
                <ThemedText variant="caption" tone="muted">
                  {formatDurationMs(c.startMs)}
                </ThemedText>
              </Row>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {attributionText ? (
        <ThemedText variant="caption" tone="muted">
          {attributionText}
        </ThemedText>
      ) : null}
    </Surface>
  );
}

export { PLAYBACK_RATES };
