import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/services/audio_service.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';
import 'full_player_sheet.dart';

class AudioScreen extends ConsumerWidget {
  const AudioScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final audio = ref.watch(audioProvider);
    final accent = appState.accent;
    final colors = appState.colors;

    final List<AudioTrackItem> libraryTracks = [
      const AudioTrackItem(
        id: 'lesson-1-audio',
        title: 'Arrival at the Café',
        subtitle: 'Polite Greetings & Table Request',
        courseTrackId: 'french',
        durationMs: 96000,
      ),
      const AudioTrackItem(
        id: 'lesson-2-audio',
        title: 'Boulangerie Morning Routine',
        subtitle: 'Pastries, Baguettes & Numbers',
        courseTrackId: 'french',
        durationMs: 142000,
      ),
      const AudioTrackItem(
        id: 'lesson-3-audio',
        title: 'Navigating the Metro',
        subtitle: 'Line Directions & Interchange',
        courseTrackId: 'french',
        durationMs: 180000,
      ),
      const AudioTrackItem(
        id: 'lesson-4-audio',
        title: 'Evening Market Dialogue',
        subtitle: 'Fresh Cheeses & Seasonal Fruit',
        courseTrackId: 'french',
        durationMs: 125000,
      ),
    ];

    String formatMin(int ms) {
      final m = ms ~/ 60000;
      final s = (ms % 60000) ~/ 1000;
      return '$m min ${s.toString().padLeft(2, '0')}s';
    }

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          // Background amber lantern glow
          Positioned(
            top: 60,
            right: -60,
            child: Container(
              width: 260,
              height: 260,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0x18FFB547),
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
                          'CURATED AUDIO LIBRARY',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.2,
                            color: const Color(0xFFFFB547),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Owner Audio Tracks',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                            color: colors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'High-fidelity recordings with synchronized transcripts and offline access.',
                          style: TextStyle(fontSize: 14, color: colors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ),

                // Featured Album Card
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                    child: Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            accent.primary.withOpacity(0.3),
                            const Color(0xFFFFB547).withOpacity(0.2),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: Colors.white24),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 68,
                            height: 68,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [accent.primary, const Color(0xFFFFB547)],
                              ),
                              borderRadius: BorderRadius.circular(16),
                              boxShadow: [
                                BoxShadow(
                                  color: accent.primary.withOpacity(0.35),
                                  blurRadius: 14,
                                ),
                              ],
                            ),
                            child: const Icon(LucideIcons.radio, size: 32, color: Colors.white),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Daily Life in Paris',
                                  style: TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w700,
                                    color: Colors.white,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '4 Episodes · 9.4 mins total',
                                  style: TextStyle(fontSize: 12.5, color: colors.textMuted),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(LucideIcons.playCircle, size: 36, color: Colors.white),
                            onPressed: () {
                              ref.read(audioProvider.notifier).loadTrack(libraryTracks.first);
                              ref.read(audioProvider.notifier).play();
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    child: Text(
                      'ALL EPISODES',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.1,
                        color: colors.textMuted,
                      ),
                    ),
                  ),
                ),

                // Track items list
                SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final track = libraryTracks[index];
                      final isCurrent = audio.currentItem?.id == track.id;
                      final isPlaying = isCurrent && audio.status == AudioPlayerStatus.playing;

                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
                        child: GlassContainer(
                          level: isCurrent ? GlassLevel.level2 : GlassLevel.level1,
                          radius: 18,
                          padding: const EdgeInsets.all(14),
                          border: isCurrent
                              ? Border.all(color: accent.primary.withOpacity(0.6))
                              : null,
                          onTap: () {
                            ref.read(audioProvider.notifier).loadTrack(track);
                            ref.read(audioProvider.notifier).play();
                            showModalBottomSheet(
                              context: context,
                              isScrollControlled: true,
                              backgroundColor: Colors.transparent,
                              builder: (_) => const FullPlayerSheet(),
                            );
                          },
                          child: Row(
                            children: [
                              Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(
                                  color: isCurrent
                                      ? accent.primary
                                      : const Color(0x18FFFFFF),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(
                                  isPlaying
                                      ? LucideIcons.volume2
                                      : LucideIcons.play,
                                  size: 18,
                                  color: isCurrent ? Colors.white : colors.textMuted,
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      track.title,
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: isCurrent ? FontWeight.w700 : FontWeight.w600,
                                        color: isCurrent ? Colors.white : colors.textPrimary,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${track.subtitle} · ${formatMin(track.durationMs)}',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: colors.textMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: const Icon(LucideIcons.downloadCloud, size: 18, color: Colors.white38),
                                onPressed: () {},
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                    childCount: libraryTracks.length,
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
