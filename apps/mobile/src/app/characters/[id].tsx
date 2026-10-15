import { CHARACTER_EXPRESSIONS, CharacterPortrait, Button, Chip, Row, StatusLine, Surface, ThemedText, findCharacter, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView } from '@/components/StateViews';
import { useActiveEnrollment, useProgress } from '@/features/session/queries';
import { useT } from '@/lib/i18n';

/** Character detail: look, region/dialect, backstory, voice, unlocked story milestones (earned by speaking, never bought). */
export default function CharacterDetail(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enrollment } = useActiveEnrollment();
  const progress = useProgress(Boolean(enrollment));
  const character = typeof id === 'string' ? findCharacter(id) : undefined;
  if (!character) {
    return (
      <Screen title={t('speak.title')} onBack={() => router.back()}>
        <ErrorView error={new Error(t('errors.notFound'))} />
      </Screen>
    );
  }
  const milestones = progress.data?.data.perEnrollment.find((p) => p.enrollmentId === enrollment?.id)?.storyMilestonesUnlocked ?? [];
  const sameVariety = enrollment ? character.trackIds.includes(enrollment.courseTrackId) : true;
  return (
    <Screen title={character.name} onBack={() => router.back()}>
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <CharacterPortrait characterId={character.id} expression="greeting" size={160} name={character.name} subtitle={`${character.role} · ${character.city}, ${character.region}`} />
        {character.nameNative ? <ThemedText variant="transliteration" tone="muted">{character.nameNative}</ThemedText> : null}
      </View>
      <Surface radius="lg" padding={theme.spacing.lg} bordered style={{ gap: theme.spacing.sm }}>
        <ThemedText>{character.lifeContext}</ThemedText>
        <ThemedText tone="secondary">{character.personality}</ThemedText>
        <Row gap={theme.spacing.xs} wrap>
          <Chip label={character.varietyId} tone="accent" />
          <Chip label={`${character.voice.pitch} · ${character.voice.pace} · ${character.voice.warmth}`} />
          {character.voice.regionalOption ? <Chip label={character.voice.regionalOption} /> : null}
        </Row>
        <ThemedText variant="caption" tone="muted">{character.voice.notes}</ThemedText>
        <ThemedText variant="caption" tone="muted">{character.altText}</ThemedText>
      </Surface>
      <ThemedText variant="heading" accessibilityRole="header">
        {t('missions.unlocks', { consequence: '' }).replace(/[:\s]+$/, '')}
      </ThemedText>
      {milestones.length === 0 ? <StatusLine icon="info" tone="secondary" text={t('progress.evidenceCount', { count: 0 })} /> : null}
      <Row gap={theme.spacing.xs} wrap>
        {milestones.map((m) => (
          <Chip key={m} label={m.replace(/_/g, ' ')} tone="success" icon="check" />
        ))}
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md }}>
        {CHARACTER_EXPRESSIONS.filter((e) => e !== 'lip_sync').map((e) => (
          <View key={e} style={{ alignItems: 'center', gap: 2 }}>
            <CharacterPortrait characterId={character.id} expression={e} size={64} showStatusText={false} />
            <ThemedText variant="caption" tone="muted">{e.replace(/_/g, ' ')}</ThemedText>
          </View>
        ))}
      </ScrollView>
      {!sameVariety ? <StatusLine icon="warning" tone="warning" text={t('errors.capabilityUnsupported', { variety: character.varietyId })} /> : null}
      <Button label={t('speak.title')} icon="mic" size="lg" fullWidth disabled={!enrollment || !sameVariety} onPress={() => router.push({ pathname: '/conversation', params: { enrollmentId: enrollment!.id, characterId: character.characterId } })} accessibilityLabel={`${t('speak.title')} ${character.name}`} />
    </Screen>
  );
}
