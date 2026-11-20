import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_models.dart';
import '../../core/layout/spaced_page.dart';
import '../../core/services/app_state.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_widgets.dart';
import '../account/display_settings.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';

/// First run: what LangQuest is, and the interface language (English or French).
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
        child: SpacedPage(
          top: [
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
          ],
          bottom: [
            Text(
              l10n.welcomeLanguageLabel,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.textMuted),
            ),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: [for (final code in supportedInstructionLanguages) ButtonSegment(value: code, label: Text(code == 'en' ? 'English' : 'Français'))],
              selected: {appState.uiLanguage},
              showSelectedIcon: false,
              onSelectionChanged: (s) => ref.read(appStateProvider.notifier).setUiLanguage(s.first),
            ),
            const SizedBox(height: 20),
            const SpeakerFormPicker(),
            const SizedBox(height: 20),
            LearnPrimaryButton(label: l10n.welcomeContinue, icon: LucideIcons.chevronRight, onPressed: () => context.push('/welcome/courses')),
          ],
        ),
      ),
    );
  }
}
