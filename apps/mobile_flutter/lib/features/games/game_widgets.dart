import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/layout/celebration.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_state.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../learn/learn_widgets.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import 'game_logic.dart';

/// How each game is shown: its icon and the lantern it is lit with (the course's colour, then Night Market's
/// saffron, cyan and magenta, which tell the four apart whatever the course).
({IconData icon, Color Function(AppState) color}) gameLook(GameKind kind) => switch (kind) {
  GameKind.memory => (icon: LucideIcons.lampCeiling, color: (s) => s.accent.primaryText),
  GameKind.quick => (icon: LucideIcons.zap, color: (s) => s.colors.amberText),
  GameKind.ear => (icon: LucideIcons.ear, color: (s) => s.colors.cyanText),
  GameKind.dash => (icon: LucideIcons.timer, color: (s) => s.colors.success),
};

String gameName(AppLocalizations l10n, GameKind kind) => switch (kind) {
  GameKind.memory => l10n.gameMemoryName,
  GameKind.quick => l10n.gameQuickName,
  GameKind.ear => l10n.gameEarName,
  GameKind.dash => l10n.gameDashName,
};

/// `m:ss`, for the clock of a round.
String gameClock(int seconds) => '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';

/// The frame of every game: close, the game's name, and what counts in it (moves, time, score) on the right.
class GameScaffold extends ConsumerWidget {
  const GameScaffold({super.key, required this.kind, required this.child, this.status});

  final GameKind kind;
  final Widget child;

  /// What counts in this game, kept in view while playing.
  final Widget? status;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 16, 4),
              child: Row(
                children: [
                  IconButton(
                    icon: Icon(LucideIcons.x, color: colors.textSecondary),
                    tooltip: l10n.close,
                    onPressed: () => context.popOrHome(),
                  ),
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text(
                        gameName(l10n, kind),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: displayStyle(size: 18, color: colors.textPrimary, bold: false),
                      ),
                    ),
                  ),
                  ?status,
                ],
              ),
            ),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

/// A number that counts in a game (moves, time, right answers), with its icon.
class GameStatus extends ConsumerWidget {
  const GameStatus({super.key, required this.icon, required this.value, required this.semantics});

  final IconData icon;
  final String value;
  final String semantics;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Semantics(
      label: semantics,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(16)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: colors.textSecondary),
            const SizedBox(width: 6),
            Text(
              value,
              style: displayStyle(size: 15, color: colors.textPrimary).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ],
        ),
      ),
    );
  }
}

/// Before a round: what the game asks, and the button that starts it.
class GameIntro extends ConsumerWidget {
  const GameIntro({super.key, required this.kind, required this.rules, required this.onStart, this.best});

  final GameKind kind;
  final String rules;

  /// The learner's record in this game, when there is one.
  final String? best;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final look = gameLook(kind);
    final tint = look.color(appState);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Column(
        children: [
          Expanded(
            child: Center(
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 96,
                      height: 96,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: tint.withValues(alpha: 0.16),
                        boxShadow: [BoxShadow(color: tint.withValues(alpha: 0.35), blurRadius: 34)],
                      ),
                      child: Icon(look.icon, size: 42, color: tint),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      gameName(l10n, kind),
                      textAlign: TextAlign.center,
                      style: displayStyle(size: 28, color: colors.textPrimary),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      rules,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 16, height: 1.45, color: colors.textSecondary),
                    ),
                    if (best != null) ...[
                      const SizedBox(height: 14),
                      Text(
                        best!,
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: colors.amberText),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          LearnPrimaryButton(label: l10n.gameStart, icon: LucideIcons.play, onPressed: onStart),
        ],
      ),
    );
  }
}

/// The end of a round: what it came to, the record, and another round.
class GameResult extends ConsumerWidget {
  const GameResult({
    super.key,
    required this.headline,
    required this.onAgain,
    this.detail,
    this.best,
    this.record = false,
    this.xp = false,
    this.children = const [],
    this.onStartMission,
  });

  final String headline;
  final String? detail;

  /// The round was a mission's Play stop: the way on is the mission itself (another round stays possible).
  final VoidCallback? onStartMission;

  /// The learner's record in this game.
  final String? best;

  /// This round beat the record.
  final bool record;

  /// This round was the day's first of the game: it earned XP.
  final bool xp;

  /// What to look at again (phrases missed in the round).
  final List<Widget> children;
  final VoidCallback onAgain;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    return Stack(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Column(
            children: [
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        MeloWidget(
                          state: MeloState.celebrate,
                          courseTrackId: appState.activeTrackId,
                          size: 96,
                        ).withMotion(context, (a) => a.scale(begin: const Offset(0.6, 0.6), duration: 600.ms, curve: Curves.elasticOut)),
                        const SizedBox(height: 14),
                        Semantics(
                          header: true,
                          liveRegion: true,
                          child: Text(
                            headline,
                            textAlign: TextAlign.center,
                            style: displayStyle(size: 26, color: colors.textPrimary),
                          ),
                        ),
                        if (detail != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            detail!,
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 15.5, height: 1.4, color: colors.textSecondary),
                          ),
                        ],
                        if (record) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                            decoration: BoxDecoration(color: colors.amber.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(16)),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(LucideIcons.trophy, size: 16, color: colors.amberText),
                                const SizedBox(width: 8),
                                Flexible(
                                  child: Text(
                                    l10n.gameNewRecord,
                                    style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: colors.amberText),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ] else if (best != null) ...[
                          const SizedBox(height: 10),
                          Text(
                            best!,
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 14, color: colors.textMuted),
                          ),
                        ],
                        if (xp) ...[
                          const SizedBox(height: 10),
                          CountUp(
                            value: XpAmounts.stepCompleted,
                            builder: (context, value) => Text(l10n.xpGain(value), style: displayStyle(size: 18, color: accent.primaryText)),
                          ),
                        ],
                        if (children.isNotEmpty) ...[const SizedBox(height: 18), ...children],
                      ],
                    ),
                  ),
                ),
              ),
              if (onStartMission case final start?) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    l10n.gameMissionDetail,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14.5, height: 1.35, color: colors.textSecondary),
                  ),
                ),
                LearnPrimaryButton(label: l10n.startMission, icon: LucideIcons.flag, onPressed: start),
                TextButton(
                  style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                  onPressed: onAgain,
                  child: Text(
                    l10n.gamePlayAgain,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: accent.primaryText),
                  ),
                ),
              ] else ...[
                LearnPrimaryButton(label: l10n.gamePlayAgain, icon: LucideIcons.rotateCcw, onPressed: onAgain),
                TextButton(
                  style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                  onPressed: () => context.canPop() ? context.pop() : context.go('/play'),
                  child: Text(
                    l10n.gameBackToGames,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: accent.primaryText),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (record) Positioned.fill(child: ConfettiBurst(colors: [accent.primary, colors.celebrationB, colors.celebrationC, colors.success])),
      ],
    );
  }
}

/// A phrase missed in a round, to look at again: how it is written, what it means, and how it sounds.
class GameMissedRow extends ConsumerWidget {
  const GameMissedRow({super.key, required this.child, required this.meaning, this.listen});

  /// The phrase in the course's script.
  final Widget child;
  final String meaning;
  final Widget? listen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                child,
                const SizedBox(height: 2),
                Text(meaning, style: TextStyle(fontSize: 13.5, color: colors.textSecondary)),
              ],
            ),
          ),
          ?listen,
        ],
      ),
    );
  }
}
