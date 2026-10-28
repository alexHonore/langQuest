import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';
import '../course_switcher/course_switcher_sheet.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import '../scenes/animated_scene.dart';
import '../scenes/scene_models.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;
    final nextMission = appState.missions.firstWhere(
      (m) => m.isNext,
      orElse: () => appState.missions.first,
    );

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          // 1. Dynamic Ambient Lantern Bloom Background
          Positioned(
            top: -100,
            left: -80,
            child: Container(
              width: 320,
              height: 320,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: accent.lantern[0].withOpacity(0.18),
              ),
            ),
          ),
          Positioned(
            top: 240,
            right: -100,
            child: Container(
              width: 280,
              height: 280,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: accent.lantern[1].withOpacity(0.14),
              ),
            ),
          ),

          // 2. Main Scrollable View
          SafeArea(
            bottom: false,
            child: CustomScrollView(
              physics: const BouncingScrollPhysics(),
              slivers: [
                // Top Header App Bar
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // Active Course Badge (Tap to switch course)
                        GestureDetector(
                          onTap: () {
                            showModalBottomSheet(
                              context: context,
                              isScrollControlled: true,
                              backgroundColor: Colors.transparent,
                              builder: (_) => const CourseSwitcherSheet(),
                            );
                          },
                          child: GlassContainer(
                            level: GlassLevel.level2,
                            radius: 24,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            customGlow: accent.primary.withOpacity(0.25),
                            child: Row(
                              children: [
                                Container(
                                  width: 22,
                                  height: 22,
                                  decoration: BoxDecoration(
                                    color: accent.primary,
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Center(
                                    child: Icon(
                                      LucideIcons.globe,
                                      size: 13,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  appState.activeTrack.displayName,
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                    color: colors.textPrimary,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Icon(
                                  LucideIcons.chevronDown,
                                  size: 15,
                                  color: colors.textMuted,
                                ),
                              ],
                            ),
                          ),
                        ),

                        // Streak and Account Buttons
                        Row(
                          children: [
                            // Daily Streak Flame
                            GlassContainer(
                              level: GlassLevel.level1,
                              radius: 20,
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              child: Row(
                                children: [
                                  const Icon(
                                    LucideIcons.flame,
                                    color: Color(0xFFFFB547),
                                    size: 16,
                                  ),
                                  const SizedBox(width: 5),
                                  Text(
                                    '${appState.streakDays}d',
                                    style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700,
                                      color: Color(0xFFFFB547),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            // Settings / Profile
                            GestureDetector(
                              onTap: () => context.push('/account'),
                              child: GlassContainer(
                                level: GlassLevel.level1,
                                radius: 20,
                                padding: const EdgeInsets.all(8),
                                child: Icon(
                                  LucideIcons.settings,
                                  size: 18,
                                  color: colors.textSecondary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),

                // Melo Companion with Speech Bubble
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                    child: MeloWidget(
                      state: MeloState.welcome,
                      courseTrackId: appState.activeTrackId,
                      speech: 'Bonjour ! Ready to practice polite café phrases today?',
                      size: 88,
                    ),
                  ),
                ),

                // Primary Next Mission Card (Glowing Neon Frame)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(LucideIcons.sparkles, size: 16, color: accent.primaryText),
                            const SizedBox(width: 8),
                            Text(
                              'NEXT SPEAKABLE MISSION',
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.1,
                                color: accent.primaryText,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),

                        // Glowing Interactive Card
                        GestureDetector(
                          onTap: () => context.push('/path/${nextMission.id}'),
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(24),
                              border: Border.all(
                                color: accent.primary.withOpacity(0.6),
                                width: 1.5,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: accent.primary.withOpacity(0.30),
                                  blurRadius: 24,
                                  spreadRadius: 2,
                                ),
                              ],
                            ),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(23),
                              child: Container(
                                color: colors.elevated,
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    // Animated Scene Preview
                                    AnimatedSceneWidget(
                                      sceneId: SceneId.cafe,
                                      height: 160,
                                      showTimeToggle: true,
                                    ),

                                    // Mission details
                                    Padding(
                                      padding: const EdgeInsets.all(16),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                            children: [
                                              Row(
                                                children: [
                                                  Icon(
                                                    LucideIcons.clock,
                                                    size: 13,
                                                    color: colors.textMuted,
                                                  ),
                                                  const SizedBox(width: 5),
                                                  Text(
                                                    '${nextMission.minutes} mins · Next: ${_nextStopLabel(appState, nextMission.id)}',
                                                    style: TextStyle(
                                                      fontSize: 12,
                                                      fontWeight: FontWeight.w500,
                                                      color: colors.textMuted,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                              Container(
                                                padding: const EdgeInsets.symmetric(
                                                    horizontal: 8, vertical: 3),
                                                decoration: BoxDecoration(
                                                  color: accent.primarySoft,
                                                  borderRadius: BorderRadius.circular(8),
                                                ),
                                                child: Text(
                                                  '+25 XP',
                                                  style: TextStyle(
                                                    fontSize: 11.5,
                                                    fontWeight: FontWeight.w700,
                                                    color: accent.primaryText,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 8),
                                          Text(
                                            nextMission.title,
                                            style: TextStyle(
                                              fontSize: 18,
                                              fontWeight: FontWeight.w700,
                                              color: colors.textPrimary,
                                            ),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            nextMission.description,
                                            style: TextStyle(
                                              fontSize: 13.5,
                                              color: colors.textSecondary,
                                              height: 1.35,
                                            ),
                                          ),
                                          const SizedBox(height: 14),

                                          // Skills tags
                                          Wrap(
                                            spacing: 6,
                                            runSpacing: 6,
                                            children: nextMission.skills.map((skill) {
                                              return Container(
                                                padding: const EdgeInsets.symmetric(
                                                    horizontal: 8, vertical: 4),
                                                decoration: BoxDecoration(
                                                  color: const Color(0x18FFFFFF),
                                                  borderRadius: BorderRadius.circular(8),
                                                ),
                                                child: Text(
                                                  '# ${skill.replaceAll('_', ' ')}',
                                                  style: TextStyle(
                                                    fontSize: 11,
                                                    fontWeight: FontWeight.w500,
                                                    color: colors.textSecondary,
                                                  ),
                                                ),
                                              );
                                            }).toList(),
                                          ),
                                          const SizedBox(height: 16),

                                          // Start Mission Glowing Button
                                          Container(
                                            width: double.infinity,
                                            height: 48,
                                            decoration: BoxDecoration(
                                              gradient: LinearGradient(
                                                colors: [
                                                  accent.primary,
                                                  accent.primaryStrong,
                                                ],
                                              ),
                                              borderRadius: BorderRadius.circular(16),
                                              boxShadow: [
                                                BoxShadow(
                                                  color: accent.primary.withOpacity(0.45),
                                                  blurRadius: 16,
                                                  spreadRadius: 1,
                                                ),
                                              ],
                                            ),
                                            child: Row(
                                              mainAxisAlignment: MainAxisAlignment.center,
                                              children: [
                                                const Icon(
                                                  LucideIcons.play,
                                                  size: 18,
                                                  color: Colors.white,
                                                ),
                                                const SizedBox(width: 8),
                                                Text(
                                                  'Start Mission',
                                                  style: TextStyle(
                                                    fontSize: 15,
                                                    fontWeight: FontWeight.w700,
                                                    color: accent.onPrimary,
                                                  ),
                                                ),
                                              ],
                                            ),
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
                      ],
                    ),
                  ),
                ),

                // Quick Action Buttons Row (Quick Speak, Reviews Due, Audio)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                    child: Row(
                      children: [
                        // Quick Speak
                        Expanded(
                          child: GestureDetector(
                            onTap: () => context.push('/speak'),
                            child: GlassContainer(
                              level: GlassLevel.level2,
                              radius: 18,
                              padding: const EdgeInsets.all(14),
                              customGlow: const Color(0xFF3EE1E8).withOpacity(0.2),
                              child: Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(8),
                                    decoration: const BoxDecoration(
                                      color: Color(0x223EE1E8),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      LucideIcons.mic,
                                      size: 18,
                                      color: Color(0xFF3EE1E8),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Quick Speak',
                                        style: TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w700,
                                          color: colors.textPrimary,
                                        ),
                                      ),
                                      Text(
                                        'Live AI partner',
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: colors.textMuted,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        // Reviews Due Deck
                        Expanded(
                          child: GestureDetector(
                            onTap: () => context.push('/review'),
                            child: GlassContainer(
                              level: GlassLevel.level2,
                              radius: 18,
                              padding: const EdgeInsets.all(14),
                              customGlow: const Color(0xFFFFB547).withOpacity(0.2),
                              child: Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(8),
                                    decoration: const BoxDecoration(
                                      color: Color(0x22FFB547),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      LucideIcons.layers,
                                      size: 18,
                                      color: Color(0xFFFFB547),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${appState.reviewsDueCount} Cards Due',
                                        style: TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w700,
                                          color: colors.textPrimary,
                                        ),
                                      ),
                                      Text(
                                        'SRS Review',
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: colors.textMuted,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // 7-Day Speaking Minutes Gauge
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    child: GlassContainer(
                      level: GlassLevel.level1,
                      radius: 20,
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                '7-DAY SPEAKING TIME',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.0,
                                  color: colors.textMuted,
                                ),
                              ),
                              Text(
                                '${appState.speakingMinutes7d} min',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: accent.primaryText,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: LinearProgressIndicator(
                              value: (appState.speakingMinutes7d / 60.0).clamp(0.0, 1.0),
                              minHeight: 6,
                              backgroundColor: Colors.white12,
                              valueColor: AlwaysStoppedAnimation<Color>(accent.primary),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                const SliverToBoxAdapter(
                  child: SizedBox(height: 100), // padding for mini-player + bottom tab bar
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The next learn-path stop of a mission, for Home's card ("Next: Learn").
String _nextStopLabel(AppState appState, String missionId) {
  final stops = stopsFor(hasLearnPlan: LearnContent.forMission(missionId) != null);
  final next = nextStop(stops, appState.stopsDone(missionId));
  return switch (next) {
    PathStop.learn => 'Learn',
    PathStop.practise => 'Practise',
    PathStop.mission => 'Mission',
    PathStop.talk => 'Talk',
    null => 'Review',
  };
}
