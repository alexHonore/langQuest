import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/server_voice.dart';
import '../../core/layout/spaced_page.dart';
import '../../core/services/app_state.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_providers.dart';
import '../learn/learn_widgets.dart';
import '../learn/record_take.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';

/// The end of the first run (the Expo app's onboarding warm-up): the new course's first phrase to look at, hear and,
/// where the device can record, say back and compare. Low pressure: nothing is scored or credited, and the microphone
/// is asked for only when the learner taps Record. Shown once, after the first enrollment.
class WarmupScreen extends ConsumerWidget {
  const WarmupScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final course = appState.activeCourse;
    final plan = course == null || course.missions.isEmpty ? null : ref.watch(learnPlanProvider(course.missions.first.key));
    final phrase = plan == null || plan.phrases.isEmpty ? null : plan.phrases.first;
    // "Listen" only when there is something to listen to (no device voice for Darija, nor in some browsers).
    final voiceLocale = plan?.voiceLocale;
    final hasVoice = ref.watch(lineVoiceProvider(voiceLocale)).asData?.value.available ?? false;

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: SpacedPage(
          top: [
            MeloWidget(state: MeloState.welcome, courseTrackId: appState.activeTrackId, size: 88),
            const SizedBox(height: 16),
            Semantics(
              header: true,
              child: Text(
                l10n.warmupTitle,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, height: 1.2, color: colors.textPrimary),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              hasVoice ? l10n.warmupBody : l10n.warmupBodyNoVoice,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15, height: 1.45, color: colors.textSecondary),
            ),
            if (phrase != null && plan != null) ...[
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: colors.border),
                ),
                child: Column(
                  children: [
                    TargetText(expression: phrase, track: plan.track, fontSize: 26, textAlign: TextAlign.center),
                    const SizedBox(height: 8),
                    Text(
                      plan.meaningOf(phrase),
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 16, color: colors.textSecondary),
                    ),
                    const SizedBox(height: 16),
                    ListenButtons(text: phrase.text, expressionId: phrase.id, locale: plan.voiceLocale),
                    const SizedBox(height: 12),
                    RecordTake(voiceLocale: plan.voiceLocale, centered: true),
                  ],
                ),
              ),
            ],
          ],
          bottom: [LearnPrimaryButton(label: l10n.warmupContinue, icon: LucideIcons.chevronRight, onPressed: () => context.go('/'))],
        ),
      ),
    );
  }
}
