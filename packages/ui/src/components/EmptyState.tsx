/**
 * Graceful empty / error state (§10.2): mascot or icon, title, description and
 * an optional action. Offline and error variants are explicit, never blank panels.
 */
import type { MascotState } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { Mascot } from './Mascot';
import { Button, InlineIcon, ThemedText } from './primitives';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Mascot reaction (hidden automatically when the learner disabled the mascot). */
  mascotState?: MascotState;
  /** Icon fallback when the mascot is disabled or not wanted. */
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function EmptyState(props: EmptyStateProps): React.JSX.Element {
  const {
    title,
    description,
    mascotState,
    icon = 'info',
    actionLabel,
    onAction,
    secondaryActionLabel,
    onSecondaryAction,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const showMascot = mascotState !== undefined && theme.mascotEnabled;
  return (
    <View
      accessible
      accessibilityLabel={description ? `${title}. ${description}` : title}
      style={[{ alignItems: 'center', padding: theme.spacing.xxl, gap: theme.spacing.md }, style]}
      testID={testID}
    >
      {showMascot ? (
        <Mascot state={mascotState} size="welcome" />
      ) : (
        <InlineIcon name={icon} tone="muted" size={theme.iconSizes.xl} />
      )}
      <ThemedText variant="heading" align="center">
        {title}
      </ThemedText>
      {description ? (
        <ThemedText variant="body" tone="secondary" align="center">
          {description}
        </ThemedText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
      {secondaryActionLabel && onSecondaryAction ? (
        <Button variant="ghost" label={secondaryActionLabel} onPress={onSecondaryAction} />
      ) : null}
    </View>
  );
}
