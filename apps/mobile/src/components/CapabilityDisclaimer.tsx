/**
 * Plain disclaimer for one course × instruction language (CONVENTIONS §8): what the pair does NOT have yet,
 * one line per item, with the editorial status line — shown in the enrollment wizard before the confirm
 * button and in Account → "What this course includes". Nothing is rendered while the snapshot is unknown.
 */
import { Chip, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import React from 'react';
import { View } from 'react-native';
import { buildDisclaimer, buildIncludes, type CapabilitySnapshot } from '@/features/session/capabilities';
import { DOWNLOADS_SUPPORTED_ON_PLATFORM } from '@/features/session/use-capabilities';
import { useT } from '@/lib/i18n';

export interface CapabilityDisclaimerProps {
  capabilities: CapabilitySnapshot;
  /** Instruction language display name. */
  sourceName: string;
  /** Course display name. */
  targetName: string;
  /** Also list what IS included (account screen); the wizard shows only the missing list. */
  showIncludes?: boolean;
  testID?: string;
}

export function CapabilityDisclaimer(props: CapabilityDisclaimerProps): React.JSX.Element | null {
  const theme = useTheme();
  const t = useT();
  const disclaimer = buildDisclaimer(props.capabilities, t, { source: props.sourceName, target: props.targetName });
  if (!disclaimer) return null;
  const includes = props.showIncludes ? buildIncludes(props.capabilities, t, { downloadsSupported: DOWNLOADS_SUPPORTED_ON_PLATFORM }) : null;
  return (
    <View testID={props.testID} style={{ gap: theme.spacing.md }}>
      {includes && includes.length > 0 ? (
        <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="heading" accessibilityRole="header">
            {t('enrollment.disclaimer.includes.title')}
          </ThemedText>
          <ThemedText variant="caption" tone="muted">
            {t('enrollment.disclaimer.includes.intro', { source: props.sourceName })}
          </ThemedText>
          {includes.map((line) => (
            <StatusLine key={line.key} icon="check" tone="success" text={line.text} />
          ))}
        </Surface>
      ) : null}
      <Surface variant="muted" radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.xs }}>
        {disclaimer.lines.length > 0 ? (
          <>
            <ThemedText variant="heading" accessibilityRole="header">
              {disclaimer.title}
            </ThemedText>
            <ThemedText variant="caption" tone="muted">
              {disclaimer.intro}
            </ThemedText>
            {disclaimer.lines.map((line) => (
              <Row key={line.key} gap={theme.spacing.xs} align="flex-start">
                <View testID={`disclaimer-${line.key}`} style={{ flex: 1 }}>
                  <StatusLine icon={line.severity === 'blocking' ? 'warning' : 'info'} tone={line.severity === 'blocking' ? 'warning' : 'secondary'} text={line.text} />
                </View>
                <Chip label={t(`enrollment.disclaimer.severity.${line.severity}`)} tone={line.severity === 'blocking' ? 'warning' : 'neutral'} />
              </Row>
            ))}
          </>
        ) : (
          <StatusLine icon="check" tone="success" text={disclaimer.allAvailable ?? ''} />
        )}
        <ThemedText variant="caption" tone="secondary">
          {disclaimer.instructionLanguageStatus}
          {disclaimer.nativeReviewCaption ? ` · ${disclaimer.nativeReviewCaption}` : ''}
        </ThemedText>
      </Surface>
    </View>
  );
}
