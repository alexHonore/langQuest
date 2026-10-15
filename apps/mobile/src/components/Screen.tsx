/**
 * Standard learner screen: `AppShell` with safe-area insets, the mandatory
 * course + instruction-language header (edit → course switcher), the offline
 * chip and an optional scrolling body.
 */
import type { EnrollmentDto } from '@langquest/contracts';
import { AppShell, type CourseHeaderInfo } from '@langquest/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCourseHeader } from '@/features/session/enrollment-header';
import { useActiveEnrollment } from '@/features/session/queries';
import { useUiLabels } from '@/lib/labels';
import { useServices } from '@/lib/services';

export interface ScreenProps {
  title?: string;
  /** Override the active enrollment (e.g. the enrollment editor). `null` hides the course line. */
  enrollment?: EnrollmentDto | null;
  course?: CourseHeaderInfo | null;
  onBack?: () => void;
  headerEnd?: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
  /** Hide the edit affordance (used by the switcher itself). */
  noEdit?: boolean;
  /** Skip the safe-area top inset when rendered inside a tab navigator that already applies it. */
  insideTabs?: boolean;
  fullBleed?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
}

export function Screen(props: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { online } = useServices();
  const { enrollment: active } = useActiveEnrollment();
  const enrollment = props.enrollment === undefined ? active : props.enrollment;
  const derived = useCourseHeader(enrollment);
  const course = props.course === undefined ? derived : props.course;
  const labels = useUiLabels().shell;
  const body = props.scroll === false ? props.children : <ScrollView contentContainerStyle={[{ paddingVertical: 12, gap: 16 }, props.contentStyle]} keyboardShouldPersistTaps="handled">{props.children}</ScrollView>;
  return (
    <AppShell
      course={course}
      onEditCourse={props.noEdit ? undefined : () => router.push('/course-switcher')}
      title={props.title}
      onBack={props.onBack}
      headerEnd={props.headerEnd}
      offline={!online}
      insets={{ top: props.insideTabs ? 0 : insets.top, bottom: props.footer ? insets.bottom : 0, left: insets.left, right: insets.right }}
      footer={props.footer}
      fullBleed={props.fullBleed}
      labels={labels}
      testID={props.testID}
    >
      <View style={{ flex: 1 }}>{body}</View>
    </AppShell>
  );
}
