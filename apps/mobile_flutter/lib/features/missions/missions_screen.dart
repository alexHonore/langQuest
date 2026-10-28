import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';

class MissionsScreen extends ConsumerWidget {
  const MissionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          // Background subtle lantern glow
          Positioned(
            top: 100,
            right: -60,
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: accent.primary.withOpacity(0.12),
              ),
            ),
          ),

          SafeArea(
            bottom: false,
            child: CustomScrollView(
              physics: const BouncingScrollPhysics(),
              slivers: [
                // Header
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'LEARNING PATHWAY',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.2,
                                color: accent.primaryText,
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: accent.primarySoft,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                'Chapter 1 · Foundations',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w600,
                                  color: accent.primaryText,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '${appState.activeTrack.displayName} Journey',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                            color: colors.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // Winding Path of Missions
                SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final mission = appState.missions[index];
                      final isLast = index == appState.missions.length - 1;

                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Node Indicator and Connecting Line
                            Column(
                              children: [
                                // Glowing Node
                                GestureDetector(
                                  onTap: () => context.push('/path/${mission.id}'),
                                  child: Container(
                                    width: 44,
                                    height: 44,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: mission.completed
                                          ? const Color(0xFF45E0A6)
                                          : mission.isNext
                                              ? accent.primary
                                              : colors.elevated,
                                      border: Border.all(
                                        color: mission.isNext
                                            ? Colors.white
                                            : mission.completed
                                                ? const Color(0xFF45E0A6)
                                                : Colors.white24,
                                        width: mission.isNext ? 2.5 : 1.5,
                                      ),
                                      boxShadow: mission.isNext
                                          ? [
                                              BoxShadow(
                                                color: accent.primary.withOpacity(0.55),
                                                blurRadius: 16,
                                                spreadRadius: 2,
                                              ),
                                            ]
                                          : null,
                                    ),
                                    child: Center(
                                      child: Icon(
                                        mission.completed
                                            ? LucideIcons.check
                                            : mission.isNext
                                                ? LucideIcons.play
                                                : LucideIcons.lock,
                                        size: 20,
                                        color: mission.completed || mission.isNext
                                            ? Colors.white
                                            : colors.textMuted,
                                      ),
                                    ),
                                  ),
                                ),
                                // Connecting vertical dashed/solid line
                                if (!isLast)
                                  Container(
                                    width: 2.5,
                                    height: 72,
                                    color: mission.completed
                                        ? const Color(0xFF45E0A6).withOpacity(0.6)
                                        : Colors.white12,
                                  ),
                              ],
                            ),
                            const SizedBox(width: 16),

                            // Mission Card
                            Expanded(
                              child: GestureDetector(
                                onTap: () => context.push('/path/${mission.id}'),
                                child: Container(
                                  margin: const EdgeInsets.only(bottom: 24),
                                  child: GlassContainer(
                                    level: mission.isNext ? GlassLevel.level2 : GlassLevel.level1,
                                    radius: 18,
                                    padding: const EdgeInsets.all(16),
                                    customGlow:
                                        mission.isNext ? accent.primary.withOpacity(0.25) : null,
                                    border: mission.isNext
                                        ? Border.all(color: accent.primary.withOpacity(0.6))
                                        : null,
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            Text(
                                              'MISSION ${index + 1}',
                                              style: TextStyle(
                                                fontSize: 11,
                                                fontWeight: FontWeight.w700,
                                                letterSpacing: 1.0,
                                                color: mission.isNext
                                                    ? accent.primaryText
                                                    : colors.textMuted,
                                              ),
                                            ),
                                            Text(
                                              '${mission.minutes} min',
                                              style: TextStyle(
                                                fontSize: 12,
                                                color: colors.textMuted,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          mission.title,
                                          style: TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w700,
                                            color: colors.textPrimary,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          mission.description,
                                          style: TextStyle(
                                            fontSize: 13,
                                            color: colors.textSecondary,
                                          ),
                                        ),
                                        const SizedBox(height: 10),
                                        _StopDots(
                                          stops: stopsFor(hasLearnPlan: LearnContent.forMission(mission.id) != null),
                                          done: appState.stopsDone(mission.id),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                    childCount: appState.missions.length,
                  ),
                ),

                const SliverToBoxAdapter(
                  child: SizedBox(height: 120),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One dot per learn-path stop (learn · practise · mission · talk), filled when done.
class _StopDots extends ConsumerWidget {
  final List<PathStop> stops;
  final Set<PathStop> done;
  const _StopDots({required this.stops, required this.done});

  static String _label(PathStop s) => switch (s) {
        PathStop.learn => 'Learn',
        PathStop.practise => 'Practise',
        PathStop.mission => 'Mission',
        PathStop.talk => 'Talk',
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final next = nextStop(stops, done);
    return Semantics(
      label: '${done.where(stops.contains).length} of ${stops.length} steps done',
      excludeSemantics: true,
      child: Row(children: [
        for (final stop in stops) ...[
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: done.contains(stop) ? colors.success : stop == next ? appState.accent.primary : colors.border,
            ),
          ),
          const SizedBox(width: 4),
          Text(_label(stop), style: TextStyle(fontSize: 11, color: stop == next ? appState.accent.primaryText : colors.textMuted)),
          const SizedBox(width: 10),
        ],
      ]),
    );
  }
}
