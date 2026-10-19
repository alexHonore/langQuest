import { getCourseTrack } from '@langquest/contracts';
import { CHARACTER_EXPRESSIONS, CharacterPortrait, Button, Chip, Row, StatusLine, Surface, ThemedText, findCharacter, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { SyntheticVoiceBadge } from '@/components/SyntheticVoiceBadge';
import { findCastCharacter } from '@/features/characters/cast';
import { useCast } from '@/features/characters/use-cast';
import { useActiveEnrollment, useProgress } from '@/features/session/queries';
import { headingLevel } from '@/lib/a11y';
import { useT } from '@/lib/i18n';

/**
 * Character detail: look, region/dialect, backstory, voice, unlocked story milestones (earned by speaking,
 * never bought). `id` is the manifest character uuid (older links with the roster slug still resolve);
 * backstory and expressions come from the in-code roster entry behind `portraitKey` when there is one.
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
  return (
    <Screen title={character.name} onBack={() => router.back()}>
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <CharacterPortrait characterId={character.portraitKey} expression="greeting" size={160} name={character.name} subtitle={where ? `${character.role} · ${where}` : character.role} />
        {roster?.nameNative ? <ThemedText variant="transliteration" tone="muted">{roster.nameNative}</ThemedText> : null}
      </View>
      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        {roster ? <ThemedText>{roster.lifeContext}</ThemedText> : null}
        {roster ? <ThemedText tone="secondary">{roster.personality}</ThemedText> : null}
        <Row gap={theme.spacing.xs} wrap>
          <Chip label={character.varietyId} tone="accent" />
          {roster ? <Chip label={`${roster.voice.pitch} · ${roster.voice.pace} · ${roster.voice.warmth}`} /> : null}
          {regionalLabel ? <Chip label={regionalLabel} tone={character.regionalMatch ? 'success' : 'neutral'} icon={character.regionalMatch ? 'check' : undefined} /> : null}
        </Row>
        {character.syntheticVoice ? (
          <Row gap={theme.spacing.xs} wrap>
            <SyntheticVoiceBadge name={character.name} />
            <ThemedText variant="caption" tone="muted" style={{ flex: 1 }}>
              {t('speak.syntheticVoice.detail', { name: character.name })}
            </ThemedText>
          </Row>
        ) : null}
        {roster ? <ThemedText variant="caption" tone="muted">{roster.voice.notes}</ThemedText> : null}
        {roster ? <ThemedText variant="caption" tone="muted">{roster.altText}</ThemedText> : null}
      </Surface>
      <ThemedText variant="heading" accessibilityRole="header" {...headingLevel(2)}>
        {t('missions.unlocks', { consequence: '' }).replace(/[:\s]+$/, '')}
      </ThemedText>
      {milestones.length === 0 ? <StatusLine icon="info" tone="secondary" text={t('progress.evidenceCount', { count: 0 })} /> : null}
      <Row gap={theme.spacing.xs} wrap>
        {milestones.map((m) => (
          <Chip key={m} label={m.replace(/_/g, ' ')} tone="success" icon="check" />
        ))}
      </Row>
      {roster ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md }}>
          {CHARACTER_EXPRESSIONS.filter((e) => e !== 'lip_sync').map((e) => (
            <View key={e} style={{ alignItems: 'center', gap: 2 }}>
              <CharacterPortrait characterId={character.portraitKey} expression={e} size={64} showStatusText={false} />
              <ThemedText variant="caption" tone="muted">{e.replace(/_/g, ' ')}</ThemedText>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {enrollment ? <Button testID="character-speak" label={t('speak.title')} icon="mic" size="lg" fullWidth onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment.id, characterId: character.id } })} accessibilityLabel={t('speak.characters.talkWith', { name: character.name })} /> : null}
    </Screen>
  );
}
