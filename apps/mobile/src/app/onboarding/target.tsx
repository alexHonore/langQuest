import { COURSE_TRACKS, type CourseTrackId } from '@langquest/contracts';
import { Chip, CourseCover, NATIVE_SAMPLES, ORDERED_TRACKS, Row, Surface, ThemedText, dialectClarification, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { OnboardingFrame } from '@/components/OnboardingFrame';
import { useLanguageNames, useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/** 30-track grid with native-script sample and dialect clarification (screen 1). */
export default function TargetStep(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const set = usePrefs((s) => s.set);
  const source = usePrefs((s) => s.pendingDefaultSourceLanguage);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CourseTrackId | null>(usePrefs.getState().pendingTrackId as CourseTrackId | null);

  const tracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORDERED_TRACKS.filter((tr) => tr.languageCode !== source && (!q || tr.displayName.toLowerCase().includes(q) || names(tr.languageCode).toLowerCase().includes(q)));
  }, [query, source, names]);

  return (
    <OnboardingFrame
      step={2}
      title={t('onboarding.chooseTarget')}
      hint={t('onboarding.chooseTargetHint')}
      primaryDisabled={!selected}
      primaryTestID="onboarding-target-continue"
      onPrimary={() => {
        if (!selected) return;
        set({ pendingTrackId: selected });
        track.onboardingStep('track_selected');
        router.push('/onboarding/confirm');
      }}
    >
      <TextInput
        testID="onboarding-target-search"
        value={query}
        onChangeText={setQuery}
        placeholder={t('catalog.searchPlaceholder')}
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel={t('common.search')}
        style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, padding: theme.spacing.md, color: theme.colors.textPrimary, minHeight: theme.touchTargets.min }}
      />
      <View style={{ gap: theme.spacing.md }} accessibilityRole="radiogroup">
        {tracks.map((tr) => {
          const sample = NATIVE_SAMPLES[tr.id];
          const clar = dialectClarification(tr);
          const isSelected = selected === tr.id;
          return (
            <Pressable key={tr.id} testID={`onboarding-target-${tr.id}`} onPress={() => setSelected(tr.id)} accessibilityRole="radio" accessibilityState={{ selected: isSelected }} accessibilityLabel={`${tr.displayName}. ${clar.needsClarification ? clar.focus : ''}`}>
              <Surface variant={isSelected ? 'accentSoft' : 'surface'} bordered radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.sm, borderColor: isSelected ? theme.colors.accent : theme.colors.border, borderWidth: isSelected ? 2 : 1 }}>
                <Row gap={theme.spacing.md} align="flex-start">
                  <View style={{ width: 72 }}>
                    <CourseCover trackId={tr.id} width={72} hideTitle />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText variant="subheading">{tr.displayName}</ThemedText>
                    <ThemedText variant="scriptSample" script={tr.scripts.primary} direction={tr.scripts.primary === 'Arab' || tr.scripts.primary === 'Hebr' ? 'rtl' : 'ltr'}>
                      {sample.native}
                    </ThemedText>
                    {sample.latin ? (
                      <ThemedText variant="transliteration" tone="muted">
                        {sample.latin}
                      </ThemedText>
                    ) : null}
                    {clar.needsClarification ? (
                      <ThemedText variant="caption" tone="secondary">
                        {clar.varietyName} · {clar.focus}
                      </ThemedText>
                    ) : null}
                    {clar.distinctFrom.length > 0 ? <Chip label={`≠ ${clar.distinctFrom.join(', ')}`} tone="warning" /> : null}
                  </View>
                </Row>
              </Surface>
            </Pressable>
          );
        })}
      </View>
      <ThemedText variant="caption" tone="muted">
        {t('catalog.subtitle')} ({COURSE_TRACKS.length})
      </ThemedText>
    </OnboardingFrame>
  );
}
