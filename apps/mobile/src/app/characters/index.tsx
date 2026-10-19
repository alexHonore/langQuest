import { getCourseTrack } from '@langquest/contracts';
import { CharacterPortrait, Chip, EmptyState, Row, Surface, ThemedText, findCharacter, useTheme } from '@langquest/ui';
import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { SyntheticVoiceBadge } from '@/components/SyntheticVoiceBadge';
import { useCast } from '@/features/characters/use-cast';
import { useActiveEnrollment } from '@/features/session/queries';
import { useEnrollmentNavigation } from '@/features/session/use-capabilities';
import { useT } from '@/lib/i18n';

/**
 * Screen 8: meet the locals — the cast published for the active course (course manifest `characters[]`),
 * ranked for the enrollment's regional preference. Art is the in-code portrait keyed by the roster slug.
 */
export default function Characters(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const { enrollment } = useActiveEnrollment();
  const nav = useEnrollmentNavigation(enrollment);
  const { cast, query } = useCast(nav.liveConversation ? enrollment : null);
  const trackDef = enrollment ? getCourseTrack(enrollment.courseTrackId) : null;
  const regionalLabel = (optionId: string | null): string | null => trackDef?.regionalOptions.find((o) => o.id === optionId)?.label ?? optionId;
  if (!enrollment || !trackDef) {
    return (
      <Screen title={t('speak.characters.title')} onBack={() => router.back()}>
        <EmptyState title={t('home.noCourse')} actionLabel={t('home.addCourse')} onAction={() => router.push('/catalog')} mascotState="curious" />
      </Screen>
    );
  }
  if (!nav.liveConversation) return <Redirect href="/(tabs)" />;
  return (
    <Screen title={trackDef.displayName} onBack={() => router.back()}>
      <ThemedText tone="secondary">{t('speak.characters.title')}</ThemedText>
      {query.isLoading && cast.length === 0 ? <LoadingView rows={2} /> : null}
      {query.error && !query.data ? <ErrorView error={query.error} onRetry={() => void query.refetch()} /> : null}
      <View style={{ gap: theme.spacing.md }}>
        {cast.map((c) => {
          const roster = findCharacter(c.portraitKey);
          const where = c.region ?? (roster ? `${roster.city}, ${roster.region}` : null);
          return (
            <Pressable key={c.id} testID={`character-${c.portraitKey}`} onPress={() => router.push({ pathname: '/characters/[id]', params: { id: c.id } })} accessibilityRole="button" accessibilityLabel={[c.name, c.role, where].filter(Boolean).join(', ')}>
              <Surface bordered radius="lg" padding={theme.spacing.md}>
                <Row gap={theme.spacing.md} align="flex-start">
                  <CharacterPortrait characterId={c.portraitKey} expression="greeting" size={80} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText variant="subheading">{c.name}</ThemedText>
                    {roster?.nameNative ? <ThemedText variant="transliteration" tone="muted">{roster.nameNative}</ThemedText> : null}
                    <ThemedText tone="secondary">{where ? `${c.role} · ${where}` : c.role}</ThemedText>
                    <Row gap={theme.spacing.xs} wrap>
                      <Chip label={c.varietyId} />
                      {c.regionalMatch ? <Chip label={t('speak.characters.regionalFit', { region: regionalLabel(c.regionalOption) ?? '' })} tone="success" icon="check" /> : c.regionalOption ? <Chip label={regionalLabel(c.regionalOption) ?? c.regionalOption} /> : null}
                      {c.syntheticVoice ? <SyntheticVoiceBadge name={c.name} /> : null}
                    </Row>
                  </View>
                </Row>
              </Surface>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
