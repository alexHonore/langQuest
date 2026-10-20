/** Settings primitives: a labelled switch row and a chip radio row. */
import { Chip, Row, ThemedText, useTheme } from '@langquest/ui';
import React from 'react';
import { Pressable, Switch, View } from 'react-native';

export interface SwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/**
 * The row IS the control (device QA 2026-10-20): it used to be an `accessible` group with role "switch" but no
 * action, so VoiceOver read the setting and could not toggle it, and tapping the label did nothing. Now a tap
 * anywhere on the row, or a VoiceOver double-tap, toggles it; the inner Switch is visual only for assistive tech.
 */
export function switchRowAccessibility(props: Pick<SwitchRowProps, 'label' | 'hint' | 'value' | 'disabled'>): { accessibilityRole: 'switch'; accessibilityLabel: string; accessibilityHint?: string; accessibilityState: { checked: boolean; disabled: boolean } } {
  return { accessibilityRole: 'switch', accessibilityLabel: props.label, ...(props.hint ? { accessibilityHint: props.hint } : {}), accessibilityState: { checked: props.value, disabled: Boolean(props.disabled) } };
}

/** What activating the row does: the toggled value, or nothing while disabled. */
export function switchRowActivation(props: Pick<SwitchRowProps, 'value' | 'disabled'>): boolean | null {
  return props.disabled ? null : !props.value;
}

export function SwitchRow(props: SwitchRowProps): React.JSX.Element {
  const theme = useTheme();
  const activate = (): void => {
    const next = switchRowActivation(props);
    if (next !== null) props.onChange(next);
  };
  return (
    <Pressable onPress={activate} disabled={props.disabled} {...switchRowAccessibility(props)} style={{ minHeight: theme.touchTargets.min, flexDirection: theme.direction.row, alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText>{props.label}</ThemedText>
        {props.hint ? <ThemedText variant="caption" tone="muted">{props.hint}</ThemedText> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onChange} disabled={props.disabled} trackColor={{ true: theme.colors.accent, false: theme.colors.border }} thumbColor={theme.colors.surface} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </Pressable>
  );
}

export function ChoiceRow<T extends string>(props: { label: string; hint?: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <ThemedText variant="label">{props.label}</ThemedText>
      {props.hint ? <ThemedText variant="caption" tone="muted">{props.hint}</ThemedText> : null}
      <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
        {props.options.map((o) => (
          <Chip key={o.value} label={o.label} selected={props.value === o.value} onPress={() => props.onChange(o.value)} accessibilityLabel={o.label} />
        ))}
      </Row>
    </View>
  );
}
