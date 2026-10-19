import { getCourseTrack } from '@langquest/contracts';
import { Button, Chip, CourseCover, Row, Surface, ThemedText, useTheme } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useActiveEnrollment } from '@/features/session/queries';
import { useLanguageNames, useT } from '@/lib/i18n';
import { useServices } from '@/lib/services';

/** Global course switcher (modal): pick the active enrollment, edit one, or add a course. */
export default function CourseSwitcher(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const { enqueue } = useServices();
  const { enrollment, enrollments, setActive } = useActiveEnrollment();
  return (
    <Screen title={t('enrollment.title')} onBack={() => router.back()} noEdit>
      <View style={{ gap: theme.spacing.md }}>
        {enrollments.map((e) => {
          const trackDef = getCourseTrack(e.courseTrackId);
          const active = e.id === enrollment?.id;
          return (
            <Pressable
              key={e.id}
              testID={`course-switcher-${e.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t('home.activeCourse', { target: trackDef.displayName, source: names(e.sourceLanguageCode) })}
              onPress={() => {
                setActive(e.id);
                void enqueue({ type: 'enrollment_opened', enrollmentId: e.id }, e.id);
                router.back();
              }}
            >
              <Surface variant={active ? 'accentSoft' : 'surface'} bordered radius="lg" padding={theme.spacing.md}>
                <Row gap={theme.spacing.md} align="flex-start">
                  <View style={{ width: 72 }}>
                    <CourseCover trackId={e.courseTrackId} width={72} hideTitle />
                  </View>
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    <ThemedText variant="subheading">{trackDef.displayName}</ThemedText>
                    <ThemedText tone="secondary">{t('catalog.enrollFrom', { source: names(e.sourceLanguageCode) })}</ThemedText>
                    <Row gap={theme.spacing.xs} wrap>
                      <Chip label={t(`enrollment.status.${e.status}`)} tone={active ? 'accent' : 'neutral'} />
                      {e.coverage.status !== 'complete' ? <Chip label={t(`enrollment.coverage.${e.coverage.status}`, { source: names(e.sourceLanguageCode) })} tone="warning" /> : null}
                    </Row>
                    <Button testID={`course-switcher-edit-${e.id}`} label={t('enrollment.editSource')} variant="ghost" size="sm" icon="edit" onPress={() => router.push({ pathname: '/enrollment/[id]', params: { id: e.id } })} accessibilityLabel={`${t('enrollment.editSource')} ${trackDef.displayName}`} />
                  </View>
                </Row>
              </Surface>
            </Pressable>
          );
        })}
      </View>
      <Button testID="course-switcher-add" label={t('enrollment.add')} icon="globe" variant="secondary" fullWidth onPress={() => router.push('/catalog')} accessibilityLabel={t('enrollment.add')} />
    </Screen>
  );
}
