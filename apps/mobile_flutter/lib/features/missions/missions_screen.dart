import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_logic.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/mission_path_screen.dart';
import '../scenes/animated_scene.dart';

/// The pathway: a walk through the course's places, strung along a line of lanterns. A lit lantern is a mission
/// done; the glowing one is the next, shown with its place alive and the stop to take; the others wait, dimmed. A
/// mission opens once the one before it is completed; a locked one says which mission to finish first.
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
            top: -120,
            right: -160,
            child: LanternBloom(color: accent.lantern[1].withValues(alpha: appState.isDark ? 0.20 : 0.10), size: 420),
          ),
          SafeArea(
            bottom: false,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 110),
              children: [
                Semantics(
                  header: true,
                  child: Text(course.track.name(appState.uiLanguage), style: displayStyle(size: 28, color: colors.textPrimary)),
                ),
                const SizedBox(height: 2),
                Text(l10n.fromLanguage(course.source), style: TextStyle(fontSize: 14, color: colors.textSecondary)),
                for (final chapter in course.chapters) ...[
                  const SizedBox(height: 22),
                  _ChapterHeader(
                    chapter: chapter,
                    source: course.source,
                    done: chapter.missions.where((m) => appState.progress.isMissionCompleted(m.key)).length,
                  ),
                  const SizedBox(height: 18),
                  for (final (i, mission) in chapter.missions.indexed)
                    _MissionRow(
                      mission: mission,
                      number: course.indexOfMission(mission.key) + 1,
                      isFirst: i == 0,
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

/// A chapter: its name, how far the learner is in it, and — for a draft — that nobody has reviewed it yet.
class _ChapterHeader extends ConsumerWidget {
  const _ChapterHeader({required this.chapter, required this.source, required this.done});

  final Chapter chapter;
  final String source;
  final int done;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final total = chapter.missions.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.chapterLabel(chapter.chapterIndex),
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: accent.primaryText),
        ),
        const SizedBox(height: 2),
        Text(chapter.titleIn(source) ?? '', style: displayStyle(size: 21, color: colors.textPrimary, bold: false)),
        const SizedBox(height: 10),
        ExcludeSemantics(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: SizedBox(
              height: 6,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ColoredBox(color: colors.surfaceMuted),
                  FractionallySizedBox(
                    alignment: AlignmentDirectional.centerStart,
                    widthFactor: total == 0 ? 0 : done / total,
                    child: DecoratedBox(
                      decoration: BoxDecoration(borderRadius: BorderRadius.circular(3), color: colors.success),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(l10n.chapterProgress(done, total), style: TextStyle(fontSize: 13, color: colors.textSecondary)),
        if (!chapter.nativeReviewed) ...[
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Icon(LucideIcons.info, size: 14, color: colors.warning),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(l10n.draftChapterNotice, style: TextStyle(fontSize: 12.5, height: 1.35, color: colors.textMuted)),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _MissionRow extends ConsumerWidget {
  final Mission mission;
  final int number;
  final bool isFirst;
  final bool isLast;
  final bool completed;
  final bool isNext;
  final bool unlocked;
  final Mission? lockedBy;
  final String source;

  const _MissionRow({
    required this.mission,
    required this.number,
    required this.isFirst,
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
    final done = appState.stopsDone(mission.key);
    final title = mission.titleIn(source) ?? '';
    final sceneId = sceneIdForSituation(mission.situation);
    // The lantern hangs level with the middle of a small card, and with the picture of the next mission's.
    final lanternTop = isNext ? 34.0 : 18.0;

    void open() {
      if (unlocked) {
        context.push('/path/${mission.key}');
      } else {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(l10n.missionLocked(lockedBy?.titleIn(source) ?? '')), duration: const Duration(seconds: 2)));
      }
    }

    // The lantern on the string: lit when done, glowing when it is the next, a dim outline while it waits.
    final lantern = Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: completed ? colors.success : (isNext ? accent.primary : colors.background),
        border: Border.all(
          color: completed ? colors.success : (isNext ? accent.primaryText : colors.borderStrong.withValues(alpha: 0.5)),
          width: isNext ? 2.5 : 1.5,
        ),
        boxShadow: isNext ? [BoxShadow(color: accent.primary.withValues(alpha: 0.6), blurRadius: 18, spreadRadius: 2)] : null,
      ),
      child: completed
          ? Icon(LucideIcons.check, size: 20, color: colors.background)
          : Text('$number', style: displayStyle(size: 17, color: isNext ? accent.onPrimary : colors.textMuted)),
    );

    final Widget card;
    if (isNext) {
      final nextStopValue = nextStop(stops, done) ?? PathStop.mission;
      card = Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: accent.primary.withValues(alpha: 0.65), width: 1.5),
          boxShadow: [BoxShadow(color: accent.primary.withValues(alpha: appState.isDark ? 0.28 : 0.16), blurRadius: 22, spreadRadius: 1)],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(21),
          child: ColoredBox(
            color: colors.elevated,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AnimatedSceneWidget(
                  sceneId: sceneId,
                  title: sceneTitle(l10n, sceneId),
                  height: 108,
                  radius: 0,
                  showTimeToggle: false,
                  child: plan == null || plan.characterName.isEmpty
                      ? null
                      : Positioned(right: 12, bottom: 8, child: CharacterBadge(name: plan.characterName, speaking: false, size: 42)),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: displayStyle(size: 19, color: colors.textPrimary)),
                      if (mission.sceneNoteIn(source) case final note?) ...[
                        const SizedBox(height: 4),
                        Text(
                          note,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13.5, height: 1.35, color: colors.textSecondary),
                        ),
                      ],
                      if (stops.isNotEmpty) ...[const SizedBox(height: 10), StopDots(stops: stops, done: done)],
                      const SizedBox(height: 12),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: Container(
                          constraints: const BoxConstraints(minHeight: 40),
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          decoration: BoxDecoration(color: accent.primary, borderRadius: BorderRadius.circular(20)),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(LucideIcons.play, size: 15, color: accent.onPrimary),
                              const SizedBox(width: 8),
                              Flexible(
                                child: Text(
                                  done.isEmpty ? l10n.pathStartStop(stopLabel(l10n, nextStopValue)) : l10n.pathContinueStop(stopLabel(l10n, nextStopValue)),
                                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: accent.onPrimary),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    } else {
      // A place already visited, or one still ahead: its picture, small, and its name.
      final thumb = RepaintBoundary(
        child: AnimatedSceneWidget(sceneId: sceneId, height: 60, width: 78, radius: 14, animate: false, showTitle: false, showTimeToggle: false),
      );
      card = Container(
        constraints: const BoxConstraints(minHeight: 76),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: unlocked ? colors.surface : colors.surface.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: colors.border),
        ),
        child: Row(
          children: [
            unlocked ? thumb : Opacity(opacity: 0.35, child: thumb),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    title,
                    style: TextStyle(fontSize: 15.5, height: 1.25, fontWeight: FontWeight.w600, color: unlocked ? colors.textPrimary : colors.textSecondary),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    completed ? l10n.missionDone : (plan == null ? '' : l10n.phrasesCount(plan.phrases.length)),
                    style: TextStyle(fontSize: 13, color: completed ? colors.success : colors.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            Icon(unlocked ? LucideIcons.chevronRight : LucideIcons.lock, size: 18, color: colors.textMuted),
            const SizedBox(width: 4),
          ],
        ),
      );
    }

    return Semantics(
      button: true,
      label:
          '${l10n.missionLabel(number)}. $title${unlocked ? '' : ', ${l10n.lockedSemantics}'}${stops.isEmpty ? '' : '. ${l10n.stopsDoneSemantics(done.where(stops.contains).length, stops.length)}'}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: open,
        behavior: HitTestBehavior.opaque,
        child: Stack(
          children: [
            // The string the lanterns hang on: lit as far as the learner has walked.
            if (!isFirst)
              PositionedDirectional(
                start: 19,
                top: 0,
                height: lanternTop,
                child: Container(width: 2, color: unlocked ? colors.success.withValues(alpha: 0.55) : colors.border),
              ),
            if (!isLast)
              PositionedDirectional(
                start: 19,
                top: lanternTop + 40,
                bottom: 0,
                child: Container(width: 2, color: completed ? colors.success.withValues(alpha: 0.55) : colors.border),
              ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(top: lanternTop),
                  child: lantern,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Padding(padding: const EdgeInsets.only(bottom: 14), child: card),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The stops of a mission, in order (learn · practise · mission): checked when done; the next one stands out.
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
        spacing: 12,
        runSpacing: 4,
        children: [
          for (final stop in stops)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (done.contains(stop))
                  Icon(LucideIcons.circleCheck, size: 14, color: colors.success)
                else
                  Container(
                    width: 9,
                    height: 9,
                    margin: const EdgeInsets.symmetric(horizontal: 2.5),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: stop == next ? appState.accent.primary : Colors.transparent,
                      border: Border.all(color: stop == next ? appState.accent.primary : colors.borderStrong, width: 1.5),
                    ),
                  ),
                const SizedBox(width: 5),
                Text(
                  stopLabel(l10n, stop),
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: stop == next ? FontWeight.w600 : FontWeight.w400,
                    color: stop == next ? appState.accent.primaryText : (done.contains(stop) ? colors.textSecondary : colors.textMuted),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
