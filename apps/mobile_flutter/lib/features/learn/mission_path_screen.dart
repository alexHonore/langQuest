import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/typography.dart';
import '../audio/audio_screens.dart';
import '../call/call_screen.dart';
import '../games/game_pool.dart';
import '../games/game_widgets.dart';
import '../../l10n/l10n.dart';
import '../scenes/animated_scene.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';
import 'record_take.dart';

/// N2 — one mission node: learn → practise → play → mission → talk, as numbered steps under the mission's place. The
/// learner can open any stop, but the primary action is always the next one, so the curve is the default path. Play is
/// a round of a mini-game with the mission's own phrases (the games take turns from mission to mission). Talk (a live
/// call with a character of the mission) appears only when a signed-in learner's course has live conversation on the
/// server. Under the steps, the other ways to work on the same phrases: saying them, their audio lesson.
class MissionPathScreen extends ConsumerWidget {
  final String missionKey;
  const MissionPathScreen({super.key, required this.missionKey});

  static String routeFor(String missionKey, PathStop stop) => switch (stop) {
    PathStop.learn => '/learn/$missionKey/scene',
    PathStop.practise => '/learn/$missionKey/practice',
    PathStop.play => '/learn/$missionKey/play',
    PathStop.mission => '/mission/$missionKey',
    PathStop.talk => '/call/$missionKey',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plan = ref.watch(learnPlanProvider(missionKey));
    if (plan == null) return const MissionUnavailable();
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    // A call about this mission needs the server to have it (a newer chapter may not be published there yet).
    final call = ref.watch(missionOnServerProvider(missionKey)) ? ref.watch(liveCallCourseProvider) : null;
    final stops = stopsOfPlan(plan, canTalk: call != null);
    final game = ref.watch(missionGameProvider(missionKey));
    final done = appState.stopsDone(missionKey);
    final canPractiseSaying = ref.watch(takeRecorderFactoryProvider) != null;
    final next = nextStop(stops, done);
    final title = plan.mission.titleIn(plan.source) ?? '';
    final sceneId = sceneIdForMission(plan.mission);
    final course = appState.activeCourse;
    final number = course == null ? 0 : course.indexOfMission(missionKey) + 1;
    final lockedTalk = call == null && ref.watch(callsNeedAccountProvider);
    final learned = done.contains(PathStop.learn) && plan.phrases.isNotEmpty;

    ({String title, String subtitle, IconData icon}) describe(PathStop stop) => switch (stop) {
      PathStop.learn => (title: l10n.stopLearn, subtitle: l10n.pathLearnSubtitle(plan.characterName, plan.phrases.length), icon: LucideIcons.bookOpen),
      PathStop.practise => (
        title: l10n.stopPractise,
        subtitle: plan.pairPhrases.length < 3 ? l10n.pathPractisePairsOnly : l10n.pathPractiseSubtitle,
        icon: LucideIcons.dumbbell,
      ),
      PathStop.play => (title: l10n.stopPlay, subtitle: game == null ? '' : l10n.pathPlaySubtitle(gameName(l10n, game)), icon: LucideIcons.gamepad2),
      PathStop.mission => (title: l10n.stopMission, subtitle: l10n.pathMissionSubtitle(plan.exchanges.length, plan.characterName), icon: LucideIcons.flag),
      PathStop.talk => (
        title: l10n.stopTalk,
        subtitle: call != null && call.voiceConversation && canPractiseSaying ? l10n.pathTalkSubtitle : l10n.pathTalkSubtitleText,
        icon: LucideIcons.phoneCall,
      ),
    };

    // The other ways to work on this mission's phrases, each only where it can be used.
    final extras = <({IconData icon, String label, String route})>[
      if (canPractiseSaying && learned) (icon: LucideIcons.mic, label: l10n.practiseSayingEntry, route: '/speak/$missionKey'),
      if (learned && ref.watch(audioLessonAudibleProvider(missionKey))) (icon: LucideIcons.headphones, label: l10n.pathAudioLesson, route: '/audio/$missionKey'),
    ];

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
                  if (course != null && number > 0)
                    Expanded(
                      child: Text(
                        l10n.missionOf(number, course.missions.length),
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: appState.accent.primaryText),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 2, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      header: true,
                      child: Text(title, style: displayStyle(size: 26, color: colors.textPrimary)),
                    ),
                    if (plan.mission.sceneNoteIn(plan.source) case final note?) ...[
                      const SizedBox(height: 6),
                      Text(note, style: TextStyle(fontSize: 14.5, height: 1.4, color: colors.textSecondary)),
                    ],
                    const SizedBox(height: 14),
                    AnimatedSceneWidget(
                      sceneId: sceneId,
                      title: sceneTitle(l10n, sceneId),
                      height: (MediaQuery.sizeOf(context).height * 0.2).clamp(120.0, 180.0),
                      showTimeToggle: false,
                      child: plan.characterName.isEmpty ? null : Center(child: CharacterBadge(name: plan.characterName, speaking: false, size: 60)),
                    ),
                    const SizedBox(height: 18),
                    for (var i = 0; i < stops.length; i++)
                      _StopTile(
                        number: i + 1,
                        title: describe(stops[i]).title,
                        subtitle: describe(stops[i]).subtitle,
                        icon: describe(stops[i]).icon,
                        done: done.contains(stops[i]),
                        isNext: stops[i] == next,
                        isFirst: i == 0,
                        isLast: i == stops.length - 1 && !lockedTalk,
                        onTap: () => context.push(routeFor(missionKey, stops[i])),
                      ),
                    // Signed out on a course with live calls: the Talk stop, locked, opens the account (sign up is free).
                    if (lockedTalk)
                      _StopTile(
                        number: stops.length + 1,
                        title: l10n.stopTalk,
                        subtitle: plan.characterName.isEmpty ? l10n.pathTalkLockedNoName : l10n.pathTalkLocked(plan.characterName),
                        icon: LucideIcons.lock,
                        done: false,
                        isNext: false,
                        isFirst: false,
                        isLast: true,
                        onTap: () => context.push('/account'),
                      ),
                    if (extras.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      Text(l10n.pathMoreWays, style: displayStyle(size: 16, color: colors.textPrimary, bold: false)),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [for (final extra in extras) _ExtraChip(icon: extra.icon, label: extra.label, onTap: () => context.push(extra.route))],
                      ),
                    ],
                  ],
                ),
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
                        Flexible(
                          child: Text(
                            l10n.pathComplete,
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: colors.success),
                          ),
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

/// One step of the mission: its number on the line (a check once done), what it is, and what it holds.
class _StopTile extends ConsumerWidget {
  final int number;
  final String title;
  final String subtitle;
  final IconData icon;
  final bool done;
  final bool isNext;
  final bool isFirst;
  final bool isLast;
  final VoidCallback onTap;

  const _StopTile({
    required this.number,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.done,
    required this.isNext,
    required this.isFirst,
    required this.isLast,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final line = done ? colors.success.withValues(alpha: 0.55) : colors.border;
    const nodeSize = 40.0;
    const pad = 10.0;
    return Semantics(
      button: true,
      label:
          '$number. $title. $subtitle${done
              ? '. ${l10n.pathDoneSemantics}'
              : isNext
              ? '. ${l10n.pathNextSemantics}'
              : ''}',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Stack(
          children: [
            // The line the steps sit on, lit as far as the learner has come.
            if (!isFirst)
              PositionedDirectional(
                start: pad + nodeSize / 2 - 1,
                top: 0,
                height: pad,
                child: Container(width: 2, color: line),
              ),
            if (!isLast)
              PositionedDirectional(
                start: pad + nodeSize / 2 - 1,
                top: pad + nodeSize,
                bottom: 0,
                child: Container(width: 2, color: line),
              ),
            Container(
              constraints: const BoxConstraints(minHeight: 64),
              padding: const EdgeInsets.all(pad),
              decoration: BoxDecoration(
                color: isNext ? accent.primarySoft : Colors.transparent,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: isNext ? accent.primary.withValues(alpha: 0.7) : Colors.transparent, width: 1.5),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: nodeSize,
                    height: nodeSize,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: done ? colors.success : (isNext ? accent.primary : colors.surfaceMuted),
                      boxShadow: isNext ? [BoxShadow(color: accent.primary.withValues(alpha: 0.5), blurRadius: 14)] : null,
                    ),
                    alignment: Alignment.center,
                    child: done
                        ? Icon(LucideIcons.check, size: 20, color: colors.background)
                        : Icon(icon, size: 18, color: isNext ? accent.onPrimary : colors.textMuted),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, color: colors.textPrimary),
                          ),
                          if (subtitle.isNotEmpty)
                            Text(
                              subtitle,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 13.5, height: 1.3, color: colors.textSecondary),
                            ),
                        ],
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 11),
                    child: Icon(LucideIcons.chevronRight, size: 18, color: isNext ? accent.primaryText : colors.textMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Another way to work on the mission's phrases (say them, hear them).
class _ExtraChip extends ConsumerWidget {
  const _ExtraChip({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: colors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 17, color: accent.primaryText),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: colors.textPrimary),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Exposed for tests: whether a plan has the teaching block that makes Learn/Practise stops appear.
bool planHasLearnStops(MissionLearnPlan plan) => plan.sceneLines.isNotEmpty && plan.phrases.isNotEmpty;

/// The stops of [plan]'s mission, in order: Learn and Practise when it has a teaching block, Play when it has
/// enough phrases for a round, the mission itself, and Talk when a live partner backs it ([canTalk]).
List<PathStop> stopsOfPlan(MissionLearnPlan plan, {bool canTalk = false}) =>
    stopsFor(hasLearnPlan: planHasLearnStops(plan), canPlay: planHasGame(plan), canTalk: canTalk);
