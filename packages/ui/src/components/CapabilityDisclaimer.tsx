/**
 * Capability disclaimer (CONVENTIONS §8: what this course × instruction
 * language does NOT have yet, disclosed before enrollment). Calm density: one
 * heading, bullets of ≤ 6 words (short labels keyed by the contract enum), the
 * long explanation behind an ⓘ sheet. Full density: the long lines inline with
 * the severity chip, as before. Nothing is rendered when there is no snapshot.
 */
import type { CapabilityMissingKey, CapabilityMissingSeverity } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { type Density } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { InfoAffordance } from './InfoAffordance';
import { CAPABILITY_LABELS, mergeLabels, type LocalizedLabels } from './labels';
import { Chip, Row, StatusLine, Surface, ThemedText } from './primitives';

export interface CapabilityDisclaimerItem {
  key: CapabilityMissingKey;
  severity: CapabilityMissingSeverity;
  /** Localized long explanation (`t(CAPABILITY_MISSING_I18N_KEYS[key])`). */
  text?: string;
}

export interface CapabilityDisclaimerProps {
  /** Missing capabilities; empty = everything available. `null`/`undefined` = unknown → renders nothing. */
  items: readonly CapabilityDisclaimerItem[] | null | undefined;
  /** Localized heading (defaults to the label set). */
  title?: string;
  /** Editorial status line (instruction-language status · native review). */
  statusText?: string | null;
  /** Localized severity chip labels (full density). */
  severityLabels?: Partial<Record<CapabilityMissingSeverity, string>>;
  density?: Density;
  /** Localized overrides (`t(...)` strings; nested groups may be partial). */
  labels?: LocalizedLabels<typeof CAPABILITY_LABELS>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CapabilityDisclaimer(props: CapabilityDisclaimerProps): React.JSX.Element | null {
  const { items, title, statusText, severityLabels, density, labels, style, testID } = props;
  const theme = useTheme();
  const L = mergeLabels(CAPABILITY_LABELS, labels);
  const calm = (density ?? theme.density) === 'calm';
  if (!items) return null;
  const heading = title ?? L.title;

  if (items.length === 0) {
    return (
      <View style={style} testID={testID}>
        <StatusLine icon="check" tone="success" text={L.allAvailable} />
      </View>
    );
  }

  const longLines = items.map((it) => it.text ?? L.short[it.key]);

  if (calm) {
    return (
      <Surface
        variant="glass"
        level={1}
        radius="lg"
        padding={theme.spacing.lg}
        style={[{ gap: theme.spacing.sm }, style]}
        testID={testID}
      >
        <Row justify="space-between" gap={theme.spacing.sm}>
          <ThemedText variant="subheading" accessibilityRole="header" style={{ flex: 1 }}>
            {heading}
          </ThemedText>
          <InfoAffordance label={L.details} title={heading} text={longLines}>
            {statusText ? (
              <ThemedText variant="caption" tone="muted">
                {statusText}
              </ThemedText>
            ) : null}
          </InfoAffordance>
        </Row>
        <View accessibilityRole="list" style={{ gap: theme.spacing.xs }}>
          {items.map((it) => (
            <StatusLine
              key={it.key}
              icon={it.severity === 'blocking' ? 'warning' : 'info'}
              tone={it.severity === 'blocking' ? 'warning' : 'secondary'}
              text={L.short[it.key]}
            />
          ))}
        </View>
      </Surface>
    );
  }

  return (
    <Surface
      variant="muted"
      radius="lg"
      padding={theme.spacing.lg}
      style={[{ gap: theme.spacing.xs }, style]}
      testID={testID}
    >
      <ThemedText variant="heading" accessibilityRole="header">
        {heading}
      </ThemedText>
      {items.map((it, i) => (
        <Row key={it.key} gap={theme.spacing.xs} align="flex-start">
          <View style={{ flex: 1 }} testID={testID ? `${testID}-${it.key}` : undefined}>
            <StatusLine
              icon={it.severity === 'blocking' ? 'warning' : 'info'}
              tone={it.severity === 'blocking' ? 'warning' : 'secondary'}
              text={longLines[i] ?? L.short[it.key]}
            />
          </View>
          {severityLabels?.[it.severity] ? (
            <Chip
              label={severityLabels[it.severity] ?? ''}
              tone={it.severity === 'blocking' ? 'warning' : 'neutral'}
            />
          ) : null}
        </Row>
      ))}
      {statusText ? (
        <ThemedText variant="caption" tone="secondary">
          {statusText}
        </ThemedText>
      ) : null}
    </Surface>
  );
}
