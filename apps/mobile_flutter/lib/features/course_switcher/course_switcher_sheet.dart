import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/services/app_state.dart';
import '../../core/theme/accents.dart';
import '../../l10n/l10n.dart';

/// The learner's courses (one per track × instruction language); tap to switch, or browse the catalog.
class CourseSwitcherSheet extends ConsumerWidget {
  const CourseSwitcherSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final ui = appState.uiLanguage;
    final activeId = appState.activeCourse?.id;

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      decoration: BoxDecoration(
        color: colors.elevated,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        border: Border.all(color: colors.border),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4.5,
                decoration: BoxDecoration(color: colors.borderStrong, borderRadius: BorderRadius.circular(3)),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.yourCourses.toUpperCase(),
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.1, color: colors.textMuted),
                  ),
                ),
                IconButton(
                  icon: Icon(LucideIcons.x, size: 20, color: colors.textSecondary),
                  tooltip: l10n.close,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 4),
            for (final e in appState.learner.enrollments)
              Builder(
                builder: (context) {
                  final track = appState.content.track(e.trackId);
                  final isCurrent = e.courseId == activeId;
                  final accent = CourseAccent.forTrack(track, isDark: appState.isDark);
                  final name = track?.name(ui) ?? e.trackId;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Semantics(
                      button: true,
                      selected: isCurrent,
                      label: '$name, ${l10n.fromLanguage(e.source)}',
                      excludeSemantics: true,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(16),
                        onTap: () {
                          ref.read(appStateProvider.notifier).switchCourse(e.courseId);
                          Navigator.of(context).pop();
                        },
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: isCurrent ? accent.primarySoft : colors.surface,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: isCurrent ? accent.primary : colors.border, width: isCurrent ? 1.5 : 1),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(color: accent.primary, shape: BoxShape.circle),
                                alignment: Alignment.center,
                                child: Text(
                                  String.fromCharCode(name.runes.first),
                                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: accent.onPrimary),
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      name,
                                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: colors.textPrimary),
                                    ),
                                    Text(
                                      '${track?.nativeName ?? ''} · ${l10n.fromLanguage(e.source)}',
                                      style: TextStyle(fontSize: 12.5, color: colors.textMuted),
                                    ),
                                  ],
                                ),
                              ),
                              if (isCurrent) Icon(LucideIcons.circleCheck, color: accent.primaryText, size: 20),
                            ],
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            const SizedBox(height: 6),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  foregroundColor: colors.textPrimary,
                  side: BorderSide(color: colors.borderStrong),
                ),
                icon: const Icon(LucideIcons.compass, size: 18),
                label: Text(l10n.browseAllCourses),
                onPressed: () {
                  // Capture the router before the sheet's context goes away.
                  final router = GoRouter.of(context);
                  Navigator.of(context).pop();
                  router.push('/catalog');
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
