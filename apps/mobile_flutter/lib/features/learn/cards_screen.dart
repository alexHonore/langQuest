import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_widgets.dart';

/// L3 — discovery cards: the phrases the mission needs, one per swipeable card (target text,
/// pronunciation, meaning, one example), tap to hear. Finishing the last card completes the Learn stop.
class CardsScreen extends ConsumerStatefulWidget {
  final String missionId;
  const CardsScreen({super.key, required this.missionId});

  @override
  ConsumerState<CardsScreen> createState() => _CardsScreenState();
}

class _CardsScreenState extends ConsumerState<CardsScreen> {
  final PageController _pages = PageController();
  int _page = 0;
  late final SpeechService _speech;

  MissionLearnPlan get _plan => LearnContent.forMission(widget.missionId)!;

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

  void _next() {
    final plan = _plan;
    if (_page < plan.phrases.length - 1) {
      _pages.nextPage(duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
    } else {
      ref.read(appStateProvider.notifier).completeStop(widget.missionId, PathStop.learn);
      context.pushReplacement('/learn/${widget.missionId}/practice');
    }
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final plan = _plan;
    final mission = appState.missions.firstWhere((m) => m.id == widget.missionId, orElse: () => appState.missions.first);
    final last = _page == plan.phrases.length - 1;

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(children: [
          LearnTopBar(title: 'New phrases · ${mission.title}', step: _page + 1, total: plan.phrases.length, onClose: () => context.pop()),
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
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            Semantics(
                              header: true,
                              child: Text(phrase.text, textAlign: TextAlign.center, style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: colors.textPrimary, height: 1.15)),
                            ),
                            const SizedBox(height: 8),
                            Text(phrase.pronunciation, textAlign: TextAlign.center, style: TextStyle(fontSize: 15, fontStyle: FontStyle.italic, color: colors.textMuted)),
                            const SizedBox(height: 12),
                            Text(phrase.meaning, textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: accent.primaryText)),
                            const SizedBox(height: 18),
                            ListenButtons(text: phrase.text, locale: plan.voiceLocale),
                            const SizedBox(height: 22),
                            Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(14)),
                              child: Column(children: [
                                Text('“${phrase.example}”', textAlign: TextAlign.center, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: colors.textPrimary)),
                                const SizedBox(height: 4),
                                Text(phrase.exampleMeaning, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: colors.textSecondary)),
                                const SizedBox(height: 6),
                                ListenButtons(text: phrase.example, locale: plan.voiceLocale, compact: true),
                              ]),
                            ),
                          ]),
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
            child: LearnPrimaryButton(label: last ? 'Practise' : 'Next phrase', icon: last ? LucideIcons.gamepad2 : LucideIcons.chevronRight, onPressed: _next),
          ),
        ]),
      ),
    );
  }
}
