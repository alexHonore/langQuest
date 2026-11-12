import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/server_voice.dart';
import '../../core/content/content_models.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_state.dart';
import '../../core/services/speech_service.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';
import 'exercise_widgets.dart';
import 'learn_content.dart';
import '../games/game_pool.dart';
import '../games/game_widgets.dart';
import 'learn_logic.dart';
import 'learn_providers.dart';
import 'learn_widgets.dart';
import 'practice_session.dart';

/// The Practise stop: a session that goes from recognising the mission's phrases to producing them
/// (`practice_session.dart`). Two questions about earlier missions open it; then the pairs, questions by ear and by
/// meaning, a phrase to complete, sentences to build (from a meaning, then from what is heard) and, where the keyboard
/// writes the course's script, a phrase to type. One answer per question: the panel at the bottom says how it went and
/// shows the phrase; a question missed comes back once at the end. Nothing is scored. The last screen says what was
/// right the first time and what to look at again, then leads to the mission.
class PracticeScreen extends ConsumerStatefulWidget {
  final String missionKey;
  const PracticeScreen({super.key, required this.missionKey});

  @override
  ConsumerState<PracticeScreen> createState() => _PracticeScreenState();
}

class _PracticeScreenState extends ConsumerState<PracticeScreen> {
  PracticeProgress? _progress;
  late final SpeechService _speech;
  Timer? _wrongTimer;

  // The current step's own state, cleared when the session moves on.
  PairsState? _pairs;

  /// The option chosen (a choice or a gap), or 1 for "yes" and 0 for "no".
  int? _picked;
  TilesState? _tiles;
  final _typed = TextEditingController();
  TypedVerdict? _typedVerdict;

  /// How the current question was answered (what the panel says); null until it is.
  bool? _result;

  /// The session is over: the last screen is shown.
  bool _summary = false;

  /// This session completed the Practise stop for the first time (its XP is shown).
  bool _firstCompletion = false;

  @override
  void initState() {
    super.initState();
    _speech = ref.read(speechServiceProvider);
    _typed.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _wrongTimer?.cancel();
    _speech.stop();
    _typed.dispose();
    super.dispose();
  }

  /// The plans of the missions completed before this one, in course order: their phrases open the session.
  List<MissionLearnPlan> _earlierPlans() {
    final state = ref.read(appStateProvider);
    final course = state.activeCourse;
    if (course == null) return const [];
    final at = course.indexOfMission(widget.missionKey);
    return [
      for (final mission in course.missions.take(at < 0 ? 0 : at))
        if (state.progress.isMissionCompleted(mission.key)) ?ref.read(learnPlanProvider(mission.key)),
    ];
  }

  /// Says a phrase with the course's voice (its bundled clip first), when one can.
  Future<void> _say(MissionLearnPlan plan, Expression e) async {
    final voice = ref.read(lineVoiceNowProvider(plan.voiceLocale));
    if (voice != null && voice.canSay(expressionId: e.id)) await voice.say(text: e.text, expressionId: e.id);
  }

  /// A step became the current one: what is asked by ear is said.
  void _enter(MissionLearnPlan plan) {
    final progress = _progress;
    if (progress == null || progress.finished) return;
    final step = progress.current;
    if (step is ChoiceStep && step.question.kind != ChoiceKind.reverse) _say(plan, step.question.expression);
    if (step is BuildStep && step.byEar) _say(plan, step.tiles.expression);
  }

  /// The answer to the current question: recorded (the first one counts), shown in the panel, and the phrase is said.
  void _answer(MissionLearnPlan plan, bool correct) {
    final progress = _progress!;
    setState(() {
      _result = correct;
      _progress = progress.answered(correct);
    });
    final subject = progress.current.subject;
    if (subject != null) _say(plan, subject);
  }

  void _continue(MissionLearnPlan plan) {
    _speech.stop();
    _wrongTimer?.cancel();
    final next = _progress!.next();
    setState(() {
      _progress = next;
      _pairs = null;
      _picked = null;
      _tiles = null;
      _typedVerdict = null;
      _result = null;
      _typed.clear();
      if (next.finished) {
        _summary = true;
        _firstCompletion = !ref.read(appStateProvider).stopsDone(widget.missionKey).contains(PathStop.practise);
      }
    });
    if (next.finished) {
      ref.read(appStateProvider.notifier).completeStop(widget.missionKey, PathStop.practise);
    } else {
      _enter(plan);
    }
  }

  void _tapPair(MissionLearnPlan plan, PairsCard card) {
    final pairs = _pairs!;
    if (card.side == PairSide.phrase) {
      // Hearing the phrase while matching is part of the learning, not a hint penalty.
      final phrase = plan.pairPhrases.where((e) => e.id == card.pairId).firstOrNull;
      if (phrase != null) _say(plan, phrase);
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

  void _checkTiles(MissionLearnPlan plan, BuildStep step) {
    final checked = _tiles!.check();
    final solved = checked.verdict == TilesVerdict.correct;
    setState(() {
      _tiles = checked;
      // The first check is the answer; the sentence is then worked on until it is right, here and now.
      _progress = _progress!.answered(solved, again: false);
      if (solved) _result = true;
    });
    if (solved) _say(plan, step.tiles.expression);
  }

  void _checkTyped(MissionLearnPlan plan, TypeStep step, {bool giveUp = false}) {
    final verdict = giveUp ? TypedVerdict.wrong : checkTyped(_typed.text, step.expression.text);
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _typedVerdict = verdict);
    _answer(plan, verdict != TypedVerdict.wrong);
  }

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(learnPlanProvider(widget.missionKey));
    if (plan == null || plan.pairRounds.isEmpty) return const MissionUnavailable();
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final voice = ref.watch(lineVoiceNowProvider(plan.voiceLocale));

    // The session is built once, as the screen opens, with what can be said here (questions by ear need it).
    if (_progress == null) {
      _progress = PracticeProgress.start(
        buildPracticeSession(
          plan,
          earlier: _earlierPlans(),
          canHear: (e) => voice?.canSay(expressionId: e.id) ?? false,
        ),
      );
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _enter(plan);
      });
    }
    final progress = _progress!;
    final title = l10n.practiseTitle(plan.mission.titleIn(plan.source) ?? '');

    final step = progress.current;
    final Widget view;
    final Widget bottom;
    if (_summary) {
      view = _summaryView(plan, progress);
      // On to the mission's round of play when one is still to do (the mission itself stays one tap away), else to
      // the mission.
      final game = planHasGame(plan) && !ref.watch(appStateProvider.select((s) => s.stopsDone(widget.missionKey).contains(PathStop.play)))
          ? ref.watch(missionGameProvider(widget.missionKey))
          : null;
      void startMission() => context.pushReplacement('/mission/${widget.missionKey}');
      bottom = Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: game == null
            ? LearnPrimaryButton(label: l10n.startMission, icon: LucideIcons.flag, onPressed: startMission)
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  LearnPrimaryButton(
                    label: l10n.practicePlayNext(gameName(l10n, game)),
                    icon: LucideIcons.gamepad2,
                    onPressed: () => context.pushReplacement('/learn/${widget.missionKey}/play'),
                  ),
                  TextButton(
                    style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                    onPressed: startMission,
                    child: Text(
                      l10n.startMission,
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: ref.watch(appStateProvider.select((s) => s.accent.primaryText))),
                    ),
                  ),
                ],
              ),
      );
    } else {
      view = switch (step) {
        PairsStep() => _pairsView(plan, _pairs ??= _pairsFor(plan, step)),
        ChoiceStep() => _choiceView(plan, step),
        TrueFalseStep() => _trueFalseView(plan, step),
        GapStep() => _gapView(plan, step),
        BuildStep() => _buildView(plan, step, _tiles ??= TilesState.start(step.tiles.answer, step.tiles.distractors, '${plan.mission.key}/${step.id}')),
        TypeStep() => _typeView(plan, step),
      };
      bottom = _bottom(plan, progress, step);
    }

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            LearnTopBar(
              title: title,
              step: (progress.index + 1).clamp(1, progress.queue.length),
              total: progress.queue.length,
              fraction: _summary ? 1 : progress.fraction,
              onClose: () => context.popOrHome(),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: KeyedSubtree(key: ValueKey(_summary ? -1 : progress.index), child: view),
              ),
            ),
            bottom,
          ],
        ),
      ),
    );
  }

  PairsState _pairsFor(MissionLearnPlan plan, PairsStep step) =>
      PairsState.start([for (final e in step.pairs) (id: e.id, phrase: e.text, meaning: plan.shortMeaningOf(e))], '${plan.mission.key}/${step.round}');

  /// What stands at the bottom: the panel once the question is answered, else the step's own action (if any).
  Widget _bottom(MissionLearnPlan plan, PracticeProgress progress, PracticeStep step) {
    final l10n = context.l10n;
    final result = _result;
    final subject = step.subject;
    if (result != null && subject != null) {
      final note = switch (_typedVerdict) {
        TypedVerdict.accents => l10n.practiceAccents,
        TypedVerdict.typo => l10n.practiceTypo,
        _ => !result && !step.retry ? l10n.practiceComesBack : null,
      };
      return FeedbackPanel(
        correct: result,
        title: result ? l10n.practiceRight : l10n.practiceWrong,
        expression: subject,
        track: plan.track,
        meaning: plan.shortMeaningOf(subject),
        voiceLocale: plan.voiceLocale,
        note: note,
        continueLabel: l10n.practiceNext,
        onContinue: () => _continue(plan),
      );
    }
    final Widget action;
    switch (step) {
      case PairsStep():
        final following = progress.index + 1 < progress.queue.length ? progress.queue[progress.index + 1] : null;
        action = LearnPrimaryButton(
          label: following is PairsStep ? l10n.pairsNextRound : l10n.practiceNext,
          icon: LucideIcons.chevronRight,
          onPressed: (_pairs?.finished ?? false) ? () => _continue(plan) : null,
        );
      case BuildStep():
        action = LearnPrimaryButton(label: l10n.tilesCheck, onPressed: (_tiles?.placed.isEmpty ?? true) ? null : () => _checkTiles(plan, step));
      case TypeStep():
        action = Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            LearnPrimaryButton(label: l10n.tilesCheck, onPressed: _typed.text.trim().isEmpty ? null : () => _checkTyped(plan, step)),
            TextButton(
              style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
              onPressed: () => _checkTyped(plan, step, giveUp: true),
              child: Text(l10n.practiceShowAnswer),
            ),
          ],
        );
      case ChoiceStep() || TrueFalseStep() || GapStep():
        return const SizedBox(height: 12);
    }
    return Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: action);
  }

  MeloState get _mood => switch (_result) {
    true => MeloState.celebrate,
    false => MeloState.thinking,
    null => MeloState.curious,
  };

  /// Where a question comes from, when it is not simply the next one.
  ({String? tag, IconData? icon}) _tagOf(PracticeStep step) {
    final l10n = context.l10n;
    if (step.retry) return (tag: l10n.practiceOnceMore, icon: LucideIcons.rotateCcw);
    if (step is ChoiceStep && step.earlier) return (tag: l10n.practiceEarlier, icon: LucideIcons.history);
    return (tag: null, icon: null);
  }

  /// The meaning a question is about, on its own card.
  Widget _meaningCard(String meaning) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(18)),
      child: Text(
        meaning,
        style: TextStyle(fontSize: 19, height: 1.3, fontWeight: FontWeight.w600, color: colors.textPrimary),
      ),
    );
  }

  /// By ear (hear → meaning, read instead when nothing can say it; hear → the written phrase) or by meaning
  /// (meaning → phrase).
  Widget _choiceView(MissionLearnPlan plan, ChoiceStep step) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final q = step.question;
    final voice = ref.watch(lineVoiceNowProvider(plan.voiceLocale));
    final canHear = voice != null && voice.canSay(expressionId: q.expression.id);
    final tag = _tagOf(step);
    final byMeaning = q.kind == ChoiceKind.listen;

    final (String prompt, Widget subject) = switch (q.kind) {
      ChoiceKind.listen when canHear => (l10n.practiceListenPrompt, BigListen(expression: q.expression, locale: plan.voiceLocale)),
      // Without a voice the phrase is read.
      ChoiceKind.listen => (
        l10n.practiceReadPrompt,
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(18)),
          child: TargetText(expression: q.expression, track: plan.track, fontSize: 22),
        ),
      ),
      ChoiceKind.hear => (l10n.practiceHearPrompt, BigListen(expression: q.expression, locale: plan.voiceLocale)),
      ChoiceKind.reverse => (l10n.practiceReversePrompt, _meaningCard(plan.shortMeaningOf(q.expression))),
    };

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          ExercisePrompt(text: prompt, mood: _mood, tag: tag.tag, tagIcon: tag.icon),
          const SizedBox(height: 18),
          subject,
          const SizedBox(height: 18),
          for (var i = 0; i < q.options.length; i++)
            OptionTile(
              semantics: byMeaning ? plan.shortMeaningOf(q.options[i]) : q.options[i].text,
              locale: byMeaning ? null : contentLanguageOf(plan.track),
              state: optionState(i, picked: _picked, answer: q.answerIndex),
              onTap: _picked != null
                  ? null
                  : () {
                      setState(() => _picked = i);
                      _answer(plan, i == q.answerIndex);
                    },
              child: byMeaning
                  ? Text(
                      plan.shortMeaningOf(q.options[i]),
                      style: TextStyle(fontSize: 16.5, height: 1.3, fontWeight: FontWeight.w600, color: colors.textPrimary),
                    )
                  : TargetText(expression: q.options[i], track: plan.track, fontSize: 18),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  /// A phrase and a meaning: is it what the phrase means?
  Widget _trueFalseView(MissionLearnPlan plan, TrueFalseStep step) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final tag = _tagOf(step);
    final answer = step.isTrue ? 1 : 0;

    Widget choice(int value, String label, IconData icon) => Expanded(
      child: OptionTile(
        semantics: label,
        marker: false,
        state: optionState(value, picked: _picked, answer: answer),
        onTap: _picked != null
            ? null
            : () {
                setState(() => _picked = value);
                _answer(plan, value == answer);
              },
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 20, color: colors.textPrimary),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                label,
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: colors.textPrimary),
              ),
            ),
          ],
        ),
      ),
    );

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          ExercisePrompt(text: l10n.practiceTrueFalsePrompt, mood: _mood, tag: tag.tag, tagIcon: tag.icon),
          const SizedBox(height: 18),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: colors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: TargetText(expression: step.expression, track: plan.track, fontSize: 24),
                    ),
                    ListenButtons(text: step.expression.text, expressionId: step.expression.id, locale: plan.voiceLocale, compact: true, slow: false),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Divider(height: 1, color: colors.border),
                ),
                Text(
                  '“${promptMeaning(plan.meaningOf(step.shown))}”',
                  style: TextStyle(fontSize: 18, height: 1.3, fontWeight: FontWeight.w600, color: colors.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(children: [choice(1, l10n.practiceYes, LucideIcons.check), const SizedBox(width: 10), choice(0, l10n.practiceNo, LucideIcons.x)]),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  /// A phrase with one word missing, and three words to choose from.
  Widget _gapView(MissionLearnPlan plan, GapStep step) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final gap = step.gap;
    final tag = _tagOf(step);
    final answered = _picked != null;
    final wordStyle = TextStyle(fontSize: 21, height: 1.3, fontWeight: FontWeight.w600, color: colors.textPrimary);

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          ExercisePrompt(text: l10n.practiceGapPrompt, mood: _mood, tag: tag.tag, tagIcon: tag.icon),
          const SizedBox(height: 12),
          Text(plan.shortMeaningOf(gap.expression), style: TextStyle(fontSize: 16.5, height: 1.3, color: colors.textSecondary)),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: colors.surfaceMuted,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: switch (_result) {
                  true => colors.success,
                  false => colors.error,
                  null => Colors.transparent,
                },
                width: 2,
              ),
            ),
            child: Wrap(
              spacing: 8,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (var i = 0; i < gap.words.length; i++)
                  if (i != gap.gap)
                    Text(gap.words[i], style: wordStyle)
                  else if (answered)
                    Text(gap.words[i], style: wordStyle.copyWith(color: colors.success))
                  else
                    Semantics(
                      label: l10n.practiceGapSemantics,
                      child: Container(
                        width: 76,
                        height: 34,
                        decoration: BoxDecoration(
                          color: accent.primarySoft,
                          borderRadius: BorderRadius.circular(8),
                          border: Border(bottom: BorderSide(color: accent.primary, width: 2.5)),
                        ),
                      ),
                    ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          for (var i = 0; i < gap.options.length; i++)
            OptionTile(
              semantics: gap.options[i],
              locale: contentLanguageOf(plan.track),
              state: optionState(i, picked: _picked, answer: gap.answerIndex),
              onTap: answered
                  ? null
                  : () {
                      setState(() => _picked = i);
                      _answer(plan, i == gap.answerIndex);
                    },
              child: Text(
                gap.options[i],
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: colors.textPrimary),
              ),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  Widget _pairsView(MissionLearnPlan plan, PairsState pairs) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final romanizationById = {for (final e in plan.pairPhrases) e.id: e.romanization};
    // A card is as tall as its text needs at the learner's text size, and never taller than its share of the screen.
    final cardHeight = MediaQuery.textScalerOf(context).scale(84).clamp(84.0, 190.0);

    Widget card(PairsCard c) {
      final matched = pairs.matched.contains(c.pairId);
      final wrong = pairs.wrongKeys.contains(c.key);
      final selected = pairs.selected?.key == c.key;
      final isPhrase = c.side == PairSide.phrase;
      final border = matched
          ? colors.success.withValues(alpha: 0.55)
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
          : (isPhrase ? colors.elevated : colors.surface);
      final romanization = isPhrase ? romanizationById[c.pairId] : null;
      return Flexible(
        child: SizedBox(
          height: cardHeight,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Semantics(
              button: true,
              selected: selected,
              label: matched ? l10n.matchedSemantics(c.label) : c.label,
              excludeSemantics: true,
              child: InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: matched ? null : () => _tapPair(plan, c),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: fill,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: border, width: selected || wrong ? 2 : 1),
                    boxShadow: selected ? [BoxShadow(color: accent.primary.withValues(alpha: 0.35), blurRadius: 14)] : null,
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
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        ExercisePrompt(text: pairs.finished ? l10n.pairsDone : l10n.pairsPrompt, mood: pairs.finished ? MeloState.celebrate : MeloState.thinking),
        const SizedBox(height: 14),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(mainAxisSize: MainAxisSize.min, children: [for (final c in pairs.phrases) card(c)]),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(mainAxisSize: MainAxisSize.min, children: [for (final c in pairs.meanings) card(c)]),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// A sentence to build from tiles: from its meaning, or from what is heard.
  Widget _buildView(MissionLearnPlan plan, BuildStep step, TilesState tiles) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final verdict = tiles.verdict;
    final challenge = step.tiles;
    final tag = _tagOf(step);
    final solved = verdict == TilesVerdict.correct;
    final placed = [for (final i in tiles.placed) tiles.bank.firstWhere((t) => t.index == i)];
    // After a check that was not right, each word says whether it is where it belongs.
    bool? inPlace(int position) {
      if (verdict == TilesVerdict.building) return null;
      return position < challenge.answer.length && normalizeForCompare(placed[position].text) == normalizeForCompare(challenge.answer[position]);
    }

    final sentenceBorder = switch (verdict) {
      TilesVerdict.correct => colors.success,
      TilesVerdict.wrong => colors.error,
      TilesVerdict.building => Colors.transparent,
    };

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          ExercisePrompt(
            text: step.byEar ? l10n.practiceBuildByEarPrompt : l10n.tilesPrompt,
            mood: solved ? MeloState.celebrate : (verdict == TilesVerdict.wrong ? MeloState.thinking : MeloState.curious),
            tag: tag.tag,
            tagIcon: tag.icon,
          ),
          const SizedBox(height: 14),
          if (step.byEar)
            BigListen(expression: challenge.expression, locale: plan.voiceLocale)
          else
            Text(plan.shortMeaningOf(challenge.expression), style: TextStyle(fontSize: 17, height: 1.3, color: colors.textSecondary)),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(minHeight: 76),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colors.surfaceMuted,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: sentenceBorder, width: 2),
            ),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (position, t) in placed.indexed)
                  WordTile(
                    word: t.text,
                    semantics: l10n.tilesRemoveSemantics(t.text),
                    placed: true,
                    verdict: inPlace(position),
                    onTap: solved ? null : () => setState(() => _tiles = tiles.remove(t)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (verdict == TilesVerdict.wrong)
            Text(l10n.tilesWrong, style: TextStyle(fontSize: 14, color: colors.error)).withMotion(context, (a) => a.fadeIn(duration: 200.ms)),
          const SizedBox(height: 12),
          // Once solved, the leftover words disappear: only the sentence remains.
          if (!solved)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final t in tiles.bank)
                  if (!tiles.isPlaced(t)) WordTile(word: t.text, semantics: t.text, onTap: () => setState(() => _tiles = tiles.place(t))),
              ],
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  /// A phrase to type from its meaning.
  Widget _typeView(MissionLearnPlan plan, TypeStep step) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final tag = _tagOf(step);
    final answered = _result != null;
    final ink = switch (_result) {
      true => colors.success,
      false => colors.error,
      null => accent.primary,
    };
    OutlineInputBorder border(Color color, double width) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(18),
      borderSide: BorderSide(color: color, width: width),
    );

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          ExercisePrompt(text: l10n.practiceTypePrompt, mood: _mood, tag: tag.tag, tagIcon: tag.icon),
          const SizedBox(height: 16),
          _meaningCard(plan.shortMeaningOf(step.expression)),
          const SizedBox(height: 14),
          TextField(
            controller: _typed,
            enabled: !answered,
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: TextCapitalization.sentences,
            textInputAction: TextInputAction.done,
            minLines: 1,
            maxLines: 3,
            onSubmitted: (_) {
              if (!answered && _typed.text.trim().isNotEmpty) _checkTyped(plan, step);
            },
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: colors.textPrimary),
            cursorColor: accent.primary,
            decoration: InputDecoration(
              hintText: l10n.practiceTypeHint,
              hintStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w400, color: colors.textMuted),
              filled: true,
              fillColor: colors.surface,
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              enabledBorder: border(colors.borderStrong.withValues(alpha: 0.6), 1),
              focusedBorder: border(accent.primary, 2),
              disabledBorder: border(ink, 2),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  /// The end of the session: what was right the first time, what to look at again, and the way to the mission.
  Widget _summaryView(MissionLearnPlan plan, PracticeProgress progress) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final revisit = progress.toRevisit;
    final allRight = progress.questions > 0 && progress.rightFirstTime == progress.questions;

    return SingleChildScrollView(
      child: Column(
        children: [
          const SizedBox(height: 16),
          MeloWidget(
            state: MeloState.celebrate,
            courseTrackId: appState.activeTrackId,
            size: 96,
          ).withMotion(context, (a) => a.scale(begin: const Offset(0.6, 0.6), duration: 600.ms, curve: Curves.elasticOut)),
          const SizedBox(height: 12),
          Semantics(
            header: true,
            child: Text(
              l10n.practiceDoneTitle,
              textAlign: TextAlign.center,
              style: displayStyle(size: 26, color: colors.textPrimary),
            ),
          ),
          const SizedBox(height: 6),
          if (progress.questions > 0)
            Text(
              allRight ? l10n.practiceDoneAllRight : l10n.practiceDoneScore(progress.rightFirstTime, progress.questions),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 16, height: 1.35, color: colors.textSecondary),
            ),
          if (_firstCompletion) ...[
            const SizedBox(height: 8),
            Text(
              l10n.xpGain(XpAmounts.stepCompleted),
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: accent.primaryText),
            ),
          ],
          if (revisit.isNotEmpty) ...[
            const SizedBox(height: 22),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(l10n.practiceRevisitTitle, style: displayStyle(size: 17, color: colors.textPrimary, bold: false)),
            ),
            const SizedBox(height: 8),
            for (final e in revisit)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: colors.border),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          TargetText(expression: e, track: plan.track, fontSize: 17),
                          const SizedBox(height: 2),
                          Text(plan.shortMeaningOf(e), style: TextStyle(fontSize: 13.5, color: colors.textSecondary)),
                        ],
                      ),
                    ),
                    ListenButtons(text: e.text, expressionId: e.id, locale: plan.voiceLocale, compact: true, slow: false),
                  ],
                ),
              ),
          ],
          const SizedBox(height: 12),
        ],
      ),
    );
  }
}
