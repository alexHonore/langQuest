import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/content/content_bundle.dart';
import '../../core/services/app_state.dart';
import 'learn_content.dart';

/// The active course's id (`track|source`), as a stable value to depend on.
final activeCourseIdProvider = Provider<String?>((ref) => ref.watch(appStateProvider.select((s) => s.learner.activeEnrollment?.courseId)));

/// The learn plan of [missionKey] in the active course, or null when the mission is not part of it.
final learnPlanProvider = Provider.family<MissionLearnPlan?, String>((ref, missionKey) {
  final id = ref.watch(activeCourseIdProvider);
  if (id == null) return null;
  final content = ref.watch(contentBundleProvider);
  final sep = id.indexOf('|');
  final course = content.course(id.substring(0, sep), id.substring(sep + 1));
  if (course == null || course.indexOfMission(missionKey) < 0) return null;
  final mission = content.mission(missionKey)!;
  return buildLearnPlan(mission: mission, track: course.track, source: course.source, character: content.characterOf(mission));
});
