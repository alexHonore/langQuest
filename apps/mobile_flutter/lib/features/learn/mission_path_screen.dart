import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/services/app_state.dart';
import '../../l10n/l10n.dart';
import '../scenes/animated_scene.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';

/// N2 — one mission node: learn → practise → mission, on the pathway. The learner can open any stop, but the
/// primary action is always the next one, so the curve is the default path. (Talk appears once a live
/// conversation partner backs it; this offline build has none, so the stop is not shown.)
class MissionPathScreen extends ConsumerWidget {
  final String missionKey;
  const MissionPathScreen({super.key, required this.missionKey});

  static String routeFor(String missionKey, PathStop stop) => switch (stop) {
    PathStop.learn => '/learn/$missionKey/scene',
    PathStop.practise => '/learn/$missionKey/practice',
    PathStop.mission => '/mission/$missionKey',
    PathStop.talk => '/path/$missionKey',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plan = ref.watch(learnPlanProvider(missionKey));
    if (plan == null) return const MissionUnavailable();
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final stops = stopsFor(hasLearnPlan: planHasLearnStops(plan));
    final done = appState.stopsDone(missionKey);
    final next = nextStop(stops, done);
    final title = plan.mission.titleIn(plan.source) ?? '';
    final sceneId = sceneIdForSituation(plan.mission.situation);

    ({String title, String subtitle, IconData icon}) describe(PathStop stop) => switch (stop) {
      PathStop.learn => (title: l10n.stopLearn, subtitle: l10n.pathLearnSubtitle(plan.characterName, plan.phrases.length), icon: LucideIcons.bookOpen),
      PathStop.practise => (
        title: l10n.stopPractise,
        subtitle: plan.tiles == null ? l10n.pathPractisePairsOnly : l10n.pathPractiseSubtitle,
        icon: LucideIcons.gamepad2,
      ),
      PathStop.mission => (title: l10n.stopMission, subtitle: l10n.pathMissionSubtitle(plan.exchanges.length, plan.characterName), icon: LucideIcons.flag),
      PathStop.talk => (title: l10n.stopTalk, subtitle: '', icon: LucideIcons.messageCircle),
    };

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 16, 0),
              child: Row(
                children: [
                  IconButton(
                    icon: Icon(LucideIcons.chevronLeft, color: colors.textSecondary),
                    tooltip: l10n.back,
                    onPressed: () => context.popOrHome(),
                  ),
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colors.textPrimary),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (plan.mission.sceneNoteIn(plan.source) case final note?)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 2, 20, 0),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    note,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 13.5, color: colors.textSecondary),
                  ),
                ),
              ),
            // The scene takes the space left after the stops (and disappears on a very short screen).
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: LayoutBuilder(
                  builder: (context, box) => box.maxHeight < 90
                      ? const SizedBox.shrink()
                      : AnimatedSceneWidget(
                          sceneId: sceneId,
                          title: sceneTitle(l10n, sceneId),
                          height: box.maxHeight,
                          showTimeToggle: false,
                          child: plan.characterName.isEmpty
                              ? null
                              : Center(
                                  child: CharacterBadge(name: plan.characterName, speaking: false, size: (box.maxHeight * 0.3).clamp(44.0, 80.0)),
                                ),
                        ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                children: [
                  for (var i = 0; i < stops.length; i++)
                    _StopTile(
                      number: i + 1,
                      title: describe(stops[i]).title,
                      subtitle: describe(stops[i]).subtitle,
                      icon: describe(stops[i]).icon,
                      done: done.contains(stops[i]),
                      isNext: stops[i] == next,
                      onTap: () => context.push(routeFor(missionKey, stops[i])),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: next == null
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(LucideIcons.checkCheck, color: colors.success),
                        const SizedBox(width: 8),
                        Text(
                          l10n.pathComplete,
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: colors.success),
                        ),
                      ],
                    )
                  : LearnPrimaryButton(
                      label: done.isEmpty ? l10n.pathStartStop(describe(next).title) : l10n.pathContinueStop(describe(next).title),
                      icon: LucideIcons.chevronRight,
                      onPressed: () => context.push(routeFor(missionKey, next)),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StopTile extends ConsumerWidget {
  final int number;
  final String title;
  final String subtitle;
  final IconData icon;
  final bool done;
  final bool isNext;
  final VoidCallback onTap;

  const _StopTile({
    required this.number,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.done,
    required this.isNext,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final dotColor = done ? colors.success : (isNext ? accent.primary : colors.surfaceMuted);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        button: true,
        label:
            '$number. $title. $subtitle${done
                ? '. ${l10n.pathDoneSemantics}'
                : isNext
                ? '. ${l10n.pathNextSemantics}'
                : ''}',
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: isNext ? accent.primarySoft : colors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isNext ? accent.primary : colors.border, width: isNext ? 1.5 : 1),
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: dotColor),
                  alignment: Alignment.center,
                  child: done
                      ? Icon(LucideIcons.check, size: 18, color: colors.background)
                      : Icon(icon, size: 17, color: isNext ? accent.onPrimary : colors.textMuted),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: colors.textPrimary),
                      ),
                      if (subtitle.isNotEmpty)
                        Text(
                          subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: colors.textSecondary),
                        ),
                    ],
                  ),
                ),
                Icon(LucideIcons.chevronRight, size: 18, color: colors.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Exposed for tests: whether a plan has the teaching block that makes Learn/Practise stops appear.
bool planHasLearnStops(MissionLearnPlan plan) => plan.sceneLines.isNotEmpty && plan.phrases.isNotEmpty;
