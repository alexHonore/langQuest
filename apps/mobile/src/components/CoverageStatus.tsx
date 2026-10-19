/**
 * Localised editorial-coverage badge (§2.1). Wraps the ui `CoverageBadge` with the catalog labels,
 * descriptions and language names, and renders the native-review caption from the catalogs itself:
 * the ui component's own caption is English-only, so it is never asked to show it.
 */
import type { CoverageStatus as CoverageStatusValue, SourceLanguageCode } from '@langquest/contracts';
import { CoverageBadge, ThemedText, useTheme } from '@langquest/ui';
import React from 'react';
import { View } from 'react-native';
import { coverageDescriptions } from '@/features/session/coverage-copy';
import { useExtraLabels } from '@/lib/extra-labels';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useUiLabels } from '@/lib/labels';

export interface CoverageStatusProps {
  status: CoverageStatusValue;
  sourceLanguageCode: SourceLanguageCode;
  nativeReviewed?: boolean;
  fallbackSourceLanguageCode?: SourceLanguageCode | null;
  /** Show the one-line description under the chip. */
  verbose?: boolean;
  testID?: string;
}

export function CoverageStatus(props: CoverageStatusProps): React.JSX.Element {
  const { status, sourceLanguageCode, nativeReviewed, fallbackSourceLanguageCode = null, verbose = false, testID } = props;
  const theme = useTheme();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const labels = useUiLabels();
  const languageNames: Partial<Record<SourceLanguageCode, string>> = { [sourceLanguageCode]: names(sourceLanguageCode) };
  if (fallbackSourceLanguageCode) languageNames[fallbackSourceLanguageCode] = names(fallbackSourceLanguageCode);
  return (
    <View style={{ gap: theme.spacing.xs, alignSelf: 'flex-start' }}>
      <CoverageBadge
        testID={testID}
        status={status}
        sourceLanguageCode={sourceLanguageCode}
        fallbackSourceLanguageCode={fallbackSourceLanguageCode}
        verbose={verbose}
        labels={labels.coverage}
        descriptions={coverageDescriptions(t, X, names(sourceLanguageCode), fallbackSourceLanguageCode ? names(fallbackSourceLanguageCode) : null)}
        languageNames={languageNames}
      />
      {nativeReviewed === false && status !== 'unavailable' ? (
        <ThemedText variant="caption" tone="muted">
          {t('catalog.notNativeReviewed')}
        </ThemedText>
      ) : null}
    </View>
  );
}
