/** Shared frame for onboarding steps: safe areas, step progress, back + primary action. */
import { Button, Lanterns, ProgressBar, Row, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/lib/i18n';

export interface OnboardingFrameProps {
  step: number;
  totalSteps?: number;
  title: string;
  hint?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  showBack?: boolean;
  /** Stable ids for the primary / secondary actions (Maestro flows under `tests/e2e/maestro`). */
  primaryTestID?: string;
  secondaryTestID?: string;
  /** Right-side slot next to the step counter (an ⓘ affordance, typically). */
  headerEnd?: React.ReactNode;
  children: React.ReactNode;
}

export function OnboardingFrame(props: OnboardingFrameProps): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const total = props.totalSteps ?? 5;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {theme.lanterns.enabled ? <Lanterns /> : null}
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, gap: theme.spacing.sm }}>
        <Row gap={theme.spacing.sm} justify="space-between">
          {props.showBack !== false && router.canGoBack() ? <Button label={t('common.back')} variant="ghost" size="sm" icon="chevronLeft" onPress={() => router.back()} accessibilityLabel={t('common.a11y.goBack')} /> : <View />}
          <Row gap={theme.spacing.xs} align="center">
            <ThemedText variant="caption" tone="muted">{`${props.step}/${total}`}</ThemedText>
            {props.headerEnd}
          </Row>
        </Row>
        <ProgressBar value={props.step / total} accessibilityLabel={`${props.step}/${total}`} height={4} />
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <ThemedText variant="title" accessibilityRole="header">
          {props.title}
        </ThemedText>
        {props.hint ? <ThemedText tone="secondary">{props.hint}</ThemedText> : null}
        {props.children}
      </ScrollView>
      {props.onPrimary || props.onSecondary ? (
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm, borderTopWidth: theme.highContrast ? 1 : 0, borderTopColor: theme.colors.border }}>
          {props.onPrimary ? <Button testID={props.primaryTestID} label={props.primaryLabel ?? t('common.continue')} onPress={props.onPrimary} disabled={props.primaryDisabled} fullWidth size="lg" glow accessibilityLabel={props.primaryLabel ?? t('common.continue')} /> : null}
          {props.onSecondary ? <Button testID={props.secondaryTestID} label={props.secondaryLabel ?? t('common.skip')} variant="ghost" onPress={props.onSecondary} fullWidth accessibilityLabel={props.secondaryLabel ?? t('common.skip')} /> : null}
        </View>
      ) : null}
    </View>
  );
}
