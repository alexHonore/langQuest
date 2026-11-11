import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/backend/account.dart';
import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speaking_stats.dart';
import '../../core/theme/glass.dart';
import '../../l10n/l10n.dart';
import '../audio/audio_screens.dart';
import '../call/call_history.dart';
import 'account_section.dart';
import 'display_settings.dart';

/// Settings: the interface language, the theme, the learner's courses, and the data kept on this device.
/// Every control here does what it says (CONVENTIONS §8).
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  Future<bool> _confirm(BuildContext context, {required String title, required String body, required String confirm}) async {
    final l10n = context.l10n;
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(l10n.cancel)),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: Text(confirm)),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final notifier = ref.read(appStateProvider.notifier);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final ui = appState.uiLanguage;

    Widget section(String title) => Padding(
      padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.0, color: colors.textMuted),
      ),
    );

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Row(
              children: [
                IconButton(
                  icon: Icon(LucideIcons.arrowLeft, color: colors.textPrimary),
                  tooltip: l10n.back,
                  onPressed: () => context.popOrHome(),
                ),
                const SizedBox(width: 4),
                Semantics(
                  header: true,
                  child: Text(
                    l10n.settings,
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colors.textPrimary),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            GlassContainer(
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
                      Expanded(
                        child: Text(
                          l10n.freeTitle,
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: colors.textPrimary),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(l10n.freeBody, style: TextStyle(fontSize: 13.5, height: 1.4, color: colors.textSecondary)),
                ],
              ),
            ),
            const AccountSection(),
            section(l10n.appLanguage),
            SegmentedButton<String>(
              segments: [for (final code in supportedInstructionLanguages) ButtonSegment(value: code, label: Text(code == 'en' ? 'English' : 'Français'))],
              selected: {ui},
              showSelectedIcon: false,
              onSelectionChanged: (s) => notifier.setUiLanguage(s.first),
            ),
            section(l10n.display),
            const DisplaySettings(),
            section(l10n.yourCourses),
            for (final e in appState.learner.enrollments)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: GlassContainer(
                  level: e.courseId == appState.activeCourse?.id ? GlassLevel.level2 : GlassLevel.level1,
                  radius: 18,
                  padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
                  onTap: () => notifier.switchCourse(e.courseId),
                  child: Row(
                    children: [
                      Expanded(
                        // Tapping the row makes this the active course; say so to screen readers.
                        child: Semantics(
                          button: true,
                          selected: e.courseId == appState.activeCourse?.id,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                appState.content.track(e.trackId)?.name(ui) ?? e.trackId,
                                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: colors.textPrimary),
                              ),
                              Text(l10n.fromLanguage(e.source), style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
                            ],
                          ),
                        ),
                      ),
                      if (e.courseId == appState.activeCourse?.id)
                        Container(
                          margin: const EdgeInsets.only(right: 4),
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(color: accent.primarySoft, borderRadius: BorderRadius.circular(8)),
                          child: Text(
                            l10n.activeCourse,
                            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: accent.primaryText),
                          ),
                        ),
                      TextButton(
                        onPressed: () async {
                          final name = appState.content.track(e.trackId)?.name(ui) ?? e.trackId;
                          if (await _confirm(context, title: l10n.removeCourseTitle(name), body: l10n.removeCourseBody, confirm: l10n.removeCourse)) {
                            notifier.unenroll(e.courseId);
                          }
                        },
                        child: Text(
                          l10n.removeCourse,
                          style: TextStyle(color: colors.error, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                foregroundColor: accent.primaryText,
                side: BorderSide(color: colors.borderStrong),
              ),
              icon: const Icon(LucideIcons.plus, size: 18),
              label: Text(l10n.addCourse),
              onPressed: () => context.push('/catalog'),
            ),
            section(l10n.yourData),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(switch (ref.watch(accountProvider)) {
                AccountState(available: false) => l10n.yourDataBody,
                AccountState(user: null) => l10n.yourDataBodySignedOut,
                _ => l10n.yourDataBodyAccount,
              }, style: TextStyle(fontSize: 13.5, height: 1.4, color: colors.textSecondary)),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                foregroundColor: colors.error,
                side: BorderSide(color: colors.error),
              ),
              icon: const Icon(LucideIcons.trash2, size: 18),
              label: Text(l10n.resetAll),
              onPressed: () async {
                if (await _confirm(context, title: l10n.resetAllTitle, body: l10n.resetAllBody, confirm: l10n.resetConfirm)) {
                  // Everything this device keeps about the learning: progress, what was said out loud, lessons heard, calls.
                  notifier.resetAll();
                  ref.read(speakingStatsProvider.notifier).clear();
                  ref.read(audioListenedProvider.notifier).clear();
                  ref.read(callHistoryProvider.notifier).clear();
                }
              },
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: () => showLicensePage(context: context, applicationName: l10n.appTitle),
              child: Text(l10n.openSourceLicenses, style: TextStyle(color: colors.textSecondary)),
            ),
          ],
        ),
      ),
    );
  }
}
