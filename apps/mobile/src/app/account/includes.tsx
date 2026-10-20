import { getCourseTrack } from '@langquest/contracts';
import { Chip, Row, useTheme } from '@langquest/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { CapabilityDisclaimer } from '@/components/CapabilityDisclaimer';
import { Screen } from '@/components/Screen';
import { CacheNotice } from '@/components/StateViews';
import { useActiveEnrollment } from '@/features/session/queries';
import { useLanguageNames, useT } from '@/lib/i18n';

/**
 * Account → "What this course includes" (CONVENTIONS §8): per enrollment, what the course × instruction
 * language offers today (counts from the capability snapshot) and the plain list of what it does not have
 * yet. The snapshot travels with the cached enrollment, so the screen answers offline too; when a cached
 * DTO predates capabilities, nothing is listed (and the app hides the corresponding tabs).
 */
export default function CourseIncludes(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const t = useT();
  const names = useLanguageNames();
  const params = useLocalSearchParams<{ enrollmentId?: string }>();
  const { enrollment: active, enrollments, query } = useActiveEnrollment();
  const [picked, setPicked] = useState<string | null>(typeof params.enrollmentId === 'string' ? params.enrollmentId : null);
  const enrollment = enrollments.find((e) => e.id === picked) ?? active;
  const trackDef = enrollment ? getCourseTrack(enrollment.courseTrackId) : null;
  return (
    <Screen title={t('enrollment.disclaimer.includes.title')} onBack={() => router.back()} enrollment={enrollment ?? null} noEdit>
      {/* Calm density: the course line is the header's course line; the card below carries the lists. */}
      {query.data?.fromCache ? <CacheNotice fetchedAt={query.data.fetchedAt} /> : null}
      {enrollments.length > 1 ? (
        <Row gap={theme.spacing.xs} wrap accessibilityRole="radiogroup">
          {enrollments.map((e) => (
            <View key={e.id} testID={`includes-course-${e.id}`}>
              <Chip label={t('home.activeCourse', { target: getCourseTrack(e.courseTrackId).displayName, source: names(e.sourceLanguageCode) })} selected={e.id === enrollment?.id} onPress={() => setPicked(e.id)} />
            </View>
          ))}
        </Row>
      ) : null}
      {enrollment && trackDef ? (
        <View style={{ gap: theme.spacing.md }}>
          <CapabilityDisclaimer testID="account-includes" capabilities={enrollment.capabilities} sourceName={names(enrollment.sourceLanguageCode)} targetName={trackDef.displayName} showIncludes />
        </View>
      ) : null}
    </Screen>
  );
}
