/**
 * Transparent speech-status indicator (§10.2A): character speaking, waiting,
 * learner microphone active, thinking, reconnecting, error. Only the two
 * states with real audio activity get a pulsing dot (static under reduced
 * motion); there is deliberately no waveform.
 */
import type { SpeechState } from '@langquest/contracts';
import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { SPEECH_STATE_LABELS } from './labels';
import { SPEECH_STATE_HAS_AUDIO } from './logic';
import { InlineIcon, Row, ThemedText } from './primitives';

export interface SpeechStateIndicatorProps {
  state: SpeechState;
  /** Localized labels; default English. */
  labels?: Partial<Record<SpeechState, string>>;
  /** Extra detail (e.g. "Retrying in 3 s", provider error text). */
  detail?: string | null;
  compact?: boolean;
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

function PulseDot(props: { color: string; active: boolean }): React.JSX.Element {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!props.active || theme.reducedMotion) {
      scale.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.5,
          duration: theme.motion.slow * 2,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: theme.motion.slow * 2,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [props.active, theme.reducedMotion, theme.motion.slow, scale]);
  return (
    <Animated.View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: props.color,
        transform: [{ scale }],
      }}
    />
  );
}

export function SpeechStateIndicator(props: SpeechStateIndicatorProps): React.JSX.Element {
  const { state, labels, detail, compact = false, style, testID } = props;
  const theme = useTheme();
  const label = labels?.[state] ?? SPEECH_STATE_LABELS[state];
  const color = speechStateColor(theme, state);
  const hasAudio = SPEECH_STATE_HAS_AUDIO[state];
  const tone = state === 'error' ? 'error' : state === 'reconnecting' ? 'warning' : 'secondary';
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      style={[
        {
          paddingVertical: theme.spacing.xs,
          paddingHorizontal: compact ? theme.spacing.sm : theme.spacing.md,
          borderRadius: theme.radii.pill,
          backgroundColor: compact ? 'transparent' : theme.colors.surfaceMuted,
          alignSelf: 'flex-start',
          borderWidth: theme.highContrast && !compact ? 1 : 0,
          borderColor: color,
        },
        style,
      ]}
      testID={testID}
    >
      <Row gap={theme.spacing.sm}>
        {hasAudio ? (
          <PulseDot color={color} active />
        ) : (
          <InlineIcon name={STATE_ICON[state]} color={color} size={theme.iconSizes.xs} />
        )}
        <ThemedText variant={compact ? 'caption' : 'label'} tone={tone} style={{ color }}>
          {label}
        </ThemedText>
      </Row>
      {detail && !compact ? (
        <ThemedText variant="caption" tone="muted">
          {detail}
        </ThemedText>
      ) : null}
    </View>
  );
}
