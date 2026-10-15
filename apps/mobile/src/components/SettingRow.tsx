/** Settings primitives: a labelled switch row and a chip radio row. */
import { Chip, Row, ThemedText, useTheme } from '@langquest/ui';
import React from 'react';
import { Switch, View } from 'react-native';

export function SwitchRow(props: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row gap={theme.spacing.md} justify="space-between" align="center" accessible accessibilityRole="switch" accessibilityState={{ checked: props.value, disabled: props.disabled }} accessibilityLabel={props.label}>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText>{props.label}</ThemedText>
        {props.hint ? <ThemedText variant="caption" tone="muted">{props.hint}</ThemedText> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onChange} disabled={props.disabled} trackColor={{ true: theme.colors.accent, false: theme.colors.border }} thumbColor={theme.colors.surface} />
    </Row>
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
