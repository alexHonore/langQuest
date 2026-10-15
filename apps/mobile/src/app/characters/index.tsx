import { getCourseTrack } from '@langquest/contracts';
import { CHARACTER_ROSTER, CharacterPortrait, Chip, EmptyState, Row, Surface, ThemedText, charactersForVariety, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useActiveEnrollment } from '@/features/session/queries';
import { useT } from '@/lib/i18n';

/** Screen 8: meet the locals — original character roster for the active course's variety. */
export default function Characters(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const { enrollment } = useActiveEnrollment();
  const trackDef = enrollment ? getCourseTrack(enrollment.courseTrackId) : null;
  const cast = trackDef ? charactersForVariety(trackDef.targetVarietyId) : [...CHARACTER_ROSTER];
  return (
    <Screen title={trackDef ? `${trackDef.displayName}` : t('speak.title')} onBack={() => router.back()}>
      {cast.length === 0 ? <EmptyState title={t('common.notAvailable')} description={trackDef?.teachingFocus} mascotState="curious" /> : null}
      <View style={{ gap: theme.spacing.md }}>
        {cast.map((c) => (
          <Pressable key={c.id} onPress={() => router.push({ pathname: '/characters/[id]', params: { id: c.id } })} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.role}, ${c.city}`}>
            <Surface bordered radius="lg" padding={theme.spacing.md}>
              <Row gap={theme.spacing.md} align="flex-start">
                <CharacterPortrait characterId={c.id} expression="greeting" size={80} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText variant="subheading">{c.name}</ThemedText>
                  {c.nameNative ? <ThemedText variant="transliteration" tone="muted">{c.nameNative}</ThemedText> : null}
                  <ThemedText tone="secondary">{c.role} · {c.city}, {c.region}</ThemedText>
                  <Row gap={theme.spacing.xs} wrap>
                    <Chip label={c.varietyId} />
                    <Chip label={`${c.voice.pace} · ${c.voice.warmth}`} />
                  </Row>
                </View>
              </Row>
            </Surface>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
