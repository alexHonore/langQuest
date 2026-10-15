/**
 * Course header data for `AppShell` (every learner screen shows the active
 * course and its own instruction language with an edit affordance, §1.3).
 */
import { findCourseTrack, type EnrollmentDto } from '@langquest/contracts';
import type { CourseHeaderInfo } from '@langquest/ui';
import { useMemo } from 'react';
import { useLanguageNames } from '@/lib/i18n';

export function useCourseHeader(enrollment: EnrollmentDto | null): CourseHeaderInfo | null {
  const languageName = useLanguageNames();
  return useMemo(() => {
    if (!enrollment) return null;
    const track = findCourseTrack(enrollment.courseTrackId);
    const regional = enrollment.regionalPreference ? (track?.regionalOptions.find((o) => o.id === enrollment.regionalPreference)?.label ?? enrollment.regionalPreference) : null;
    return {
      courseTrackId: enrollment.courseTrackId,
      trackTitle: track?.displayName,
      sourceLanguageCode: enrollment.sourceLanguageCode,
      sourceLanguageName: languageName(enrollment.sourceLanguageCode),
      regionalLabel: regional,
    };
  }, [enrollment, languageName]);
}
