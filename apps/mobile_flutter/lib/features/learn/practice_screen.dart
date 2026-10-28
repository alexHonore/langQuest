import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_widgets.dart';

/// L3 — practise what was just taught: (1) match each phrase with its meaning, (2) rebuild one
/// sentence from tiles. No score; a wrong pick flashes and you try again. Finishing completes the
/// Practise stop and leads to the mission's spoken steps. Fits the screen (4 pairs, one sentence).
class PracticeScreen extends ConsumerStatefulWidget {
  final String missionId;
  const PracticeScreen({super.key, required this.missionId});

  @override
  ConsumerState<PracticeScreen> createState() => _PracticeScreenState();
}

class _PracticeScreenState extends ConsumerState<PracticeScreen> {
  late PairsState _pairs;
  late TilesState _tiles;
  bool _onTiles = false;
  Timer? _wrongTimer;
  late final SpeechService _speech;

  MissionLearnPlan get _plan => LearnContent.forMission(widget.missionId)!;

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
    final plan = _plan;
    _pairs = PairsState.start([for (final p in plan.phrases) (id: p.id, phrase: p.text, meaning: p.meaning)], plan.missionId);
    _tiles = TilesState.start(plan.tiles.answer, plan.tiles.distractors, plan.missionId);
  }

  @override
  void dispose() {
    _wrongTimer?.cancel();
    _speech.stop();
    super.dispose();
  }

  void _tapPair(PairsCard card) {
    final plan = _plan;
    if (card.side == PairSide.phrase) {
      // Hearing the phrase while matching is part of the learning, not a hint penalty.
      ref.read(voiceAvailableProvider(plan.voiceLocale).future).then((ok) {
        if (ok && mounted) _speech.speak(card.label, locale: plan.voiceLocale);
      });
    }
    setState(() => _pairs = _pairs.tap(card));
    if (_pairs.wrongKeys.isNotEmpty) {
      _wrongTimer?.cancel();
      _wrongTimer = Timer(const Duration(milliseconds: 700), () {
        if (mounted) setState(() => _pairs = _pairs.clearWrong());
      });
    }
  }

  void _finish() {
    ref.read(appStateProvider.notifier).completeStop(widget.missionId, PathStop.practise);
    context.pushReplacement('/mission/${widget.missionId}');
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final mission = appState.missions.firstWhere((m) => m.id == widget.missionId, orElse: () => appState.missions.first);

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(children: [
          LearnTopBar(title: 'Practise · ${mission.title}', step: _onTiles ? 2 : 1, total: 2, onClose: () => context.pop()),
          Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: _onTiles ? _tilesView() : _pairsView())),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: _onTiles
                ? (_tiles.verdict == TilesVerdict.correct
                    ? LearnPrimaryButton(label: 'Start the mission', icon: LucideIcons.flag, onPressed: _finish)
                    : LearnPrimaryButton(label: 'Check', onPressed: _tiles.placed.isEmpty ? null : () => setState(() => _tiles = _tiles.check())))
                : LearnPrimaryButton(label: 'Build a sentence', icon: LucideIcons.chevronRight, onPressed: _pairs.finished ? () => setState(() => _onTiles = true) : null),
          ),
        ]),
      ),
    );
  }

  Widget _pairsView() {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;

    Widget card(PairsCard c) {
      final matched = _pairs.matched.contains(c.pairId);
      final wrong = _pairs.wrongKeys.contains(c.key);
      final selected = _pairs.selected?.key == c.key;
      final border = matched ? colors.success : wrong ? colors.error : selected ? accent.primary : colors.border;
      final fill = matched ? colors.successSoft : wrong ? colors.errorSoft : selected ? accent.primarySoft : colors.surface;
      return Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Semantics(
            button: true,
            selected: selected,
            label: '${c.label}${matched ? ', matched' : ''}',
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: matched ? null : () => _tapPair(c),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(color: fill, borderRadius: BorderRadius.circular(14), border: Border.all(color: border, width: selected || wrong || matched ? 2 : 1)),
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(c.label, textAlign: TextAlign.center, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: matched ? colors.textMuted : colors.textPrimary)),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 8),
      Row(children: [
        MeloWidget(state: _pairs.finished ? MeloState.celebrate : MeloState.thinking, courseTrackId: appState.activeTrackId, size: 52),
        const SizedBox(width: 10),
        Expanded(child: Text(_pairs.finished ? 'All matched!' : 'Match each phrase with its meaning', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: colors.textPrimary))),
      ]),
      const SizedBox(height: 12),
      Expanded(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(child: Column(children: [for (final c in _pairs.phrases) card(c)])),
          const SizedBox(width: 10),
          Expanded(child: Column(children: [for (final c in _pairs.meanings) card(c)])),
        ]),
      ),
    ]);
  }

  Widget _tilesView() {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final plan = _plan;
    final verdict = _tiles.verdict;

    Widget tile(TileItem t, {required bool inSentence}) => Semantics(
          button: true,
          label: inSentence ? '${t.text}, remove' : t.text,
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => setState(() => _tiles = inSentence ? _tiles.remove(t) : _tiles.place(t)),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: inSentence ? accent.primarySoft : colors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: inSentence ? accent.primary : colors.border),
              ),
              child: Text(t.text, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: colors.textPrimary)),
            ),
          ),
        );

    final placed = [for (final i in _tiles.placed) _tiles.bank.firstWhere((t) => t.index == i)];
    final sentenceBorder = verdict == TilesVerdict.correct ? colors.success : verdict == TilesVerdict.wrong ? colors.error : colors.border;

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SizedBox(height: 8),
      Row(children: [
        MeloWidget(state: verdict == TilesVerdict.correct ? MeloState.celebrate : verdict == TilesVerdict.wrong ? MeloState.thinking : MeloState.curious, courseTrackId: appState.activeTrackId, size: 52),
        const SizedBox(width: 10),
        Expanded(child: Text('Build it in French', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: colors.textPrimary))),
      ]),
      const SizedBox(height: 10),
      Text(plan.tiles.prompt, style: TextStyle(fontSize: 17, color: colors.textSecondary)),
      const SizedBox(height: 14),
      Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 72),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(16), border: Border.all(color: sentenceBorder, width: verdict == TilesVerdict.building ? 1 : 2)),
        child: Wrap(spacing: 8, runSpacing: 8, children: [for (final t in placed) tile(t, inSentence: true)]),
      ),
      const SizedBox(height: 8),
      if (verdict == TilesVerdict.wrong)
        Text('Not quite — tap a word to take it back.', style: TextStyle(fontSize: 14, color: colors.error)).animate().fadeIn(duration: 200.ms),
      if (verdict == TilesVerdict.correct)
        Row(children: [
          Icon(LucideIcons.check, size: 18, color: colors.success),
          const SizedBox(width: 6),
          Expanded(child: Text(_tiles.answer.join(' '), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.success))),
          ListenButtons(text: _tiles.answer.join(' '), locale: plan.voiceLocale, compact: true),
        ]).animate().fadeIn(duration: 200.ms),
      const SizedBox(height: 14),
      // Once solved, the leftover distractors disappear: only the sentence remains.
      if (verdict != TilesVerdict.correct)
        Wrap(spacing: 8, runSpacing: 8, children: [for (final t in _tiles.bank) if (!_tiles.isPlaced(t)) tile(t, inSentence: false)]),
    ]);
  }
}
