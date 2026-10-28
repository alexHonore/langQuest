import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/services/audio_service.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';
import 'full_player_sheet.dart';

class MiniPlayerWidget extends ConsumerWidget {
  const MiniPlayerWidget({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final audio = ref.watch(audioProvider);
    final appState = ref.watch(appStateProvider);
    final item = audio.currentItem;

    if (item == null) return const SizedBox.shrink();

    final isPlaying = audio.status == AudioPlayerStatus.playing;
    final progress = audio.durationMs > 0
        ? (audio.positionMs / audio.durationMs).clamp(0.0, 1.0)
        : 0.0;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      child: GestureDetector(
        onTap: () {
          showModalBottomSheet(
            context: context,
            isScrollControlled: true,
            backgroundColor: Colors.transparent,
            builder: (_) => const FullPlayerSheet(),
          );
        },
        child: GlassContainer(
          level: GlassLevel.level3,
          radius: 20,
          padding: EdgeInsets.zero,
          customGlow: appState.accent.primary.withOpacity(0.35),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: Row(
                  children: [
                    // Album art thumbnail with animated pulse when playing
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            appState.accent.primary,
                            appState.accent.lantern[1],
                          ],
                        ),
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: isPlaying
                            ? [
                                BoxShadow(
                                  color: appState.accent.primary.withOpacity(0.4),
                                  blurRadius: 10,
                                  spreadRadius: 1,
                                ),
                              ]
                            : null,
                      ),
                      child: const Center(
                        child: Icon(
                          LucideIcons.headphones,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    // Title and status line
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: appState.colors.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            item.subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w400,
                              color: isPlaying
                                  ? appState.accent.primaryText
                                  : appState.colors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Skip back 10s
                    IconButton(
                      icon: const Icon(LucideIcons.rotateCcw, size: 18),
                      color: appState.colors.textSecondary,
                      onPressed: () => ref.read(audioProvider.notifier).skipBack(10),
                    ),
                    // Play / Pause glowing button
                    Container(
                      decoration: BoxDecoration(
                        color: appState.accent.primary,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: appState.accent.primary.withOpacity(0.4),
                            blurRadius: 12,
                            spreadRadius: 1,
                          ),
                        ],
                      ),
                      child: IconButton(
                        icon: Icon(
                          isPlaying ? LucideIcons.pause : LucideIcons.play,
                          size: 20,
                          color: appState.accent.onPrimary,
                        ),
                        onPressed: () => ref.read(audioProvider.notifier).toggle(),
                      ),
                    ),
                    // Skip forward 10s
                    IconButton(
                      icon: const Icon(LucideIcons.rotateCw, size: 18),
                      color: appState.colors.textSecondary,
                      onPressed: () => ref.read(audioProvider.notifier).skipForward(10),
                    ),
                  ],
                ),
              ),
              // Tiny progress line along bottom
              ClipRRect(
                borderRadius: const BorderRadius.only(
                  bottomLeft: Radius.circular(20),
                  bottomRight: Radius.circular(20),
                ),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 2.8,
                  backgroundColor: Colors.white10,
                  valueColor: AlwaysStoppedAnimation<Color>(appState.accent.primary),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
