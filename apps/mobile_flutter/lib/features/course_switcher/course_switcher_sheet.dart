import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/constants/catalog.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';

class CourseSwitcherSheet extends ConsumerWidget {
  const CourseSwitcherSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;

    final enrolledTracks = [
      CatalogConstants.getTrack('french'),
      CatalogConstants.getTrack('japanese'),
      CatalogConstants.getTrack('spanish-latin-american'),
      CatalogConstants.getTrack('arabic-eastern'),
      CatalogConstants.getTrack('chinese-mandarin'),
    ];

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      decoration: BoxDecoration(
        color: colors.elevated,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Pull handle
          Center(
            child: Container(
              width: 44,
              height: 4.5,
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
          const SizedBox(height: 18),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'YOUR ENROLLMENTS',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.1,
                  color: accent.primaryText,
                ),
              ),
              IconButton(
                icon: const Icon(LucideIcons.x, size: 20, color: Colors.white70),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Enrolled courses list
          ...enrolledTracks.map((track) {
            final isCurrent = track.id == appState.activeTrackId;
            return GestureDetector(
              onTap: () {
                ref.read(appStateProvider.notifier).switchTrack(track.id);
                Navigator.of(context).pop();
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: isCurrent
                      ? accent.primary.withOpacity(0.18)
                      : const Color(0x10FFFFFF),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: isCurrent ? accent.primary : Colors.white10,
                    width: isCurrent ? 1.5 : 1.0,
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: isCurrent ? accent.primary : const Color(0x22FFFFFF),
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          track.displayName.substring(0, 1),
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
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
                          Text(
                            track.displayName,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: isCurrent ? FontWeight.w700 : FontWeight.w600,
                              color: isCurrent ? Colors.white : colors.textPrimary,
                            ),
                          ),
                          Text(
                            '${track.nativeName} · from English',
                            style: TextStyle(
                              fontSize: 12,
                              color: colors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (isCurrent)
                      Icon(LucideIcons.checkCircle2, color: accent.primary, size: 20),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 12),

          // Catalog Button
          GestureDetector(
            onTap: () {
              Navigator.of(context).pop();
              context.push('/catalog');
            },
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                color: const Color(0x18FFFFFF),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white24),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(LucideIcons.compass, size: 18, color: Colors.white),
                  SizedBox(width: 8),
                  Text(
                    'Explore All 30 Course Tracks',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}
