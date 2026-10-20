/**
 * Course lantern scope: every screen under this node reads the lantern / primary-action /
 * mascot-family accents of the ACTIVE enrollment's course track from the theme
 * (`useTheme().accents`, `useMascotTint`). Lesson-type modulation is layered on top by the
 * speaking screens (`LessonAccentScope`), never by hard-coding colours in a screen.
 */
import type { EnrollmentDto } from '@langquest/contracts';
import { LessonAccentScope } from '@langquest/ui';
import React from 'react';
import { useActiveEnrollment } from '@/features/session/queries';

export function CourseAccentScope(props: { children: React.ReactNode; enrollment?: EnrollmentDto | null }): React.JSX.Element {
  const active = useActiveEnrollment();
  const enrollment = props.enrollment === undefined ? active.enrollment : props.enrollment;
  return (
    <LessonAccentScope lessonType={null} courseTrackId={enrollment?.courseTrackId ?? null}>
      {props.children}
    </LessonAccentScope>
  );
}
