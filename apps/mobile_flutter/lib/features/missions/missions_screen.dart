import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_logic.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/mission_path_screen.dart';

/// The pathway: the course's chapters and missions in order. A mission opens once the one before it is completed;
/// a locked node says which mission to finish first instead of opening.
class MissionsScreen extends ConsumerWidget {
  const MissionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final course = appState.activeCourse;
    if (course == null) return const SizedBox.shrink();
    final accent = appState.accent;
    final colors = appState.colors;
    final l10n = context.l10n;
    final next = appState.nextMission(course);

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          Positioned(
            top: 100,
            right: -60,
            child: IgnorePointer(
              child: Container(
                width: 260,
                height: 260,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: accent.primary.withValues(alpha: appState.isDark ? 0.12 : 0.07),
                ),
              ),
            ),
          ),
          SafeArea(
            bottom: false,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
              children: [
                Text(
                  l10n.pathwayTitle.toUpperCase(),
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: accent.primaryText),
                ),
                const SizedBox(height: 6),
                Semantics(
                  header: true,
                  child: Text(
                    course.track.name(appState.uiLanguage),
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: colors.textPrimary),
                  ),
                ),
                const SizedBox(height: 2),
                Text(l10n.fromLanguage(course.source), style: TextStyle(fontSize: 13.5, color: colors.textSecondary)),
                for (final chapter in course.chapters) ...[
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: accent.primarySoft, borderRadius: BorderRadius.circular(12)),
                        child: Text(
                          l10n.chapterLabel(chapter.chapterIndex),
                          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: accent.primaryText),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          chapter.titleIn(course.source) ?? '',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: colors.textPrimary),
                        ),
                      ),
                    ],
                  ),
                  if (!chapter.nativeReviewed) ...[const SizedBox(height: 8), _DraftNotice(text: l10n.draftChapterNotice)],
                  const SizedBox(height: 14),
                  for (final (i, mission) in chapter.missions.indexed)
                    _MissionNode(
                      mission: mission,
                      number: course.indexOfMission(mission.key) + 1,
                      isLast: i == chapter.missions.length - 1,
                      completed: appState.progress.isMissionCompleted(mission.key),
                      isNext: next?.key == mission.key,
                      unlocked: appState.isUnlocked(course, mission.key),
                      lockedBy: course.indexOfMission(mission.key) > 0 ? course.missions[course.indexOfMission(mission.key) - 1] : null,
                      source: course.source,
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DraftNotice extends ConsumerWidget {
  final String text;
  const _DraftNotice({required this.text});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: colors.warningSoft, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(LucideIcons.info, size: 15, color: colors.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 12.5, height: 1.35, color: colors.textPrimary)),
          ),
        ],
      ),
    );
  }
}

class _MissionNode extends ConsumerWidget {
  final Mission mission;
  final int number;
  final bool isLast;
  final bool completed;
  final bool isNext;
  final bool unlocked;
  final Mission? lockedBy;
  final String source;

  const _MissionNode({
    required this.mission,
    required this.number,
    required this.isLast,
    required this.completed,
    required this.isNext,
    required this.unlocked,
    required this.lockedBy,
    required this.source,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;
    final l10n = context.l10n;
    final plan = ref.watch(learnPlanProvider(mission.key));
    final stops = plan == null ? const <PathStop>[] : stopsFor(hasLearnPlan: planHasLearnStops(plan));
    final title = mission.titleIn(source) ?? '';

    void open() {
      if (unlocked) {
        context.push('/path/${mission.key}');
      } else {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(l10n.missionLocked(lockedBy?.titleIn(source) ?? '')), duration: const Duration(seconds: 2)));
      }
    }

    final nodeColor = completed ? colors.success : (isNext ? accent.primary : colors.surfaceMuted);
    final iconColor = completed ? colors.background : (isNext ? accent.onPrimary : colors.textMuted);

    return Semantics(
      button: true,
      label:
          '${l10n.missionLabel(number)}. $title${unlocked ? '' : ', ${l10n.lockedSemantics}'}${stops.isEmpty ? '' : '. ${l10n.stopsDoneSemantics(appState.stopsDone(mission.key).where(stops.contains).length, stops.length)}'}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: open,
        behavior: HitTestBehavior.opaque,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: nodeColor,
                    border: Border.all(color: isNext ? accent.primaryText : nodeColor, width: isNext ? 2.5 : 1.5),
                    boxShadow: isNext ? [BoxShadow(color: accent.primary.withValues(alpha: 0.55), blurRadius: 16, spreadRadius: 2)] : null,
                  ),
                  child: Icon(completed ? LucideIcons.check : (unlocked ? LucideIcons.play : LucideIcons.lock), size: 20, color: iconColor),
                ),
                if (!isLast) Container(width: 2.5, height: 72, color: completed ? colors.success.withValues(alpha: 0.6) : colors.border),
              ],
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Container(
                margin: const EdgeInsets.only(bottom: 24),
                child: GlassContainer(
                  level: isNext ? GlassLevel.level2 : GlassLevel.level1,
                  radius: 18,
                  padding: const EdgeInsets.all(16),
                  customGlow: isNext ? accent.primary.withValues(alpha: 0.25) : null,
                  border: isNext ? Border.all(color: accent.primary.withValues(alpha: 0.6)) : null,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.missionLabel(number).toUpperCase(),
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.0, color: isNext ? accent.primaryText : colors.textMuted),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        title,
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: unlocked ? colors.textPrimary : colors.textSecondary),
                      ),
                      if (mission.sceneNoteIn(source) case final note?) ...[
                        const SizedBox(height: 4),
                        Text(
                          note,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: colors.textSecondary),
                        ),
                      ],
                      if (stops.isNotEmpty) ...[const SizedBox(height: 10), StopDots(stops: stops, done: appState.stopsDone(mission.key))],
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One dot per learn-path stop (learn · practise · mission), filled when done; the next one is highlighted.
class StopDots extends ConsumerWidget {
  final List<PathStop> stops;
  final Set<PathStop> done;
  const StopDots({super.key, required this.stops, required this.done});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final next = nextStop(stops, done);
    return ExcludeSemantics(
      child: Wrap(
        spacing: 10,
        runSpacing: 4,
        children: [
          for (final stop in stops)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: done.contains(stop)
                        ? colors.success
                        : stop == next
                        ? appState.accent.primary
                        : colors.borderStrong,
                  ),
                ),
                const SizedBox(width: 4),
                Text(stopLabel(l10n, stop), style: TextStyle(fontSize: 11.5, color: stop == next ? appState.accent.primaryText : colors.textMuted)),
              ],
            ),
        ],
      ),
    );
  }
}
