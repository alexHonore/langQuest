import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';

class CharacterInterlocutor {
  final String id;
  final String name;
  final String role;
  final String description;
  final String avatarInitial;
  final Color themeColor;

  const CharacterInterlocutor({
    required this.id,
    required this.name,
    required this.role,
    required this.description,
    required this.avatarInitial,
    required this.themeColor,
  });
}

class SpeakScreen extends ConsumerWidget {
  const SpeakScreen({super.key});

  static const List<CharacterInterlocutor> characters = [
    CharacterInterlocutor(
      id: 'elise',
      name: 'Élise Laurent',
      role: 'Café Owner & Foodie',
      description: 'Loves discussing culinary secrets, local markets, and daily life in Lyon.',
      avatarInitial: 'É',
      themeColor: Color(0xFFFF4FA3),
    ),
    CharacterInterlocutor(
      id: 'julien',
      name: 'Julien Mercier',
      role: 'Architect & Traveler',
      description: 'Patient conversationalist specializing in urban design, travel, and books.',
      avatarInitial: 'J',
      themeColor: Color(0xFF3EE1E8),
    ),
    CharacterInterlocutor(
      id: 'claire',
      name: 'Claire Fontaine',
      role: 'Art Historian & Guide',
      description: 'Engaging speaker who enjoys walking tours, heritage, and casual debates.',
      avatarInitial: 'C',
      themeColor: Color(0xFFFFB547),
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          // Ambient cyan glow
          Positioned(
            top: 40,
            left: -60,
            child: Container(
              width: 280,
              height: 280,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0x183EE1E8),
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
                          'SPEAK & CONVERSE',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.2,
                            color: const Color(0xFF3EE1E8),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'AI Conversation Partners',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                            color: colors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Practice open dialogue with native interlocutors in real-time.',
                          style: TextStyle(
                            fontSize: 14,
                            color: colors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // Primary Quick Conversation Launcher Banner
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                    child: GestureDetector(
                      onTap: () => context.push('/conversation'),
                      child: Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              const Color(0xFF3EE1E8).withOpacity(0.25),
                              accent.primary.withOpacity(0.20),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(24),
                          border: Border.all(color: const Color(0xFF3EE1E8).withOpacity(0.6)),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF3EE1E8).withOpacity(0.25),
                              blurRadius: 20,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: Color(0xFF3EE1E8),
                              ),
                              child: const Icon(
                                LucideIcons.sparkles,
                                size: 28,
                                color: Color(0xFF04282B),
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Free Conversation',
                                    style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w700,
                                      color: Colors.white,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    'Hands-free speech with automatic turn detection',
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      color: colors.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(
                              LucideIcons.chevronRight,
                              color: Color(0xFF3EE1E8),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),

                // Interlocutors List
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    child: Text(
                      'CONVERSATION CAST',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.1,
                        color: colors.textMuted,
                      ),
                    ),
                  ),
                ),

                SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final c = characters[index];
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
                        child: GlassContainer(
                          level: GlassLevel.level1,
                          radius: 20,
                          padding: const EdgeInsets.all(16),
                          onTap: () => context.push('/conversation'),
                          child: Row(
                            children: [
                              // Clay style character avatar
                              Container(
                                width: 50,
                                height: 50,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: c.themeColor,
                                  boxShadow: [
                                    BoxShadow(
                                      color: c.themeColor.withOpacity(0.35),
                                      blurRadius: 12,
                                      spreadRadius: 1,
                                    ),
                                  ],
                                ),
                                child: Center(
                                  child: Text(
                                    c.avatarInitial,
                                    style: const TextStyle(
                                      fontSize: 22,
                                      fontWeight: FontWeight.w800,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Text(
                                          c.name,
                                          style: TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w700,
                                            color: colors.textPrimary,
                                          ),
                                        ),
                                        const SizedBox(width: 6),
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: const Color(0x18FFFFFF),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: Text(
                                            c.role,
                                            style: TextStyle(
                                              fontSize: 10.5,
                                              fontWeight: FontWeight.w500,
                                              color: colors.textMuted,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      c.description,
                                      style: TextStyle(
                                        fontSize: 12.5,
                                        color: colors.textSecondary,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Icon(
                                LucideIcons.messageCircle,
                                size: 18,
                                color: Colors.white54,
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                    childCount: characters.length,
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
