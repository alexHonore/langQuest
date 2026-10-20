/**
 * Editorial coverage badge per (track, source language) — §2.1 honest
 * availability. Text + icon always; colour is secondary. Calm density
 * (default): icon + two words; the description and the native-review note
 * move behind an ⓘ sheet when `verbose`.
 */
import type { CoverageStatus, SourceLanguageCode } from '@langquest/contracts';
import React from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import type { IconName } from '../art';
import type { Density } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { InfoAffordance } from './InfoAffordance';
import { COVERAGE_DESCRIPTIONS, COVERAGE_LABELS, COVERAGE_SHORT_LABELS } from './labels';
import { COVERAGE_TONE, languageName } from './logic';
import { Chip, Row, ThemedText } from './primitives';

export interface CoverageBadgeProps {
  status: CoverageStatus;
  /** Source language the status refers to (shown in the label in `full` density; a11y label always). */
  sourceLanguageCode?: SourceLanguageCode;
  nativeReviewed?: boolean;
  /** Offered fallback for partial coverage (explicit opt-in on the enrollment). */
  fallbackSourceLanguageCode?: SourceLanguageCode | null;
  /** Show the one-line description (inline in `full`, behind ⓘ in `calm`). */
  verbose?: boolean;
  labels?: Partial<Record<CoverageStatus, string>>;
  /** Two-word labels for the calm density. */
  shortLabels?: Partial<Record<CoverageStatus, string>>;
  descriptions?: Partial<Record<CoverageStatus, string>>;
  /** Localized "not yet reviewed by native speakers" line. */
  notReviewedText?: string;
  /** Localized language names; defaults to English catalog names. */
  languageNames?: Partial<Record<SourceLanguageCode, string>>;
  density?: Density;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ICON: Record<CoverageStatus, IconName> = {
  complete: 'check',
  partial: 'info',
  planned: 'map',
  unavailable: 'close',
};

const NOT_REVIEWED = 'Not yet reviewed by native speakers';

export function CoverageBadge(props: CoverageBadgeProps): React.JSX.Element {
  const {
    status,
    sourceLanguageCode,
    nativeReviewed,
    fallbackSourceLanguageCode,
    verbose = false,
    labels,
    shortLabels,
    descriptions,
    notReviewedText = NOT_REVIEWED,
    languageNames,
    density,
    style,
    testID,
  } = props;
  const theme = useTheme();
  const calm = (density ?? theme.density) === 'calm';
  const name = (code: SourceLanguageCode): string => languageNames?.[code] ?? languageName(code);
  const longBase = labels?.[status] ?? COVERAGE_LABELS[status];
  const shortBase = shortLabels?.[status] ?? COVERAGE_SHORT_LABELS[status];
  const longLabel = sourceLanguageCode ? `${name(sourceLanguageCode)} · ${longBase}` : longBase;
  const label = calm ? shortBase : longLabel;
  const tone = COVERAGE_TONE[status];
  const chipTone = tone === 'muted' ? 'neutral' : tone;
  const description = descriptions?.[status] ?? COVERAGE_DESCRIPTIONS[status];
  const fallbackText =
    status === 'partial' && fallbackSourceLanguageCode
      ? `${description} (${name(fallbackSourceLanguageCode)})`
      : description;
  const showNotReviewed = nativeReviewed === false && status !== 'unavailable';
  const infoLines = [
    verbose ? fallbackText : null,
    showNotReviewed ? notReviewedText : null,
  ].filter((l): l is string => Boolean(l));
  const a11y = [longLabel, ...infoLines].join('. ');

  if (calm) {
    return (
      <Row gap={theme.spacing.xs} style={[{ alignSelf: 'flex-start' }, style]} testID={testID}>
        <Chip label={label} tone={chipTone} icon={ICON[status]} accessibilityLabel={a11y} />
        {infoLines.length > 0 ? (
          <InfoAffordance label={longLabel} title={longLabel} text={infoLines} />
        ) : null}
      </Row>
    );
  }

  return (
    <View style={[{ gap: theme.spacing.xs, alignSelf: 'flex-start' }, style]} testID={testID}>
      <Chip label={label} tone={chipTone} icon={ICON[status]} accessibilityLabel={a11y} />
      {showNotReviewed ? (
        <ThemedText variant="caption" tone="muted">
          {notReviewedText}
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
