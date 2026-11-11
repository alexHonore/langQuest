import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/accents.dart';
import '../../core/theme/glass.dart';
import '../../core/theme/script_fonts.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_widgets.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';

/// First run: what LangQuest is, and the language of the app and its explanations (English or French).
class WelcomeScreen extends ConsumerWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        // Spaced out on the screen; scrolls when large text needs more room than the screen has.
        child: LayoutBuilder(
          builder: (context, box) => SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight - 32),
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Spacer(),
                    const Center(child: MeloWidget(state: MeloState.welcome, size: 120)),
                    const SizedBox(height: 24),
                    Semantics(
                      header: true,
                      child: Text(
                        l10n.welcomeTitle,
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, height: 1.2, color: colors.textPrimary),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      l10n.welcomeBody,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 15.5, height: 1.45, color: colors.textSecondary),
                    ),
                    const Spacer(),
                    Text(
                      l10n.welcomeLanguageLabel,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.textMuted),
                    ),
                    const SizedBox(height: 8),
                    SegmentedButton<String>(
                      segments: [
                        for (final code in supportedInstructionLanguages) ButtonSegment(value: code, label: Text(code == 'en' ? 'English' : 'Français')),
                      ],
                      selected: {appState.uiLanguage},
                      showSelectedIcon: false,
                      onSelectionChanged: (s) => ref.read(appStateProvider.notifier).setUiLanguage(s.first),
                    ),
                    const SizedBox(height: 20),
                    LearnPrimaryButton(label: l10n.welcomeContinue, icon: LucideIcons.chevronRight, onPressed: () => context.push('/welcome/courses')),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// First run, step 2: the courses that can be started today from the chosen language, and the full catalog.
class PickCourseScreen extends ConsumerWidget {
  const PickCourseScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final ui = appState.uiLanguage;
    final ready = appState.content.availableFrom(ui);
    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Row(
              children: [
                IconButton(
                  icon: Icon(LucideIcons.arrowLeft, color: colors.textPrimary),
                  tooltip: l10n.back,
                  onPressed: () => context.popOrHome(),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Semantics(
                header: true,
                child: Text(
                  l10n.pickCourseTitle,
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: colors.textPrimary),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text('${l10n.pickCourseReady} · ${l10n.fromLanguage(ui)}', style: TextStyle(fontSize: 14, color: colors.textSecondary)),
            ),
            const SizedBox(height: 16),
            if (ready.isEmpty) Text(l10n.pickCourseNone, style: TextStyle(color: colors.textSecondary)),
            for (final track in ready) _ReadyCourseTile(track: track, source: ui),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                foregroundColor: colors.textPrimary,
                side: BorderSide(color: colors.borderStrong),
              ),
              icon: const Icon(LucideIcons.compass, size: 18),
              label: Text(l10n.seeAllCourses),
              onPressed: () => context.push('/catalog'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReadyCourseTile extends ConsumerWidget {
  final CourseTrackInfo track;
  final String source;
  const _ReadyCourseTile({required this.track, required this.source});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final accent = CourseAccent.forTrack(track, isDark: appState.isDark);
    final course = appState.content.course(track.id, source);
    final name = track.name(appState.uiLanguage);
    final missions = course?.missions.length ?? 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Semantics(
        button: true,
        label: '$name, ${l10n.missionsCount(missions)}',
        excludeSemantics: true,
        child: GlassContainer(
          level: GlassLevel.level2,
          radius: 20,
          padding: const EdgeInsets.all(16),
          customGlow: accent.primary.withValues(alpha: 0.3),
          onTap: () => context.push('/course/${track.id}'),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: [accent.primary, accent.lantern[1]]),
                  borderRadius: BorderRadius.circular(16),
                ),
                alignment: Alignment.center,
                child: Text(
                  String.fromCharCode(name.runes.first),
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: accent.onPrimary),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: colors.textPrimary),
                    ),
                    Text(
                      track.nativeName,
                      textDirection: track.rtl ? TextDirection.rtl : TextDirection.ltr,
                      style: TextStyle(fontSize: 14, color: colors.textSecondary, fontFamilyFallback: fontFallbackFor(track)),
                    ),
                    const SizedBox(height: 4),
                    Text('${l10n.missionsCount(missions)} · ${l10n.notNativeReviewed}', style: TextStyle(fontSize: 12, color: colors.textMuted)),
                  ],
                ),
              ),
              Icon(LucideIcons.chevronRight, color: colors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}
