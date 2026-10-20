/**
 * Plain disclaimer for one course × instruction language (CONVENTIONS §8): what the pair does NOT have yet,
 * shown in the enrollment wizard before the confirm button and in Account → "What this course includes".
 * Calm density (owner decision 2026-10-19): one heading + short bullets; the long explanations, the intro
 * and the editorial status live behind the ⓘ sheet of the shared `CapabilityDisclaimer`. Nothing is
 * rendered while the snapshot is unknown.
 */
import { CAPABILITY_MISSING_KEYS } from '@langquest/contracts';
import { CapabilityDisclaimer as CalmDisclaimer, InfoAffordance, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
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
  const status = [disclaimer.instructionLanguageStatus, disclaimer.nativeReviewCaption].filter(Boolean).join(' · ');
  const short = Object.fromEntries(CAPABILITY_MISSING_KEYS.map((k) => [k, t(`enrollment.disclaimer.short.${k}`)])) as Record<(typeof CAPABILITY_MISSING_KEYS)[number], string>;
  return (
    <View testID={props.testID} style={{ gap: theme.spacing.md }}>
      {includes && includes.length > 0 ? (
        <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.lg} style={{ gap: theme.spacing.sm }}>
          <Row justify="space-between" gap={theme.spacing.sm}>
            <ThemedText variant="subheading" accessibilityRole="header" style={{ flex: 1 }}>
              {t('enrollment.disclaimer.includes.title')}
            </ThemedText>
            <InfoAffordance label={t('common.details')} title={t('enrollment.disclaimer.includes.title')} text={[t('enrollment.disclaimer.includes.intro', { source: props.sourceName }), status]} />
          </Row>
          <View accessibilityRole="list" style={{ gap: theme.spacing.xs }}>
            {includes.map((line) => (
              <StatusLine key={line.key} icon="check" tone="success" text={line.text} />
            ))}
          </View>
        </Surface>
      ) : null}
      <CalmDisclaimer
        items={disclaimer.lines.map((l) => ({ key: l.key, severity: l.severity, text: l.text }))}
        title={t('enrollment.disclaimer.shortTitle')}
        statusText={[disclaimer.intro, status].join('\n')}
        labels={{ title: t('enrollment.disclaimer.shortTitle'), allAvailable: t('enrollment.disclaimer.shortAllAvailable'), details: t('common.details'), short }}
        testID={props.testID ? `${props.testID}-list` : undefined}
      />
    </View>
  );
}
