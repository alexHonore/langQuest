import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';

/// L3 — practise what was just taught: (1) match each phrase with its meaning, in rounds of at most five pairs,
/// (2) rebuild one sentence from tiles. No score; a wrong pick flashes and you try again. Finishing completes the
/// Practise stop and leads to the mission's spoken exchanges.
class PracticeScreen extends ConsumerStatefulWidget {
  final String missionKey;
  const PracticeScreen({super.key, required this.missionKey});

  @override
  ConsumerState<PracticeScreen> createState() => _PracticeScreenState();
}

class _PracticeScreenState extends ConsumerState<PracticeScreen> {
  int _round = 0;
  PairsState? _pairs;
  TilesState? _tiles;
  bool _onTiles = false;
  Timer? _wrongTimer;
  late final SpeechService _speech;

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
  }

  @override
  void dispose() {
    _wrongTimer?.cancel();
    _speech.stop();
    super.dispose();
  }

  PairsState _pairsFor(MissionLearnPlan plan, int round) =>
      PairsState.start([for (final e in plan.pairRounds[round]) (id: e.id, phrase: e.text, meaning: plan.shortMeaningOf(e))], '${plan.mission.key}/$round');

  void _tapPair(MissionLearnPlan plan, PairsCard card) {
    final pairs = _pairs!;
    final locale = plan.voiceLocale;
    if (card.side == PairSide.phrase && locale != null) {
      // Hearing the phrase while matching is part of the learning, not a hint penalty.
      ref.read(voiceAvailableProvider(locale).future).then((ok) {
        if (ok && mounted) _speech.speak(card.label, locale: locale);
      });
    }
    final next = pairs.tap(card);
    setState(() => _pairs = next);
    if (next.wrongKeys.isNotEmpty) {
      _wrongTimer?.cancel();
      _wrongTimer = Timer(const Duration(milliseconds: 700), () {
        if (mounted) setState(() => _pairs = _pairs?.clearWrong());
      });
    }
  }

  void _afterPairs(MissionLearnPlan plan) {
    if (_round < plan.pairRounds.length - 1) {
      setState(() {
        _round++;
        _pairs = _pairsFor(plan, _round);
      });
    } else if (plan.tiles != null) {
      setState(() => _onTiles = true);
    } else {
      _finish();
    }
  }

  void _finish() {
    ref.read(appStateProvider.notifier).completeStop(widget.missionKey, PathStop.practise);
    context.pushReplacement('/mission/${widget.missionKey}');
  }

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(learnPlanProvider(widget.missionKey));
    if (plan == null || plan.pairRounds.isEmpty) return const MissionUnavailable();
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final pairs = _pairs ??= _pairsFor(plan, _round.clamp(0, plan.pairRounds.length - 1));
    final tilesPlan = plan.tiles;
    final tiles = tilesPlan == null ? null : (_tiles ??= TilesState.start(tilesPlan.answer, tilesPlan.distractors, plan.mission.key));
    final totalSteps = plan.pairRounds.length + (tilesPlan == null ? 0 : 1);
    final step = _onTiles ? totalSteps : _round + 1;
    final lastPairsRound = _round >= plan.pairRounds.length - 1;

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            LearnTopBar(title: l10n.practiseTitle(plan.mission.titleIn(plan.source) ?? ''), step: step, total: totalSteps, onClose: () => context.popOrHome()),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _onTiles && tiles != null && tilesPlan != null ? _tilesView(plan, tilesPlan, tiles) : _pairsView(plan, pairs),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: _onTiles && tiles != null
                  ? (tiles.verdict == TilesVerdict.correct
                        ? LearnPrimaryButton(label: l10n.startMission, icon: LucideIcons.flag, onPressed: _finish)
                        : LearnPrimaryButton(label: l10n.tilesCheck, onPressed: tiles.placed.isEmpty ? null : () => setState(() => _tiles = tiles.check())))
                  : LearnPrimaryButton(
                      label: !lastPairsRound ? l10n.pairsNextRound : (tilesPlan != null ? l10n.pairsBuildSentence : l10n.startMission),
                      icon: !lastPairsRound || tilesPlan != null ? LucideIcons.chevronRight : LucideIcons.flag,
                      onPressed: pairs.finished ? () => _afterPairs(plan) : null,
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pairsView(MissionLearnPlan plan, PairsState pairs) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final romanizationById = {for (final e in plan.pairRounds.expand((r) => r)) e.id: e.romanization};

    Widget card(PairsCard c) {
      final matched = pairs.matched.contains(c.pairId);
      final wrong = pairs.wrongKeys.contains(c.key);
      final selected = pairs.selected?.key == c.key;
      final border = matched
          ? colors.success
          : wrong
          ? colors.error
          : selected
          ? accent.primary
          : colors.border;
      final fill = matched
          ? colors.successSoft
          : wrong
          ? colors.errorSoft
          : selected
          ? accent.primarySoft
          : colors.surface;
      final isPhrase = c.side == PairSide.phrase;
      final romanization = isPhrase ? romanizationById[c.pairId] : null;
      return Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Semantics(
            button: true,
            selected: selected,
            label: matched ? l10n.matchedSemantics(c.label) : c.label,
            excludeSemantics: true,
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: matched ? null : () => _tapPair(plan, c),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: fill,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: border, width: selected || wrong || matched ? 2 : 1),
                ),
                // Wrap within the card first; shrink only when the wrapped text is still too tall.
                child: LayoutBuilder(
                  builder: (context, box) => FittedBox(
                    fit: BoxFit.scaleDown,
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: box.maxWidth),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            c.label,
                            textAlign: TextAlign.center,
                            textDirection: isPhrase && plan.track.rtl ? TextDirection.rtl : null,
                            style: TextStyle(
                              fontSize: isPhrase ? 17 : 15,
                              height: 1.25,
                              fontWeight: FontWeight.w600,
                              color: matched ? colors.textMuted : colors.textPrimary,
                            ),
                          ),
                          if (romanization != null)
                            Text(
                              romanization,
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: colors.textMuted),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        Row(
          children: [
            MeloWidget(state: pairs.finished ? MeloState.celebrate : MeloState.thinking, courseTrackId: appState.activeTrackId, size: 52),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                pairs.finished ? l10n.pairsDone : l10n.pairsPrompt,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: colors.textPrimary),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: Column(children: [for (final c in pairs.phrases) card(c)])),
              const SizedBox(width: 10),
              Expanded(child: Column(children: [for (final c in pairs.meanings) card(c)])),
            ],
          ),
        ),
      ],
    );
  }

  Widget _tilesView(MissionLearnPlan plan, TileChallenge challenge, TilesState tiles) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final verdict = tiles.verdict;

    Widget tile(TileItem t, {required bool inSentence}) => Semantics(
      button: true,
      label: inSentence ? l10n.tilesRemoveSemantics(t.text) : t.text,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => setState(() => _tiles = inSentence ? tiles.remove(t) : tiles.place(t)),
        child: Container(
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: inSentence ? accent.primarySoft : colors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: inSentence ? accent.primary : colors.border),
          ),
          child: Text(
            t.text,
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: colors.textPrimary),
          ),
        ),
      ),
    );

    final placed = [for (final i in tiles.placed) tiles.bank.firstWhere((t) => t.index == i)];
    final sentenceBorder = verdict == TilesVerdict.correct
        ? colors.success
        : verdict == TilesVerdict.wrong
        ? colors.error
        : colors.border;

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          Row(
            children: [
              MeloWidget(
                state: verdict == TilesVerdict.correct
                    ? MeloState.celebrate
                    : verdict == TilesVerdict.wrong
                    ? MeloState.thinking
                    : MeloState.curious,
                courseTrackId: appState.activeTrackId,
                size: 52,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  l10n.tilesPrompt,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: colors.textPrimary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(plan.shortMeaningOf(challenge.expression), style: TextStyle(fontSize: 17, color: colors.textSecondary)),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(minHeight: 72),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: colors.surfaceMuted,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: sentenceBorder, width: verdict == TilesVerdict.building ? 1 : 2),
            ),
            child: Wrap(spacing: 8, runSpacing: 8, children: [for (final t in placed) tile(t, inSentence: true)]),
          ),
          const SizedBox(height: 8),
          if (verdict == TilesVerdict.wrong) Text(l10n.tilesWrong, style: TextStyle(fontSize: 14, color: colors.error)).animate().fadeIn(duration: 200.ms),
          if (verdict == TilesVerdict.correct)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Icon(LucideIcons.check, size: 18, color: colors.success),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: TargetText(expression: challenge.expression, track: plan.track, fontSize: 18, color: colors.success),
                ),
                ListenButtons(text: challenge.expression.text, locale: plan.voiceLocale, compact: true),
              ],
            ).animate().fadeIn(duration: 200.ms),
          const SizedBox(height: 14),
          // Once solved, the leftover distractors disappear: only the sentence remains.
          if (verdict != TilesVerdict.correct)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final t in tiles.bank)
                  if (!tiles.isPlaced(t)) tile(t, inSentence: false),
              ],
            ),
        ],
      ),
    );
  }
}
