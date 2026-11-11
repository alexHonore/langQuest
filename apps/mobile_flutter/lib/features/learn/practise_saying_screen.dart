import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/speech_check.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';
import 'real_examples_sheet.dart';
import 'record_take.dart';

/// Practise saying a mission's phrases, one at a time: hear the reference, record yourself, play both back. The
/// listen / record / compare coach of ADR-006 — no pronunciation score (no acoustic assessor here), nothing credited on
/// this device; a signed-in learner whose course the server can check is told whether each take was understood.
/// Opened from the mission path once its Learn stop is done, only where the device can record.
class PractiseSayingScreen extends ConsumerStatefulWidget {
  final String missionKey;

  const PractiseSayingScreen({super.key, required this.missionKey});

  @override
  ConsumerState<PractiseSayingScreen> createState() => _PractiseSayingScreenState();
}

class _PractiseSayingScreenState extends ConsumerState<PractiseSayingScreen> {
  int _index = 0;
  late final SpeechService _speech;

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
  }

  @override
  void dispose() {
    _speech.stop();
    super.dispose();
  }

  void _go(int index) {
    _speech.stop();
    setState(() => _index = index);
  }

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(learnPlanProvider(widget.missionKey));
    if (plan == null || plan.phrases.isEmpty) return const MissionUnavailable();
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final index = _index.clamp(0, plan.phrases.length - 1);
    final phrase = plan.phrases[index];
    final last = index == plan.phrases.length - 1;
    final note = plan.noteOf(phrase);

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            LearnTopBar(
              title: l10n.practiseSayingTitle(plan.mission.titleIn(plan.source) ?? ''),
              step: index + 1,
              total: plan.phrases.length,
              onClose: () => context.popOrHome(),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      key: ValueKey('phrase-$index'),
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
                          if (note != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              note,
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 13, height: 1.35, color: colors.textMuted),
                            ),
                          ],
                          const SizedBox(height: 16),
                          ListenButtons(text: phrase.text, expressionId: phrase.id, locale: plan.voiceLocale),
                          RealExamplesButton(expression: phrase, track: plan.track, source: plan.source),
                          const SizedBox(height: 12),
                          // A fresh recorder per phrase: the previous take is dropped with it.
                          RecordTake(
                            key: ValueKey('say-$index'),
                            voiceLocale: plan.voiceLocale,
                            centered: true,
                            check: SpeechTarget(expressionId: phrase.id, chapterKey: plan.mission.chapterKey, missionKey: plan.mission.key),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      ref.watch(speechCheckerProvider) == null ? l10n.practiseSayingNote : l10n.practiseSayingNoteChecked,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12.5, height: 1.4, color: colors.textMuted),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Row(
                children: [
                  if (index > 0) ...[
                    IconButton.outlined(icon: const Icon(LucideIcons.chevronLeft), tooltip: l10n.previousPhrase, onPressed: () => _go(index - 1)),
                    const SizedBox(width: 10),
                  ],
                  Expanded(
                    child: LearnPrimaryButton(
                      label: last ? l10n.practiseSayingDone : l10n.cardsNextPhrase,
                      icon: last ? LucideIcons.check : LucideIcons.chevronRight,
                      onPressed: last ? () => context.popOrHome() : () => _go(index + 1),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
