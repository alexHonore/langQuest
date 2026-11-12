import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_bundle.dart' show Course;
import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../course_switcher/course_switcher_sheet.dart';
import '../games/game_pool.dart';
import '../learn/learn_logic.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/mission_path_screen.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import '../missions/missions_screen.dart';
import '../scenes/animated_scene.dart';

/// Home stays minimal (owner direction from the first device walkthrough): the course, the streak, the one next
/// thing to do, and the review queue once there is something in it. No greeting heading, no quick-speak.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final course = appState.activeCourse;
    if (course == null) return const SizedBox.shrink();
    final accent = appState.accent;
    final colors = appState.colors;
    final now = ref.watch(clockProvider)();
    final next = appState.nextMission(course);
    final streak = appState.streak(now);
    final cards = appState.progress.cards.values.toList();

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          // Ambient lantern bloom (U2 Night Market), tinted by the course.
          Positioned(
            top: -140,
            left: -120,
            child: LanternBloom(color: accent.lantern[0].withValues(alpha: appState.isDark ? 0.30 : 0.16), size: 420),
          ),
          Positioned(
            top: 260,
            right: -160,
            child: LanternBloom(color: accent.lantern[1].withValues(alpha: appState.isDark ? 0.22 : 0.12), size: 400),
          ),
          SafeArea(
            bottom: false,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 110),
              children: [
                _TopBar(course: course, streak: streak),
                const SizedBox(height: 18),
                if (next != null) _NextMissionCard(course: course, mission: next) else const _ChapterDoneCard(),
                if (cards.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  _ReviewCard(due: appState.dueCards(now).length, nextDue: cards.map((c) => c.due).reduce((a, b) => a.isBefore(b) ? a : b), now: now),
                ],
                // The games, once there is enough to play with (the phrases of a first Learn stop).
                if (ref.watch(gamesAvailableProvider)) ...[const SizedBox(height: 14), _PlayCard(phrases: ref.watch(gamePoolProvider).length)],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TopBar extends ConsumerWidget {
  final Course course;
  final int streak;
  const _TopBar({required this.course, required this.streak});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    return Row(
      children: [
        Expanded(
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: Semantics(
              button: true,
              label: '${l10n.switchCourse}: ${course.track.name(appState.uiLanguage)}',
              excludeSemantics: true,
              child: GlassContainer(
                level: GlassLevel.level2,
                radius: 24,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                customGlow: accent.primary.withValues(alpha: 0.25),
                onTap: () => showCourseSwitcher(context),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 22,
                      height: 22,
                      decoration: BoxDecoration(color: accent.primary, shape: BoxShape.circle),
                      child: Icon(LucideIcons.globe, size: 13, color: accent.onPrimary),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        course.track.name(appState.uiLanguage),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Icon(LucideIcons.chevronDown, size: 15, color: colors.textMuted),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        if (streak > 0) ...[
          Semantics(
            label: l10n.streakDays(streak),
            excludeSemantics: true,
            child: GlassContainer(
              level: GlassLevel.level1,
              radius: 20,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.flame, color: colors.amber, size: 16),
                  const SizedBox(width: 5),
                  Text(
                    '$streak',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.amberText),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
        Semantics(
          button: true,
          label: l10n.settings,
          excludeSemantics: true,
          child: GlassContainer(
            level: GlassLevel.level1,
            radius: 22,
            // 44 × 44: a comfortable target for a finger.
            padding: const EdgeInsets.all(12),
            onTap: () => context.push('/account'),
            child: Icon(LucideIcons.settings, size: 20, color: colors.textSecondary),
          ),
        ),
      ],
    );
  }
}

class _NextMissionCard extends ConsumerWidget {
  final Course course;
  final Mission mission;
  const _NextMissionCard({required this.course, required this.mission});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final plan = ref.watch(learnPlanProvider(mission.key));
    if (plan == null) return const SizedBox.shrink();
    final stops = stopsOfPlan(plan);
    final done = appState.stopsDone(mission.key);
    final nextStopValue = nextStop(stops, done) ?? PathStop.mission;
    final index = course.indexOfMission(mission.key);
    final sceneId = sceneIdForMission(mission);
    final title = mission.titleIn(course.source) ?? '';
    void open() => context.push('/path/${mission.key}');

    return Semantics(
      button: true,
      label: '${l10n.homeNextMission}. $title. ${l10n.homeNextStop(stopLabel(l10n, nextStopValue))}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: open,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: accent.primary.withValues(alpha: 0.6), width: 1.5),
            boxShadow: [BoxShadow(color: accent.primary.withValues(alpha: appState.isDark ? 0.30 : 0.16), blurRadius: 24, spreadRadius: 2)],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(23),
            child: Container(
              color: colors.elevated,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AnimatedSceneWidget(
                    sceneId: sceneId,
                    title: sceneTitle(l10n, sceneId),
                    height: 150,
                    showTimeToggle: false,
                    child: Positioned(
                      right: 10,
                      bottom: 4,
                      child: MeloWidget(state: MeloState.welcome, courseTrackId: appState.activeTrackId, size: 64),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(LucideIcons.sparkles, size: 14, color: accent.primaryText),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                '${l10n.homeNextMission} · ${l10n.missionLabel(index + 1)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: accent.primaryText),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(title, style: displayStyle(size: 21, color: colors.textPrimary)),
                        if (mission.sceneNoteIn(course.source) case final note?) ...[
                          const SizedBox(height: 4),
                          Text(
                            note,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 13.5, height: 1.35, color: colors.textSecondary),
                          ),
                        ],
                        const SizedBox(height: 12),
                        StopDots(stops: stops, done: done),
                        const SizedBox(height: 14),
                        LearnPrimaryButton(
                          label: done.isEmpty ? l10n.pathStartStop(stopLabel(l10n, nextStopValue)) : l10n.pathContinueStop(stopLabel(l10n, nextStopValue)),
                          icon: LucideIcons.play,
                          onPressed: open,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ChapterDoneCard extends ConsumerWidget {
  const _ChapterDoneCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    return GlassContainer(
      level: GlassLevel.level2,
      radius: 22,
      padding: const EdgeInsets.all(18),
      child: Row(
        children: [
          MeloWidget(state: MeloState.celebrate, courseTrackId: appState.activeTrackId, size: 72),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.homeChapterDone,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: colors.textPrimary),
                ),
                const SizedBox(height: 4),
                Text(l10n.homeChapterDoneBody, style: TextStyle(fontSize: 13.5, height: 1.35, color: colors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReviewCard extends ConsumerWidget {
  final int due;
  final DateTime nextDue;
  final DateTime now;
  const _ReviewCard({required this.due, required this.nextDue, required this.now});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final local = nextDue.toLocal();
    final sameDay = local.year == now.year && local.month == now.month && local.day == now.day;
    final when = sameDay ? DateFormat.Hm(locale).format(local) : DateFormat.MMMEd(locale).format(local);
    final subtitle = due > 0 ? l10n.reviewsDue(due) : l10n.nextReviewAt(when);
    return Semantics(
      button: due > 0,
      label: '${l10n.homeReviewTitle}. $subtitle',
      excludeSemantics: true,
      child: GlassContainer(
        level: GlassLevel.level2,
        radius: 18,
        padding: const EdgeInsets.all(14),
        customGlow: due > 0 ? colors.amber.withValues(alpha: 0.5) : null,
        onTap: due > 0 ? () => context.push('/review') : null,
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(color: colors.amber.withValues(alpha: 0.16), shape: BoxShape.circle),
              child: Icon(LucideIcons.layers, size: 18, color: colors.amberText),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.homeReviewTitle,
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                  ),
                  Text(subtitle, style: TextStyle(fontSize: 12.5, color: colors.textSecondary)),
                ],
              ),
            ),
            if (due > 0) Icon(LucideIcons.chevronRight, size: 18, color: colors.textMuted),
          ],
        ),
      ),
    );
  }
}

/// The way to the mini-games: the phrases already taught, another way.
class _PlayCard extends ConsumerWidget {
  final int phrases;
  const _PlayCard({required this.phrases});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final tint = appState.accent.lantern[1];
    return Semantics(
      button: true,
      label: '${l10n.gamesTitle}. ${l10n.homeGamesBody(phrases)}',
      excludeSemantics: true,
      child: GlassContainer(
        level: GlassLevel.level2,
        radius: 18,
        padding: const EdgeInsets.all(14),
        onTap: () => context.go('/play'),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(color: tint.withValues(alpha: 0.16), shape: BoxShape.circle),
              child: Icon(LucideIcons.gamepad2, size: 18, color: tint),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.gamesTitle,
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                  ),
                  Text(l10n.homeGamesBody(phrases), style: TextStyle(fontSize: 12.5, color: colors.textSecondary)),
                ],
              ),
            ),
            Icon(LucideIcons.chevronRight, size: 18, color: colors.textMuted),
          ],
        ),
      ),
    );
  }
}

/// Opens the course switcher sheet (Home's course chip).
void showCourseSwitcher(BuildContext context) {
  showModalBottomSheet(context: context, isScrollControlled: true, backgroundColor: Colors.transparent, builder: (_) => const CourseSwitcherSheet());
}
