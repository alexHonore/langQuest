import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/server_voice.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../learn/learn_widgets.dart';
import 'game_logic.dart';
import 'game_pool.dart';
import 'game_widgets.dart';

/// Pairs on a Lantern pairs board (fewer while the learner has fewer phrases).
const memoryPairs = 6;

/// What a round of each game needs: enough phrases, and for some, phrases of a kind.
const minEarPhrases = 4;
const minDashSentences = 3;

/// The phrases of the pool that can be said here (their bundled clip, or a voice for the course).
final audiblePoolProvider = Provider.autoDispose<List<GamePhrase>>((ref) {
  final pool = ref.watch(gamePoolProvider);
  final locale = ref.watch(appStateProvider.select((s) => s.activeCourse?.track.voiceLocale));
  final voice = ref.watch(lineVoiceNowProvider(locale));
  if (voice == null) return const [];
  return [
    for (final p in pool)
      if (voice.canSay(expressionId: p.expression.id)) p,
  ];
});

/// The games that can be played now, in the order they are offered. A game that lacks what it needs (a voice for
/// By ear, sentences long enough for Sentence dash) is not listed (visible means usable).
final playableGamesProvider = Provider.autoDispose<List<GameKind>>((ref) {
  final pool = ref.watch(gamePoolProvider);
  if (pool.length < minGamePhrases) return const [];
  return [
    GameKind.memory,
    GameKind.quick,
    if (ref.watch(audiblePoolProvider).length >= minEarPhrases) GameKind.ear,
    if (pool.where((p) => canDash(p.item)).length >= minDashSentences) GameKind.dash,
  ];
});

/// The games: another way to meet the phrases already taught. Each card says what the game asks and the learner's
/// record in it. Opened from Home and from a mission's page, once there is enough to play with.
class GamesHubScreen extends ConsumerWidget {
  const GamesHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final course = appState.activeCourse;
    final pool = ref.watch(gamePoolProvider);
    final games = ref.watch(playableGamesProvider);
    if (course == null || games.isEmpty) return const _NothingToPlay();
    final stats = ref.watch(gameStatsProvider.notifier);
    ref.watch(gameStatsProvider);

    String? bestOf(GameKind kind) {
      final best = switch (kind) {
        GameKind.memory => stats.recordOf(course.id, kind, variant: '${pool.length < memoryPairs ? pool.length : memoryPairs}').best,
        _ => stats.recordOf(course.id, kind).best,
      };
      if (best == null) return null;
      return switch (kind) {
        GameKind.memory => l10n.gameBestMoves(best),
        GameKind.quick => l10n.gameBestRight(best),
        GameKind.ear => l10n.gameBestRight(best),
        GameKind.dash => l10n.gameBestTime(gameClock(best)),
      };
    }

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          Positioned(
            top: -160,
            left: -140,
            child: LanternBloom(color: colors.amber.withValues(alpha: appState.isDark ? 0.22 : 0.12), size: 420),
          ),
          SafeArea(
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
                    ],
                  ),
                ),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    children: [
                      Semantics(
                        header: true,
                        child: Text(l10n.gamesTitle, style: displayStyle(size: 30, color: colors.textPrimary)),
                      ),
                      const SizedBox(height: 6),
                      Text(l10n.gamesBody(pool.length), style: TextStyle(fontSize: 15, height: 1.4, color: colors.textSecondary)),
                      const SizedBox(height: 18),
                      for (final kind in games)
                        _GameCard(
                          kind: kind,
                          pitch: switch (kind) {
                            GameKind.memory => l10n.gameMemoryPitch,
                            GameKind.quick => l10n.gameQuickPitch,
                            GameKind.ear => l10n.gameEarPitch,
                            GameKind.dash => l10n.gameDashPitch,
                          },
                          best: bestOf(kind),
                          onTap: () => context.push('/play/${kind.id}'),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GameCard extends ConsumerWidget {
  const _GameCard({required this.kind, required this.pitch, required this.best, required this.onTap});

  final GameKind kind;
  final String pitch;
  final String? best;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final look = gameLook(kind);
    final tint = look.color(appState);
    final name = gameName(l10n, kind);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Semantics(
        button: true,
        label: '$name. $pitch${best == null ? '' : '. $best'}',
        excludeSemantics: true,
        child: Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(22),
          child: InkWell(
            borderRadius: BorderRadius.circular(22),
            onTap: onTap,
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: colors.border),
              ),
              child: Row(
                children: [
                  // The game's lantern.
                  Container(
                    width: 60,
                    height: 60,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: tint.withValues(alpha: 0.16),
                      boxShadow: [BoxShadow(color: tint.withValues(alpha: 0.28), blurRadius: 18)],
                    ),
                    child: Icon(look.icon, size: 27, color: tint),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: displayStyle(size: 18.5, color: colors.textPrimary)),
                        const SizedBox(height: 3),
                        Text(pitch, style: TextStyle(fontSize: 13.5, height: 1.35, color: colors.textSecondary)),
                        if (best != null) ...[
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Icon(LucideIcons.trophy, size: 13, color: colors.amberText),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  best!,
                                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: colors.amberText),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(LucideIcons.play, size: 20, color: colors.textMuted),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A link to the games opened before anything was taught (or after a reset): the way to the first lesson.
class _NothingToPlay extends ConsumerWidget {
  const _NothingToPlay();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(LucideIcons.gamepad2, size: 40, color: colors.textMuted),
                const SizedBox(height: 12),
                Text(
                  l10n.gamesNeedPhrases,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, height: 1.4, color: colors.textPrimary),
                ),
                const SizedBox(height: 20),
                LearnPrimaryButton(label: l10n.backHome, onPressed: () => context.go('/')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
