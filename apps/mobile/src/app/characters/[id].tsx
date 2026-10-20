import { getCourseTrack } from '@langquest/contracts';
import { CHARACTER_EXPRESSIONS, CharacterPortrait, Button, Chip, InfoAffordance, Row, Surface, ThemedText, findCharacter, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { SyntheticVoiceBadge } from '@/components/SyntheticVoiceBadge';
import { findCastCharacter } from '@/features/characters/cast';
import { useCast } from '@/features/characters/use-cast';
import { useActiveEnrollment, useProgress } from '@/features/session/queries';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';

/**
 * Character detail (calm density): the C2 clay portrait (full detail at 160 px), name, role · place,
 * one line of life context, the unlocked story milestones (earned by speaking, never bought), the
 * expression strip and ONE primary action (talk). Personality, voice notes, variety and the synthetic
 * voice disclosure live behind ⓘ. `id` is the manifest character uuid (older links with the roster
 * slug still resolve).
 */
export default function CharacterDetail(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enrollment } = useActiveEnrollment();
  const { cast, query } = useCast(enrollment);
  const progress = useProgress(Boolean(enrollment));
  const character = findCastCharacter(cast, typeof id === 'string' ? id : null);
  const trackDef = enrollment ? getCourseTrack(enrollment.courseTrackId) : null;
  if (!character) {
    return (
      <Screen title={t('speak.characters.title')} onBack={() => router.back()}>
        {enrollment && query.isLoading && !query.data ? <LoadingView rows={2} /> : <ErrorView error={new Error(t('errors.notFound'))} />}
      </Screen>
    );
  }
  const roster = findCharacter(character.portraitKey);
  const where = character.region ?? (roster ? `${roster.city}, ${roster.region}` : null);
  const regionalLabel = character.regionalOption ? (trackDef?.regionalOptions.find((o) => o.id === character.regionalOption)?.label ?? character.regionalOption) : null;
  const milestones = progress.data?.data.perEnrollment.find((p) => p.enrollmentId === enrollment?.id)?.storyMilestonesUnlocked ?? [];
  const about = [
    ...(roster ? [roster.personality, `${roster.voice.pitch} · ${roster.voice.pace} · ${roster.voice.warmth}`, roster.voice.notes, roster.altText] : []),
    character.varietyId,
    ...(regionalLabel ? [regionalLabel] : []),
    ...(character.syntheticVoice ? [t('speak.syntheticVoice.detail', { name: character.name })] : []),
  ];
  return (
    <Screen title={character.name} onBack={() => router.back()} headerEnd={<InfoAffordance label={t('speak.characters.aboutCast')} title={character.name} text={about} />}>
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <CharacterPortrait characterId={character.portraitKey} expression="greeting" size={160} name={character.name} subtitle={where ? `${character.role} · ${where}` : character.role} density="full" />
        {roster?.nameNative ? <ThemedText variant="transliteration" tone="muted">{roster.nameNative}</ThemedText> : null}
        <Row gap={theme.spacing.xs} wrap justify="center">
          {regionalLabel && character.regionalMatch ? <Chip label={regionalLabel} tone="success" icon="check" /> : null}
          {character.syntheticVoice ? <SyntheticVoiceBadge name={character.name} /> : null}
        </Row>
      </View>
      {roster ? (
        <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.lg}>
          <ThemedText>{roster.lifeContext}</ThemedText>
        </Surface>
      ) : null}
      {milestones.length > 0 ? (
        <Row gap={theme.spacing.xs} wrap>
          {milestones.map((m) => (
            <Chip key={m} label={m.replace(/_/g, ' ')} tone="success" icon="check" />
          ))}
        </Row>
      ) : null}
      {roster ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md }}>
          {CHARACTER_EXPRESSIONS.filter((e) => e !== 'lip_sync').map((e) => (
            <CharacterPortrait key={e} characterId={character.portraitKey} expression={e} size={56} showStatusText={false} />
          ))}
        </ScrollView>
      ) : null}
      {enrollment ? (
        <Button
          testID="character-speak"
          label={t('speak.characters.talkWith', { name: character.name })}
          icon="mic"
          size="lg"
          fullWidth
          glow
          onPress={() => {
            void haptic('select');
            router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id, characterId: character.id } });
          }}
          accessibilityLabel={t('speak.characters.talkWith', { name: character.name })}
        />
      ) : null}
    </Screen>
  );
}
