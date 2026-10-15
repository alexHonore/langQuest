/**
 * Global mini player (§10.2B screen 7, Phase 3): artwork, title, honest
 * state line (buffering / interrupted / error), play-pause and skip, tap to
 * open the full player. Rendered above the tab bar; hidden when nothing is
 * queued or when the full player is on screen.
 */
import { IconButton, ProgressBar, Surface, ThemedText, useTheme } from '@langquest/ui';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { SKIP_FORWARD_MS, currentItem } from '@/audio/engine-state';
import { useT } from '@/lib/i18n';
import { useAudioLabels } from '../labels';
import { useAudioRuntime, useEngineState } from '../use-audio';
import { CoverArt } from './CoverArt';

export const MINI_PLAYER_HEIGHT = 64;

export function MiniPlayer(props: { bottomOffset: number }): React.JSX.Element | null {
  const theme = useTheme();
  const t = useT();
  const L = useAudioLabels();
  const router = useRouter();
  const pathname = usePathname();
  const runtime = useAudioRuntime();
  const state = useEngineState();
  const item = currentItem(state);
  if (!item || !runtime || pathname.startsWith('/audio/lesson/')) return null;
  const engine = runtime.engine;
  const playing = state.status === 'playing';
  const fraction = state.durationMs ? Math.min(1, state.positionMs / state.durationMs) : 0;
  const line =
    state.status === 'error'
      ? (state.error?.message ?? t('errors.audioPlayback'))
      : state.status === 'loading' || state.buffering
        ? t('common.loading')
        : state.pauseReason === 'interrupted'
          ? L.interrupted
          : state.pauseReason === 'sleep_timer'
            ? L.sleepTimerFired
            : (item.subtitle ?? t('audio.player.nowPlaying'));
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: props.bottomOffset, paddingHorizontal: theme.spacing.sm }}>
      <Surface variant="elevated" level={3} radius="lg" padding={0} style={{ overflow: 'hidden' }} accessibilityLabel={t('audio.player.nowPlaying')}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${L.expand}: ${item.title}`} onPress={() => router.push({ pathname: '/audio/lesson/[id]', params: { id: item.id, autoplay: '0' } })} style={{ flexDirection: theme.direction.row, alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.sm, minHeight: MINI_PLAYER_HEIGHT - 4 }}>
          <CoverArt imageUri={item.artworkUri} courseTrackId={item.courseTrackId} title={item.title} size={44} square />
          <View style={{ flex: 1, gap: 1 }}>
            <ThemedText variant="label" numberOfLines={1}>
              {item.title}
            </ThemedText>
            <ThemedText variant="caption" tone={state.status === 'error' ? 'error' : 'muted'} numberOfLines={1}>
              {line}
            </ThemedText>
          </View>
          <IconButton icon="skip10back" accessibilityLabel={t('audio.player.skipBack', { seconds: 10 })} onPress={() => void engine.skipBack()} mirrorRtl />
          <IconButton icon={playing ? 'pause' : 'play'} accessibilityLabel={playing ? t('audio.player.pause') : t('audio.player.play')} onPress={() => void engine.toggle()} selected size={theme.iconSizes.lg} disabled={state.status === 'loading'} />
          <IconButton icon="skip10forward" accessibilityLabel={t('audio.player.skipForward', { seconds: SKIP_FORWARD_MS / 1000 })} onPress={() => void engine.skipForward()} mirrorRtl />
        </Pressable>
        <ProgressBar value={fraction} accessibilityLabel={t('audio.player.position', { current: Math.round(state.positionMs / 1000), total: Math.round((state.durationMs ?? 0) / 1000) })} height={3} />
      </Surface>
    </View>
  );
}
