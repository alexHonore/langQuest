import { getCourseTrack } from '@langquest/contracts';
import { CharacterPortrait, Chip, EmptyState, InfoAffordance, Row, Surface, ThemedText, findCharacter, useTheme } from '@langquest/ui';
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
 * Screen 8 (calm density): meet the locals — the cast published for the active course (course manifest
 * `characters[]`), ranked for the enrollment's regional preference. One card per character: C2 clay
 * portrait, name, role · place, the regional-fit chip and the synthetic-voice badge; nothing else.
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
  const synthetic = cast.some((c) => c.syntheticVoice);
  return (
    <Screen title={t('speak.characters.title')} onBack={() => router.back()} headerEnd={<InfoAffordance label={t('speak.characters.aboutCast')} title={t('speak.characters.title')} text={[trackDef.displayName, ...(synthetic ? [t('speak.syntheticVoice.detail', { name: cast[0]?.name ?? '' })] : []), t('speak.characters.regionalFit', { region: regionalLabel(enrollment.regionalPreference) ?? '' })]} />}>
      {query.isLoading && cast.length === 0 ? <LoadingView rows={2} /> : null}
      {query.error && !query.data ? <ErrorView error={query.error} onRetry={() => void query.refetch()} /> : null}
      <View style={{ gap: theme.spacing.md }}>
        {cast.map((c) => {
          const roster = findCharacter(c.portraitKey);
          const where = c.region ?? (roster ? `${roster.city}, ${roster.region}` : null);
          return (
            <Pressable key={c.id} testID={`character-${c.portraitKey}`} onPress={() => router.push({ pathname: '/characters/[id]', params: { id: c.id } })} accessibilityRole="button" accessibilityLabel={[c.name, c.role, where].filter(Boolean).join(', ')}>
              <Surface variant="glass" level={1} radius="lg" padding={theme.spacing.md}>
                <Row gap={theme.spacing.md} align="center">
                  <CharacterPortrait characterId={c.portraitKey} expression="greeting" size={72} />
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    <ThemedText variant="subheading">{c.name}</ThemedText>
                    <ThemedText tone="secondary" numberOfLines={1}>
                      {where ? `${c.role} · ${where}` : c.role}
                    </ThemedText>
                    <Row gap={theme.spacing.xs} wrap>
                      {c.regionalMatch ? <Chip label={regionalLabel(c.regionalOption) ?? ''} tone="success" icon="check" accessibilityLabel={t('speak.characters.regionalFit', { region: regionalLabel(c.regionalOption) ?? '' })} /> : null}
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
