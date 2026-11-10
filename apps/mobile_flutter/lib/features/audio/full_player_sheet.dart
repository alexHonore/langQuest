// PARKED — not reachable from the app since the learn path moved to the real curriculum (see README.md,
// "Parked prototype files"). It holds mock data or simulated behaviour (canned replies, simulated playback or
// voice levels, hand-copied catalog) that must not ship. Kept until the owner decides to delete or rewrite it.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/services/audio_service.dart';

class FullPlayerSheet extends ConsumerStatefulWidget {
  const FullPlayerSheet({super.key});

  @override
  ConsumerState<FullPlayerSheet> createState() => _FullPlayerSheetState();
}

class _FullPlayerSheetState extends ConsumerState<FullPlayerSheet> {
  final ScrollController _transcriptScroll = ScrollController();

  String _formatTime(int ms) {
    final s = ms ~/ 1000;
    final m = s ~/ 60;
    final remS = s % 60;
    return '$m:${remS.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _transcriptScroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final audio = ref.watch(audioProvider);
    final appState = ref.watch(appStateProvider);
    final item = audio.currentItem;

    if (item == null) return const SizedBox.shrink();

    final isPlaying = audio.status == AudioPlayerStatus.playing;
    final progress = audio.durationMs > 0
        ? (audio.positionMs / audio.durationMs).clamp(0.0, 1.0)
        : 0.0;

    return Container(
      height: MediaQuery.of(context).size.height * 0.90,
      decoration: BoxDecoration(
        color: appState.colors.background,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
        border: Border.all(color: Colors.white12),
      ),
      child: Stack(
        children: [
          // Ambient glowing lantern backdrop
          Positioned(
            top: -60,
            left: 20,
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: appState.accent.primary.withValues(alpha: 0.20),
              ),
            ),
          ),

          Column(
            children: [
              // Pull Handle
              const SizedBox(height: 12),
              Container(
                width: 44,
                height: 4.5,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
              const SizedBox(height: 16),

              // Header with track title and close
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    IconButton(
                      icon: const Icon(LucideIcons.chevronDown, color: Colors.white70),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                    Text(
                      'AUDIO LESSON',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.2,
                        color: appState.accent.primaryText,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(LucideIcons.moreVertical, color: Colors.white70),
                      onPressed: () {},
                    ),
                  ],
                ),
              ),

              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                  children: [
                    // Album Cover Art
                    Center(
                      child: Container(
                        width: 200,
                        height: 200,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              appState.accent.primary,
                              appState.accent.lantern[1],
                            ],
                          ),
                          borderRadius: BorderRadius.circular(28),
                          boxShadow: [
                            BoxShadow(
                              color: appState.accent.primary.withValues(alpha: 0.35),
                              blurRadius: 28,
                              spreadRadius: 4,
                            ),
                          ],
                        ),
                        child: Center(
                          child: Icon(
                            LucideIcons.headphones,
                            size: 64,
                            color: Colors.white.withValues(alpha: 0.9),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Title & Subtitle
                    Text(
                      item.title,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: appState.colors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.subtitle,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 14,
                        color: appState.colors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Slider & Timestamps
                    SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        activeTrackColor: appState.accent.primary,
                        inactiveTrackColor: Colors.white12,
                        thumbColor: Colors.white,
                        trackHeight: 4,
                        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                      ),
                      child: Slider(
                        value: progress,
                        onChanged: (val) {
                          ref
                              .read(audioProvider.notifier)
                              .seekTo((val * audio.durationMs).toInt());
                        },
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            _formatTime(audio.positionMs),
                            style: TextStyle(
                              fontSize: 12,
                              color: appState.colors.textMuted,
                            ),
                          ),
                          Text(
                            _formatTime(audio.durationMs),
                            style: TextStyle(
                              fontSize: 12,
                              color: appState.colors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Controls Row (Speed, Skip Back, Play/Pause, Skip Fwd, Loop)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        // Speed button
                        GestureDetector(
                          onTap: () {
                            final nextSpeed = audio.speed == 1.0
                                ? 1.25
                                : audio.speed == 1.25
                                    ? 0.75
                                    : 1.0;
                            ref.read(audioProvider.notifier).setSpeed(nextSpeed);
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.white10,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '${audio.speed}x',
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(LucideIcons.rotateCcw, size: 24, color: Colors.white),
                          onPressed: () => ref.read(audioProvider.notifier).skipBack(10),
                        ),
                        // Big Play / Pause button
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: appState.accent.primary,
                            boxShadow: [
                              BoxShadow(
                                color: appState.accent.primary.withValues(alpha: 0.5),
                                blurRadius: 20,
                                spreadRadius: 3,
                              ),
                            ],
                          ),
                          child: IconButton(
                            icon: Icon(
                              isPlaying ? LucideIcons.pause : LucideIcons.play,
                              size: 30,
                              color: appState.accent.onPrimary,
                            ),
                            onPressed: () => ref.read(audioProvider.notifier).toggle(),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(LucideIcons.rotateCw, size: 24, color: Colors.white),
                          onPressed: () => ref.read(audioProvider.notifier).skipForward(10),
                        ),
                        IconButton(
                          icon: const Icon(LucideIcons.share2, size: 20, color: Colors.white70),
                          onPressed: () {},
                        ),
                      ],
                    ),
                    const SizedBox(height: 28),

                    // Real-time Karaoke Synchronized Transcript Section
                    Row(
                      children: [
                        Icon(LucideIcons.scrollText, size: 16, color: appState.accent.primaryText),
                        const SizedBox(width: 8),
                        Text(
                          'SYNCHRONIZED TRANSCRIPT',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.0,
                            color: appState.accent.primaryText,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // Transcript Cards
                    ...List.generate(item.transcript.length, (idx) {
                      final seg = item.transcript[idx];
                      final isActive = idx == audio.activeTranscriptIndex;

                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: isActive
                              ? appState.accent.primary.withValues(alpha: 0.18)
                              : const Color(0x0EFFFFFF),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: isActive
                                ? appState.accent.primary.withValues(alpha: 0.55)
                                : Colors.white10,
                            width: isActive ? 1.5 : 1.0,
                          ),
                          boxShadow: isActive
                              ? [
                                  BoxShadow(
                                    color: appState.accent.primary.withValues(alpha: 0.25),
                                    blurRadius: 14,
                                    spreadRadius: 1,
                                  ),
                                ]
                              : null,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              seg.text,
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                                color: isActive
                                    ? Colors.white
                                    : appState.colors.textPrimary.withValues(alpha: 0.75),
                                height: 1.4,
                              ),
                            ),
                            if (seg.translation != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                seg.translation!,
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w400,
                                  color: isActive
                                      ? appState.accent.primaryText
                                      : appState.colors.textMuted,
                                ),
                              ),
                            ],
                          ],
                        ),
                      );
                    }),
                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
