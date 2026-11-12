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
import 'real_examples_sheet.dart';

/// L3 — discovery cards: every phrase the learner says in this mission, one per swipeable card (target script,
/// romanization, meaning, then what helps to make it one's own: its words one by one, when to use it, how to say
/// it), tap to hear when the device has a voice for the variety. Finishing the last card completes the Learn stop.
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
                  final literal = plan.literalOf(phrase);
                  // Code-switch and pronunciation notes exist in English only: shown to learners taught from English.
                  final english = plan.source == 'en';
                  return Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    child: Container(
                      decoration: BoxDecoration(
                        color: colors.surface,
                        borderRadius: BorderRadius.circular(26),
                        border: Border.all(color: colors.border),
                        boxShadow: [BoxShadow(color: accent.primary.withValues(alpha: 0.12), blurRadius: 24, offset: const Offset(0, 8))],
                      ),
                      // The phrase first, then what helps to make it one's own; a long card scrolls.
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(25),
                        child: LayoutBuilder(
                          builder: (context, box) => SingleChildScrollView(
                            padding: const EdgeInsets.all(20),
                            child: ConstrainedBox(
                              constraints: BoxConstraints(minHeight: box.maxHeight - 40),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Semantics(
                                    header: true,
                                    child: TargetText(expression: phrase, track: plan.track, fontSize: 32, textAlign: TextAlign.center),
                                  ),
                                  const SizedBox(height: 14),
                                  Text(
                                    plan.meaningOf(phrase),
                                    textAlign: TextAlign.center,
                                    style: TextStyle(fontSize: 19, height: 1.3, fontWeight: FontWeight.w600, color: accent.primaryText),
                                  ),
                                  const SizedBox(height: 16),
                                  ListenButtons(text: phrase.text, expressionId: phrase.id, locale: plan.voiceLocale),
                                  RealExamplesButton(expression: phrase, track: plan.track, source: plan.source),
                                  if (literal != null) ...[
                                    const SizedBox(height: 12),
                                    _NoteBox(icon: LucideIcons.wholeWord, label: l10n.literalLabel, text: literal),
                                  ],
                                  if (note != null) ...[const SizedBox(height: 10), _NoteBox(icon: LucideIcons.lightbulb, label: l10n.noteLabel, text: note)],
                                  if (english && phrase.pronunciationNote != null) ...[
                                    const SizedBox(height: 10),
                                    _NoteBox(icon: LucideIcons.audioWaveform, label: l10n.pronunciationLabel, text: phrase.pronunciationNote!),
                                  ],
                                  if (english && phrase.codeSwitchNote != null) ...[
                                    const SizedBox(height: 10),
                                    _NoteBox(icon: LucideIcons.lightbulb, label: l10n.noteLabel, text: phrase.codeSwitchNote!),
                                  ],
                                ],
                              ),
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

/// What helps with a phrase, under it: its words one by one, when to use it, how to say it.
class _NoteBox extends ConsumerWidget {
  final IconData icon;
  final String text;
  final String label;
  const _NoteBox({required this.icon, required this.text, required this.label});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(16)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 16, color: colors.textMuted),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: colors.textMuted),
                ),
                const SizedBox(height: 2),
                Text(text, style: TextStyle(fontSize: 14, height: 1.35, color: colors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
