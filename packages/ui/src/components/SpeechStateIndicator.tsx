/**
 * Transparent speech-status indicator (§10.2A): character speaking, waiting,
 * learner microphone active, thinking, reconnecting, error. Only the two
 * states with real audio activity get a breathing glow ring (static under
 * reduced motion); there is deliberately no waveform. Calm density (default):
 * glow ring + ONE word; `detail` stays in the accessibility label.
 */
import type { SpeechState } from '@langquest/contracts';
import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName } from '../art';
import type { Density } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { SPEECH_STATE_LABELS, SPEECH_STATE_SHORT_LABELS } from './labels';
import { SPEECH_STATE_HAS_AUDIO } from './logic';
import { InlineIcon, Row, ThemedText } from './primitives';

export interface SpeechStateIndicatorProps {
  state: SpeechState;
  /** Localized labels; default English. */
  labels?: Partial<Record<SpeechState, string>>;
  /** Localized one-word labels for the calm density; default English. */
  shortLabels?: Partial<Record<SpeechState, string>>;
  /** Extra detail (e.g. "Retrying in 3 s", provider error text). Visible only in `full` density. */
  detail?: string | null;
  compact?: boolean;
  density?: Density;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const STATE_ICON: Record<SpeechState, IconName> = {
  idle: 'info',
  character_speaking: 'volume',
  waiting: 'speak',
  learner_mic_active: 'mic',
  thinking: 'hint',
  reconnecting: 'offline',
  error: 'warning',
};

export function speechStateColor(theme: ReturnType<typeof useTheme>, state: SpeechState): string {
  switch (state) {
    case 'character_speaking':
      return theme.colors.speech.speaking;
    case 'learner_mic_active':
      return theme.colors.speech.listening;
    case 'thinking':
      return theme.colors.speech.thinking;
    case 'reconnecting':
      return theme.colors.speech.reconnecting;
    case 'error':
      return theme.colors.speech.error;
    case 'waiting':
      return theme.colors.info;
    default:
      return theme.colors.textMuted;
  }
}

/** Breathing glow ring (opacity + scale 1 → 1.06), static under reduced motion / when inactive. */
export function GlowDot(props: {
  color: string;
  active: boolean;
  size?: number;
}): React.JSX.Element {
  const theme = useTheme();
  const size = props.size ?? 10;
  const pulse = useRef(new Animated.Value(0)).current;
  const animated = props.active && theme.motion.glowAnimated && theme.motion.glowPulse > 0;
  useEffect(() => {
    if (!animated) {
      pulse.setValue(props.active ? 1 : 0);
      return;
    }
    const half = theme.motion.glowPulse / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: half, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, props.active, theme.motion.glowPulse, pulse]);
  const glow = theme.glow(props.color, props.active ? undefined : 0);
  const ring = glow.ringWidth;
  return (
    <View
      style={{
        width: size + ring * 2,
        height: size + ring * 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size + ring * 2,
          height: size + ring * 2,
          borderRadius: (size + ring * 2) / 2,
          backgroundColor: glow.ringColor,
          opacity: props.active
            ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })
            : 0.35,
          transform: [
            {
              scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [1, theme.highContrast ? 1 : 1.06],
              }),
            },
          ],
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: props.color,
          shadowColor: glow.shadowColor,
          shadowOffset: glow.shadowOffset,
          shadowOpacity: props.active ? glow.shadowOpacity : 0,
          shadowRadius: glow.shadowRadius,
        }}
      />
    </View>
  );
}

export function SpeechStateIndicator(props: SpeechStateIndicatorProps): React.JSX.Element {
  const { state, labels, shortLabels, detail, compact = false, density, style, testID } = props;
  const theme = useTheme();
  const calm = (density ?? theme.density) === 'calm';
  const longLabel = labels?.[state] ?? SPEECH_STATE_LABELS[state];
  const label = calm ? (shortLabels?.[state] ?? SPEECH_STATE_SHORT_LABELS[state]) : longLabel;
  const color = speechStateColor(theme, state);
  const hasAudio = SPEECH_STATE_HAS_AUDIO[state];
  const tone = state === 'error' ? 'error' : state === 'reconnecting' ? 'warning' : 'secondary';
  const glass = theme.glass(2);
  const a11y = [longLabel, detail].filter(Boolean).join('. ');
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={a11y}
      style={[
        {
          paddingVertical: theme.spacing.xs,
          paddingHorizontal: compact ? theme.spacing.sm : theme.spacing.md,
          borderRadius: theme.radii.pill,
          backgroundColor: compact ? 'transparent' : glass.backgroundColor,
          alignSelf: 'flex-start',
          borderWidth: compact ? 0 : glass.borderWidth,
          borderColor: theme.highContrast ? color : glass.borderColor,
        },
        style,
      ]}
      testID={testID}
    >
      <Row gap={theme.spacing.sm}>
        {hasAudio ? (
          <GlowDot color={color} active />
        ) : (
          <InlineIcon name={STATE_ICON[state]} color={color} size={theme.iconSizes.xs} />
        )}
        <ThemedText variant={compact ? 'caption' : 'label'} tone={tone} style={{ color }}>
          {label}
        </ThemedText>
      </Row>
      {detail && !compact && !calm ? (
        <ThemedText variant="caption" tone="muted">
          {detail}
        </ThemedText>
      ) : null}
    </View>
  );
}
