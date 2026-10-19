import { getCourseTrack } from '@langquest/contracts';
import { Button, CharacterPortrait, EmptyState, Row, StatusLine, Surface, ThemedText, useTheme } from '@langquest/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { LoadingView } from '@/components/StateViews';
import { SyntheticVoiceBadge } from '@/components/SyntheticVoiceBadge';
import { useCast } from '@/features/characters/use-cast';
import { useActiveEnrollment } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { headingLevel } from '@/lib/a11y';
import { useLanguageNames, useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/**
 * Speak hub: free conversation, pronunciation coach, the course cast and the mic mode. The cast comes
 * from the course manifest (`characters[]` published for this track), so every id offered here is one
 * `POST /v1/ai/conversation/session` can start; the in-code portrait is picked by the roster key.
 * Sections follow the enrollment's capability snapshot (CONVENTIONS §8): without live conversation only the
 * pronunciation drills remain; without either the tab is hidden and a stale link lands Home.
 */
export default function Speak(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const { enrollment } = useActiveEnrollment();
  const nav = useEnrollmentNavigation(enrollment);
  const { cast, query: manifest } = useCast(nav.liveConversation ? enrollment : null);
  const speakMode = usePrefs((s) => s.speakMode);
  useEffect(() => track.screenView('speak', theme.direction.rtl, enrollment?.scriptMode ?? null), [theme.direction.rtl, enrollment?.scriptMode]);
  if (!enrollment) {
    return (
      <Screen insideTabs title={t('speak.title')}>
        <EmptyState title={t('home.noCourse')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} mascotState="curious" />
      </Screen>
    );
  }
  if (!nav.speak) return <Redirect href="/(tabs)" />;
  const track_ = getCourseTrack(enrollment.courseTrackId);
  const castLoading = nav.liveConversation && manifest.isLoading && cast.length === 0;
  return (
    <Screen insideTabs title={t('speak.title')}>
      <StatusLine icon="info" tone="secondary" text={t('speak.sourceLanguageNote', { source: names(enrollment.sourceLanguageCode), name: cast[0]?.name ?? track_.displayName, target: track_.displayName })} />
      {nav.liveConversation ? <Button testID="speak-quick" label={t('home.quickSpeak')} icon="mic" size="lg" fullWidth onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id } })} accessibilityLabel={t('home.quickSpeak')} /> : null}
      {nav.pronunciationDrills ? <Button testID="speak-pronunciation" label={t('pronunciation.title')} icon="volume" variant={nav.liveConversation ? 'secondary' : 'primary'} size={nav.liveConversation ? 'md' : 'lg'} fullWidth onPress={() => router.push('/pronunciation')} accessibilityLabel={t('pronunciation.title')} /> : null}
      {nav.conversationVoice ? (
        <Surface variant="muted" radius="lg" padding={theme.spacing.md} style={{ gap: theme.spacing.xs }}>
          <ThemedText variant="label">{t('account.speakMode.label')}</ThemedText>
          <ThemedText tone="secondary">{t(`account.speakMode.${speakMode}`)}</ThemedText>
          <ThemedText variant="caption" tone="muted">
            {t('speak.modeSwitchHint')}
          </ThemedText>
        </Surface>
      ) : null}
      {castLoading ? <LoadingView rows={1} /> : null}
      {/* §8 "visible means usable": a course without a published cast simply has no character section. */}
      {nav.liveConversation && cast.length > 0 ? (
        <>
          <Row gap={theme.spacing.sm} justify="space-between">
            <ThemedText variant="heading" accessibilityRole="header" {...headingLevel(2)}>
              {t('speak.characters.title')}
            </ThemedText>
            <Button label={t('common.showMore')} variant="ghost" size="sm" icon="characters" onPress={() => router.push('/characters')} accessibilityLabel={t('common.showMore')} />
          </Row>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md }}>
            {cast.map((c) => (
              <View key={c.id} testID={`speak-character-${c.portraitKey}`} style={{ width: 150, gap: theme.spacing.xs, alignItems: 'center' }}>
                <CharacterPortrait characterId={c.portraitKey} name={c.name} subtitle={c.region ? `${c.role} · ${c.region}` : c.role} size={96} />
                {c.syntheticVoice ? <SyntheticVoiceBadge name={c.name} /> : null}
                <Button label={t('speak.title')} variant="ghost" size="sm" onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id, characterId: c.id } })} accessibilityLabel={t('speak.characters.talkWith', { name: c.name })} />
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
    </Screen>
  );
}
