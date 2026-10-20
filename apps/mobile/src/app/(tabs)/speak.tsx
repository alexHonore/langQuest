import { getCourseTrack } from '@langquest/contracts';
import { Button, CharacterPortrait, Chip, EmptyState, InfoAffordance, Row, ThemedText, useTheme } from '@langquest/ui';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { Melo } from '@/components/Melo';
import { Screen } from '@/components/Screen';
import { LoadingView } from '@/components/StateViews';
import { SyntheticVoiceBadge } from '@/components/SyntheticVoiceBadge';
import { useCast } from '@/features/characters/use-cast';
import { useActiveEnrollment } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { headingLevel } from '@/lib/a11y';
import { haptic } from '@/lib/haptics';
import { useLanguageNames, useT } from '@/lib/i18n';
import { track } from '@/lib/telemetry';
import { usePrefs } from '@/state/prefs';

/**
 * Speak hub (calm density): ONE primary action (free conversation, glowing), the pronunciation coach as a
 * secondary action, the cast strip and the current mic mode as a chip. The instruction-language note and
 * how to change the mic mode live behind ⓘ. The cast comes from the course manifest (`characters[]`
 * published for this track), so every id offered here is one `POST /v1/ai/conversation/session` can start.
 * Sections follow the enrollment's capability snapshot (CONVENTIONS §8).
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
  const about = [t('speak.sourceLanguageNote', { source: names(enrollment.sourceLanguageCode), name: cast[0]?.name ?? track_.displayName, target: track_.displayName }), ...(nav.conversationVoice ? [`${t('account.speakMode.label')}: ${t(`account.speakMode.${speakMode}`)}`, t('speak.modeSwitchHint')] : [])];
  const start = (characterId?: string): void => {
    void haptic('select');
    router.push({ pathname: '/conversation', params: characterId ? { enrollmentId: enrollment.id, characterId } : { enrollmentId: enrollment.id } });
  };
  return (
    <Screen insideTabs title={t('speak.title')} headerEnd={<InfoAffordance label={t('speak.aboutConversation')} title={t('speak.title')} text={about} />}>
      <Row gap={theme.spacing.md} align="center">
        <Melo state="welcome" size="companion" testID="speak-mascot" />
        <View style={{ flex: 1, gap: theme.spacing.sm }}>
          {nav.liveConversation ? <Button testID="speak-quick" label={t('home.quickSpeak')} icon="mic" size="lg" fullWidth glow onPress={() => start()} accessibilityLabel={t('home.quickSpeak')} /> : null}
          {nav.pronunciationDrills ? <Button testID="speak-pronunciation" label={t('pronunciation.title')} icon="volume" variant={nav.liveConversation ? 'secondary' : 'primary'} glow={!nav.liveConversation} size={nav.liveConversation ? 'md' : 'lg'} fullWidth onPress={() => router.push('/pronunciation')} accessibilityLabel={t('pronunciation.title')} /> : null}
        </View>
      </Row>
      {nav.conversationVoice ? (
        <Row gap={theme.spacing.xs}>
          <Chip label={t(`account.speakMode.${speakMode}`)} icon="mic" onPress={() => router.push('/account/accessibility')} accessibilityLabel={`${t('account.speakMode.label')}: ${t(`account.speakMode.${speakMode}`)}`} />
        </Row>
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
              <View key={c.id} testID={`speak-character-${c.portraitKey}`} style={{ width: 132, gap: theme.spacing.xs, alignItems: 'center' }}>
                <CharacterPortrait characterId={c.portraitKey} name={c.name} subtitle={c.region ? `${c.role} · ${c.region}` : c.role} size={96} />
                {c.syntheticVoice ? <SyntheticVoiceBadge name={c.name} /> : null}
                <Button label={t('speak.title')} variant="ghost" size="sm" icon="mic" onPress={() => start(c.id)} accessibilityLabel={t('speak.characters.talkWith', { name: c.name })} />
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
    </Screen>
  );
}
