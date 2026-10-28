import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            // Top App Bar
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Row(
                  children: [
                    IconButton(
                      icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
                      onPressed: () => context.pop(),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Account & Preferences',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: colors.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Learner Pledge Banner
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: GlassContainer(
                  level: GlassLevel.level2,
                  radius: 20,
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(LucideIcons.heartHandshake, size: 20, color: accent.primaryText),
                          const SizedBox(width: 10),
                          const Text(
                            'Free for Every Learner',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'LangQuest has no paywalls, subscriptions, credits or usage meters. All 30 language tracks and AI conversation partners are freely accessible.',
                        style: TextStyle(fontSize: 13, color: colors.textSecondary, height: 1.4),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Instruction Language
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                child: GlassContainer(
                  level: GlassLevel.level1,
                  radius: 18,
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          const Icon(LucideIcons.languages, size: 18, color: Colors.white70),
                          const SizedBox(width: 12),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Instruction Language',
                                style: TextStyle(
                                  fontSize: 14.5,
                                  fontWeight: FontWeight.w600,
                                  color: colors.textPrimary,
                                ),
                              ),
                              Text(
                                appState.sourceLanguageCode == 'en' ? 'English (en)' : 'Français (fr)',
                                style: TextStyle(fontSize: 12, color: colors.textMuted),
                              ),
                            ],
                          ),
                        ],
                      ),
                      DropdownButton<String>(
                        value: appState.sourceLanguageCode,
                        dropdownColor: colors.elevated,
                        underline: const SizedBox.shrink(),
                        items: const [
                          DropdownMenuItem(value: 'en', child: Text('English', style: TextStyle(color: Colors.white))),
                          DropdownMenuItem(value: 'fr', child: Text('Français', style: TextStyle(color: Colors.white))),
                        ],
                        onChanged: (val) {
                          if (val != null) {
                            ref.read(appStateProvider.notifier).switchSourceLanguage(val);
                          }
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Theme Toggle
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
                child: GlassContainer(
                  level: GlassLevel.level1,
                  radius: 18,
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Icon(
                            appState.isDark ? LucideIcons.moon : LucideIcons.sun,
                            size: 18,
                            color: Colors.white70,
                          ),
                          const SizedBox(width: 12),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Night Market Theme',
                                style: TextStyle(
                                  fontSize: 14.5,
                                  fontWeight: FontWeight.w600,
                                  color: colors.textPrimary,
                                ),
                              ),
                              Text(
                                appState.isDark ? 'Dark-first ambient glow' : 'Light palette',
                                style: TextStyle(fontSize: 12, color: colors.textMuted),
                              ),
                            ],
                          ),
                        ],
                      ),
                      Switch(
                        value: appState.isDark,
                        activeColor: accent.primary,
                        onChanged: (_) {
                          ref.read(appStateProvider.notifier).toggleTheme();
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Storage & Offline Sync Status
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
                child: GlassContainer(
                  level: GlassLevel.level1,
                  radius: 18,
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      const Icon(LucideIcons.hardDrive, size: 18, color: Color(0xFF45E0A6)),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Offline Cache & Outbox',
                            style: TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w600,
                              color: colors.textPrimary,
                            ),
                          ),
                          Text(
                            '0 pending events · Cache up-to-date',
                            style: TextStyle(fontSize: 12, color: colors.textMuted),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SliverToBoxAdapter(
              child: SizedBox(height: 40),
            ),
          ],
        ),
      ),
    );
  }
}
