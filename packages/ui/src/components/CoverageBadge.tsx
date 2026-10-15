/**
 * Editorial coverage badge per (track, source language) — §2.1 honest
 * availability. Text + icon always; colour is secondary.
 */
import type { CoverageStatus, SourceLanguageCode } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName } from '../art';
import { useTheme } from '../theme/ThemeProvider';
import { COVERAGE_DESCRIPTIONS, COVERAGE_LABELS } from './labels';
import { COVERAGE_TONE, languageName } from './logic';
import { Chip, ThemedText } from './primitives';

export interface CoverageBadgeProps {
  status: CoverageStatus;
  /** Source language the status refers to (shown in the label when set). */
  sourceLanguageCode?: SourceLanguageCode;
  nativeReviewed?: boolean;
  /** Offered fallback for partial coverage (explicit opt-in on the enrollment). */
  fallbackSourceLanguageCode?: SourceLanguageCode | null;
  /** Show the one-line description under the chip. */
  verbose?: boolean;
  labels?: Partial<Record<CoverageStatus, string>>;
  descriptions?: Partial<Record<CoverageStatus, string>>;
  /** Localized language names; defaults to English catalog names. */
  languageNames?: Partial<Record<SourceLanguageCode, string>>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ICON: Record<CoverageStatus, IconName> = {
  complete: 'check',
  partial: 'info',
  planned: 'map',
  unavailable: 'close',
};

export function CoverageBadge(props: CoverageBadgeProps): React.JSX.Element {
  const {
    status,
    sourceLanguageCode,
    nativeReviewed,
    fallbackSourceLanguageCode,
    verbose = false,
    labels,
    descriptions,
    languageNames,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const name = (code: SourceLanguageCode): string => languageNames?.[code] ?? languageName(code);
  const base = labels?.[status] ?? COVERAGE_LABELS[status];
  const label = sourceLanguageCode ? `${name(sourceLanguageCode)} · ${base}` : base;
  const tone = COVERAGE_TONE[status];
  const chipTone = tone === 'muted' ? 'neutral' : tone;
  const description = descriptions?.[status] ?? COVERAGE_DESCRIPTIONS[status];
  const fallbackText =
    status === 'partial' && fallbackSourceLanguageCode
      ? `${description} (${name(fallbackSourceLanguageCode)})`
      : description;
  return (
    <View style={[{ gap: theme.spacing.xs, alignSelf: 'flex-start' }, style]} testID={testID}>
      <Chip
        label={label}
        tone={chipTone}
        icon={ICON[status]}
        accessibilityLabel={verbose ? `${label}. ${fallbackText}` : label}
      />
      {nativeReviewed === false && status !== 'unavailable' ? (
        <ThemedText variant="caption" tone="muted">
          Not yet reviewed by native speakers
        </ThemedText>
      ) : null}
      {verbose ? (
        <ThemedText variant="caption" tone="secondary">
          {fallbackText}
        </ThemedText>
      ) : null}
    </View>
  );
}
