/**
 * Mascot companion: wraps `MascotSvg` with a state, an optional speech bubble
 * and the learner's preferences. Honors `mascotEnabled` (renders nothing, or
 * only the bubble text when `bubbleWhenDisabled`), and `reducedMotion`
 * (static art, no idle loop). The bubble text must already be in the
 * enrollment's source language (§10.2A item 6).
 */
import type { MascotState } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { MASCOT_ACCESSIBILITY_LABELS, MascotSvg } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { Row, Surface, ThemedText } from './primitives';

export type MascotVariant = 'icon' | 'companion' | 'welcome' | 'celebration';

export interface MascotProps {
  state: MascotState;
  /** Size preset (§10.2A item 5) or an explicit dp size. */
  size?: MascotVariant | number;
  /** Speech bubble text, localized to the enrollment's source language. */
  speech?: string;
  /** Where the bubble sits relative to the mascot. */
  bubblePlacement?: 'end' | 'below';
  /** Opt-in idle animation (blink/breath). Ignored under reduced motion. */
  animate?: boolean;
  /** When the learner disabled the mascot, still show `speech` as plain text. */
  bubbleWhenDisabled?: boolean;
  /** Localized accessibility label; defaults to the art module's state label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function mascotSize(
  theme: ReturnType<typeof useTheme>,
  size: MascotVariant | number,
): number {
  if (typeof size === 'number') return size;
  switch (size) {
    case 'icon':
      return theme.illustration.mascotIcon;
    case 'welcome':
      return theme.illustration.mascotWelcome;
    case 'celebration':
      return theme.illustration.mascotCelebration;
    default:
      return theme.illustration.mascotCompanion;
  }
}

export function Mascot(props: MascotProps): React.JSX.Element | null {
  const {
    state,
    size = 'companion',
    speech,
    bubblePlacement = 'end',
    animate = false,
    bubbleWhenDisabled = true,
    accessibilityLabel,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const px = mascotSize(theme, size);
  const label = accessibilityLabel ?? MASCOT_ACCESSIBILITY_LABELS[state];
  // Chameleon tint: situation (state) × course family (theme.courseTrackId). Without it
  // the shared Mascot would ignore the active course and only the state hue would apply.
  const tint = theme.mascotTint(state);

  const bubble = speech ? (
    <Surface
      variant="elevated"
      level={1}
      radius="lg"
      padding={theme.spacing.md}
      style={{ maxWidth: 280, flexShrink: 1 }}
      accessibilityRole="text"
    >
      <ThemedText variant="body">{speech}</ThemedText>
    </Surface>
  ) : null;

  if (!theme.mascotEnabled) {
    if (!speech || !bubbleWhenDisabled) return null;
    return (
      <View style={style} testID={testID}>
        {bubble}
      </View>
    );
  }

  const art = (
    <MascotSvg
      state={state}
      size={px}
      theme={theme.artTheme}
      tint={tint}
      trackId={theme.courseTrackId}
      reducedMotion={theme.reducedMotion}
      animate={animate && !theme.reducedMotion}
      accessibilityLabel={label}
    />
  );

  if (!bubble) {
    return (
      <View style={style} testID={testID}>
        {art}
      </View>
    );
  }

  if (bubblePlacement === 'below') {
    return (
      <View style={[{ alignItems: 'center', gap: theme.spacing.sm }, style]} testID={testID}>
        {art}
        {bubble}
      </View>
    );
  }
  return (
    <Row gap={theme.spacing.md} align="flex-end" style={style} testID={testID}>
      {art}
      {bubble}
    </Row>
  );
}
