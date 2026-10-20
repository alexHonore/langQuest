/**
 * Graceful empty / error state (§10.2): mascot or icon, title and one action.
 * Offline and error variants are explicit, never blank panels. Calm density
 * (default): title + one action; the description stays in the accessibility
 * label and behind an ⓘ when present. Full density shows everything inline.
 */
import type { MascotState } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName } from '../art';
import type { Density } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { InfoAffordance } from './InfoAffordance';
import { Mascot } from './Mascot';
import { Button, InlineIcon, Row, ThemedText } from './primitives';

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
  density?: Density;
  /** Accessible name of the ⓘ button that reveals `description` in calm density. */
  infoLabel?: string;
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
    density,
    infoLabel,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const calm = (density ?? theme.density) === 'calm';
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
      <Row gap={theme.spacing.xs} justify="center">
        <ThemedText variant="heading" align="center" accessibilityRole="header">
          {title}
        </ThemedText>
        {calm && description ? (
          <InfoAffordance label={infoLabel ?? title} title={title} text={description} />
        ) : null}
      </Row>
      {!calm && description ? (
        <ThemedText variant="body" tone="secondary" align="center">
          {description}
        </ThemedText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} glow /> : null}
      {!calm && secondaryActionLabel && onSecondaryAction ? (
        <Button variant="ghost" label={secondaryActionLabel} onPress={onSecondaryAction} />
      ) : null}
    </View>
  );
}
