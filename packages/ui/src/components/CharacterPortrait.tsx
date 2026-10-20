/**
 * Conversational character portrait with an honest speaking / listening
 * indicator. The indicator is a labelled ring + text — never a waveform,
 * which would imply live audio analysis that is not happening (§10.2A).
 */
import type { CharacterExpression, SpeechState } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { CharacterPortraitSvg, findCharacter } from '../art';
import type { Density } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { SPEECH_STATE_LABELS, SPEECH_STATE_SHORT_LABELS } from './labels';
import { Row, ThemedText } from './primitives';

export interface CharacterPortraitProps {
  /** Roster slug or stable UUID (see `findCharacter`). */
  characterId: string;
  expression?: CharacterExpression;
  /** Transparent speech status; drives the ring and the status text. */
  speechState?: SpeechState;
  size?: number;
  /** Localized display name; falls back to the roster name. */
  name?: string;
  /** Localized role / region line (e.g. "Café staff · Casablanca"). */
  subtitle?: string;
  /** Show the status text under the portrait (default true when `speechState` is set). */
  showStatusText?: boolean;
  /** Localized speech-state labels; default English. */
  stateLabels?: Partial<Record<SpeechState, string>>;
  density?: Density;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Expression implied by a speech state when the caller does not pick one. */
export function expressionForSpeechState(state: SpeechState | undefined): CharacterExpression {
  switch (state) {
    case 'character_speaking':
      return 'talking';
    case 'learner_mic_active':
      return 'listening';
    case 'waiting':
      return 'follow_up_question';
    case 'thinking':
      return 'neutral';
    case 'reconnecting':
    case 'error':
      return 'confusion';
    default:
      return 'neutral';
  }
}

export function CharacterPortrait(props: CharacterPortraitProps): React.JSX.Element {
  const {
    characterId,
    expression,
    speechState,
    size,
    name,
    subtitle,
    showStatusText,
    stateLabels,
    density,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const calm = (density ?? theme.density) === 'calm';
  const px = size ?? theme.illustration.portraitCard;
  const character = findCharacter(characterId);
  const displayName = name ?? character?.name ?? characterId;
  const resolvedExpression = expression ?? expressionForSpeechState(speechState);
  const ringColor =
    speechState === 'character_speaking'
      ? theme.colors.speech.speaking
      : speechState === 'learner_mic_active'
        ? theme.colors.speech.listening
        : speechState === 'thinking'
          ? theme.colors.speech.thinking
          : speechState === 'reconnecting'
            ? theme.colors.speech.reconnecting
            : speechState === 'error'
              ? theme.colors.speech.error
              : 'transparent';
  const statusText = speechState
    ? (stateLabels?.[speechState] ??
      (calm ? SPEECH_STATE_SHORT_LABELS[speechState] : SPEECH_STATE_LABELS[speechState]))
    : null;
  const active = speechState === 'character_speaking' || speechState === 'learner_mic_active';
  const glow =
    speechState && speechState !== 'idle' ? theme.glow(ringColor, active ? undefined : 0) : null;
  const ringWidth = glow ? (theme.highContrast ? 4 : glow.ringWidth) : 0;
  const a11y = [displayName, subtitle, statusText].filter(Boolean).join(', ');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11y}
      style={[{ alignItems: 'center' }, style]}
      testID={testID}
    >
      <View
        style={{
          width: px + ringWidth * 2 + 4,
          height: px + ringWidth * 2 + 4,
          borderRadius: (px + ringWidth * 2 + 4) / 2,
          borderWidth: ringWidth,
          borderColor: theme.highContrast || !glow ? ringColor : glow.ringColor,
          padding: 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
          ...(glow && active
            ? {
                shadowColor: glow.shadowColor,
                shadowOffset: glow.shadowOffset,
                shadowOpacity: glow.shadowOpacity,
                shadowRadius: glow.shadowRadius,
                elevation: glow.elevation,
              }
            : null),
        }}
      >
        <View style={{ width: px, height: px, borderRadius: px / 2, overflow: 'hidden' }}>
          <CharacterPortraitSvg
            characterId={characterId}
            expression={resolvedExpression}
            size={px}
            theme={theme.artTheme}
          />
        </View>
      </View>
      {name !== null && (name || character) ? (
        <ThemedText variant="label" align="center" style={{ marginTop: theme.spacing.xs }}>
          {displayName}
        </ThemedText>
      ) : null}
      {subtitle && !calm ? (
        <ThemedText variant="caption" tone="secondary" align="center">
          {subtitle}
        </ThemedText>
      ) : null}
      {statusText && (showStatusText ?? true) ? (
        <Row gap={theme.spacing.xs} style={{ marginTop: theme.spacing.xs }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: ringColor === 'transparent' ? theme.colors.textMuted : ringColor,
            }}
          />
          <ThemedText variant="caption" tone="secondary">
            {statusText}
          </ThemedText>
        </Row>
      ) : null}
    </View>
  );
}
