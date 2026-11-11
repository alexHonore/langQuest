import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/backend/server_voice.dart';
import '../../core/content/content_models.dart';
import '../../core/services/speech_service.dart';
import '../../l10n/l10n.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import 'learn_content.dart';
import 'learn_logic.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';

/// L3 — practise what was just taught, in stages: (1) match each phrase with its meaning, in rounds of at most five
/// pairs; (2) listen to a phrase and choose its meaning; (3) read a meaning and choose the phrase that says it;
/// (4) complete a phrase with its missing word; (5) rebuild one sentence from tiles. No score; a wrong pick flashes
/// and you try again. Finishing completes the Practise stop and leads to the mission's spoken exchanges.
class PracticeScreen extends ConsumerStatefulWidget {
  final String missionKey;
  const PracticeScreen({super.key, required this.missionKey});

  @override
  ConsumerState<PracticeScreen> createState() => _PracticeScreenState();
}

/// One stage of the practice.
sealed class _Stage {
  const _Stage();
}

class _PairsStage extends _Stage {
  final int round;
  const _PairsStage(this.round);
}

class _ChoiceStage extends _Stage {
  final ChoiceQuestion question;
  const _ChoiceStage(this.question);
}

class _GapStage extends _Stage {
  final GapChallenge gap;
  const _GapStage(this.gap);
}

class _TilesStage extends _Stage {
  final TileChallenge tiles;
  const _TilesStage(this.tiles);
}

List<_Stage> _stagesOf(MissionLearnPlan plan) => [
  for (var r = 0; r < plan.pairRounds.length; r++) _PairsStage(r),
  for (final q in plan.choices) _ChoiceStage(q),
  if (plan.gap != null) _GapStage(plan.gap!),
  if (plan.tiles != null) _TilesStage(plan.tiles!),
];

class _PracticeScreenState extends ConsumerState<PracticeScreen> {
  int _stage = 0;
  PairsState? _pairs;
  ChoiceState? _choice;
  TilesState? _tiles;
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

  /// The next stage, or the mission after the last one.
  void _next(MissionLearnPlan plan, List<_Stage> stages) {
    if (_stage >= stages.length - 1) return _finish();
    setState(() {
      _stage++;
      _pairs = null;
      _choice = null;
    });
    final stage = stages[_stage];
    if (stage is _ChoiceStage && stage.question.kind == ChoiceKind.listen) _say(plan, stage.question.expression);
  }

  /// Says a phrase with the course's voice (its bundled clip first), when one can.
  Future<void> _say(MissionLearnPlan plan, Expression e) async {
    final voice = await ref.read(lineVoiceProvider(plan.voiceLocale).future);
    if (mounted && voice.canSay(expressionId: e.id)) await voice.say(text: e.text, expressionId: e.id);
  }

  void _pick(MissionLearnPlan plan, ChoiceState state, int index, {Expression? say}) {
    final next = state.pick(index);
    setState(() => _choice = next);
    if (next.solved && say != null) _say(plan, say);
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
    final stages = _stagesOf(plan);
    final index = _stage.clamp(0, stages.length - 1);
    final stage = stages[index];
    final last = index == stages.length - 1;
    final following = last ? null : stages[index + 1];

    final Widget view;
    final bool solved;
    switch (stage) {
      case _PairsStage(:final round):
        final pairs = _pairs ??= _pairsFor(plan, round);
        view = _pairsView(plan, pairs);
        solved = pairs.finished;
      case _ChoiceStage(:final question):
        final choice = _choice ??= ChoiceState.start(question.answerIndex);
        view = _choiceView(plan, question, choice);
        solved = choice.solved;
      case _GapStage(:final gap):
        final choice = _choice ??= ChoiceState.start(gap.answerIndex);
        view = _gapView(plan, gap, choice);
        solved = choice.solved;
      case _TilesStage(:final tiles):
        final state = _tiles ??= TilesState.start(tiles.answer, tiles.distractors, plan.mission.key);
        view = _tilesView(plan, tiles, state);
        solved = state.verdict == TilesVerdict.correct;
    }

    final Widget button;
    if (stage is _TilesStage && !solved) {
      final tiles = _tiles!;
      button = LearnPrimaryButton(label: l10n.tilesCheck, onPressed: tiles.placed.isEmpty ? null : () => setState(() => _tiles = tiles.check()));
    } else {
      final label = last
          ? l10n.startMission
          : following is _TilesStage
          ? l10n.pairsBuildSentence
          : stage is _PairsStage && following is _PairsStage
          ? l10n.pairsNextRound
          : l10n.practiceNext;
      button = LearnPrimaryButton(label: label, icon: last ? LucideIcons.flag : LucideIcons.chevronRight, onPressed: solved ? () => _next(plan, stages) : null);
    }

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            LearnTopBar(
              title: l10n.practiseTitle(plan.mission.titleIn(plan.source) ?? ''),
              step: index + 1,
              total: stages.length,
              onClose: () => context.popOrHome(),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: KeyedSubtree(key: ValueKey(index), child: view),
              ),
            ),
            Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: button),
          ],
        ),
      ),
    );
  }

  /// The heading of a stage: Melo and the question.
  Widget _prompt(String text, MeloState state) {
    final appState = ref.watch(appStateProvider);
    return Row(
      children: [
        MeloWidget(state: state, courseTrackId: appState.activeTrackId, size: 52),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: appState.colors.textPrimary),
          ),
        ),
      ],
    );
  }

  /// One answer of a choice: neutral, marked wrong (it can be followed by another pick) or right once solved.
  Widget _option({required String semantics, required Widget child, required bool wrong, required bool right, required VoidCallback? onTap}) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Semantics(
        button: true,
        label: wrong ? l10n.practiceWrongSemantics(semantics) : (right ? l10n.practiceRightSemantics(semantics) : semantics),
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            width: double.infinity,
            constraints: const BoxConstraints(minHeight: 56),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: right ? colors.successSoft : (wrong ? colors.errorSoft : colors.surface),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: right ? colors.success : (wrong ? colors.error : colors.border), width: right || wrong ? 2 : 1),
            ),
            child: Align(alignment: AlignmentDirectional.centerStart, child: child),
          ),
        ),
      ),
    );
  }

  Widget _feedback(ChoiceState choice) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    if (choice.solved) {
      return Text(
        l10n.practiceRight,
        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.success),
      ).withMotion(context, (a) => a.fadeIn(duration: 200.ms));
    }
    if (choice.wrong.isNotEmpty) {
      return Text(l10n.practiceTryAgain, style: TextStyle(fontSize: 14, color: colors.error)).withMotion(context, (a) => a.fadeIn(duration: 200.ms));
    }
    return const SizedBox(height: 18);
  }

  /// Listen (hear → meaning; read it when no voice can say it) or reverse (meaning → phrase).
  Widget _choiceView(MissionLearnPlan plan, ChoiceQuestion q, ChoiceState choice) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final voice = ref.watch(lineVoiceProvider(plan.voiceLocale)).asData?.value;
    final canHear = voice != null && voice.canSay(expressionId: q.expression.id);
    final mood = choice.solved ? MeloState.celebrate : (choice.wrong.isNotEmpty ? MeloState.thinking : MeloState.curious);

    final Widget subject;
    final String prompt;
    if (q.kind == ChoiceKind.listen) {
      prompt = canHear ? l10n.practiceListenPrompt : l10n.practiceReadPrompt;
      subject = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (canHear) ListenButtons(text: q.expression.text, expressionId: q.expression.id, locale: plan.voiceLocale),
          // Without a voice the phrase is read; with one, it shows once understood.
          if (!canHear || choice.solved) ...[
            const SizedBox(height: 10),
            TargetText(expression: q.expression, track: plan.track, fontSize: 22, color: choice.solved ? colors.success : null),
          ],
        ],
      );
    } else {
      prompt = l10n.practiceReversePrompt;
      subject = Text(
        plan.shortMeaningOf(q.expression),
        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: colors.textSecondary),
      );
    }

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          _prompt(prompt, mood),
          const SizedBox(height: 16),
          subject,
          const SizedBox(height: 16),
          for (var i = 0; i < q.options.length; i++)
            _option(
              semantics: q.kind == ChoiceKind.listen ? plan.shortMeaningOf(q.options[i]) : q.options[i].text,
              wrong: choice.isWrong(i),
              right: choice.solved && i == choice.answer,
              onTap: choice.solved || choice.isWrong(i) ? null : () => _pick(plan, choice, i, say: q.kind == ChoiceKind.reverse ? q.expression : null),
              child: q.kind == ChoiceKind.listen
                  ? Text(
                      plan.shortMeaningOf(q.options[i]),
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: colors.textPrimary),
                    )
                  : TargetText(expression: q.options[i], track: plan.track, fontSize: 18),
            ),
          const SizedBox(height: 6),
          _feedback(choice),
        ],
      ),
    );
  }

  /// A phrase with one word missing, and three words to choose from.
  Widget _gapView(MissionLearnPlan plan, GapChallenge gap, ChoiceState choice) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final mood = choice.solved ? MeloState.celebrate : (choice.wrong.isNotEmpty ? MeloState.thinking : MeloState.curious);
    final wordStyle = TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: colors.textPrimary);

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          _prompt(l10n.practiceGapPrompt, mood),
          const SizedBox(height: 10),
          Text(plan.shortMeaningOf(gap.expression), style: TextStyle(fontSize: 17, color: colors.textSecondary)),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colors.surfaceMuted,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: choice.solved ? colors.success : colors.border, width: choice.solved ? 2 : 1),
            ),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (var i = 0; i < gap.words.length; i++)
                  if (i != gap.gap)
                    Text(gap.words[i], style: wordStyle)
                  else if (choice.solved)
                    Text(gap.words[i], style: wordStyle.copyWith(color: colors.success))
                  else
                    Semantics(
                      label: l10n.practiceGapSemantics,
                      child: Container(
                        width: 72,
                        height: 30,
                        decoration: BoxDecoration(
                          border: Border(bottom: BorderSide(color: accent.primary, width: 2)),
                        ),
                      ),
                    ),
              ],
            ),
          ),
          if (choice.solved) ...[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TargetText(expression: gap.expression, track: plan.track, fontSize: 18, color: colors.success),
                ),
                ListenButtons(text: gap.expression.text, expressionId: gap.expression.id, locale: plan.voiceLocale, compact: true),
              ],
            ).withMotion(context, (a) => a.fadeIn(duration: 200.ms)),
          ],
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (var i = 0; i < gap.options.length; i++)
                SizedBox(
                  width: 150,
                  child: _option(
                    semantics: gap.options[i],
                    wrong: choice.isWrong(i),
                    right: choice.solved && i == choice.answer,
                    onTap: choice.solved || choice.isWrong(i) ? null : () => _pick(plan, choice, i, say: gap.expression),
                    child: Text(
                      gap.options[i],
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: colors.textPrimary),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          _feedback(choice),
        ],
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
          if (verdict == TilesVerdict.wrong)
            Text(l10n.tilesWrong, style: TextStyle(fontSize: 14, color: colors.error)).withMotion(context, (a) => a.fadeIn(duration: 200.ms)),
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
                ListenButtons(text: challenge.expression.text, expressionId: challenge.expression.id, locale: plan.voiceLocale, compact: true),
              ],
            ).withMotion(context, (a) => a.fadeIn(duration: 200.ms)),
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
