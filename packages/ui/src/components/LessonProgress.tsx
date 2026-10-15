/**
 * Lesson progress: "step x of y" + current phase label, with a determinate
 * bar. No timers or countdowns (§10.3: no hidden timer pressure).
 */
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { type LessonPhase, stepProgress } from './logic';
import { ProgressBar, Row, ThemedText } from './primitives';

export interface LessonProgressProps {
  /** 1-based current step. */
  step: number;
  totalSteps: number;
  phase?: LessonPhase;
  /** Localized phase label (e.g. "Listen", "Your turn"). */
  phaseLabel?: string;
  /** Mission title shown at the start of the row. */
  title?: string;
  /** Localized "{step} of {total}" formatter. */
  formatStep?: (step: number, total: number) => string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const DEFAULT_PHASE_LABELS: Record<LessonPhase, string> = {
  listen: 'Listen',
  anticipate: 'How would you answer?',
  speak: 'Your turn',
  compare: 'Compare',
  review: 'Review',
  summary: 'Summary',
};

export function LessonProgress(props: LessonProgressProps): React.JSX.Element {
  const { step, totalSteps, phase, phaseLabel, title, formatStep, style, testID } = props;
  const theme = useTheme();
  const safeTotal = Math.max(1, Math.floor(totalSteps));
  const safeStep = Math.min(safeTotal, Math.max(1, Math.floor(step)));
  const stepText = formatStep ? formatStep(safeStep, safeTotal) : `${safeStep}/${safeTotal}`;
  const phaseText = phaseLabel ?? (phase ? DEFAULT_PHASE_LABELS[phase] : undefined);
  const a11y = [title, stepText, phaseText].filter(Boolean).join(', ');
  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={[{ gap: theme.spacing.xs }, style]}
      testID={testID}
    >
      <Row gap={theme.spacing.sm} justify="space-between">
        {title ? (
          <ThemedText variant="label" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </ThemedText>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <ThemedText variant="label" tone="secondary">
          {stepText}
        </ThemedText>
      </Row>
      <ProgressBar
        value={stepProgress(safeStep - 1, safeTotal)}
        accessibilityLabel={stepText}
        height={6}
      />
      {phaseText ? (
        <ThemedText variant="caption" tone="muted">
          {phaseText}
        </ThemedText>
      ) : null}
    </View>
  );
}
