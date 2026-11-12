import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../l10n/l10n.dart';
import '../services/app_state.dart';
import 'content_bundle.dart';

/// A course's chapters being read ([courseContentProvider], started by showing this): a spinner, or why they could not
/// be read and a button to try again.
class CourseLoading extends ConsumerWidget {
  final String trackId;
  const CourseLoading({super.key, required this.trackId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final load = ref.watch(courseContentProvider(trackId));
    final l10n = context.l10n;
    final failed = load.hasError && !load.isLoading;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: failed
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.cloudOff, size: 36, color: colors.textMuted),
                  const SizedBox(height: 12),
                  Text(
                    l10n.courseLoadFailed,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 15, height: 1.4, color: colors.textPrimary),
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: colors.textPrimary,
                      side: BorderSide(color: colors.borderStrong),
                    ),
                    icon: const Icon(LucideIcons.rotateCcw, size: 18),
                    label: Text(l10n.courseLoadRetry),
                    onPressed: () => ref.invalidate(courseContentProvider(trackId)),
                  ),
                ],
              )
            : Semantics(
                label: l10n.courseLoading,
                child: SizedBox.square(dimension: 32, child: CircularProgressIndicator(strokeWidth: 3, color: colors.textSecondary)),
              ),
      ),
    );
  }
}

/// The active course's chapters are normally in memory before the first frame (`main()` reads the learner's courses).
/// When they are not — start-up could not read them (offline, before the browser kept them), or a course was taken
/// before they were read — this shows them loading over the app, with a way to try again, instead of empty screens.
/// The app underneath stays mounted.
class ActiveCourseGate extends ConsumerWidget {
  final Widget child;
  const ActiveCourseGate({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trackId = ref.watch(appStateProvider.select((s) => s.learner.activeEnrollment?.trackId));
    final waiting = trackId != null && ref.watch(contentBundleProvider.select((b) => b.track(trackId) != null && !b.isLoaded(trackId)));
    final background = ref.watch(appStateProvider.select((s) => s.colors.background));
    // The same tree either way (the router below keeps its state); while waiting it is covered, not reachable.
    return Stack(
      fit: StackFit.passthrough,
      children: [
        ExcludeSemantics(
          excluding: waiting,
          child: IgnorePointer(ignoring: waiting, child: child),
        ),
        if (waiting)
          Positioned.fill(
            child: Material(
              color: background,
              child: SafeArea(child: CourseLoading(trackId: trackId)),
            ),
          ),
      ],
    );
  }
}
