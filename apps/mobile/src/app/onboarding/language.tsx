import { SOURCE_LANGUAGES, type SourceLanguageCode } from '@langquest/contracts';
import { Chip, InfoAffordance, Row, ThemedText, orderedSourceLanguages, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { OnboardingFrame } from '@/components/OnboardingFrame';
import { completeUiLocales } from '@/features/session/capabilities';
import { deviceUiLocale, useI18n, useLanguageNames } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

const PROMINENT: readonly SourceLanguageCode[] = ['en', 'fr'];
/** Chrome languages: complete catalogs only (partial es/ru stay instruction languages; docs/UPCOMING_FEATURES.md). */
const UI_LOCALES = completeUiLocales();

/** UI language (menus) and default instruction language (explanations) — three independent variables (§10.1). */
export default function LanguageStep(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useI18n();
  const names = useLanguageNames();
  const set = usePrefs((s) => s.set);
  const uiOverride = usePrefs((s) => s.uiLocale);
  const pendingSource = usePrefs((s) => s.pendingDefaultSourceLanguage);
  const [source, setSource] = useState<SourceLanguageCode | null>(pendingSource ?? (SOURCE_LANGUAGES.some((s) => s.code === locale) ? (locale as SourceLanguageCode) : 'en'));
  useEffect(() => track.onboardingStep('ui_language'), []);

  const ordered = orderedSourceLanguages();
  const tier1 = ordered.filter((s) => PROMINENT.includes(s.code));
  const rest = ordered.filter((s) => !PROMINENT.includes(s.code));

  return (
    <OnboardingFrame
      step={1}
      title={t('onboarding.chooseUiLanguage')}
      headerEnd={<InfoAffordance label={t('common.moreInformation')} title={t('onboarding.chooseUiLanguage')} text={[t('onboarding.chooseUiLanguageHint'), t('onboarding.chooseSourceLanguageHint'), t('catalog.filterBySource')]} />}
      primaryDisabled={!source}
      primaryTestID="onboarding-language-continue"
      onPrimary={() => {
        if (!source) return;
        set({ pendingDefaultSourceLanguage: source });
        track.onboardingStep('source_language');
        router.push('/onboarding/target');
      }}
    >
      <Row gap={theme.spacing.sm} wrap accessibilityRole="radiogroup">
        {UI_LOCALES.map((code) => (
          <View key={code} testID={`onboarding-ui-${code}`}>
            <Chip label={names(code)} selected={(uiOverride ?? deviceUiLocale()) === code} tone="accent" onPress={() => set({ uiLocale: code })} accessibilityLabel={names(code)} />
          </View>
        ))}
      </Row>
      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
        <ThemedText variant="heading" accessibilityRole="header">
          {t('onboarding.chooseSourceLanguage')}
        </ThemedText>
        <ThemedText tone="secondary">{t('onboarding.chooseSourceLanguageHint')}</ThemedText>
        <Row gap={theme.spacing.sm} wrap accessibilityRole="radiogroup">
          {tier1.map((s) => (
            <View key={s.code} testID={`onboarding-source-${s.code}`}>
              <Chip label={`${names(s.code)} · ${s.nativeName}`} selected={source === s.code} tone="accent" onPress={() => setSource(s.code)} accessibilityLabel={names(s.code)} />
            </View>
          ))}
        </Row>
        <Row gap={theme.spacing.sm} wrap accessibilityRole="radiogroup">
          {rest.map((s) => (
            <View key={s.code} testID={`onboarding-source-${s.code}`}>
              <Chip label={names(s.code)} selected={source === s.code} onPress={() => setSource(s.code)} accessibilityLabel={names(s.code)} />
            </View>
          ))}
        </Row>
      </View>
    </OnboardingFrame>
  );
}
