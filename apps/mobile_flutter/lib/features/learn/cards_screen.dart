import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';

/// L3 — discovery cards: every phrase the learner says in this mission, one per swipeable card (target script,
/// romanization, meaning, usage note), tap to hear when the device has a voice for the variety. Finishing the
/// last card completes the Learn stop.
class CardsScreen extends ConsumerStatefulWidget {
  final String missionKey;
  const CardsScreen({super.key, required this.missionKey});

  @override
  ConsumerState<CardsScreen> createState() => _CardsScreenState();
}

class _CardsScreenState extends ConsumerState<CardsScreen> {
  final PageController _pages = PageController();
  int _page = 0;
  late final SpeechService _speech;

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
  }

  @override
  void dispose() {
    _speech.stop();
    _pages.dispose();
    super.dispose();
  }

  void _next(MissionLearnPlan plan) {
    if (_page < plan.phrases.length - 1) {
      _pages.nextPage(duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
    } else {
      ref.read(appStateProvider.notifier).completeStop(widget.missionKey, PathStop.learn);
      context.pushReplacement('/learn/${widget.missionKey}/practice');
    }
  }

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(learnPlanProvider(widget.missionKey));
    if (plan == null || plan.phrases.isEmpty) return const MissionUnavailable();
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final last = _page >= plan.phrases.length - 1;

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            LearnTopBar(
              title: l10n.cardsTitle(plan.mission.titleIn(plan.source) ?? ''),
              step: _page + 1,
              total: plan.phrases.length,
              onClose: () => context.popOrHome(),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pages,
                itemCount: plan.phrases.length,
                onPageChanged: (i) {
                  _speech.stop();
                  setState(() => _page = i);
                },
                itemBuilder: (context, i) {
                  final phrase = plan.phrases[i];
                  final note = plan.noteOf(phrase);
                  // Code-switch and pronunciation notes exist in English only: shown to learners taught from English.
                  final extraNotes = plan.source == 'en' ? [phrase.codeSwitchNote, phrase.pronunciationNote].whereType<String>().toList() : const <String>[];
                  return Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    child: Container(
                      decoration: BoxDecoration(
                        color: colors.surface,
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: colors.border),
                        boxShadow: [BoxShadow(color: accent.primary.withValues(alpha: 0.12), blurRadius: 24, offset: const Offset(0, 8))],
                      ),
                      padding: const EdgeInsets.all(20),
                      // FittedBox keeps a long phrase inside the card on a small phone instead of overflowing.
                      child: Center(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: ConstrainedBox(
                            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width - 72),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Semantics(
                                  header: true,
                                  child: TargetText(expression: phrase, track: plan.track, fontSize: 32, textAlign: TextAlign.center),
                                ),
                                const SizedBox(height: 14),
                                Text(
                                  plan.meaningOf(phrase),
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w600, color: accent.primaryText),
                                ),
                                const SizedBox(height: 16),
                                ListenButtons(text: phrase.text, locale: plan.voiceLocale),
                                for (final n in [?note, ...extraNotes]) ...[const SizedBox(height: 12), _NoteBox(text: n, label: l10n.noteLabel)],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: LearnPrimaryButton(
                label: last ? l10n.cardsPractise : l10n.cardsNextPhrase,
                icon: last ? LucideIcons.gamepad2 : LucideIcons.chevronRight,
                onPressed: () => _next(plan),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NoteBox extends ConsumerWidget {
  final String text;
  final String label;
  const _NoteBox({required this.text, required this.label});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(14)),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: '$label · ',
              style: TextStyle(fontWeight: FontWeight.w700, color: colors.textSecondary),
            ),
            TextSpan(text: text),
          ],
        ),
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 13.5, height: 1.35, color: colors.textSecondary),
      ),
    );
  }
}
