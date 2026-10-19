import { getCourseTrack } from '@langquest/contracts';
import { Button, CharacterPortrait, EmptyState, Row, StatusLine, Surface, ThemedText, charactersForVariety, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useActiveEnrollment } from '@/features/session/queries';
import { useExtraLabels } from '@/lib/extra-labels';
import { useLanguageNames, useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/** Speak hub: free conversation, pronunciation coach, character gallery, mic mode. */
export default function Speak(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const X = useExtraLabels();
  const names = useLanguageNames();
  const { enrollment } = useActiveEnrollment();
  const speakMode = usePrefs((s) => s.speakMode);
  useEffect(() => track.screenView('speak', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);
  if (!enrollment) {
    return (
      <Screen insideTabs title={t('speak.title')}>
        <EmptyState title={t('home.noCourse')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} mascotState="curious" />
      </Screen>
    );
  }
  const track_ = getCourseTrack(enrollment.courseTrackId);
  const cast = charactersForVariety(track_.targetVarietyId);
  return (
    <Screen insideTabs title={t('speak.title')}>
      <StatusLine icon="info" tone="secondary" text={t('speak.sourceLanguageNote', { source: names(enrollment.sourceLanguageCode), name: cast[0]?.name ?? track_.displayName, target: track_.displayName })} />
      <Button label={t('home.quickSpeak')} icon="mic" size="lg" fullWidth onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id } })} accessibilityLabel={t('home.quickSpeak')} />
      <Button label={t('pronunciation.title')} icon="volume" variant="secondary" fullWidth onPress={() => router.push('/pronunciation')} accessibilityLabel={t('pronunciation.title')} />
      <Surface variant="muted" radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
        <ThemedText variant="label">{t('account.speakMode.label')}</ThemedText>
        <ThemedText tone="secondary">{t(`account.speakMode.${speakMode}`)}</ThemedText>
        <ThemedText variant="caption" tone="muted">
          {t('speak.modeSwitchHint')}
        </ThemedText>
      </Surface>
      <Row gap={theme.spacing.sm} justify="space-between">
        <ThemedText variant="heading" accessibilityRole="header">
          {X.charactersHeading}
        </ThemedText>
        <Button label={t('common.showMore')} variant="ghost" size="sm" icon="characters" onPress={() => router.push('/characters')} accessibilityLabel={t('common.showMore')} />
      </Row>
      {cast.length === 0 ? (
        <ThemedText tone="muted">{t('common.notAvailable')}</ThemedText>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md }}>
          {cast.map((c) => (
            <View key={c.id} style={{ width: 140 }}>
              <CharacterPortrait characterId={c.id} name={c.name} subtitle={`${c.role} · ${c.city}`} size={96} />
              <Button label={t('speak.title')} variant="ghost" size="sm" onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id, characterId: c.characterId } })} accessibilityLabel={`${t('speak.title')} ${c.name}`} />
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
