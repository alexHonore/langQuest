import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';

class ProgressScreen extends ConsumerWidget {
  const ProgressScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          // Background soft glow
          Positioned(
            top: 60,
            left: -40,
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
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'YOUR JOURNEY',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.2,
                            color: accent.primaryText,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Fluency & Mastery',
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

                // Top Stats Summary Grid
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Row(
                      children: [
                        // XP Card
                        Expanded(
                          child: GlassContainer(
                            level: GlassLevel.level2,
                            radius: 20,
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    const Icon(LucideIcons.sparkles, size: 16, color: Color(0xFFFFD15C)),
                                    const SizedBox(width: 6),
                                    Text('TOTAL XP', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: colors.textMuted)),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  '${appState.totalXp}',
                                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Colors.white),
                                ),
                                const SizedBox(height: 4),
                                Text('Level 3 Learner', style: TextStyle(fontSize: 12, color: accent.primaryText)),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        // Speaking Minutes Card
                        Expanded(
                          child: GlassContainer(
                            level: GlassLevel.level2,
                            radius: 20,
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    const Icon(LucideIcons.mic, size: 16, color: Color(0xFF3EE1E8)),
                                    const SizedBox(width: 6),
                                    Text('SPEAKING', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: colors.textMuted)),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  '${appState.speakingMinutes7d} min',
                                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Colors.white),
                                ),
                                const SizedBox(height: 4),
                                Text('Past 7 days', style: TextStyle(fontSize: 12, color: colors.textMuted)),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // Streak Calendar Section
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    child: GlassContainer(
                      level: GlassLevel.level1,
                      radius: 20,
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Row(
                                children: [
                                  const Icon(LucideIcons.flame, color: Color(0xFFFFB547), size: 18),
                                  const SizedBox(width: 8),
                                  Text(
                                    '${appState.streakDays}-DAY ACTIVE STREAK',
                                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFFFFB547)),
                                  ),
                                ],
                              ),
                              Text('Daily Goal: 5m', style: TextStyle(fontSize: 12, color: colors.textMuted)),
                            ],
                          ),
                          const SizedBox(height: 16),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) {
                              final isDone = day != 'Sat' && day != 'Sun';
                              return Column(
                                children: [
                                  Container(
                                    width: 38,
                                    height: 38,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: isDone ? const Color(0xFFFFB547) : Colors.white12,
                                    ),
                                    child: Center(
                                      child: Icon(
                                        isDone ? LucideIcons.check : LucideIcons.circle,
                                        size: 16,
                                        color: isDone ? const Color(0xFF2B1A00) : Colors.white30,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(day, style: TextStyle(fontSize: 11, color: colors.textMuted)),
                                ],
                              );
                            }).toList(),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // Vocabulary Durability Breakdown
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                    child: GlassContainer(
                      level: GlassLevel.level1,
                      radius: 20,
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'VOCABULARY DURABILITY (§2.4)',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.0, color: colors.textMuted),
                          ),
                          const SizedBox(height: 14),
                          _buildDurabilityRow('Durable Retention', '42 words', const Color(0xFF45E0A6), 0.7),
                          const SizedBox(height: 10),
                          _buildDurabilityRow('Independent Mastery', '28 words', const Color(0xFF3EE1E8), 0.5),
                          const SizedBox(height: 10),
                          _buildDurabilityRow('Practiced Expressions', '19 words', const Color(0xFFFFB547), 0.35),
                          const SizedBox(height: 10),
                          _buildDurabilityRow('Emerging Phrases', '14 words', accent.primary, 0.25),
                        ],
                      ),
                    ),
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

  Widget _buildDurabilityRow(String label, String count, Color color, double fraction) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.white)),
            Text(count, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: color)),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: fraction,
            minHeight: 5,
            backgroundColor: Colors.white10,
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        ),
      ],
    );
  }
}
