import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/server_voice.dart';
import '../../core/content/content_bundle.dart' show Course;
import '../../core/content/content_models.dart';
import '../../core/layout/motion.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../core/theme/script_fonts.dart';
import '../../core/theme/typography.dart';
import '../../l10n/l10n.dart';
import '../learn/exercise_widgets.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';
import '../learn/learn_widgets.dart';
import '../mascot/melo_model.dart';
import 'game_logic.dart';
import 'game_pool.dart';
import 'game_widgets.dart';

/// A game, played one of two ways: on the Play tab with every phrase learned (records, XP once a day per game), or
/// as the Play stop of a mission ([missionKey]) with that mission's phrases only — the round that warms up for its
/// conversation; finishing it completes the stop.
abstract class GameScreen extends ConsumerStatefulWidget {
  const GameScreen({super.key, this.missionKey});

  final String? missionKey;
}

/// A mission's Play stop: a round of the game whose turn it is, with the mission's own phrases. The game is chosen
/// as the screen opens and kept (a voice that becomes available must not swap the game under the learner).
class MissionPlayScreen extends ConsumerStatefulWidget {
  const MissionPlayScreen({super.key, required this.missionKey});

  final String missionKey;

  @override
  ConsumerState<MissionPlayScreen> createState() => _MissionPlayScreenState();
}

class _MissionPlayScreenState extends ConsumerState<MissionPlayScreen> {
  GameKind? _kind;

  @override
  Widget build(BuildContext context) {
    final key = widget.missionKey;
    return switch (_kind ??= ref.watch(missionGameProvider(key))) {
      GameKind.memory => MemoryGameScreen(missionKey: key),
      GameKind.quick => QuickGameScreen(missionKey: key),
      GameKind.ear => EarGameScreen(missionKey: key),
      GameKind.dash => DashGameScreen(missionKey: key),
      null => const MissionUnavailable(),
    };
  }
}

/// What every game screen needs of the app: the course, its phrases in play, and its voice. A round keeps the pool it
/// started with, so nothing changes under the learner's fingers.
mixin _GameHost<T extends GameScreen> on ConsumerState<T> {
  late final SpeechService speech;

  /// Rounds finished on this screen (a mission's round is seeded by it: its first is the same for everyone).
  int _rounds = 0;

  @override
  void initState() {
    super.initState();
    speech = ref.read(speechServiceProvider);
  }

  Course? get course => ref.read(appStateProvider).activeCourse;

  String? get missionKey => widget.missionKey;

  /// The phrases of this round's pool, as they are now.
  List<GamePhrase> readPool() => ref.read(roundPoolProvider(missionKey));

  /// The learner's record in [kind], as a number. A mission's round keeps none (its phrases are its own).
  int? bestOf(GameKind kind, {String variant = ''}) {
    final id = course?.id;
    if (missionKey != null || id == null) return null;
    return ref.read(gameStatsProvider.notifier).recordOf(id, kind, variant: variant).best;
  }

  /// A round played to the end. On the Play tab it counts for the record and the day's XP; in a mission it completes
  /// the Play stop (XP the first time, like every stop).
  GameOutcome? finishRound(GameKind kind, int score, {String variant = ''}) {
    final id = course?.id;
    if (id == null) return null;
    final mission = missionKey;
    if (mission == null) return ref.read(gameStatsProvider.notifier).finished(id, kind, score, variant: variant);
    _rounds++;
    final first = !ref.read(appStateProvider).stopsDone(mission).contains(PathStop.play);
    ref.read(appStateProvider.notifier).completeStop(mission, PathStop.play);
    return (record: false, xp: first);
  }

  /// After a mission's round: on to the mission itself.
  VoidCallback? get onStartMission {
    final mission = missionKey;
    return mission == null ? null : () => context.pushReplacement('/mission/$mission');
  }

  /// Says a phrase with the course's voice (its bundled clip first), when one can.
  Future<void> say(Expression e) async {
    final voice = ref.read(lineVoiceNowProvider(course?.track.voiceLocale));
    if (voice != null && voice.canSay(expressionId: e.id)) await voice.say(text: e.text, expressionId: e.id);
  }

  /// A new seed for each round of [kind]: the number of rounds played so far.
  String roundSeed(GameKind kind, {String variant = ''}) {
    final id = course?.id ?? '';
    final mission = missionKey;
    if (mission != null) return '$mission/${kind.id}/$_rounds';
    return '$id/${kind.id}/${ref.read(gameStatsProvider.notifier).recordOf(id, kind, variant: variant).plays}';
  }

  @override
  void dispose() {
    speech.stop();
    super.dispose();
  }
}

// --- Lantern pairs ------------------------------------------------------------------------------------------------

/// Lantern pairs: every phrase and its meaning are hidden under the lanterns; turn two at a time to find the pairs.
/// A phrase is said when it is turned. What counts is the number of moves.
class MemoryGameScreen extends GameScreen {
  const MemoryGameScreen({super.key, super.missionKey});

  @override
  ConsumerState<MemoryGameScreen> createState() => _MemoryGameScreenState();
}

class _MemoryGameScreenState extends ConsumerState<MemoryGameScreen> with _GameHost {
  MemoryState? _board;
  Map<String, GamePhrase> _phrases = const {};
  Timer? _closing;
  GameOutcome? _outcome;

  @override
  void initState() {
    super.initState();
    _deal();
  }

  @override
  void dispose() {
    _closing?.cancel();
    super.dispose();
  }

  String get _variant => '${_phrases.length}';

  void _deal() {
    final pool = readPool();
    if (pool.length < (missionKey == null ? minGamePhrases : minMemoryPhrases)) return;
    final size = pool.length < memoryPairs ? pool.length : memoryPairs;
    final seed = roundSeed(GameKind.memory, variant: '$size');
    final pairs = seededShuffle(pool, seed).take(size).toList();
    _closing?.cancel();
    setState(() {
      _phrases = {for (final p in pairs) p.item.id: p};
      _board = MemoryState.start([for (final p in pairs) p.item], seed);
      _outcome = null;
    });
  }

  void _flip(int index) {
    final board = _board!;
    _closing?.cancel();
    final next = board.flip(index);
    if (identical(next, board)) return;
    final card = next.cards[index];
    if (card.side == MemorySide.phrase) say(_phrases[card.pairId]!.expression);
    setState(() => _board = next);
    if (next.mismatch) {
      _closing = Timer(const Duration(milliseconds: 1100), () {
        if (mounted) setState(() => _board = _board?.closeOpen());
      });
    } else if (next.finished) {
      final outcome = finishRound(GameKind.memory, next.moves, variant: _variant);
      if (outcome != null) setState(() => _outcome = outcome);
    }
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final board = _board;
    final track = appState.activeCourse?.track;
    if (board == null || track == null) return const MissionUnavailable();
    final outcome = _outcome;
    final best = bestOf(GameKind.memory, variant: _variant);

    if (outcome != null) {
      return GameScaffold(
        kind: GameKind.memory,
        child: GameResult(
          headline: l10n.gameMemoryResult(board.moves),
          detail: l10n.gameMemoryDetail(_phrases.length),
          best: best == null ? null : l10n.gameBestMoves(best),
          record: outcome.record,
          xp: outcome.xp,
          onAgain: _deal,
          onStartMission: onStartMission,
        ),
      );
    }

    Widget cardOf(int index) {
      final card = board.cards[index];
      final matched = board.isMatched(index);
      final open = board.isOpen(index);
      final shown = matched || open;
      final isPhrase = card.side == MemorySide.phrase;
      final wrong = open && board.mismatch;
      final face = shown
          ? Container(
              key: ValueKey('up-$index-$matched-$wrong'),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              decoration: BoxDecoration(
                color: matched ? colors.successSoft : (wrong ? colors.errorSoft : (isPhrase ? accent.primarySoft : colors.elevated)),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: matched ? colors.success.withValues(alpha: 0.6) : (wrong ? colors.error : (isPhrase ? accent.primary : colors.borderStrong)),
                  width: 1.5,
                ),
              ),
              // Wrap within the card first; shrink only when the wrapped text is still too tall.
              child: LayoutBuilder(
                builder: (context, box) => FittedBox(
                  fit: BoxFit.scaleDown,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: box.maxWidth),
                    child: Text(
                      card.label,
                      textAlign: TextAlign.center,
                      locale: isPhrase ? contentLocaleOf(track) : null,
                      textDirection: isPhrase && track.rtl ? TextDirection.rtl : null,
                      style: TextStyle(
                        fontSize: isPhrase ? 15.5 : 14,
                        height: 1.2,
                        fontWeight: FontWeight.w600,
                        color: matched ? colors.textSecondary : colors.textPrimary,
                        fontFamilyFallback: isPhrase ? fontFallbackFor(track) : null,
                      ),
                    ),
                  ),
                ),
              ),
            )
          : Container(
              key: ValueKey('down-$index'),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [colors.surfaceMuted, colors.surface]),
                border: Border.all(color: colors.border),
              ),
              // The three lantern hues, scattered over the board (decorative: they say nothing about the cards).
              child: Icon(LucideIcons.lampCeiling, size: 26, color: accent.lantern[(index + index ~/ 3) % accent.lantern.length].withValues(alpha: 0.8)),
            );
      return Semantics(
        button: true,
        enabled: !matched,
        label: matched ? l10n.matchedSemantics(card.label) : (open ? card.label : l10n.gameMemoryHidden(index + 1)),
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: matched ? null : () => _flip(index),
          child: AnimatedSwitcher(
            duration: context.reduceMotion ? Duration.zero : const Duration(milliseconds: 220),
            transitionBuilder: (child, animation) => ScaleTransition(
              scale: Tween(begin: 0.86, end: 1.0).animate(animation),
              child: FadeTransition(opacity: animation, child: child),
            ),
            child: face,
          ),
        ),
      );
    }

    return GameScaffold(
      kind: GameKind.memory,
      status: GameStatus(icon: LucideIcons.mousePointerClick, value: '${board.moves}', semantics: l10n.gameMovesSemantics(board.moves)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.gameMemoryHint, style: TextStyle(fontSize: 14.5, height: 1.35, color: colors.textSecondary)),
            const SizedBox(height: 12),
            Expanded(
              child: LayoutBuilder(
                builder: (context, box) {
                  const columns = 3;
                  const gap = 8.0;
                  final rows = (board.cards.length / columns).ceil();
                  final width = (box.maxWidth - gap * (columns - 1)) / columns;
                  // As tall as the screen allows, within what a card of text needs at the learner's text size.
                  final least = MediaQuery.textScalerOf(context).scale(72).clamp(72.0, 150.0);
                  final most = width * 1.25 < least ? least : width * 1.25;
                  final height = ((box.maxHeight - gap * (rows - 1)) / rows).clamp(least, most);
                  return GridView.builder(
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: gap,
                      crossAxisSpacing: gap,
                      mainAxisExtent: height,
                    ),
                    itemCount: board.cards.length,
                    itemBuilder: (context, index) => cardOf(index),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// --- Quick fire -----------------------------------------------------------------------------------------------------

/// How long a round of Quick fire lasts: on the Play tab, and (shorter, with fewer phrases) as a mission's Play stop.
const quickRoundLength = Duration(seconds: 45);
const missionQuickRoundLength = Duration(seconds: 30);

/// Quick fire: a phrase and a meaning — is it what it means? As many as possible before the time runs out. A wrong
/// answer stops the clock for a moment and shows what the phrase means.
class QuickGameScreen extends GameScreen {
  const QuickGameScreen({super.key, super.missionKey});

  @override
  ConsumerState<QuickGameScreen> createState() => _QuickGameScreenState();
}

class _QuickGameScreenState extends ConsumerState<QuickGameScreen> with _GameHost {
  QuickRound? _round;
  Map<String, GamePhrase> _phrases = const {};
  int _index = 0;
  QuickScore _score = const QuickScore();
  int _remaining = 0;

  /// How the current statement was answered, while its answer shows (the clock waits).
  bool? _answered;
  Timer? _clock;
  Timer? _moveOn;
  GameOutcome? _outcome;

  /// The phrases answered wrong in this round, each once.
  final _missed = <String>[];

  Duration get _length => missionKey == null ? quickRoundLength : missionQuickRoundLength;

  @override
  void dispose() {
    _clock?.cancel();
    _moveOn?.cancel();
    super.dispose();
  }

  void _start() {
    final pool = readPool();
    if (pool.length < minQuickPhrases) return;
    _clock?.cancel();
    _moveOn?.cancel();
    setState(() {
      _phrases = {for (final p in pool) p.item.id: p};
      _round = QuickRound([for (final p in pool) p.item], roundSeed(GameKind.quick));
      _index = 0;
      _score = const QuickScore();
      _remaining = _length.inMilliseconds;
      _answered = null;
      _outcome = null;
      _missed.clear();
    });
    _clock = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (!mounted || _answered != null) return;
      setState(() => _remaining -= 100);
      if (_remaining <= 0) _finish();
    });
  }

  void _finish() {
    _clock?.cancel();
    _moveOn?.cancel();
    final outcome = finishRound(GameKind.quick, _score.right);
    if (outcome != null) setState(() => _outcome = outcome);
  }

  void _answer(bool yes) {
    final round = _round;
    if (round == null || _answered != null || _outcome != null) return;
    final statement = round.statementAt(_index);
    final correct = yes == statement.isTrue;
    setState(() {
      _answered = correct;
      _score = _score.answer(correct);
      if (!correct && !_missed.contains(statement.item.id)) _missed.add(statement.item.id);
    });
    // Right: straight on. Wrong: the clock waits while the meaning is read.
    _moveOn = Timer(Duration(milliseconds: correct ? 350 : 1600), () {
      if (!mounted) return;
      setState(() {
        _answered = null;
        _index++;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final track = appState.activeCourse?.track;
    final courseId = appState.activeCourse?.id;
    if (track == null || courseId == null || ref.watch(roundPoolProvider(missionKey)).length < minQuickPhrases) return const MissionUnavailable();
    final best = bestOf(GameKind.quick);
    final round = _round;
    final outcome = _outcome;

    if (round == null) {
      return GameScaffold(
        kind: GameKind.quick,
        child: GameIntro(
          kind: GameKind.quick,
          rules: l10n.gameQuickRules(_length.inSeconds),
          best: best == null ? null : l10n.gameBestRight(best),
          onStart: _start,
        ),
      );
    }
    if (outcome != null) {
      return GameScaffold(
        kind: GameKind.quick,
        child: GameResult(
          headline: l10n.gameQuickResult(_score.right),
          detail: l10n.gameQuickDetail(_score.answered, _score.bestStreak),
          best: best == null ? null : l10n.gameBestRight(best),
          record: outcome.record,
          xp: outcome.xp,
          onAgain: _start,
          onStartMission: onStartMission,
          children: [
            for (final id in _missed.take(4))
              if (_phrases[id] case final phrase?)
                GameMissedRow(
                  meaning: phrase.item.meaning,
                  listen: ListenButtons(
                    text: phrase.expression.text,
                    expressionId: phrase.expression.id,
                    locale: track.voiceLocale,
                    compact: true,
                    slow: false,
                  ),
                  child: TargetText(expression: phrase.expression, track: track, fontSize: 17),
                ),
          ],
        ),
      );
    }

    final statement = round.statementAt(_index);
    final phrase = _phrases[statement.item.id]!;
    final answered = _answered;
    final ink = switch (answered) {
      true => colors.success,
      false => colors.error,
      null => colors.border,
    };
    final seconds = (_remaining / 1000).ceil().clamp(0, _length.inSeconds);

    Widget choice({required bool yes, required String label, required IconData icon}) => Expanded(
      child: Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(22),
          onTap: answered == null ? () => _answer(yes) : null,
          child: Container(
            constraints: const BoxConstraints(minHeight: 72),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: yes ? colors.success.withValues(alpha: 0.7) : colors.error.withValues(alpha: 0.7), width: 1.5),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 22, color: yes ? colors.success : colors.error),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(label, style: displayStyle(size: 19, color: colors.textPrimary)),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    return GameScaffold(
      kind: GameKind.quick,
      status: GameStatus(icon: LucideIcons.check, value: '${_score.right}', semantics: l10n.gameRightSemantics(_score.right)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
        child: Column(
          children: [
            // The time left, as a line that burns down.
            Semantics(
              label: l10n.gameSecondsLeft(seconds),
              excludeSemantics: true,
              child: Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: SizedBox(
                        height: 8,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            ColoredBox(color: colors.surfaceMuted),
                            FractionallySizedBox(
                              alignment: AlignmentDirectional.centerStart,
                              widthFactor: (_remaining / _length.inMilliseconds).clamp(0.0, 1.0),
                              child: ColoredBox(color: seconds <= 10 ? colors.error : colors.amber),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    gameClock(seconds),
                    style: displayStyle(
                      size: 15,
                      color: seconds <= 10 ? colors.error : colors.textSecondary,
                    ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                  ),
                ],
              ),
            ),
            if (_score.streak >= 3)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(LucideIcons.flame, size: 16, color: colors.amber),
                    const SizedBox(width: 6),
                    Text(
                      l10n.gameStreak(_score.streak),
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.amberText),
                    ),
                  ],
                ),
              ),
            Expanded(
              child: Center(
                child: SingleChildScrollView(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: answered == null ? colors.surface : (answered ? colors.successSoft : colors.errorSoft),
                      borderRadius: BorderRadius.circular(26),
                      border: Border.all(color: ink, width: answered == null ? 1 : 2),
                      boxShadow: [BoxShadow(color: accent.primary.withValues(alpha: 0.10), blurRadius: 26, offset: const Offset(0, 8))],
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        TargetText(expression: phrase.expression, track: track, fontSize: 27, textAlign: TextAlign.center),
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          child: Divider(height: 1, color: colors.border),
                        ),
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            // A wrong answer shows what the phrase means.
                            answered == false ? l10n.gameQuickMeans(statement.item.meaning) : '“${promptMeaning(statement.shown.meaning)}”',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 19,
                              height: 1.3,
                              fontWeight: FontWeight.w600,
                              color: answered == false ? colors.error : colors.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Text(l10n.practiceTrueFalsePrompt, style: TextStyle(fontSize: 14.5, color: colors.textSecondary)),
            const SizedBox(height: 10),
            Row(
              children: [
                choice(yes: true, label: l10n.practiceYes, icon: LucideIcons.check),
                const SizedBox(width: 12),
                choice(yes: false, label: l10n.practiceNo, icon: LucideIcons.x),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// --- By ear -------------------------------------------------------------------------------------------------------

/// By ear: a phrase is said; find it among the written ones. Each answer shows what the phrase means.
class EarGameScreen extends GameScreen {
  const EarGameScreen({super.key, super.missionKey});

  @override
  ConsumerState<EarGameScreen> createState() => _EarGameScreenState();
}

class _EarGameScreenState extends ConsumerState<EarGameScreen> with _GameHost {
  List<EarQuestion>? _questions;
  Map<String, GamePhrase> _phrases = const {};
  int _index = 0;
  int? _picked;
  int _right = 0;
  GameOutcome? _outcome;
  final _missed = <String>[];

  void _start(List<GamePhrase> pool, List<GamePhrase> audible) {
    final seed = roundSeed(GameKind.ear);
    _phrases = {for (final p in pool) p.item.id: p};
    _questions = earQuestions(pool: [for (final p in pool) p.item], audible: [for (final p in audible) p.item], seed: seed);
    _index = 0;
    _picked = null;
    _right = 0;
    _outcome = null;
    _missed.clear();
    WidgetsBinding.instance.addPostFrameCallback((_) => _sayCurrent());
  }

  void _sayCurrent() {
    final questions = _questions;
    if (!mounted || questions == null || _index >= questions.length) return;
    final phrase = _phrases[questions[_index].item.id];
    if (phrase != null) say(phrase.expression);
  }

  void _pick(EarQuestion question, int index) {
    if (_picked != null) return;
    final correct = index == question.answerIndex;
    setState(() {
      _picked = index;
      if (correct) {
        _right++;
      } else {
        _missed.add(question.item.id);
      }
    });
  }

  void _next() {
    final questions = _questions!;
    speech.stop();
    if (_index >= questions.length - 1) {
      final outcome = finishRound(GameKind.ear, _right);
      if (outcome != null) setState(() => _outcome = outcome);
      return;
    }
    setState(() {
      _index++;
      _picked = null;
    });
    _sayCurrent();
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final l10n = context.l10n;
    final track = appState.activeCourse?.track;
    final courseId = appState.activeCourse?.id;
    final pool = ref.watch(roundPoolProvider(missionKey));
    final audible = ref.watch(audibleRoundPoolProvider(missionKey));
    if (track == null || courseId == null) return const MissionUnavailable();
    // The round starts once it is known what can be said here.
    if (_questions == null && audible.length >= minEarPhrases) _start(pool, audible);
    final questions = _questions;
    if (questions == null || questions.isEmpty) return const MissionUnavailable();
    final best = bestOf(GameKind.ear);
    final outcome = _outcome;

    if (outcome != null) {
      return GameScaffold(
        kind: GameKind.ear,
        child: GameResult(
          headline: l10n.gameEarResult(_right, questions.length),
          best: best == null ? null : l10n.gameBestRight(best),
          record: outcome.record,
          xp: outcome.xp,
          onAgain: () => setState(() => _start(pool, audible)),
          onStartMission: onStartMission,
          children: [
            for (final id in _missed.take(4))
              if (_phrases[id] case final phrase?)
                GameMissedRow(
                  meaning: phrase.item.meaning,
                  listen: ListenButtons(
                    text: phrase.expression.text,
                    expressionId: phrase.expression.id,
                    locale: track.voiceLocale,
                    compact: true,
                    slow: false,
                  ),
                  child: TargetText(expression: phrase.expression, track: track, fontSize: 17),
                ),
          ],
        ),
      );
    }

    final question = questions[_index];
    final asked = _phrases[question.item.id]!;
    final picked = _picked;
    return GameScaffold(
      kind: GameKind.ear,
      status: GameStatus(icon: LucideIcons.ear, value: '${_index + 1}/${questions.length}', semantics: l10n.stepOf(_index + 1, questions.length)),
      child: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ExercisePrompt(
                    text: l10n.practiceHearPrompt,
                    mood: picked == null ? MeloState.curious : (picked == question.answerIndex ? MeloState.celebrate : MeloState.thinking),
                  ),
                  const SizedBox(height: 18),
                  BigListen(expression: asked.expression, locale: track.voiceLocale),
                  const SizedBox(height: 18),
                  for (final (i, option) in question.options.indexed)
                    OptionTile(
                      semantics: option.text,
                      locale: contentLanguageOf(track),
                      state: optionState(i, picked: picked, answer: question.answerIndex),
                      onTap: picked == null ? () => _pick(question, i) : null,
                      child: TargetText(expression: _phrases[option.id]!.expression, track: track, fontSize: 18),
                    ),
                ],
              ),
            ),
          ),
          if (picked != null)
            FeedbackPanel(
              correct: picked == question.answerIndex,
              title: picked == question.answerIndex ? l10n.practiceRight : l10n.practiceWrong,
              expression: asked.expression,
              track: track,
              meaning: asked.item.meaning,
              voiceLocale: track.voiceLocale,
              continueLabel: l10n.practiceNext,
              onContinue: _next,
            ),
        ],
      ),
    );
  }
}

// --- Sentence dash ----------------------------------------------------------------------------------------------------

/// Sentence dash: put the words of each sentence back in order, against the clock. What counts is the time.
class DashGameScreen extends GameScreen {
  const DashGameScreen({super.key, super.missionKey});

  @override
  ConsumerState<DashGameScreen> createState() => _DashGameScreenState();
}

class _DashGameScreenState extends ConsumerState<DashGameScreen> with _GameHost {
  List<DashSentence>? _sentences;
  Map<String, GamePhrase> _phrases = const {};
  String _seed = '';
  int _index = 0;
  TilesState? _tiles;
  int _seconds = 0;
  Timer? _clock;
  Timer? _moveOn;
  GameOutcome? _outcome;

  @override
  void dispose() {
    _clock?.cancel();
    _moveOn?.cancel();
    super.dispose();
  }

  void _start() {
    final pool = readPool();
    _clock?.cancel();
    _moveOn?.cancel();
    final seed = roundSeed(GameKind.dash);
    final sentences = dashSentences(pool: [for (final p in pool) p.item], seed: seed);
    if (sentences.length < minDashSentences) return;
    setState(() {
      _seed = seed;
      _phrases = {for (final p in pool) p.item.id: p};
      _sentences = sentences;
      _index = 0;
      _tiles = dashTiles(sentences.first, seed);
      _seconds = 0;
      _outcome = null;
    });
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _outcome == null) setState(() => _seconds++);
    });
  }

  void _check() {
    final sentences = _sentences!;
    final checked = _tiles!.check();
    setState(() => _tiles = checked);
    if (checked.verdict != TilesVerdict.correct) return;
    final phrase = _phrases[sentences[_index].item.id];
    if (phrase != null) say(phrase.expression);
    if (_index >= sentences.length - 1) {
      _clock?.cancel();
      // The sentence stays in view a moment before the result.
      _moveOn = Timer(const Duration(milliseconds: 900), () {
        if (!mounted) return;
        final outcome = finishRound(GameKind.dash, _seconds);
        if (outcome != null) setState(() => _outcome = outcome);
      });
      return;
    }
    _moveOn = Timer(const Duration(milliseconds: 900), () {
      if (!mounted) return;
      setState(() {
        _index++;
        _tiles = dashTiles(sentences[_index], _seed);
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final track = appState.activeCourse?.track;
    final courseId = appState.activeCourse?.id;
    final pool = ref.watch(roundPoolProvider(missionKey));
    if (track == null || courseId == null || pool.where((p) => canDash(p.item)).length < minDashSentences) return const MissionUnavailable();
    final best = bestOf(GameKind.dash);
    final sentences = _sentences;
    final outcome = _outcome;

    if (sentences == null) {
      return GameScaffold(
        kind: GameKind.dash,
        child: GameIntro(kind: GameKind.dash, rules: l10n.gameDashRules, best: best == null ? null : l10n.gameBestTime(gameClock(best)), onStart: _start),
      );
    }
    if (outcome != null) {
      return GameScaffold(
        kind: GameKind.dash,
        child: GameResult(
          headline: l10n.gameDashResult(sentences.length, gameClock(_seconds)),
          best: best == null ? null : l10n.gameBestTime(gameClock(best)),
          record: outcome.record,
          xp: outcome.xp,
          onAgain: _start,
          onStartMission: onStartMission,
        ),
      );
    }

    final sentence = sentences[_index];
    final tiles = _tiles!;
    final verdict = tiles.verdict;
    final solved = verdict == TilesVerdict.correct;
    final placed = [for (final i in tiles.placed) tiles.bank.firstWhere((t) => t.index == i)];
    bool? inPlace(int position) {
      if (verdict == TilesVerdict.building) return null;
      return position < sentence.answer.length && normalizeForCompare(placed[position].text) == normalizeForCompare(sentence.answer[position]);
    }

    return GameScaffold(
      kind: GameKind.dash,
      status: GameStatus(icon: LucideIcons.timer, value: gameClock(_seconds), semantics: l10n.gameTimeSemantics(gameClock(_seconds))),
      child: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.stepOf(_index + 1, sentences.length),
                    style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: appState.accent.primaryText),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    sentence.item.meaning,
                    style: TextStyle(fontSize: 20, height: 1.3, fontWeight: FontWeight.w600, color: colors.textPrimary),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    width: double.infinity,
                    constraints: const BoxConstraints(minHeight: 76),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: colors.surfaceMuted,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: switch (verdict) {
                          TilesVerdict.correct => colors.success,
                          TilesVerdict.wrong => colors.error,
                          TilesVerdict.building => Colors.transparent,
                        },
                        width: 2,
                      ),
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
                  if (solved)
                    Row(
                      children: [
                        Icon(LucideIcons.circleCheck, size: 18, color: colors.success),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            l10n.practiceRight,
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: colors.success),
                          ),
                        ),
                      ],
                    ),
                  const SizedBox(height: 12),
                  if (!solved)
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final t in tiles.bank)
                          if (!tiles.isPlaced(t)) WordTile(word: t.text, semantics: t.text, onTap: () => setState(() => _tiles = tiles.place(t))),
                      ],
                    ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: LearnPrimaryButton(label: l10n.tilesCheck, onPressed: solved || tiles.placed.isEmpty ? null : _check),
          ),
        ],
      ),
    );
  }
}
