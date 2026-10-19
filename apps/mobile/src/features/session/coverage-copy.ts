/**
 * Editorial-coverage descriptions for `CoverageBadge` (§2.1 honest availability), localised through the
 * catalogs. The fallback language is only ever NAMED when the editorial row actually configures one
 * (`fallbackSourceLanguageCode`); otherwise the "planned" line is the disclaimer wording alone (CONVENTIONS
 * §8: no "no fallback configured" copy). The `X` parameter is kept for call-site compatibility.
 */
import type { CoverageStatus } from '@langquest/contracts';
import type { ExtraLabels } from '@/lib/extra-labels';
import type { I18n } from '@/lib/i18n';

export function coverageDescriptions(t: I18n['t'], _X: Pick<ExtraLabels, 'plannedNoFallback'>, sourceName: string, fallbackName: string | null): Record<CoverageStatus, string> {
  return {
    complete: t('enrollment.coverage.detail.complete'),
    partial: t('enrollment.coverage.detail.partial', { source: sourceName }),
    planned: fallbackName ? t('enrollment.coverage.detail.planned', { source: sourceName, fallback: fallbackName }) : t('enrollment.disclaimer.instructionLanguagePlanned', { source: sourceName }),
    unavailable: t('enrollment.coverage.detail.unavailable', { source: sourceName }),
  };
}
