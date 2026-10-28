import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/constants/catalog.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/accents.dart';
import '../../core/theme/colors.dart';
import '../../core/theme/glass.dart';

class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  String _searchQuery = '';

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;

    final filtered = CatalogConstants.tracks.where((t) {
      final q = _searchQuery.toLowerCase();
      return t.displayName.toLowerCase().contains(q) ||
          t.nativeName.toLowerCase().contains(q) ||
          t.teachingFocus.toLowerCase().contains(q);
    }).toList();

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Top App Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
                    onPressed: () => context.pop(),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Course Catalog (30 Tracks)',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: colors.textPrimary,
                    ),
                  ),
                ],
              ),
            ),

            // Search Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: colors.elevated,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white12),
                ),
                child: TextField(
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                  decoration: const InputDecoration(
                    icon: Icon(LucideIcons.search, size: 18, color: Colors.white38),
                    border: InputBorder.none,
                    hintText: 'Search language, script, or dialect...',
                    hintStyle: TextStyle(color: Colors.white38, fontSize: 14),
                  ),
                  onChanged: (val) => setState(() => _searchQuery = val),
                ),
              ),
            ),

            // Grid of 30 Course Tracks
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                itemCount: filtered.length,
                itemBuilder: (context, index) {
                  final track = filtered[index];
                  final isEnrolled = track.id == appState.activeTrackId;
                  final trackAccent = CourseAccent.forTrack(track.id);

                  return Container(
                    margin: const EdgeInsets.only(bottom: 14),
                    child: GlassContainer(
                      level: isEnrolled ? GlassLevel.level2 : GlassLevel.level1,
                      radius: 20,
                      padding: const EdgeInsets.all(16),
                      border: isEnrolled
                          ? Border.all(color: trackAccent.primary.withOpacity(0.6))
                          : null,
                      onTap: () {
                        ref.read(appStateProvider.notifier).switchTrack(track.id);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Switched active track to ${track.displayName}'),
                            duration: const Duration(seconds: 2),
                          ),
                        );
                        context.pop();
                      },
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              // Abstract cover motif thumbnail
                              Container(
                                width: 48,
                                height: 48,
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    colors: [
                                      trackAccent.primary,
                                      trackAccent.lantern[1],
                                    ],
                                  ),
                                  borderRadius: BorderRadius.circular(14),
                                ),
                                child: Center(
                                  child: Text(
                                    track.displayName.substring(0, 1),
                                    style: const TextStyle(
                                      fontSize: 20,
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
                                          track.displayName,
                                          style: TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w700,
                                            color: colors.textPrimary,
                                          ),
                                        ),
                                        if (isEnrolled) ...[
                                          const SizedBox(width: 6),
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 6, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: trackAccent.primarySoft,
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: Text(
                                              'ACTIVE',
                                              style: TextStyle(
                                                fontSize: 10,
                                                fontWeight: FontWeight.w700,
                                                color: trackAccent.primaryText,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                    Text(
                                      track.nativeName,
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: trackAccent.primaryText,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Icon(
                                isEnrolled ? LucideIcons.check : LucideIcons.arrowRight,
                                size: 18,
                                color: isEnrolled ? trackAccent.primary : Colors.white38,
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text(
                            track.teachingFocus,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: colors.textSecondary,
                              height: 1.35,
                            ),
                          ),
                          if (track.regionalOptions.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              children: track.regionalOptions.map((opt) {
                                return Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: const Color(0x14FFFFFF),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    opt,
                                    style: TextStyle(
                                      fontSize: 10.5,
                                      color: colors.textMuted,
                                    ),
                                  ),
                                );
                              }).toList(),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
