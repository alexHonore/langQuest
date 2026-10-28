import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../scenes/animated_scene.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_widgets.dart';

/// N2 — one mission node: learn → practise → mission → talk, on the existing pathway. The learner can
/// open any stop, but the primary action is always the next one, so the curve is the default path.
class MissionPathScreen extends ConsumerWidget {
  final String missionId;
  const MissionPathScreen({super.key, required this.missionId});

  static String routeFor(String missionId, PathStop stop) => switch (stop) {
        PathStop.learn => '/learn/$missionId/scene',
        PathStop.practise => '/learn/$missionId/practice',
        PathStop.mission => '/mission/$missionId',
        PathStop.talk => '/conversation',
      };

  void _open(BuildContext context, WidgetRef ref, PathStop stop) {
    // The free chat has no completion signal in this prototype: opening it counts as visiting it.
    if (stop == PathStop.talk) ref.read(appStateProvider.notifier).completeStop(missionId, PathStop.talk);
    context.push(routeFor(missionId, stop));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final mission = appState.missions.firstWhere((m) => m.id == missionId, orElse: () => appState.missions.first);
    final plan = LearnContent.forMission(missionId);
    final stops = stopsFor(hasLearnPlan: plan != null);
    final done = appState.stopsDone(missionId);
    final next = nextStop(stops, done);

    ({String title, String subtitle, IconData icon}) describe(PathStop stop) => switch (stop) {
          PathStop.learn => (title: 'Learn', subtitle: 'Watch the scene with ${plan?.characterName}, then ${plan?.phrases.length} new phrases', icon: LucideIcons.bookOpen),
          PathStop.practise => (title: 'Practise', subtitle: 'Match the pairs, build a sentence', icon: LucideIcons.gamepad2),
          PathStop.mission => (title: 'Mission', subtitle: '${mission.description} · ${mission.minutes} min', icon: LucideIcons.flag),
          PathStop.talk => (title: 'Talk', subtitle: 'Free chat${plan != null ? ' with ${plan.characterName}' : ''}', icon: LucideIcons.messageCircle),
        };

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 16, 0),
            child: Row(children: [
              IconButton(icon: Icon(LucideIcons.chevronLeft, color: colors.textSecondary), tooltip: 'Back', onPressed: () => context.pop()),
              Expanded(child: Semantics(header: true, child: Text(mission.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colors.textPrimary)))),
            ]),
          ),
          // The scene takes the space left after the stops (and disappears on a very short screen).
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: LayoutBuilder(
                builder: (context, box) => box.maxHeight < 90
                    ? const SizedBox.shrink()
                    : AnimatedSceneWidget(sceneId: sceneIdFromName(mission.sceneId), height: box.maxHeight, showTimeToggle: false),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(children: [
              for (var i = 0; i < stops.length; i++)
                _StopTile(
                  number: i + 1,
                  title: describe(stops[i]).title,
                  subtitle: describe(stops[i]).subtitle,
                  icon: describe(stops[i]).icon,
                  done: done.contains(stops[i]),
                  isNext: stops[i] == next,
                  onTap: () => _open(context, ref, stops[i]),
                ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: next == null
                ? Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(LucideIcons.checkCheck, color: colors.success),
                    const SizedBox(width: 8),
                    Text('Mission path complete', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: colors.success)),
                  ])
                : LearnPrimaryButton(
                    label: '${done.isEmpty ? 'Start' : 'Continue'}: ${describe(next).title}',
                    icon: LucideIcons.chevronRight,
                    onPressed: () => _open(context, ref, next),
                  ),
          ),
        ]),
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

  const _StopTile({required this.number, required this.title, required this.subtitle, required this.icon, required this.done, required this.isNext, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final dotColor = done ? colors.success : isNext ? accent.primary : colors.elevated;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        button: true,
        label: '$number. $title. $subtitle${done ? '. Done' : isNext ? '. Next' : ''}',
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
            child: Row(children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(shape: BoxShape.circle, color: dotColor),
                alignment: Alignment.center,
                child: done
                    ? const Icon(LucideIcons.check, size: 18, color: Colors.white)
                    : Icon(icon, size: 17, color: isNext ? Colors.white : colors.textMuted),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: colors.textPrimary)),
                  Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: colors.textSecondary)),
                ]),
              ),
              Icon(LucideIcons.chevronRight, size: 18, color: colors.textMuted),
            ]),
          ),
        ),
      ),
    );
  }
}
